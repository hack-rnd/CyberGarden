import { prisma } from "@/lib/prisma";
import { incidentStore } from "@/lib/mts/store";
import { IncidentAiData, NormalizedIncident } from "@/types/incident";

// --- TYPES ---

export type SaveAiPayload = Omit<IncidentAiData, "updatedAt">;

// --- AI QUEUE HELPERS ---

export async function getAllIncidents(): Promise<NormalizedIncident[]> {
  await incidentStore.ensureInitialized();
  return incidentStore.getSnapshot().incidents;
}

export async function getIncidentsPendingAi(): Promise<NormalizedIncident[]> {
  await incidentStore.ensureInitialized();
  const { incidents } = incidentStore.getSnapshot();

  return incidents
    .filter((inc) => inc.isActive && inc.groups.length > 0 && inc.ai === null)
    .sort((a, b) => {
      const weight = (inc: NormalizedIncident) => {
        if (inc.groups.includes("CRITICAL")) return 0;
        if (inc.groups.includes("ASSIGNED_TO_COORDINATORS")) return 1;
        if (inc.groups.includes("HIGH_PRIORITY")) return 2;
        return 3;
      };
      return weight(a) - weight(b);
    });
}

export async function getIncidentById(
  incidentId: string
): Promise<NormalizedIncident | null> {
  await incidentStore.ensureInitialized();
  const { incidents } = incidentStore.getSnapshot();
  return incidents.find((inc) => inc.id === incidentId) ?? null;
}

export async function saveAiAnalysis(
  incidentId: string,
  contentHash: string,
  data: SaveAiPayload
): Promise<void> {
  await prisma.aiAnalysisCache.upsert({
    where: { incidentId },
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
  });

  await incidentStore.notifyAiUpdated();
}