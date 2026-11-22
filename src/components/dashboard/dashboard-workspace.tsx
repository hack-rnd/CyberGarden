"use client";

import {
  Archive,
  ArrowDown,
  BarChart3,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  Monitor,
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
import { cn } from "@/lib/utils";
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
import { MtsLink } from "./incident-actions";
import { CriticalTopBanner } from "./critical-top-banner";
import {
  formatDuration,
  IncidentViews,
  PAGE_SIZE,
  sortIncidentsForTable,
  statusLabels,
  useIncidentClock,
} from "./incident-views";
import { applyIncidentOverrides, toManualIncident } from "@/lib/manual-process";
import { saveIncidentOverrides } from "@/lib/manual-process-storage";
import {
  ManualProcessEditor,
  useManualProcesses,
  type ProcessEditorState,
} from "./manual-processes";

// --- CONSTANTS ---

const ALL_VALUE = "__all__";
const MONITOR_FRESH_WINDOW_MS = 24 * 60 * 60_000;

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

const moscowClockFormat = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Moscow",
});

const moscowDateFormat = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "Europe/Moscow",
});

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

function formatMonitorSla(incident: DashboardIncident, now: number | null) {
  if (incident.status === "investigation") return "Этап RCA";
  const deadline = deadlineFor(incident);
  if (!Number.isFinite(deadline)) return "Без срока";
  if (now === null) return "—";
  const remaining = Math.ceil((deadline - now) / 1000);
  return remaining <= 0 ? "ПРОСРОЧЕН" : formatDuration(remaining);
}

function computeMonitorSlaPct(incident: DashboardIncident, now: number | null) {
  if (incident.status === "investigation" || now === null) return null;
  const deadline = deadlineFor(incident);
  if (!Number.isFinite(deadline)) return null;
  const created = Date.parse(incident.createdAt ?? "");
  const totalWindow =
    Number.isFinite(created) && deadline > created
      ? deadline - created
      : 3_600_000;
  const elapsed = Number.isFinite(created)
    ? now - created
    : totalWindow - (deadline - now);
  return Math.min(100, Math.max(4, Math.round((elapsed / totalWindow) * 100)));
}

function splitClockParts(now: number | null): {
  hm: string;
  sec: string;
  date: string;
} {
  if (now === null) {
    return { hm: "--:--", sec: "--", date: "—" };
  }
  const [hh = "--", mm = "--", ss = "--"] = moscowClockFormat
    .format(now)
    .split(":");
  return {
    hm: `${hh}:${mm}`,
    sec: ss,
    date: moscowDateFormat.format(now),
  };
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
  const [showClosed, setShowClosed] = useState(false);
  const [monitorMode, setMonitorMode] = useState(false);
  const [view, setView] = useState<(typeof views)[number]["value"]>("table");
  const [page, setPage] = useState(1);
  const [incidentJump, setIncidentJump] = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (!monitorMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMonitorMode(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [monitorMode]);

  useEffect(() => {
    if (!incidentJump || view !== "table" || monitorMode) return;

    const row = document.getElementById(`incident-row-${incidentJump.id}`);
    if (!row) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    row.scrollIntoView({
      behavior: reduceMotion ? "instant" : "smooth",
      block: "center",
      inline: "nearest",
    });

    const timeout = window.setTimeout(() => {
      setIncidentJump(null);
    }, 2_500);

    return () => window.clearTimeout(timeout);
  }, [incidentJump, page, view, monitorMode]);

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
  const handledIncidentLink = useRef<string | undefined>(undefined);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("incident");
    if (!id || handledIncidentLink.current === id) return;

    const incident =
      sourceIncidents?.find((item) => item.id === id) ??
      sourceIncidents?.find((item) => item.code === id);
    if (!incident) return;

    const frame = window.requestAnimationFrame(() => {
      handledIncidentLink.current = id;
      detailsTrigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setSelectedId(incident.id);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [sourceIncidents]);

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
    monitorMode ||
      (incidents?.some(
        (incident) =>
          isIncidentActive(incident) && Number.isFinite(deadlineFor(incident)),
      ) ??
        false),
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
        text:
          loadedCount !== undefined
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

  const activeIncidentIds = new Set(
    (visibleIncidents ?? [])
      .filter(
        (incident) =>
          incident.status !== "closed" && incident.status !== "resolved",
      )
      .map((incident) => incident.id),
  );

  const closedCount = (visibleIncidents ?? []).filter(
    (incident) => incident.status === "closed",
  ).length;
  const includeClosed =
    showClosed || incidentStatus === "closed" || Boolean(search);

  const hasRiskAssessments =
    visibleIncidents?.some(
      (incident) =>
        incident.ai !== null &&
        incident.status !== "closed" &&
        incident.status !== "resolved",
    ) ?? false;
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
        const active =
          id === "ASSIGNED_TO_COORDINATORS" || id === "INVESTIGATION"
            ? members.filter(
                (incident) =>
                  incident.status !== "closed" && incident.status !== "resolved",
              )
            : members.filter(isIncidentActive);
        const urgentSla = active.filter(
          (incident) =>
            incident.status !== "investigation" &&
            currentSlaStatus(incident, now) !== "ok",
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
      (includeClosed || incident.status !== "closed") &&
      (!search ||
        [incident.id, incident.product, incident.description].some((value) =>
          value.toLocaleLowerCase("ru").includes(search),
        )) &&
      (!activeService || incident.product === activeService) &&
      (!activeTeam || incident.assigneeTeam === activeTeam) &&
      (incidentStatus === ALL_VALUE || incident.status === incidentStatus) &&
      (!sla || currentSlaStatus(incident, now) === sla) &&
      (!selectedGroup || incident.groups.includes(selectedGroup)) &&
      (!showRisksOnly ||
        (incident.ai?.riskLevel === "high" &&
          incident.status !== "closed" &&
          incident.status !== "resolved")),
  );
  const matches =
    view === "table"
      ? tableMatches
      : tableMatches?.filter((incident) => incident.groups.length > 0);

  const criticalIncidents = (visibleIncidents ?? []).filter(
    (incident) =>
      isIncidentActive(incident) &&
      (incident.priority === "critical" || incident.groups.includes("CRITICAL")),
  );

  const monitorIncomingIncidents = monitorMode
    ? sortIncidentsForTable(
        (visibleIncidents ?? []).filter((incident) => {
          if (incident.status === "closed" || incident.status === "resolved") {
            return false;
          }
          const isCrit =
            incident.priority === "critical" ||
            incident.groups.includes("CRITICAL");
          const isUnassigned = !incident.assigneeEmployee?.trim();
          const createdMs = Date.parse(incident.createdAt ?? "");
          const isRecent =
            now === null ||
            (Number.isFinite(createdMs) &&
              now - createdMs <= MONITOR_FRESH_WINDOW_MS);
          return isCrit || isUnassigned || isRecent;
        }),
        criticalResolutions,
        now,
      )
    : [];

  const serviceHealthMap = new Map<
    string,
    { product: string; level: "critical" | "degraded" | "ok"; count: number }
  >();
  if (monitorMode) {
    for (const incident of visibleIncidents ?? []) {
      let existing = serviceHealthMap.get(incident.product);
      if (!existing) {
        existing = { product: incident.product, level: "ok", count: 0 };
        serviceHealthMap.set(incident.product, existing);
      }
      const isOpen =
        incident.status !== "closed" &&
        incident.status !== "resolved" &&
        incident.status !== "investigation";
      if (isOpen) {
        existing.count++;
        const isCrit =
          incident.priority === "critical" ||
          incident.groups.includes("CRITICAL");
        if (isCrit) {
          existing.level = "critical";
        } else if (existing.level !== "critical") {
          existing.level = "degraded";
        }
      }
    }
  }
  const healthOrder = { critical: 0, degraded: 1, ok: 2 };
  const serviceHealthItems = Array.from(serviceHealthMap.values())
    .sort(
      (a, b) =>
        healthOrder[a.level] - healthOrder[b.level] ||
        b.count - a.count ||
        a.product.localeCompare(b.product, "ru"),
    )
    .slice(0, 10);

  const clockParts = splitClockParts(now);

  function jumpToIncident(id: string) {
    const target = (visibleIncidents ?? []).find((item) => item.id === id);
    if (!target) return;

    const targetIsClosed = target.status === "closed";
    if (targetIsClosed) setShowClosed(true);

    const pool = (visibleIncidents ?? []).filter(
      (item) => targetIsClosed || showClosed || item.status !== "closed",
    );
    const orderedIncidents = sortIncidentsForTable(
      pool,
      criticalResolutions,
      now,
    );
    const index = orderedIncidents.findIndex((incident) => incident.id === id);
    if (index === -1) return;

    resetAllFilters();
    setView("table");
    setPage(Math.floor(index / PAGE_SIZE) + 1);
    setIncidentJump({ id });
  }

  const totalVisibleCount = (visibleIncidents ?? []).filter(
    (incident) => includeClosed || incident.status !== "closed",
  ).length;

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
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-10 border-b border-white/10 bg-mts-ink text-white",
          monitorMode && "invisible pointer-events-none",
        )}
      >
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
                className="pointer-events-none absolute top-3 left-3.5 size-4 text-white/50"
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden h-9 gap-1.5 rounded-control px-2.5 text-label-sm md:inline-flex"
              onClick={() => setMonitorMode(true)}
            >
              <Monitor className="size-4" aria-hidden="true" />
              Монитор
            </Button>
            <DashboardAlerts
              events={liveEvents}
              incidents={visibleIncidents ?? []}
              hidden={monitorMode}
              onJump={jumpToIncident}
              onOpen={openDetails}
            />
            <EventFeed
              events={events}
              liveEvents={liveEvents}
              visibleIncidentIds={incidentIds}
              onChoose={openDetails}
            />
          </div>
        </div>
      </header>

      {monitorMode && (
        <div
          role="region"
          aria-label="Панорамный режим монитора смены"
          className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#0D0F12] text-[#F5F7FA]"
        >
          <div className="border-b border-[#242830] bg-[#16191D] px-6 py-3.5 xl:px-10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <MtsBadge className="size-10" />
                <div>
                  <p className="font-heading text-body-md font-semibold tracking-tight text-white">
                    МТС True Tech · Монитор координатора 24/7
                  </p>
                  <p className="text-label-sm text-[#8F98A3]">
                    Оперативный контроль IT-сервисов и массовых инцидентов
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div
                  aria-label="Текущее московское время"
                  className="flex items-center gap-4 rounded-control border border-[#2C313A] bg-[#0D0F12] px-4 py-2"
                >
                  <time className="flex items-baseline gap-1 font-heading leading-none tabular-nums">
                    <span className="text-[30px] font-semibold tracking-tight text-white">
                      {clockParts.hm}
                    </span>
                    <span className="text-[18px] font-medium text-[#8F98A3]">
                      :{clockParts.sec}
                    </span>
                  </time>
                  <span
                    aria-hidden="true"
                    className="h-8 w-px bg-[#2C313A]"
                  />
                  <div className="leading-tight">
                    <p className="text-[11px] font-bold tracking-wider text-[#8F98A3] uppercase">
                      МСК · UTC+3
                    </p>
                    <p className="mt-0.5 text-label-sm font-medium text-[#E4E8EE] capitalize">
                      {clockParts.date}
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-control border-[#353B45] bg-[#1C2026] px-4 text-[#E4E8EE] hover:border-[#535B66] hover:bg-[#252A32] hover:text-white"
                  onClick={() => setMonitorMode(false)}
                >
                  <X className="size-4" aria-hidden="true" />
                  Выйти (Esc)
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-5 px-6 py-5 xl:px-10">
            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:gap-4">
              {incidentGroups.map(({ id, title, marker }) => {
                const count = metrics?.get(id)?.active ?? 0;
                const isCrit = id === "CRITICAL" && count > 0;
                const isCoord =
                  id === "ASSIGNED_TO_COORDINATORS" && count > 0;
                const darkMarker =
                  id === "ASSIGNED_TO_COORDINATORS" ? "bg-[#E4E8EE]" : marker;

                return (
                  <li
                    key={id}
                    className={cn(
                      "flex items-center justify-between rounded-panel border px-5 py-4",
                      isCrit
                        ? "monitor-critical-pulse border-2 border-mts-red"
                        : isCoord
                          ? "border-[#424955] bg-[#16191D]"
                          : "border-[#242830] bg-[#16191D]",
                    )}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-label-md font-medium text-[#E4E8EE]">
                        <span className={`size-2.5 rounded-pill ${darkMarker}`} />
                        {title}
                      </div>
                      <p className="text-label-sm text-[#8F98A3]">
                        {isCrit
                          ? "Требуется немедленная реакция"
                          : isCoord
                            ? "Ожидают передачи команде"
                            : "Активные сейчас"}
                      </p>
                    </div>
                    <p
                      className={cn(
                        "font-heading text-[44px] leading-none font-semibold tabular-nums",
                        isCrit ? "text-mts-red" : "text-white",
                      )}
                    >
                      {count}
                    </p>
                  </li>
                );
              })}
            </ul>

            {serviceHealthItems.length > 0 && (
              <section className="rounded-panel border border-[#242830] bg-[#16191D] px-5 py-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="font-sans text-label-sm font-semibold tracking-wider text-[#8F98A3] uppercase">
                    Состояние IT-сервисов
                  </h2>
                  <div className="flex items-center gap-4 text-[12px] text-[#8F98A3]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-mts-red" />
                      Сбой
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-[#EB4A13]" />
                      Деградация
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-[#00A887]" />
                      Штатно
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {serviceHealthItems.map((item) => (
                    <div
                      key={item.product}
                      className={cn(
                        "inline-flex items-center gap-2.5 rounded-control border border-[#2B313B] border-l-[3px] bg-[#1C2026] px-3 py-2 text-label-sm",
                        item.level === "critical" && "border-l-mts-red",
                        item.level === "degraded" && "border-l-[#EB4A13]",
                        item.level === "ok" && "border-l-[#00A887]",
                      )}
                    >
                      <span className="font-medium text-[#F5F7FA]">
                        {item.product}
                      </span>
                      {item.level === "critical" ? (
                        <span className="rounded-pill bg-mts-red px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
                          Сбой · {item.count}
                        </span>
                      ) : item.level === "degraded" ? (
                        <span className="text-[12px] font-medium text-[#D6DADF] tabular-nums">
                          Деградация · {item.count}
                        </span>
                      ) : (
                        <span className="text-[12px] font-medium text-[#00C19B]">
                          Штатно
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-title-lg font-medium text-white">
                  Поток новых и активных инцидентов (
                  {monitorIncomingIncidents.length})
                </h2>
                <span className="text-label-sm text-[#8F98A3]">
                  Критические закреплены сверху · клик по строке откроет
                  карточку
                </span>
              </div>

              {monitorIncomingIncidents.length > 0 ? (
                <ul className="space-y-2.5">
                  {monitorIncomingIncidents.map((incident) => {
                    const isCrit =
                      incident.priority === "critical" ||
                      incident.groups.includes("CRITICAL");
                    const slaText = formatMonitorSla(incident, now);
                    const slaPct = computeMonitorSlaPct(incident, now);
                    const isBreached = slaText === "ПРОСРОЧЕН";
                    const hasAssignee = Boolean(
                      incident.assigneeEmployee?.trim(),
                    );

                    return (
                      <li key={incident.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setMonitorMode(false);
                            openDetails(incident.id);
                          }}
                          className={cn(
                            "grid w-full cursor-pointer grid-cols-1 items-center gap-3 rounded-panel border border-l-4 px-5 py-3.5 text-left transition-colors duration-150 lg:grid-cols-12",
                            isCrit
                              ? "monitor-critical-pulse border-l-mts-red"
                              : !hasAssignee
                                ? "border-[#2B313B] border-l-[#EB4A13] bg-[#16191D] hover:bg-[#1C2026]"
                                : "border-[#242830] border-l-[#007CFF] bg-[#16191D] hover:bg-[#1C2026]",
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
                            <span
                              className={cn(
                                "font-heading text-label-md font-semibold tabular-nums",
                                isCrit ? "text-mts-red" : "text-white",
                              )}
                            >
                              {incident.id}
                            </span>
                            {isCrit && (
                              <span className="rounded-pill bg-mts-red px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                                Критический
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 lg:col-span-2">
                            <p className="truncate font-semibold text-white">
                              {incident.product}
                            </p>
                            <p className="text-[11px] text-[#8F98A3]">
                              {incident.serviceType || "IT-сервис"}
                              {incident.isMaster ? " · Мастер-МИ" : ""}
                            </p>
                          </div>

                          <div className="min-w-0 lg:col-span-4">
                            <p className="line-clamp-1 text-label-md font-medium text-[#F5F7FA]">
                              {incident.title || incident.description}
                            </p>
                            <p className="line-clamp-1 text-label-sm text-[#8F98A3]">
                              {incident.description}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
                            {hasAssignee ? (
                              <div className="min-w-0">
                                <p className="truncate text-label-sm font-medium text-[#F5F7FA]">
                                  {incident.assigneeEmployee}
                                </p>
                                <p className="truncate text-[11px] text-[#8F98A3]">
                                  {incident.assigneeTeam}
                                </p>
                              </div>
                            ) : (
                              <span className="rounded-control border border-[#EB4A13]/60 bg-[#261B16] px-2.5 py-1 text-label-sm font-semibold text-[#F5F7FA]">
                                Исполнитель не указан
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-3 lg:col-span-2 lg:flex-col lg:items-end lg:gap-1.5">
                            <span className="rounded-pill border border-[#303640] bg-[#1C2026] px-2.5 py-0.5 text-[11px] font-medium text-[#E4E8EE]">
                              {statusLabels[incident.status]}
                            </span>
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={cn(
                                  "font-heading text-body-md font-semibold tabular-nums",
                                  isCrit || isBreached
                                    ? "text-mts-red"
                                    : "text-[#00C19B]",
                                )}
                              >
                                {slaText}
                              </span>
                              {slaPct !== null && (
                                <div className="h-1.5 w-24 overflow-hidden rounded-pill bg-[#2B313B]">
                                  <div
                                    className={cn(
                                      "h-full rounded-pill",
                                      isBreached || slaPct >= 75
                                        ? "bg-mts-red"
                                        : slaPct >= 60
                                          ? "bg-[#EB4A13]"
                                          : "bg-[#00A887]",
                                    )}
                                    style={{ width: `${slaPct}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-panel border border-[#242830] bg-[#16191D] p-8 text-center">
                  <p className="font-heading text-title-lg text-[#00C19B]">
                    Новых активных инцидентов нет — сервисы работают штатно
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      <div role="status" className="sr-only">
        {archiveNotice && `Инцидент ${archiveNotice.code} скрыт в архив.`}
      </div>
      {!monitorMode && archiveNotice && (
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

      <main
        className={cn(
          "mx-auto w-full max-w-7xl px-6 pt-24 pb-12 lg:px-12",
          monitorMode && "hidden",
        )}
      >
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl tracking-tight sm:text-headline-lg">
            Инциденты в фокусе
          </h1>

          <div className="flex flex-wrap items-center gap-3">
            <MtsLink events={liveEvents} />
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

        <CriticalTopBanner
          incidents={criticalIncidents}
          now={now}
          onJumpToIncident={jumpToIncident}
        />

        <DashboardSummary
          metrics={metrics}
          selectedGroup={selectedGroup}
          onSelectGroup={handleSelectGroup}
          ai={ai}
          activeIncidentIds={activeIncidentIds}
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
              {closedCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-control"
                  onClick={() => {
                    setShowClosed((prev) => !prev);
                    setPage(1);
                  }}
                >
                  {includeClosed ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                  {includeClosed
                    ? "Скрыть закрытые"
                    : `Закрытые (${closedCount})`}
                </Button>
              )}
              <Button
                type="button"
                aria-haspopup="dialog"
                className="h-10 rounded-control bg-mts-red text-white hover:bg-mts-crimson"
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
                <SelectTrigger className="h-11 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted">
                  <SelectValue placeholder="Все продукты" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="max-h-72 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]"
                >
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
                <SelectTrigger className="h-11 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted">
                  <SelectValue placeholder="Все команды" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="max-h-72 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]"
                >
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
                  className="h-11 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="max-h-72 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]"
                >
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
                <SelectTrigger className="h-11 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted">
                  <SelectValue placeholder="Все статусы SLA" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="max-h-72 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]"
                >
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
              <div className="flex min-h-11 rounded-control border bg-card p-1">
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
              selectedIsServerBacked={Boolean(
                sourceIncidents?.some(({ id }) => id === selectedId),
              )}
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
              highlightedIncidentId={incidentJump?.id}
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