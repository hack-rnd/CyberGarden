import { z } from "zod";
import type { NormalizedIncident } from "@/types/incident";

const itsmLink = z.url({ protocol: /^https?$/ });

export const manualProcessFields = z.object({
  product: z.string().trim().min(1).max(120),
  description: z.string().trim().max(3000),
  assigneeTeam: z.string().trim().max(120),
  priority: z.enum(["critical", "high", "medium", "low"]),
  status: z.enum(["new", "in_progress", "waiting", "investigation", "resolved", "closed"]),
  groups: z.array(z.enum(["CRITICAL", "ASSIGNED_TO_COORDINATORS", "HIGH_PRIORITY", "INVESTIGATION"])).max(4),
  slaDeadline: z.iso.datetime().nullable(),
  itsmUrl: z.string().trim().max(2048).pipe(z.union([z.literal(""), itsmLink])).default(""),
});

export const manualProcessInput = manualProcessFields.extend({
  id: z.string().regex(/^PR-[A-F0-9]{8}$/),
  createdAt: z.iso.datetime(),
});

export const manualProcessAnalysis = z.object({
  summary: z.string(),
  recommendedTeam: z.string(),
  riskScore: z.number().min(0).max(100),
  riskLevel: z.enum(["low", "medium", "high"]),
  riskReason: z.string(),
  handoffMessage: z.string(),
  provider: z.string(),
  updatedAt: z.iso.datetime(),
});

export const storedManualProcess = manualProcessInput.extend({
  revision: z.string().optional(),
  ai: manualProcessAnalysis.optional(),
});

export type ManualProcess = z.infer<typeof storedManualProcess>;
export type ProcessFields = z.infer<typeof manualProcessFields>;

export const incidentOverrideFields = manualProcessFields.partial().extend({
  itsmUrl: manualProcessFields.shape.itsmUrl.removeDefault().optional(),
});
export type IncidentOverrides = z.infer<typeof incidentOverrideFields>;

export function applyIncidentOverrides(incident: NormalizedIncident, overrides?: IncidentOverrides): NormalizedIncident {
  if (!overrides) return incident;
  const status = overrides.status ?? incident.status;
  const isActive = status !== "resolved" && status !== "closed" && status !== "investigation";
  return {
    ...incident,
    ...overrides,
    rawPriority: overrides.priority ?? incident.rawPriority,
    rawStatus: overrides.status ?? incident.rawStatus,
    isActive,
  };
}

export function toManualIncident({ ai, revision, ...process }: ManualProcess, now?: number): NormalizedIncident {
  const isActive = process.status !== "resolved" && process.status !== "closed" && process.status !== "investigation";
  const slaRemainingMs = isActive && process.slaDeadline && now !== undefined
    ? Date.parse(process.slaDeadline) - now
    : null;
  return {
    ...process,
    code: process.id,
    title: process.product,
    rawPriority: process.priority,
    rawStatus: process.status,
    slaRemainingMs,
    slaStatus: isActive ? slaRemainingMs !== null && slaRemainingMs <= 0 ? "breached" : "ok" : "completed",
    isActive,
    isRecentlyResolvedCritical: false,
    contentHash: revision ?? "",
    ai: ai ?? null,
  };
}
