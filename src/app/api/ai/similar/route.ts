import { NextResponse } from "next/server";
import { z } from "zod";
import {
  findSimilarIncidentCached,
  similarSearchIncidentSchema,
} from "@/lib/ai/similar-search";
import { incidentStore } from "@/lib/mts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  incidentId: z.string().min(1),
  incident: similarSearchIncidentSchema.optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input = requestSchema.safeParse(body);
  if (!input.success) {
    return NextResponse.json(
      { error: "Expected incidentId and an optional valid incident object" },
      { status: 400 },
    );
  }

  const { incidentId } = input.data;
  if (input.data.incident && input.data.incident.id !== incidentId) {
    return NextResponse.json(
      { error: "incidentId must match incident.id" },
      { status: 400 },
    );
  }

  let incident = input.data.incident;
  if (!incident) {
    await incidentStore.ensureInitialized();
    const snapshotIncident = incidentStore
      .getSnapshot()
      .incidents.find((item) => item.id === incidentId || item.code === incidentId);
    if (!snapshotIncident) {
      return NextResponse.json({ error: "incident not found" }, { status: 404 });
    }
    incident = similarSearchIncidentSchema.parse(snapshotIncident);
  }

  const result = await findSimilarIncidentCached(incident);
  return NextResponse.json(result);
}
