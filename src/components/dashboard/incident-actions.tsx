"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  mts_link_sent: "Отправка в МТС Link",
  auto_closed: "Автозакрытие",
  created: "Создание",
};

const selectTriggerClass =
  "h-11 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted";
const selectContentClass =
  "max-h-72 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]";

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Ошибка загрузки");
  return response.json();
}

function Toast({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] max-w-sm rounded-panel border border-l-4 border-l-mts-emerald bg-card p-4 text-[#007A62] shadow-lg"
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
          <Button type="button" variant="outline">
            МТС Link {query.data ? "(" + query.data.messages.length + ")" : ""}
          </Button>
        </SheetTrigger>
        <SheetContent className="overflow-y-auto data-[side=right]:sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>МТС Link</SheetTitle>
            <SheetDescription>Журнал назначений и автозакрытий</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 pb-4">
            {query.isPending && <p>Загрузка…</p>}
            {query.isError && (
              <Button type="button" onClick={() => void query.refetch()}>
                Повторить загрузку
              </Button>
            )}
            {query.data?.messages.length === 0 && <p>Сообщений пока нет.</p>}
            {query.data?.messages.map((item) => (
              <article
                key={item.id}
                className="space-y-1 rounded-panel border bg-card p-3"
              >
                <strong>{item.title}</strong>
                <p>
                  {item.messageType === "ASSIGNED"
                    ? "Назначение исполнителя"
                    : "Автозакрытие"}
                  {" · "}
                  {item.incidentId}
                </p>
                <p>
                  {[item.recipientName, item.recipientTeam]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <time dateTime={item.createdAt}>
                  {time.format(new Date(item.createdAt))} МСК
                </time>
                {typeof item.payload.description === "string" && (
                  <p className="wrap-break-word">{item.payload.description}</p>
                )}
              </article>
            ))}
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
          <p className="text-muted-foreground">
            {time.format(new Date(item.createdAt))} МСК · {item.actor}
          </p>
          <p className="wrap-break-word">
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
}: {
  incident: NormalizedIncident;
  defaultOpen?: boolean;
}) {
  const client = useQueryClient();
  const initialSnapshot = snapshot(incident);
  const [draft, setDraft] = useState<ReturnType<typeof snapshot> | null>(
    defaultOpen ? initialSnapshot : null,
  );
  const original = useRef<ReturnType<typeof snapshot> | null>(
    defaultOpen ? initialSnapshot : null,
  );
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  const aiSuggestion = getAiSuggestedAssignee(incident);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

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

    try {
      const response = await fetch(
        "/api/incidents/" + encodeURIComponent(incident.id),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...changed, sendToMtsLink: true }),
        },
      );

      if (response.status === 409) {
        setMessage("Закрытый инцидент нельзя вернуть в работу.");
        return;
      }

      if (!response.ok) throw new Error("PATCH failed");
      const result: { ok: boolean; mtsLinkSent?: boolean; recipient?: string } =
        await response.json();

      if (!result.ok) throw new Error("PATCH failed");
      setDraft(null);

      if (result.mtsLinkSent) {
        setSuccess(
          result.recipient
            ? "Данные по " +
                incident.id +
                " отправлены ответственному " +
                result.recipient +
                " в МТС Link."
            : "Данные по " + incident.id + " отправлены в МТС Link.",
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
            <div className="space-y-2 rounded-control border border-mts-blue/30 bg-mts-blue/5 p-3">
              <p className="flex items-center gap-1.5 text-label-sm font-semibold text-[#005EC4]">
                <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
                Совет ИИ (решение принимает координатор)
              </p>
              <p className="text-label-md">
                <strong>{aiSuggestion.employee}</strong> · {aiSuggestion.team}
              </p>
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-control border-mts-blue/30 bg-card px-3 text-label-sm text-[#005EC4] hover:bg-mts-blue hover:text-white"
                onClick={() =>
                  setDraft({
                    ...draft,
                    assigneeEmployee: aiSuggestion.employee,
                    assigneeTeam: aiSuggestion.team,
                  })
                }
              >
                Подставить совет ИИ
              </Button>
            </div>
          )}

          <div className="grid gap-1.5">
            <span className="text-label-md font-medium">
              Выбрать исполнителя из списка
            </span>
            <Select
              value={matchedPreset ? matchedPreset.employee : CUSTOM_ASSIGNEE_VALUE}
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
              <SelectContent className={selectContentClass}>
                <SelectGroup>
                  <SelectItem value={CUSTOM_ASSIGNEE_VALUE}>
                    Ввести вручную ниже…
                  </SelectItem>
                  {DUTY_ASSIGNEES.map((item) => (
                    <SelectItem key={item.employee} value={item.employee}>
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
            Команда / подразделение
            <Input
              value={draft.assigneeTeam}
              placeholder="Например: КЦ ИТ ЦП Billing Platform"
              className="h-11 rounded-control bg-card font-normal"
              onChange={(event) =>
                setDraft({ ...draft, assigneeTeam: event.target.value })
              }
            />
          </label>

          <div className="grid gap-1.5">
            <span className="text-label-md font-medium">Статус</span>
            <Select
              disabled={incident.status === "closed"}
              value={draft.status}
              onValueChange={(value) =>
                setDraft({ ...draft, status: value as IncidentStatus })
              }
            >
              <SelectTrigger className={selectTriggerClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={selectContentClass}>
                <SelectGroup>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
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
              <SelectContent className={selectContentClass}>
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
              {pending ? "Отправка…" : "Назначить и отправить в МТС Link"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setDraft(null)}
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
      {success && <Toast message={success} />}
    </div>
  );
}