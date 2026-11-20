import { z } from "zod";
import type { IncidentAiData, IncidentPriority, NormalizedIncident } from "@/types/incident";
import { AllProvidersFailedError, callLlmWithFallback } from "./client";
import { PRODUCTS, RESOLVER_TEAMS } from "./directory";
import { buildTeamReason, recommendTeam } from "./ruleTable";

// --- SCHEMA ---

const incidentAiSchema = z.object({
  summary: z.string().min(1).max(600),
  recommendedTeam: z.string().refine(
    (team) => (RESOLVER_TEAMS as readonly string[]).includes(team),
    { message: "recommendedTeam must be from RESOLVER_TEAMS" },
  ),
  teamReason: z.string().min(1).max(300),
  riskScore: z.number().int().min(0).max(100),
  riskLevel: z.enum(["low", "medium", "high"]),
  riskReason: z.string().min(1).max(1000),
  handoffBody: z.string().min(1).max(800),
});

type LlmAnalysisPayload = z.infer<typeof incidentAiSchema>;

// --- SYSTEM PROMPT ---

export function buildSystemPrompt(): string {
  return [
    "Ты — ИИ-ассистент координатора массовых инцидентов МТС.",
    "Координатор следит за сотнями инцидентов и должен за секунды понимать:",
    "что случилось, кому передать задачу и не перерастёт ли инцидент в критический.",
    "",
    "Справочник команд-исполнителей (рекомендуй ТОЛЬКО из него, точное название):",
    ...RESOLVER_TEAMS.map((team) => `- ${team}`),
    "",
    "Продукты ландшафта (для контекста):",
    ...PRODUCTS.map((product) => `- ${product}`),
    "",
    "Правила оценки риска (riskScore, целое 0-100):",
    "- 80-100: критический приоритет, SLA просрочен или горит, массовый отказ денежного/ядрового сервиса",
    "- 50-79: высокий приоритет или деградация ключевого сервиса при живом SLA",
    "- 20-49: локальная проблема, есть запас по SLA",
    "- 0-19: минимальные последствия",
    "riskLevel должен быть согласован со score: high >= 70, medium >= 40, иначе low.",
    "riskReason: объясни, ПОЧЕМУ инцидент может стать критическим (или почему вряд ли).",
    "",
    "Формат ответа — строго JSON без markdown-ограды:",
    "{",
    '  "summary": "суть инцидента в 1-2 предложениях",',
    '  "recommendedTeam": "точное название команды из справочника",',
    '  "teamReason": "одно предложение: почему именно эта команда",',
    '  "riskScore": 0-100,',
    '  "riskLevel": "low" | "medium" | "high",',
    '  "riskReason": "почему инцидент может стать критическим",',
    '  "handoffBody": "текст передачи команде: суть, симптомы, срочность"',
    "}",
    "",
    "Отвечай на русском. Никаких выдуманных команд и полей.",
  ].join("\n");
}

// --- USER PROMPT ---

export function buildIncidentPrompt(incident: NormalizedIncident): string {
  const slaLine =
    incident.slaRemainingMs === null
      ? "SLA: не задан (инцидент решён, закрыт или на исследовании)"
      : `SLA: дедлайн ${incident.slaDeadline}, осталось ${Math.ceil(incident.slaRemainingMs / 60_000)} мин`;

  return [
    "Проанализируй инцидент:",
    `- Продукт: ${incident.product}`,
    `- Название: ${incident.title}`,
    `- Описание: ${incident.description}`,
    `- Приоритет: ${incident.priority} (исходное значение: ${incident.rawPriority})`,
    `- Статус: ${incident.status} (исходное значение: ${incident.rawStatus})`,
    `- Команда-исполнитель: ${incident.assigneeTeam}`,
    `- ${slaLine}`,
    `- Группы на дашборде: ${incident.groups.join(", ") || "нет"}`,
    "",
    "Если инцидент назначен на координаторов — рекомендуй команду для передачи.",
  ].join("\n");
}

// --- LLM ANALYSIS ---

function toAiData(payload: LlmAnalysisPayload, provider: string): IncidentAiData {
  return {
    summary: payload.summary,
    recommendedTeam: payload.recommendedTeam,
    riskScore: payload.riskScore,
    riskLevel: payload.riskLevel,
    riskReason: payload.riskReason,
    handoffMessage: `Команда: ${payload.recommendedTeam}. ${payload.teamReason}.\n\n${payload.handoffBody}`,
    provider,
    updatedAt: new Date().toISOString(),
  };
}

export async function analyzeIncident(incident: NormalizedIncident): Promise<IncidentAiData> {
  const result = await callLlmWithFallback(buildIncidentPrompt(incident), incidentAiSchema, {
    system: buildSystemPrompt(),
  });
  return toAiData(result.data, result.provider);
}

// --- RULE-BASED FALLBACK ---

const RISK_BY_PRIORITY: Record<IncidentPriority, number> = {
  critical: 90,
  high: 65,
  medium: 40,
  low: 15,
};

export function analyzeIncidentRuleBased(incident: NormalizedIncident): IncidentAiData {
  let riskScore = RISK_BY_PRIORITY[incident.priority] ?? 35;
  const remaining = incident.slaRemainingMs;
  const riskFactors: string[] = [`приоритет «${incident.rawPriority || incident.priority}»`];

  if (remaining !== null) {
    if (remaining <= 0) {
      riskScore = Math.min(100, riskScore + 20);
      riskFactors.push("SLA просрочен");
    } else if (remaining < 30 * 60_000) {
      riskScore = Math.min(100, riskScore + 15);
      riskFactors.push("до SLA меньше 30 минут");
    } else if (remaining < 120 * 60_000) {
      riskScore = Math.min(100, riskScore + 5);
      riskFactors.push("SLA горит (меньше 2 часов)");
    } else {
      riskFactors.push("запас по SLA");
    }
  } else {
    riskFactors.push("SLA не задан");
  }
  if (incident.groups.includes("CRITICAL")) {
    riskScore = Math.max(riskScore, 85);
    riskFactors.push("инцидент в группе CRITICAL");
  }

  const riskLevel: IncidentAiData["riskLevel"] =
    riskScore >= 70 ? "high" : riskScore >= 40 ? "medium" : "low";

  const rec = recommendTeam(incident);
  const teamReason = buildTeamReason(incident, rec);

  const slaText =
    remaining === null
      ? "SLA не задан"
      : remaining <= 0
        ? `SLA просрочен на ${Math.ceil(-remaining / 60_000)} мин`
        : `остаток SLA ${Math.ceil(remaining / 60_000)} мин`;

  return {
    summary: `Инцидент «${incident.title}» на продукте ${incident.product}. Приоритет: ${incident.priority}.`,
    recommendedTeam: rec.team,
    riskScore,
    riskLevel,
    riskReason: `Локальная оценка без LLM: ${riskFactors.join("; ")}.`,
    handoffMessage: `Команда: ${rec.team}. ${teamReason}\n\nПрошу принять инцидент «${incident.title}» (${incident.product}). ${slaText}. Подробности: ${incident.itsmUrl}`,
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
