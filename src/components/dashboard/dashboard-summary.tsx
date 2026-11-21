import type { ReactNode } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IncidentGroup } from "@/types/incident";

import { AnalyzeButton, type useDashboardAi } from "./dashboard-ai";

// --- CONSTANTS ---

export const incidentGroups = [
  { id: "CRITICAL", title: "Критические", marker: "bg-mts-red" },
  {
    id: "ASSIGNED_TO_COORDINATORS",
    title: "На координаторах",
    marker: "bg-mts-ink",
  },
  { id: "HIGH_PRIORITY", title: "Высокий приоритет", marker: "bg-mts-amber" },
  { id: "INVESTIGATION", title: "Исследование ситуации", marker: "bg-mts-blue" },
] as const satisfies readonly {
  id: IncidentGroup;
  title: string;
  marker: string;
}[];

export type IncidentGroupId = (typeof incidentGroups)[number]["id"];

type GroupMetrics = {
  total: number;
  active: number;
  urgentSla?: number;
  newCount?: number;
};

type DashboardSummaryProps = {
  metrics?: ReadonlyMap<IncidentGroupId, GroupMetrics>;
  selectedGroup: IncidentGroupId | null;
  onSelectGroup: (group: IncidentGroupId | null) => void;
  ai: ReturnType<typeof useDashboardAi>;
  onOpenIncident: (id: string, trigger?: HTMLElement) => void;
  hasRiskAssessments: boolean;
  risksOnly: boolean;
  onToggleRisks: () => void;
  analytics?: ReactNode;
};

// --- SUMMARY COMPONENT ---

export function DashboardSummary({
  metrics,
  selectedGroup,
  onSelectGroup,
  ai,
  onOpenIncident,
  hasRiskAssessments,
  risksOnly,
  onToggleRisks,
  analytics,
}: DashboardSummaryProps) {
  const digest = ai.digest.data;

  return (
    <div className="grid grid-cols-12 items-start gap-4 lg:gap-6">
      <div className="col-span-12 lg:col-span-8">
        <section aria-labelledby="groups-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 id="groups-title" className="text-title-lg">
              Сводка по инцидентам
            </h2>
            {selectedGroup && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => onSelectGroup(null)}
              >
                Все 4 группы
              </Button>
            )}
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6">
            {incidentGroups.map(({ id, title, marker }) => {
              const groupMetrics = metrics?.get(id);
              const isSelected = selectedGroup === id;
              const hasActiveCritical =
                id === "CRITICAL" && (groupMetrics?.active ?? 0) > 0;

              return (
                <li key={id} className="min-w-0">
                  <button
                    type="button"
                    aria-label={title}
                    aria-pressed={isSelected}
                    aria-controls="incident-list"
                    aria-describedby={`group-metrics-${id}`}
                    onClick={() => onSelectGroup(isSelected ? null : id)}
                    className={cn(
                      "flex h-full w-full cursor-pointer flex-col gap-3 rounded-panel border bg-card p-6 text-left",
                      "transition-[transform,box-shadow,border-color] duration-200 ease-in-out",
                      "hover:border-mts-muted hover:shadow-[0_4px_16px_rgba(29,32,35,0.08)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      "active:scale-[0.98] motion-safe:hover:-translate-y-1",
                      isSelected && "border-mts-red",
                      hasActiveCritical && "critical-pulse-ring",
                    )}
                  >
                    <span className="flex w-full flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-pill",
                          marker,
                          hasActiveCritical && "critical-dot-pulse",
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-body-md font-semibold">
                        {title}
                      </span>
                    </span>
                    <span
                      id={`group-metrics-${id}`}
                      className="flex w-full flex-col gap-1.5"
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={cn(
                            "font-heading text-headline-lg tabular-nums",
                            hasActiveCritical && "text-mts-red",
                          )}
                        >
                          {groupMetrics?.active ?? "—"}
                        </span>
                        {!!groupMetrics?.newCount && (
                          <Badge
                            variant="outline"
                            className="h-auto rounded-pill border-mts-red/30 bg-mts-red/8 px-2.5 py-0.5 text-label-sm text-mts-crimson"
                          >
                            +{groupMetrics.newCount} новых
                          </Badge>
                        )}
                      </span>
                      <span className="text-label-md text-muted-foreground">
                        {groupMetrics
                          ? `Активных из ${groupMetrics.total}`
                          : "Активные инциденты"}
                      </span>
                      <span className="text-label-sm text-muted-foreground">
                        Требуют внимания по SLA: {groupMetrics?.urgentSla ?? "—"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {analytics}
      </div>

      <section
        aria-labelledby="copilot-title"
        className="col-span-12 lg:col-span-4"
      >
        <h2 id="copilot-title" className="mb-4 text-title-lg">
          ИИ-копилот смены
        </h2>
        <div className="rounded-panel border bg-card p-6">
          <div className="flex items-start gap-3">
            <Sparkles
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-mts-red"
            />
            <p role="status" className="text-label-md font-medium leading-snug">
              {digest?.headline ??
                (ai.digest.isPending
                  ? "Загружаем сводку ИИ…"
                  : ai.digest.isError
                    ? "Не удалось загрузить сводку ИИ."
                    : "Сводка ИИ пока недоступна.")}
            </p>
          </div>
          {digest && (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-control bg-background p-3 text-label-sm">
                <div>
                  <dt className="text-muted-foreground">Проанализировано</dt>
                  <dd className="mt-0.5 font-heading text-body-md font-semibold">
                    {digest.analyzedCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Высокий риск</dt>
                  <dd className="mt-0.5 font-heading text-body-md font-semibold text-mts-crimson">
                    {digest.highRiskCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Прогноз срыва SLA</dt>
                  <dd className="mt-0.5 font-heading text-body-md font-semibold text-mts-amber">
                    {digest.breachForecastCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Ожидают передачи</dt>
                  <dd className="mt-0.5 font-heading text-body-md font-semibold">
                    {digest.handoffsPending}
                  </dd>
                </div>
              </dl>
              {digest.topConcerns.length > 0 && (
                <ul className="mt-4 space-y-3">
                  {digest.topConcerns.map((concern) => (
                    <li
                      key={concern.incidentId}
                      className="rounded-control border p-3 text-label-md transition-colors duration-200 hover:border-mts-blue/50"
                    >
                      <button
                        type="button"
                        className="group inline-flex cursor-pointer items-center gap-1 rounded-sm text-left font-semibold text-mts-blue underline-offset-4 transition-colors duration-200 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98]"
                        onClick={(event) =>
                          onOpenIncident(concern.incidentId, event.currentTarget)
                        }
                      >
                        <span>
                          {concern.code} · {concern.product}
                        </span>
                        <ArrowUpRight
                          aria-hidden="true"
                          className="size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        />
                      </button>
                      <p className="mt-1.5 line-clamp-2 text-label-sm text-foreground">
                        {concern.summary}
                      </p>
                      <p className="mt-1.5 text-label-sm text-muted-foreground">
                        Риск {concern.riskScore}% · {concern.recommendedTeam}
                        {concern.willBreachSla && " · Прогноз срыва SLA"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="mt-4">
            <AnalyzeButton controls={ai.analysis} />
          </div>
          <Button
            type="button"
            variant="outline"
            aria-pressed={risksOnly}
            aria-controls="incident-list"
            disabled={!hasRiskAssessments}
            onClick={onToggleRisks}
            className={cn(
              "mt-4 h-auto min-h-12 w-full rounded-control px-4 py-2 text-center whitespace-normal",
              risksOnly
                ? "border-mts-red bg-mts-red text-white hover:bg-mts-crimson hover:text-white"
                : "border-mts-ink/25 hover:border-mts-ink hover:bg-mts-ink hover:text-white",
            )}
          >
            {risksOnly ? "Сбросить фильтр рисков" : "Показать риски эскалации"}
          </Button>
          {!hasRiskAssessments && (
            <p className="mt-2 text-label-sm text-muted-foreground">
              Оценки риска пока недоступны.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}