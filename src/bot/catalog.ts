import type { IncidentGroup, IncidentPriority, IncidentStatus } from "@/types/incident"

export const groups = [
  ["CRITICAL", "Критические"],
  ["ASSIGNED_TO_COORDINATORS", "На координаторах"],
  ["HIGH_PRIORITY", "Высокий приоритет"],
  ["INVESTIGATION", "Исследование ситуации"],
] as const satisfies readonly (readonly [IncidentGroup, string])[]

export const priorities = [
  ["critical", "Критический"],
  ["high", "Высокий"],
  ["medium", "Средний"],
  ["low", "Низкий"],
] as const satisfies readonly (readonly [IncidentPriority, string])[]

export const statuses = [
  ["new", "Новый"],
  ["in_progress", "В работе"],
  ["waiting", "Ожидает"],
  ["investigation", "Исследование"],
  ["resolved", "Решён"],
] as const satisfies readonly (readonly [IncidentStatus, string])[]

export const products = [
  "Автопросматриватель TicTok",
  "Billing Platform",
  "KION",
  "МТС Link",
  "Личный кабинет",
] as const

export const employees = [
  ["Дядя Фёдор", "КЦ ИТ Координаторы Массовых Инцидентов", "Координаторы МИ"],
  ["Алиса", "КЦ ИТ ЦП Billing Platform", "Billing Platform"],
  ["Винни Пух", "КЦ ИТ OPS Аварии ДС", "OPS Аварии ДС"],
  ["Василиса", "КЦ ИТ Media L2 KION", "Media L2 KION"],
  ["Медведь Барсик", "КЦ ИТ ОГЭ Приморье", "ОГЭ Приморье"],
] as const
