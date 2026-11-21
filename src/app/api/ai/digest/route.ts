import { NextResponse } from "next/server";
import { forecastSla } from "@/lib/sla";
import { incidentStore } from "@/lib/mts/store";
import { ensureAiWorker } from "@/lib/ai/worker";
import type { IncidentAiData, NormalizedIncident } from "@/types/incident";

// --- ROUTE CONFIG ---

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- TYPES ---

interface DigestConcern {
  incidentId: string;
  code: string;
  product: string;
  riskScore: number;
  riskLevel: IncidentAiData["riskLevel"];
  summary: string;
  recommendedTeam: string;
  willBreachSla: boolean;
}

interface AiDigest {
  generatedAt: string;
  analyzedCount: number;
  pendingCount: number;
  activeCount: number;
  averageRiskScore: number | null;
  highRiskCount: number;
  breachForecastCount: number;
  handoffsPending: number;
  headline: string;
  topConcerns: DigestConcern[];
}

// --- GET HANDLER ---

export async function GET() {
  ensureAiWorker();
  await incidentStore.ensureInitialized();
  const { incidents } = incidentStore.getSnapshot();

  const active = incidents.filter((inc) => inc.isActive && inc.groups.length > 0);
  const analyzed = active.filter((inc) => inc.ai !== null);
  const pending = active.length - analyzed.length;

  const scores = analyzed.map((inc) => inc.ai?.riskScore ?? 0);
  const averageRiskScore =
    scores.length > 0
      ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
      : null;

  const concerns: DigestConcern[] = analyzed
    .map((inc) => toConcern(inc))
    .filter((c): c is DigestConcern => c !== null)
    .sort((a, b) => b.riskScore - a.riskScore);

  const breachForecastCount = active.filter((inc) =>
    forecastSla({
      createdAtIso: inc.createdAt,
      slaDeadlineIso: inc.slaDeadline,
      status: inc.status,
      assigneeTeam: inc.assigneeTeam,
      isCoordinatorAssigned: inc.groups.includes("ASSIGNED_TO_COORDINATORS"),
    }).willBreach,
  ).length;

  const handoffsPending = active.filter((inc) =>
    inc.groups.includes("ASSIGNED_TO_COORDINATORS"),
  ).length;

  const digest: AiDigest = {
    generatedAt: new Date().toISOString(),
    analyzedCount: analyzed.length,
    pendingCount: pending,
    activeCount: active.length,
    averageRiskScore,
    highRiskCount: concerns.filter((c) => c.riskLevel === "high").length,
    breachForecastCount,
    handoffsPending,
    headline: buildHeadline({
      analyzed: analyzed.length,
      pending,
      highRisk: concerns.filter((c) => c.riskLevel === "high").length,
      breach: breachForecastCount,
      handoffs: handoffsPending,
    }),
    topConcerns: concerns.slice(0, 3),
  };

  return NextResponse.json(digest);
}

// --- HELPERS ---

function toConcern(inc: NormalizedIncident): DigestConcern | null {
  if (!inc.ai) return null;
  const forecast = forecastSla({
    createdAtIso: inc.createdAt,
    slaDeadlineIso: inc.slaDeadline,
    status: inc.status,
    assigneeTeam: inc.assigneeTeam,
    isCoordinatorAssigned: inc.groups.includes("ASSIGNED_TO_COORDINATORS"),
  });
  return {
    incidentId: inc.id,
    code: inc.code,
    product: inc.product,
    riskScore: inc.ai.riskScore,
    riskLevel: inc.ai.riskLevel,
    summary: inc.ai.summary,
    recommendedTeam: inc.ai.recommendedTeam,
    willBreachSla: forecast.willBreach,
  };
}

function buildHeadline(input: {
  analyzed: number;
  pending: number;
  highRisk: number;
  breach: number;
  handoffs: number;
}): string {
  if (input.analyzed === 0 && input.pending === 0) {
    return "Активных инцидентов нет — ландшафт спокоен.";
  }
  const parts: string[] = [];
  if (input.highRisk > 0) parts.push(`высокий риск у ${input.highRisk}`);
  if (input.breach > 0) parts.push(`прогноз срыва SLA у ${input.breach}`);
  if (input.handoffs > 0) parts.push(`ждут передачи ${input.handoffs}`);
  const core =
    parts.length > 0
      ? `Внимание: ${parts.join(", ")}.`
      : "Критических угроз не выявлено.";
  const suffix = input.pending > 0 ? ` Анализируется ещё ${input.pending}.` : "";
  return `${core}${suffix}`;
}
