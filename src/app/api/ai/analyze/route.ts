import { NextResponse } from "next/server";
import { analyzeIncidentSafe } from "@/lib/ai/incident-analysis";
import { analyzeIncidentById, ensureAiWorker, processAiQueue } from "@/lib/ai/worker";
import { manualProcessInput, toManualIncident } from "@/lib/manual-process";

// --- ROUTE CONFIG ---

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- POST HANDLER ---

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { incidentId?: unknown; manualProcess?: unknown } | null;
  try {
    if (body && Object.hasOwn(body, "manualProcess")) {
      const result = manualProcessInput.safeParse(body.manualProcess);
      if (!result.success) {
        return NextResponse.json({ error: "invalid manual process" }, { status: 400 });
      }
      const incident = toManualIncident(result.data, Date.now());
      const ai = await analyzeIncidentSafe(incident);
      return NextResponse.json({ incidentId: incident.id, ai });
    }

    ensureAiWorker();
    const incidentId = typeof body?.incidentId === "string" ? body.incidentId : undefined;
    if (incidentId) {
      const ai = await analyzeIncidentById(incidentId);
      if (!ai) {
        return NextResponse.json({ error: "incident not found" }, { status: 404 });
      }
      return NextResponse.json({ incidentId, ai });
    }

    const processed = await processAiQueue();
    return NextResponse.json({ processed });
  } catch {
    return NextResponse.json({ error: "analysis failed" }, { status: 500 });
  }
}
