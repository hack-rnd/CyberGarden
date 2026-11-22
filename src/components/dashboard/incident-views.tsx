"use client";

import {
  Archive,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Pencil,
  UserPlus,
  X,
} from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from "react";

import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  currentSlaStatus,
  deadlineFor,
  isIncidentActive,
  type DashboardIncident,
} from "./dashboard-model";

import { incidentGroups, type IncidentGroupId } from "./dashboard-summary";
import { IncidentDetails } from "./incident-details";
import type { AiAnalysisControls } from "./dashboard-ai";

// --- CONSTANTS ---

export const PAGE_SIZE = 10;
const IDLE_WAITING_MS = 20_000;
const URGENT_SLA_THRESHOLD = 0.25;

export const statusLabels: Record<DashboardIncident["status"], string> = {
  new: "Новый",
  in_progress: "В работе",
  waiting: "Ожидает",
  investigation: "Исследование ситуации",
  resolved: "Решён",
  closed: "Закрыт",
};

const statusBadgeClasses: Record<DashboardIncident["status"], string> = {
  new: "border-border bg-secondary text-foreground",
  waiting: "border-border bg-secondary text-foreground",
  in_progress: "border-mts-blue/30 bg-mts-blue/10 text-[#005EC4]",
  investigation: "border-mts-blue/25 bg-mts-blue/10 text-[#005EC4]",
  resolved: "border-mts-emerald/40 bg-mts-emerald/10 text-foreground",
  closed: "border-border bg-muted text-muted-foreground",
};

export const priorityLabels = {
  critical: "Критический",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const UNASSIGNED_TEAM_LABELS = new Set([
  "",
  "не назначена",
  "не назначен",
  "не указан",
  "не указана",
]);

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

// --- CLOCK HELPERS ---

function subscribeToClock(onTick: () => void) {
  const timer = window.setInterval(onTick, 1000);
  return () => window.clearInterval(timer);
}

function readClock() {
  return Math.floor(Date.now() / 1000) * 1000;
}

function readServerClock() {
  return null;
}

function subscribeWithoutTimers() {
  return () => {};
}

export function useIncidentClock(enabled: boolean) {
  return useSyncExternalStore(
    enabled ? subscribeToClock : subscribeWithoutTimers,
    enabled ? readClock : readServerClock,
    readServerClock,
  );
}

// --- SORTING & PRIORITY HELPERS ---

function isActiveCritical(incident: DashboardIncident) {
  return (
    isIncidentActive(incident) &&
    (incident.groups.includes("CRITICAL") || incident.priority === "critical")
  );
}

function hasRealTeam(team: string | null | undefined): boolean {
  if (!team) return false;
  return !UNASSIGNED_TEAM_LABELS.has(team.trim().toLowerCase());
}

function hasAssignedEmployee(incident: DashboardIncident): boolean {
  return Boolean(incident.assigneeEmployee?.trim());
}

function getSlaRemainingRatio(
  incident: DashboardIncident,
  now: number | null,
): number | null {
  if (!isIncidentActive(incident)) return null;
  const deadline = deadlineFor(incident);
  if (!Number.isFinite(deadline)) return null;

  const created = Date.parse(incident.createdAt ?? "");
  const totalWindow =
    Number.isFinite(created) && deadline > created
      ? deadline - created
      : 3_600_000;

  if (now !== null) {
    return (deadline - now) / totalWindow;
  }
  if (incident.slaRemainingMs !== null) {
    return incident.slaRemainingMs / totalWindow;
  }
  return null;
}

function isSlaBelowQuarter(
  incident: DashboardIncident,
  now: number | null,
): boolean {
  const ratio = getSlaRemainingRatio(incident, now);
  return ratio !== null && ratio < URGENT_SLA_THRESHOLD;
}

function getIncidentRankTier(
  incident: DashboardIncident,
  now: number | null,
): number {
  if (isActiveCritical(incident)) return 0;

  if (incident.status === "resolved") return 5;
  if (incident.status === "closed") return 6;

  if (isSlaBelowQuarter(incident, now)) return 1;

  if (
    !hasAssignedEmployee(incident) ||
    incident.status === "new" ||
    incident.status === "waiting"
  ) {
    return 2;
  }

  if (incident.status === "in_progress") return 3;

  return 4;
}

export function formatDuration(seconds: number) {
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function sortIncidentsForTable(
  incidents: readonly DashboardIncident[],
  criticalResolutions: ReadonlyMap<string, number | null> = new Map(),
  now: number | null = null,
): DashboardIncident[] {
  return [...incidents].sort((first, second) => {
    const firstTier = getIncidentRankTier(first, now);
    const secondTier = getIncidentRankTier(second, now);
    if (firstTier !== secondTier) return firstTier - secondTier;

    if (firstTier === 0) {
      const firstUnassigned = hasAssignedEmployee(first) ? 1 : 0;
      const secondUnassigned = hasAssignedEmployee(second) ? 1 : 0;
      if (firstUnassigned !== secondUnassigned) {
        return firstUnassigned - secondUnassigned;
      }

      const firstUrgent = isSlaBelowQuarter(first, now) ? 0 : 1;
      const secondUrgent = isSlaBelowQuarter(second, now) ? 0 : 1;
      if (firstUrgent !== secondUrgent) return firstUrgent - secondUrgent;

      const firstCreated = Date.parse(first.createdAt ?? "") || 0;
      const secondCreated = Date.parse(second.createdAt ?? "") || 0;
      if (firstCreated !== secondCreated) return secondCreated - firstCreated;
    }

    if (firstTier === 1) {
      const firstRatio = getSlaRemainingRatio(first, now) ?? 1;
      const secondRatio = getSlaRemainingRatio(second, now) ?? 1;
      if (firstRatio !== secondRatio) return firstRatio - secondRatio;
    }

    if (firstTier === 2) {
      const firstCreated = Date.parse(first.createdAt ?? "") || 0;
      const secondCreated = Date.parse(second.createdAt ?? "") || 0;
      if (firstCreated !== secondCreated) return secondCreated - firstCreated;
    }

    const firstResolution = criticalResolutions.get(first.id);
    const secondResolution = criticalResolutions.get(second.id);
    if (firstResolution !== undefined || secondResolution !== undefined) {
      return (
        (secondResolution === undefined ? -1 : secondResolution ?? 0) -
        (firstResolution === undefined ? -1 : firstResolution ?? 0)
      );
    }

    const firstDeadline = isIncidentActive(first)
      ? deadlineFor(first)
      : Infinity;
    const secondDeadline = isIncidentActive(second)
      ? deadlineFor(second)
      : Infinity;
    if (firstDeadline !== secondDeadline) {
      return firstDeadline - secondDeadline;
    }

    const firstCreated = Date.parse(first.createdAt ?? "") || 0;
    const secondCreated = Date.parse(second.createdAt ?? "") || 0;
    return secondCreated - firstCreated;
  });
}

function buildPageNumbers(
  current: number,
  total: number,
): (number | "ellipsis")[] {
  if (total <= 3) {
    return Array.from({ length: total }, (_, idx) => idx + 1);
  }
  if (current <= 2) {
    return [1, 2, 3, "ellipsis", total];
  }
  if (current >= total - 1) {
    return [1, "ellipsis", total - 2, total - 1, total];
  }
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total];
}

function computeSlaProgress(
  incident: DashboardIncident,
  now: number,
  deadline: number,
): { percent: number; barClass: string } {
  const created = Date.parse(incident.createdAt ?? "");
  const totalWindow =
    Number.isFinite(created) && deadline > created
      ? deadline - created
      : 3_600_000;
  const elapsed = Number.isFinite(created)
    ? now - created
    : totalWindow - (deadline - now);
  const ratio = Math.min(1, Math.max(0, elapsed / totalWindow));
  const percent = Math.round(ratio * 100);

  if (now >= deadline || percent >= 75) {
    return {
      percent: Math.min(100, Math.max(75, percent)),
      barClass: "bg-mts-red",
    };
  }
  if (percent >= 60) {
    return { percent, barClass: "bg-mts-amber" };
  }
  return { percent: Math.max(6, percent), barClass: "bg-mts-emerald" };
}

// --- CELL COMPONENTS ---

function ContextBadges({
  incident,
  compact = false,
}: {
  incident: DashboardIncident;
  compact?: boolean;
}) {
  const badges: { label: string; className: string }[] = [];

  if (incident.isNeedUp) {
    badges.push({
      label: "Требует УП",
      className: "border-border bg-secondary text-foreground",
    });
  }
  if (incident.isMaster) {
    badges.push({
      label: "Мастер-МИ",
      className: "border-mts-ink/25 bg-mts-ink/8 text-mts-ink",
    });
  }
  if (incident.isEffect) {
    badges.push({
      label: "Следствие",
      className: "border-mts-blue/30 bg-mts-blue/10 text-[#005EC4]",
    });
  }
  if (incident.isDouble) {
    badges.push({
      label: "Дубль",
      className: "border-border bg-muted text-muted-foreground",
    });
  }
  if (incident.serviceType === "Клиентский") {
    badges.push({
      label: "Клиентский",
      className: "border-mts-red/30 bg-mts-red/8 text-mts-crimson",
    });
  }

  if (!badges.length) return null;

  return (
    <div
      className={cn("flex flex-wrap gap-1", compact ? "mt-1.5" : "mt-2")}
      aria-label="Атрибуты инцидента"
    >
      {badges.map(({ label, className }) => (
        <Badge
          key={label}
          variant="outline"
          className={cn(
            "h-auto rounded-pill px-2 py-0.5 text-[11px] leading-tight font-semibold whitespace-nowrap",
            className,
          )}
        >
          {label}
        </Badge>
      ))}
    </div>
  );
}

function SlaTimer({
  incident,
  now,
  resolvedAt,
  showBar = false,
}: {
  incident: DashboardIncident;
  now: number | null;
  resolvedAt?: number | null;
  showBar?: boolean;
}) {
  if (incident.status === "investigation") {
    return (
      <span className="text-label-sm font-medium text-[#005EC4] whitespace-nowrap">
        Этап RCA
      </span>
    );
  }

  const deadline = deadlineFor(incident);

  if (!isIncidentActive(incident)) {
    if (resolvedAt == null || !Number.isFinite(deadline)) {
      return <span className="text-muted-foreground">Завершён</span>;
    }
    const remaining = Math.ceil((deadline - resolvedAt) / 1000);
    return (
      <span className="text-muted-foreground">
        <span className="sr-only">SLA на момент решения: </span>
        <s className="tabular-nums">
          {resolvedAt >= deadline ? "Просрочен" : formatDuration(remaining)}
        </s>
      </span>
    );
  }
  if (!Number.isFinite(deadline)) {
    return <span className="text-muted-foreground">Срок не задан</span>;
  }
  if (now === null) return <span className="text-muted-foreground">—</span>;

  const liveSla = currentSlaStatus(incident, now);
  const seconds = Math.ceil((deadline - now) / 1000);
  const belowQuarter = isSlaBelowQuarter(incident, now);
  const emphasis = cn(
    "whitespace-nowrap font-semibold tabular-nums",
    (seconds <= 0 ||
      liveSla === "breached" ||
      belowQuarter ||
      isActiveCritical(incident)) &&
      "text-mts-crimson",
    seconds > 0 &&
      !belowQuarter &&
      !isActiveCritical(incident) &&
      (liveSla === "critical" || liveSla === "warning") &&
      "text-mts-amber",
  );

  const progress = showBar ? computeSlaProgress(incident, now, deadline) : null;

  return (
    <div className="inline-flex min-w-[84px] flex-col gap-1">
      {seconds <= 0 ? (
        <span className={emphasis}>Просрочен</span>
      ) : (
        <time dateTime={`PT${seconds}S`} className={emphasis}>
          {formatDuration(seconds)}
        </time>
      )}
      {progress && (
        <div
          aria-hidden="true"
          className="h-1 w-full overflow-hidden rounded-pill bg-border"
        >
          <div
            className={cn(
              "h-full rounded-pill transition-[width] duration-300",
              progress.barClass,
            )}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

function OpenItsm({
  incident,
  label = "В ITSM",
}: {
  incident: DashboardIncident;
  label?: string;
}) {
  let href: string | undefined;
  try {
    const url = incident.itsmUrl ? new URL(incident.itsmUrl) : undefined;
    if (url?.protocol === "https:" || url?.protocol === "http:") href = url.href;
  } catch {
    href = undefined;
  }

  if (!href) {
    return (
      <span className="text-label-sm text-muted-foreground">
        Нет ссылки в ITSM
      </span>
    );
  }

  return (
    <Button asChild variant="outline" className="h-9 rounded-control px-3">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`В ITSM: ${incident.id} (новая вкладка)`}
      >
        {label} <ArrowUpRight aria-hidden="true" />
      </a>
    </Button>
  );
}

function GroupTags({
  incident,
  currentGroup,
}: {
  incident: DashboardIncident;
  currentGroup?: IncidentGroupId;
}) {
  const tags = incidentGroups.filter(
    ({ id }) => id !== currentGroup && incident.groups.includes(id),
  );

  if (!tags.length) {
    return currentGroup ? null : <span className="text-muted-foreground">—</span>;
  }

  return (
    <ul
      aria-label={currentGroup ? "Другие группы" : "Группы инцидента"}
      className="flex flex-wrap gap-1"
    >
      {tags.map(({ id, title, marker }) => (
        <li key={id}>
          <Badge
            variant="outline"
            className="h-auto rounded-pill px-2 py-0.5 text-[11px] whitespace-nowrap"
          >
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-pill ${marker}`}
            />
            {title}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function IncidentDate({ createdAt }: { createdAt?: string | null }) {
  const timestamp = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(timestamp)) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <time
      dateTime={new Date(timestamp).toISOString()}
      title="Московское время"
      className="whitespace-nowrap text-label-sm"
    >
      {dateFormat.format(timestamp)}
    </time>
  );
}

function IncidentStatus({
  incident,
  resolvedAt,
}: {
  incident: DashboardIncident;
  resolvedAt?: number | null;
}) {
  if (resolvedAt !== undefined) {
    return (
      <Badge
        variant="outline"
        className="h-auto rounded-pill border-mts-emerald bg-mts-emerald/10 px-2.5 py-0.5 text-label-sm font-semibold text-foreground"
      >
        Критический решён
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-auto rounded-pill px-2.5 py-0.5 text-label-sm whitespace-nowrap",
        statusBadgeClasses[incident.status],
      )}
    >
      {statusLabels[incident.status]}
    </Badge>
  );
}

function ArchiveButton({
  id,
  onArchive,
  compact = false,
}: {
  id: string;
  onArchive: (id: string) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Скрыть в архив"
        aria-label={`Скрыть в архив: ${id}`}
        className="size-8 rounded-control text-muted-foreground hover:text-foreground"
        onClick={() => onArchive(id)}
      >
        <Archive className="size-4" aria-hidden="true" />
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-9 px-3"
      onClick={() => onArchive(id)}
    >
      Скрыть в архив<span className="sr-only">: {id}</span>
    </Button>
  );
}

type OpenDetails = (id: string, event: MouseEvent<HTMLButtonElement>) => void;

function DetailsButton({
  id,
  onOpenDetails,
  compact = false,
}: {
  id: string;
  onOpenDetails: OpenDetails;
  compact?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-haspopup="dialog"
      aria-label={`Детали инцидента ${id}`}
      className={compact ? "h-8 rounded-control px-2.5 text-label-sm" : "h-9 rounded-control px-3"}
      onClick={(event) => onOpenDetails(id, event)}
    >
      Детали
    </Button>
  );
}

function EditButton({
  id,
  onEditProcess,
  compact = false,
}: {
  id: string;
  onEditProcess: OpenDetails;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Редактировать локальный процесс"
        aria-label={`Редактировать инцидент ${id}`}
        className="size-8 rounded-control text-muted-foreground hover:text-foreground"
        onClick={(event) => onEditProcess(id, event)}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      aria-haspopup="dialog"
      aria-label={`Редактировать инцидент ${id}`}
      className="h-9 rounded-control px-3"
      onClick={(event) => onEditProcess(id, event)}
    >
      <Pencil className="size-3.5" aria-hidden="true" />
      Редактировать
    </Button>
  );
}

function AssigneeCell({
  incident,
  onAssign,
}: {
  incident: DashboardIncident;
  onAssign: OpenDetails;
}) {
  const employee = incident.assigneeEmployee?.trim() || "";
  const team = hasRealTeam(incident.assigneeTeam)
    ? incident.assigneeTeam.trim()
    : "";

  return (
    <div className="space-y-1.5">
      {employee ? (
        <div>
          <p className="text-label-md font-medium text-foreground">{employee}</p>
          {team && <p className="text-label-sm text-muted-foreground">{team}</p>}
        </div>
      ) : (
        <>
          <p className="text-label-sm font-medium text-muted-foreground">
            Исполнитель не указан
          </p>
          {team && <p className="text-[11px] text-muted-foreground">{team}</p>}
          {incident.status !== "closed" && (
            <Button
              type="button"
              variant="outline"
              className="h-7 rounded-control border-mts-red/40 bg-card px-2 text-[12px] font-medium text-mts-crimson transition-all duration-200 hover:bg-mts-red hover:text-white active:scale-[0.98]"
              onClick={(event) => onAssign(incident.id, event)}
            >
              <UserPlus className="size-3.5" aria-hidden="true" />
              Указать
            </Button>
          )}
        </>
      )}
    </div>
  );
}

// --- CARD VIEW ---

function IncidentCard({
  incident,
  currentGroup,
  now,
  resolvedAt,
  onArchive,
  onOpenDetails,
  onAssign,
  onEditProcess,
  canEdit,
}: {
  incident: DashboardIncident;
  currentGroup: IncidentGroupId;
  now: number | null;
  resolvedAt?: number | null;
  onArchive: (id: string) => void;
  onOpenDetails: OpenDetails;
  onAssign: OpenDetails;
  onEditProcess?: OpenDetails;
  canEdit: boolean;
}) {
  const criticalActive = isActiveCritical(incident);
  const isResolved = resolvedAt !== undefined || incident.status === "resolved";

  return (
    <article
      className={cn(
        "space-y-4 rounded-panel border bg-card p-6 transition-all duration-200 hover:shadow-[0_4px_16px_rgba(29,32,35,0.08)] motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none",
        criticalActive && "border-l-4 border-l-mts-red bg-mts-red/[0.02]",
        !criticalActive && isResolved && "border-l-4 border-l-mts-emerald",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-label-sm text-muted-foreground">
            <span className={cn(criticalActive && "font-semibold text-mts-crimson")}>
              {incident.id}
            </span>
            {criticalActive && (
              <Badge
                variant="outline"
                className="rounded-pill border-mts-red/40 bg-mts-red/10 px-2 py-0 text-[11px] font-bold text-mts-crimson"
              >
                Закреплён
              </Badge>
            )}
          </p>
          <h4 className="mt-1 font-sans text-body-md font-semibold wrap-break-word">
            {incident.product}
          </h4>
          <ContextBadges incident={incident} compact />
        </div>
        <IncidentStatus incident={incident} resolvedAt={resolvedAt} />
      </div>
      <GroupTags incident={incident} currentGroup={currentGroup} />
      <dl className="grid grid-cols-2 gap-4 text-label-md">
        <div>
          <dt className="text-muted-foreground">Исполнитель</dt>
          <dd className="mt-1 wrap-break-word">
            <AssigneeCell incident={incident} onAssign={onAssign} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Создан</dt>
          <dd className="mt-1">
            <IncidentDate createdAt={incident.createdAt} />
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-label-md">
          <span className="text-muted-foreground">SLA</span>
          <SlaTimer
            incident={incident}
            now={now}
            resolvedAt={resolvedAt}
            showBar
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DetailsButton id={incident.id} onOpenDetails={onOpenDetails} />
          {canEdit && onEditProcess && (
            <EditButton id={incident.id} onEditProcess={onEditProcess} />
          )}
          <ArchiveButton id={incident.id} onArchive={onArchive} />
        </div>
      </div>
    </article>
  );
}

// --- MAIN VIEW ---

export function IncidentViews({
  incidents,
  view,
  selectedGroup,
  now,
  criticalResolutions,
  onArchive,
  selected,
  onOpenDetails,
  onEditProcess,
  isManualProcess,
  selectedIsServerBacked,
  onClose,
  onAssigned,
  restoreFocus,
  aiControls,
  page,
  highlightedIncidentId,
  onPageChange,
}: {
  incidents: readonly DashboardIncident[];
  view: "groups" | "table";
  selectedGroup: IncidentGroupId | null;
  now: number | null;
  criticalResolutions: ReadonlyMap<string, number | null>;
  onArchive: (id: string) => void;
  selected?: DashboardIncident;
  onOpenDetails: OpenDetails;
  onEditProcess?: OpenDetails;
  isManualProcess?: (id: string) => boolean;
  selectedIsServerBacked?: boolean;
  onClose: () => void;
  onAssigned?: (message: string) => void;
  restoreFocus: () => void;
  aiControls: AiAnalysisControls;
  page: number;
  highlightedIncidentId?: string;
  onPageChange: (nextPage: number) => void;
}) {
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const prevRowTopsRef = useRef(new Map<string, number>());
  const [autoAssignId, setAutoAssignId] = useState<string | null>(null);
  const [dismissedWaitingIds, setDismissedWaitingIds] = useState<string[]>([]);
  const resolvedAt = selected ? criticalResolutions.get(selected.id) : undefined;

  const openDetailsOnly: OpenDetails = (id, event) => {
    setAutoAssignId(null);
    onOpenDetails(id, event);
  };

  const openDetailsForAssign: OpenDetails = (id, event) => {
    setAutoAssignId(id);
    onOpenDetails(id, event);
  };

  const sorted = useMemo(
    () => sortIncidentsForTable(incidents, criticalResolutions, now),
    [incidents, criticalResolutions, now],
  );

  const idleWaitingIncidents = useMemo(() => {
    if (now === null) return [];
    const dismissed = new Set(dismissedWaitingIds);
    return sorted.filter((incident) => {
      if (dismissed.has(incident.id)) return false;
      if (incident.status !== "waiting" && incident.status !== "new") {
        return false;
      }
      if (hasAssignedEmployee(incident)) return false;
      const createdMs = Date.parse(incident.createdAt ?? "");
      if (!Number.isFinite(createdMs)) return true;
      return now - createdMs >= IDLE_WAITING_MS;
    });
  }, [sorted, now, dismissedWaitingIds]);

  const activeWaitingNotice = idleWaitingIncidents[0] ?? null;

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paged = sorted.slice(startIndex, startIndex + PAGE_SIZE);
  const pagedOrderKey = paged.map((item) => item.id).join("|");

  useLayoutEffect(() => {
    const tbody = tbodyRef.current;
    if (!tbody || view !== "table") return;

    const rows = Array.from(
      tbody.querySelectorAll<HTMLTableRowElement>("tr[data-incident-id]"),
    );
    const nextTops = new Map<string, number>();
    const movedRows: HTMLTableRowElement[] = [];
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    for (const row of rows) {
      const id = row.dataset.incidentId;
      if (!id) continue;
      const newTop = row.getBoundingClientRect().top;
      nextTops.set(id, newTop);

      if (!reduceMotion) {
        const prevTop = prevRowTopsRef.current.get(id);
        if (prevTop !== undefined) {
          const deltaY = prevTop - newTop;
          if (Math.abs(deltaY) > 1) {
            row.style.transition = "none";
            row.style.transform = `translateY(${deltaY}px)`;
            movedRows.push(row);
          }
        }
      }
    }

    prevRowTopsRef.current = nextTops;

    if (movedRows.length === 0) return;

    void tbody.offsetHeight;

    const frame = window.requestAnimationFrame(() => {
      for (const row of movedRows) {
        row.style.transition =
          "transform 350ms cubic-bezier(0.22, 1, 0.36, 1)";
        row.style.transform = "translateY(0)";
      }
    });

    const cleanupTimer = window.setTimeout(() => {
      for (const row of movedRows) {
        row.style.transition = "";
        row.style.transform = "";
      }
    }, 380);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(cleanupTimer);
    };
  }, [pagedOrderKey, view]);

  const details = (
    <IncidentDetails
      incident={selected}
      serverBacked={selectedIsServerBacked}
      autoOpenAssign={Boolean(selected && autoAssignId === selected.id)}
      status={
        selected && (
          <IncidentStatus incident={selected} resolvedAt={resolvedAt} />
        )
      }
      priority={selected?.priority && priorityLabels[selected.priority]}
      created={<IncidentDate createdAt={selected?.createdAt} />}
      deadline={<IncidentDate createdAt={selected?.slaDeadline} />}
      sla={
        selected && (
          <SlaTimer
            incident={selected}
            now={now}
            resolvedAt={resolvedAt}
            showBar
          />
        )
      }
      groups={selected && <GroupTags incident={selected} />}
      itsm={selected && <OpenItsm incident={selected} label="Открыть в ITSM" />}
      onClose={() => {
        setAutoAssignId(null);
        onClose();
      }}
      onAssigned={(message) => {
        setAutoAssignId(null);
        onAssigned?.(message);
      }}
      restoreFocus={restoreFocus}
      aiControls={aiControls}
    />
  );

  const waitingToast = activeWaitingNotice ? (
    <aside
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-40 w-[calc(100%-2rem)] max-w-md rounded-panel border border-border border-l-4 border-l-mts-amber bg-card p-4 text-card-foreground shadow-[0_4px_16px_rgba(29,32,35,0.08)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-label-md font-bold text-foreground">
            Инцидент в ожидании без действий
          </p>
          <p className="text-label-md text-foreground">
            <strong>{activeWaitingNotice.id}</strong> ·{" "}
            {activeWaitingNotice.product}
          </p>
          <p className="text-label-sm text-muted-foreground">
            Назначьте ответственного исполнителя, проверьте карточку и отправьте
            инцидент в работу.
          </p>
          {idleWaitingIncidents.length > 1 && (
            <p className="text-label-sm font-semibold text-muted-foreground">
              Ещё в ожидании без исполнителя: {idleWaitingIncidents.length - 1}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Скрыть напоминание об ожидающем инциденте"
          onClick={() =>
            setDismissedWaitingIds((prev) => [...prev, activeWaitingNotice.id])
          }
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-9 rounded-control bg-mts-red px-4 text-label-sm font-bold text-white transition-all duration-200 hover:bg-mts-crimson active:scale-[0.98]"
          onClick={(event) => {
            setDismissedWaitingIds((prev) => [...prev, activeWaitingNotice.id]);
            openDetailsForAssign(activeWaitingNotice.id, event);
          }}
        >
          Назначить и в работу
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-control px-3 text-label-sm"
          onClick={(event) => openDetailsOnly(activeWaitingNotice.id, event)}
        >
          Посмотреть
        </Button>
      </div>
    </aside>
  ) : null;

  function scrollTable(direction: "left" | "right") {
    const outer = tableWrapperRef.current;
    if (!outer) return;
    const scroller =
      outer.querySelector<HTMLElement>('[data-slot="table-container"]') ?? outer;
    scroller.scrollBy({
      left: direction === "left" ? -380 : 380,
      behavior: "smooth",
    });
  }

  if (view === "table") {
    if (!sorted.length) {
      return (
        <>
          {details}
          <p className="mt-4 text-muted-foreground">Инциденты не найдены.</p>
        </>
      );
    }

    const pageNumbers = buildPageNumbers(safePage, totalPages);

    return (
      <>
        {details}
        {waitingToast}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-label-sm text-muted-foreground">
            Показано {startIndex + 1}–{startIndex + paged.length} из{" "}
            {sorted.length}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-label-sm text-muted-foreground">
              Прокрутка таблицы:
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 rounded-control"
              aria-label="Прокрутить таблицу влево"
              onClick={() => scrollTable("left")}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-8 rounded-control"
              aria-label="Прокрутить таблицу вправо"
              onClick={() => scrollTable("right")}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div
          ref={tableWrapperRef}
          role="region"
          aria-label="Прокручиваемая таблица инцидентов"
          className="mt-2 rounded-panel border"
        >
          <Table
            aria-label="Инциденты, время создания по Москве"
            className="min-w-[960px]"
          >
            <TableHeader className="bg-background">
              <TableRow>
                {[
                  "ID",
                  "Продукт",
                  "Действия",
                  "Исполнитель",
                  "Статус",
                  "До SLA",
                  "Приоритет",
                  "Группы",
                  "Создан",
                  "Риск",
                ].map((label) => (
                  <TableHead key={label} scope="col" className="px-2.5 py-2.5 text-label-sm">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody ref={tbodyRef}>
              {paged.map((incident) => {
                const rowResolvedAt = criticalResolutions.get(incident.id);
                const criticalActive = isActiveCritical(incident);
                const urgentSla = isSlaBelowQuarter(incident, now);
                const isResolved =
                  rowResolvedAt !== undefined || incident.status === "resolved";
                const canEdit = Boolean(isManualProcess?.(incident.id));

                return (
                  <TableRow
                    key={incident.id}
                    id={`incident-row-${incident.id}`}
                    data-incident-id={incident.id}
                    className={cn(
                      "scroll-mt-24 transition-colors duration-200",
                      criticalActive && "critical-row-pulse",
                      incident.id === highlightedIncidentId && "bg-mts-red/15",
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(
                        "px-2.5 py-2.5 text-left text-label-md font-medium whitespace-nowrap",
                        criticalActive &&
                          "border-l-4 border-l-mts-red font-semibold text-mts-crimson",
                        !criticalActive &&
                          urgentSla &&
                          "border-l-4 border-l-mts-amber",
                        !criticalActive &&
                          !urgentSla &&
                          isResolved &&
                          "border-l-4 border-l-mts-emerald",
                      )}
                    >
                      <div className="flex flex-col items-start gap-1">
                        <span>{incident.id}</span>
                        {criticalActive && (
                          <Badge
                            variant="outline"
                            className="rounded-pill border-mts-red/40 bg-mts-red/10 px-2 py-0 text-[10px] font-bold text-mts-crimson"
                          >
                            Закреплён
                          </Badge>
                        )}
                      </div>
                    </th>
                    <TableCell className="max-w-[180px] px-2.5 py-2.5 text-label-md font-medium whitespace-normal">
                      <div>{incident.product}</div>
                      <ContextBadges incident={incident} compact />
                    </TableCell>
                    <TableCell className="px-2.5 py-2.5">
                      <div className="flex items-center gap-1">
                        <DetailsButton
                          id={incident.id}
                          onOpenDetails={openDetailsOnly}
                          compact
                        />
                        {canEdit && onEditProcess && (
                          <EditButton
                            id={incident.id}
                            onEditProcess={onEditProcess}
                            compact
                          />
                        )}
                        <ArchiveButton
                          id={incident.id}
                          onArchive={onArchive}
                          compact
                        />
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[175px] max-w-[210px] px-2.5 py-2.5 whitespace-normal">
                      <AssigneeCell
                        incident={incident}
                        onAssign={openDetailsForAssign}
                      />
                    </TableCell>
                    <TableCell className="px-2.5 py-2.5">
                      <IncidentStatus
                        incident={incident}
                        resolvedAt={rowResolvedAt}
                      />
                    </TableCell>
                    <TableCell className="px-2.5 py-2.5">
                      <SlaTimer
                        incident={incident}
                        now={now}
                        resolvedAt={rowResolvedAt}
                        showBar
                      />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "px-2.5 py-2.5 text-label-md whitespace-nowrap",
                        criticalActive && "font-semibold text-mts-crimson",
                      )}
                    >
                      {incident.priority ? priorityLabels[incident.priority] : "—"}
                    </TableCell>
                    <TableCell className="min-w-[130px] px-2.5 py-2.5">
                      <GroupTags incident={incident} />
                    </TableCell>
                    <TableCell className="px-2.5 py-2.5">
                      <IncidentDate createdAt={incident.createdAt} />
                    </TableCell>
                    <TableCell className="px-2.5 py-2.5 text-label-md font-medium whitespace-nowrap tabular-nums">
                      {incident.ai ? `${incident.ai.riskScore}%` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <nav
            aria-label="Страницы таблицы инцидентов"
            className="mt-4 flex flex-wrap items-center justify-center gap-2"
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10 rounded-control"
              disabled={safePage <= 1}
              aria-label="Предыдущая страница"
              onClick={() => onPageChange(safePage - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>

            {pageNumbers.map((item, idx) =>
              item === "ellipsis" ? (
                <span
                  key={`ellipsis-${idx}`}
                  className="px-2 text-label-md text-muted-foreground"
                >
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  type="button"
                  variant={item === safePage ? "default" : "outline"}
                  className={cn(
                    "size-10 rounded-control px-0 text-label-md",
                    item === safePage &&
                      "bg-mts-ink text-white hover:bg-mts-ink/90",
                  )}
                  aria-current={item === safePage ? "page" : undefined}
                  onClick={() => onPageChange(item)}
                >
                  {item}
                </Button>
              ),
            )}

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10 rounded-control"
              disabled={safePage >= totalPages}
              aria-label="Следующая страница"
              onClick={() => onPageChange(safePage + 1)}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </nav>
        )}
      </>
    );
  }

  const visibleGroups = selectedGroup
    ? incidentGroups.filter(({ id }) => id === selectedGroup)
    : incidentGroups;

  return (
    <>
      {details}
      {waitingToast}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:gap-6">
        {visibleGroups.map(({ id, title, marker }) => {
          const members = sorted.filter((incident) =>
            incident.groups.includes(id),
          );
          return (
            <section
              key={id}
              aria-labelledby={`incident-group-${id}`}
              className="min-w-0 rounded-panel border bg-background p-4"
            >
              <h3
                id={`incident-group-${id}`}
                className="flex items-center gap-2 font-sans text-title-lg"
              >
                <span
                  className={`size-2 shrink-0 rounded-pill ${marker}`}
                  aria-hidden="true"
                />
                {title}
              </h3>
              {members.length ? (
                <ul className="mt-4 space-y-4">
                  {members.map((incident) => (
                    <li key={incident.id}>
                      <IncidentCard
                        incident={incident}
                        currentGroup={id}
                        now={now}
                        resolvedAt={criticalResolutions.get(incident.id)}
                        onArchive={onArchive}
                        onOpenDetails={openDetailsOnly}
                        onAssign={openDetailsForAssign}
                        onEditProcess={onEditProcess}
                        canEdit={Boolean(isManualProcess?.(incident.id))}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-label-md text-muted-foreground">
                  Инцидентов нет.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}