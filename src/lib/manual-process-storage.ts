import { z } from "zod";
import { incidentOverrideFields, storedManualProcess, type IncidentOverrides, type ManualProcess, type ProcessFields } from "./manual-process";
import type { IncidentAiData, NormalizedIncident } from "@/types/incident";

export const manualProcessStorageKey = "cybergarden:manual-processes";
export const manualProcessesChanged = "cybergarden:manual-processes-changed";
const incidentOverridesKey = "cybergarden:incident-overrides";

const historyEvent = z.object({
  id: z.string(),
  product: z.string(),
  at: z.number().int().nonnegative().max(8.64e15),
  action: z.enum(["created", "deleted"]),
});

export type ProcessHistoryEvent = z.infer<typeof historyEvent>;

type ManualProcessStore = {
  processes: ManualProcess[];
  history: ProcessHistoryEvent[];
};

function readEntries<T>(data: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const result = schema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

function creationEvent(process: ManualProcess): ProcessHistoryEvent {
  return {
    id: process.id,
    product: process.product,
    at: Date.parse(process.createdAt),
    action: "created",
  };
}

function readManualProcessStore(snapshot: string): ManualProcessStore {
  try {
    const data: unknown = JSON.parse(snapshot);
    if (Array.isArray(data)) {
      const processes = readEntries(data, storedManualProcess);
      return { processes, history: processes.map(creationEvent) };
    }
    if (data && typeof data === "object" && "processes" in data && "history" in data) {
      return {
        processes: readEntries(data.processes, storedManualProcess),
        history: readEntries(data.history, historyEvent),
      };
    }
  } catch {
    // При повреждении данных показываем пустой список.
  }
  return { processes: [], history: [] };
}

export function readManualProcesses(snapshot: string): ManualProcess[] {
  return readManualProcessStore(snapshot).processes;
}

export function readManualProcessHistory(snapshot: string): ProcessHistoryEvent[] {
  return readManualProcessStore(snapshot).history;
}

export function getManualProcessSnapshot() {
  try {
    return localStorage.getItem(manualProcessStorageKey) ?? "[]";
  } catch {
    return "[]";
  }
}

export function writeManualProcesses(processes: ManualProcess[]) {
  const previous = readManualProcessStore(localStorage.getItem(manualProcessStorageKey) ?? "[]");
  const previousIds = new Set(previous.processes.map(({ id }) => id));
  const nextIds = new Set(processes.map(({ id }) => id));
  const history = [...previous.history];
  history.push(...processes.filter(({ id }) => !previousIds.has(id)).map(creationEvent));

  const deletedAt = Date.now();
  for (const process of previous.processes) {
    if (!nextIds.has(process.id)) {
      history.push({ id: process.id, product: process.product, at: deletedAt, action: "deleted" });
    }
  }

  localStorage.setItem(manualProcessStorageKey, JSON.stringify({ processes, history }));
  window.dispatchEvent(new Event(manualProcessesChanged));
}

export function getIncidentOverridesSnapshot() {
  try {
    return localStorage.getItem(incidentOverridesKey) ?? "{}";
  } catch {
    return "{}";
  }
}

export function readIncidentOverrides(snapshot: string) {
  const overrides = new Map<string, IncidentOverrides>();
  try {
    const parsed: unknown = JSON.parse(snapshot);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [id, fields] of Object.entries(parsed)) {
        const result = incidentOverrideFields.safeParse(fields);
        if (result.success) overrides.set(id, result.data);
      }
    }
  } catch {
    return overrides;
  }
  return overrides;
}

export function saveIncidentOverrides(source: NormalizedIncident, displayed: NormalizedIncident, fields: ProcessFields) {
  const latest = readIncidentOverrides(getIncidentOverridesSnapshot());
  const overrides = { ...latest.get(source.id) };
  const comparable = (value: ProcessFields[keyof ProcessFields]) =>
    Array.isArray(value) ? JSON.stringify([...value].sort()) : JSON.stringify(value);
  for (const key of Object.keys(fields) as (keyof ProcessFields)[]) {
    const value = fields[key];
    if (comparable(value) === comparable(displayed[key])) continue;
    if (comparable(value) === comparable(source[key])) delete overrides[key];
    else Object.assign(overrides, { [key]: value });
  }
  if (Object.keys(overrides).length) latest.set(source.id, overrides);
  else latest.delete(source.id);
  localStorage.setItem(incidentOverridesKey, JSON.stringify(Object.fromEntries(latest)));
  window.dispatchEvent(new Event(manualProcessesChanged));
}

export function saveManualProcessAnalysis(process: ManualProcess, ai: IncidentAiData) {
  const current = readManualProcesses(getManualProcessSnapshot());
  const latest = current.find(({ id }) => id === process.id);
  if (!latest || latest.revision !== process.revision) {
    throw new Error("Процесс изменился. Запустите анализ ещё раз.");
  }
  writeManualProcesses(current.map((entry) => entry.id === process.id ? { ...entry, ai } : entry));
}
