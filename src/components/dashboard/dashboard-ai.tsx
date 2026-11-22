"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { manualProcessAnalysis, manualProcessInput } from "@/lib/manual-process";
import {
  getManualProcessSnapshot,
  readManualProcesses,
  saveManualProcessAnalysis,
} from "@/lib/manual-process-storage";
import type { IncidentAiData, NormalizedIncident } from "@/types/incident";

type DigestConcern = Pick<
  IncidentAiData,
  "riskScore" | "riskLevel" | "summary" | "recommendedTeam"
> &
  Pick<NormalizedIncident, "code" | "product"> & {
    incidentId: NormalizedIncident["id"];
    willBreachSla: boolean;
  };

type AiDigest = {
  headline: string;
  analyzedCount: number;
  pendingCount: number;
  highRiskCount: number;
  breachForecastCount: number;
  handoffsPending: number;
  topConcerns: DigestConcern[];
};

const digestKey = ["ai", "digest"] as const;

export function useDashboardAi() {
  const queryClient = useQueryClient();
  const digest = useQuery({
    queryKey: digestKey,
    queryFn: async ({ signal }): Promise<AiDigest | null> => {
      const response = await fetch("/api/ai/digest", {
        cache: "no-store",
        signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Не удалось загрузить сводку ИИ.");
      return response.json();
    },
    refetchInterval: 30_000,
  });

  const analysis = useMutation({
    mutationFn: async (incidentId: string | null) => {
      const manualProcess = incidentId?.startsWith("PR-")
        ? readManualProcesses(getManualProcessSnapshot()).find(
            ({ id }) => id === incidentId,
          )
        : undefined;
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        ...(incidentId && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            manualProcess
              ? { manualProcess: manualProcessInput.parse(manualProcess) }
              : { incidentId },
          ),
        }),
      });
      if (response.status === 404) {
        throw new Error(
          incidentId
            ? "Сервис ИИ недоступен или инцидент больше не найден."
            : "Сервис ИИ пока недоступен.",
        );
      }
      if (!response.ok) throw new Error("Не удалось выполнить анализ ИИ.");
      if (manualProcess) {
        const result = await response.json();
        const parsed = manualProcessAnalysis.safeParse(result.ai);
        if (!parsed.success) {
          throw new Error("Сервис ИИ вернул некорректный результат.");
        }
        saveManualProcessAnalysis(manualProcess, parsed.data);
        return "manual";
      }
    },
    onSuccess: async (result) => {
      if (result === "manual") return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: digestKey }),
        queryClient.invalidateQueries({ queryKey: ["incidents"] }),
      ]);
    },
  });

  return { digest, analysis };
}

export type AiAnalysisControls = ReturnType<typeof useDashboardAi>["analysis"];

export function AnalyzeButton({
  controls,
  incidentId = null,
}: {
  controls: AiAnalysisControls;
  incidentId?: string | null;
}) {
  const isIncidentAnalysis = incidentId !== null;
  const isCurrent = controls.variables === incidentId;
  const pending = controls.isPending && isCurrent;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant={isIncidentAnalysis ? "default" : "outline"}
        className={
          isIncidentAnalysis
            ? "min-h-11 w-full gap-2 rounded-control bg-mts-red px-5 text-label-md font-semibold text-white hover:bg-mts-crimson sm:w-auto"
            : "min-h-10 rounded-control"
        }
        disabled={controls.isPending}
        aria-busy={pending}
        onClick={() => controls.mutate(incidentId)}
      >
        {pending && (
          <LoaderCircle
            aria-hidden="true"
            className="size-4 motion-safe:animate-spin"
            style={{ animationDuration: "400ms" }}
          />
        )}
        {pending ? "Анализируем…" : "Обновить ИИ-анализ"}
      </Button>
      {isCurrent && controls.isError && (
        <p role="alert" className="text-label-sm text-mts-crimson">
          {controls.error.message}
        </p>
      )}
      {isCurrent && controls.isSuccess && (
        <p role="status" className="text-label-sm text-muted-foreground">
          Анализ завершён.
        </p>
      )}
    </div>
  );
}