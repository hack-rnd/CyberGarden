"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { useLiveIncidents } from "@/hooks/useLiveIncidents";
import type { DiffEvent } from "@/types/incident";

import { DashboardWorkspace } from "./dashboard-workspace";
import { isIncidentActive, toDashboardIncident } from "./dashboard-model";

const eventQueryKey = ["incident-events"] as const;

async function readEvents(): Promise<DiffEvent[]> {
  const response = await fetch("/api/events", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить события");
  const { events }: { events: DiffEvent[] } = await response.json();
  return events;
}

export function LiveDashboard() {
  const queryClient = useQueryClient();
  const { data, isError, connectionState, recentEvents } = useLiveIncidents();

  const { data: history } = useQuery({
    queryKey: eventQueryKey,
    queryFn: readEvents,
    refetchInterval: connectionState === "connected" ? false : 5000,
  });

  useEffect(() => {
    if (connectionState === "connected") {
      void queryClient.invalidateQueries({ queryKey: eventQueryKey });
    }
  }, [connectionState, queryClient]);

  const events = useMemo(() => {
    if (!history && recentEvents.length === 0) return undefined;

    const byId = new Map((history ?? []).map((event) => [event.id, event]));
    for (const event of recentEvents) byId.set(event.id, event);

    return [...byId.values()]
      .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
      .map((event) => ({
        id: event.id,
        incidentId: event.incidentId,
        eventType: event.type,
        title: event.message,
        details: event.product,
        createdAt: event.createdAt,
      }));
  }, [history, recentEvents]);

  const incidents = useMemo(
    () => data?.incidents.map(toDashboardIncident),
    [data?.incidents],
  );
  const newIncidentIds = recentEvents
    .filter((event) => ["NEW_CRITICAL", "ASSIGNED_TO_COORDINATORS", "INVESTIGATION_ASSIGNED"].includes(event.type))
    .map((event) => event.incidentId);

  const recommendations = useMemo(
    () => incidents
      ?.filter((incident) => isIncidentActive(incident) && Boolean(incident.analysis?.summary))
      .sort((first, second) => (second.riskScore ?? 0) - (first.riskScore ?? 0))
      .slice(0, 3)
      .map((incident) => `${incident.service} — ${incident.analysis?.summary}`),
    [incidents],
  );

  const connection = data && data.fileStatus !== "ok" ? "file-error"
    : connectionState === "connected" && data ? "live"
    : isError || connectionState === "reconnecting" ? "disconnected"
    : "pending";

  return (
    <DashboardWorkspace
      incidents={incidents}
      events={events}
      liveEvents={recentEvents}
      newIncidentIds={newIncidentIds}
      recommendations={recommendations?.length ? recommendations : undefined}
      connection={connection}
    />
  );
}