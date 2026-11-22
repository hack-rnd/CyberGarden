"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type {
  DiffEvent,
  IncidentHistoryItem,
  IncidentPriority,
  IncidentStatus,
  MtsLinkMessageItem,
  NormalizedIncident,
} from "@/types/incident";

const linkKey = ["mts-link"] as const;
const CUSTOM_ASSIGNEE_VALUE = "__custom__";

const UNASSIGNED_TEAM_LABELS = new Set([
  "",
  "не назначена",
  "не назначен",
  "не указан",
  "не указана",
]);

export const DUTY_ASSIGNEES = [
  { employee: "Дядя Фёдор (unclefedor)", team: "КЦ ИТ Координаторы Массовых Инцидентов" },
  { employee: "Алиса в Стране Чудес (alice)", team: "КЦ ИТ ЦП Billing Platform" },
  { employee: "Винни Пух (winnie)", team: "КЦ ИТ OPS Аварии ДС" },
  { employee: "Василиса Премудрая (vasilisa)", team: "КЦ ИТ Media L2 KION" },
  { employee: "Медведь Барсик (barsik)", team: "ОГЭ Приморье" },
  { employee: "Синяя Борода (bluebeard)", team: "КЦ ДОИ Администрирование SAN" },
  { employee: "Кеплер (kepler)", team: "КЦ ДОИ VMWare" },
  { employee: "Красная Шапочка (redriding)", team: "КЦ ИТ Мой МТС" },
  { employee: "Лисичка-сестричка (lisichka)", team: "КЦ ИТ Развитие DEVOPS" },
  { employee: "Карлсон (karlsson)", team: "КЦ ББ ДИБ УРМС VPN Support" },
] as const;

const DEPARTMENT_OPTIONS = DUTY_ASSIGNEES.map((item) => item.team);

export function getAiSuggestedAssignee(incident: NormalizedIncident): {
  employee: string;
  team: string;
} | null {
  const recommendedTeam = incident.ai?.recommendedTeam?.trim();
  if (!recommendedTeam) return null;

  const byTeam = DUTY_ASSIGNEES.find(
    (item) => item.team.toLowerCase() === recommendedTeam.toLowerCase(),
  );
  if (byTeam) return { employee: byTeam.employee, team: byTeam.team };

  const match = incident.ai?.handoffMessage.match(
    /Рекомендуемый ответственный\/дежурный:\s*([^\n.]+)/i,
  );
  const parsedName = match?.[1]?.trim();

  return {
    employee: parsedName || "Дядя Фёдор (unclefedor)",
    team: recommendedTeam,
  };
}

const time = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  dateStyle: "short",
  timeStyle: "medium",
});

const statusLabels: Record<IncidentStatus, string> = {
  new: "Новый",
  in_progress: "В работе",
  waiting: "Ожидает",
  investigation: "Исследование ситуации",
  resolved: "Решён",
  closed: "Закрыт",
};

const DEVELOPER_ONLY_STATUSES = new Set<IncidentStatus>(["resolved", "closed"]);

const priorityLabels: Record<IncidentPriority, string> = {
  critical: "Критический",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const fieldLabels: Record<string, string> = {
  assignee: "Исполнитель",
  status: "Статус",
  sla: "SLA",
  groups: "Группы",
  priority: "Приоритет",
  mts_link_sent: "МТС Link / War Room",
  auto_closed: "Автозакрытие",
  created: "Создание",
};

const selectTriggerClass =
  "h-11 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted";
const selectContentClass =
  "max-h-64 w-(--radix-select-trigger-width) min-w-0 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.1)]";

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Ошибка загрузки");
  return response.json();
}

function Toast({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] max-w-sm rounded-panel border border-border border-l-4 border-l-mts-emerald bg-card p-4 text-label-md text-foreground shadow-[0_4px_16px_rgba(29,32,35,0.12)]"
    >
      {message}
    </p>
  );
}

export function MtsLink({ events }: { events?: readonly DiffEvent[] }) {
  const client = useQueryClient();
  const seen = useRef(new Set<string>());
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: linkKey,
    queryFn: ({ signal }) =>
      read<{ messages: MtsLinkMessageItem[] }>("/api/mts-link", signal),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const fresh =
        events?.filter(
          (event) =>
            !seen.current.has(event.id) &&
            (event.type === "MTS_LINK_SENT" ||
              event.type === "INCIDENT_AUTO_CLOSED"),
        ) ?? [];

      if (!fresh.length) return;
      for (const event of fresh) seen.current.add(event.id);
      void client.invalidateQueries({ queryKey: linkKey });

      const closed = fresh.filter(
        (event) => event.type === "INCIDENT_AUTO_CLOSED",
      );
      for (const event of closed) {
        void client.invalidateQueries({
          queryKey: ["incident-history", event.incidentId],
        });
      }

      if (closed.length) {
        setNotice(
          closed
            .map(
              (event) =>
                event.message?.trim() ||
                "Инцидент " + event.incidentCode + " закрыт автоматически.",
            )
            .join(" "),
        );
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [client, events]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-control bg-card px-4"
          >
            МТС Link {query.data ? "(" + query.data.messages.length + ")" : ""}
          </Button>
        </SheetTrigger>
        <SheetContent className="overflow-y-auto data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>МТС Link</SheetTitle>
            <SheetDescription>
              Журнал назначений, War Room и автозакрытий
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-4">
            {query.isPending && <p>Загрузка…</p>}
            {query.isError && (
              <Button type="button" onClick={() => void query.refetch()}>
                Повторить загрузку
              </Button>
            )}
            {query.data?.messages.length === 0 && <p>Сообщений пока нет.</p>}
            {query.data?.messages.map((item) => {
              const isCoAssignee = item.payload.role === "co_assignee";
              const coTeams = Array.isArray(item.payload.coAssigneeTeams)
                ? item.payload.coAssigneeTeams.filter(
                    (team): team is string => typeof team === "string",
                  )
                : [];
              const warRoomCreated = item.payload.warRoomCreated === true;
              const warRoomPath =
                typeof item.payload.warRoomPath === "string"
                  ? item.payload.warRoomPath
                  : typeof item.payload.warRoomUrl === "string"
                    ? item.payload.warRoomUrl
                    : null;
              const aiRisk =
                typeof item.payload.aiRiskScore === "number"
                  ? item.payload.aiRiskScore
                  : null;

              return (
                <article
                  key={item.id}
                  className="space-y-1.5 rounded-panel border bg-card p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-label-md">{item.title}</strong>
                    <div className="flex flex-wrap gap-1">
                      {warRoomCreated && (
                        <Badge
                          variant="outline"
                          className="rounded-pill border-mts-red/40 bg-mts-red/10 px-2 py-0 text-[11px] font-semibold text-mts-crimson"
                        >
                          War Room создан
                        </Badge>
                      )}
                      {isCoAssignee && (
                        <Badge
                          variant="outline"
                          className="rounded-pill border-mts-ink/25 bg-mts-ink/8 px-2 py-0 text-[11px] font-semibold text-mts-ink"
                        >
                          Соисполнитель МИ
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-label-sm text-muted-foreground">
                    {item.messageType === "ASSIGNED"
                      ? isCoAssignee
                        ? "Привлечение подразделения"
                        : "Назначение исполнителя"
                      : "Автозакрытие"}
                    {" · "}
                    {item.incidentId}
                    {aiRisk !== null ? ` · Риск ИИ ${aiRisk}%` : ""}
                  </p>
                  <p className="text-label-md font-medium">
                    {[item.recipientName, item.recipientTeam]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {coTeams.length > 0 && (
                    <p className="text-label-sm text-muted-foreground">
                      Привлечены: {coTeams.join(", ")}
                    </p>
                  )}
                  <time
                    dateTime={item.createdAt}
                    className="block text-label-sm text-muted-foreground"
                  >
                    {time.format(new Date(item.createdAt))} МСК
                  </time>
                  {typeof item.payload.description === "string" &&
                    item.payload.description.trim() && (
                      <p className="text-label-sm text-foreground wrap-break-word">
                        {item.payload.description}
                      </p>
                    )}
                  {warRoomCreated && warRoomPath && (
                    <div className="pt-1">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-control border-mts-red/40 text-mts-crimson hover:bg-mts-red hover:text-white"
                      >
                        <a
                          href={warRoomPath}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Открыть War Room
                          <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </a>
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
      {notice && <Toast message={notice} />}
    </>
  );
}

export function IncidentHistory({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["incident-history", id],
    queryFn: ({ signal }) =>
      read<{ history: IncidentHistoryItem[] }>(
        "/api/incidents/" + encodeURIComponent(id) + "/history",
        signal,
      ),
  });

  if (query.isPending) return <p>Загрузка истории…</p>;

  if (query.isError) {
    return (
      <Button type="button" onClick={() => void query.refetch()}>
        Не удалось загрузить. Повторить
      </Button>
    );
  }

  if (!query.data.history.length) return <p>Изменений пока нет.</p>;

  return (
    <ol className="space-y-4 border-l pl-4">
      {query.data.history.map((item) => (
        <li key={item.id} className="space-y-1">
          <strong>{fieldLabels[item.field] ?? item.field}</strong>
          <p className="text-label-sm text-muted-foreground">
            {time.format(new Date(item.createdAt))} МСК · {item.actor}
          </p>
          <p className="text-label-md wrap-break-word">
            {item.oldValue ?? "—"} → {item.newValue}
          </p>
        </li>
      ))}
    </ol>
  );
}

function cleanTeam(team: string): string {
  const trimmed = team.trim();
  return UNASSIGNED_TEAM_LABELS.has(trimmed.toLowerCase()) ? "" : trimmed;
}

function snapshot(incident: NormalizedIncident) {
  return {
    assigneeEmployee: incident.assigneeEmployee ?? "",
    assigneeTeam: cleanTeam(incident.assigneeTeam),
    status: incident.status,
    priority: incident.priority,
    description: incident.description,
  };
}

export function IncidentAssignment({
  incident,
  defaultOpen = false,
  onSuccess,
}: {
  incident: NormalizedIncident;
  defaultOpen?: boolean;
  onSuccess?: (message: string) => void;
}) {
  const client = useQueryClient();
  const initialSnapshot = snapshot(incident);
  const [draft, setDraft] = useState<ReturnType<typeof snapshot> | null>(
    defaultOpen ? initialSnapshot : null,
  );
  const original = useRef<ReturnType<typeof snapshot> | null>(
    defaultOpen ? initialSnapshot : null,
  );
  const [additionalTeams, setAdditionalTeams] = useState<string[]>([]);
  const [customTeamInput, setCustomTeamInput] = useState("");
  const [createWarRoom, setCreateWarRoom] = useState(false);
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  

  const aiSuggestion = getAiSuggestedAssignee(incident);

  function toggleAdditionalTeam(teamName: string) {
    setAdditionalTeams((prev) =>
      prev.includes(teamName)
        ? prev.filter((item) => item !== teamName)
        : prev.length < 8
          ? [...prev, teamName]
          : prev,
    );
  }

  function addCustomTeam() {
    const trimmed = customTeamInput.trim();
    if (!trimmed) return;
    if (!additionalTeams.includes(trimmed) && additionalTeams.length < 8) {
      setAdditionalTeams((prev) => [...prev, trimmed]);
    }
    setCustomTeamInput("");
  }

  async function submit() {
    if (!draft || !original.current || sending.current) return;

    if (!draft.assigneeEmployee.trim()) {
      setMessage("Укажите ответственного исполнителя перед отправкой.");
      return;
    }

    sending.current = true;
    setPending(true);
    setMessage("");

    const changed = Object.fromEntries(
      Object.entries(draft).filter(
        ([key, value]) => original.current?.[key as keyof typeof draft] !== value,
      ),
    );

    const isCritical =
      draft.priority === "critical" || incident.groups.includes("CRITICAL");
    const extraTeamsPayload = isCritical
      ? additionalTeams.filter(
          (team) =>
            team.trim().toLowerCase() !==
            draft.assigneeTeam.trim().toLowerCase(),
        )
      : [];

    try {
      const response = await fetch(
        "/api/incidents/" + encodeURIComponent(incident.id),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...changed,
            ...(extraTeamsPayload.length > 0
              ? { additionalTeams: extraTeamsPayload }
              : {}),
            createWarRoom: isCritical ? createWarRoom : false,
            sendToMtsLink: true,
          }),
        },
      );

      if (response.status === 409) {
        setMessage("Закрытый инцидент нельзя вернуть в работу.");
        return;
      }

      if (!response.ok) throw new Error("PATCH failed");
      const result: {
        ok: boolean;
        mtsLinkSent?: boolean;
        recipient?: string;
        coTeamsSent?: string[];
        warRoomCreated?: boolean;
        warRoomId?: string | null;
      } = await response.json();

      if (!result.ok) throw new Error("PATCH failed");
      setDraft(null);
      setAdditionalTeams([]);
      setCreateWarRoom(false);

      if (result.mtsLinkSent) {
        const extraCount = result.coTeamsSent?.length ?? 0;
        const recipientPart = result.recipient
          ? " ответственному " + result.recipient
          : "";
        const extraPart =
          extraCount > 0 ? ` и ещё в ${extraCount} подр.` : "";
        const warRoomPart =
          result.warRoomCreated && result.warRoomId
            ? ` Создан War Room ${result.warRoomId}.`
            : "";
        onSuccess?.(
          `Данные по ${incident.id} отправлены${recipientPart}${extraPart} в МТС Link.${warRoomPart}`,
        );
      } else {
        setMessage("Правки сохранены. Отправка в МТС Link не подтверждена.");
      }
    } catch {
      setMessage(
        "Отправка не подтверждена. Проверь карточку и журнал перед повтором.",
      );
    } finally {
      void client.invalidateQueries({ queryKey: ["incidents"] });
      void client.invalidateQueries({ queryKey: ["ai", "digest"] });
      void client.invalidateQueries({ queryKey: linkKey });
      void client.invalidateQueries({
        queryKey: ["incident-history", incident.id],
      });
      sending.current = false;
      setPending(false);
    }
  }

  const matchedPreset = draft
    ? DUTY_ASSIGNEES.find((item) => item.employee === draft.assigneeEmployee)
    : undefined;

  const isCriticalDraft = Boolean(
    draft &&
      (draft.priority === "critical" || incident.groups.includes("CRITICAL")),
  );

  const availableCoTeams = Array.from(
    new Set([...DEPARTMENT_OPTIONS, ...additionalTeams]),
  ).filter(
    (team) =>
      team.toLowerCase() !== (draft?.assigneeTeam.trim().toLowerCase() ?? ""),
  );

  return (
    <div className="space-y-3">
      {draft ? (
        <form
          className="space-y-4 rounded-panel border bg-background p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {aiSuggestion && (
            <div className="space-y-2 rounded-control border border-mts-blue/30 bg-card p-3">
              <p className="text-label-sm font-semibold text-[#005EC4]">
                Рекомендация ИИ · решение принимает координатор
              </p>
              <p className="text-label-md">
                <strong>{aiSuggestion.employee}</strong> · {aiSuggestion.team}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-control border-mts-blue/35 bg-card px-3 text-label-sm text-[#005EC4] hover:bg-mts-blue hover:text-white"
                onClick={() =>
                  setDraft({
                    ...draft,
                    assigneeEmployee: aiSuggestion.employee,
                    assigneeTeam: aiSuggestion.team,
                  })
                }
              >
                Подставить рекомендацию
              </Button>
            </div>
          )}

          <div className="grid gap-1.5">
            <span className="text-label-md font-medium">
              Выбрать исполнителя из списка
            </span>
            <Select
              value={
                matchedPreset ? matchedPreset.employee : CUSTOM_ASSIGNEE_VALUE
              }
              onValueChange={(value) => {
                if (value === CUSTOM_ASSIGNEE_VALUE) return;
                const found = DUTY_ASSIGNEES.find(
                  (item) => item.employee === value,
                );
                if (!found) return;
                setDraft({
                  ...draft,
                  assigneeEmployee: found.employee,
                  assigneeTeam: found.team,
                });
              }}
            >
              <SelectTrigger className={selectTriggerClass}>
                <SelectValue placeholder="Выберите дежурного или введите вручную" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                side="bottom"
                align="start"
                sideOffset={4}
                collisionPadding={8}
                className={selectContentClass}
              >
                <SelectGroup>
                  <SelectItem value={CUSTOM_ASSIGNEE_VALUE}>
                    Ввести вручную ниже…
                  </SelectItem>
                  {DUTY_ASSIGNEES.map((item) => (
                    <SelectItem
                      key={item.employee}
                      value={item.employee}
                      className="whitespace-normal"
                    >
                      {item.employee} — {item.team}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <label className="grid gap-1.5 text-label-md font-medium">
            Ответственный исполнитель (вручную)
            <Input
              value={draft.assigneeEmployee}
              placeholder="Например: Иванов Иван (ivanov)"
              className="h-11 rounded-control bg-card font-normal"
              onChange={(event) =>
                setDraft({ ...draft, assigneeEmployee: event.target.value })
              }
            />
          </label>

          <label className="grid gap-1.5 text-label-md font-medium">
            Основная команда / подразделение
            <Input
              value={draft.assigneeTeam}
              placeholder="Например: КЦ ИТ ЦП Billing Platform"
              className="h-11 rounded-control bg-card font-normal"
              onChange={(event) =>
                setDraft({ ...draft, assigneeTeam: event.target.value })
              }
            />
          </label>

          {isCriticalDraft && (
            <div className="space-y-3 rounded-control border border-mts-red/25 bg-card p-3">
              <div>
                <p className="text-label-md font-semibold text-foreground">
                  Привлечь дополнительные подразделения (критический МИ)
                </p>
                <p className="text-label-sm text-muted-foreground">
                  Отправим уведомление в МТС Link сразу всем выбранным сменам.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableCoTeams.map((teamName) => {
                  const selected = additionalTeams.includes(teamName);
                  return (
                    <button
                      key={teamName}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleAdditionalTeam(teamName)}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 rounded-pill border px-2.5 py-1 text-[12px] font-medium transition-colors duration-150",
                        selected
                          ? "border-mts-red bg-mts-red text-white"
                          : "border-border bg-background text-foreground hover:border-mts-muted",
                      )}
                    >
                      {selected && (
                        <Check className="size-3" aria-hidden="true" />
                      )}
                      {teamName}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input
                  value={customTeamInput}
                  placeholder="Добавить другое подразделение…"
                  className="h-9 rounded-control bg-background text-label-sm font-normal"
                  onChange={(event) => setCustomTeamInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCustomTeam();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 shrink-0 rounded-control px-3 text-label-sm"
                  onClick={addCustomTeam}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  Добавить
                </Button>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-control border border-border bg-background p-2.5">
                <input
                  type="checkbox"
                  checked={createWarRoom}
                  onChange={(event) => setCreateWarRoom(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="space-y-0.5 text-label-sm">
                  <strong className="block text-foreground">
                    Собрать War Room в МТС Link
                  </strong>
                  <span className="block text-muted-foreground">
                    Создаст оперативный штаб (/war-room/{incident.id}) и
                    прикрепит рабочую ссылку всем привлечённым сменам.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="grid items-start gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-label-md font-medium">Статус</span>
              <Select
                disabled={incident.status === "closed"}
                value={draft.status}
                onValueChange={(value) => {
                  const nextStatus = value as IncidentStatus;
                  if (DEVELOPER_ONLY_STATUSES.has(nextStatus)) return;
                  setDraft({ ...draft, status: nextStatus });
                }}
              >
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  collisionPadding={8}
                  className={selectContentClass}
                >
                  <SelectGroup>
                    {(
                      Object.entries(statusLabels) as [IncidentStatus, string][]
                    ).map(([value, label]) => {
                      const devOnly = DEVELOPER_ONLY_STATUSES.has(value);
                      return (
                        <SelectItem
                          key={value}
                          value={value}
                          disabled={devOnly}
                        >
                          {devOnly ? `${label} (только разработчик)` : label}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-label-md font-medium">Приоритет</span>
              <Select
                value={draft.priority}
                onValueChange={(value) =>
                  setDraft({ ...draft, priority: value as IncidentPriority })
                }
              >
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  collisionPadding={8}
                  className={selectContentClass}
                >
                  <SelectGroup>
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <p className="text-[11px] leading-snug text-muted-foreground sm:col-span-2">
              Статусы «Решён» и «Закрыт» подтверждает разработчик после
              устранения.
            </p>
          </div>

          <label className="grid gap-1.5 text-label-md font-medium">
            Описание
            <textarea
              rows={4}
              className="w-full rounded-control border border-input bg-card px-3 py-2 text-label-md font-normal focus-visible:outline-2 focus-visible:outline-ring"
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={pending}
              className="h-10 rounded-control bg-mts-red px-4 font-semibold text-white hover:bg-mts-crimson"
            >
              {pending
                ? "Отправка…"
                : isCriticalDraft && createWarRoom
                  ? "Создать War Room и отправить в МТС Link"
                  : "Назначить и отправить в МТС Link"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setDraft(null);
                setAdditionalTeams([]);
                setCreateWarRoom(false);
              }}
            >
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          className="h-10 rounded-control bg-mts-red px-4 font-semibold text-white hover:bg-mts-crimson"
          onClick={() => {
            original.current = snapshot(incident);
            setDraft(original.current);
            setAdditionalTeams([]);
            setCreateWarRoom(false);
            setMessage("");
          }}
        >
          Назначить и отправить в МТС Link
        </Button>
      )}
      {message && (
        <p role="alert" className="text-label-md text-mts-crimson">
          {message}
        </p>
      )}
    </div>
  );
}