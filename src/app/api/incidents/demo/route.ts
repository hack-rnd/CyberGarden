import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { COORDINATOR_TEAM_NAME } from "@/lib/mts/adapter";
import {
  PRIORITY_TO_RAW,
  RawIncidentRecord,
  readRawIncidents,
  recordHistoryEntries,
  STATUS_TO_RAW,
  writeRawIncidentsAtomically,
} from "@/lib/mts/mutations";
import { incidentStore } from "@/lib/mts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- VALIDATION ---

const DemoIncidentSchema = z.object({
  product: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).default("critical"),
  status: z
    .enum(["new", "in_progress", "waiting", "investigation", "resolved", "closed"])
    .default("in_progress"),
  groups: z
    .array(
      z.enum([
        "CRITICAL",
        "ASSIGNED_TO_COORDINATORS",
        "HIGH_PRIORITY",
        "INVESTIGATION",
      ])
    )
    .optional(),
  assigneeTeam: z.string().optional(),
  assigneeEmployee: z.string().optional(),
  slaMinutes: z.number().int().min(1).max(10080).optional(),
});

// --- POST HANDLER ---

export async function POST(request: NextRequest) {
  await incidentStore.ensureInitialized();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = DemoIncidentSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const groups = input.groups ?? [];

  let effectivePriority = input.priority;
  if (groups.includes("CRITICAL")) effectivePriority = "critical";
  else if (groups.includes("HIGH_PRIORITY") && effectivePriority !== "critical") {
    effectivePriority = "high";
  }

  let effectiveStatus = input.status;
  if (groups.includes("INVESTIGATION")) {
    effectiveStatus = "investigation";
  }

  const effectiveTeam =
    input.assigneeTeam?.trim() ||
    (groups.includes("ASSIGNED_TO_COORDINATORS")
      ? COORDINATOR_TEAM_NAME
      : "КЦ ИТ OPS Аварии ДС");

  const now = new Date();
  const slaMinutes =
    input.slaMinutes ?? (effectivePriority === "critical" ? 20 : 120);
  const deadlineIso =
    effectiveStatus === "investigation" || effectiveStatus === "closed"
      ? null
      : new Date(now.getTime() + slaMinutes * 60_000).toISOString();

  const suffix = String(Date.now()).slice(-6);
  const id = `INC000099${suffix}`;
  const rawStatus = STATUS_TO_RAW[effectiveStatus];
  const rawPriority = PRIORITY_TO_RAW[effectivePriority];

  const newRecord: RawIncidentRecord = {
    sysId: `99${Date.now()}`,
    id,
    state: rawStatus.state,
    stateEnum: rawStatus.stateEnum,
    stateId: rawStatus.stateId,
    stateReason: "Нет",
    stateReasonId: "1",
    submitDate: now.toISOString(),
    deadline: deadlineIso,
    completionDate:
      effectiveStatus === "resolved" || effectiveStatus === "closed"
        ? now.toISOString()
        : null,
    lastAssignmentToTeamDateTime: now.toISOString(),
    header: input.title,
    description:
      input.description?.trim() ||
      `Демо-инцидент на продукте ${input.product}: ${input.title}`,
    shortDescription: input.title,
    assignedGroupName: effectiveTeam,
    assignedEmployee: input.assigneeEmployee?.trim() || null,
    assignedEmployeeLogin: null,
    initiatorName: "Telegram-бот (demo)",
    initiatorLogin: "tg_demo",
    isEffect: false,
    isReason: false,
    isDouble: false,
    isMaster: effectivePriority === "critical",
    incType: "МИ",
    serviceTypeId: 10,
    serviceType: "Клиентский",
    priorityId: rawPriority.priorityId,
    priority: rawPriority.priority,
    urgencyId: rawPriority.priorityId,
    urgency: rawPriority.priority,
    impactId: rawPriority.priorityId,
    impact: rawPriority.priority,
    waitingExitDate: "0001-01-01T00:00:00",
    isRootIncident: true,
    productName: input.product,
    productUrl: null,
    service: `[${input.product}] Основной узел`,
    isNeedUp: effectivePriority === "critical",
    receivingChannel: "Мониторинг 9го королевства",
    solution: null,
  };

  const container = readRawIncidents();
  container.list.unshift(newRecord);

  incidentStore.suppressExternalHistory(id);
  writeRawIncidentsAtomically(container);
  await incidentStore.reloadFromDisk(true);

  await recordHistoryEntries([
    {
      incidentId: id,
      field: "created",
      oldValue: null,
      newValue: `${input.product} · ${rawPriority.priority} · ${rawStatus.state}`,
      actor: "Telegram-бот",
    },
  ]);

  const createdIncident = incidentStore
    .getSnapshot()
    .incidents.find((item) => item.id === id);

  return NextResponse.json(
    { ok: true, incident: createdIncident ?? null },
    { status: 201 }
  );
}