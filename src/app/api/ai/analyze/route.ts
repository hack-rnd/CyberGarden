import { NextResponse } from "next/server";
import { analyzeIncidentById, ensureAiWorker, processAiQueue } from "@/lib/ai/worker";

// --- ROUTE CONFIG ---

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- POST HANDLER ---

export async function POST(request: Request) {
  ensureAiWorker();

  let incidentId: string | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { incidentId?: unknown };
    if (typeof body.incidentId === "string" && body.incidentId.length > 0) {
      incidentId = body.incidentId;
    }
  } catch {
    incidentId = undefined;
  }

  try {
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
