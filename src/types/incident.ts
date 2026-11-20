// --- ENUMS & GROUPS ---

export type IncidentGroup =
  | "CRITICAL"
  | "ASSIGNED_TO_COORDINATORS"
  | "HIGH_PRIORITY"
  | "INVESTIGATION";

export type IncidentPriority = "critical" | "high" | "medium" | "low";

export type IncidentStatus =
  | "new"
  | "in_progress"
  | "waiting"
  | "investigation"
  | "resolved"
  | "closed";

export type SlaStatus = "ok" | "warning" | "critical" | "breached" | "completed";

export type DiffEventType =
  | "NEW_CRITICAL"
  | "CRITICAL_RESOLVED"
  | "ASSIGNED_TO_COORDINATORS"
  | "REASSIGNED_OUT"
  | "SLA_OR_PRIORITY_CHANGED"
  | "INVESTIGATION_ASSIGNED";

// --- AI PAYLOAD ---

export interface IncidentAiData {
  summary: string;
  recommendedTeam: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  riskReason: string;
  handoffMessage: string;
  provider: string;
  updatedAt: string;
}

// --- NORMALIZED INCIDENT ---

export interface NormalizedIncident {
  id: string;
  code: string;
  product: string;
  title: string;
  description: string;
  priority: IncidentPriority;
  rawPriority: string;
  status: IncidentStatus;
  rawStatus: string;
  assigneeTeam: string;
  createdAt: string;
  slaDeadline: string | null;
  slaRemainingMs: number | null;
  slaStatus: SlaStatus;
  itsmUrl: string;
  groups: IncidentGroup[];
  isActive: boolean;
  isRecentlyResolvedCritical: boolean;
  contentHash: string;
  ai: IncidentAiData | null;
}

// --- DASHBOARD AGGREGATES ---

export interface DashboardSummary {
  totalActive: number;
  criticalCount: number;
  assignedToCoordinatorsCount: number;
  highPriorityCount: number;
  investigationCount: number;
  inProgressCount: number;
  breachedSlaCount: number;
  nearestSlaMs: number | null;
}

export interface ActivityPoint {
  hour: string;
  created: number;
  resolved: number;
  critical: number;
}

export interface DiffEvent {
  id: string;
  incidentId: string;
  incidentCode: string;
  product: string;
  type: DiffEventType;
  message: string;
  createdAt: string;
}

export interface IncidentsApiResponse {
  incidents: NormalizedIncident[];
  summary: DashboardSummary;
  activity: ActivityPoint[];
  lastUpdatedAt: string;
  fileStatus: "ok" | "parse_error" | "missing";
  fileError?: string;
}