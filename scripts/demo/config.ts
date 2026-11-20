import { loadEnvFile } from "node:process"

export function loadLocalEnv() {
  try {
    loadEnvFile(".env")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

type Scalar = string | number

export type DemoMapping = {
  arrayPath: readonly string[]
  matchField: string
  templateId: Scalar
  createdFields: Readonly<Record<string, Scalar>>
  priorityField: string
  statusField: string
  assignmentField: string
  critical: Scalar
  active: Scalar
  resolved: Scalar
  coordinators: Scalar
}

export const demoMapping: DemoMapping = {
  arrayPath: [],
  matchField: "id",
  templateId: "INC-009840",
  createdFields: {
    id: "INC-DEMO-001",
    title: "Демо: сбой воспроизведения эфиров",
    description: "Учебный инцидент для проверки дашборда и оповещений.",
    itsm_url: "",
  },
  priorityField: "priority",
  statusField: "status",
  assignmentField: "assignee_team",
  critical: "Критический",
  active: "В работе",
  resolved: "Решен",
  coordinators: "КЦ ИТ Координаторы Массовых Инцидентов",
}
