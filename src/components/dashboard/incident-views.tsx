import { ArrowUpRight } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isIncidentActive, type Incident, type IncidentAiAnalysis } from "./dashboard-model";

import { incidentGroups, type IncidentGroupId } from "./dashboard-summary";
import { IncidentDetails } from "./incident-details";

export type DashboardIncident = Pick<
  Incident, "id" | "service" | "description" | "assignedTeam" | "status"
> & Partial<Pick<Incident, "severity" | "createdAt" | "title" | "updatedAt" | "region" | "affectedUsers" | "metrics">> & {
  analysis?: Partial<Pick<IncidentAiAnalysis, "summary" | "targetTeam" | "rootCause" | "actionPlan">> & {
    recommendedTeam?: string;
    riskScore?: number;
    riskReason?: string;
    slaForecast?: string;
    handoffText?: string;
  };
  groups: readonly IncidentGroupId[];
  slaStatus?: "ok" | "warning" | "critical" | "breached" | "completed";
  slaDeadline?: string;
  criticalResolvedAt?: string;
  slaForecast?: string;
  itsmUrl?: string;
  hasEscalationRisk?: boolean;
  riskScore?: number;
};

const statusLabels: Record<DashboardIncident["status"], string> = {
  open: "Открыт",
  new: "Новый",
  in_progress: "В работе",
  waiting: "Ожидает",
  investigation: "Исследование ситуации",
  resolved: "Решён",
  closed: "Закрыт",
};
const priorityLabels = { critical: "Критический", high: "Высокий", medium: "Средний", low: "Низкий" };
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
});

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

export function useIncidentClock(enabled: boolean) {
  return useSyncExternalStore(
    enabled ? subscribeToClock : subscribeWithoutTimers,
    enabled ? readClock : readServerClock,
    readServerClock,
  );
}

function deadlineFor(incident: DashboardIncident) {
  if (!incident.slaDeadline) return Infinity;

  const deadline = Date.parse(incident.slaDeadline);
  return Number.isFinite(deadline) ? deadline : Infinity;
}

function isActiveCritical(incident: DashboardIncident) {
  return isIncidentActive(incident) && (incident.groups.includes("CRITICAL") || incident.severity === "critical");
}

function formatDuration(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function SlaTimer({ incident, now, resolvedAt }: {
  incident: DashboardIncident;
  now: number | null;
  resolvedAt?: number;
}) {
  const deadline = deadlineFor(incident);

  if (!isIncidentActive(incident)) {
    if (resolvedAt === undefined || !Number.isFinite(deadline)) {
      return <span className="text-muted-foreground">Завершён</span>;
    }
    const remaining = Math.ceil((deadline - resolvedAt) / 1000);
    return (
      <span className="text-muted-foreground">
        <span className="sr-only">SLA на момент решения: </span>
        <s className="tabular-nums">{resolvedAt > deadline ? "Просрочен" : formatDuration(remaining)}</s>
      </span>
    );
  }
  if (!Number.isFinite(deadline)) return <span className="text-muted-foreground">Срок не задан</span>;
  if (now === null) return <span className="text-muted-foreground">—</span>;

  const emphasis = cn(
    "whitespace-nowrap font-semibold tabular-nums",
    isActiveCritical(incident) && "text-[color-mix(in_srgb,var(--color-mts-red)_68%,var(--foreground))]",
  );
  const seconds = Math.ceil((deadline - now) / 1000);
  if (seconds <= 0) return <span className={emphasis}>Просрочен</span>;

  return <time dateTime={`PT${seconds}S`} className={emphasis}>{formatDuration(seconds)}</time>;
}

function OpenItsm({ incident, label = "В ITSM" }: { incident: DashboardIncident; label?: string }) {
  let href: string | undefined;
  try {
    const url = incident.itsmUrl ? new URL(incident.itsmUrl) : undefined;
    if (url?.protocol === "https:" || url?.protocol === "http:") href = url.href;
  } catch {
    // An incomplete link is displayed as unavailable.
  }

  if (!href) return <span className="text-label-sm text-muted-foreground">Нет ссылки в ITSM</span>;

  return (
    <Button asChild variant="outline" className="h-10 rounded-control">
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`В ITSM: ${incident.id} (новая вкладка)`}>
        {label} <ArrowUpRight aria-hidden="true" />
      </a>
    </Button>
  );
}

function GroupTags({ incident, currentGroup }: { incident: DashboardIncident; currentGroup?: IncidentGroupId }) {
  const tags = incidentGroups.filter(({ id }) => id !== currentGroup && incident.groups.includes(id));

  if (!tags.length) return currentGroup ? null : <span className="text-muted-foreground">—</span>;

  return (
    <ul aria-label={currentGroup ? "Другие группы" : "Группы инцидента"} className="flex flex-wrap gap-2">
      {tags.map(({ id, title, marker }) => (
        <li key={id}>
          <Badge variant="outline" className="h-auto rounded-pill px-2 py-1 text-label-sm whitespace-normal">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-pill ${marker}`} />
            {title}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function IncidentDate({ createdAt }: { createdAt?: string }) {
  const timestamp = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(timestamp)) return <span className="text-muted-foreground">—</span>;

  return <time dateTime={new Date(timestamp).toISOString()} title="Московское время">{dateFormat.format(timestamp)}</time>;
}

function IncidentStatus({ incident, resolvedAt }: { incident: DashboardIncident; resolvedAt?: number }) {
  if (resolvedAt !== undefined) {
    return (
      <Badge variant="outline" className="h-auto rounded-pill border-mts-emerald px-2 py-1 text-label-sm">
        Критический решён <span aria-hidden="true">✓</span>
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="h-auto rounded-pill px-2 py-1 text-label-sm">
      {statusLabels[incident.status]}
    </Badge>
  );
}

function ArchiveButton({ id, onArchive }: { id: string; onArchive: (id: string) => void }) {
  return (
    <Button type="button" variant="ghost" className="h-10" onClick={() => onArchive(id)}>
      Скрыть в архив<span className="sr-only">: {id}</span>
    </Button>
  );
}

type OpenDetails = (id: string, event: MouseEvent<HTMLButtonElement>) => void;

function DetailsButton({ id, onOpenDetails }: { id: string; onOpenDetails: OpenDetails }) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-haspopup="dialog"
      aria-label={`Детали инцидента ${id}`}
      className="h-10 rounded-control"
      onClick={(event) => onOpenDetails(id, event)}
    >
      Детали
    </Button>
  );
}

function IncidentCard({
  incident, currentGroup, now, resolvedAt, onArchive, onOpenDetails,
}: {
  incident: DashboardIncident;
  currentGroup: IncidentGroupId;
  now: number | null;
  resolvedAt?: number;
  onArchive: (id: string) => void;
  onOpenDetails: OpenDetails;
}) {
  return (
    <article className={cn(
      "space-y-4 rounded-panel border bg-card p-4",
      isActiveCritical(incident) && "border-l-4 border-l-mts-red",
      resolvedAt !== undefined && "border-l-4 border-l-mts-emerald",
    )}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-label-sm text-muted-foreground">{incident.id}</p>
          <h4 className="font-sans text-body-md font-semibold wrap-break-word">{incident.service}</h4>
        </div>
        <IncidentStatus incident={incident} resolvedAt={resolvedAt} />
      </div>
      <GroupTags incident={incident} currentGroup={currentGroup} />
      <dl className="grid grid-cols-2 gap-4 text-label-md">
        <div><dt className="text-muted-foreground">Исполнитель</dt><dd className="wrap-break-word">{incident.assignedTeam || "Не назначен"}</dd></div>
        <div><dt className="text-muted-foreground">Создан</dt><dd><IncidentDate createdAt={incident.createdAt} /></dd></div>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-md">SLA <SlaTimer incident={incident} now={now} resolvedAt={resolvedAt} /></p>
        <DetailsButton id={incident.id} onOpenDetails={onOpenDetails} />
        <OpenItsm incident={incident} />
        {resolvedAt !== undefined && <ArchiveButton id={incident.id} onArchive={onArchive} />}
      </div>
    </article>
  );
}

export function IncidentViews({
  incidents, view, selectedGroup, now, criticalResolutions, onArchive,
}: {
  incidents: readonly DashboardIncident[];
  view: "groups" | "table";
  selectedGroup: IncidentGroupId | null;
  now: number | null;
  criticalResolutions: ReadonlyMap<string, number>;
  onArchive: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailsTrigger = useRef<HTMLButtonElement | null>(null);
  const selected = incidents.find((incident) => incident.id === selectedId);
  const resolvedAt = selected ? criticalResolutions.get(selected.id) : undefined;
  if (selectedId !== null && !selected) setSelectedId(null);

  function openDetails(id: string, event: MouseEvent<HTMLButtonElement>) {
    detailsTrigger.current = event.currentTarget;
    setSelectedId(id);
  }

  const details = (
    <IncidentDetails
      incident={selected}
      status={selected && <IncidentStatus incident={selected} resolvedAt={resolvedAt} />}
      priority={selected?.severity && priorityLabels[selected.severity]}
      created={<IncidentDate createdAt={selected?.createdAt} />}
      updated={<IncidentDate createdAt={selected?.updatedAt} />}
      deadline={<IncidentDate createdAt={selected?.slaDeadline} />}
      sla={selected && <SlaTimer incident={selected} now={now} resolvedAt={resolvedAt} />}
      groups={selected && <GroupTags incident={selected} />}
      itsm={selected && <OpenItsm incident={selected} label="Открыть в ITSM" />}
      onClose={() => setSelectedId(null)}
      restoreFocus={() => detailsTrigger.current?.focus()}
    />
  );

  const sorted = useMemo(() => [...incidents].sort((first, second) => {
    const firstResolution = criticalResolutions.get(first.id);
    const secondResolution = criticalResolutions.get(second.id);
    if (firstResolution !== undefined || secondResolution !== undefined) {
      return (secondResolution ?? -Infinity) - (firstResolution ?? -Infinity);
    }
    const firstDeadline = isIncidentActive(first) ? deadlineFor(first) : Infinity;
    const secondDeadline = isIncidentActive(second) ? deadlineFor(second) : Infinity;
    return firstDeadline - secondDeadline;
  }), [incidents, criticalResolutions]);

  if (view === "table") {
    if (!sorted.length) return <>{details}<p className="mt-4 text-muted-foreground">Инциденты не найдены.</p></>;

    return (
      <>
        {details}
        <div
          role="region"
          aria-label="Прокручиваемая таблица инцидентов"
          tabIndex={0}
          className="mt-4 overflow-x-auto rounded-panel border focus-visible:outline-2 focus-visible:outline-ring *:data-[slot=table-container]:min-w-270"
        >
          <Table aria-label="Инциденты, время создания по Москве">
            <TableHeader className="bg-background">
              <TableRow>
                {["ID", "Продукт", "Группы", "Приоритет", "Статус", "Исполнитель", "Создан", "До SLA", "ИИ-риск", "Действия"].map((label) => (
                  <TableHead key={label} scope="col" className="px-4">{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((incident) => {
                const resolvedAt = criticalResolutions.get(incident.id);
                return (
                  <TableRow key={incident.id}>
                    <th scope="row" className={cn(
                      "p-4 text-left font-medium whitespace-nowrap",
                      isActiveCritical(incident) && "border-l-4 border-l-mts-red",
                      resolvedAt !== undefined && "border-l-4 border-l-mts-emerald",
                    )}>{incident.id}</th>
                    <TableCell className="p-4 font-medium">{incident.service}</TableCell>
                    <TableCell className="min-w-44 p-4"><GroupTags incident={incident} /></TableCell>
                    <TableCell className="p-4">{incident.severity ? priorityLabels[incident.severity] : "—"}</TableCell>
                    <TableCell className="p-4"><IncidentStatus incident={incident} resolvedAt={resolvedAt} /></TableCell>
                    <TableCell className="p-4">{incident.assignedTeam || "Не назначен"}</TableCell>
                    <TableCell className="p-4"><IncidentDate createdAt={incident.createdAt} /></TableCell>
                    <TableCell className="p-4">
                      <SlaTimer incident={incident} now={now} resolvedAt={resolvedAt} />
                      {incident.slaForecast && <p className="mt-1 text-label-sm text-muted-foreground">{incident.slaForecast}</p>}
                    </TableCell>
                    <TableCell className="p-4">
                      {typeof incident.riskScore === "number"
                        ? `${incident.riskScore}%`
                        : incident.hasEscalationRisk === true ? "Есть риск" : incident.hasEscalationRisk === false ? "Риск не выявлен" : "—"}
                    </TableCell>
                    <TableCell className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <DetailsButton id={incident.id} onOpenDetails={openDetails} />
                        <OpenItsm incident={incident} />
                        {resolvedAt !== undefined && <ArchiveButton id={incident.id} onArchive={onArchive} />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  const visibleGroups = selectedGroup ? incidentGroups.filter(({ id }) => id === selectedGroup) : incidentGroups;
  return (
    <>
      {details}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:gap-6">
        {visibleGroups.map(({ id, title, marker }) => {
          const members = sorted.filter((incident) => incident.groups.includes(id));
          return (
            <section key={id} aria-labelledby={`incident-group-${id}`} className="min-w-0 rounded-panel border bg-background p-4">
              <h3 id={`incident-group-${id}`} className="flex items-center gap-2 font-sans text-title-lg">
                <span className={`size-2 shrink-0 rounded-pill ${marker}`} aria-hidden="true" />
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
                        onOpenDetails={openDetails}
                      />
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-4 text-label-md text-muted-foreground">Инцидентов нет.</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}

function subscribeWithoutTimers() {
  return () => {};
}
