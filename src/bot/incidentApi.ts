import type {
  IncidentGroup,
  IncidentPriority,
  IncidentStatus,
  NormalizedIncident,
} from "@/types/incident"
import { record } from "./sse"

export type IncidentPatch = Partial<
  Pick<
    NormalizedIncident,
    "assigneeEmployee" | "assigneeTeam" | "status" | "groups" | "priority"
  >
> & {
  sendToMtsLink?: boolean
}

type DemoInput = {
  product: string
  title: string
  priority: IncidentPriority
  status: IncidentStatus
  groups: IncidentGroup[]
  slaMinutes: number | null
}

export class IncidentApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

export function createIncidentApi(base: URL) {
  async function request(
    path: string,
    method: "GET" | "PATCH" | "POST",
    body?: object,
  ) {
    let response: Response
    try {
      response = await fetch(new URL(path, base), {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      throw new IncidentApiError(
        0,
        "Не удалось получить ответ от сервера. Проверьте состояние инцидента перед повтором.",
      )
    }

    const payload = record(await response.json().catch(() => undefined))
    if (!response.ok) {
      if (response.status === 409) {
        throw new IncidentApiError(
          409,
          "Закрытый инцидент нельзя вернуть в работу.",
        )
      }
      if (response.status === 404) {
        throw new IncidentApiError(404, "Инцидент или маршрут API не найден.")
      }
      throw new IncidentApiError(
        response.status,
        `Сервер вернул ошибку HTTP ${response.status}.`,
      )
    }
    if (!payload) {
      throw new IncidentApiError(
        response.status,
        "Сервер вернул неожиданный ответ.",
      )
    }
    return payload
  }

  function readIncident(value: unknown): NormalizedIncident | undefined {
    const incident = record(value)
    return typeof incident?.id === "string" &&
      typeof incident.product === "string" &&
      Array.isArray(incident.groups)
      ? (value as NormalizedIncident)
      : undefined
  }

  return {
    async find(id: string) {
      const payload = await request("/api/incidents", "GET")
      const incident = Array.isArray(payload.incidents)
        ? payload.incidents.map(readIncident).find((item) => item?.id === id)
        : undefined
      if (!incident) {
        throw new IncidentApiError(404, "Инцидент больше не найден.")
      }
      return incident
    },
    async patch(id: string, patch: IncidentPatch) {
      const updated = await request(
        `/api/incidents/${encodeURIComponent(id)}`,
        "PATCH",
        {
          ...patch,
          actor: "Мессенджер-бот",
        },
      )
      const incident = readIncident(updated.incident)
      if (updated.ok !== true || !incident) {
        throw new IncidentApiError(502, "Сервер не подтвердил изменение.")
      }
      return { incident, mtsLinkSent: updated.mtsLinkSent === true }
    },
    async create(input: DemoInput) {
      const created = await request("/api/incidents/demo", "POST", input)
      const incident = readIncident(created.incident)
      if (created.ok !== true || !incident) {
        throw new IncidentApiError(
          502,
          "Сервер не подтвердил создание. Проверьте дашборд.",
        )
      }
      return incident
    },
  }
}

export type IncidentApi = ReturnType<typeof createIncidentApi>