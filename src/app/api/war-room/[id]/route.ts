import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { incidentStore } from "@/lib/mts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostNoteSchema = z.object({
  author: z.string().trim().min(1).max(80),
  role: z.string().trim().min(1).max(60).optional().default("Инженер смены"),
  text: z.string().trim().min(1).max(1500),
});

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  await incidentStore.ensureInitialized();
  const { id } = await context.params;

  const incident = incidentStore
    .getSnapshot()
    .incidents.find((item) => item.id === id);

  if (!incident) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  const [messages, history] = await Promise.all([
    prisma.mtsLinkMessage.findMany({
      where: { incidentId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.incidentHistory.findMany({
      where: { incidentId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  let warRoomCreated = false;
  let warRoomId: string | null = null;
  let warRoomCreatedAt: string | null = null;
  const teamSet = new Set<string>();

  if (incident.assigneeTeam && incident.assigneeTeam !== "Не назначена") {
    teamSet.add(incident.assigneeTeam);
  }

  for (const msg of messages) {
    if (msg.recipientTeam && msg.recipientTeam !== "Не назначена") {
      teamSet.add(msg.recipientTeam);
    }
    const payload = parsePayload(msg.payloadJson);
    if (payload.warRoomCreated === true) {
      warRoomCreated = true;
      if (!warRoomId && typeof payload.warRoomId === "string") {
        warRoomId = payload.warRoomId;
      }
      if (!warRoomCreatedAt && typeof payload.warRoomCreatedAt === "string") {
        warRoomCreatedAt = payload.warRoomCreatedAt;
      }
    }
    if (Array.isArray(payload.coAssigneeTeams)) {
      for (const team of payload.coAssigneeTeams) {
        if (typeof team === "string" && team.trim()) {
          teamSet.add(team.trim());
        }
      }
    }
  }

  const notes = history
    .filter((entry) => entry.oldValue === "War Room")
    .map((entry) => ({
      id: entry.id,
      actor: entry.actor,
      text: entry.newValue,
      createdAt: entry.createdAt.toISOString(),
    }));

  return NextResponse.json({
    incident,
    warRoom: {
      created: warRoomCreated,
      id: warRoomId ?? `WR-${incident.code}`,
      createdAt: warRoomCreatedAt ?? incident.createdAt,
      teams: Array.from(teamSet),
    },
    notes,
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  await incidentStore.ensureInitialized();
  const { id } = await context.params;

  const incident = incidentStore
    .getSnapshot()
    .incidents.find((item) => item.id === id);

  if (!incident) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PostNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const { author, role, text } = parsed.data;
  const created = await prisma.incidentHistory.create({
    data: {
      incidentId: id,
      field: "mts_link_sent",
      oldValue: "War Room",
      newValue: text,
      actor: `${author} (${role})`,
    },
  });

  return NextResponse.json({
    ok: true,
    note: {
      id: created.id,
      actor: created.actor,
      text: created.newValue,
      createdAt: created.createdAt.toISOString(),
    },
  });
}