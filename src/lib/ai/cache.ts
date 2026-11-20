import { prisma } from "@/lib/prisma";
import type { IncidentAiData } from "@/types/incident";

// --- TYPES ---

interface AiCacheRow {
  incidentId: string;
  contentHash: string;
  summary: string;
  recommendedTeam: string;
  riskScore: number;
  riskLevel: string;
  riskReason: string;
  handoffMessage: string;
  provider: string;
  updatedAt: Date;
}

// --- READ ---

export async function getCachedAi(
  incidentId: string,
  contentHash: string,
): Promise<IncidentAiData | null> {
  const row = await prisma.aiAnalysisCache.findUnique({ where: { incidentId } });
  if (!row || row.contentHash !== contentHash) return null;
  return rowToAiData(row);
}

// --- WRITE ---

export async function saveCachedAi(
  incidentId: string,
  contentHash: string,
  data: IncidentAiData,
): Promise<void> {
  await prisma.aiAnalysisCache.upsert({
    where: { incidentId },
    create: {
      incidentId,
      contentHash,
      summary: data.summary,
      recommendedTeam: data.recommendedTeam,
      riskScore: data.riskScore,
      riskLevel: data.riskLevel,
      riskReason: data.riskReason,
      handoffMessage: data.handoffMessage,
      provider: data.provider,
    },
    update: {
      contentHash,
      summary: data.summary,
      recommendedTeam: data.recommendedTeam,
      riskScore: data.riskScore,
      riskLevel: data.riskLevel,
      riskReason: data.riskReason,
      handoffMessage: data.handoffMessage,
      provider: data.provider,
    },
  });
}

// --- MAPPER ---

function rowToAiData(row: AiCacheRow): IncidentAiData {
  return {
    summary: row.summary,
    recommendedTeam: row.recommendedTeam,
    riskScore: row.riskScore,
    riskLevel: row.riskLevel as IncidentAiData["riskLevel"],
    riskReason: row.riskReason,
    handoffMessage: row.handoffMessage,
    provider: row.provider,
    updatedAt: row.updatedAt.toISOString(),
  };
}
