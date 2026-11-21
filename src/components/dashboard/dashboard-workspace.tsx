"use client";

import { ArrowDown, BarChart3, Search, X } from "lucide-react";
import { useRef, useState } from "react";

import { DashboardAlerts } from "@/components/alerts/dashboard-alerts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DiffEvent } from "@/types/incident";
import {
  currentSlaStatus,
  deadlineFor,
  isIncidentActive,
  type DashboardIncident,
  type IncidentTimelineEvent,
} from "./dashboard-model";
import type { useDashboardAi } from "./dashboard-ai";
import { EventFeed } from "./event-feed";
import {
  DashboardSummary,
  incidentGroups,
  type IncidentGroupId,
} from "./dashboard-summary";
import { IncidentAnalytics } from "./incident-analytics";
import { IncidentViews, useIncidentClock } from "./incident-views";

// --- CONSTANTS ---

const ALL_VALUE = "__all__";

const slaLabels = {
  ok: "В норме",
  warning: "Под угрозой",
  critical: "Критический остаток",
  breached: "Просрочен",
} as const;

const views = [
  { value: "table", label: "Таблица" },
  { value: "groups", label: "4 группы" },
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

function filterOptions(values: (string | undefined)[]) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((first, second) => first.localeCompare(second, "ru"));
}

// --- WORKSPACE ---

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
  const [view, setView] = useState<(typeof views)[number]["value"]>("table");
  const [page, setPage] = useState(1);

  const [selectedGroup, setSelectedGroup] = useState<IncidentGroupId | null>(
    null,
  );
  const [risksOnly, setRisksOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const [archivedResolutions, setArchivedResolutions] = useState<
    ReadonlyMap<string, number | null>
  >(new Map());

  const incidentIds = new Set(incidents?.map(({ id }) => id));
  const resolutionEvents = new Map<string, number>();

  for (const event of events ?? []) {
    if (event.eventType !== "CRITICAL_RESOLVED") continue;

    const timestamp = Date.parse(event.createdAt);
    if (
      Number.isFinite(timestamp) &&
      timestamp > (resolutionEvents.get(event.incidentId) ?? -Infinity)
    ) {
      resolutionEvents.set(event.incidentId, timestamp);
    }
  }

  const now = useIncidentClock(
    incidents?.some(
      (incident) =>
        isIncidentActive(incident) && Number.isFinite(deadlineFor(incident)),
    ) ?? false,
  );

  const criticalResolutions = new Map<string, number | null>();
  const visibleIncidents = incidents?.flatMap((incident) => {
    const resolvedAt = resolutionEvents.get(incident.id);
    if (
      incident.status !== "resolved" ||
      (!incident.isRecentlyResolvedCritical && resolvedAt === undefined)
    ) {
      return [incident];
    }

    const archivedAt = archivedResolutions.get(incident.id);
    const timestamp = resolvedAt ?? null;
    criticalResolutions.set(incident.id, timestamp);
    if (archivedAt === null || archivedAt === timestamp) return [];

    return incident.groups.includes("CRITICAL")
      ? [incident]
      : [
          {
            ...incident,
            groups: ["CRITICAL", ...incident.groups],
          } satisfies DashboardIncident,
        ];
  });

  function scrollToElement(id: string) {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function archiveResolution(id: string) {
    const resolvedAt = criticalResolutions.get(id);
    if (resolvedAt !== undefined) {
      setArchivedResolutions((previous) =>
        new Map(previous).set(id, resolvedAt),
      );
    }
  }

  function openDetails(id: string, trigger?: HTMLElement) {
    if (!incidentIds.has(id)) return;
    detailsTrigger.current =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setSelectedId(id);
  }

  function handleSelectGroup(group: IncidentGroupId | null) {
    setSelectedGroup(group);
    setRisksOnly(false);
    setPage(1);
    if (group !== null) scrollToElement("incident-list");
  }

  function handleToggleRisks() {
    if (!showRisksOnly) {
      setSelectedGroup(null);
      setService("");
      setTeam("");
      setSla("");
      setQuery("");
      setView("table");
      setRisksOnly(true);
      setPage(1);
      scrollToElement("incident-list");
      return;
    }
    setRisksOnly(false);
    setPage(1);
  }

  function resetAllFilters() {
    setQuery("");
    setService("");
    setTeam("");
    setSla("");
    setSelectedGroup(null);
    setRisksOnly(false);
    setPage(1);
  }

  const selectedIncident = incidents?.find(({ id }) => id === selectedId);
  if (selectedId !== undefined && !selectedIncident) setSelectedId(undefined);

  const search = query.trim().toLocaleLowerCase("ru");
  const services = filterOptions(
    visibleIncidents?.map((incident) => incident.product) ?? [],
  );
  const teams = filterOptions(
    visibleIncidents?.map((incident) => incident.assigneeTeam) ?? [],
  );
  const activeService = services.includes(service) ? service : "";
  const activeTeam = teams.includes(team) ? team : "";

  const hasRiskAssessments =
    visibleIncidents?.some((incident) => incident.ai !== null) ?? false;
  const showRisksOnly = risksOnly && hasRiskAssessments;
  const selectedGroupTitle = incidentGroups.find(
    (group) => group.id === selectedGroup,
  )?.title;
  const newIds = newIncidentIds ? new Set(newIncidentIds) : undefined;

  const hasAnyFilter = Boolean(
    search ||
      activeService ||
      activeTeam ||
      sla ||
      selectedGroup ||
      showRisksOnly,
  );

  const metrics =
    visibleIncidents &&
    new Map(
      incidentGroups.map(({ id }) => {
        const members = visibleIncidents.filter((incident) =>
          incident.groups.includes(id),
        );
        const active = members.filter(isIncidentActive);
        const urgentSla = active.filter(
          (incident) => currentSlaStatus(incident, now) !== "ok",
        ).length;

        return [
          id,
          {
            total: members.length,
            active: active.length,
            urgentSla,
            newCount: newIds
              ? members.filter((incident) => newIds.has(incident.id)).length
              : undefined,
          },
        ] as const;
      }),
    );

  const matches = visibleIncidents?.filter(
    (incident) =>
      (!search ||
        [incident.id, incident.product, incident.description].some((value) =>
          value.toLocaleLowerCase("ru").includes(search),
        )) &&
      (!activeService || incident.product === activeService) &&
      (!activeTeam || incident.assigneeTeam === activeTeam) &&
      (!sla || currentSlaStatus(incident, now) === sla) &&
      (!selectedGroup || incident.groups.includes(selectedGroup)) &&
      (view === "table" || incident.groups.length > 0) &&
      (!showRisksOnly || incident.ai?.riskLevel === "high"),
  );

  const totalVisibleCount = visibleIncidents?.length ?? 0;

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-10 border-b border-white/10 bg-mts-ink text-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-6 sm:gap-4 lg:px-12">
          <span className="flex shrink-0 items-center gap-2.5 text-label-md font-bold tracking-wide text-white">
            <span
              className="flex size-6 items-center justify-center rounded-md bg-mts-red text-[11px] font-bold text-white"
              aria-hidden="true"
            >
              M
            </span>
            МТС <span className="hidden text-white/80 sm:inline">True Tech</span>
          </span>

          <div className="relative min-w-0 flex-1 lg:max-w-md">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-white/50"
            />
            <Input
              type="search"
              aria-label="Поиск по ID, продукту и описанию"
              placeholder="Поиск по ID, продукту, описанию"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              className="h-10 rounded-control border-white/15 bg-white/10 pr-3 pl-10 text-white placeholder:text-white/55 hover:border-white/30 focus-visible:bg-white/15"
            />
          </div>

          <span
            role="status"
            className="ml-auto flex shrink-0 items-center gap-2 text-label-sm text-white/75"
          >
            <span
              aria-hidden="true"
              className={`size-2 rounded-pill ${connectionColors[connection]}`}
            />
            <span className="sr-only md:not-sr-only">
              JSON Live · {connectionLabels[connection]}
            </span>
          </span>

          <div className="flex items-center gap-1 [&_button]:text-white [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
            <DashboardAlerts events={liveEvents} onOpen={openDetails} />
            <EventFeed
              events={events}
              liveEvents={liveEvents}
              visibleIncidentIds={incidentIds}
              onChoose={openDetails}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-6 pt-24 pb-12 lg:px-12">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl tracking-tight sm:text-headline-lg">
            Инциденты в фокусе
          </h1>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-control border-mts-ink/20 bg-card px-4 text-label-md hover:border-mts-ink hover:bg-mts-ink hover:text-white"
              onClick={() => scrollToElement("analytics-section")}
            >
              <BarChart3 className="size-4" aria-hidden="true" />
              Аналитика 24ч
            </Button>
            <Button
              type="button"
              className="h-11 rounded-control bg-mts-red px-5 text-label-md font-semibold text-white hover:bg-mts-crimson"
              onClick={() => scrollToElement("incident-list")}
            >
              К таблице инцидентов
              <ArrowDown className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {connection === "file-error" && (
          <p
            role="status"
            className="mb-8 rounded-panel border border-mts-amber bg-card p-4"
          >
            Не удалось прочитать файл инцидентов. Доступные данные могут быть
            устаревшими.
          </p>
        )}

        <DashboardSummary
          metrics={metrics}
          selectedGroup={selectedGroup}
          onSelectGroup={handleSelectGroup}
          ai={ai}
          onOpenIncident={openDetails}
          hasRiskAssessments={hasRiskAssessments}
          risksOnly={showRisksOnly}
          onToggleRisks={handleToggleRisks}
          analytics={
            <IncidentAnalytics incidents={incidents} events={events} />
          }
        />

        <section
          id="incident-list"
          aria-labelledby="incident-list-title"
          className="mt-8 scroll-mt-20 rounded-panel border bg-card p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2
                id="incident-list-title"
                tabIndex={-1}
                className="text-title-lg"
              >
                {view === "groups"
                  ? "Инциденты по 4 ключевым группам"
                  : "Таблица инцидентов"}
              </h2>

              <p
                role="status"
                className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-label-md text-muted-foreground"
              >
                {selectedGroupTitle && (
                  <span className="font-medium text-foreground">
                    {selectedGroupTitle}
                  </span>
                )}
                {showRisksOnly && (
                  <span className="font-medium text-mts-crimson">
                    Только риски эскалации
                  </span>
                )}
                <span>
                  {matches
                    ? view === "groups"
                      ? `В 4 ключевых группах: ${matches.length} из ${totalVisibleCount} (остальные — штатные и архивные)`
                      : `Найдено инцидентов: ${matches.length}`
                    : "Ожидаем подключения данных."}
                </span>
                {view === "groups" && totalVisibleCount > (matches?.length ?? 0) && (
                  <button
                    type="button"
                    className="cursor-pointer font-medium text-mts-blue underline-offset-4 hover:underline"
                    onClick={() => {
                      setView("table");
                      setPage(1);
                    }}
                  >
                    Показать все {totalVisibleCount} в таблице
                  </button>
                )}
              </p>
            </div>

            {hasAnyFilter && (
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-control"
                onClick={resetAllFilters}
              >
                <X className="size-4" aria-hidden="true" />
                Сбросить фильтры
              </Button>
            )}
          </div>

          <div
            aria-label="Фильтры и вид списка"
            className="mt-4 grid grid-cols-12 gap-4 rounded-panel border bg-background p-4 lg:gap-6"
          >
            <div className="col-span-12 grid min-w-0 gap-2 sm:col-span-6 lg:col-span-3">
              <span className="text-label-md font-medium">Продукт</span>
              <Select
                value={activeService || ALL_VALUE}
                onValueChange={(value) => {
                  setService(value === ALL_VALUE ? "" : value);
                  setPage(1);
                }}
                disabled={!services.length}
              >
                <SelectTrigger className="h-12 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted">
                  <SelectValue placeholder="Все продукты" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]">
                  <SelectGroup>
                    <SelectItem value={ALL_VALUE}>Все продукты</SelectItem>
                    {services.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-12 grid min-w-0 gap-2 sm:col-span-6 lg:col-span-3">
              <span className="text-label-md font-medium">Команда</span>
              <Select
                value={activeTeam || ALL_VALUE}
                onValueChange={(value) => {
                  setTeam(value === ALL_VALUE ? "" : value);
                  setPage(1);
                }}
                disabled={!teams.length}
              >
                <SelectTrigger className="h-12 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted">
                  <SelectValue placeholder="Все команды" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]">
                  <SelectGroup>
                    <SelectItem value={ALL_VALUE}>Все команды</SelectItem>
                    {teams.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-12 grid min-w-0 gap-2 sm:col-span-6 lg:col-span-3">
              <span className="text-label-md font-medium">Статус SLA</span>
              <Select
                value={sla || ALL_VALUE}
                onValueChange={(value) => {
                  setSla(value === ALL_VALUE ? "" : value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-12 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted">
                  <SelectValue placeholder="Все статусы SLA" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]">
                  <SelectGroup>
                    <SelectItem value={ALL_VALUE}>Все статусы SLA</SelectItem>
                    {Object.entries(slaLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <fieldset className="col-span-12 min-w-0 sm:col-span-6 lg:col-span-3">
              <legend className="mb-2 text-label-md font-medium">
                Вид списка
              </legend>
              <div className="flex min-h-12 rounded-control border bg-card p-1">
                {views.map(({ value, label }) => (
                  <label key={value} className="flex-1 cursor-pointer">
                    <input
                      type="radio"
                      name="incident-view"
                      value={value}
                      checked={view === value}
                      onChange={() => {
                        setView(value);
                        setPage(1);
                      }}
                      className="peer sr-only"
                    />
                    <span className="flex h-full items-center justify-center whitespace-nowrap rounded-control px-2 text-label-md text-muted-foreground hover:bg-muted active:scale-[0.98] peer-checked:bg-mts-ink peer-checked:font-semibold peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

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
                if (detailsTrigger.current?.isConnected) {
                  detailsTrigger.current.focus();
                } else {
                  document.getElementById("incident-list-title")?.focus();
                }
              }}
              aiControls={ai.analysis}
              page={page}
              onPageChange={setPage}
            />
          )}
        </section>
      </main>
    </>
  );
}