import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import closedKnowledgeJson from "../../../data/closed-knowledge.json";
import { callLlmWithFallback } from "./client";

export const similarSearchIncidentSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().optional(),
    product: z.string().optional().default(""),
    title: z.string().optional().default(""),
    description: z.string().min(1).max(20_000),
    status: z.string().optional(),
    priority: z.string().optional(),
    contentHash: z.string().optional(),
    updatedAt: z.string().optional(),
    ai: z
      .object({ updatedAt: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type SimilarSearchIncident = z.infer<typeof similarSearchIncidentSchema>;

const similarIncidentSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  product: z.string().min(1),
  similarityReason: z.string().min(1).max(800),
  confirmedRootCause: z.string().min(1).max(1200),
  resolution: z.string().min(1).max(1200),
});

export const similarSearchResultSchema = z
  .object({
    status: z.enum(["matched", "insufficient_data"]),
    observations: z.array(z.string().min(1).max(400)).min(2).max(3),
    similarIncident: similarIncidentSchema.nullable(),
    hypothesis: z.string().min(1).max(1200),
    firstCheck: z.string().min(1).max(800),
    evidence: z.array(z.string().min(1).max(500)).min(1).max(8),
  })
  .superRefine((result, context) => {
    if (result.status === "matched" && result.similarIncident === null) {
      context.addIssue({
        code: "custom",
        message: "matched result requires similarIncident",
      });
    }
    if (result.status === "insufficient_data" && result.similarIncident !== null) {
      context.addIssue({
        code: "custom",
        message: "insufficient_data result must not contain similarIncident",
      });
    }
  });

export type SimilarSearchResult = z.infer<typeof similarSearchResultSchema>;

const knowledgeCaseSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  product: z.string().min(1),
  symptoms: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  rootCause: z.string().min(1),
  resolution: z.string().min(1),
  firstCheckHint: z.string().min(1),
  resolvedAt: z.string().min(1),
});

const knowledgeBaseSchema = z.array(knowledgeCaseSchema).length(10);

const rawArchiveItemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  state: z.string().nullish(),
  stateEnum: z.string().nullish(),
  stateReason: z.string().nullish(),
  productName: z.string().nullish(),
  header: z.string().nullish(),
  shortDescription: z.string().nullish(),
  description: z.string().nullish(),
  scenarioName: z.string().nullish(),
  service: z.string().nullish(),
  solution: z.string().nullish(),
  completionDate: z.string().nullish(),
});

const rawArchiveSchema = z.array(z.unknown());

interface ArchiveCandidate {
  id: string;
  code: string;
  product: string;
  symptoms: string[];
  description: string;
  rootCause: string;
  resolution: string;
  firstCheckHint: string;
  resolvedAt: string;
  source: "knowledge" | "archive";
}

interface DomainRule {
  id: string;
  label: string;
  pattern: RegExp;
}

interface ConceptRule {
  id: string;
  label: string;
  pattern: RegExp;
}

interface ScoredCandidate {
  candidate: ArchiveCandidate;
  score: number;
  sameProduct: boolean;
  sharedDomains: string[];
  sharedConcepts: ConceptRule[];
  sharedTokens: string[];
}

const DOMAIN_RULES: DomainRule[] = [
  { id: "auth", label: "аутентификация и проверка сессии", pattern: /авториз|аутентиф|сесси|токен|token|login|вход/i },
  { id: "playback", label: "воспроизведение видео", pattern: /декод|буфериз|воспроизвед|проигрыв|видео|ролик|плеер/i },
  { id: "drm", label: "DRM и вывод защищённого изображения", pattern: /drm|лицензи|ч[её]рный экран|зашифрован/i },
  { id: "billing", label: "платежи и тарификация", pattern: /оплат|плат[её]ж|списан|транзакц|биллинг|webhook/i },
  { id: "policy", label: "создание страхового полиса", pattern: /полис|страхов/i },
  { id: "ignition", label: "формирование искры и поджиг", pattern: /искр|поджиг|воспламен|пьезо|зажиг/i },
  { id: "gas", label: "подача газа", pattern: /газ|плам|форсун/i },
  { id: "control", label: "передача команд управления", pattern: /руль|пульт|кнопк|очередь команд|управлен/i },
  { id: "navigation", label: "навигация и удержание курса", pattern: /маршрут|курс|навигац|магнит|компас/i },
  { id: "pressure", label: "давление и герметичность воздушного контура", pattern: /давлен|баллон|воздух|утеч|шипен|шланг/i },
  { id: "sensors", label: "датчики и измерения", pattern: /датчик|сч[её]тчик/i },
];

const CONCEPT_RULES: ConceptRule[] = [
  { id: "auth", label: "вход и аутентификация", pattern: /авториз|аутентиф|login|вход/i },
  { id: "token", label: "проверка токена", pattern: /токен|token/i },
  { id: "session", label: "сессия", pattern: /сесси|session/i },
  { id: "timeout", label: "таймаут или медленный ответ", pattern: /таймаут|timeout|медленн|задержк/i },
  { id: "video", label: "видео", pattern: /видео|ролик|плеер|воспроизвед/i },
  { id: "decoder", label: "декодер", pattern: /декод|codec/i },
  { id: "buffering", label: "буферизация и прерывания", pattern: /буфериз|прерыва|останавлива|тормоз/i },
  { id: "display", label: "изображение и экран", pattern: /экран|изображен|подсветк/i },
  { id: "black_screen", label: "чёрный экран", pattern: /ч[её]рный экран/i },
  { id: "audio", label: "звук", pattern: /звук|аудио/i },
  { id: "drm", label: "DRM-лицензия", pattern: /drm|лицензи/i },
  { id: "billing", label: "оплата и списания", pattern: /оплат|плат[её]ж|списан|биллинг/i },
  { id: "duplicate", label: "повторная операция", pattern: /двойн|повторн|дублир|два одинаковых/i },
  { id: "webhook", label: "webhook", pattern: /webhook|уведомлен/i },
  { id: "transaction", label: "транзакция", pattern: /транзакц/i },
  { id: "policy", label: "полис", pattern: /полис|страхов/i },
  { id: "registry", label: "реестр", pattern: /реестр/i },
  { id: "ignition", label: "искра и поджиг", pattern: /искр|поджиг|воспламен|пьезо/i },
  { id: "spring", label: "пружина и контакт", pattern: /пружин|контакт/i },
  { id: "button", label: "кнопка", pattern: /кнопк/i },
  { id: "gas", label: "газ", pattern: /газ/i },
  { id: "flame", label: "пламя", pattern: /плам/i },
  { id: "valve", label: "клапан", pattern: /клапан/i },
  { id: "nozzle", label: "игла и канал подачи", pattern: /игл|форсун/i },
  { id: "control", label: "пульт управления", pattern: /руль|пульт|управлен/i },
  { id: "command_queue", label: "очередь команд", pattern: /очередь команд|команды накаплива|буфер команд/i },
  { id: "route", label: "маршрут", pattern: /маршрут/i },
  { id: "course", label: "курс", pattern: /курс/i },
  { id: "magnetic", label: "магнитный датчик и катушка", pattern: /магнит|катушк|компас/i },
  { id: "pressure", label: "давление", pattern: /давлен/i },
  { id: "hose", label: "гибкий шланг", pattern: /шланг|трубк/i },
  { id: "leak", label: "утечка", pattern: /утеч|шипен/i },
  { id: "air", label: "воздух и баллон", pattern: /воздух|баллон/i },
  { id: "sensor", label: "датчик", pattern: /датчик|сч[её]тчик/i },
];

const STOP_WORDS = new Set([
  "автоматический", "алерт", "аномалия", "более", "будет", "быть", "видит", "вовсе", "все", "всё",
  "выявлен", "год", "данный", "для", "его", "есть", "жалоба", "жалуются", "за", "задан", "зафиксирован",
  "имеет", "инцидент", "их", "как", "клиент", "компонент", "которая", "который", "массовый", "между",
  "может", "на", "надо", "не", "небольшой", "неисправность", "необходим", "норма", "нужно", "один",
  "описание", "обнаружен", "общий", "от", "отклонение", "очень", "ошибка", "перестал", "по", "после",
  "пользователь", "при", "проблема", "продукт", "работает", "работать", "реакция", "сбой", "сервис",
  "система", "случай", "сообщает", "сообщил", "такой", "текущий", "требуется", "узел", "указан",
  "устройство", "функция", "через", "что", "это", "этот", "является", "diagnostic", "error", "incident", "problem",
]);

const BROAD_CONCEPTS = new Set(["auth", "video", "billing", "policy", "control", "gas", "sensor"]);

function normalizeText(value: string): string {
  return value.toLowerCase().replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/giu, " ").trim();
}

function stemToken(token: string): string {
  if (token.length < 6 || /^[a-z0-9]+$/i.test(token)) return token;
  return token.replace(/(?:иями|ями|ами|ового|евого|ового|ения|ание|ость|ами|ями|ного|его|ого|ных|ных|ым|им|ой|ей|ий|ая|яя|ые|ие|ова|ева|ать|ять|еть|ить|ут|ют|ет|ит|ал|ял|ла|ли|ов|ев|ам|ям|ах|ях|а|я|ы|и|у|ю|е|о)$/u, "");
}

function tokenize(value: string): Set<string> {
  const normalized = normalizeText(value);
  const tokens = new Set<string>();
  for (const token of normalized.split(" ")) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    const stemmed = stemToken(token);
    if (stemmed.length < 3 || STOP_WORDS.has(stemmed)) continue;
    tokens.add(stemmed);
  }
  for (const rule of CONCEPT_RULES) {
    if (rule.pattern.test(value)) tokens.add(`concept:${rule.id}`);
  }
  return tokens;
}

function incidentContent(incident: SimilarSearchIncident): string {
  return [incident.title, incident.description].filter(Boolean).join("\n");
}

function candidateContent(candidate: ArchiveCandidate): string {
  return [
    ...candidate.symptoms,
    candidate.description,
    candidate.rootCause,
    candidate.resolution,
    candidate.firstCheckHint,
  ].join("\n");
}

function scoreCandidate(
  incident: SimilarSearchIncident,
  incidentTokens: Set<string>,
  incidentDomains: Set<string>,
  candidate: ArchiveCandidate,
): ScoredCandidate {
  const candidateTokens = tokenize(`${candidate.product}\n${candidateContent(candidate)}`);
  const candidateDomains = new Set(
    DOMAIN_RULES.filter((rule) => rule.pattern.test(candidateContent(candidate))).map((rule) => rule.id),
  );
  const shared = [...incidentTokens].filter((token) => candidateTokens.has(token));
  const sharedTokens = shared.filter((token) => !token.startsWith("concept:"));
  const sharedConceptIds = shared
    .filter((token) => token.startsWith("concept:"))
    .map((token) => token.slice("concept:".length));
  const sharedConcepts = CONCEPT_RULES.filter((rule) => sharedConceptIds.includes(rule.id));
  const sharedDomains = DOMAIN_RULES.filter(
    (rule) => incidentDomains.has(rule.id) && candidateDomains.has(rule.id),
  ).map((rule) => rule.id);
  const sameProduct =
    incident.product.trim().length > 0 &&
    normalizeText(incident.product) === normalizeText(candidate.product);
  const score =
    (sameProduct ? 2.5 : 0) +
    sharedTokens.length +
    sharedConcepts.length * 3 +
    sharedDomains.length * 5 +
    (candidate.source === "knowledge" ? 0.5 : 0);

  return {
    candidate,
    score,
    sameProduct,
    sharedDomains,
    sharedConcepts,
    sharedTokens,
  };
}

function scoreCandidates(
  incident: SimilarSearchIncident,
  candidates: ArchiveCandidate[],
): ScoredCandidate[] {
  const content = incidentContent(incident);
  const tokens = tokenize(`${incident.product}\n${content}`);
  const domains = new Set(
    DOMAIN_RULES.filter((rule) => rule.pattern.test(content)).map((rule) => rule.id),
  );
  return candidates
    .map((candidate) => scoreCandidate(incident, tokens, domains, candidate))
    .sort((left, right) => right.score - left.score);
}

function isStrongMatch(match: ScoredCandidate): boolean {
  if (match.sharedDomains.length === 0) return false;
  const specificConcepts = match.sharedConcepts.filter((rule) => !BROAD_CONCEPTS.has(rule.id));
  if (specificConcepts.length === 0 && match.sharedTokens.length < 2) return false;
  if (match.sameProduct) return match.score >= 7;
  return (
    match.score >= 9 &&
    (specificConcepts.length >= 2 || match.sharedTokens.length >= 2 || match.sharedDomains.length >= 2)
  );
}

function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

function buildObservations(incident: SimilarSearchIncident): string[] {
  const third = incident.status || incident.priority
    ? `Статус: ${incident.status ?? "не указан"}; приоритет: ${incident.priority ?? "не указан"}.`
    : `Описание: ${truncate(incident.description, 180)}`;
  return [
    `Продукт: ${incident.product || "не указан"}.`,
    `Заявленный симптом: ${truncate(incident.title || incident.description, 180)}`,
    third,
  ];
}

function insufficientResult(
  incident: SimilarSearchIncident,
  candidateCount: number,
  hypothesis?: string,
  firstCheck?: string,
): SimilarSearchResult {
  return {
    status: "insufficient_data",
    observations: buildObservations(incident),
    similarIncident: null,
    hypothesis:
      hypothesis ??
      "Надёжного смыслового совпадения не найдено. Совпадения по названию продукта или общим словам вроде «ошибка» и «проблема» недостаточно для гипотезы о первопричине.",
    firstCheck:
      firstCheck ??
      "За 5–10 минут уточнить время начала, масштаб, точный текст или код ошибки и последние изменения, затем проверить журналы компонента, названного в описании.",
    evidence: [
      `Текущий сигнал: ${truncate(incidentContent(incident), 220)}`,
      `Проверено архивных кандидатов: ${candidateCount}.`,
      "Подтверждённого совпадения по техническому смыслу нет; общие слова не учитывались как доказательство.",
    ],
  };
}

function matchedResult(
  incident: SimilarSearchIncident,
  match: ScoredCandidate,
  similarityReason?: string,
  hypothesis?: string,
): SimilarSearchResult {
  const domainLabels = DOMAIN_RULES.filter((rule) => match.sharedDomains.includes(rule.id)).map(
    (rule) => rule.label,
  );
  const signalLabels = [
    ...match.sharedConcepts.filter((rule) => !BROAD_CONCEPTS.has(rule.id)).map((rule) => rule.label),
    ...match.sharedTokens.slice(0, 4),
  ].slice(0, 5);
  const reason =
    similarityReason ??
    `Совпадает технический домен (${domainLabels.join(", ")}) и конкретные сигналы: ${signalLabels.join(", ")}.`;
  const rootCauseHypothesis =
    hypothesis ??
    `Возможна та же первопричина, что в архивном случае ${match.candidate.id}: ${match.candidate.rootCause}`;

  return {
    status: "matched",
    observations: buildObservations(incident),
    similarIncident: {
      id: match.candidate.id,
      code: match.candidate.code,
      product: match.candidate.product,
      similarityReason: reason,
      confirmedRootCause: match.candidate.rootCause,
      resolution: match.candidate.resolution,
    },
    hypothesis: `Гипотеза ИИ, требующая проверки: ${rootCauseHypothesis}`,
    firstCheck: match.candidate.firstCheckHint,
    evidence: [
      `Текущий сигнал: ${truncate(incidentContent(incident), 220)}`,
      `Общие технические признаки: ${signalLabels.join(", ") || domainLabels.join(", ")}.`,
      `Архивный случай ${match.candidate.id}: ${match.candidate.resolution}`,
    ],
  };
}

export function findSimilarIncidentRuleBased(
  incident: SimilarSearchIncident,
  candidates: ArchiveCandidate[],
): SimilarSearchResult {
  const best = scoreCandidates(incident, candidates)[0];
  return best && isStrongMatch(best)
    ? matchedResult(incident, best)
    : insufficientResult(incident, candidates.length);
}

const SIMILAR_SYSTEM_PROMPT = [
  "Ты — ИИ-советник координатора инцидентов. Сопоставляй текущий инцидент только с переданными архивными случаями.",
  "Работай строго с фактами из запроса. Не выдумывай ID, первопричины, решения, симптомы или технические детали.",
  "Статус matched разрешён только при совпадении технического смысла: затронутой функции, механизма отказа или характерных диагностических сигналов.",
  "Одинаковый продукт, компонент без общего механизма отказа и общие слова «ошибка», «проблема», «сбой», «не работает» не являются достаточным основанием для matched.",
  "Если уверенного совпадения нет, верни status insufficient_data, similarIncident null и честно объясни в hypothesis, каких данных не хватает.",
  "При matched выбери ровно один similarIncident.id из списка кандидатов. Никакие другие ID запрещены.",
  "hypothesis — только неподтверждённая гипотеза, а не утверждение о первопричине текущего инцидента.",
  "firstCheck — конкретное безопасное действие инженера на 5–10 минут. observations — 2–3 коротких факта о текущем инциденте.",
  "evidence — основания из текущих сигналов и ссылка на выбранный архивный ID при matched.",
  "Ответ строго JSON без markdown. Схема: status, observations, similarIncident, hypothesis, firstCheck, evidence.",
].join("\n");

function buildSimilarPrompt(
  incident: SimilarSearchIncident,
  shortlist: ScoredCandidate[],
): string {
  const candidates = shortlist.map(({ candidate }) => ({
    id: candidate.id,
    code: candidate.code,
    product: candidate.product,
    symptoms: candidate.symptoms,
    description: candidate.description,
    confirmedRootCause: candidate.rootCause,
    resolution: candidate.resolution,
    firstCheckHint: candidate.firstCheckHint,
    resolvedAt: candidate.resolvedAt,
  }));
  return [
    "Сравни текущий инцидент с архивом и верни результат по требуемой JSON-схеме.",
    "Текущий инцидент:",
    JSON.stringify({
      id: incident.id,
      code: incident.code ?? incident.id,
      product: incident.product,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      priority: incident.priority,
    }),
    "Допустимые архивные кандидаты:",
    JSON.stringify(candidates),
  ].join("\n");
}

async function loadCandidates(): Promise<ArchiveCandidate[]> {
  const knowledge = knowledgeBaseSchema.parse(closedKnowledgeJson).map((candidate) => ({
    ...candidate,
    source: "knowledge" as const,
  }));
  try {
    const filePath = path.resolve(process.cwd(), "data/incidents.json");
    const raw = rawArchiveSchema
      .parse(JSON.parse(await readFile(filePath, "utf8")))
      .flatMap((item) => {
        const parsed = rawArchiveItemSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
    const archived = raw
      .filter((item) => {
        const status = `${item.stateEnum ?? ""} ${item.state ?? ""}`.toLowerCase();
        const reason = item.stateReason ?? "";
        return (
          /closed|resolved|закрыт|заверш/i.test(status) &&
          Boolean(item.solution?.trim()) &&
          !/не подтверж|дубль/i.test(reason)
        );
      })
      .map((item): ArchiveCandidate => {
        const component = item.scenarioName ?? item.header ?? "компонент из описания";
        const symptoms = [item.shortDescription ?? item.header ?? item.description ?? ""].filter(Boolean);
        return {
          id: item.id,
          code: item.id,
          product: item.productName ?? "Не указан",
          symptoms,
          description: [item.header, item.description, item.service].filter(Boolean).join("\n"),
          rootCause: `В выгрузке не расшифрована детальная первопричина; подтверждённая неисправность относится к компоненту «${component}».`,
          resolution: item.solution ?? "Решение в выгрузке не указано.",
          firstCheckHint: `За 5–10 минут проверить состояние и журналы компонента «${component}», затем сопоставить наблюдения с архивным решением.`,
          resolvedAt: item.completionDate ?? "",
          source: "archive",
        };
      });
    return [...knowledge, ...archived];
  } catch {
    return knowledge;
  }
}

async function findSimilarIncident(
  incident: SimilarSearchIncident,
  candidates: ArchiveCandidate[],
): Promise<SimilarSearchResult> {
  const scored = scoreCandidates(incident, candidates);
  const shortlist = scored.slice(0, 5);
  const result = await callLlmWithFallback(
    buildSimilarPrompt(incident, shortlist),
    similarSearchResultSchema,
    { system: SIMILAR_SYSTEM_PROMPT },
  );
  const selectedId = result.data.similarIncident?.id;
  if (result.data.status === "matched") {
    const selected = shortlist.find((item) => item.candidate.id === selectedId);
    if (!selected) return findSimilarIncidentRuleBased(incident, candidates);
    return matchedResult(
      incident,
      selected,
      result.data.similarIncident?.similarityReason,
      result.data.hypothesis,
    );
  }
  return insufficientResult(
    incident,
    candidates.length,
    result.data.hypothesis,
    result.data.firstCheck,
  );
}

export async function findSimilarIncidentSafe(
  incident: SimilarSearchIncident,
): Promise<SimilarSearchResult> {
  const candidates = await loadCandidates();
  try {
    return await findSimilarIncident(incident, candidates);
  } catch {
    return findSimilarIncidentRuleBased(incident, candidates);
  }
}

interface SimilarCacheState {
  entries: Map<string, SimilarSearchResult>;
  pending: Map<string, Promise<SimilarSearchResult>>;
}

const globalForSimilarSearch = globalThis as unknown as {
  similarSearchCache: SimilarCacheState | undefined;
};

function cacheState(): SimilarCacheState {
  if (!globalForSimilarSearch.similarSearchCache) {
    globalForSimilarSearch.similarSearchCache = {
      entries: new Map(),
      pending: new Map(),
    };
  }
  return globalForSimilarSearch.similarSearchCache;
}

function incidentVersion(incident: SimilarSearchIncident): string {
  if (incident.updatedAt) return incident.updatedAt;
  if (incident.contentHash) return incident.contentHash;
  if (incident.ai?.updatedAt) return incident.ai.updatedAt;
  return createHash("sha256")
    .update(
      [incident.product, incident.title, incident.description, incident.status, incident.priority].join("|"),
    )
    .digest("hex");
}

export async function findSimilarIncidentCached(
  incident: SimilarSearchIncident,
): Promise<SimilarSearchResult> {
  const cacheKey = `${incident.id}:${incidentVersion(incident)}`;
  const cache = cacheState();
  const cached = cache.entries.get(cacheKey);
  if (cached) {
    cache.entries.delete(cacheKey);
    cache.entries.set(cacheKey, cached);
    return cached;
  }
  const pending = cache.pending.get(cacheKey);
  if (pending) return pending;

  const search = findSimilarIncidentSafe(incident)
    .then((result) => {
      cache.entries.set(cacheKey, result);
      if (cache.entries.size > 100) {
        const oldestKey = cache.entries.keys().next().value;
        if (oldestKey) cache.entries.delete(oldestKey);
      }
      return result;
    })
    .finally(() => {
      cache.pending.delete(cacheKey);
    });
  cache.pending.set(cacheKey, search);
  return search;
}
