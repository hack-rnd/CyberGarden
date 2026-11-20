import type { NormalizedIncident } from "@/types/incident";
import { RESOLVER_TEAMS } from "./directory";

// --- TYPES ---

export type ResolverTeam = (typeof RESOLVER_TEAMS)[number];

export interface RuleRecommendation {
  team: ResolverTeam;
  source: "product" | "keyword" | "default";
  matchedLabels: string[];
}

// --- PRODUCT ROUTING (frequency table from data/incidents.json) ---

interface ProductRouting {
  resolver: ResolverTeam;
  evidence: string;
}

export const PRODUCT_ROUTING: Record<string, ProductRouting> = {
  "Сеть доступа": {
    resolver: "Техподдержка",
    evidence: "инциденты продукта в выгрузке МТС назначены на Техподдержку",
  },
  "ТВ-платформа": {
    resolver: "Команда Core",
    evidence: "инциденты продукта в выгрузке МТС назначены на Команду Core",
  },
  "Биллинг": {
    resolver: "Техподдержка",
    evidence: "платёжные операции обрабатывает первая линия перед эскалацией в разработку",
  },
  "Личный кабинет": {
    resolver: "Команда Core",
    evidence: "ядро авторизации и личного кабинета входит в зону ответственности Core",
  },
  "Мобильный банк": {
    resolver: "Команда Core",
    evidence: "в выгрузке требуется передача в команду разработки платежей (Core)",
  },
};

// --- KEYWORD WEIGHTS ---

const PRODUCT_SCORE = 3;
const KEYWORD_SCORE = 2;

interface KeywordRule {
  re: RegExp;
  team: ResolverTeam;
  label: string;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    re: /пакет|потерь|канал|базов(ая|ых) станц|узел агрегац|деградац|сеть/i,
    team: "Техподдержка",
    label: "сетевые симптомы",
  },
  {
    re: /списан|платеж|оплат|тариф|сч[её]т|биллинг/i,
    team: "Техподдержка",
    label: "платёжные операции",
  },
  {
    re: /авторизац|sms|вход|кабинет|api|ядро|платформ|cdn|вещан|перевод|сбп|очеред/i,
    team: "Команда Core",
    label: "симптомы ядрового сервиса",
  },
];

// --- EXPLANATION TEMPLATES ---

const PRODUCT_TEMPLATES = [
  "Продукт «{product}» по выгрузке МТС обслуживает {team}: {evidence}.",
  "Для продукта «{product}» типовой исполнитель — {team} ({evidence}).",
];

const KEYWORD_TEMPLATES = [
  "Симптомы инцидента ({labels}) относятся к зоне ответственности {team}.",
  "По характеру симптомов ({labels}) задача маршрутизируется в {team}.",
];

const DEFAULT_TEMPLATES = [
  "Профиль команды по выгрузке не определён — назначена {team} для триажа и маршрутизации.",
];

// --- SCORING ---

export function recommendTeam(incident: NormalizedIncident): RuleRecommendation {
  const haystack = `${incident.title} ${incident.description}`;
  const scores = new Map<ResolverTeam, number>();
  const matchedLabels: string[] = [];

  const routing = PRODUCT_ROUTING[incident.product];
  if (routing) {
    scores.set(routing.resolver, PRODUCT_SCORE);
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(haystack)) {
      scores.set(rule.team, (scores.get(rule.team) ?? 0) + KEYWORD_SCORE);
      matchedLabels.push(rule.label);
    }
  }

  let best: ResolverTeam = routing?.resolver ?? "Техподдержка";
  let bestScore = -1;
  for (const team of RESOLVER_TEAMS) {
    const score = scores.get(team) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = team;
    }
  }

  const source: RuleRecommendation["source"] = routing
    ? "product"
    : matchedLabels.length > 0
      ? "keyword"
      : "default";

  return { team: best, source, matchedLabels };
}

export function buildTeamReason(
  incident: NormalizedIncident,
  rec: RuleRecommendation
): string {
  const templates =
    rec.source === "product"
      ? PRODUCT_TEMPLATES
      : rec.source === "keyword"
        ? KEYWORD_TEMPLATES
        : DEFAULT_TEMPLATES;
  const template = templates[pickTemplate(incident.id, templates.length)]!;

  return fillTemplate(template, {
    product: incident.product,
    team: rec.team,
    evidence: PRODUCT_ROUTING[incident.product]?.evidence ?? "",
    labels: rec.matchedLabels.join(", "),
  });
}

// --- HELPERS ---

function pickTemplate(seed: string, count: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % count;
}

function fillTemplate(
  template: string,
  slots: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => slots[key] ?? "");
}
