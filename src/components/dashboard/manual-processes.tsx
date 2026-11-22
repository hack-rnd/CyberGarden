"use client";

import { useId, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
const selectTriggerClass = "h-12 w-full rounded-control border-input bg-card text-label-md hover:border-mts-muted";
const selectContentClass = "max-h-[min(18rem,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width) min-w-0 rounded-panel border-border bg-card shadow-[0_4px_16px_rgba(29,32,35,0.08)]";

type ProcessCatalog = {
  products: readonly string[];
  assignees: readonly string[];
};

function catalogMatch(value: string, options: readonly string[]) {
  const typed = value.toLocaleLowerCase("ru");
  return options.find((option) => option.trim() === value)
    ?? options.find((option) => option.trim().toLocaleLowerCase("ru") === typed);
}

function normalizeDeadlineIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function CatalogField({ label, name, value, options, required }: {
  label: string;
  name: "product" | "assigneeTeam";
  value?: string;
  options: readonly string[];
  required?: boolean;
}) {
  const id = useId();

  return (
    <label className={fieldClass}>
      {label}
      <Input
        name={name}
        list={id}
        autoComplete="off"
        required={required}
        defaultValue={value}
        placeholder="Введите название или выберите из списка"
        className="h-12 rounded-control border-input bg-card"
      />
      <datalist id={id}>
        {options.map((option) => <option key={option} value={option} />)}
      </datalist>
    </label>
  );
}

function ProcessSelect({ label, name, value, options }: {
  label: string;
  name: "status" | "priority";
  value: string;
  options: Readonly<Record<string, string>>;
}) {
  const id = useId();
  const [selected, setSelected] = useState(value);

  return (
    <div className={fieldClass}>
      <label htmlFor={id}>{label}</label>
      <input type="hidden" name={name} value={selected} />
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger id={id} className={selectTriggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          side="bottom"
          align="start"
          collisionPadding={8}
          className={selectContentClass}
        >
          <SelectGroup>
            {Object.entries(options).map(([optionValue, optionLabel]) => (
              <SelectItem key={optionValue} value={optionValue} className="whitespace-normal">
                {optionLabel}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

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
  editor, products, assignees, onClose, onSave, restoreFocus,
}: {
  editor: ProcessEditorState | null;
  onClose: () => void;
  onSave: (fields: ProcessFields, id?: string) => void;
  restoreFocus: () => void;
} & ProcessCatalog) {
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
          <SheetTitle>{displayedEditor?.process ? "Редактировать инцидент" : "Добавить инцидент"}</SheetTitle>
          <SheetDescription>Процесс сохраняется в этом браузере.</SheetDescription>
        </SheetHeader>
        {displayedEditor && (
          <ProcessForm
            key={displayedEditor.process?.id ?? "new"}
            process={displayedEditor.process}
            products={products}
            assignees={assignees}
            onSave={onSave}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProcessForm({ process, products, assignees, onSave }: {
  process?: ProcessEditorState["process"];
  onSave: (fields: ProcessFields, id?: string) => void;
} & ProcessCatalog) {
  const [error, setError] = useState("");
  const initialDeadline = process?.slaDeadline && Number.isFinite(Date.parse(process.slaDeadline))
    ? moscowTime.format(new Date(process.slaDeadline)).replace(" ", "T")
    : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const typedProduct = String(data.get("product") ?? "").trim();
    const product = catalogMatch(typedProduct, products) ?? typedProduct;
    if (!product) {
      setError("Укажите название продукта.");
      return;
    }
    const typedAssignee = String(data.get("assigneeTeam") ?? "").trim();
    const assignee = typedAssignee
      ? (catalogMatch(typedAssignee, assignees) ?? typedAssignee)
      : "";
    const deadline = data.get("slaDeadline");
    const timestamp = typeof deadline === "string" && deadline ? Date.parse(`${deadline}:00+03:00`) : null;
    if (timestamp !== null && !Number.isFinite(timestamp)) {
      setError("Укажите корректные дату и время SLA.");
      return;
    }
    const normalizedDeadline = deadline === initialDeadline
      ? normalizeDeadlineIso(process?.slaDeadline)
      : timestamp === null ? null : new Date(timestamp).toISOString();

    const result = manualProcessFields.safeParse({
      product,
      description: data.get("description"),
      assigneeTeam: assignee,
      priority: data.get("priority"),
      status: data.get("status"),
      groups: data.getAll("groups"),
      slaDeadline: normalizedDeadline,
      itsmUrl: data.get("itsmUrl"),
    });
    if (!result.success) {
      const itsmIssue = result.error.issues.some((issue) => issue.path[0] === "itsmUrl");
      if (itsmIssue) {
        setError("Введите полную ссылку на запись ITSM, начинающуюся с http:// или https://.");
      } else {
        const details = result.error.issues
          .map((issue) => `${issue.path.join(".") || "поле"}: ${issue.message}`)
          .join("; ");
        setError(`Проверьте значения полей (${details}).`);
      }
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
      <CatalogField label="Продукт" name="product" value={process?.product} options={products} required />
      <label className={fieldClass}>
        Описание
        <textarea name="description" maxLength={3000} rows={3} defaultValue={process?.description} className={controlClass} />
      </label>
      <CatalogField label="Исполнитель" name="assigneeTeam" value={process?.assigneeTeam} options={assignees} />
      <label className={fieldClass}>
        Ссылка на запись ITSM (необязательно)
        <Input type="url" name="itsmUrl" maxLength={2048} defaultValue={process?.itsmUrl} placeholder="https://…" className="h-10" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <ProcessSelect label="Статус" name="status" value={process?.status ?? "new"} options={statusLabels} />
        <ProcessSelect label="Приоритет" name="priority" value={process?.priority ?? "medium"} options={priorityLabels} />
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