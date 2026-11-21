import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IncidentGroup } from "@/types/incident";

import { AnalyzeButton, type useDashboardAi } from "./dashboard-ai";

export const incidentGroups = [
  { id: "CRITICAL", title: "Критические", marker: "bg-mts-red" },
  { id: "ASSIGNED_TO_COORDINATORS", title: "На координаторах", marker: "bg-mts-ink" },
  { id: "HIGH_PRIORITY", title: "Высокий приоритет", marker: "bg-mts-amber" },
  { id: "INVESTIGATION", title: "Исследование ситуации", marker: "bg-mts-blue" },
] as const satisfies readonly { id: IncidentGroup; title: string; marker: string }[];

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
};

export function DashboardSummary({
  metrics,
  selectedGroup,
  onSelectGroup,
  ai,
  onOpenIncident,
  hasRiskAssessments,
  risksOnly,
  onToggleRisks,
}: DashboardSummaryProps) {
  const digest = ai.digest.data;

  return (
    <div className="grid grid-cols-12 gap-3 md:gap-4 lg:gap-6">
      <section aria-labelledby="groups-title" className="col-span-12 lg:col-span-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="groups-title" className="text-title-lg">Сводка по инцидентам</h2>
          {selectedGroup && (
            <Button type="button" variant="ghost" onClick={() => onSelectGroup(null)}>
              Все 4 группы
            </Button>
          )}
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:gap-6">
          {incidentGroups.map(({ id, title, marker }) => {
            const groupMetrics = metrics?.get(id);
            const isSelected = selectedGroup === id;

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
                    "flex h-full w-full flex-col gap-4 rounded-panel border bg-card p-6 text-left",
                    "transition-[transform,box-shadow,border-color] duration-200 ease-in-out",
                    "hover:border-mts-muted hover:shadow-[0_4px_16px_rgba(29,32,35,0.08)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    "active:scale-[0.98] motion-safe:hover:-translate-y-1",
                    isSelected && "border-mts-red",
                  )}
                >
                  <span className="flex w-full flex-wrap items-center gap-2">
                    <span className={`size-2 shrink-0 rounded-pill ${marker}`} aria-hidden="true" />
                    <span className="text-body-md font-semibold">{title}</span>
                  </span>
                  <span id={`group-metrics-${id}`} className="flex w-full flex-col gap-2">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-heading text-headline-lg tabular-nums">
                        {groupMetrics?.active ?? "—"}
                      </span>
                      {!!groupMetrics?.newCount && (
                        <Badge variant="outline" className="h-auto rounded-pill px-2 py-1 text-label-sm">
                          +{groupMetrics.newCount} новых
                        </Badge>
                      )}
                    </span>
                    <span className="text-label-md text-muted-foreground">
                      {groupMetrics ? `Активных из ${groupMetrics.total}` : "Активные инциденты"}
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

      <section aria-labelledby="copilot-title" className="col-span-12 lg:col-span-4">
        <h2 id="copilot-title" className="mb-4 text-title-lg">ИИ-копилот смены</h2>
        <div className="rounded-panel border bg-card p-6">
          <div className="flex items-start gap-4">
            <Sparkles aria-hidden="true" className="mt-1 size-5 shrink-0 text-mts-blue" />
            <p role="status" className="text-body-md">
              {digest?.headline ?? (ai.digest.isPending
                ? "Загружаем сводку ИИ…"
                : ai.digest.isError ? "Не удалось загрузить сводку ИИ." : "Сводка ИИ пока недоступна.")}
            </p>
          </div>
          {digest && (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-label-md">
                <div><dt>Проанализировано</dt><dd>{digest.analyzedCount}</dd></div>
                <div><dt>Ожидают анализа</dt><dd>{digest.pendingCount}</dd></div>
                <div><dt>Высокий риск</dt><dd>{digest.highRiskCount}</dd></div>
                <div><dt>Прогноз срыва SLA</dt><dd>{digest.breachForecastCount}</dd></div>
                <div><dt>Ожидают передачи</dt><dd>{digest.handoffsPending}</dd></div>
              </dl>
              {digest.topConcerns.length > 0 && (
                <ul className="mt-4 space-y-4">
                  {digest.topConcerns.map((concern) => (
                    <li key={concern.incidentId} className="rounded-control border p-4 text-label-md">
                      <button
                        type="button"
                        className="rounded-sm text-left font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.98]"
                        onClick={(event) => onOpenIncident(concern.incidentId, event.currentTarget)}
                      >
                        {concern.code} · {concern.product}
                      </button>
                      <p className="mt-2">{concern.summary}</p>
                      <p className="mt-2 text-muted-foreground">
                        Риск {concern.riskScore}% · {concern.recommendedTeam}
                        {concern.willBreachSla && " · Прогноз срыва SLA"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="mt-4"><AnalyzeButton controls={ai.analysis} /></div>
          <Button
            type="button"
            variant="outline"
            aria-pressed={risksOnly}
            aria-controls="incident-list"
            disabled={!hasRiskAssessments}
            onClick={onToggleRisks}
            className="mt-6 h-auto min-h-12 w-full rounded-control px-4 py-2 text-center whitespace-normal"
          >
            Показать риски эскалации
          </Button>
          {!hasRiskAssessments && (
            <p className="mt-2 text-label-sm text-muted-foreground">Оценки риска пока недоступны.</p>
          )}
        </div>
      </section>
    </div>
  );
}
