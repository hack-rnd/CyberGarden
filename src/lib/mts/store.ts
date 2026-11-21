import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { prisma } from "@/lib/prisma";
import {
  buildActivity24h,
  buildDashboardSummary,
  parseMtsJson,
} from "@/lib/mts/adapter";
import { startAutoCloseWorker } from "@/lib/mts/autoClose";
import {
  computeExternalHistoryDiff,
  computeIncidentDiff,
} from "@/lib/mts/diffEngine";
import { recordHistoryEntries } from "@/lib/mts/mutations";
import {
  DiffEvent,
  IncidentAiData,
  IncidentsApiResponse,
  NormalizedIncident,
} from "@/types/incident";

// --- TYPES ---

export interface StreamPayload {
  snapshot: IncidentsApiResponse;
  events: DiffEvent[];
}

type FileStatus = "ok" | "parse_error" | "missing";

// --- STORE CLASS ---

class IncidentStore {
  private incidents: NormalizedIncident[] = [];
  private lastUpdatedAt = new Date().toISOString();
  private fileStatus: FileStatus = "ok";
  private fileError: string | undefined;
  private watcher: FSWatcher | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private emitter = new EventEmitter();
  private suppressedHistoryUntil = new Map<string, number>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  private getFilePath(): string {
    const configured = process.env.MTS_JSON_PATH || "./data/incidents.json";
    return path.resolve(process.cwd(), configured);
  }

  private normalizeRiskLevel(val: string): "low" | "medium" | "high" {
    if (val === "high" || val === "medium" || val === "low") return val;
    return "medium";
  }

  public suppressExternalHistory(incidentId: string, durationMs = 3000): void {
    this.suppressedHistoryUntil.set(incidentId, Date.now() + durationMs);
  }

  private isHistorySuppressed(incidentId: string): boolean {
    const until = this.suppressedHistoryUntil.get(incidentId);
    if (!until) return false;
    if (Date.now() > until) {
      this.suppressedHistoryUntil.delete(incidentId);
      return false;
    }
    return true;
  }

  private async hydrateAiCache(
    list: NormalizedIncident[]
  ): Promise<NormalizedIncident[]> {
    if (list.length === 0) return list;

    try {
      const cachedRows = await prisma.aiAnalysisCache.findMany({
        where: {
          incidentId: { in: list.map((item) => item.id) },
        },
      });

      const cacheMap = new Map(cachedRows.map((row) => [row.incidentId, row]));

      return list.map((inc) => {
        const cached = cacheMap.get(inc.id);
        if (!cached || cached.contentHash !== inc.contentHash) {
          return inc;
        }

        const ai: IncidentAiData = {
          summary: cached.summary,
          recommendedTeam: cached.recommendedTeam,
          riskScore: cached.riskScore,
          riskLevel: this.normalizeRiskLevel(cached.riskLevel),
          riskReason: cached.riskReason,
          handoffMessage: cached.handoffMessage,
          provider: cached.provider,
          updatedAt: cached.updatedAt.toISOString(),
        };

        return { ...inc, ai };
      });
    } catch {
      return list;
    }
  }

  private async persistEvents(events: DiffEvent[]): Promise<void> {
    if (events.length === 0) return;

    try {
      await prisma.changeEvent.createMany({
        data: events.map((ev) => ({
          id: ev.id,
          incidentId: ev.incidentId,
          incidentCode: ev.incidentCode,
          product: ev.product,
          type: ev.type,
          message: ev.message,
          createdAt: new Date(ev.createdAt),
        })),
      });
    } catch {
      // Ignore DB write errors to keep watcher alive
    }
  }

  public async emitCustomEvent(event: DiffEvent): Promise<void> {
    await this.persistEvents([event]);
    this.lastUpdatedAt = new Date().toISOString();
    this.emitter.emit("update", {
      snapshot: this.getSnapshot(),
      events: [event],
    } satisfies StreamPayload);
  }

  public async reloadFromDisk(emitDiff: boolean): Promise<void> {
    const filePath = this.getFilePath();

    if (!fs.existsSync(filePath)) {
      this.fileStatus = "missing";
      this.fileError = `File not found: ${filePath}`;
      this.lastUpdatedAt = new Date().toISOString();
      this.emitter.emit("update", {
        snapshot: this.getSnapshot(),
        events: [],
      } satisfies StreamPayload);
      return;
    }

    try {
      const rawText = fs.readFileSync(filePath, "utf-8");
      const rawJson: unknown = JSON.parse(rawText);
      const parsed = parseMtsJson(rawJson);
      const hydrated = await this.hydrateAiCache(parsed);

      const events = emitDiff
        ? computeIncidentDiff(this.incidents, hydrated)
        : [];

      const externalHistory = emitDiff
        ? computeExternalHistoryDiff(this.incidents, hydrated).filter(
            (entry) => !this.isHistorySuppressed(entry.incidentId)
          )
        : [];

      this.incidents = hydrated;
      this.fileStatus = "ok";
      this.fileError = undefined;
      this.lastUpdatedAt = new Date().toISOString();

      if (events.length > 0) {
        await this.persistEvents(events);
      }

      if (externalHistory.length > 0) {
        try {
          await recordHistoryEntries(externalHistory);
        } catch {
          // Ignore DB write errors
        }
      }

      if (emitDiff) {
        this.emitter.emit("update", {
          snapshot: this.getSnapshot(),
          events,
        } satisfies StreamPayload);
      }
    } catch (err) {
      this.fileStatus = "parse_error";
      this.fileError =
        err instanceof Error ? err.message : "Invalid JSON format";
      this.lastUpdatedAt = new Date().toISOString();

      if (emitDiff) {
        this.emitter.emit("update", {
          snapshot: this.getSnapshot(),
          events: [],
        } satisfies StreamPayload);
      }
    }
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.reloadFromDisk(false);
      this.startWatcher();
      startAutoCloseWorker(this);
      this.initialized = true;
    })();

    return this.initPromise;
  }

  private startWatcher(): void {
    if (this.watcher) return;
    const filePath = this.getFilePath();

    this.watcher = chokidar.watch(filePath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 50,
      },
    });

    this.watcher.on("change", () => {
      void this.reloadFromDisk(true);
    });

    this.watcher.on("add", () => {
      void this.reloadFromDisk(true);
    });

    this.watcher.on("unlink", () => {
      void this.reloadFromDisk(true);
    });
  }

  public async notifyAiUpdated(): Promise<void> {
    this.incidents = await this.hydrateAiCache(this.incidents);
    this.lastUpdatedAt = new Date().toISOString();
    this.emitter.emit("update", {
      snapshot: this.getSnapshot(),
      events: [],
    } satisfies StreamPayload);
  }

  public getSnapshot(): IncidentsApiResponse {
    return {
      incidents: this.incidents,
      summary: buildDashboardSummary(this.incidents),
      activity: buildActivity24h(this.incidents),
      lastUpdatedAt: this.lastUpdatedAt,
      fileStatus: this.fileStatus,
      fileError: this.fileError,
    };
  }

  public subscribe(listener: (payload: StreamPayload) => void): () => void {
    this.emitter.on("update", listener);
    return () => {
      this.emitter.off("update", listener);
    };
  }
}

// --- SINGLETON ---

const globalForStore = globalThis as unknown as {
  incidentStore: IncidentStore | undefined;
};

export const incidentStore =
  globalForStore.incidentStore ?? new IncidentStore();

if (process.env.NODE_ENV !== "production") {
  globalForStore.incidentStore = incidentStore;
}