import { Copy, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import type { DashboardIncident } from "./dashboard-model";
import { AnalyzeButton, type AiAnalysisControls } from "./dashboard-ai";

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

export function IncidentDetails(props: {
  incident?: DashboardIncident;
  status?: ReactNode;
  priority?: string;
  created?: ReactNode;
  deadline?: ReactNode;
  sla?: ReactNode;
  groups?: ReactNode;
  itsm?: ReactNode;
  onClose: () => void;
  restoreFocus: () => void;
  aiControls: AiAnalysisControls;
}) {
  const [lastDetails, setLastDetails] = useState(props);
  if (props.incident && props !== lastDetails) setLastDetails(props);

  const { incident, status, priority, created, deadline, sla, groups, itsm, aiControls } =
    props.incident ? props : lastDetails;
  const { onClose, restoreFocus } = props;
  const analysis = incident?.ai;
  const risk = analysis?.riskScore;
  const riskScore = typeof risk === "number" && Number.isFinite(risk) && risk >= 0 && risk <= 100 ? risk : undefined;
  const handoff = analysis?.handoffMessage.trim();

  return (
    <Sheet open={Boolean(props.incident)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {incident && (
        <SheetContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg motion-reduce:animate-none"
        >
          <SheetHeader className="border-b p-6 pr-16">
            <SheetTitle className="text-title-lg wrap-break-word">{incident.title || incident.product}</SheetTitle>
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
                <DetailField label="Продукт">{incident.product}</DetailField>
                <DetailField label="Исполнитель">{incident.assigneeTeam || "Не назначен"}</DetailField>
                <DetailField label="Статус">{status}</DetailField>
                <DetailField label="Приоритет">{priority ?? "—"}</DetailField>
                <DetailField label="Создан">{created}</DetailField>
                {incident.slaDeadline && <DetailField label="Срок SLA">{deadline}</DetailField>}
                <DetailField label="Остаток SLA">{sla}</DetailField>
                <DetailField label="Группы">{groups}</DetailField>
              </dl>
              {incident.description && (
                <div>
                  <h4 className="font-sans font-semibold">Описание</h4>
                  <p className="mt-2 whitespace-pre-wrap wrap-break-word">{incident.description}</p>
                </div>
              )}
              {itsm}
            </section>

            <section aria-labelledby="incident-analysis-heading" className="space-y-4 rounded-panel border bg-background p-4">
              <h3 id="incident-analysis-heading" className="text-title-lg">ИИ-анализ</h3>
              {analysis?.summary && <p className="whitespace-pre-wrap wrap-break-word">{analysis.summary}</p>}
              {!analysis && <p className="text-muted-foreground">ИИ-анализ пока недоступен.</p>}
              {analysis?.recommendedTeam && (
                <p><strong>Команда для передачи:</strong> {analysis.recommendedTeam}</p>
              )}
              {riskScore !== undefined && (
                <div>
                  <label className="block font-medium" htmlFor="incident-risk-meter">Риск эскалации · {riskScore}%</label>
                  <meter id="incident-risk-meter" className="mt-2 h-4 w-full" min={0} max={100} value={riskScore} />
                </div>
              )}
              {analysis?.riskReason && <p className="whitespace-pre-wrap wrap-break-word">{analysis.riskReason}</p>}
              <AnalyzeButton controls={aiControls} incidentId={incident.id} />
              {handoff && <HandoffText key={handoff} text={handoff} />}
            </section>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}
