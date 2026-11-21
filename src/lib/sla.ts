import type { IncidentStatus, SlaStatus } from "@/types/incident";
import { COORDINATOR_TEAM } from "@/lib/ai/directory";

// --- FORMATTING ---

export function formatSlaRemaining(remainingMs: number | null): string {
  if (remainingMs === null) return "—";
  if (remainingMs <= 0) return `просрочено ${formatDuration(-remainingMs)}`;
  return formatDuration(remainingMs);
}

export function formatSlaDeadline(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
}

// --- STATUS HELPERS ---

export function isSlaUrgent(status: SlaStatus): boolean {
  return status === "critical" || status === "breached";
}

// --- BREACH FORECAST ENGINE ---

export const WARNING_REMAINING_PCT = 25;
export const CRITICAL_REMAINING_PCT = 10;
export const HANDOFF_PANIC_MINUTES = 30;
export const HANDOFF_PANIC_RISK = 95;

export interface SlaForecast {
  status: SlaStatus;
  remainingMs: number | null;
  elapsedMs: number | null;
  totalMs: number | null;
  remainingPct: number | null;
  elapsedPct: number | null;
  willBreach: boolean;
  breachRiskPct: number;
  factors: string[];
}

export interface SlaForecastInput {
  createdAtIso: string;
  slaDeadlineIso: string | null;
  status: IncidentStatus;
  assigneeTeam: string;
  isCoordinatorAssigned: boolean;
  nowMs?: number;
}

export function forecastSla(input: SlaForecastInput): SlaForecast {
  const factors: string[] = [];
  const now = input.nowMs ?? Date.now();

  if (isTerminalStatus(input.status) || !input.slaDeadlineIso) {
    return {
      status: "completed",
      remainingMs: null,
      elapsedMs: null,
      totalMs: null,
      remainingPct: null,
      elapsedPct: null,
      willBreach: false,
      breachRiskPct: 0,
      factors: [isTerminalStatus(input.status) ? "инцидент завершён" : "SLA не задан"],
    };
  }

  const deadline = new Date(input.slaDeadlineIso).getTime();
  const created = new Date(input.createdAtIso).getTime();
  if (Number.isNaN(deadline)) {
    return {
      status: "completed",
      remainingMs: null,
      elapsedMs: null,
      totalMs: null,
      remainingPct: null,
      elapsedPct: null,
      willBreach: false,
      breachRiskPct: 0,
      factors: ["некорректный дедлайн SLA"],
    };
  }

  const remainingMs = deadline - now;
  const totalMs = !Number.isNaN(created) && deadline > created ? deadline - created : 3600_000;
  const elapsedMs = Math.max(0, totalMs - Math.max(0, remainingMs));
  const remainingPct = (Math.max(0, remainingMs) / totalMs) * 100;
  const elapsedPct = (elapsedMs / totalMs) * 100;

  let status: SlaStatus;
  if (remainingMs <= 0) {
    status = "breached";
  } else if (remainingPct <= CRITICAL_REMAINING_PCT) {
    status = "critical";
  } else if (remainingPct <= WARNING_REMAINING_PCT) {
    status = "warning";
  } else {
    status = "ok";
  }

  let breachRiskPct = riskByRemainingPct(remainingMs, remainingPct);
  factors.push(...buildTimeFactors(remainingMs, remainingPct, elapsedPct));

  const onCoordinators =
    input.isCoordinatorAssigned ||
    input.assigneeTeam.trim().toLowerCase() === COORDINATOR_TEAM.toLowerCase();

  if (remainingMs > 0 && remainingMs < HANDOFF_PANIC_MINUTES * 60_000 && onCoordinators) {
    breachRiskPct = HANDOFF_PANIC_RISK;
    factors.push(
      `задача не передана с координаторов, до дедлайна меньше ${HANDOFF_PANIC_MINUTES} минут`,
    );
  } else if (onCoordinators) {
    breachRiskPct = Math.min(100, breachRiskPct + 15);
    factors.push("инцидент ещё на координаторах, передача съест часть окна SLA");
  }

  const willBreach =
    status === "breached" || breachRiskPct >= HANDOFF_PANIC_RISK || remainingPct <= CRITICAL_REMAINING_PCT;

  return {
    status,
    remainingMs,
    elapsedMs,
    totalMs,
    remainingPct: round1(remainingPct),
    elapsedPct: round1(elapsedPct),
    willBreach,
    breachRiskPct,
    factors,
  };
}

// --- HELPERS ---

function isTerminalStatus(status: IncidentStatus): boolean {
  return status === "resolved" || status === "closed" || status === "investigation";
}

function riskByRemainingPct(remainingMs: number, remainingPct: number): number {
  if (remainingMs <= 0) return 100;
  if (remainingPct <= 5) return 85;
  if (remainingPct <= CRITICAL_REMAINING_PCT) return 70;
  if (remainingPct <= WARNING_REMAINING_PCT) return 45;
  if (remainingPct <= 50) return 20;
  return 5;
}

function buildTimeFactors(
  remainingMs: number,
  remainingPct: number,
  elapsedPct: number,
): string[] {
  if (remainingMs <= 0) {
    return [`SLA просрочен на ${Math.ceil(-remainingMs / 60_000)} минут`];
  }
  const factors = [
    `прошло ${round1(elapsedPct)}% окна SLA, осталось ${round1(remainingPct)}%`,
  ];
  if (remainingPct <= CRITICAL_REMAINING_PCT) {
    factors.push(`остаток SLA меньше ${CRITICAL_REMAINING_PCT}%`);
  } else if (remainingPct <= WARNING_REMAINING_PCT) {
    factors.push(`остаток SLA меньше ${WARNING_REMAINING_PCT}%`);
  }
  return factors;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
