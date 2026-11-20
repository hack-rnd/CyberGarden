// --- DIRECTORY (extracted from data/incidents.json, MTS export) ---

export const COORDINATOR_TEAM = "КЦ ИТ Координаторы Массовых Инцидентов";

// teams that resolve incidents (coordinator team is a handoff source, not a target)
export const RESOLVER_TEAMS = ["Техподдержка", "Команда Core"] as const;

export const ALL_TEAMS = [COORDINATOR_TEAM, ...RESOLVER_TEAMS] as const;

export const PRODUCTS = [
  "Биллинг",
  "Личный кабинет",
  "Сеть доступа",
  "Мобильный банк",
  "ТВ-платформа",
] as const;
