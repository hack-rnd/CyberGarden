"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useRef, useSyncExternalStore, type MouseEvent } from "react";

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

const PAGE_SIZE = 10;

const statusLabels: Record<DashboardIncident["status"], string> = {
  new: "Новый",
  in_progress: "В работе",
  waiting: "Ожидает",
  investigation: "Исследование ситуации",
  resolved: "Решён",
  closed: "Закрыт",
};

const statusBadgeClasses: Record<DashboardIncident["status"], string> = {
  new: "border-mts-amber/35 bg-mts-amber/12 text-[#B8380E]",
  waiting: "border-mts-amber/35 bg-mts-amber/12 text-[#B8380E]",
  in_progress: "border-mts-blue/30 bg-mts-blue/10 text-[#005EC4]",
  investigation: "border-mts-blue/25 bg-mts-blue/10 text-[#005EC4]",
  resolved: "border-mts-emerald/40 bg-mts-emerald/15 text-[#007A62]",
  closed: "border-border bg-muted text-muted-foreground",
};

const priorityLabels = {
  critical: "Критический",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

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

// --- FORMATTERS ---

function isActiveCritical(incident: DashboardIncident) {
  return (
    isIncidentActive(incident) &&
    (incident.groups.includes("CRITICAL") || incident.priority === "critical")
  );
}

function formatDuration(seconds: number) {
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
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

// --- CELL COMPONENTS ---

function SlaTimer({
  incident,
  now,
  resolvedAt,
}: {
  incident: DashboardIncident;
  now: number | null;
  resolvedAt?: number | null;
}) {
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
  const emphasis = cn(
    "whitespace-nowrap font-semibold tabular-nums",
    (seconds <= 0 || liveSla === "breached" || isActiveCritical(incident)) &&
      "text-mts-crimson",
    seconds > 0 &&
      !isActiveCritical(incident) &&
      (liveSla === "critical" || liveSla === "warning") &&
      "text-mts-amber",
  );

  if (seconds <= 0) return <span className={emphasis}>Просрочен</span>;

  return (
    <time dateTime={`PT${seconds}S`} className={emphasis}>
      {formatDuration(seconds)}
    </time>
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
      className="flex flex-wrap gap-1.5"
    >
      {tags.map(({ id, title, marker }) => (
        <li key={id}>
          <Badge
            variant="outline"
            className="h-auto rounded-pill px-2 py-0.5 text-label-sm whitespace-normal"
          >
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-pill ${marker}`}
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
      className="whitespace-nowrap"
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
        className="h-auto rounded-pill border-mts-emerald bg-mts-emerald/15 px-2.5 py-1 text-label-sm font-semibold text-[#007A62]"
      >
        Критический решён <span aria-hidden="true">✓</span>
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-auto rounded-pill px-2.5 py-1 text-label-sm whitespace-nowrap",
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
}: {
  id: string;
  onArchive: (id: string) => void;
}) {
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
}: {
  id: string;
  onOpenDetails: OpenDetails;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-haspopup="dialog"
      aria-label={`Детали инцидента ${id}`}
      className="h-9 rounded-control px-3"
      onClick={(event) => onOpenDetails(id, event)}
    >
      Детали
    </Button>
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
}: {
  incident: DashboardIncident;
  currentGroup: IncidentGroupId;
  now: number | null;
  resolvedAt?: number | null;
  onArchive: (id: string) => void;
  onOpenDetails: OpenDetails;
}) {
  const criticalActive = isActiveCritical(incident);

  return (
    <article
      className={cn(
        "space-y-4 rounded-panel border bg-card p-4 transition duration-200 hover:shadow-[0_4px_16px_rgba(29,32,35,0.08)] motion-safe:hover:-translate-y-1 motion-reduce:transition-none",
        criticalActive &&
          "critical-pulse-ring border-l-4 border-l-mts-red bg-mts-red/[0.02]",
        resolvedAt !== undefined && "border-l-4 border-l-mts-emerald",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-label-sm text-muted-foreground">
            {criticalActive && (
              <span
                aria-hidden="true"
                className="critical-dot-pulse size-2 shrink-0 rounded-pill bg-mts-red"
              />
            )}
            {incident.id}
          </p>
          <h4 className="font-sans text-body-md font-semibold wrap-break-word">
            {incident.product}
          </h4>
        </div>
        <IncidentStatus incident={incident} resolvedAt={resolvedAt} />
      </div>
      <GroupTags incident={incident} currentGroup={currentGroup} />
      <dl className="grid grid-cols-2 gap-4 text-label-md">
        <div>
          <dt className="text-muted-foreground">Исполнитель</dt>
          <dd className="wrap-break-word">
            {incident.assigneeTeam || "Не назначен"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Создан</dt>
          <dd>
            <IncidentDate createdAt={incident.createdAt} />
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-md">
          SLA <SlaTimer incident={incident} now={now} resolvedAt={resolvedAt} />
        </p>
        <DetailsButton id={incident.id} onOpenDetails={onOpenDetails} />
        <OpenItsm incident={incident} />
        {resolvedAt !== undefined && (
          <ArchiveButton id={incident.id} onArchive={onArchive} />
        )}
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
  onClose,
  restoreFocus,
  aiControls,
  page,
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
  onClose: () => void;
  restoreFocus: () => void;
  aiControls: AiAnalysisControls;
  page: number;
  onPageChange: (nextPage: number) => void;
}) {
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  const resolvedAt = selected ? criticalResolutions.get(selected.id) : undefined;

  const details = (
    <IncidentDetails
      incident={selected}
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
          <SlaTimer incident={selected} now={now} resolvedAt={resolvedAt} />
        )
      }
      groups={selected && <GroupTags incident={selected} />}
      itsm={selected && <OpenItsm incident={selected} label="Открыть в ITSM" />}
      onClose={onClose}
      restoreFocus={restoreFocus}
      aiControls={aiControls}
    />
  );

  const sorted = useMemo(
    () =>
      [...incidents].sort((first, second) => {
        const firstCrit = isActiveCritical(first) ? 0 : 1;
        const secondCrit = isActiveCritical(second) ? 0 : 1;
        if (firstCrit !== secondCrit) return firstCrit - secondCrit;

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
        return firstDeadline === secondDeadline
          ? 0
          : firstDeadline - secondDeadline;
      }),
    [incidents, criticalResolutions],
  );

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

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const startIndex = (safePage - 1) * PAGE_SIZE;
    const paged = sorted.slice(startIndex, startIndex + PAGE_SIZE);
    const pageNumbers = buildPageNumbers(safePage, totalPages);

    return (
      <>
        {details}

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
            className="min-w-[1040px]"
          >
            <TableHeader className="bg-background">
              <TableRow>
                {[
                  "ID",
                  "Продукт",
                  "Группы",
                  "Приоритет",
                  "Статус",
                  "Исполнитель",
                  "Создан",
                  "До SLA",
                  "ИИ-риск",
                  "Действия",
                ].map((label) => (
                  <TableHead key={label} scope="col" className="px-3 py-3">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody key={safePage} className="animate-table-page">
              {paged.map((incident) => {
                const rowResolvedAt = criticalResolutions.get(incident.id);
                const criticalActive = isActiveCritical(incident);

                return (
                  <TableRow
                    key={incident.id}
                    className={cn(criticalActive && "critical-row-pulse")}
                  >
                    <th
                      scope="row"
                      className={cn(
                        "px-3 py-3 text-left font-medium whitespace-nowrap",
                        criticalActive &&
                          "border-l-4 border-l-mts-red font-semibold text-mts-crimson",
                        rowResolvedAt !== undefined &&
                          "border-l-4 border-l-mts-emerald",
                      )}
                    >
                      <span className="inline-flex items-center gap-2">
                        {criticalActive && (
                          <span
                            aria-hidden="true"
                            className="critical-dot-pulse size-2 shrink-0 rounded-pill bg-mts-red"
                          />
                        )}
                        {incident.id}
                      </span>
                    </th>
                    <TableCell className="max-w-[180px] px-3 py-3 font-medium whitespace-normal">
                      {incident.product}
                    </TableCell>
                    <TableCell className="min-w-40 px-3 py-3">
                      <GroupTags incident={incident} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "px-3 py-3 whitespace-nowrap",
                        criticalActive && "font-semibold text-mts-crimson",
                      )}
                    >
                      {incident.priority ? priorityLabels[incident.priority] : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <IncidentStatus
                        incident={incident}
                        resolvedAt={rowResolvedAt}
                      />
                    </TableCell>
                    <TableCell className="max-w-[200px] px-3 py-3 whitespace-normal">
                      {incident.assigneeTeam || "Не назначен"}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <IncidentDate createdAt={incident.createdAt} />
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <SlaTimer
                        incident={incident}
                        now={now}
                        resolvedAt={rowResolvedAt}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-3 whitespace-nowrap">
                      {incident.ai ? `${incident.ai.riskScore}%` : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <DetailsButton
                          id={incident.id}
                          onOpenDetails={onOpenDetails}
                        />
                        <OpenItsm incident={incident} />
                        {rowResolvedAt !== undefined && (
                          <ArchiveButton
                            id={incident.id}
                            onArchive={onArchive}
                          />
                        )}
                      </div>
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
                        onOpenDetails={onOpenDetails}
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