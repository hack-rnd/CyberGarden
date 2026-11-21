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
  | "INVESTIGATION_ASSIGNED"
  | "MTS_LINK_SENT"
  | "INCIDENT_AUTO_CLOSED"
  | "SLA_APPROACHING";

export type IncidentHistoryField =
  | "assignee"
  | "status"
  | "sla"
  | "priority"
  | "groups"
  | "created"
  | "auto_closed"
  | "mts_link_sent";

export type MtsLinkMessageType = "ASSIGNED" | "AUTO_CLOSED";

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
  assigneeEmployee?: string | null;
  createdAt: string;
  slaDeadline: string | null;
  slaRemainingMs: number | null;
  slaStatus: SlaStatus;
  itsmUrl: string;
  groups: IncidentGroup[];
  isActive: boolean;
  isRecentlyResolvedCritical: boolean;
  serviceType?: string | null;
  receivingChannel?: string | null;
  isNeedUp?: boolean;
  isMaster?: boolean;
  isEffect?: boolean;
  isDouble?: boolean;
  contentHash: string;
  ai: IncidentAiData | null;
}

// --- HISTORY & MTS LINK ---

export interface IncidentHistoryItem {
  id: string;
  incidentId: string;
  field: string;
  oldValue: string | null;
  newValue: string;
  actor: string;
  createdAt: string;
}

export interface MtsLinkMessageItem {
  id: string;
  incidentId: string;
  recipientName: string;
  recipientTeam: string;
  messageType: MtsLinkMessageType;
  title: string;
  payload: Record<string, unknown>;
  createdAt: string;
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