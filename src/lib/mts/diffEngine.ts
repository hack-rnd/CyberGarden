import crypto from "crypto";
import {
  DiffEvent,
  DiffEventType,
  IncidentHistoryField,
  NormalizedIncident,
} from "@/types/incident";

// --- TYPES ---

export interface PendingHistoryEntry {
  incidentId: string;
  field: IncidentHistoryField;
  oldValue: string | null;
  newValue: string;
  actor: string;
}

// --- EVENT BUILDER ---

function createEvent(
  inc: NormalizedIncident,
  type: DiffEventType,
  message: string
): DiffEvent {
  return {
    id: crypto.randomUUID(),
    incidentId: inc.id,
    incidentCode: inc.code,
    product: inc.product,
    type,
    message,
    createdAt: new Date().toISOString(),
  };
}

// --- DIFF ENGINE ---

export function computeIncidentDiff(
  prevList: NormalizedIncident[],
  nextList: NormalizedIncident[]
): DiffEvent[] {
  const prevMap = new Map(prevList.map((item) => [item.id, item]));
  const events: DiffEvent[] = [];

  for (const next of nextList) {
    const prev = prevMap.get(next.id);

    if (!prev) {
      if (next.priority === "critical" && next.isActive) {
        events.push(
          createEvent(
            next,
            "NEW_CRITICAL",
            `Новый критический инцидент ${next.code} (${next.product})`
          )
        );
      }
      if (next.groups.includes("ASSIGNED_TO_COORDINATORS")) {
        const type: DiffEventType = next.groups.includes("INVESTIGATION")
          ? "INVESTIGATION_ASSIGNED"
          : "ASSIGNED_TO_COORDINATORS";
        events.push(
          createEvent(
            next,
            type,
            `Инцидент ${next.code} (${next.product}) назначен на координаторов`
          )
        );
      }
      continue;
    }

    const wasCriticalActive = prev.priority === "critical" && prev.isActive;
    const isCriticalActive = next.priority === "critical" && next.isActive;

    if (!wasCriticalActive && isCriticalActive) {
      events.push(
        createEvent(
          next,
          "NEW_CRITICAL",
          `Приоритет ${next.code} (${next.product}) повышен до критического`
        )
      );
    }

    if (wasCriticalActive && !next.isActive) {
      events.push(
        createEvent(
          next,
          "CRITICAL_RESOLVED",
          `Критический инцидент ${next.code} (${next.product}) решён`
        )
      );
    }

    const wasAssigned = prev.groups.includes("ASSIGNED_TO_COORDINATORS");
    const isAssigned = next.groups.includes("ASSIGNED_TO_COORDINATORS");

    if (!wasAssigned && isAssigned) {
      const type: DiffEventType = next.groups.includes("INVESTIGATION")
        ? "INVESTIGATION_ASSIGNED"
        : "ASSIGNED_TO_COORDINATORS";
      events.push(
        createEvent(
          next,
          type,
          `Инцидент ${next.code} (${next.product}) назначен на координаторов`
        )
      );
    } else if (wasAssigned && !isAssigned && next.isActive) {
      events.push(
        createEvent(
          next,
          "REASSIGNED_OUT",
          `Инцидент ${next.code} передан в команду: ${next.assigneeTeam}`
        )
      );
    }

    const priorityChanged = prev.priority !== next.priority;
    const slaChanged = prev.slaDeadline !== next.slaDeadline;

    if (
      (priorityChanged || slaChanged) &&
      !(wasCriticalActive !== isCriticalActive)
    ) {
      events.push(
        createEvent(
          next,
          "SLA_OR_PRIORITY_CHANGED",
          `Изменены приоритет или срок SLA для ${next.code} (${next.product})`
        )
      );
    }
  }

  return events;
}

// --- EXTERNAL HISTORY DIFF ---

export function computeExternalHistoryDiff(
  prevList: NormalizedIncident[],
  nextList: NormalizedIncident[],
  actor = "Внешний JSON"
): PendingHistoryEntry[] {
  const prevMap = new Map(prevList.map((item) => [item.id, item]));
  const entries: PendingHistoryEntry[] = [];

  for (const next of nextList) {
    const prev = prevMap.get(next.id);

    if (!prev) {
      entries.push({
        incidentId: next.id,
        field: "created",
        oldValue: null,
        newValue: `${next.product} (${next.rawStatus})`,
        actor,
      });
      continue;
    }

    if (prev.status !== next.status) {
      entries.push({
        incidentId: next.id,
        field: "status",
        oldValue: prev.rawStatus,
        newValue: next.rawStatus,
        actor,
      });
    }

    if (prev.priority !== next.priority) {
      entries.push({
        incidentId: next.id,
        field: "priority",
        oldValue: prev.rawPriority,
        newValue: next.rawPriority,
        actor,
      });
    }

    const prevAssignee = prev.assigneeEmployee
      ? `${prev.assigneeEmployee} (${prev.assigneeTeam})`
      : prev.assigneeTeam;
    const nextAssignee = next.assigneeEmployee
      ? `${next.assigneeEmployee} (${next.assigneeTeam})`
      : next.assigneeTeam;

    if (prevAssignee !== nextAssignee) {
      entries.push({
        incidentId: next.id,
        field: "assignee",
        oldValue: prevAssignee,
        newValue: nextAssignee,
        actor,
      });
    }

    if (prev.slaDeadline !== next.slaDeadline) {
      entries.push({
        incidentId: next.id,
        field: "sla",
        oldValue: prev.slaDeadline ?? "Не задан",
        newValue: next.slaDeadline ?? "Не задан",
        actor,
      });
    }

    const prevGroups = [...prev.groups].sort().join(", ");
    const nextGroups = [...next.groups].sort().join(", ");
    if (prevGroups !== nextGroups) {
      entries.push({
        incidentId: next.id,
        field: "groups",
        oldValue: prevGroups || "Нет",
        newValue: nextGroups || "Нет",
        actor,
      });
    }
  }

  return entries;
}