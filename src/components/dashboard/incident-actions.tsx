"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import type {
  DiffEvent, IncidentHistoryItem, IncidentPriority, IncidentStatus,
  MtsLinkMessageItem, NormalizedIncident,
} from "@/types/incident";

const linkKey = ["mts-link"] as const;

const time = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  dateStyle: "short",
  timeStyle: "medium",
});

const statusLabels: Record<IncidentStatus, string> = {
  new: "Новый",
  in_progress: "В работе",
  waiting: "Ожидание",
  investigation: "Расследование",
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

const inputClass = "w-full rounded-control border bg-background px-3 py-2";

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
      const fresh = events?.filter((event) =>
        !seen.current.has(event.id) &&
        (event.type === "MTS_LINK_SENT" || event.type === "INCIDENT_AUTO_CLOSED"),
      ) ?? [];

      if (!fresh.length) return;
      for (const event of fresh) seen.current.add(event.id);
      void client.invalidateQueries({ queryKey: linkKey });

      const closed = fresh.filter((event) => event.type === "INCIDENT_AUTO_CLOSED");
      for (const event of closed) {
        void client.invalidateQueries({
          queryKey: ["incident-history", event.incidentId],
        });
      }

      if (closed.length) {
        setNotice(closed.map((event) =>
          event.message?.trim() || "Инцидент " + event.incidentCode + " закрыт автоматически.",
        ).join(" "));
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
              <article key={item.id} className="space-y-1 rounded-panel border bg-card p-3">
                <strong>{item.title}</strong>
                <p>
                  {item.messageType === "ASSIGNED" ? "Назначение исполнителя" : "Автозакрытие"}
                  {" · "}{item.incidentId}
                </p>
                <p>{[item.recipientName, item.recipientTeam].filter(Boolean).join(" · ")}</p>
                <time dateTime={item.createdAt}>{time.format(new Date(item.createdAt))} МСК</time>
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
    queryFn: ({ signal }) => read<{ history: IncidentHistoryItem[] }>(
      "/api/incidents/" + encodeURIComponent(id) + "/history", signal,
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
          <p className="wrap-break-word">{item.oldValue ?? "—"} → {item.newValue}</p>
        </li>
      ))}
    </ol>
  );
}

function snapshot(incident: NormalizedIncident) {
  return {
    assigneeEmployee: incident.assigneeEmployee ?? "",
    assigneeTeam: incident.assigneeTeam,
    status: incident.status,
    priority: incident.priority,
    description: incident.description,
  };
}

export function IncidentAssignment({ incident }: { incident: NormalizedIncident }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<ReturnType<typeof snapshot> | null>(null);
  const original = useRef<ReturnType<typeof snapshot> | null>(null);
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(""), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  async function submit() {
    if (!draft || !original.current || sending.current) return;

    sending.current = true;
    setPending(true);
    setMessage("");

    const changed = Object.fromEntries(
      Object.entries(draft).filter(([key, value]) =>
        original.current?.[key as keyof typeof draft] !== value,
      ),
    );

    try {
      const response = await fetch("/api/incidents/" + encodeURIComponent(incident.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...changed, sendToMtsLink: true }),
      });

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
        setSuccess(result.recipient
          ? "Данные по " + incident.id + " отправлены ответственному " + result.recipient + " в МТС Link."
          : "Данные по " + incident.id + " отправлены в МТС Link.");
      } else {
        setMessage("Правки сохранены. Отправка в МТС Link не подтверждена.");
      }
    } catch {
      setMessage("Отправка не подтверждена. Проверь карточку и журнал перед повтором.");
    } finally {
      void client.invalidateQueries({ queryKey: ["incidents"] });
      void client.invalidateQueries({ queryKey: linkKey });
      void client.invalidateQueries({ queryKey: ["incident-history", incident.id] });
      sending.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {draft ? (
        <form
          className="space-y-3 rounded-panel border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            Исполнитель
            <Input
              value={draft.assigneeEmployee}
              onChange={(event) => setDraft({ ...draft, assigneeEmployee: event.target.value })}
            />
          </label>
          <label className="block">
            Команда
            <Input
              value={draft.assigneeTeam}
              onChange={(event) => setDraft({ ...draft, assigneeTeam: event.target.value })}
            />
          </label>
          <label className="block">
            Статус
            <select
              className={inputClass}
              disabled={incident.status === "closed"}
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value as IncidentStatus })}
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            Приоритет
            <select
              className={inputClass}
              value={draft.priority}
              onChange={(event) => setDraft({ ...draft, priority: event.target.value as IncidentPriority })}
            >
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            Описание
            <textarea
              className={inputClass}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          {incident.ai?.recommendedTeam && <p>Совет ИИ: {incident.ai.recommendedTeam}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Отправка…" : "Подтвердить и отправить"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setDraft(null)}>
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" onClick={() => {
          original.current = snapshot(incident);
          setDraft(original.current);
          setMessage("");
        }}>
          Назначить и отправить в МТС Link
        </Button>
      )}
      {message && <p role="status">{message}</p>}
      {success && <Toast message={success} />}
    </div>
  );
}