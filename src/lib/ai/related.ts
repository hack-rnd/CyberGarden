import type { NormalizedIncident } from "@/types/incident";

// --- CONFIG ---

export const RELATED_WINDOW_MS = 60 * 60_000;
export const MASS_OUTAGE_MIN_COUNT = 3;
const MIN_TOKEN_LENGTH = 4;
const BASE_SIMILARITY = 60;
const OVERLAP_WEIGHT = 40;

// --- TYPES ---

export interface RelatedIncident {
  incidentId: string;
  code: string;
  product: string;
  title: string;
  priority: NormalizedIncident["priority"];
  status: NormalizedIncident["status"];
  createdAt: string;
  similarity: number;
}

export interface RelatedCluster {
  isMassOutage: boolean;
  windowMinutes: number;
  productCount: number;
  related: RelatedIncident[];
}

// --- DETECTION ---

export function detectRelated(
  incident: NormalizedIncident,
  all: NormalizedIncident[],
  nowMs: number = Date.now(),
): RelatedCluster {
  const anchor = parseTime(incident.createdAt) ?? nowMs;
  const windowStart = anchor - RELATED_WINDOW_MS;
  const windowEnd = nowMs + 5 * 60_000;

  const related = all
    .filter((other) => other.id !== incident.id)
    .filter((other) => other.product === incident.product)
    .filter((other) => {
      const created = parseTime(other.createdAt);
      return created !== null && created >= windowStart && created <= windowEnd;
    })
    .map((other) => toRelatedIncident(incident, other))
    .sort((a, b) => b.similarity - a.similarity);

  const productCount = related.length + 1;

  return {
    isMassOutage: productCount >= MASS_OUTAGE_MIN_COUNT,
    windowMinutes: RELATED_WINDOW_MS / 60_000,
    productCount,
    related,
  };
}

// --- HELPERS ---

function toRelatedIncident(
  incident: NormalizedIncident,
  other: NormalizedIncident,
): RelatedIncident {
  return {
    incidentId: other.id,
    code: other.code,
    product: other.product,
    title: other.title,
    priority: other.priority,
    status: other.status,
    createdAt: other.createdAt,
    similarity: computeSimilarity(incident, other),
  };
}

function computeSimilarity(a: NormalizedIncident, b: NormalizedIncident): number {
  const tokensA = extractTokens(`${a.title} ${a.description}`);
  const tokensB = extractTokens(`${b.title} ${b.description}`);
  if (tokensA.size === 0 || tokensB.size === 0) return BASE_SIMILARITY;

  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared++;
  }
  const overlap = shared / Math.min(tokensA.size, tokensB.size);
  return Math.min(100, Math.round(BASE_SIMILARITY + overlap * OVERLAP_WEIGHT));
}

const STOPWORDS = new Set([
  "ошибка",
  "ошибки",
  "массов",
  "пользовател",
  "сервис",
  "инцидент",
  "требуется",
  "работа",
  "недоступн",
]);

function extractTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH)
    .filter((token) => !STOPWORDS.has(token.slice(0, 9)));
  return new Set(tokens);
}

function parseTime(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}
