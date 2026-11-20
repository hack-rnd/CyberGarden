import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { coordinatorTeam, createMtsDemo, legacyDemoId, legacyTemplateId, mtsDemoId, mtsDemoSysId } from "./config"

export type DemoAction = "critical" | "resolve" | "assign" | "reset"

type Row = Record<string, unknown>
type Mutation = Exclude<DemoAction, "reset">

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function rowsOf(document: unknown): Row[] {
  const rows = isRow(document) ? document.incidents : document
  if (!Array.isArray(rows) || !rows.every(isRow)) throw new Error("Ожидается массив инцидентов или объект с массивом incidents.")
  return rows
}

function parse(raw: string): unknown {
  return JSON.parse(raw.replace(/^\uFEFF/, ""))
}

function applyMts(rows: Row[], action: Mutation, now: Date) {
  const demo = rows.find((row) => row.id === mtsDemoId)
  const sysIdCollision = rows.some((row) => row.sysId === mtsDemoSysId && row !== demo)
  if (sysIdCollision || (demo && demo.sysId !== mtsDemoSysId)) {
    throw new Error("ID или sysId демо-записи уже принадлежит другому инциденту.")
  }

  if (action === "critical") {
    if (demo) return false
    rows.push(createMtsDemo(now))
    return true
  }
  if (!demo) throw new Error("Сначала создайте демо-инцидент.")

  if (action === "assign") {
    if (demo.stateEnum === "Resolved") throw new Error("Назначение проверяется до решения.")
    if (demo.assignedGroupName === coordinatorTeam && demo.stateEnum === "Assigned" &&
      demo.state === "Назначен" && demo.stateId === 0) return false
    Object.assign(demo, {
      assignedGroupName: coordinatorTeam,
      state: "Назначен",
      stateEnum: "Assigned",
      stateId: 0,
      lastAssignmentToTeamDateTime: now.toISOString(),
    })
    return true
  }

  if (demo.priorityId !== 4 || demo.priority !== "Наивысший") throw new Error("Демо-инцидент должен быть критическим.")
  if (demo.stateEnum === "Resolved") return false
  Object.assign(demo, {
    state: "Завершен",
    stateEnum: "Resolved",
    stateId: 7,
    completionDate: now.toISOString(),
    solution: "Кластер перезапущен, трафик восстановлен.",
  })
  return true
}

function applyLegacy(rows: Row[], action: Mutation, now: Date) {
  const demo = rows.find((row) => row.id === legacyDemoId)
  if (action === "critical") {
    if (demo) return false
    const template = rows.find((row) => row.id === legacyTemplateId)
    if (!template) throw new Error("Запись-шаблон отсутствует в тестовом файле.")
    rows.push({
      ...template,
      id: legacyDemoId,
      title: "Демо: сбой воспроизведения эфиров",
      description: "Учебный инцидент для проверки дашборда и оповещений.",
      priority: "Критический",
      status: "В работе",
      itsm_url: "",
      created_at: now.toISOString(),
      sla_deadline: new Date(now.getTime() + 60 * 60_000).toISOString(),
    })
    return true
  }
  if (!demo) throw new Error("Сначала создайте демо-инцидент.")
  if (action === "assign" && demo.status === "Решен") throw new Error("Назначение проверяется до решения.")
  const field = action === "resolve" ? "status" : "assignee_team"
  const value = action === "resolve" ? "Решен" : coordinatorTeam
  if (demo[field] === value) return false
  demo[field] = value
  return true
}

function apply(document: unknown, file: string, action: Mutation) {
  const rows = rowsOf(document)
  const now = new Date()
  if ((!rows.length && basename(file).toLowerCase() === "character_problems.json") ||
    (rows.length && rows.every((row) =>
      typeof row.sysId === "string" && typeof row.stateEnum === "string" && typeof row.priorityId === "number",
    ))) {
    return applyMts(rows, action, now)
  }

  if (rows.length && rows.every((row) =>
    typeof row.status === "string" && Object.hasOwn(row, "assignee_team"),
  )) {
    return applyLegacy(rows, action, now)
  }

  throw new Error("Формат выгрузки не поддерживается демо-командами.")
}

export function canRunDemo(): boolean {
  return process.env.MTS_DEMO_ENABLED === "1"
}

export async function runDemo(action: DemoAction): Promise<string> {
  if (!canRunDemo()) throw new Error("Установите MTS_DEMO_ENABLED=1 для рабочей копии.")
  const file = resolve(process.env.MTS_JSON_PATH || "data/incidents.json")
  const backup = join(dirname(file), "incidents.backup.json")
  if (basename(file).toLowerCase() === "incidents.backup.json") throw new Error("MTS_JSON_PATH указывает на резервную копию.")
  const lockPath = backup + ".demo.lock"
  const temp = file + "." + randomUUID() + ".tmp"
  const lock = await open(lockPath, "wx")

  try {
    const original = await readFile(file, "utf8")
    let next: string
    if (action === "reset") {
      next = await readFile(backup, "utf8")
      rowsOf(parse(next))
    } else {
      const document = parse(original)
      if (!apply(document, file, action)) return "Демо-инцидент уже в нужном состоянии."
      next = JSON.stringify(document, null, 2) + "\n"
    }

    if (original !== next) {
      await writeFile(temp, next, { encoding: "utf8", flag: "wx" })
      if (action !== "reset") {
        const snapshot = temp + ".backup"
        try {
          await writeFile(snapshot, original, { encoding: "utf8", flag: "wx" })
          await copyFile(snapshot, backup, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error
          })
        } finally {
          await rm(snapshot, { force: true })
        }
      }
      if (await readFile(file, "utf8") !== original) throw new Error("Файл изменился. Повторите команду.")
      await rename(temp, file)
    }

    if (action === "reset") {
      await unlink(backup)
      return "JSON восстановлен из резервной копии."
    }
    return "Демо-сценарий выполнен."
  } finally {
    try {
      await rm(temp, { force: true })
    } finally {
      await lock.close()
      await rm(lockPath, { force: true })
    }
  }
}
