import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { COORDINATOR_TEAM_NAME } from "@/lib/mts/adapter";
import { PendingHistoryEntry } from "@/lib/mts/diffEngine";
import {
  createMtsLinkMessage,
  PRIORITY_TO_RAW,
  readRawIncidents,
  recordHistoryEntries,
  STATUS_TO_RAW,
  writeRawIncidentsAtomically,
} from "@/lib/mts/mutations";
import { incidentStore } from "@/lib/mts/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- VALIDATION ---

const PatchIncidentSchema = z.object({
  assigneeEmployee: z.string().nullable().optional(),
  assigneeTeam: z.string().optional(),
  status: z
    .enum(["new", "in_progress", "waiting", "investigation", "resolved", "closed"])
    .optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
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
  description: z.string().optional(),
  slaDeadline: z.string().nullable().optional(),
  sendToMtsLink: z.boolean().optional(),
  actor: z.string().min(1).max(80).optional(),
});

// --- PATCH HANDLER ---

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  await incidentStore.ensureInitialized();
  const { id } = await context.params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PatchIncidentSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch = parsed.data;
  const actor = patch.actor ?? "Координатор";
  const container = readRawIncidents();
  const rawItem = container.list.find((item) => String(item.id ?? "") === id);

  if (!rawItem) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  const isClosed =
    rawItem.stateId === 10 ||
    String(rawItem.stateEnum ?? "").toLowerCase() === "closed";

  if (isClosed && patch.status && patch.status !== "closed") {
    return NextResponse.json(
      { error: "Закрытый инцидент нельзя вернуть в работу" },
      { status: 409 }
    );
  }

  const prevSnapshot = incidentStore
    .getSnapshot()
    .incidents.find((item) => item.id === id);

  const historyEntries: PendingHistoryEntry[] = [];
  let assigneeChanged = false;

  if (patch.groups) {
    if (patch.groups.includes("CRITICAL") && !patch.priority) {
      const crit = PRIORITY_TO_RAW.critical;
      rawItem.priority = crit.priority;
      rawItem.priorityId = crit.priorityId;
    } else if (patch.groups.includes("HIGH_PRIORITY") && !patch.priority) {
      const high = PRIORITY_TO_RAW.high;
      rawItem.priority = high.priority;
      rawItem.priorityId = high.priorityId;
    }
    if (patch.groups.includes("INVESTIGATION") && !patch.status) {
      const inv = STATUS_TO_RAW.investigation;
      rawItem.state = inv.state;
      rawItem.stateEnum = inv.stateEnum;
      rawItem.stateId = inv.stateId;
    }
    if (
      patch.groups.includes("ASSIGNED_TO_COORDINATORS") &&
      patch.assigneeTeam === undefined
    ) {
      rawItem.assignedGroupName = COORDINATOR_TEAM_NAME;
    }

    const prevGroups = prevSnapshot ? [...prevSnapshot.groups].sort().join(", ") : "";
    const nextGroups = [...patch.groups].sort().join(", ");
    if (prevGroups !== nextGroups) {
      historyEntries.push({
        incidentId: id,
        field: "groups",
        oldValue: prevGroups || "Нет",
        newValue: nextGroups || "Нет",
        actor,
      });
    }
  }

  if (patch.status !== undefined) {
    const nextRawStatus = STATUS_TO_RAW[patch.status];
    const prevRawStatus = String(rawItem.state ?? prevSnapshot?.rawStatus ?? "");
    rawItem.state = nextRawStatus.state;
    rawItem.stateEnum = nextRawStatus.stateEnum;
    rawItem.stateId = nextRawStatus.stateId;

    if (patch.status === "resolved") {
      rawItem.completionDate = new Date().toISOString();
    } else if (patch.status !== "closed" && patch.status !== "investigation") {
      rawItem.completionDate = null;
    }

    if (prevRawStatus !== nextRawStatus.state) {
      historyEntries.push({
        incidentId: id,
        field: "status",
        oldValue: prevRawStatus || null,
        newValue: nextRawStatus.state,
        actor,
      });
    }
  }

  if (patch.priority !== undefined) {
    const nextRawPriority = PRIORITY_TO_RAW[patch.priority];
    const prevRawPriority = String(
      rawItem.priority ?? prevSnapshot?.rawPriority ?? ""
    );
    rawItem.priority = nextRawPriority.priority;
    rawItem.priorityId = nextRawPriority.priorityId;

    if (prevRawPriority !== nextRawPriority.priority) {
      historyEntries.push({
        incidentId: id,
        field: "priority",
        oldValue: prevRawPriority || null,
        newValue: nextRawPriority.priority,
        actor,
      });
    }
  }

  const prevTeam = String(rawItem.assignedGroupName ?? "");
  const prevEmployee = String(rawItem.assignedEmployee ?? "");

  if (patch.assigneeTeam !== undefined) {
    rawItem.assignedGroupName = patch.assigneeTeam.trim();
    rawItem.lastAssignmentToTeamDateTime = new Date().toISOString();
  }

  if (patch.assigneeEmployee !== undefined) {
    rawItem.assignedEmployee = patch.assigneeEmployee?.trim() || null;
    if ((patch.assigneeEmployee?.trim() || "") !== prevEmployee) {
      assigneeChanged = true;
    }
  }

  const nextTeam = String(rawItem.assignedGroupName ?? "");
  const nextEmployee = String(rawItem.assignedEmployee ?? "");

  if (prevTeam !== nextTeam || prevEmployee !== nextEmployee) {
    const oldLabel = prevEmployee ? `${prevEmployee} (${prevTeam})` : prevTeam;
    const newLabel = nextEmployee ? `${nextEmployee} (${nextTeam})` : nextTeam;
    historyEntries.push({
      incidentId: id,
      field: "assignee",
      oldValue: oldLabel || "Не назначен",
      newValue: newLabel || "Не назначен",
      actor,
    });
  }

  if (patch.description !== undefined) {
    rawItem.description = patch.description;
  }

  if (patch.slaDeadline !== undefined) {
    const prevDeadline =
      typeof rawItem.deadline === "string" ? rawItem.deadline : null;
    rawItem.deadline = patch.slaDeadline;
    if (prevDeadline !== patch.slaDeadline) {
      historyEntries.push({
        incidentId: id,
        field: "sla",
        oldValue: prevDeadline ?? "Не задан",
        newValue: patch.slaDeadline ?? "Не задан",
        actor,
      });
    }
  }

  incidentStore.suppressExternalHistory(id);
  writeRawIncidentsAtomically(container);
  await incidentStore.reloadFromDisk(true);

  const updatedIncident = incidentStore
    .getSnapshot()
    .incidents.find((item) => item.id === id);

  const shouldSendMtsLink = Boolean(
    patch.sendToMtsLink || (assigneeChanged && nextEmployee.length > 0)
  );

  let recipient: string | undefined;

  if (shouldSendMtsLink && updatedIncident) {
    recipient =
      updatedIncident.assigneeEmployee ||
      updatedIncident.assigneeTeam ||
      "Ответственный исполнитель";

    await createMtsLinkMessage({
      incidentId: updatedIncident.id,
      recipientName: recipient,
      recipientTeam: updatedIncident.assigneeTeam,
      messageType: "ASSIGNED",
      title: `Назначен инцидент ${updatedIncident.code} (${updatedIncident.product})`,
      payload: {
        incidentId: updatedIncident.id,
        product: updatedIncident.product,
        title: updatedIncident.title,
        description: updatedIncident.description,
        priority: updatedIncident.rawPriority,
        status: updatedIncident.rawStatus,
        slaDeadline: updatedIncident.slaDeadline,
        assigneeEmployee: updatedIncident.assigneeEmployee ?? null,
        assigneeTeam: updatedIncident.assigneeTeam,
        groups: updatedIncident.groups,
        sentBy: actor,
      },
    });

    historyEntries.push({
      incidentId: id,
      field: "mts_link_sent",
      oldValue: null,
      newValue: `Данные отправлены в МТС Link: ${recipient}`,
      actor,
    });

    await incidentStore.emitCustomEvent({
      id: crypto.randomUUID(),
      incidentId: updatedIncident.id,
      incidentCode: updatedIncident.code,
      product: updatedIncident.product,
      type: "MTS_LINK_SENT",
      message: `Данные по ${updatedIncident.code} отправлены ответственному ${recipient} в МТС Link`,
      createdAt: new Date().toISOString(),
    });
  }

  if (historyEntries.length > 0) {
    await recordHistoryEntries(historyEntries);
  }

  return NextResponse.json({
    ok: true,
    incident: updatedIncident ?? null,
    mtsLinkSent: shouldSendMtsLink,
    recipient,
  });
}