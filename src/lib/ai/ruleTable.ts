import type { NormalizedIncident } from "@/types/incident";
import { RESOLVER_TEAMS } from "./directory";

// --- TYPES ---

export type ResolverTeam = (typeof RESOLVER_TEAMS)[number];

export interface RuleRecommendation {
  team: ResolverTeam;
  source: "product" | "keyword" | "default";
  matchedLabels: string[];
}

// --- PRODUCT ROUTING (from real MTS export character_problems.json) ---

interface ProductRouting {
  resolver: ResolverTeam;
  evidence: string;
}

export const PRODUCT_ROUTING: Record<string, ProductRouting> = {
  "Автопросматриватель TicTok": {
    resolver: "КЦ ИТ Media L2 KION",
    evidence: "медиапросмотр относится к зоне Media L2 KION",
  },
  "Акваланг для муравьев": {
    resolver: "Дежурная смена ОГЭ МЦОД Санкт-Петербург",
    evidence: "продукт обслуживается дежурной сменой МЦОД",
  },
  "Летающий ковер": {
    resolver: "КЦ ИТ OPS Аварии MSCP",
    evidence: "аварийные ситуации платформы маршрутизируются в OPS Аварии MSCP",
  },
  "Страхование хомячков": {
    resolver: "КЦ ИТ ЦП Billing Platform",
    evidence: "страховые продукты обрабатывает Billing Platform",
  },
  "Вечная зажигалка": {
    resolver: "КЦ ИТ OPS Аварии ДС",
    evidence: "инциденты продукта назначаются на OPS Аварии ДС",
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
    re: /vpn|туннел|шифрован/i,
    team: "КЦ ББ ДИБ УРМС VPN Support",
    label: "VPN и защищённые каналы",
  },
  {
    re: /active directory|ad|домен|уч[её]тн(ая|ых) запис|ldap|аутентификац|авторизац/i,
    team: "КЦ ИТ Active Directory",
    label: "доменная аутентификация и учётные записи",
  },
  {
    re: /биллинг|тарификац|списан|платеж|оплат|сч[её]т/i,
    team: "КЦ ИТ ЦП Billing Platform",
    label: "биллинг и тарификация",
  },
  {
    re: /тариф|foris/i,
    team: "КЦ ИТ ЦРМП ОРМП Foris Аварии Тарификация",
    label: "аварии тарификации Foris",
  },
  {
    re: /видео|медиа|kion|стрим|проигрыв|трансляц/i,
    team: "КЦ ИТ Media L2 KION",
    label: "медиасервисы и видео",
  },
  {
    re: /мой мтс|приложение|мобильн/i,
    team: "КЦ ИТ Мой МТС",
    label: "приложение Мой МТС",
  },
  {
    re: /vmware|виртуал|кластер|хостинг/i,
    team: "КЦ ДОИ VMWare",
    label: "виртуализация VMWare",
  },
  {
    re: /san|storage|хранилищ|дисков|лун/i,
    team: "КЦ ДОИ Администрирование SAN",
    label: "системы хранения SAN",
  },
  {
    re: /dc-net|стойк|маршрутиз|коммутатор|сетев/i,
    team: "КЦ ТБ ДМиМС DC-NET Аварии",
    label: "сетевое оборудование ЦОД",
  },
  {
    re: /devops|ci\/cd|деплой|контейнер|kubernetes|docker/i,
    team: "КЦ ИТ Развитие DEVOPS",
    label: "инфраструктура CI/CD и контейнеры",
  },
  {
    re: /каталог|product catalog|номенклатур/i,
    team: "КЦ ИТ EP Product Catalog",
    label: "продуктовый каталог",
  },
  {
    re: /membrana/i,
    team: "КЦ ИТ Поддержка Membrana",
    label: "платформа Membrana",
  },
  {
    re: /mscp|платформ/i,
    team: "КЦ ИТ OPS Аварии MSCP",
    label: "аварии платформы MSCP",
  },
  {
    re: /simpleone|тикет|заявк/i,
    team: "КЦ МТС Гильдия (SimpleOne)",
    label: "процессы SimpleOne",
  },
  {
    re: /медиаскаут|скaут/i,
    team: "КЦ ИТ ОРД МедиаСкаут",
    label: "сервис МедиаСкаут",
  },
  {
    re: /тест|testops|qa/i,
    team: "КЦ ИТ Allure TestOps Support",
    label: "тестовая инфраструктура Allure TestOps",
  },
  {
    re: /enablement/i,
    team: "КЦ ИТ ЦП Enablement Platform",
    label: "Enablement Platform",
  },
  {
    re: /приморье|vladivostok|владивосток/i,
    team: "ОГЭ Приморье",
    label: "региональная эксплуатация Приморье",
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
  const haystack = `${incident.product} ${incident.title} ${incident.description}`;
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

  let best: ResolverTeam = routing?.resolver ?? "КЦ ИТ OPS Аварии MSCP";
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
  rec: RuleRecommendation,
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
  slots: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => slots[key] ?? "");
}
