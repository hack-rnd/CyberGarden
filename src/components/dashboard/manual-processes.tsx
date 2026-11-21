"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { manualProcessFields, type ProcessFields } from "@/lib/manual-process";
import {
  getIncidentOverridesSnapshot,
  getManualProcessSnapshot,
  manualProcessesChanged,
  readIncidentOverrides,
  readManualProcesses,
  writeManualProcesses,
} from "@/lib/manual-process-storage";
import type { NormalizedIncident } from "@/types/incident";
import { incidentGroups } from "./dashboard-summary";
import { priorityLabels, statusLabels } from "./incident-views";

export type ProcessEditorState = {
  process?: NormalizedIncident;
  source?: NormalizedIncident;
};

const moscowTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Moscow",
  dateStyle: "short",
  timeStyle: "short",
});
const fieldClass = "grid gap-2 text-label-md font-medium";
const controlClass = "min-h-10 w-full rounded-control border bg-background px-3 py-2 font-normal focus-visible:outline-2 focus-visible:outline-ring";

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(manualProcessesChanged, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(manualProcessesChanged, notify);
  };
}

export function useManualProcesses() {
  const snapshot = useSyncExternalStore(subscribe, getManualProcessSnapshot, () => "[]");
  const processes = useMemo(() => readManualProcesses(snapshot), [snapshot]);
  const overrideSnapshot = useSyncExternalStore(subscribe, getIncidentOverridesSnapshot, () => "{}");
  const overrides = useMemo(() => readIncidentOverrides(overrideSnapshot), [overrideSnapshot]);

  function save(fields: ProcessFields, id?: string) {
    const latest = readManualProcesses(getManualProcessSnapshot());
    const previous = id ? latest.find((process) => process.id === id) : undefined;
    if (id && !previous) throw new Error("Процесс больше не найден. Откройте список заново.");

    let newId = previous?.id;
    while (!newId || (!previous && latest.some((entry) => entry.id === newId))) {
      newId = `PR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    }
    const process = {
      ...fields,
      id: newId,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      revision: crypto.randomUUID(),
    };
    const next = previous
      ? latest.map((entry) => entry.id === previous.id ? process : entry)
      : [process, ...latest];
    writeManualProcesses(next);
    return process.id;
  }

  return { processes, overrides, save };
}

export function ManualProcessEditor({
  editor, onClose, onSave, restoreFocus,
}: {
  editor: ProcessEditorState | null;
  onClose: () => void;
  onSave: (fields: ProcessFields, id?: string) => void;
  restoreFocus: () => void;
}) {
  const [lastEditor, setLastEditor] = useState(editor);
  if (editor && editor !== lastEditor) setLastEditor(editor);
  const displayedEditor = editor ?? lastEditor;

  return (
    <Sheet open={editor !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg motion-reduce:animate-none"
        showCloseButton={false}
      >
        <SheetHeader className="p-6 pb-0">
          <SheetTitle>{displayedEditor?.process ? "Редактировать процесс" : "Добавить процесс"}</SheetTitle>
          <SheetDescription>Процесс сохраняется в этом браузере.</SheetDescription>
        </SheetHeader>
        {displayedEditor && <ProcessForm key={displayedEditor.process?.id ?? "new"} process={displayedEditor.process} onSave={onSave} />}
      </SheetContent>
    </Sheet>
  );
}

function ProcessForm({ process, onSave }: {
  process?: ProcessEditorState["process"];
  onSave: (fields: ProcessFields, id?: string) => void;
}) {
  const [error, setError] = useState("");
  const initialDeadline = process?.slaDeadline
    ? moscowTime.format(new Date(process.slaDeadline)).replace(" ", "T")
    : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const deadline = data.get("slaDeadline");
    const timestamp = typeof deadline === "string" && deadline ? Date.parse(`${deadline}:00+03:00`) : null;
    if (timestamp !== null && !Number.isFinite(timestamp)) {
      setError("Укажите корректные дату и время SLA.");
      return;
    }
    const result = manualProcessFields.safeParse({
      product: data.get("product"),
      description: data.get("description"),
      assigneeTeam: data.get("assigneeTeam"),
      priority: data.get("priority"),
      status: data.get("status"),
      groups: data.getAll("groups"),
      slaDeadline: deadline === initialDeadline
        ? process?.slaDeadline ?? null
        : timestamp === null ? null : new Date(timestamp).toISOString(),
      itsmUrl: data.get("itsmUrl"),
    });
    if (!result.success) {
      setError(result.error.issues.some((issue) => issue.path[0] === "itsmUrl")
        ? "Введите полную ссылку на запись ITSM, начинающуюся с http:// или https://."
        : "Проверьте название процесса и значения полей.");
      return;
    }
    try {
      onSave(result.data, process?.id);
    } catch {
      setError("Не удалось сохранить процесс. Проверьте, доступно ли хранилище браузера.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-6 pb-6">
      <label className={fieldClass}>
        Название процесса / продукт
        <Input name="product" required maxLength={120} defaultValue={process?.product} className="h-10" />
      </label>
      <label className={fieldClass}>
        Описание
        <textarea name="description" maxLength={3000} rows={3} defaultValue={process?.description} className={controlClass} />
      </label>
      <label className={fieldClass}>
        Исполнитель
        <Input name="assigneeTeam" maxLength={120} defaultValue={process?.assigneeTeam} className="h-10" />
      </label>
      <label className={fieldClass}>
        Ссылка на запись ITSM (необязательно)
        <Input type="url" name="itsmUrl" maxLength={2048} defaultValue={process?.itsmUrl} placeholder="https://…" className="h-10" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={fieldClass}>
          Статус
          <select name="status" defaultValue={process?.status ?? "new"} className={controlClass}>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={fieldClass}>
          Приоритет
          <select name="priority" defaultValue={process?.priority ?? "medium"} className={controlClass}>
            {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="space-y-2 rounded-control border p-3">
        <legend className="px-1 text-label-md font-medium">Группы</legend>
        {incidentGroups.map(({ id, title }) => (
          <label key={id} className="flex min-h-8 items-center gap-2 text-label-md">
            <input type="checkbox" name="groups" value={id} defaultChecked={process?.groups.includes(id)} className="size-4 accent-primary" />
            {title}
          </label>
        ))}
      </fieldset>
      <label className={fieldClass}>
        Срок SLA (МСК)
        <Input
          type="datetime-local"
          name="slaDeadline"
          defaultValue={initialDeadline}
          className="h-10 min-w-0"
        />
      </label>
      {error && <p role="alert" className="text-label-md text-mts-crimson">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-10">Сохранить</Button>
        <SheetClose asChild>
          <Button type="button" variant="outline" className="h-10">Отмена</Button>
        </SheetClose>
      </div>
    </form>
  );
}
