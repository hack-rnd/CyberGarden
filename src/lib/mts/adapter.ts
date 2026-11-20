import crypto from "crypto";
import { z } from "zod";
import {
  ActivityPoint,
  DashboardSummary,
  IncidentGroup,
  IncidentPriority,
  IncidentStatus,
  NormalizedIncident,
  SlaStatus,
} from "@/types/incident";

// --- CONSTANTS ---

export const COORDINATOR_TEAM_NAME = "КЦ ИТ Координаторы Массовых Инцидентов";

const RawIncidentSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    product: z.string().optional().default("Не указан"),
    title: z.string().optional().default(""),
    description: z.string().optional().default(""),
    priority: z.string().optional().default("Средний"),
    status: z.string().optional().default("В работе"),
    assignee_team: z.string().nullable().optional().default(""),
    created_at: z.string().optional(),
    sla_deadline: z.string().nullable().optional(),
    itsm_url: z.string().optional(),
  })
  .passthrough();

type RawIncident = z.infer<typeof RawIncidentSchema>;

// --- NORMALIZATION HELPERS ---

function mapPriority(raw: string): IncidentPriority {
  const val = raw.toLowerCase();
  if (val.includes("крит") || val === "1" || val === "p1" || val === "critical") {
    return "critical";
  }
  if (val.includes("высок") || val === "2" || val === "p2" || val === "high") {
    return "high";
  }
  if (val.includes("низк") || val === "4" || val === "p4" || val === "low") {
    return "low";
  }
  return "medium";
}

function mapStatus(raw: string): IncidentStatus {
  const val = raw.toLowerCase();
  if (val.includes("исследован") || val.includes("разбор") || val.includes("rca")) {
    return "investigation";
  }
  if (val.includes("реш") || val.includes("устран") || val.includes("resolved")) {
    return "resolved";
  }
  if (val.includes("закрыт") || val.includes("closed")) {
    return "closed";
  }
  if (val.includes("ожида") || val.includes("назнач") || val.includes("waiting")) {
    return "waiting";
  }
  if (val.includes("нов") || val.includes("new")) {
    return "new";
  }
  return "in_progress";
}

function computeSla(
  createdAtIso: string,
  deadlineIso: string | null,
  status: IncidentStatus
): { remainingMs: number | null; slaStatus: SlaStatus } {
  if (status === "resolved" || status === "closed" || status === "investigation") {
    return { remainingMs: null, slaStatus: "completed" };
  }
  if (!deadlineIso) {
    return { remainingMs: null, slaStatus: "ok" };
  }

  const now = Date.now();
  const deadline = new Date(deadlineIso).getTime();
  const created = new Date(createdAtIso).getTime();

  if (Number.isNaN(deadline)) {
    return { remainingMs: null, slaStatus: "ok" };
  }

  const remainingMs = deadline - now;
  if (remainingMs <= 0) {
    return { remainingMs, slaStatus: "breached" };
  }

  const totalWindow = !Number.isNaN(created) && deadline > created ? deadline - created : 3600_000;
  const ratio = remainingMs / totalWindow;

  if (remainingMs <= 15 * 60_000 || ratio <= 0.15) {
    return { remainingMs, slaStatus: "critical" };
  }
  if (remainingMs <= 45 * 60_000 || ratio <= 0.35) {
    return { remainingMs, slaStatus: "warning" };
  }
  return { remainingMs, slaStatus: "ok" };
}

function buildContentHash(raw: RawIncident): string {
  const payload = [
    raw.product,
    raw.title,
    raw.description,
    raw.priority,
    raw.status,
    raw.assignee_team ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

// --- 4-GROUP CLASSIFICATION ---

export function classifyGroups(
  priority: IncidentPriority,
  status: IncidentStatus,
  assigneeTeam: string
): IncidentGroup[] {
  const groups: IncidentGroup[] = [];
  const isClosed = status === "closed";
  const isResolved = status === "resolved";
  const isInvestigation = status === "investigation";
  const isActive = !isClosed && !isResolved && !isInvestigation;
  const isCoordinatorTeam =
    assigneeTeam.trim().toLowerCase() === COORDINATOR_TEAM_NAME.toLowerCase();

  if (priority === "critical" && isActive) {
    groups.push("CRITICAL");
  }
  if (isCoordinatorTeam && !isClosed && !isResolved) {
    groups.push("ASSIGNED_TO_COORDINATORS");
  }
  if (priority === "high" && isActive) {
    groups.push("HIGH_PRIORITY");
  }
  if (isInvestigation) {
    groups.push("INVESTIGATION");
  }

  return groups;
}

// --- MAIN PARSER ---

export function parseMtsJson(rawData: unknown): NormalizedIncident[] {
  const list = Array.isArray(rawData)
    ? rawData
    : rawData && typeof rawData === "object" && "incidents" in rawData
      ? (rawData as { incidents: unknown[] }).incidents
      : [];

  const result: NormalizedIncident[] = [];

  for (const item of list) {
    const parsed = RawIncidentSchema.safeParse(item);
    if (!parsed.success) continue;

    const raw = parsed.data;
    const priority = mapPriority(raw.priority);
    const status = mapStatus(raw.status);
    const assigneeTeam = raw.assignee_team?.trim() || "Не назначена";
    const createdAt = raw.created_at ?? new Date().toISOString();
    const slaDeadline = raw.sla_deadline ?? null;

    const { remainingMs, slaStatus } = computeSla(createdAt, slaDeadline, status);
    const groups = classifyGroups(priority, status, assigneeTeam);
    const isActive = status !== "resolved" && status !== "closed";
    const isRecentlyResolvedCritical = priority === "critical" && status === "resolved";

    result.push({
      id: raw.id,
      code: raw.id,
      product: raw.product,
      title: raw.title || raw.description.slice(0, 80),
      description: raw.description,
      priority,
      rawPriority: raw.priority,
      status,
      rawStatus: raw.status,
      assigneeTeam,
      createdAt,
      slaDeadline,
      slaRemainingMs: remainingMs,
      slaStatus,
      itsmUrl: raw.itsm_url || `https://itsm.mts.ru/incidents/${encodeURIComponent(raw.id)}`,
      groups,
      isActive,
      isRecentlyResolvedCritical,
      contentHash: buildContentHash(raw),
      ai: null,
    });
  }

  return result;
}

// --- AGGREGATES ---

export function buildDashboardSummary(incidents: NormalizedIncident[]): DashboardSummary {
  let totalActive = 0;
  let criticalCount = 0;
  let assignedToCoordinatorsCount = 0;
  let highPriorityCount = 0;
  let investigationCount = 0;
  let inProgressCount = 0;
  let breachedSlaCount = 0;
  let nearestSlaMs: number | null = null;

  for (const inc of incidents) {
    if (inc.isActive) totalActive++;
    if (inc.groups.includes("CRITICAL") && inc.isActive) criticalCount++;
    if (inc.groups.includes("ASSIGNED_TO_COORDINATORS")) assignedToCoordinatorsCount++;
    if (inc.groups.includes("HIGH_PRIORITY")) highPriorityCount++;
    if (inc.groups.includes("INVESTIGATION")) investigationCount++;
    if (inc.status === "in_progress") inProgressCount++;
    if (inc.slaStatus === "breached") breachedSlaCount++;

    if (inc.isActive && inc.slaRemainingMs !== null && inc.slaRemainingMs > 0) {
      if (nearestSlaMs === null || inc.slaRemainingMs < nearestSlaMs) {
        nearestSlaMs = inc.slaRemainingMs;
      }
    }
  }

  return {
    totalActive,
    criticalCount,
    assignedToCoordinatorsCount,
    highPriorityCount,
    investigationCount,
    inProgressCount,
    breachedSlaCount,
    nearestSlaMs,
  };
}

export function buildActivity24h(incidents: NormalizedIncident[]): ActivityPoint[] {
  const buckets = new Map<string, ActivityPoint>();
  const now = new Date();

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3600_000);
    const key = `${String(d.getHours()).padStart(2, "0")}:00`;
    buckets.set(key, { hour: key, created: 0, resolved: 0, critical: 0 });
  }

  for (const inc of incidents) {
    const created = new Date(inc.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const key = `${String(created.getHours()).padStart(2, "0")}:00`;
    const bucket = buckets.get(key);
    if (!bucket) continue;

    bucket.created++;
    if (inc.priority === "critical") bucket.critical++;
    if (inc.status === "resolved" || inc.status === "closed") bucket.resolved++;
  }

  return Array.from(buckets.values());
}