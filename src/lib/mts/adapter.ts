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
    sysId: z.string().optional(),
    id: z.union([z.string(), z.number()]).transform(String),
    productName: z.string().optional(),
    product: z.string().optional(),
    service: z.string().nullable().optional(),
    serviceType: z.string().nullable().optional(),
    receivingChannel: z.string().nullable().optional(),
    isNeedUp: z.union([z.boolean(), z.string()]).nullable().optional(),
    isMaster: z.boolean().nullable().optional(),
    isEffect: z.boolean().nullable().optional(),
    isDouble: z.boolean().nullable().optional(),
    header: z.string().optional(),
    title: z.string().optional(),
    shortDescription: z.string().optional(),
    description: z.string().optional().default(""),
    priorityId: z.number().optional(),
    priority: z.string().optional().default("Средний"),
    stateId: z.number().optional(),
    stateEnum: z.string().optional(),
    state: z.string().optional(),
    status: z.string().optional(),
    assignedGroupName: z.string().nullable().optional(),
    assignee_team: z.string().nullable().optional(),
    assignedEmployee: z.string().nullable().optional(),
    assignee_employee: z.string().nullable().optional(),
    submitDate: z.string().optional(),
    created_at: z.string().optional(),
    deadline: z.string().nullable().optional(),
    sla_deadline: z.string().nullable().optional(),
    completionDate: z.string().nullable().optional(),
    productUrl: z.string().nullable().optional(),
    itsm_url: z.string().optional(),
  })
  .passthrough();

// --- NORMALIZATION HELPERS ---

function parseBooleanFlag(value: boolean | string | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "да" || normalized === "true" || normalized === "1";
  }
  return false;
}

function mapPriority(
  priorityId: number | undefined,
  raw: string
): IncidentPriority {
  if (priorityId === 4) return "critical";
  if (priorityId === 3) return "high";
  if (priorityId === 2) return "medium";
  if (priorityId === 1) return "low";

  const val = raw.toLowerCase();
  if (
    val.includes("наивысш") ||
    val.includes("крит") ||
    val === "4" ||
    val === "p1" ||
    val === "critical"
  ) {
    return "critical";
  }
  if (val.includes("высок") || val === "3" || val === "p2" || val === "high") {
    return "high";
  }
  if (val.includes("низк") || val === "1" || val === "p4" || val === "low") {
    return "low";
  }
  return "medium";
}

function mapStatus(
  stateId: number | undefined,
  stateEnum: string | undefined,
  raw: string
): IncidentStatus {
  if (stateId === 20) return "investigation";
  if (stateId === 10) return "closed";
  if (stateId === 7) return "resolved";
  if (stateId === 2) return "in_progress";
  if (stateId === 0) return "waiting";

  const enumVal = (stateEnum ?? "").toLowerCase();
  if (enumVal === "research") return "investigation";
  if (enumVal === "closed") return "closed";
  if (enumVal === "resolved") return "resolved";
  if (enumVal === "workinprogress") return "in_progress";
  if (enumVal === "assigned") return "waiting";

  const val = raw.toLowerCase();
  if (
    val.includes("исследован") ||
    val.includes("разбор") ||
    val.includes("rca")
  ) {
    return "investigation";
  }
  if (val.includes("закрыт") || val.includes("closed")) {
    return "closed";
  }
  if (
    val.includes("завершен") ||
    val.includes("реш") ||
    val.includes("resolved")
  ) {
    return "resolved";
  }
  if (val.includes("выполня") || val.includes("в работе")) {
    return "in_progress";
  }
  if (val.includes("назнач") || val.includes("ожида")) {
    return "waiting";
  }
  return "in_progress";
}

function computeSla(
  createdAtIso: string,
  deadlineIso: string | null,
  status: IncidentStatus
): { remainingMs: number | null; slaStatus: SlaStatus } {
  if (
    status === "resolved" ||
    status === "closed" ||
    status === "investigation"
  ) {
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

  const totalWindow =
    !Number.isNaN(created) && deadline > created ? deadline - created : 3600_000;
  const ratio = remainingMs / totalWindow;

  if (remainingMs <= 15 * 60_000 || ratio <= 0.15) {
    return { remainingMs, slaStatus: "critical" };
  }
  if (remainingMs <= 45 * 60_000 || ratio <= 0.35) {
    return { remainingMs, slaStatus: "warning" };
  }
  return { remainingMs, slaStatus: "ok" };
}

function buildContentHash(
  product: string,
  title: string,
  description: string,
  priority: string,
  status: string,
  assigneeTeam: string
): string {
  const payload = [
    product,
    title,
    description,
    priority,
    status,
    assigneeTeam,
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
  const isActiveWork = !isClosed && !isResolved && !isInvestigation;
  const isCoordinatorTeam =
    assigneeTeam.trim().toLowerCase() === COORDINATOR_TEAM_NAME.toLowerCase();

  if (priority === "critical" && isActiveWork) {
    groups.push("CRITICAL");
  }
  if (isCoordinatorTeam && !isClosed && !isResolved) {
    groups.push("ASSIGNED_TO_COORDINATORS");
  }
  if (priority === "high" && isActiveWork) {
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
    const rawStatus = raw.state ?? raw.status ?? "Выполняется";
    const priority = mapPriority(raw.priorityId, raw.priority);
    const status = mapStatus(raw.stateId, raw.stateEnum, rawStatus);
    const product = raw.productName ?? raw.product ?? "Не указан";
    const title =
      raw.header ??
      raw.title ??
      raw.shortDescription ??
      raw.description.slice(0, 80);
    const assigneeTeam =
      (raw.assignedGroupName ?? raw.assignee_team ?? "").trim() ||
      "Не назначена";
    const assigneeEmployee =
      (raw.assignedEmployee ?? raw.assignee_employee ?? "").trim() || null;
    const createdAt =
      raw.submitDate ?? raw.created_at ?? new Date().toISOString();
    const slaDeadline = raw.deadline ?? raw.sla_deadline ?? null;

    const { remainingMs, slaStatus } = computeSla(
      createdAt,
      slaDeadline,
      status
    );
    const groups = classifyGroups(priority, status, assigneeTeam);
    const isActive = status !== "resolved" && status !== "closed";
    const isRecentlyResolvedCritical =
      priority === "critical" && status === "resolved";
    const itsmTarget = raw.sysId || raw.id;
    const itsmUrl =
      raw.itsm_url ||
      raw.productUrl ||
      `https://simpleone.mts.ru/record/itsm_incident/${encodeURIComponent(itsmTarget)}`;

    result.push({
      id: raw.id,
      code: raw.id,
      product,
      title,
      description: raw.description,
      priority,
      rawPriority: raw.priority,
      status,
      rawStatus,
      assigneeTeam,
      assigneeEmployee,
      createdAt,
      slaDeadline,
      slaRemainingMs: remainingMs,
      slaStatus,
      itsmUrl,
      groups,
      isActive,
      isRecentlyResolvedCritical,
      serviceType: raw.serviceType?.trim() || null,
      receivingChannel: raw.receivingChannel?.trim() || null,
      isNeedUp: parseBooleanFlag(raw.isNeedUp),
      isMaster: Boolean(raw.isMaster),
      isEffect: Boolean(raw.isEffect),
      isDouble: Boolean(raw.isDouble),
      contentHash: buildContentHash(
        product,
        title,
        raw.description,
        raw.priority,
        rawStatus,
        assigneeTeam
      ),
      ai: null,
    });
  }

  return result;
}

// --- AGGREGATES ---

export function buildDashboardSummary(
  incidents: NormalizedIncident[]
): DashboardSummary {
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
    if (inc.groups.includes("CRITICAL")) criticalCount++;
    if (inc.groups.includes("ASSIGNED_TO_COORDINATORS")) {
      assignedToCoordinatorsCount++;
    }
    if (inc.groups.includes("HIGH_PRIORITY")) highPriorityCount++;
    if (inc.groups.includes("INVESTIGATION")) investigationCount++;
    if (inc.status === "in_progress") inProgressCount++;
    if (inc.isActive && inc.slaDeadline && inc.slaStatus === "breached") {
      breachedSlaCount++;
    }

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

export function buildActivity24h(
  incidents: NormalizedIncident[]
): ActivityPoint[] {
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
    if (inc.status === "resolved" || inc.status === "closed") {
      bucket.resolved++;
    }
  }

  return Array.from(buckets.values());
}