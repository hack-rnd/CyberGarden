import { useSyncExternalStore } from "react";
import type { DashboardIncident } from "@/components/dashboard/dashboard-model";
import type { IncidentHistoryItem } from "@/types/incident";

const HISTORY_STORAGE_KEY = "mts-manual-process-history-v1";
const SNAPSHOT_STORAGE_KEY = "mts-manual-process-snapshots-v1";

const STATUS_LABELS: Record<DashboardIncident["status"], string> = {
  new: "Новый",
  in_progress: "В работе",
  waiting: "Ожидает",
  investigation: "Исследование ситуации",
  resolved: "Решён",
  closed: "Закрыт",
};

const PRIORITY_LABELS: Record<DashboardIncident["priority"], string> = {
  critical: "Критический",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const GROUP_LABELS: Record<string, string> = {
  CRITICAL: "Критические",
  ASSIGNED_TO_COORDINATORS: "На координаторах",
  HIGH_PRIORITY: "Высокий приоритет",
  INVESTIGATION: "Исследование ситуации",
};

type ManualSnapshot = {
  product: string;
  status: DashboardIncident["status"];
  priority: DashboardIncident["priority"];
  assignee: string;
  slaDeadline: string;
  groups: string;
  description: string;
};

const EMPTY_HISTORY: IncidentHistoryItem[] = [];
const listeners = new Set<() => void>();

let loaded = false;
let historyCache: Record<string, IncidentHistoryItem[]> = {};
let snapshotCache: Record<string, ManualSnapshot> = {};

function formatAssigneeLabel(incident: DashboardIncident): string {
  const employee = incident.assigneeEmployee?.trim() || "";
  const team =
    incident.assigneeTeam?.trim() &&
    incident.assigneeTeam.trim().toLowerCase() !== "не назначена"
      ? incident.assigneeTeam.trim()
      : "";
  if (employee && team) return `${employee} · ${team}`;
  if (employee) return employee;
  if (team) return team;
  return "Не назначен";
}

function formatGroupsLabel(groups: readonly string[]): string {
  if (!groups.length) return "Нет";
  return [...groups]
    .sort()
    .map((group) => GROUP_LABELS[group] ?? group)
    .join(", ");
}

function formatSlaLabel(deadline: string | null | undefined): string {
  if (!deadline) return "Не задан";
  const ms = Date.parse(deadline);
  if (!Number.isFinite(ms)) return deadline;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ms));
}

function toSnapshot(incident: DashboardIncident): ManualSnapshot {
  return {
    product: incident.product,
    status: incident.status,
    priority: incident.priority,
    assignee: formatAssigneeLabel(incident),
    slaDeadline: formatSlaLabel(incident.slaDeadline),
    groups: formatGroupsLabel(incident.groups),
    description: incident.description.trim(),
  };
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const rawHistory = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (rawHistory) {
      const parsed: unknown = JSON.parse(rawHistory);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        historyCache = parsed as Record<string, IncidentHistoryItem[]>;
      }
    }
  } catch {
    historyCache = {};
  }

  try {
    const rawSnapshots = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (rawSnapshots) {
      const parsed: unknown = JSON.parse(rawSnapshots);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        snapshotCache = parsed as Record<string, ManualSnapshot>;
      }
    }
  } catch {
    snapshotCache = {};
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(historyCache),
    );
    window.localStorage.setItem(
      SNAPSHOT_STORAGE_KEY,
      JSON.stringify(snapshotCache),
    );
  } catch {
    // Ignore storage quota errors
  }
}

function makeEntry(
  incidentId: string,
  field: string,
  oldValue: string | null,
  newValue: string,
  createdAt: string,
): IncidentHistoryItem {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `manual-${incidentId}-${field}-${unique}`,
    incidentId,
    field,
    oldValue,
    newValue,
    actor: "Координатор",
    createdAt,
  };
}

export function syncManualIncidentHistory(
  manualIncidents: readonly DashboardIncident[],
): void {
  if (typeof window === "undefined") return;
  ensureLoaded();

  let changed = false;
  const nowIso = new Date().toISOString();

  for (const incident of manualIncidents) {
    const next = toSnapshot(incident);
    const prev = snapshotCache[incident.id];

    if (!prev) {
      snapshotCache[incident.id] = next;
      const existing = historyCache[incident.id] ?? [];
      if (existing.length === 0) {
        const createdAt = Number.isFinite(Date.parse(incident.createdAt))
          ? incident.createdAt
          : nowIso;
        historyCache[incident.id] = [
          makeEntry(
            incident.id,
            "created",
            null,
            `Создан вручную · Статус: ${STATUS_LABELS[next.status]}, Приоритет: ${PRIORITY_LABELS[next.priority]}`,
            createdAt,
          ),
        ];
      }
      changed = true;
      continue;
    }

    const diffs: IncidentHistoryItem[] = [];

    if (prev.status !== next.status) {
      diffs.push(
        makeEntry(
          incident.id,
          "status",
          STATUS_LABELS[prev.status],
          STATUS_LABELS[next.status],
          nowIso,
        ),
      );
    }
    if (prev.priority !== next.priority) {
      diffs.push(
        makeEntry(
          incident.id,
          "priority",
          PRIORITY_LABELS[prev.priority],
          PRIORITY_LABELS[next.priority],
          nowIso,
        ),
      );
    }
    if (prev.assignee !== next.assignee) {
      diffs.push(
        makeEntry(incident.id, "assignee", prev.assignee, next.assignee, nowIso),
      );
    }
    if (prev.product !== next.product) {
      diffs.push(
        makeEntry(incident.id, "product", prev.product, next.product, nowIso),
      );
    }
    if (prev.slaDeadline !== next.slaDeadline) {
      diffs.push(
        makeEntry(incident.id, "sla", prev.slaDeadline, next.slaDeadline, nowIso),
      );
    }
    if (prev.groups !== next.groups) {
      diffs.push(
        makeEntry(incident.id, "groups", prev.groups, next.groups, nowIso),
      );
    }
    if (prev.description !== next.description) {
      diffs.push(
        makeEntry(
          incident.id,
          "description",
          prev.description || "—",
          next.description || "—",
          nowIso,
        ),
      );
    }

    if (diffs.length > 0) {
      snapshotCache[incident.id] = next;
      const existing = historyCache[incident.id] ?? [];
      historyCache[incident.id] = [...diffs, ...existing].slice(0, 100);
      changed = true;
    }
  }

  if (changed) {
    persist();
    for (const listener of listeners) listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readHistory(id: string): IncidentHistoryItem[] {
  ensureLoaded();
  return historyCache[id] ?? EMPTY_HISTORY;
}

export function useManualIncidentHistory(id: string): IncidentHistoryItem[] {
  return useSyncExternalStore(
    subscribe,
    () => readHistory(id),
    () => EMPTY_HISTORY,
  );
}