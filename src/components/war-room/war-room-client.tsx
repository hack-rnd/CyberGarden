"use client";

import { ArrowLeft, Copy, Send, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { NormalizedIncident } from "@/types/incident";
import {
  formatDuration,
  statusLabels,
  useIncidentClock,
} from "@/components/dashboard/incident-views";

type WarRoomNote = {
  id: string;
  actor: string;
  text: string;
  createdAt: string;
};

type WarRoomPayload = {
  incident: NormalizedIncident;
  warRoom: {
    created: boolean;
    id: string;
    createdAt: string;
    teams: string[];
  };
  notes: WarRoomNote[];
};

const noteTimeFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Moscow",
});

export function WarRoomClient({ incidentId }: { incidentId: string }) {
  const [data, setData] = useState<WarRoomPayload | null>(null);
  const [error, setError] = useState("");
  const [author, setAuthor] = useState("Координатор смены");
  const [role, setRole] = useState("Координатор МИ");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = useIncidentClock(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch(
          `/api/war-room/${encodeURIComponent(incidentId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          if (active) setError("Инцидент для War Room не найден.");
          return;
        }
        const json = (await res.json()) as WarRoomPayload;
        if (active) {
          setData(json);
          setError("");
        }
      } catch {
        if (active) setError("Нет связи с сервером дашборда.");
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [incidentId]);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || !author.trim() || sending) return;

    setSending(true);
    try {
      const res = await fetch(
        `/api/war-room/${encodeURIComponent(incidentId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author, role, text }),
        },
      );
      if (res.ok) {
        const result = (await res.json()) as { ok: boolean; note?: WarRoomNote };
        if (result.note) {
          setData((prev) =>
            prev ? { ...prev, notes: [result.note!, ...prev.notes] } : prev,
          );
          setText("");
        }
      }
    } finally {
      setSending(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore clipboard restriction
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0D0F12] p-8 text-[#F5F7FA]">
        <div className="mx-auto max-w-2xl space-y-4 rounded-panel border border-[#242830] bg-[#16191D] p-6">
          <p className="text-title-lg">{error}</p>
          <Button asChild variant="outline" className="border-[#353B45] bg-[#1C2026] text-white">
            <Link href="/">
              <ArrowLeft className="size-4" />
              Вернуться на дашборд
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0D0F12] text-[#8F98A3]">
        Подключаем оперативный штаб War Room…
      </div>
    );
  }

  const { incident, warRoom, notes } = data;
  const deadlineMs = incident.slaDeadline
    ? Date.parse(incident.slaDeadline)
    : NaN;
  const remainingSec =
    now !== null && Number.isFinite(deadlineMs)
      ? Math.ceil((deadlineMs - now) / 1000)
      : null;

  const isCrit =
    incident.priority === "critical" || incident.groups.includes("CRITICAL");

  return (
    <div className="min-h-screen bg-[#0D0F12] text-[#F5F7FA]">
      <header className="border-b border-[#242830] bg-[#16191D] px-6 py-4 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 rounded-control border-[#353B45] bg-[#1C2026] text-[#E4E8EE] hover:bg-[#252A32] hover:text-white"
            >
              <Link href="/">
                <ArrowLeft className="size-4" />
                На дашборд
              </Link>
            </Button>
            <div>
              <p className="font-heading text-body-md font-semibold text-white">
                МТС Link · Оперативный штаб {warRoom.id}
              </p>
              <p className="text-label-sm text-[#8F98A3]">
                {incident.code} · {incident.product} ·{" "}
                {statusLabels[incident.status]}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-control border border-[#2C313A] bg-[#0D0F12] px-4 py-1.5 text-right">
              <p className="text-[11px] text-[#8F98A3] uppercase">До SLA</p>
              <p
                className={cn(
                  "font-heading text-body-md font-semibold tabular-nums",
                  remainingSec !== null && remainingSec <= 0
                    ? "text-mts-red"
                    : isCrit
                      ? "text-mts-red"
                      : "text-[#00C19B]",
                )}
              >
                {remainingSec === null
                  ? "Срок не задан"
                  : remainingSec <= 0
                    ? "ПРОСРОЧЕН"
                    : formatDuration(remainingSec)}
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-control border-[#353B45] bg-[#1C2026] text-white hover:bg-[#252A32] hover:text-white"
              onClick={copyLink}
            >
              <Copy className="size-4" />
              {copied ? "Ссылка скопирована" : "Скопировать ссылку штаба"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-12 lg:px-10">
        <section className="space-y-5 lg:col-span-5">
          <div
            className={cn(
              "space-y-3 rounded-panel border bg-[#16191D] p-5",
              isCrit ? "border-mts-red" : "border-[#242830]",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-pill bg-mts-red px-2.5 py-0.5 text-[11px] font-bold text-white uppercase">
                {incident.rawPriority}
              </span>
              <span className="text-label-sm text-[#8F98A3]">
                {incident.serviceType || "IT-сервис"}
              </span>
            </div>
            <h1 className="text-title-lg font-semibold text-white">
              {incident.title || incident.product}
            </h1>
            <p className="text-label-md whitespace-pre-wrap text-[#D6DADF]">
              {incident.description || "Описание не указано."}
            </p>
          </div>

          <div className="space-y-3 rounded-panel border border-[#242830] bg-[#16191D] p-5">
            <h2 className="flex items-center gap-2 font-sans text-label-md font-semibold text-white">
              <Users className="size-4 text-[#8F98A3]" />
              Участники и привлечённые подразделения ({warRoom.teams.length})
            </h2>
            <p className="text-label-sm text-[#8F98A3]">
              Основной ответственный:{" "}
              <strong className="text-white">
                {incident.assigneeEmployee || "Не назначен"}
              </strong>
            </p>
            <ul className="flex flex-wrap gap-2">
              {warRoom.teams.length > 0 ? (
                warRoom.teams.map((team) => (
                  <li
                    key={team}
                    className="rounded-control border border-[#2B313B] bg-[#1C2026] px-3 py-1.5 text-label-sm text-[#F5F7FA]"
                  >
                    {team}
                  </li>
                ))
              ) : (
                <li className="text-label-sm text-[#8F98A3]">
                  Подразделения ещё не подключены.
                </li>
              )}
            </ul>
          </div>

          {incident.ai && (
            <div className="space-y-2.5 rounded-panel border border-[#242830] bg-[#16191D] p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-sans text-label-md font-semibold text-white">
                  Сводка ИИ-советника
                </h2>
                <span className="text-label-sm font-semibold text-mts-red">
                  Риск {incident.ai.riskScore}%
                </span>
              </div>
              <p className="text-label-sm text-[#D6DADF]">
                {incident.ai.summary}
              </p>
              <p className="text-label-sm text-[#8F98A3]">
                Рекомендуемая команда:{" "}
                <strong className="text-white">
                  {incident.ai.recommendedTeam}
                </strong>
              </p>
            </div>
          )}
        </section>

        <section className="flex flex-col rounded-panel border border-[#242830] bg-[#16191D] p-5 lg:col-span-7">
          <h2 className="text-title-lg font-medium text-white">
            Оперативный журнал штаба
          </h2>
          <p className="mt-1 text-label-sm text-[#8F98A3]">
            Записи сохраняются в базу и автоматически попадают во вкладку
            «История» инцидента.
          </p>

          <form onSubmit={handleSend} className="mt-4 space-y-3 border-b border-[#242830] pb-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Ваше имя"
                className="h-10 rounded-control border-[#303640] bg-[#0D0F12] text-white placeholder:text-[#626C77]"
              />
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Роль (Координатор / Инженер)"
                className="h-10 rounded-control border-[#303640] bg-[#0D0F12] text-white placeholder:text-[#626C77]"
              />
            </div>
            <div className="flex gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Зафиксировать действие, гипотезу или статус диагностики…"
                className="h-11 rounded-control border-[#303640] bg-[#0D0F12] text-white placeholder:text-[#626C77]"
              />
              <Button
                type="submit"
                disabled={sending || !text.trim()}
                className="h-11 shrink-0 rounded-control bg-mts-red px-4 font-semibold text-white hover:bg-mts-crimson"
              >
                <Send className="size-4" />
                Отправить
              </Button>
            </div>
          </form>

          <ol className="mt-4 flex-1 space-y-3 overflow-y-auto">
            {notes.length > 0 ? (
              notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-control border border-[#242830] bg-[#1C2026] p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-label-sm">
                    <strong className="text-white">{note.actor}</strong>
                    <time className="text-[#8F98A3]">
                      {noteTimeFormat.format(new Date(note.createdAt))} МСК
                    </time>
                  </div>
                  <p className="mt-1.5 text-label-md text-[#E4E8EE] wrap-break-word">
                    {note.text}
                  </p>
                </li>
              ))
            ) : (
              <li className="rounded-control border border-dashed border-[#2B313B] p-6 text-center text-label-sm text-[#8F98A3]">
                Оперативных записей пока нет. Зафиксируйте первый шаг
                диагностики.
              </li>
            )}
          </ol>
        </section>
      </main>
    </div>
  );
}