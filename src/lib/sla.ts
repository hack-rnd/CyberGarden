import type { SlaStatus } from "@/types/incident";

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
