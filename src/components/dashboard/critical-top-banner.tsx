import { ArrowDown } from "lucide-react";

import { deadlineFor, type DashboardIncident } from "./dashboard-model";
import { formatDuration } from "./incident-views";

type CriticalTopBannerProps = {
  incidents: readonly DashboardIncident[];
  now: number | null;
  onJumpToIncident: (id: string) => void;
};

function formatSla(incident: DashboardIncident, now: number | null) {
  const deadline = deadlineFor(incident);

  if (!Number.isFinite(deadline)) return "SLA не задан";
  if (now === null) return "Расчёт SLA…";

  const remainingMs = deadline - now;

  if (remainingMs <= 0) return "SLA просрочен";

  return `SLA ${formatDuration(Math.ceil(remainingMs / 1_000))}`;
}

export function CriticalTopBanner({
  incidents,
  now,
  onJumpToIncident,
}: CriticalTopBannerProps) {
  if (incidents.length === 0) return null;

  return (
    <section
      aria-labelledby="critical-top-banner-title"
      className="critical-pulse-ring mb-6 rounded-panel border bg-card p-4"
    >
      <h2
        id="critical-top-banner-title"
        className="mb-3 flex items-center gap-2 text-label-md font-semibold text-mts-crimson"
      >
        <span
          aria-hidden="true"
          className="critical-dot-pulse size-2 shrink-0 rounded-full bg-mts-red"
        />
        Критические инциденты
      </h2>

      <ul className="divide-y">
        {incidents.map((incident) => (
          <li key={incident.id}>
            <button
              type="button"
              onClick={() => onJumpToIncident(incident.id)}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-control px-3 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span className="font-semibold">{incident.id}</span>
              <span>{incident.product}</span>
              <span className="text-muted-foreground">
                {incident.assigneeEmployee ||
                  incident.assigneeTeam ||
                  "Не назначен"}
              </span>
              <span className="ml-auto whitespace-nowrap font-semibold tabular-nums">
                {formatSla(incident, now)}
              </span>
              <ArrowDown aria-hidden="true" className="size-4 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}