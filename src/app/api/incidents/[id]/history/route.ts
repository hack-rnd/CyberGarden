import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IncidentHistoryItem } from "@/types/incident";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- GET HISTORY ---

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const rows = await prisma.incidentHistory.findMany({
    where: { incidentId: id },
    orderBy: { createdAt: "desc" },
  });

  const history: IncidentHistoryItem[] = rows.map((row) => ({
    id: row.id,
    incidentId: row.incidentId,
    field: row.field,
    oldValue: row.oldValue,
    newValue: row.newValue,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  }));

  return NextResponse.json({ history });
}