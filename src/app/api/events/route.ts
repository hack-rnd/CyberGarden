import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DiffEvent, DiffEventType } from "@/types/incident";

// --- ROUTE CONFIG ---

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- GET HANDLER ---

export async function GET() {
  try {
    const rows = await prisma.changeEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const events: DiffEvent[] = rows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      incidentCode: row.incidentCode,
      product: row.product,
      type: row.type as DiffEventType,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ events: [] });
  }
}