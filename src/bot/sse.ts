import type { DiffEvent } from "@/types/incident"
import { setTimeout as delay } from "node:timers/promises"
import { isAlertKind } from "./alertKinds"

type StreamUpdate = {
  events: DiffEvent[]
  incidents: unknown[]
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function hasId(value: unknown): boolean {
  return (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isSafeInteger(value))
}

function isAlertEvent(value: unknown): value is DiffEvent {
  const event = record(value)
  return !!event && hasId(event.id) && hasId(event.incidentId) &&
    typeof event.incidentCode === "string" && typeof event.product === "string" &&
    typeof event.message === "string" && typeof event.createdAt === "string" &&
    typeof event.type === "string" && (isAlertKind(event.type) || event.type === "INCIDENT_AUTO_CLOSED")
}

export function parseFrame(frame: string): StreamUpdate | undefined {
  let name = "message"
  const lines: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    const field = line.slice(0, separator)
    const value = line.slice(separator + 1).replace(/^ /, "")
    if (field === "event") name = value
    if (field === "data") lines.push(value)
  }
  if (name !== "update" || lines.length === 0) return undefined
  const payload = record(JSON.parse(lines.join("\n")))
  if (!payload || !Array.isArray(payload.events)) return undefined
  const snapshot = record(payload.snapshot)
  return {
    events: payload.events.filter(isAlertEvent),
    incidents: Array.isArray(snapshot?.incidents) ? snapshot.incidents : [],
  }
}

async function readStream(url: URL, signal: AbortSignal, emit: (update: StreamUpdate) => Promise<void>) {
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const connection = new AbortController()

  function armWatchdog() {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => connection.abort(), 45_000)
  }

  armWatchdog()
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: AbortSignal.any([signal, connection.signal]),
    })
    if (!response.ok || !response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
      await response.body?.cancel()
      throw new Error(`Ответ SSE: ${response.status}.`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      for (;;) {
        armWatchdog()
        const chunk = await reader.read()
        clearTimeout(watchdog)
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        let boundary = /\r?\n\r?\n/.exec(buffer)
        while (boundary) {
          const frame = buffer.slice(0, boundary.index)
          buffer = buffer.slice(boundary.index + boundary[0].length)
          let update: StreamUpdate | undefined
          try {
            update = parseFrame(frame)
          } catch {
            console.warn("Пропущено событие с некорректным JSON.")
          }
          if (update?.events.length) await emit(update)
          boundary = /\r?\n\r?\n/.exec(buffer)
        }
        if (buffer.length > 16_000_000) throw new Error("Событие SSE слишком большое.")
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  } finally {
    clearTimeout(watchdog)
  }
}

export async function followStream(
  url: URL,
  signal: AbortSignal,
  emit: (update: StreamUpdate) => Promise<void>,
) {
  let interval = 1000
  while (!signal.aborted) {
    const started = Date.now()
    try {
      await readStream(url, signal, emit)
    } catch {
      if (!signal.aborted) console.warn("SSE недоступен. Подключаюсь повторно.")
    }
    if (signal.aborted) return
    if (Date.now() - started > 15_000) interval = 1000
    await delay(interval, undefined, { signal }).catch(() => undefined)
    interval = Math.min(interval * 2, 15_000)
  }
}
