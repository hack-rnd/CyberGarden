"use client";

import { ChevronDown } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { isIncidentActive, type IncidentTimelineEvent } from "./dashboard-model";
import type { DashboardIncident } from "./incident-views";

const minute = 60_000;
const hour = 60 * minute;

const hourFormat = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

const tooltipFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

type AnalyticsProps = {
  incidents?: readonly DashboardIncident[];
  events?: readonly IncidentTimelineEvent[];
};

function summarizeActivity({ incidents, events }: AnalyticsProps, end: number) {
  const start = end - 24 * hour;
  const buckets = Array.from({ length: 24 }, (_, index) => ({
    start: start + index * hour,
    created: 0,
    resolved: 0,
  }));

  function add(timestamp: string | undefined, series: "created" | "resolved") {
    const time = Date.parse(timestamp ?? "");
    if (!Number.isFinite(time) || time < start || time > end) return;

    const index = Math.min(Math.floor((time - start) / hour), buckets.length - 1);
    buckets[index][series]++;
  }

  for (const incident of incidents ?? []) {
    add(incident.createdAt, "created");
  }

  const countedEvents = new Set<string>();

  for (const event of events ?? []) {
    if (event.eventType !== "CRITICAL_RESOLVED" || countedEvents.has(event.id)) {
      continue;
    }

    countedEvents.add(event.id);
    add(event.createdAt, "resolved");
  }

  let trackedSla = 0;
  let overdueSla = 0;

  for (const incident of incidents ?? []) {
    if (!isIncidentActive(incident)) continue;

    const deadline = Date.parse(incident.slaDeadline ?? "");
    const hasDeadline = Number.isFinite(deadline);

    if (hasDeadline || incident.slaStatus) trackedSla++;

    if ((hasDeadline && deadline <= end) || incident.slaStatus === "breached") {
      overdueSla++;
    }
  }

  return { buckets, trackedSla, overdueSla };
}

function ActivityChart({ incidents, events }: AnalyticsProps) {
  const [end, setEnd] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setEnd(Date.now()), minute);
    return () => window.clearInterval(timer);
  }, []);

  const activity = useMemo(
    () => summarizeActivity({ incidents, events }, end),
    [incidents, events, end],
  );

  const showCreated =
    incidents?.length === 0 ||
    incidents?.some((incident) =>
      Number.isFinite(Date.parse(incident.createdAt ?? "")),
    );
  const showResolved = events !== undefined;

  const totalCreated = activity.buckets.reduce(
    (total, bucket) => total + bucket.created,
    0,
  );
  const totalResolved = activity.buckets.reduce(
    (total, bucket) => total + bucket.resolved,
    0,
  );

  return (
    <div className="space-y-4 px-4 pb-6 sm:px-6">
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-label-md">
        {showCreated && (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 rounded-full bg-mts-blue" />
            Создано: <strong>{totalCreated}</strong>
          </li>
        )}
        {showResolved && (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-2 rounded-full bg-mts-emerald" />
            Критических решено: <strong>{totalResolved}</strong>
          </li>
        )}
        {activity.trackedSla > 0 && (
          <li>
            Просрочено SLA сейчас:{" "}
            <strong>{activity.overdueSla} из {activity.trackedSla}</strong>
          </li>
        )}
      </ul>

      {showCreated || showResolved ? (
        <div className="h-60 min-w-0 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={activity.buckets}
              accessibilityLayer
              title="Динамика инцидентов за 24 часа по московскому времени"
              margin={{ top: 12, right: 16, bottom: 4, left: 0 }}
            >
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="start"
                interval="preserveEnd"
                minTickGap={32}
                tickFormatter={(value: number) => hourFormat.format(value)}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickLine={false}
              />
              <YAxis
                width={40}
                allowDecimals={false}
                domain={[0, (max: number) => Math.max(1, max)]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(value) => `${tooltipFormat.format(Number(value))} МСК`}
                contentStyle={{
                  backgroundColor: "var(--card)",
                  color: "var(--foreground)",
                  borderColor: "var(--border)",
                }}
                isAnimationActive={false}
              />
              {showCreated && (
                <Line
                  type="linear"
                  dataKey="created"
                  name="Создано"
                  stroke="var(--color-mts-blue)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {showResolved && (
                <Line
                  type="linear"
                  dataKey="resolved"
                  name="Критических решено"
                  stroke="var(--color-mts-emerald)"
                  strokeDasharray="5 3"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-muted-foreground">
          Для графика нужны даты создания инцидентов или история событий.
        </p>
      )}

      {(showCreated || showResolved) && (
        <p className="text-label-sm text-muted-foreground">
          Часовые интервалы · время московское
        </p>
      )}
    </div>
  );
}

export const IncidentAnalytics = memo(function IncidentAnalytics({
  incidents,
  events,
}: AnalyticsProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      aria-labelledby="analytics-title"
      className="mt-8 min-w-0 rounded-panel border bg-card"
    >
      <h2 id="analytics-title" className="text-title-lg">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="incident-analytics-content"
          onClick={() => setExpanded((open) => !open)}
          className="flex w-full items-center justify-between gap-4 rounded-panel px-4 py-4 text-left hover:bg-muted active:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-6"
        >
          Аналитика за 24 часа
          <ChevronDown
            aria-hidden="true"
            className={`size-5 shrink-0 motion-safe:transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
      </h2>

      <div id="incident-analytics-content" hidden={!expanded}>
        {expanded && (
          incidents !== undefined || events !== undefined ? (
            <ActivityChart incidents={incidents} events={events} />
          ) : (
            <p className="px-6 pb-6 text-muted-foreground">
              Ожидаем подключения данных.
            </p>
          )
        )}
      </div>
    </section>
  );
});