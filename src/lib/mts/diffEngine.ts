import crypto from "crypto";
import { DiffEvent, DiffEventType, NormalizedIncident } from "@/types/incident";

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

    if ((priorityChanged || slaChanged) && !(wasCriticalActive !== isCriticalActive)) {
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