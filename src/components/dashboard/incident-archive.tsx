"use client";

import { Archive, History, RotateCcw, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  getManualProcessSnapshot,
  manualProcessesChanged,
  readManualProcessHistory,
  readManualProcesses,
  writeManualProcesses,
  type ProcessHistoryEvent,
} from "@/lib/manual-process-storage";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type ArchiveEntry = {
  id: string;
  code: string;
  product: string;
  archivedAt: number;
  resolvedAt?: number | null;
  deleted?: true;
  deletedAt?: number;
};

const storageKey = "cybergarden:incident-archive";
const archiveChanged = "cybergarden:incident-archive-changed";
const emptyArchive = "[]";
let sessionSnapshot: string | undefined;

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

function getArchiveSnapshot() {
  if (sessionSnapshot !== undefined) return sessionSnapshot;

  try {
    return localStorage.getItem(storageKey) ?? emptyArchive;
  } catch {
    return emptyArchive;
  }
}

function readArchive(snapshot: string): ArchiveEntry[] {
  try {
    const data = JSON.parse(snapshot);
    if (!Array.isArray(data)) return [];

    return data.filter((entry): entry is ArchiveEntry =>
      entry !== null && typeof entry === "object" &&
      typeof entry.id === "string" &&
      typeof entry.code === "string" &&
      typeof entry.product === "string" &&
      Number.isFinite(entry.archivedAt) &&
      Math.abs(entry.archivedAt) <= 8.64e15 &&
      (entry.resolvedAt == null || Number.isFinite(entry.resolvedAt)),
    );
  } catch {
    return [];
  }
}

function subscribeToArchive(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(archiveChanged, onChange);
  window.addEventListener(manualProcessesChanged, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(archiveChanged, onChange);
    window.removeEventListener(manualProcessesChanged, onChange);
  };
}

function writeArchive(entries: ArchiveEntry[]) {
  const snapshot = JSON.stringify(entries);
  try {
    localStorage.setItem(storageKey, snapshot);
    sessionSnapshot = undefined;
  } catch {
    sessionSnapshot = snapshot;
  }
  window.dispatchEvent(new Event(archiveChanged));
}

export function deleteArchivedProcess(id: string) {
  const entries = readArchive(getArchiveSnapshot());
  const entry = entries.find((entry) => entry.id === id && !entry.deleted);
  if (!entry) return;

  const manual = readManualProcesses(getManualProcessSnapshot());
  if (manual.some((process) => process.id === id)) {
    writeManualProcesses(manual.filter((process) => process.id !== id));
    writeArchive(entries.filter((entry) => entry.id !== id));
    return;
  }

  const hidden: ArchiveEntry = {
    id,
    code: entry.code,
    product: entry.product,
    archivedAt: entry.archivedAt,
    deleted: true,
    deletedAt: Date.now(),
  };
  writeArchive(entries.map((entry) => entry.id === id ? hidden : entry));
}

export function useIncidentArchive() {
  const snapshot = useSyncExternalStore(
    subscribeToArchive,
    getArchiveSnapshot,
    () => emptyArchive,
  );
  const entries = useMemo(() => readArchive(snapshot), [snapshot]);

  function archive(incident: Pick<ArchiveEntry, "id" | "code" | "product">) {
    const current = readArchive(getArchiveSnapshot());
    if (current.some((entry) => entry.id === incident.id && entry.deleted)) return;
    writeArchive([
      { id: incident.id, code: incident.code, product: incident.product, archivedAt: Date.now() },
      ...current.filter(({ id }) => id !== incident.id),
    ]);
  }

  function restore(id: string) {
    writeArchive(readArchive(getArchiveSnapshot()).filter((entry) => entry.id !== id || entry.deleted));
  }

  return { entries, archive, restore };
}

export function IncidentArchive({
  entries,
  onRestore,
}: {
  entries: readonly ArchiveEntry[];
  onRestore: (id: string) => void;
}) {
  const visibleEntries = entries.filter((entry) => !entry.deleted);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  const manualSnapshot = useSyncExternalStore(subscribeToArchive, getManualProcessSnapshot, () => emptyArchive);
  const history = useMemo(() => {
    const events = readManualProcessHistory(manualSnapshot);
    for (const { id, code, product, deleted, deletedAt } of entries) {
      if (deleted && typeof deletedAt === "number" && Number.isFinite(deletedAt) &&
          deletedAt >= 0 && deletedAt <= 8.64e15) {
        events.push({ id: code || id, product, at: deletedAt, action: "deleted" });
      }
    }
    return events.sort((first, second) => second.at - first.at);
  }, [entries, manualSnapshot]);

  function confirmDelete(entry: ArchiveEntry) {
    if (!window.confirm(`Удалить процесс «${entry.product || entry.code || entry.id}» из архива?`)) return;
    setDeleteError("");
    try {
      deleteArchivedProcess(entry.id);
      closeButton.current?.focus();
    } catch {
      setDeleteError("Не удалось удалить процесс. Попробуйте ещё раз.");
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" className="h-11 rounded-control px-4 text-label-md">
          <Archive aria-hidden="true" />
          Архив инцидентов{visibleEntries.length > 0 && ` (${visibleEntries.length})`}
        </Button>
      </SheetTrigger>
      <SheetContent
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto sm:max-w-md motion-reduce:animate-none"
      >
        <SheetHeader className="p-6 pr-16">
          <SheetTitle>Архив инцидентов</SheetTitle>
          <SheetDescription>Процессы, скрытые из рабочего списка.</SheetDescription>
        </SheetHeader>
        <SheetClose asChild>
          <Button
            ref={closeButton}
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Закрыть архив"
            className="absolute top-4 right-4"
          >
            <X aria-hidden="true" />
          </Button>
        </SheetClose>

        <div role="group" aria-label="Раздел архива" className="flex flex-wrap gap-2 px-6 pb-4">
          <Button
            type="button"
            variant={showHistory ? "outline" : "secondary"}
            className="min-h-10"
            aria-pressed={!showHistory}
            onClick={() => setShowHistory(false)}
          >
            <Archive aria-hidden="true" />
            Архив
          </Button>
          <Button
            type="button"
            variant={showHistory ? "secondary" : "outline"}
            className="min-h-10"
            aria-pressed={showHistory}
            onClick={() => setShowHistory(true)}
          >
            <History aria-hidden="true" />
            История
          </Button>
        </div>

        {!showHistory && deleteError && (
          <p className="px-6 pb-3 text-mts-crimson" role="alert">{deleteError}</p>
        )}

        {showHistory ? (
          <ProcessHistory events={history} />
        ) : visibleEntries.length === 0 ? (
          <p className="px-6 pb-6 text-muted-foreground" role="status">Архив пока пуст.</p>
        ) : (
          <ul className="space-y-3 px-6 pb-6">
            {visibleEntries.map((entry) => (
              <li key={entry.id} className="space-y-2 rounded-panel border bg-card p-4">
                <p className="wrap-break-word text-label-sm text-muted-foreground">{entry.code || entry.id}</p>
                <p className="wrap-break-word font-semibold">{entry.product}</p>
                <p className="text-label-sm text-muted-foreground">
                  В архиве с {dateFormat.format(entry.archivedAt)} МСК
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="min-h-10" onClick={() => onRestore(entry.id)}>
                    <RotateCcw aria-hidden="true" />
                    Убрать из архива<span className="sr-only"> {entry.code || entry.id}</span>
                  </Button>
                  <Button type="button" variant="destructive" className="min-h-10" onClick={() => confirmDelete(entry)}>
                    <Trash2 aria-hidden="true" />
                    Удалить процесс<span className="sr-only"> {entry.code || entry.id}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProcessHistory({ events }: { events: readonly ProcessHistoryEvent[] }) {
  if (!events.length) {
    return <p className="px-6 pb-6 text-muted-foreground" role="status">История пока пуста.</p>;
  }

  return (
    <ol aria-label="История создания и удаления процессов" className="space-y-3 px-6 pb-6">
      {events.map((event) => (
        <li key={`${event.id}-${event.action}-${event.at}`} className="space-y-1 rounded-panel border bg-card p-4">
          <p className={event.action === "created" ? "font-semibold text-[#007A62]" : "font-semibold text-mts-crimson"}>
            {event.action === "created" ? "Процесс создан" : "Процесс удалён"}
          </p>
          <p className="wrap-break-word text-label-sm text-muted-foreground">{event.id}</p>
          {event.product && <p className="wrap-break-word">{event.product}</p>}
          <time className="text-label-sm text-muted-foreground" dateTime={new Date(event.at).toISOString()}>
            {dateFormat.format(event.at)} МСК
          </time>
        </li>
      ))}
    </ol>
  );
}
