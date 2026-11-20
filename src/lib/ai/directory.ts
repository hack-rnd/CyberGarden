// --- DIRECTORY (real MTS teams and products, character_problems.json) ---

export const COORDINATOR_TEAM = "КЦ ИТ Координаторы Массовых Инцидентов";

// never recommend these as resolver teams
export const EXCLUDED_TEAMS = [COORDINATOR_TEAM, "AutoClosedMi"] as const;

// real resolver teams from the MTS export
export const RESOLVER_TEAMS = [
  "КЦ ДОИ Администрирование SAN",
  "КЦ ИТ Развитие DEVOPS",
  "КЦ МТС Гильдия (SimpleOne)",
  "Дежурная смена ОГЭ МЦОД Санкт-Петербург",
  "КЦ ББ ДИБ УРМС VPN Support",
  "КЦ ИТ ОРД МедиаСкаут",
  "ОГЭ Приморье",
  "КЦ ИТ ЦРМП ОРМП Foris Аварии Тарификация",
  "КЦ ИТ OPS Аварии MSCP",
  "КЦ ИТ ЦП Billing Platform",
  "КЦ ИТ Мой МТС",
  "КЦ ИТ Active Directory",
  "КЦ ТБ ДМиМС DC-NET Аварии",
  "КЦ ИТ ЦП Enablement Platform",
  "КЦ ИТ Поддержка Membrana",
  "КЦ ИТ OPS Аварии ДС",
  "КЦ ИТ EP Product Catalog",
  "КЦ ДОИ VMWare",
  "КЦ ИТ Media L2 KION",
  "КЦ ИТ Allure TestOps Support",
] as const;

export const ALL_TEAMS = [COORDINATOR_TEAM, ...RESOLVER_TEAMS] as const;

// real products from the MTS export
export const PRODUCTS = [
  "Автопросматриватель TicTok",
  "Акваланг для муравьев",
  "Летающий ковер",
  "Страхование хомячков",
  "Вечная зажигалка",
] as const;

export const PROMPT_VERSION = "v2";
