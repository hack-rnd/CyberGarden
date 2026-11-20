import { Copy, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import type { DashboardIncident } from "./incident-views";

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-sm text-muted-foreground">{label}</dt>
      <dd className="mt-2 wrap-break-word">{children}</dd>
    </div>
  );
}

function HandoffText({ text }: { text: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "manual">("idle");
  const textarea = useRef<HTMLTextAreaElement>(null);

  async function copyHandoff() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("manual");
      textarea.current?.focus();
      textarea.current?.select();
    }
  }

  return (
    <div className="space-y-2">
      <label className="block font-medium">
        Текст для передачи
        <textarea
          ref={textarea}
          readOnly
          rows={5}
          value={text}
          className="mt-2 block w-full rounded-control border bg-background p-4 text-label-md font-normal focus-visible:outline-2 focus-visible:outline-ring"
        />
      </label>
      <Button type="button" variant="outline" className="min-h-10 rounded-control whitespace-normal" onClick={copyHandoff}>
        <Copy aria-hidden="true" /> Скопировать текст передачи
      </Button>
      <p role="status" className="text-label-sm text-muted-foreground">
        {copyStatus === "copied" && "Текст скопирован."}
        {copyStatus === "manual" && "Текст выделен. Нажмите Ctrl+C или ⌘C, чтобы скопировать."}
      </p>
    </div>
  );
}

export function IncidentDetails({
  incident, status, priority, created, updated, deadline, sla, groups, itsm, onClose, restoreFocus,
}: {
  incident?: DashboardIncident;
  status?: ReactNode;
  priority?: string;
  created?: ReactNode;
  updated?: ReactNode;
  deadline?: ReactNode;
  sla?: ReactNode;
  groups?: ReactNode;
  itsm?: ReactNode;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const analysis = incident?.analysis;
  const risk = analysis?.riskScore ?? incident?.riskScore;
  const riskScore = typeof risk === "number" && Number.isFinite(risk) && risk >= 0 && risk <= 100 ? risk : undefined;
  const forecast = analysis?.slaForecast ?? incident?.slaForecast;
  const recommendedTeam = analysis?.recommendedTeam || analysis?.targetTeam;
  const handoff = analysis?.handoffText?.trim() ? analysis.handoffText : undefined;
  const hasAnalysis = Boolean(
    analysis?.summary || recommendedTeam || riskScore !== undefined || analysis?.riskReason ||
    forecast || analysis?.rootCause || analysis?.actionPlan?.length || handoff,
  );

  return (
    <Sheet open={Boolean(incident)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {incident && (
        <SheetContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg motion-reduce:animate-none"
        >
          <SheetHeader className="border-b p-6 pr-16">
            <SheetTitle className="text-title-lg wrap-break-word">{incident.title || incident.service}</SheetTitle>
            <SheetDescription>Инцидент {incident.id}</SheetDescription>
          </SheetHeader>
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="icon" className="absolute top-4 right-4" aria-label="Закрыть детали инцидента">
              <X aria-hidden="true" />
            </Button>
          </SheetClose>

          <div key={incident.id} className="space-y-6 px-6 pb-6">
            <section aria-labelledby="incident-details-heading" className="space-y-4">
              <h3 id="incident-details-heading" className="text-title-lg">Детали инцидента</h3>
              <dl className="grid grid-cols-2 gap-4">
                <DetailField label="Продукт">{incident.service}</DetailField>
                <DetailField label="Исполнитель">{incident.assignedTeam || "Не назначен"}</DetailField>
                <DetailField label="Статус">{status}</DetailField>
                <DetailField label="Приоритет">{priority ?? "—"}</DetailField>
                <DetailField label="Создан">{created}</DetailField>
                {incident.updatedAt && <DetailField label="Обновлён">{updated}</DetailField>}
                {incident.slaDeadline && <DetailField label="Срок SLA">{deadline}</DetailField>}
                <DetailField label="Остаток SLA">{sla}</DetailField>
                {incident.region && <DetailField label="Регион">{incident.region}</DetailField>}
                {incident.affectedUsers !== undefined && <DetailField label="Затронуто пользователей">{incident.affectedUsers}</DetailField>}
                <DetailField label="Группы">{groups}</DetailField>
              </dl>
              {incident.description && (
                <div>
                  <h4 className="font-sans font-semibold">Описание</h4>
                  <p className="mt-2 whitespace-pre-wrap wrap-break-word">{incident.description}</p>
                </div>
              )}
              {incident.metrics && Object.keys(incident.metrics).length > 0 && (
                <dl className="grid grid-cols-2 gap-4">
                  {Object.entries(incident.metrics).map(([label, value]) => (
                    <DetailField key={label} label={label}>{value}</DetailField>
                  ))}
                </dl>
              )}
              {itsm}
            </section>

            <section aria-labelledby="incident-analysis-heading" className="space-y-4 rounded-panel border bg-background p-4">
              <h3 id="incident-analysis-heading" className="text-title-lg">ИИ-анализ</h3>
              {analysis?.summary && <p className="whitespace-pre-wrap wrap-break-word">{analysis.summary}</p>}
              {!hasAnalysis && <p className="text-muted-foreground">ИИ-анализ пока недоступен.</p>}
              {recommendedTeam && (
                <p><strong>Команда для передачи:</strong> {recommendedTeam}</p>
              )}
              {riskScore !== undefined && (
                <div>
                  <label className="block font-medium" htmlFor="incident-risk-meter">Риск эскалации · {riskScore}%</label>
                  <meter id="incident-risk-meter" className="mt-2 h-4 w-full" min={0} max={100} value={riskScore} />
                </div>
              )}
              {analysis?.riskReason && <p className="whitespace-pre-wrap wrap-break-word">{analysis.riskReason}</p>}
              {forecast && <p><strong>Прогноз SLA:</strong> {forecast}</p>}
              {analysis?.rootCause && <p><strong>Вероятная причина:</strong> {analysis.rootCause}</p>}
              {!!analysis?.actionPlan?.length && (
                <ol className="list-decimal space-y-2 pl-4">
                  {analysis.actionPlan.map((action, index) => <li key={index}>{action}</li>)}
                </ol>
              )}
              {handoff && <HandoffText key={handoff} text={handoff} />}
            </section>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}
