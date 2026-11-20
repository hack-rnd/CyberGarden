import type { DiffEvent } from "@/types/incident"

export const alertKinds = {
  NEW_CRITICAL: "Новый критический инцидент",
  CRITICAL_RESOLVED: "Критический инцидент решён",
  ASSIGNED_TO_COORDINATORS: "Назначен на координаторов",
  INVESTIGATION_ASSIGNED: "Исследование назначено на координаторов",
} as const

export type AlertKind = keyof typeof alertKinds

export function isAlertKind(type: string): type is AlertKind {
  return Object.hasOwn(alertKinds, type)
}

export function seenAlerts(capacity = 1024) {
  const ids = new Set<string>()

  return (id: DiffEvent["id"]): boolean => {
    const key = String(id)
    if (ids.has(key)) return true
    ids.add(key)
    if (ids.size > capacity) {
      const oldest = ids.values().next()
      if (!oldest.done) ids.delete(oldest.value)
    }
    return false
  }
}
