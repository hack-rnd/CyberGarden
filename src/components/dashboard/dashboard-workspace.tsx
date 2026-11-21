"use client";

import {
  Archive,
  ArrowDown,
  BarChart3,
  Download,
  LoaderCircle,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

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
import { IncidentArchive, useIncidentArchive } from "./incident-archive";
import { IncidentViews, statusLabels, useIncidentClock } from "./incident-views";
import { applyIncidentOverrides, toManualIncident } from "@/lib/manual-process";
import { saveIncidentOverrides } from "@/lib/manual-process-storage";
import {
  ManualProcessEditor,
  useManualProcesses,
  type ProcessEditorState,
} from "./manual-processes";

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

function filterOptions(values: (string | undefined)[]) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((first, second) => first.localeCompare(second, "ru"));
}

function MtsBadge({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`isolate block shrink-0 overflow-hidden rounded-[22%] bg-[#fe0031] shadow-sm ${className}`}
    >
      <Image
        src="/mts-logo.png"
        alt=""
        width={40}
        height={40}
        unoptimized
        className="block size-full scale-105 object-cover"
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% 100%, 60% 100%, 60% 75%, 0 75%)",
        }}
      />
    </span>
  );
}

// --- WORKSPACE ---

export function DashboardWorkspace({
  incidents: sourceIncidents,
  newIncidentIds,
  ai,
  events,
  liveEvents,
  connection = "pending",
}: DashboardWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [service, setService] = useState("");
  const [team, setTeam] = useState("");
  const [incidentStatus, setIncidentStatus] = useState(ALL_VALUE);
  const [sla, setSla] = useState("");
  const [view, setView] = useState<(typeof views)[number]["value"]>("table");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [uploadingJson, setUploadingJson] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<{ code: string } | null>(
    null,
  );
  const [processEditor, setProcessEditor] = useState<ProcessEditorState | null>(
    null,
  );
  const processTrigger = useRef<HTMLElement | null>(null);
  const { processes, overrides, save: saveProcess } = useManualProcesses();
  const manualById = new Map(processes.map((process) => [process.id, process]));
  const feedIncidents = sourceIncidents?.map((incident) =>
    applyIncidentOverrides(incident, overrides.get(incident.id)),
  );
  const incidents = processes.length
    ? [
        ...(feedIncidents ?? []),
        ...processes.map((process) => toManualIncident(process)),
      ]
    : feedIncidents;
  const catalog = [...(sourceIncidents ?? []), ...(incidents ?? [])];
  const productOptions = filterOptions(catalog.map(({ product }) => product));
  const assigneeOptions = filterOptions(
    catalog.map(({ assigneeTeam }) => assigneeTeam),
  );

  useEffect(() => {
    if (!archiveNotice) return;
    const timeout = window.setTimeout(() => setArchiveNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [archiveNotice]);

  useEffect(() => {
    if (!uploadStatus) return;
    const timeout = window.setTimeout(() => setUploadStatus(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [uploadStatus]);

  const [selectedGroup, setSelectedGroup] = useState<IncidentGroupId | null>(
    null,
  );
  const [risksOnly, setRisksOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const detailsTrigger = useRef<HTMLElement | null>(null);
  const archive = useIncidentArchive();
  const archivedById = new Map(
    archive.entries.map((entry) => [entry.id, entry]),
  );

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
    const archived = archivedById.get(incident.id);
    if (
      archived &&
      (archived.resolvedAt === undefined ||
        ((incident.status === "resolved" || incident.status === "closed") &&
          (resolvedAt === undefined ||
            resolvedAt === archived.resolvedAt ||
            resolvedAt <= archived.archivedAt)))
    ) {
      return [];
    }

    if (
      incident.status !== "resolved" ||
      (!incident.isRecentlyResolvedCritical && resolvedAt === undefined)
    ) {
      return [incident];
    }

    const timestamp = resolvedAt ?? null;
    criticalResolutions.set(incident.id, timestamp);

    return incident.groups.includes("CRITICAL") ||
      overrides.get(incident.id)?.groups !== undefined
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

  function archiveProcess(id: string) {
    const incident = incidents?.find((entry) => entry.id === id);
    if (incident) {
      archive.archive(incident);
      setArchiveNotice({ code: incident.code || incident.id });
      document
        .getElementById("incident-list-title")
        ?.focus({ preventScroll: true });
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
      setIncidentStatus(ALL_VALUE);
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
    setIncidentStatus(ALL_VALUE);
    setSla("");
    setSelectedGroup(null);
    setRisksOnly(false);
    setPage(1);
  }

  function openProcessEditor(trigger: HTMLElement, id?: string) {
    const process = id
      ? incidents?.find((incident) => incident.id === id)
      : undefined;
    if (id && !process) return;
    processTrigger.current = trigger;
    setProcessEditor({
      process,
      source: sourceIncidents?.find((incident) => incident.id === id),
    });
  }

  async function handleJsonUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || uploadingJson) return;

    setUploadingJson(true);
    setUploadStatus(null);
    try {
      const rawText = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        setUploadStatus({
          kind: "error",
          text: "Файл не является корректным JSON.",
        });
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      let response = await fetch("/api/upload-json", {
        method: "POST",
        body: formData,
      });

      if (!response.ok && (response.status === 400 || response.status === 415)) {
        response = await fetch("/api/upload-json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });
      }

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        count?: number;
        total?: number;
      };

      if (!response.ok) {
        setUploadStatus({
          kind: "error",
          text: body.error || "Не удалось загрузить JSON-файл.",
        });
        return;
      }

      const loadedCount =
        body.count ??
        body.total ??
        (Array.isArray(parsed) ? parsed.length : undefined);

      setPage(1);
      setUploadStatus({
        kind: "ok",
        text: loadedCount !== undefined
          ? `Файл «${file.name}» загружен (${loadedCount} записей).`
          : `Файл «${file.name}» успешно загружен.`,
      });
    } catch {
      setUploadStatus({
        kind: "error",
        text: "Ошибка сети при загрузке JSON-файла.",
      });
    } finally {
      setUploadingJson(false);
    }
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
      incidentStatus !== ALL_VALUE ||
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

  const tableMatches = visibleIncidents?.filter(
    (incident) =>
      (!search ||
        [incident.id, incident.product, incident.description].some((value) =>
          value.toLocaleLowerCase("ru").includes(search),
        )) &&
      (!activeService || incident.product === activeService) &&
      (!activeTeam || incident.assigneeTeam === activeTeam) &&
      (incidentStatus === ALL_VALUE || incident.status === incidentStatus) &&
      (!sla || currentSlaStatus(incident, now) === sla) &&
      (!selectedGroup || incident.groups.includes(selectedGroup)) &&
      (!showRisksOnly || incident.ai?.riskLevel === "high"),
  );
  const matches =
    view === "table"
      ? tableMatches
      : tableMatches?.filter((incident) => incident.groups.length > 0);

  const totalVisibleCount = visibleIncidents?.length ?? 0;

  async function exportToExcel() {
    if (!incidents || !tableMatches || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const { downloadIncidentWorkbook } = await import("./incident-export");
      await downloadIncidentWorkbook({
        incidents,
        tableIncidents: tableMatches,
        events,
        criticalResolutions,
      });
    } catch {
      setExportError("Не удалось скачать Excel. Попробуйте ещё раз.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-10 border-b border-white/10 bg-mts-ink text-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-6 sm:gap-4 lg:px-12">
          <span className="flex shrink-0 items-center gap-2.5 text-label-md font-bold tracking-wide text-white">
            <MtsBadge className="size-8 sm:size-9" />
            МТС{" "}
            <span className="hidden text-white/80 sm:inline">True Tech</span>
          </span>

          <div className="flex min-w-0 flex-1 justify-center">
            <div className="relative w-full max-w-md">
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
          </div>

          <div className="flex shrink-0 items-center gap-1 [&>button]:text-white [&>button:hover]:bg-white/10 [&>button:hover]:text-white">
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

      <div role="status" className="sr-only">
        {archiveNotice && `Инцидент ${archiveNotice.code} скрыт в архив.`}
      </div>
      {archiveNotice && (
        <div className="fixed right-4 bottom-4 z-40 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-panel border border-l-4 border-l-mts-emerald bg-card p-3 text-card-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
          <Archive
            className="size-5 shrink-0 text-mts-emerald"
            aria-hidden="true"
          />
          <p className="wrap-break-word text-label-md">
            Инцидент <strong>{archiveNotice.code}</strong> скрыт в архив.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto shrink-0"
            aria-label="Закрыть уведомление об архивации"
            onClick={() => setArchiveNotice(null)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      <MtsBadge className="pointer-events-none fixed bottom-4 left-2 z-10 size-7 sm:left-4 sm:size-9" />

      <main className="mx-auto w-full max-w-7xl px-6 pt-24 pb-12 lg:px-12">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl tracking-tight sm:text-headline-lg">
            Инциденты в фокусе
          </h1>

          <div className="flex flex-wrap items-center gap-3">
            <IncidentArchive
              entries={archive.entries}
              onRestore={archive.restore}
            />
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
                      ? `В 4 ключевых группах: ${matches.length} из ${totalVisibleCount}`
                      : `Найдено инцидентов: ${matches.length}`
                    : "Ожидаем подключения данных."}
                </span>
                {view === "groups" &&
                  totalVisibleCount > (matches?.length ?? 0) && (
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

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                aria-haspopup="dialog"
                className="h-10 rounded-control bg-mts-crimson text-white hover:bg-mts-wine"
                onClick={(event) => openProcessEditor(event.currentTarget)}
              >
                <Plus aria-hidden="true" />
                Добавить инцидент
              </Button>
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
              <input
                ref={uploadInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                aria-label="Выбрать JSON-файл инцидентов"
                onChange={handleJsonUpload}
              />
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-control"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploadingJson}
                aria-busy={uploadingJson}
              >
                {uploadingJson ? (
                  <LoaderCircle
                    className="size-4 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
                {uploadingJson ? "Загружаем…" : "Загрузить JSON"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-control"
                onClick={exportToExcel}
                disabled={!tableMatches || exporting}
                aria-busy={exporting}
              >
                <Download className="size-4" aria-hidden="true" />
                {exporting ? "Готовим Excel…" : "Скачать Excel"}
              </Button>
            </div>
          </div>

          {exportError && (
            <p role="alert" className="mt-2 text-label-md text-mts-crimson">
              {exportError}
            </p>
          )}

          {uploadStatus && (
            <p
              role={uploadStatus.kind === "error" ? "alert" : "status"}
              className={
                uploadStatus.kind === "error"
                  ? "mt-2 text-label-md text-mts-crimson"
                  : "mt-2 text-label-md text-[#007A62]"
              }
            >
              {uploadStatus.text}
            </p>
          )}

          <div
            aria-label="Фильтры и вид списка"
            className="mt-4 grid grid-cols-1 gap-4 rounded-panel border bg-background p-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6 xl:grid-cols-5"
          >
            <div className="grid min-w-0 gap-2">
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

            <div className="grid min-w-0 gap-2">
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

            <div className="grid min-w-0 gap-2">
              <label
                htmlFor="incident-status-filter"
                className="text-label-md font-medium"
              >
                Статус инцидента
              </label>
              <Select
                value={incidentStatus}
                onValueChange={(value) => {
                  setIncidentStatus(value);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  id="incident-status-filter"
                  className="h-12 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]">
                  <SelectGroup>
                    <SelectItem value={ALL_VALUE}>Все статусы</SelectItem>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="grid min-w-0 gap-2">
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

            <fieldset className="min-w-0">
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
              onArchive={archiveProcess}
              selected={selectedIncident}
              onOpenDetails={(id, event) => openDetails(id, event.currentTarget)}
              onEditProcess={(id, event) =>
                openProcessEditor(event.currentTarget, id)
              }
              isManualProcess={(id) => manualById.has(id)}
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
        <ManualProcessEditor
          editor={processEditor}
          products={productOptions}
          assignees={assigneeOptions}
          onClose={() => setProcessEditor(null)}
          restoreFocus={() => {
            if (processTrigger.current?.isConnected)
              processTrigger.current.focus();
            else document.getElementById("incident-list-title")?.focus();
          }}
          onSave={(fields, id) => {
            const source = processEditor?.source;
            const process = processEditor?.process;
            if (source && process) {
              const latestSource =
                sourceIncidents?.find((incident) => incident.id === source.id) ??
                source;
              saveIncidentOverrides(latestSource, process, fields);
              setProcessEditor(null);
              return;
            }
            const savedId = saveProcess(fields, id);
            setProcessEditor(null);
            if (!id) {
              resetAllFilters();
              setQuery(savedId);
              setView("table");
            }
          }}
        />
      </main>
    </>
  );
}