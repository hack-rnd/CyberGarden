import {
  getIncidentsPendingAi,
  saveAiAnalysis,
  type SaveAiPayload,
} from "@/lib/mts/aiBridge";
import type { IncidentAiData } from "@/types/incident";
import { analyzeIncidentSafe } from "./incident-analysis";

// --- CONFIG ---

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_MAX_PARALLEL = 2;

// --- QUEUE PROCESSOR ---

export async function processAiQueue(
  batchSize: number = DEFAULT_BATCH_SIZE,
  maxParallel: number = DEFAULT_MAX_PARALLEL,
): Promise<number> {
  const pending = await getIncidentsPendingAi();
  const batch = pending.slice(0, batchSize);

  await runWithConcurrency(batch, maxParallel, async (incident) => {
    try {
      const data = await analyzeIncidentSafe(incident);
      await saveAiAnalysis(incident.id, incident.contentHash, toPayload(data));
    } catch {
      // single failure must not stop the queue
    }
  });

  return batch.length;
}

// --- HELPERS ---

function toPayload(data: IncidentAiData): SaveAiPayload {
  return {
    summary: data.summary,
    recommendedTeam: data.recommendedTeam,
    riskScore: data.riskScore,
    riskLevel: data.riskLevel,
    riskReason: data.riskReason,
    handoffMessage: data.handoffMessage,
    provider: data.provider,
  };
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index]!);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () =>
    worker(),
  );
  await Promise.all(workers);
}
