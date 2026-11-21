"use client";

import { BellRing, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DiffEvent } from "@/types/incident";

import { currentSlaStatus, deadlineFor, isIncidentActive, type DashboardIncident } from "../dashboard/dashboard-model";
import { useIncidentClock } from "../dashboard/incident-views";

const alertTypes = {
  SLA_APPROACHING: {
    label: "Подходит срок SLA",
    tone: [520],
    border: "border-l-[#EB4A13]",
  },
  NEW_CRITICAL: {
    label: "Новый критический инцидент",
    tone: [660, 440],
    border: "border-l-mts-red",
  },
  ASSIGNED_TO_COORDINATORS: {
    label: "Назначен на координаторов",
    tone: [440],
    border: "border-l-mts-blue",
  },
  INVESTIGATION_ASSIGNED: {
    label: "Назначен на координаторов",
    tone: [440],
    border: "border-l-mts-blue",
  },
  CRITICAL_RESOLVED: {
    label: "Критический решён",
    tone: [440, 660],
    border: "border-l-mts-emerald",
  },
} as const;

const visibleForMs = 12_000;

function getAlert(event: DiffEvent) {
  return Object.hasOwn(alertTypes, event.type)
    ? alertTypes[event.type as keyof typeof alertTypes]
    : undefined;
}

function playTone(context: AudioContext, frequencies: readonly number[]) {
  for (const [index, frequency] of frequencies.entries()) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + index * 0.17;

    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.1, start + 0.02);
    gain.gain.linearRampToValueAtTime(0, start + 0.13);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.14);
  }
}

export function DashboardAlerts({
  events,
  incidents,
  onJump,
  onOpen,
}: {
  events?: readonly DiffEvent[];
  incidents: readonly DashboardIncident[];
  onJump: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [soundError, setSoundError] = useState(false);
  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const [desktopStatus, setDesktopStatus] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef(new Set<string>());
  const [slaAlerts, setSlaAlerts] = useState<DiffEvent[]>([]);
  const seenSla = useRef(new Set<string>());
  const now = useIncidentClock(Boolean(events?.length || incidents.length));

  useEffect(() => {
    if (now === null) return;

    const timer = window.setTimeout(() => {
      const fresh: DiffEvent[] = [];

      for (const incident of incidents) {
        if (!isIncidentActive(incident) || seenSla.current.has(incident.id)) continue;
        const remaining = deadlineFor(incident) - now;
        const status = currentSlaStatus(incident, now);

        if (status !== "warning" && status !== "critical" &&
          !(remaining > 0 && remaining < 15 * 60_000)) continue;

        seenSla.current.add(incident.id);
        fresh.push({
          id: "sla:" + incident.id,
          incidentId: incident.id,
          incidentCode: incident.code,
          product: incident.product,
          type: "SLA_APPROACHING",
          message: "Подходит срок SLA: " + incident.id + " · " + incident.product,
          createdAt: new Date(now).toISOString(),
        });
      }

      if (fresh.length) {
        setSlaAlerts((previous) => [...fresh, ...previous.filter(
          (event) => now - Date.parse(event.createdAt) < visibleForMs,
        )]);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [incidents, now]);

  const alertEvents = [
    ...slaAlerts.filter((event) => now !== null && now - Date.parse(event.createdAt) < visibleForMs),
    ...(events ?? []).filter((event) => event.type !== "SLA_APPROACHING"),
  ];

  useEffect(() => () => {
    if (audio.current) void audio.current.close().catch(() => {});
    audio.current = null;
  }, []);

  useEffect(() => {
    const fresh = alertEvents.filter((event) => !seen.current.has(event.id));
    if (!fresh.length) return;

    const ids = new Set([...seen.current, ...fresh.map((event) => event.id)]);
    seen.current = ids;

    const context = audio.current;
    const event = fresh.find(({ type }) => type === "NEW_CRITICAL") ?? fresh.find(getAlert);
    const notification = event && getAlert(event);

    if (enabled && context?.state === "running" && notification) {
      playTone(context, notification.tone);
    }

    if (
      desktopEnabled && event && notification && document.hidden &&
      typeof Notification !== "undefined" && Notification.permission === "granted"
    ) {
      try {
        const desktopAlert = new Notification(notification.label, {
          body: event.message,
          tag: event.id,
        });
        desktopAlert.onclick = () => {
          window.focus();
          if (event.type === "SLA_APPROACHING") onJump(event.incidentId);
          else onOpen(event.incidentId);
          desktopAlert.close();
        };
      } catch {
      }
    }
  });

  async function toggleDesktop() {
    if (desktopEnabled) {
      setDesktopEnabled(false);
      setDesktopStatus("");
      return;
    }

    if (typeof Notification === "undefined") {
      setDesktopStatus("Этот браузер не поддерживает системные уведомления.");
      return;
    }

    try {
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;

      setDesktopEnabled(permission === "granted");
      setDesktopStatus(permission === "granted"
        ? ""
        : "Разреши уведомления для этого сайта в настройках браузера.");
    } catch {
      setDesktopStatus("Браузер не смог включить системные уведомления.");
    }
  }

  async function toggleSound() {
    if (enabled) {
      setEnabled(false);
      await audio.current?.suspend().catch(() => {});
      return;
    }

    try {
      const context = audio.current ?? new AudioContext();
      audio.current = context;
      await context.resume();
      setSoundError(false);
      setEnabled(true);
    } catch {
      setSoundError(true);
    }
  }

  function dismiss(id: string) {
    setDismissed((previous) => [...previous.slice(-49), id]);
  }

  const visible = now === null ? [] : alertEvents.filter((event) => {
    const age = now - Date.parse(event.createdAt);
    return getAlert(event) && age >= -1000 && age < visibleForMs
      && !dismissed.includes(event.id);
  }).slice(0, 3);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Звук оповещений"
        aria-pressed={enabled}
        title={enabled ? "Выключить звук" : "Включить звук"}
        onClick={toggleSound}
        className="size-10 rounded-control aria-pressed:bg-muted"
      >
        {enabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Системные уведомления"
        aria-pressed={desktopEnabled}
        title={desktopEnabled ? "Выключить системные уведомления" : "Включить системные уведомления"}
        onClick={toggleDesktop}
        className="size-10 rounded-control aria-pressed:bg-muted"
      >
        <BellRing aria-hidden="true" />
      </Button>

      {desktopStatus && (
        <p role="status" className="fixed top-16 right-4 left-4 z-40 rounded-panel border bg-card p-2 text-label-sm sm:left-auto">
          {desktopStatus}
        </p>
      )}

      <div className="pointer-events-none fixed top-20 right-4 left-4 z-40 space-y-2 sm:left-auto sm:w-88">
        <div className="sr-only" role="status" aria-live="polite">
          {soundError && "Браузер не разрешил включить звук."}
          {visible.map((event) => <p key={event.id}>{event.message}</p>)}
        </div>

        {visible.map((event) => {
          const alert = getAlert(event);
          if (!alert) return null;

          return (
            <article
              key={event.id}
              className={`pointer-events-auto relative rounded-panel border border-l-4 bg-card p-4 text-card-foreground ${alert.border}`}
            >
              <p className="mb-2 flex min-h-10 items-center pr-12 text-label-md font-semibold">
                {alert.label}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Закрыть уведомление"
                title="Закрыть уведомление"
                className="absolute top-4 right-4 size-10 rounded-control"
                onClick={() => dismiss(event.id)}
              >
                <X aria-hidden="true" className="size-5" />
              </Button>

              <p className="text-label-md wrap-break-word text-muted-foreground">
                {event.message}
              </p>
              <Button
                type="button"
                variant="ghost"
                className="mt-2"
                onClick={() => {
                  if (event.type === "SLA_APPROACHING") onJump(event.incidentId);
                  else onOpen(event.incidentId);
                  dismiss(event.id);
                }}
              >
                Показать инцидент
              </Button>
            </article>
          );
        })}
      </div>
    </>
  );
}
