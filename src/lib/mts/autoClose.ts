import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  createMtsLinkMessage,
  readRawIncidents,
  recordHistoryEntries,
  STATUS_TO_RAW,
  writeRawIncidentsAtomically,
} from "@/lib/mts/mutations";
import { DiffEvent, NormalizedIncident } from "@/types/incident";

// --- TYPES ---

interface AutoCloseStoreBridge {
  getSnapshot: () => { incidents: NormalizedIncident[] };
  suppressExternalHistory: (incidentId: string) => void;
  reloadFromDisk: (emitDiff: boolean) => Promise<void>;
  emitCustomEvent: (event: DiffEvent) => Promise<void>;
}

// --- CONSTANTS ---

const CHECK_INTERVAL_MS = 15_000;
const DEFAULT_AUTO_CLOSE_MS = 300_000;

function getThresholdMs(): number {
  const parsed = Number(process.env.MTS_AUTO_CLOSE_MS ?? DEFAULT_AUTO_CLOSE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTO_CLOSE_MS;
}

// --- WORKER ---

async function runAutoCloseSweep(store: AutoCloseStoreBridge): Promise<void> {
  const snapshot = store.getSnapshot();
  const resolvedList = snapshot.incidents.filter(
    (inc) => inc.status === "resolved"
  );
  if (resolvedList.length === 0) return;

  const thresholdMs = getThresholdMs();
  const now = Date.now();
  const container = readRawIncidents();
  const rawById = new Map(
    container.list.map((item) => [String(item.id ?? ""), item])
  );

  let changedAny = false;
  const closedEvents: DiffEvent[] = [];

  for (const inc of resolvedList) {
    const rawItem = rawById.get(inc.id);
    if (!rawItem) continue;
    if (rawItem.stateId === 10) continue;

    let lastTouchMs = NaN;

    try {
      const latestHistory = await prisma.incidentHistory.findFirst({
        where: { incidentId: inc.id },
        orderBy: { createdAt: "desc" },
      });
      if (latestHistory) {
        lastTouchMs = latestHistory.createdAt.getTime();
      }
    } catch {
      // Fallback to completionDate
    }

    const completionMs =
      typeof rawItem.completionDate === "string"
        ? Date.parse(rawItem.completionDate)
        : NaN;

    if (Number.isFinite(completionMs)) {
      lastTouchMs = Number.isFinite(lastTouchMs)
        ? Math.max(lastTouchMs, completionMs)
        : completionMs;
    }

    if (!Number.isFinite(lastTouchMs)) continue;
    if (now - lastTouchMs < thresholdMs) continue;

    const closedRaw = STATUS_TO_RAW.closed;
    rawItem.state = closedRaw.state;
    rawItem.stateEnum = closedRaw.stateEnum;
    rawItem.stateId = closedRaw.stateId;
    changedAny = true;

    store.suppressExternalHistory(inc.id);

    const recipientName =
      inc.assigneeEmployee || inc.assigneeTeam || "Дежурный координатор";

    try {
      await recordHistoryEntries([
        {
          incidentId: inc.id,
          field: "auto_closed",
          oldValue: "Решён",
          newValue: "Закрыт (автоматически через 5 мин)",
          actor: "Система",
        },
      ]);

      await createMtsLinkMessage({
        incidentId: inc.id,
        recipientName,
        recipientTeam: inc.assigneeTeam,
        messageType: "AUTO_CLOSED",
        title: `Инцидент ${inc.code} автоматически закрыт`,
        payload: {
          incidentId: inc.id,
          product: inc.product,
          title: inc.title,
          status: "Закрыт",
          priority: inc.rawPriority,
          assigneeEmployee: inc.assigneeEmployee ?? null,
          assigneeTeam: inc.assigneeTeam,
          closedAt: new Date(now).toISOString(),
        },
      });
    } catch {
      // Keep sweep resilient
    }

    closedEvents.push({
      id: crypto.randomUUID(),
      incidentId: inc.id,
      incidentCode: inc.code,
      product: inc.product,
      type: "INCIDENT_AUTO_CLOSED",
      message: `Инцидент ${inc.code} (${inc.product}) закрыт автоматически. Уведомление отправлено: ${recipientName}`,
      createdAt: new Date(now).toISOString(),
    });
  }

  if (changedAny) {
    writeRawIncidentsAtomically(container);
    await store.reloadFromDisk(true);
    for (const ev of closedEvents) {
      await store.emitCustomEvent(ev);
    }
  }
}

// --- SINGLETON ---

const globalForAutoClose = globalThis as unknown as {
  mtsAutoCloseTimer: ReturnType<typeof setInterval> | undefined;
  mtsAutoCloseRunning: boolean | undefined;
};

export function startAutoCloseWorker(store: AutoCloseStoreBridge): void {
  if (globalForAutoClose.mtsAutoCloseTimer) return;

  globalForAutoClose.mtsAutoCloseTimer = setInterval(() => {
    if (globalForAutoClose.mtsAutoCloseRunning) return;
    globalForAutoClose.mtsAutoCloseRunning = true;
    void runAutoCloseSweep(store).finally(() => {
      globalForAutoClose.mtsAutoCloseRunning = false;
    });
  }, CHECK_INTERVAL_MS);
}