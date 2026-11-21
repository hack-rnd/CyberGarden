import { useMutation } from "@tanstack/react-query";
import { Copy, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { IncidentAssignment, IncidentHistory } from "./incident-actions";
import type { DashboardIncident } from "./dashboard-model";
import { AnalyzeButton, type AiAnalysisControls } from "./dashboard-ai";

// --- HELPERS ---

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-sm text-muted-foreground">{label}</dt>
      <dd className="mt-2 wrap-break-word">{children}</dd>
    </div>
  );
}

function DetailContextFlags({ incident }: { incident: DashboardIncident }) {
  const flags: { label: string; className: string }[] = [];
  if (incident.isNeedUp) {
    flags.push({
      label: "Требует устранения последствий (УП)",
      className: "border-mts-amber/40 bg-mts-amber/12 text-[#B8380E]",
    });
  }
  if (incident.isMaster) {
    flags.push({
      label: "Мастер-инцидент",
      className: "border-mts-ink/25 bg-mts-ink/8 text-mts-ink",
    });
  }
  if (incident.isEffect) {
    flags.push({
      label: "Следствие / причина дочерних МИ",
      className: "border-mts-blue/30 bg-mts-blue/10 text-[#005EC4]",
    });
  }
  if (incident.isDouble) {
    flags.push({
      label: "Дубль",
      className: "border-border bg-muted text-muted-foreground",
    });
  }

  if (!flags.length) return null;

  return (
    <div className="space-y-2">
      <h4 className="font-sans text-label-sm font-semibold text-muted-foreground">
        Атрибуты массового инцидента
      </h4>
      <div className="flex flex-wrap gap-2">
        {flags.map(({ label, className }) => (
          <Badge
            key={label}
            variant="outline"
            className={`h-auto rounded-pill px-2.5 py-1 text-label-sm whitespace-normal ${className}`}
          >
            {label}
          </Badge>
        ))}
      </div>
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
      <Button
        type="button"
        variant="outline"
        className="min-h-10 rounded-control whitespace-normal"
        onClick={copyHandoff}
      >
        <Copy aria-hidden="true" /> Скопировать текст передачи
      </Button>
      <p role="status" className="text-label-sm text-muted-foreground">
        {copyStatus === "copied" && "Текст скопирован."}
        {copyStatus === "manual" &&
          "Текст выделен. Нажмите Ctrl+C или ⌘C, чтобы скопировать."}
      </p>
    </div>
  );
}

const similarSearchResultSchema = z.object({
  status: z.enum(["matched", "insufficient_data"]),
  observations: z.array(z.string()),
  similarIncident: z.object({
    id: z.string(),
    code: z.string(),
    product: z.string(),
    similarityReason: z.string(),
    confirmedRootCause: z.string(),
    resolution: z.string(),
  }).nullable(),
  hypothesis: z.string(),
  firstCheck: z.string(),
  evidence: z.array(z.string()),
});

type SimilarSearchResult = z.infer<typeof similarSearchResultSchema>;

async function findSimilarIncident(
  incident: DashboardIncident,
  serverBacked: boolean,
): Promise<SimilarSearchResult> {
  const { id, code, product, title, description, status, priority, contentHash } = incident;
  const body = serverBacked
    ? { incidentId: id }
    : {
        incidentId: id,
        incident: {
          id,
          code,
          product,
          title,
          description: description || title,
          status,
          priority,
          contentHash,
        },
      };

  const response = await fetch("/api/ai/similar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error("Не удалось найти похожий инцидент. Попробуйте ещё раз.");
  }

  const result = similarSearchResultSchema.safeParse(await response.json().catch(() => null));

  if (!result.success) {
    throw new Error("Сервис вернул ответ в неизвестном формате. Попробуйте ещё раз.");
  }

  return result.data;
}

function SimilarSearchList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="space-y-2">
      <h4 className="font-semibold">{title}</h4>
      {items.length > 0 ? (
        <ul className="list-disc space-y-2 pl-4">
          {items.map((item, index) => (
            <li key={index} className="wrap-break-word">{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Нет данных.</p>
      )}
    </div>
  );
}

function SimilarIncidentSearch({
  incident,
  serverBacked,
}: {
  incident: DashboardIncident;
  serverBacked: boolean;
}) {
  const search = useMutation({
    mutationFn: () => findSimilarIncident(incident, serverBacked),
    retry: false,
  });
  const result = search.data;
  const similar = result?.similarIncident;

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-10 rounded-control whitespace-normal"
        disabled={search.isPending}
        onClick={() => search.mutate()}
      >
        Найти похожий инцидент и проверку
      </Button>
      {search.isPending && <p role="status">Ищем похожий инцидент…</p>}
      {search.isError && <p role="alert">{search.error.message}</p>}

      {result && (
        <div className="space-y-4 rounded-panel border bg-card p-4 text-card-foreground">
          <SimilarSearchList title="Что наблюдаем" items={result.observations} />
          <div className="space-y-2">
            <h4 className="font-semibold">Похожий случай</h4>
            {result.status === "matched" && similar && (
              <div className="space-y-2 rounded-control border bg-background p-3">
                <p className="font-medium">{similar.code} · {similar.product}</p>
                <p className="wrap-break-word">{similar.similarityReason}</p>
                <p className="wrap-break-word">
                  <strong>Подтверждённая причина:</strong> {similar.confirmedRootCause}
                </p>
                <p className="wrap-break-word"><strong>Решение:</strong> {similar.resolution}</p>
              </div>
            )}
            {result.status === "insufficient_data" && (
              <p className="rounded-control bg-muted p-3 text-muted-foreground">
                Надёжного совпадения в архиве нет — данных для вывода недостаточно
              </p>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold">Гипотеза ИИ</h4>
              <Badge variant="outline">Гипотеза</Badge>
            </div>
            <p className="wrap-break-word">{result.hypothesis}</p>
          </div>
          <div className="space-y-2 rounded-control border-l-4 border-l-mts-blue bg-mts-blue/5 p-3">
            <h4 className="font-semibold">Что проверить первым</h4>
            <p className="wrap-break-word">{result.firstCheck}</p>
          </div>
          <SimilarSearchList title="Основания" items={result.evidence} />
        </div>
      )}
    </div>
  );
}

// --- DETAILS SHEET ---

export function IncidentDetails(props: {
  incident?: DashboardIncident;
  serverBacked?: boolean;
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
  const [historyId, setHistoryId] = useState<string>();
  if (props.incident && props !== lastDetails) setLastDetails(props);

  const {
    incident,
    status,
    priority,
    created,
    deadline,
    sla,
    groups,
    itsm,
    aiControls,
  } = props.incident ? props : lastDetails;
  const { onClose, restoreFocus } = props;
  const showHistory = Boolean(props.incident && props.serverBacked && historyId === props.incident.id);
  const analysis = incident?.ai;
  const risk = analysis?.riskScore;
  const riskScore =
    typeof risk === "number" && Number.isFinite(risk) && risk >= 0 && risk <= 100
      ? risk
      : undefined;
  const handoff = analysis?.handoffMessage.trim();

  return (
    <Sheet
      open={Boolean(props.incident)}
      onOpenChange={(open) => {
        if (!open) {
          setHistoryId(undefined);
          onClose();
        }
      }}
    >
      {incident && (
        <SheetContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg motion-reduce:animate-none"
        >
          <SheetHeader className="border-b p-6 pr-16">
            <SheetTitle className="text-title-lg wrap-break-word">
              {incident.title || incident.product}
            </SheetTitle>
            <SheetDescription>Инцидент {incident.id}</SheetDescription>
          </SheetHeader>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4"
              aria-label="Закрыть детали инцидента"
            >
              <X aria-hidden="true" />
            </Button>
          </SheetClose>

          {props.serverBacked && (
            <div className="flex gap-2 px-6">
              <Button
                type="button"
                variant={showHistory ? "ghost" : "secondary"}
                aria-pressed={!showHistory}
                onClick={() => setHistoryId(undefined)}
              >
                Обзор и ИИ
              </Button>
              <Button
                type="button"
                variant={showHistory ? "secondary" : "ghost"}
                aria-pressed={showHistory}
                onClick={() => setHistoryId(incident.id)}
              >
                История
              </Button>
            </div>
          )}
          {showHistory && <div className="px-6 pb-6"><IncidentHistory id={incident.id} /></div>}
          <div key={incident.id} hidden={showHistory} className="space-y-6 px-6 pb-6">
            <section
              aria-labelledby="incident-details-heading"
              className="space-y-4"
            >
              <h3 id="incident-details-heading" className="text-title-lg">
                Детали инцидента
              </h3>
              <dl className="grid grid-cols-2 gap-4">
                <DetailField label="Продукт">{incident.product}</DetailField>
                <DetailField label="Исполнитель">
                  {incident.assigneeTeam || "Не назначен"}
                </DetailField>
                <DetailField label="Статус">{status}</DetailField>
                <DetailField label="Приоритет">{priority ?? "—"}</DetailField>
                {incident.serviceType && (
                  <DetailField label="Тип сервиса">
                    {incident.serviceType}
                  </DetailField>
                )}
                {incident.receivingChannel && (
                  <DetailField label="Канал регистрации">
                    {incident.receivingChannel}
                  </DetailField>
                )}
                <DetailField label="Создан">{created}</DetailField>
                {incident.slaDeadline && (
                  <DetailField label="Срок SLA">{deadline}</DetailField>
                )}
                <DetailField label="Остаток SLA">{sla}</DetailField>
                <DetailField label="Группы">{groups}</DetailField>
              </dl>

              <DetailContextFlags incident={incident} />

              {incident.description && (
                <div>
                  <h4 className="font-sans font-semibold">Описание</h4>
                  <p className="mt-2 whitespace-pre-wrap wrap-break-word">
                    {incident.description}
                  </p>
                </div>
              )}
              {itsm}
              {props.serverBacked && <IncidentAssignment incident={incident} />}
            </section>

            <section
              aria-labelledby="incident-analysis-heading"
              className="space-y-4 rounded-panel border bg-background p-4"
            >
              <h3 id="incident-analysis-heading" className="text-title-lg">
                ИИ-анализ
              </h3>
              {analysis?.summary && (
                <p className="whitespace-pre-wrap wrap-break-word">
                  {analysis.summary}
                </p>
              )}
              {!analysis && (
                <p className="text-muted-foreground">
                  ИИ-анализ пока недоступен.
                </p>
              )}
              {analysis?.recommendedTeam && (
                <p>
                  <strong>Команда для передачи:</strong>{" "}
                  {analysis.recommendedTeam}
                </p>
              )}
              {riskScore !== undefined && (
                <div>
                  <label className="block font-medium" htmlFor="incident-risk-meter">
                    Риск эскалации · {riskScore}%
                  </label>
                  <meter
                    id="incident-risk-meter"
                    className="mt-2 h-4 w-full"
                    min={0}
                    max={100}
                    value={riskScore}
                  />
                </div>
              )}
              {analysis?.riskReason && (
                <p className="whitespace-pre-wrap wrap-break-word">
                  {analysis.riskReason}
                </p>
              )}
              <AnalyzeButton controls={aiControls} incidentId={incident.id} />
              <SimilarIncidentSearch
                incident={incident}
                serverBacked={Boolean(props.serverBacked)}
              />
              {handoff && <HandoffText key={handoff} text={handoff} />}
            </section>
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}