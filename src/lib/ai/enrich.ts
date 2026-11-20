import type { IncidentAiData, NormalizedIncident } from "@/types/incident";
import { getCachedAi, saveCachedAi } from "./cache";
import { analyzeIncidentSafe } from "./incident-analysis";

// --- CONFIG ---

const AI_CONCURRENCY = 2;

// --- ENRICHMENT ---

export async function enrichWithAi(
  incidents: NormalizedIncident[],
): Promise<NormalizedIncident[]> {
  const results = await runWithConcurrency(incidents, AI_CONCURRENCY, async (incident) => {
    const ai = await getOrCreateAi(incident);
    return ai ? { ...incident, ai } : incident;
  });
  return results;
}

// --- HELPERS ---

async function getOrCreateAi(incident: NormalizedIncident): Promise<IncidentAiData | null> {
  try {
    const cached = await getCachedAi(incident.id, incident.contentHash);
    if (cached) return cached;

    const fresh = await analyzeIncidentSafe(incident);
    await saveCachedAi(incident.id, incident.contentHash, fresh).catch(() => undefined);
    return fresh;
  } catch {
    return null;
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]!);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
