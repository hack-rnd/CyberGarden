export type IncidentSeverity = "critical" | "high" | "medium" | "low";

export type IncidentStatus = "open" | "in_progress" | "resolved";

export interface Incident {
  id: string;
  title: string;
  description: string;
  service: string;
  region?: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  affectedUsers?: number;
  assignedTeam?: string;
  createdAt: string;
  updatedAt: string;
  metrics?: Record<string, number | string>;
}

export interface IncidentAiAnalysis {
  incidentId: string;
  summary: string;
  rootCause: string | null;
  actionPlan: string[];
  targetTeam: string | null;
  provider: string;
  cached: boolean;
}

export interface IncidentTimelineEvent {
  id: number;
  incidentId: string;
  eventType: string;
  title: string;
  details: string | null;
  priority: string | null;
  assignedTeam: string | null;
  isNotified: boolean;
  createdAt: string;
}
