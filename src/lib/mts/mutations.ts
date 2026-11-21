import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import {
  IncidentPriority,
  IncidentStatus,
  MtsLinkMessageType,
} from "@/types/incident";
import { PendingHistoryEntry } from "@/lib/mts/diffEngine";

// --- RAW MAPPINGS ---

export const STATUS_TO_RAW: Record<
  IncidentStatus,
  { state: string; stateEnum: string; stateId: number }
> = {
  new: { state: "Назначен", stateEnum: "Assigned", stateId: 0 },
  waiting: { state: "Назначен", stateEnum: "Assigned", stateId: 0 },
  in_progress: { state: "Выполняется", stateEnum: "WorkInProgress", stateId: 2 },
  investigation: {
    state: "Исследование ситуации",
    stateEnum: "Research",
    stateId: 20,
  },
  resolved: { state: "Завершен", stateEnum: "Resolved", stateId: 7 },
  closed: { state: "Закрыт", stateEnum: "Closed", stateId: 10 },
};

export const PRIORITY_TO_RAW: Record<
  IncidentPriority,
  { priority: string; priorityId: number }
> = {
  critical: { priority: "Наивысший", priorityId: 4 },
  high: { priority: "Высокий", priorityId: 3 },
  medium: { priority: "Средний", priorityId: 2 },
  low: { priority: "Низкий", priorityId: 1 },
};

export type RawIncidentRecord = Record<string, unknown>;

export interface RawJsonContainer {
  filePath: string;
  list: RawIncidentRecord[];
  wrapped: boolean;
  rootObject?: Record<string, unknown>;
}

// --- FILE IO ---

export function getIncidentsFilePath(): string {
  const configured = process.env.MTS_JSON_PATH || "./data/incidents.json";
  return path.resolve(process.cwd(), configured);
}

export function readRawIncidents(): RawJsonContainer {
  const filePath = getIncidentsFilePath();
  if (!fs.existsSync(filePath)) {
    return { filePath, list: [], wrapped: false };
  }

  const rawText = fs.readFileSync(filePath, "utf-8");
  const parsed: unknown = JSON.parse(rawText);

  if (Array.isArray(parsed)) {
    return {
      filePath,
      list: parsed as RawIncidentRecord[],
      wrapped: false,
    };
  }

  if (
    parsed &&
    typeof parsed === "object" &&
    "incidents" in parsed &&
    Array.isArray((parsed as { incidents: unknown }).incidents)
  ) {
    const rootObject = parsed as Record<string, unknown>;
    return {
      filePath,
      list: rootObject.incidents as RawIncidentRecord[],
      wrapped: true,
      rootObject,
    };
  }

  return { filePath, list: [], wrapped: false };
}

export function writeRawIncidentsAtomically(container: RawJsonContainer): void {
  const payload = container.wrapped
    ? { ...(container.rootObject ?? {}), incidents: container.list }
    : container.list;
  const serialized = JSON.stringify(payload, null, 2);
  const tmpPath = `${container.filePath}.tmp`;

  try {
    fs.writeFileSync(tmpPath, serialized, "utf-8");
    fs.renameSync(tmpPath, container.filePath);
  } catch {
    fs.writeFileSync(container.filePath, serialized, "utf-8");
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup failure
      }
    }
  }
}

// --- DB HELPERS ---

export async function recordHistoryEntries(
  entries: PendingHistoryEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  await prisma.incidentHistory.createMany({
    data: entries.map((entry) => ({
      incidentId: entry.incidentId,
      field: entry.field,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      actor: entry.actor,
    })),
  });
}

export async function createMtsLinkMessage(params: {
  incidentId: string;
  recipientName: string;
  recipientTeam: string;
  messageType: MtsLinkMessageType;
  title: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await prisma.mtsLinkMessage.create({
    data: {
      incidentId: params.incidentId,
      recipientName: params.recipientName,
      recipientTeam: params.recipientTeam,
      messageType: params.messageType,
      title: params.title,
      payloadJson: JSON.stringify(params.payload),
    },
  });
}