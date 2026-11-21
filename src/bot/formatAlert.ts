import type { DiffEvent, NormalizedIncident } from "@/types/incident"
import { alertKinds, isAlertKind } from "./alertKinds"
import { record } from "./sse"

export function matchIncident(event: DiffEvent, rows: unknown[]): NormalizedIncident | undefined {
  const found = rows.find((value) => {
    const incident = record(value)
    return (typeof incident?.id === "string" || typeof incident?.id === "number") &&
      String(incident.id) === String(event.incidentId)
  })
  return found as NormalizedIncident | undefined
}

function field(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function formatSla(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return ""
  return (value < 0 ? "просрочен на " : "осталось ") + Math.ceil(Math.abs(value) / 60_000) + " мин"
}

export function formatCriticalAlert(value: unknown, event?: DiffEvent) {
  const incident = record(value)
  const id = field(incident?.id) || event?.incidentId || "Не указан"
  const product = field(incident?.product) || event?.product || "Не указан"
  const status = field(incident?.statusLabel) || field(incident?.rawStatus) || "Не указан"
  const sla = field(incident?.slaLabel) || formatSla(incident?.slaRemainingMs) || "Не указан"
  const assignee = field(incident?.assigneeEmployee) || field(incident?.assigneeTeam) || "Не назначен"
  return [
    "🚨 Новый критический инцидент",
    `Инцидент — ${id.slice(0, 100)}`,
    `Продукт — ${product.slice(0, 200)}`,
    `Статус — ${status.slice(0, 160)}`,
    `SLA — ${sla.slice(0, 100)}`,
    `Исполнитель — ${assignee.slice(0, 200)}`,
  ].join("\n")
}

function httpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol === "https:" && !url.username && !url.password) return url.href
  } catch {
    return undefined
  }
}

export function formatAlert(event: DiffEvent, snapshot: unknown[], itsmTemplate?: string) {
  const incident = record(matchIncident(event, snapshot))
  if (event.type === "NEW_CRITICAL") return { text: formatCriticalAlert(incident, event), url: undefined }
  if (event.type === "INCIDENT_AUTO_CLOSED") {
    return { text: `✅ Инцидент ${event.incidentCode} автоматически закрыт.`, url: undefined }
  }
  const ai = record(incident?.ai)
  const status = field(incident?.rawStatus) || field(incident?.status)
  const sla = formatSla(incident?.slaRemainingMs)
  const summary = field(ai?.summary)
  const team = field(ai?.recommendedTeam)
  const url = httpsUrl(field(incident?.itsmUrl)) ??
    httpsUrl(itsmTemplate?.replaceAll("{id}", encodeURIComponent(String(event.incidentId))) ?? "")

  const text = [
    isAlertKind(event.type) ? alertKinds[event.type] : event.type,
    `Инцидент — ${String(event.incidentCode).slice(0, 100)}`,
    `Продукт — ${String(event.product).slice(0, 200)}`,
    status && `Статус — ${status.slice(0, 160)}`,
    sla && `SLA — ${sla}`,
    String(event.message).slice(0, 700),
    summary && `Выжимка ИИ — ${summary.slice(0, 500)}`,
    team && `Рекомендованная команда — ${team.slice(0, 180)}`,
  ].filter(Boolean).join("\n")

  return { text, url }
}
