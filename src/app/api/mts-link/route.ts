import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MtsLinkMessageItem, MtsLinkMessageType } from "@/types/incident";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- HELPERS ---

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function normalizeMessageType(val: string): MtsLinkMessageType {
  return val === "AUTO_CLOSED" ? "AUTO_CLOSED" : "ASSIGNED";
}

// --- GET MESSAGES ---

export async function GET() {
  const rows = await prisma.mtsLinkMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const messages: MtsLinkMessageItem[] = rows.map((row) => ({
    id: row.id,
    incidentId: row.incidentId,
    recipientName: row.recipientName,
    recipientTeam: row.recipientTeam,
    messageType: normalizeMessageType(row.messageType),
    title: row.title,
    payload: parsePayload(row.payloadJson),
    createdAt: row.createdAt.toISOString(),
  }));

  return NextResponse.json({ messages });
}