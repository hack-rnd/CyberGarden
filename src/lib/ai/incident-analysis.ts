import { z } from "zod";
import type { IncidentAiData, IncidentPriority, NormalizedIncident } from "@/types/incident";
import { AllProvidersFailedError, callLlmWithFallback } from "./client";

// --- TEAM DIRECTORY ---

export const TEAM_DIRECTORY = [
  "Команда Core",
  "Техподдержка",
  "Биллинг",
  "Сетевая инфраструктура",
] as const;

// --- SCHEMA ---

const incidentAiSchema = z.object({
  summary: z.string().min(1).max(600),
  recommendedTeam: z.string().refine(
    (team) => (TEAM_DIRECTORY as readonly string[]).includes(team),
    { message: "recommendedTeam must be from TEAM_DIRECTORY" },
  ),
  riskScore: z.number().int().min(0).max(100),
  riskLevel: z.enum(["low", "medium", "high"]),
  riskReason: z.string().min(1).max(1000),
  handoffMessage: z.string().min(1).max(600),
});

type LlmAnalysisPayload = z.infer<typeof incidentAiSchema>;

// --- PROMPT ---

export function buildIncidentPrompt(incident: NormalizedIncident): string {
  const slaLine =
    incident.slaRemainingMs === null
      ? "SLA: не задан (инцидент решён, закрыт или на исследовании)"
      : `SLA: дедлайн ${incident.slaDeadline}, осталось ${Math.ceil(incident.slaRemainingMs / 60_000)} мин`;

  return [
    "Проанализируй инцидент и верни строго JSON по схеме:",
    "{",
    '  "summary": "краткая суть проблемы для координатора (1-2 предложения)",',
    '  "recommendedTeam": "одна из команд справочника",',
    '  "riskScore": число 0-100 — риск перерастания в критический,',
    '  "riskLevel": "low" | "medium" | "high",',
    '  "riskReason": "обоснование оценки риска",',
    '  "handoffMessage": "готовый текст передачи инцидента рекомендованной команде (1-2 предложения)"',
    "}",
    "",
    "Справочник команд (выбирай только из него):",
    ...TEAM_DIRECTORY.map((team) => `- ${team}`),
    "",
    "Данные инцидента:",
    `- Продукт: ${incident.product}`,
    `- Название: ${incident.title}`,
    `- Описание: ${incident.description}`,
    `- Приоритет: ${incident.priority} (исходное значение: ${incident.rawPriority})`,
    `- Статус: ${incident.status} (исходное значение: ${incident.rawStatus})`,
    `- Команда-исполнитель: ${incident.assigneeTeam}`,
    `- ${slaLine}`,
    `- Группы на дашборде: ${incident.groups.join(", ") || "нет"}`,
    "",
    "Правила: учитывай приоритет, остаток SLA, тип продукта и описание.",
    "Если инцидент назначен на координаторов, рекомендуй команду для передачи.",
    "Отвечай на русском. Не выдумывай команды вне справочника.",
  ].join("\n");
}

// --- LLM ANALYSIS ---

function toAiData(payload: LlmAnalysisPayload, provider: string): IncidentAiData {
  return { ...payload, provider, updatedAt: new Date().toISOString() };
}

export async function analyzeIncident(incident: NormalizedIncident): Promise<IncidentAiData> {
  const result = await callLlmWithFallback(buildIncidentPrompt(incident), incidentAiSchema);
  return toAiData(result.data, result.provider);
}

// --- RULE-BASED FALLBACK ---

const RISK_BY_PRIORITY: Record<IncidentPriority, number> = {
  critical: 90,
  high: 65,
  medium: 40,
  low: 15,
};

const TEAM_BY_KEYWORD: [RegExp, (typeof TEAM_DIRECTORY)[number]][] = [
  [/биллинг|платеж|оплат|charging/i, "Биллинг"],
  [/сеть|network|базовая станция|канал|dns|dhcp/i, "Сетевая инфраструктура"],
  [/ядро|core|платформ|api/i, "Команда Core"],
];

export function analyzeIncidentRuleBased(incident: NormalizedIncident): IncidentAiData {
  let riskScore = RISK_BY_PRIORITY[incident.priority] ?? 35;
  const remaining = incident.slaRemainingMs;

  if (remaining !== null) {
    if (remaining <= 0) riskScore = Math.min(100, riskScore + 20);
    else if (remaining < 30 * 60_000) riskScore = Math.min(100, riskScore + 15);
    else if (remaining < 120 * 60_000) riskScore = Math.min(100, riskScore + 5);
  }
  if (incident.groups.includes("CRITICAL")) {
    riskScore = Math.max(riskScore, 85);
  }

  const riskLevel: IncidentAiData["riskLevel"] =
    riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low";

  const haystack = `${incident.product} ${incident.title} ${incident.description}`;
  const matched = TEAM_BY_KEYWORD.find(([re]) => re.test(haystack));
  const recommendedTeam = matched?.[1] ?? "Техподдержка";

  const slaText =
    remaining === null ? "SLA не задан" : `остаток SLA ${Math.ceil(remaining / 60_000)} мин`;

  return {
    summary: `Инцидент «${incident.title}» на продукте ${incident.product}. Приоритет: ${incident.priority}.`,
    recommendedTeam,
    riskScore,
    riskLevel,
    riskReason: `Оценка по правилам: приоритет ${incident.priority}, ${slaText}, группы: ${incident.groups.join(", ") || "нет"}.`,
    handoffMessage: `Передайте в «${recommendedTeam}»: ${incident.title}. ${slaText}.`,
    provider: "rule-based",
    updatedAt: new Date().toISOString(),
  };
}

// --- SAFE ENTRYPOINT ---

export async function analyzeIncidentSafe(incident: NormalizedIncident): Promise<IncidentAiData> {
  try {
    return await analyzeIncident(incident);
  } catch (error) {
    if (error instanceof AllProvidersFailedError) {
      return analyzeIncidentRuleBased(incident);
    }
    throw error;
  }
}
