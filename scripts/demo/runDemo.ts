import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { demoMapping } from "./config"
import type { DemoMapping } from "./config"

export type DemoAction = "critical" | "resolve" | "assign" | "reset"

function isRow(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function rowsOf(document: unknown, path: readonly string[]) {
  let value = document
  for (const key of path) value = isRow(value) && Object.hasOwn(value, key) ? value[key] : undefined
  if (!Array.isArray(value) || !value.every(isRow)) throw new Error("Проверьте путь к массиву в demoMapping.")
  return value
}

function parse(raw: string): unknown {
  return JSON.parse(raw.replace(/^\uFEFF/, ""))
}

function apply(document: unknown, mapping: DemoMapping, action: Exclude<DemoAction, "reset">) {
  const { matchField, templateId, createdFields, priorityField, statusField, assignmentField } = mapping
  const rows = rowsOf(document, mapping.arrayPath)
  const demoId = createdFields[matchField]
  if (demoId === undefined || demoId === templateId) throw new Error("Задайте новый ID в createdFields.")
  const demo = rows.find((row) => row[matchField] === demoId)

  if (action === "critical") {
    if (demo) return false
    const template = rows.find((row) => row[matchField] === templateId)
    if (!template) throw new Error("Запись-шаблон отсутствует в файле.")
    for (const key of [priorityField, statusField, assignmentField, ...Object.keys(createdFields)]) {
      if (!Object.hasOwn(template, key)) throw new Error("Поле из demoMapping отсутствует в записи-шаблоне.")
    }
    const now = Date.now()
    rows.push({
      ...template,
      ...createdFields,
      [priorityField]: mapping.critical,
      [statusField]: mapping.active,
      created_at: new Date(now).toISOString(),
      sla_deadline: new Date(now + 60 * 60_000).toISOString(),
    })
    return true
  }

  if (!demo) throw new Error("Сначала создайте демо-инцидент.")
  if (action === "assign" && demo[statusField] === mapping.resolved) {
    throw new Error("Назначение проверяется до решения. Сбросьте демо и повторите сценарий.")
  }
  const field = action === "resolve" ? statusField : assignmentField
  const value = action === "resolve" ? mapping.resolved : mapping.coordinators
  if (demo[field] === value) return false
  demo[field] = value
  return true
}

export function canRunDemo(): boolean {
  return process.env.MTS_DEMO_ENABLED === "1" && demoMapping !== undefined
}

export async function runDemo(action: DemoAction, mapping = demoMapping): Promise<string> {
  if (process.env.MTS_DEMO_ENABLED !== "1") throw new Error("Установите MTS_DEMO_ENABLED=1 для рабочей копии.")
  if (!mapping) throw new Error("Заполните demoMapping по исходному JSON.")
  const file = resolve(process.env.MTS_JSON_PATH || "data/incidents.json")
  const backup = join(dirname(file), "incidents.backup.json")
  if (file === backup) throw new Error("MTS_JSON_PATH указывает на резервную копию.")
  const lockPath = backup + ".demo.lock"
  const temp = file + "." + randomUUID() + ".tmp"
  const lock = await open(lockPath, "wx")

  try {
    const original = await readFile(file, "utf8")
    let next: string
    if (action === "reset") {
      next = await readFile(backup, "utf8")
      rowsOf(parse(next), mapping.arrayPath)
    } else {
      const document = parse(original)
      if (!apply(document, mapping, action)) return "Демо-инцидент уже в нужном состоянии."
      next = JSON.stringify(document, null, 2) + "\n"
    }
    if (original === next) return "JSON уже в нужном состоянии."

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
    return action === "reset" ? "JSON восстановлен из резервной копии." : "Демо-сценарий выполнен."
  } finally {
    try {
      await rm(temp, { force: true })
    } finally {
      await lock.close()
      await rm(lockPath, { force: true })
    }
  }
}
