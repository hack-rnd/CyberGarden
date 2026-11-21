import { ArrowDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
      className="mb-6 rounded-panel border-2 border-mts-red bg-card p-6"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="critical-top-banner-title"
          className="text-title-lg font-medium text-mts-crimson"
        >
          Критические инциденты ({incidents.length})
        </h2>
        <Badge className="rounded-pill bg-mts-red px-3 py-1 text-label-sm font-bold text-white">
          Закреплено · Требует реакции
        </Badge>
      </div>

      <ul className="space-y-2">
        {incidents.map((incident) => {
          const assignee = hasRealAssignee(incident);

          return (
            <li key={incident.id}>
              <button
                type="button"
                onClick={() => onJumpToIncident(incident.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-control border border-border bg-background px-4 py-3 text-left transition-all duration-200 hover:border-mts-red/50 hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.99]"
              >
                <span className="font-semibold text-mts-crimson">
                  {incident.id}
                </span>
                <span className="font-medium text-foreground">
                  {incident.product}
                </span>
                {assignee ? (
                  <span className="text-label-md text-muted-foreground">
                    {assignee}
                  </span>
                ) : (
                  <span className="rounded-pill border border-mts-amber/40 bg-mts-amber/12 px-2.5 py-0.5 text-label-sm font-bold text-[#B8380E]">
                    Исполнитель не указан
                  </span>
                )}
                <span className="ml-auto whitespace-nowrap font-semibold text-mts-crimson tabular-nums">
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