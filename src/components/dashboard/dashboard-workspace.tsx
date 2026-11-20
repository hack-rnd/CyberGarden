"use client";

import { Search } from "lucide-react";
import { useRef, useState } from "react";

import { DashboardAlerts } from "@/components/alerts/dashboard-alerts";
import type { DiffEvent } from "@/types/incident";
import { Input } from "@/components/ui/input";
import { currentSlaStatus, deadlineFor, isIncidentActive, type DashboardIncident, type IncidentTimelineEvent } from "./dashboard-model";
import type { useDashboardAi } from "./dashboard-ai";
import { EventFeed } from "./event-feed";

import {
  DashboardSummary,
  incidentGroups,
  type IncidentGroupId,
} from "./dashboard-summary";
import { IncidentAnalytics } from "./incident-analytics";
import {
  IncidentViews,
  useIncidentClock,
} from "./incident-views";

const slaLabels = {
  ok: "В норме",
  warning: "Под угрозой",
  critical: "Критический остаток",
  breached: "Просрочен",
} as const;

const views = [
  { value: "groups", label: "4 группы" },
  { value: "table", label: "Таблица" },
] as const;

type DashboardWorkspaceProps = {
  incidents?: readonly DashboardIncident[];
  newIncidentIds?: readonly string[];
  ai: ReturnType<typeof useDashboardAi>;
  events?: readonly IncidentTimelineEvent[];
  liveEvents?: readonly DiffEvent[];
  connection?: "pending" | "live" | "disconnected" | "file-error";
};

const connectionLabels = {
  pending: "Ожидание данных",
  live: "Подключено",
  disconnected: "Связь потеряна",
  "file-error": "Ошибка файла данных",
};

const connectionColors = {
  pending: "bg-mts-muted",
  live: "bg-mts-emerald",
  disconnected: "bg-mts-amber",
  "file-error": "bg-mts-amber",
};

const controlClass = "h-12 rounded-control";
const selectClass = `${controlClass} w-full border border-input bg-card px-4 text-label-md outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:border-mts-muted enabled:active:bg-muted disabled:opacity-50`;

function filterOptions(values: (string | undefined)[]) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((first, second) => first.localeCompare(second, "ru"));
}

export function DashboardWorkspace({
  incidents,
  newIncidentIds,
  ai,
  events,
  liveEvents,
  connection = "pending",
}: DashboardWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [service, setService] = useState("");
  const [team, setTeam] = useState("");
  const [sla, setSla] = useState("");
  const [view, setView] = useState<(typeof views)[number]["value"]>("groups");

  const [selectedGroup, setSelectedGroup] = useState<IncidentGroupId | null>(null);
  const [risksOnly, setRisksOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const [archivedResolutions, setArchivedResolutions] = useState<ReadonlyMap<string, number | null>>(new Map());
  const incidentIds = new Set(incidents?.map(({ id }) => id));
  const resolutionEvents = new Map<string, number>();

  for (const event of events ?? []) {
    if (event.eventType !== "CRITICAL_RESOLVED") continue;

    const timestamp = Date.parse(event.createdAt);
    if (Number.isFinite(timestamp) && timestamp > (resolutionEvents.get(event.incidentId) ?? -Infinity)) {
      resolutionEvents.set(event.incidentId, timestamp);
    }
  }

  const now = useIncidentClock(
    incidents?.some((incident) => isIncidentActive(incident) && Number.isFinite(deadlineFor(incident))) ?? false,
  );
  const criticalResolutions = new Map<string, number | null>();
  const visibleIncidents = incidents?.flatMap((incident) => {
    const resolvedAt = resolutionEvents.get(incident.id);
    if (incident.status !== "resolved" || (!incident.isRecentlyResolvedCritical && resolvedAt === undefined)) {
      return [incident];
    }

    const archivedAt = archivedResolutions.get(incident.id);
    const timestamp = resolvedAt ?? null;
    criticalResolutions.set(incident.id, timestamp);
    if (archivedAt === null || archivedAt === timestamp) return [];

    return incident.groups.includes("CRITICAL")
      ? [incident]
      : [{ ...incident, groups: ["CRITICAL", ...incident.groups] } satisfies DashboardIncident];
  });

  function archiveResolution(id: string) {
    const resolvedAt = criticalResolutions.get(id);
    if (resolvedAt !== undefined) {
      setArchivedResolutions((previous) => new Map(previous).set(id, resolvedAt));
    }
  }

  function openDetails(id: string, trigger?: HTMLElement) {
    if (!incidentIds.has(id)) return;
    detailsTrigger.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelectedId(id);
  }

  const selectedIncident = incidents?.find(({ id }) => id === selectedId);
  if (selectedId !== undefined && !selectedIncident) setSelectedId(undefined);

  const search = query.trim().toLocaleLowerCase("ru");
  const services = filterOptions(visibleIncidents?.map((incident) => incident.product) ?? []);
  const teams = filterOptions(visibleIncidents?.map((incident) => incident.assigneeTeam) ?? []);
  const activeService = services.includes(service) ? service : "";
  const activeTeam = teams.includes(team) ? team : "";

  const hasRiskAssessments =
    visibleIncidents?.some((incident) => incident.ai !== null) ?? false;
  const showRisksOnly = risksOnly && hasRiskAssessments;
  const selectedGroupTitle = incidentGroups.find((group) => group.id === selectedGroup)?.title;
  const newIds = newIncidentIds ? new Set(newIncidentIds) : undefined;

  const metrics = visibleIncidents && new Map(
    incidentGroups.map(({ id }) => {
      const members = visibleIncidents.filter((incident) => incident.groups.includes(id));
      const active = members.filter(isIncidentActive);
      const urgentSla = active.filter((incident) => currentSlaStatus(incident, now) !== "ok").length;

      return [id, {
        total: members.length,
        active: active.length,
        urgentSla,
        newCount: newIds
          ? members.filter((incident) => newIds.has(incident.id)).length
          : undefined,
      }] as const;
    }),
  );

  const matches = visibleIncidents?.filter((incident) =>
    (!search || [incident.id, incident.product, incident.description].some(
      (value) => value.toLocaleLowerCase("ru").includes(search),
    )) &&
    (!activeService || incident.product === activeService) &&
    (!activeTeam || incident.assigneeTeam === activeTeam) &&
    (!sla || currentSlaStatus(incident, now) === sla) &&
    (!selectedGroup || incident.groups.includes(selectedGroup)) &&
    (view === "table" || incident.groups.length > 0) &&
    (!showRisksOnly || incident.ai?.riskLevel === "high"),
  );

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-10 border-b bg-card">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-6 sm:gap-4 lg:px-12">
          <span className="flex shrink-0 items-center gap-2 text-label-md font-bold">
            <span className="size-2 rounded-pill bg-mts-red" aria-hidden="true" />
            МТС <span className="hidden sm:inline">True Tech</span>
          </span>

          <div className="relative min-w-0 flex-1 lg:max-w-md">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-4 left-4 size-4 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Поиск по ID, продукту и описанию"
              placeholder="Поиск"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={`${controlClass} bg-background pr-2 pl-10 hover:border-mts-muted active:bg-card`}
            />
          </div>

          <span role="status" className="ml-auto flex shrink-0 items-center gap-2 text-label-sm text-muted-foreground">
            <span
              aria-hidden="true"
              className={`size-2 rounded-pill ${connectionColors[connection]}`}
            />
            <span className="sr-only md:not-sr-only">
              JSON Live · {connectionLabels[connection]}
            </span>
          </span>

          <DashboardAlerts events={liveEvents} onOpen={openDetails} />
          <EventFeed
            events={events}
            liveEvents={liveEvents}
            visibleIncidentIds={incidentIds}
            onChoose={openDetails}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-6 pt-24 pb-12 lg:px-12">
        <h1 className="mb-8 text-2xl tracking-tight sm:text-headline-lg">
          Инциденты в фокусе
        </h1>

        {connection === "file-error" && (
          <p role="status" className="mb-8 rounded-panel border border-mts-amber bg-card p-4">
            Не удалось прочитать файл инцидентов. Доступные данные могут быть устаревшими.
          </p>
        )}

        <section aria-label="Фильтры и вид списка" className="mb-8 rounded-panel border bg-card p-4 sm:p-6">
          <div className="grid grid-cols-12 gap-4 lg:gap-6">
            <label className="col-span-12 grid min-w-0 gap-2 text-label-md font-medium sm:col-span-6 lg:col-span-3">
              Продукт
              <select
                className={selectClass}
                value={activeService}
                onChange={(event) => setService(event.target.value)}
                disabled={!services.length}
              >
                <option value="">Все продукты</option>
                {services.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>

            <label className="col-span-12 grid min-w-0 gap-2 text-label-md font-medium sm:col-span-6 lg:col-span-3">
              Команда
              <select
                className={selectClass}
                value={activeTeam}
                onChange={(event) => setTeam(event.target.value)}
                disabled={!teams.length}
              >
                <option value="">Все команды</option>
                {teams.map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>

            <label className="col-span-12 grid min-w-0 gap-2 text-label-md font-medium sm:col-span-6 lg:col-span-3">
              Статус SLA
              <select
                className={selectClass}
                value={sla}
                onChange={(event) => setSla(event.target.value)}
              >
                <option value="">Все статусы SLA</option>
                {Object.entries(slaLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <fieldset className="col-span-12 min-w-0 sm:col-span-6 lg:col-span-3">
              <legend className="mb-2 text-label-md font-medium">Вид списка</legend>
              <div className="flex min-h-12 rounded-control border bg-muted">
                {views.map(({ value, label }) => (
                  <label key={value} className="flex-1 cursor-pointer">
                    <input
                      type="radio"
                      name="incident-view"
                      value={value}
                      checked={view === value}
                      onChange={() => setView(value)}
                      className="peer sr-only"
                    />
                    <span className="flex h-full items-center justify-center whitespace-nowrap rounded-control px-2 text-label-md text-muted-foreground hover:bg-card/60 active:scale-[0.98] peer-checked:bg-card peer-checked:font-semibold peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <DashboardSummary
          metrics={metrics}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
          ai={ai}
          onOpenIncident={openDetails}
          hasRiskAssessments={hasRiskAssessments}
          risksOnly={showRisksOnly}
          onToggleRisks={() => setRisksOnly(!showRisksOnly)}
        />

        <IncidentAnalytics incidents={incidents} events={events} />

        <section id="incident-list" aria-labelledby="incident-list-title" className="mt-8 rounded-panel border bg-card p-6">
          <h2 id="incident-list-title" tabIndex={-1} className="scroll-mt-20 text-title-lg">
            {view === "groups" ? "Инциденты по группам" : "Таблица инцидентов"}
          </h2>

          <p role="status" className="mt-2 text-muted-foreground">
            {selectedGroupTitle && <span className="mr-4">{selectedGroupTitle}</span>}
            {showRisksOnly && <span className="mr-4">Есть риск эскалации</span>}
            <span>
              {matches
                ? `Найдено инцидентов: ${matches.length}`
                : "Ожидаем подключения данных."}
            </span>
          </p>

          {matches && (
            <IncidentViews
              incidents={matches}
              view={view}
              selectedGroup={selectedGroup}
              now={now}
              criticalResolutions={criticalResolutions}
              onArchive={archiveResolution}
              selected={selectedIncident}
              onOpenDetails={(id, event) => openDetails(id, event.currentTarget)}
              onClose={() => setSelectedId(undefined)}
              restoreFocus={() => {
                if (detailsTrigger.current?.isConnected) detailsTrigger.current.focus();
                else document.getElementById("incident-list-title")?.focus();
              }}
              aiControls={ai.analysis}
            />
          )}
        </section>
      </main>
    </>
  );
}