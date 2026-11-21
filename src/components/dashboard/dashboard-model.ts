import type { DiffEvent, NormalizedIncident, SlaStatus } from "@/types/incident";

export type DashboardIncident = NormalizedIncident;
export type IncidentTimelineEvent = Pick<DiffEvent, "id" | "incidentId" | "createdAt"> & {
  eventType: DiffEvent["type"];
  title: DiffEvent["message"];
  details: DiffEvent["product"];
};

export function isIncidentActive({ status }: Pick<DashboardIncident, "status">) {
  return status !== "resolved" && status !== "closed" && status !== "investigation";
}

export function deadlineFor(incident: Pick<DashboardIncident, "slaDeadline">) {
  const deadline = Date.parse(incident.slaDeadline ?? "");
  return Number.isFinite(deadline) ? deadline : Infinity;
}

export function currentSlaStatus(incident: DashboardIncident, now: number | null): SlaStatus {
  if (!isIncidentActive(incident)) return "completed";
  const deadline = deadlineFor(incident);
  if (!Number.isFinite(deadline)) return "ok";
  if (now === null) return incident.slaStatus;

  const remaining = deadline - now;
  if (remaining <= 0) return "breached";

  const created = Date.parse(incident.createdAt);
  const totalWindow = deadline > created ? deadline - created : 3_600_000;
  if (remaining <= 15 * 60_000 || remaining / totalWindow <= 0.15) return "critical";
  if (remaining <= 45 * 60_000 || remaining / totalWindow <= 0.35) return "warning";
  return "ok";
}
