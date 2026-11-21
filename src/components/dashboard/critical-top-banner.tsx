import { AlertTriangle, ArrowDown } from "lucide-react";

import { deadlineFor, type DashboardIncident } from "./dashboard-model";
import { formatDuration } from "./incident-views";

type CriticalTopBannerProps = {
  incidents: readonly DashboardIncident[];
  now: number | null;
  onJumpToIncident: (id: string) => void;
};

const UNASSIGNED_LABELS = new Set([
  "",
  "не назначена",
  "не назначен",
  "не указан",
  "не указана",
]);

function hasRealAssignee(incident: DashboardIncident): string | null {
  if (incident.assigneeEmployee?.trim()) {
    return incident.assigneeEmployee.trim();
  }
  const team = incident.assigneeTeam?.trim() ?? "";
  if (team && !UNASSIGNED_LABELS.has(team.toLowerCase())) {
    return team;
  }
  return null;
}

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
      className="critical-banner-flash mb-6 rounded-panel border-2 border-mts-red p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="critical-top-banner-title"
          className="flex items-center gap-2 text-title-lg font-bold text-mts-crimson"
        >
          <span
            aria-hidden="true"
            className="critical-dot-pulse size-3 shrink-0 rounded-full bg-mts-red"
          />
          <AlertTriangle className="size-5 shrink-0 text-mts-red" aria-hidden="true" />
          Критические инциденты ({incidents.length})
        </h2>
        <span className="rounded-pill bg-mts-red px-3 py-1 text-label-sm font-semibold text-white">
          Требует немедленной реакции
        </span>
      </div>

      <ul className="space-y-2">
        {incidents.map((incident) => {
          const assignee = hasRealAssignee(incident);

          return (
            <li key={incident.id}>
              <button
                type="button"
                onClick={() => onJumpToIncident(incident.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-control border border-mts-red/30 bg-card/95 px-3.5 py-2.5 text-left transition hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span className="font-bold text-mts-crimson">{incident.id}</span>
                <span className="font-semibold text-foreground">{incident.product}</span>
                {assignee ? (
                  <span className="text-label-md text-muted-foreground">{assignee}</span>
                ) : (
                  <span className="rounded-pill border border-mts-amber/40 bg-mts-amber/12 px-2.5 py-0.5 text-label-sm font-semibold text-[#B8380E]">
                    Исполнитель не указан
                  </span>
                )}
                <span className="ml-auto whitespace-nowrap font-bold text-mts-crimson tabular-nums">
                  {formatSla(incident, now)}
                </span>
                <ArrowDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-mts-crimson"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}