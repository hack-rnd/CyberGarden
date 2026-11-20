"use client";

import { Bell, Search, X } from "lucide-react";
import { useState } from "react";

import { DashboardAlerts } from "@/components/alerts/dashboard-alerts";
import type { DiffEvent } from "@/types/incident";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { isIncidentActive, type IncidentTimelineEvent } from "./dashboard-model";

import {
  DashboardSummary,
  incidentGroups,
  type IncidentGroupId,
} from "./dashboard-summary";
import { IncidentAnalytics } from "./incident-analytics";
import {
  IncidentViews,
  useIncidentClock,
  type DashboardIncident,
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
  recommendations?: readonly string[];
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
const selectClass = `${controlClass} w-full border border-input bg-card px-4 text-label-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50`;

const resolutionVisibilityMs = 5 * 60 * 1000;

function filterOptions(values: (string | undefined)[]) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((first, second) => first.localeCompare(second, "ru"));
}

export function DashboardWorkspace({
  incidents,
  newIncidentIds,
  recommendations,
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
  const [archivedResolutions, setArchivedResolutions] = useState<
    ReadonlyMap<string, number>
  >(new Map());

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
    incidents?.some((incident) =>
      incident.status === "resolved"
        ? Boolean(incident.criticalResolvedAt || resolutionEvents.has(incident.id))
        : Boolean(incident.slaDeadline),
    ) ?? false,
  );

  const criticalResolutions = new Map<string, number>();

  const visibleIncidents = incidents?.flatMap((incident) => {
    if (incident.status !== "resolved") return [incident];

    const explicitTimestamp = Date.parse(incident.criticalResolvedAt ?? "");
    const resolvedAt = Math.max(
      Number.isFinite(explicitTimestamp) ? explicitTimestamp : -Infinity,
      resolutionEvents.get(incident.id) ?? -Infinity,
    );

    if (!Number.isFinite(resolvedAt)) return [incident];

    if (
      now === null ||
      now - resolvedAt >= resolutionVisibilityMs ||
      archivedResolutions.get(incident.id) === resolvedAt
    ) {
      return [];
    }

    criticalResolutions.set(incident.id, resolvedAt);

    if (incident.groups.includes("CRITICAL")) return [incident];

    return [
      {
        ...incident,
        groups: ["CRITICAL", ...incident.groups],
      } satisfies DashboardIncident,
    ];
  });

  function archiveResolution(id: string) {
    const resolvedAt = criticalResolutions.get(id);

    if (resolvedAt !== undefined) {
      setArchivedResolutions((previous) => new Map(previous).set(id, resolvedAt));
    }
  }

  const search = query.trim().toLocaleLowerCase("ru");
  const services = filterOptions(visibleIncidents?.map((incident) => incident.service) ?? []);
  const teams = filterOptions(visibleIncidents?.map((incident) => incident.assignedTeam) ?? []);
  const activeService = services.includes(service) ? service : "";
  const activeTeam = teams.includes(team) ? team : "";

  const hasRiskAssessments =
    visibleIncidents?.some((incident) => incident.hasEscalationRisk !== undefined) ?? false;
  const showRisksOnly = risksOnly && hasRiskAssessments;
  const selectedGroupTitle = incidentGroups.find((group) => group.id === selectedGroup)?.title;
  const newIds = newIncidentIds ? new Set(newIncidentIds) : undefined;

  const metrics = visibleIncidents && new Map(
    incidentGroups.map(({ id }) => {
      const members = visibleIncidents.filter((incident) => incident.groups.includes(id));
      const active = members.filter(isIncidentActive);
      const urgentSla = active.every(({ slaStatus }) => slaStatus !== undefined)
        ? active.filter(({ slaStatus }) => slaStatus !== "ok").length
        : undefined;

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
    (!search || [incident.id, incident.service, incident.description].some(
      (value) => value.toLocaleLowerCase("ru").includes(search),
    )) &&
    (!activeService || incident.service === activeService) &&
    (!activeTeam || incident.assignedTeam === activeTeam) &&
    (!sla || incident.slaStatus === sla) &&
    (!selectedGroup || incident.groups.includes(selectedGroup)) &&
    (view === "table" || incident.groups.length > 0) &&
    (!showRisksOnly || incident.hasEscalationRisk === true),
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
              className={`${controlClass} bg-background pr-2 pl-10`}
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

          <DashboardAlerts events={liveEvents} onOpen={(id) => {
            setQuery(id);
            setService("");
            setTeam("");
            setSla("");
            setSelectedGroup(null);
            setRisksOnly(false);
            setView("table");
            requestAnimationFrame(() => document.getElementById("incident-list-title")?.focus());
          }} />

          <Sheet>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                aria-label="Лента событий"
                className="size-10 rounded-control lg:w-auto lg:px-4"
              >
                <Bell aria-hidden="true" />
                <span className="hidden lg:inline">Лента событий</span>
              </Button>
            </SheetTrigger>

            <SheetContent showCloseButton={false} className="overflow-y-auto motion-reduce:animate-none">
              <SheetHeader className="p-6 pr-16">
                <SheetTitle>Лента событий</SheetTitle>
                <SheetDescription>Изменения в выгрузке инцидентов</SheetDescription>
              </SheetHeader>

              <SheetClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Закрыть ленту событий"
                  className="absolute top-4 right-4"
                >
                  <X aria-hidden="true" />
                </Button>
              </SheetClose>

              {events?.length ? (
                <ul className="divide-y px-6">
                  {events.map((event) => (
                    <li key={event.id} className="space-y-2 py-4">
                      <p className="font-medium">{event.title}</p>
                      <p className="text-muted-foreground">{event.incidentId}</p>
                      {event.details && <p>{event.details}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-6 text-muted-foreground">
                  {events ? "Событий пока нет." : "Ожидаем подключения ленты событий."}
                </p>
              )}
            </SheetContent>
          </Sheet>
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-2 text-label-md font-medium">
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

            <label className="grid gap-2 text-label-md font-medium">
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

            <label className="grid gap-2 text-label-md font-medium">
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

            <fieldset className="min-w-0">
              <legend className="mb-2 text-label-md font-medium">Вид списка</legend>
              <div className="flex min-h-12 rounded-control border bg-muted p-1">
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
                    <span className="flex h-full items-center justify-center whitespace-nowrap rounded-control px-2 text-label-md text-muted-foreground peer-checked:bg-card peer-checked:font-semibold peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
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
          recommendations={recommendations}
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
            />
          )}
        </section>
      </main>
    </>
  );
}