import { NextResponse } from "next/server";
import {
  getIncidentById,
  saveAiAnalysis,
  type SaveAiPayload,
} from "@/lib/mts/aiBridge";
import { analyzeIncidentSafe } from "@/lib/ai/incident-analysis";
import { detectRelated } from "@/lib/ai/related";
import { incidentStore } from "@/lib/mts/store";
import type { IncidentAiData } from "@/types/incident";

// --- ROUTE CONFIG ---

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- POST HANDLER ---

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const incident = await getIncidentById(id);
    if (!incident) {
      return NextResponse.json({ error: "incident not found" }, { status: 404 });
    }

    const ai = await analyzeIncidentSafe(incident);
    await saveAiAnalysis(incident.id, incident.contentHash, toPayload(ai));

    await incidentStore.ensureInitialized();
    const { incidents } = incidentStore.getSnapshot();
    const related = detectRelated(incident, incidents);

    return NextResponse.json({ ai, related });
  } catch {
    return NextResponse.json({ error: "analysis failed" }, { status: 500 });
  }
}

// --- HELPERS ---

function toPayload(data: IncidentAiData): SaveAiPayload {
  return {
    summary: data.summary,
    recommendedTeam: data.recommendedTeam,
    riskScore: data.riskScore,
    riskLevel: data.riskLevel,
    riskReason: data.riskReason,
    handoffMessage: data.handoffMessage,
    provider: data.provider,
  };
}
