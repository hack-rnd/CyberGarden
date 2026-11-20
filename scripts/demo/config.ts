import { loadEnvFile } from "node:process"

export function loadLocalEnv() {
  try {
    loadEnvFile(".env")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

export const coordinatorTeam = "КЦ ИТ Координаторы Массовых Инцидентов"
export const mtsDemoId = "INC000099990001"
export const mtsDemoSysId = "999000111222333444"
export const legacyDemoId = "INC-DEMO-001"
export const legacyTemplateId = "INC-009840"

export function createMtsDemo(now: Date) {
  return {
    sysId: mtsDemoSysId,
    id: mtsDemoId,
    submitDate: now.toISOString(),
    deadline: new Date(now.getTime() + 25 * 60_000).toISOString(),
    state: "Выполняется",
    stateEnum: "WorkInProgress",
    stateId: 2,
    priorityId: 4,
    priority: "Наивысший",
    urgencyId: 4,
    impactId: 4,
    productName: "Автопросматриватель TicTok",
    service: "[Автопросматриватель TicTok] Процессор видео",
    header: "Полная недоступность кластера обработки видео",
    description: "Массовый отказ узлов обработки видеопотока. Срочно требуется координация и эскалация.",
    assignedGroupName: "КЦ ИТ ЦП Billing Platform",
    productUrl: null,
    completionDate: null,
    solution: null,
  }
}
