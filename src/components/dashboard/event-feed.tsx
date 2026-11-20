"use client";

import { Bell, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { DiffEvent } from "@/types/incident";

import type { IncidentTimelineEvent } from "./dashboard-model";

const eventTime = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export function EventFeed({
  events,
  liveEvents,
  visibleIncidentIds,
  onChoose,
}: {
  events?: readonly IncidentTimelineEvent[];
  liveEvents?: readonly DiffEvent[];
  visibleIncidentIds: ReadonlySet<string>;
  onChoose: (id: string, trigger?: HTMLElement) => void;
}) {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedId = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const liveIds = new Set(liveEvents?.map((event) => event.id));
  const unread = open ? 0 : [...liveIds].filter((id) => !readIds.has(id)).length;

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    setReadIds((previous) => new Set([...previous, ...liveIds].slice(-150)));
  }

  function chooseIncident(id: string) {
    selectedId.current = id;
    changeOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          aria-label={unread ? `Лента событий, непрочитанных: ${unread}` : "Лента событий"}
          className="relative size-10 rounded-control lg:w-auto lg:px-4"
        >
          <Bell aria-hidden="true" />
          <span className="hidden lg:inline">Лента событий</span>
          {unread > 0 && (
            <span aria-hidden="true" className="absolute top-0 right-0 min-w-5 rounded-pill bg-mts-red px-1 text-center text-label-sm font-bold text-white lg:static">
              {unread}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent
        showCloseButton={false}
        className="overflow-y-auto motion-reduce:animate-none"
        onCloseAutoFocus={(event) => {
          if (!selectedId.current) return;
          event.preventDefault();
          const id = selectedId.current;
          selectedId.current = null;
          onChoose(id, trigger.current ?? undefined);
        }}
      >
        <SheetHeader className="p-6 pr-16">
          <SheetTitle>Лента событий</SheetTitle>
          <SheetDescription>Изменения в выгрузке инцидентов · время московское</SheetDescription>
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
            {events.map((event) => {
              const timestamp = Date.parse(event.createdAt);

              return (
                <li key={event.id} className="space-y-2 py-4">
                  {Number.isFinite(timestamp) && (
                    <time dateTime={event.createdAt} className="text-label-sm text-muted-foreground">
                      {eventTime.format(timestamp)}
                    </time>
                  )}
                  <p className="font-medium">{event.title}</p>
                  {event.details && <p className="wrap-break-word text-muted-foreground">{event.details}</p>}
                  {visibleIncidentIds.has(event.incidentId) ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10 rounded-control"
                      onClick={() => chooseIncident(event.incidentId)}
                    >
                      Открыть детали {event.incidentId}
                    </Button>
                  ) : (
                    <p className="text-label-sm text-muted-foreground">
                      {event.incidentId} · отсутствует в рабочем списке
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-6 text-muted-foreground">
            {events ? "Событий пока нет." : "Ожидаем подключения ленты событий."}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
