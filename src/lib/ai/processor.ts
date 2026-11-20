import {
  getIncidentsPendingAi,
  saveAiAnalysis,
  type SaveAiPayload,
} from "@/lib/mts/aiBridge";
import type { IncidentAiData } from "@/types/incident";
import { analyzeIncidentSafe } from "./incident-analysis";

// --- CONFIG ---

const DEFAULT_BATCH_SIZE = 5;

// --- QUEUE PROCESSOR ---

export async function processAiQueue(
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<number> {
  const pending = await getIncidentsPendingAi();
  const batch = pending.slice(0, batchSize);

  for (const incident of batch) {
    try {
      const data = await analyzeIncidentSafe(incident);
      await saveAiAnalysis(incident.id, incident.contentHash, toPayload(data));
    } catch {
      // single failure must not stop the queue
    }
  }

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
