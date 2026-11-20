import type {
  IncidentPriority,
  IncidentStatus,
  NormalizedIncident,
} from "@/types/incident";

type DashboardStatus = IncidentStatus | "open";

export interface Incident {
  id: string;
  service: string;
  description: string;
  assignedTeam?: string;
  status: DashboardStatus;
  severity?: IncidentPriority;
  createdAt?: string;
  title?: string;
  updatedAt?: string;
  region?: string;
  affectedUsers?: number;
  metrics?: Record<string, number | string>;
}

export interface IncidentAiAnalysis {
  summary: string;
  targetTeam: string | null;
  rootCause: string | null;
  actionPlan: string[];
}

export interface IncidentTimelineEvent {
  id: string;
  incidentId: string;
  eventType: string;
  title: string;
  details?: string | null;
  createdAt: string;
}

export function isIncidentActive({ status }: Pick<Incident, "status">) {
  return status !== "resolved" && status !== "closed" && status !== "investigation";
}

export function toDashboardIncident(incident: NormalizedIncident) {
  const ai = incident.ai;

  return {
    id: incident.id,
    service: incident.product,
    title: incident.title,
    description: incident.description,
    assignedTeam: incident.assigneeTeam,
    status: incident.status,
    severity: incident.priority,
    groups: incident.groups,
    createdAt: incident.createdAt,
    slaDeadline: incident.slaDeadline ?? undefined,
    slaStatus: incident.slaStatus,
    itsmUrl: incident.itsmUrl,
    hasEscalationRisk: ai ? ai.riskLevel === "high" : undefined,
    riskScore: ai?.riskScore,
    analysis: ai ? {
      summary: ai.summary,
      recommendedTeam: ai.recommendedTeam,
      riskScore: ai.riskScore,
      riskReason: ai.riskReason,
      handoffText: ai.handoffMessage,
    } : undefined,
  };
}