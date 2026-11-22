import { Api, Bot, GrammyError, InlineKeyboard } from "grammy"
import { setTimeout as delay } from "node:timers/promises"
import { loadLocalEnv } from "../../scripts/demo/config"
import { canRunDemo, runDemo } from "../../scripts/demo/runDemo"
import { seenAlerts } from "./alertKinds"
import { formatAlert } from "./formatAlert"
import { followStream } from "./sse"
import { createEntry, registerCreateWizard } from "./createWizard"
import { createIncidentApi } from "./incidentApi"
import { registerIncidentActions } from "./interactiveBot"

type BotIncident = {
  id: string
  code?: string
  product: string
  title?: string
  description?: string
  priority: string
  rawPriority?: string
  status: string
  rawStatus?: string
  assigneeTeam?: string
  assigneeEmployee?: string | null
  createdAt?: string
}

const DEV_STATUS_LABELS: Record<string, string> = {
  in_progress: "В работе",
  resolved: "Решён",
  closed: "Закрыт",
}

function telegramId(value: string | undefined): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id !== 0 ? id : undefined
}

function devActionKeyboard(incidentId: string, includeBack = false): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("Взять в работу", `dev:set:in_progress:${incidentId}`)
    .text("Проблема решена", `dev:set:resolved:${incidentId}`)
    .row()
    .text("Закрыть инцидент", `dev:set:closed:${incidentId}`)
  if (includeBack) {
    kb.row().text("← К списку задач", "dev:list")
  }
  return kb
}

function formatDevCard(incident: BotIncident, heading = "Задача для разработчика"): string {
  const assignee = incident.assigneeEmployee || incident.assigneeTeam || "Не назначен"
  const lines = [
    `${heading}: ${incident.id}`,
    `Продукт: ${incident.product}`,
    `Приоритет: ${incident.rawPriority || incident.priority} · Статус: ${incident.rawStatus || incident.status}`,
    `Исполнитель: ${assignee}`,
  ]
  const details = (incident.title || incident.description || "").trim()
  if (details) lines.push(`Суть: ${details.slice(0, 240)}`)
  return lines.join("\n")
}

async function main() {
  loadLocalEnv()
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chat = telegramId(process.env.TELEGRAM_CHAT_ID?.trim())
  const admin = telegramId(process.env.TELEGRAM_ADMIN_USER_ID?.trim())
  if (!token || !/^\d+:[\w-]+$/.test(token)) throw new Error("Проверьте TELEGRAM_BOT_TOKEN в .env.")
  if (chat === undefined) throw new Error("Проверьте TELEGRAM_CHAT_ID в .env.")

  const recipient = chat
  const apiUrl = new URL(process.env.MTS_API_URL || "http://localhost:3000")
  const streamUrl = new URL(process.env.MTS_SSE_URL || "/api/stream", apiUrl)
  const configuredAppUrl = new URL(process.env.PUBLIC_APP_URL || "http://localhost:3000")
  const appUrl = ["https:", "http:"].includes(configuredAppUrl.protocol) &&
    !configuredAppUrl.username && !configuredAppUrl.password
    ? configuredAppUrl
    : new URL("http://localhost:3000")
  const bot = new Bot(token)
  const api = createIncidentApi(apiUrl)
  const sender = new Api(token, { timeoutSeconds: 8 })
  const controller = new AbortController()
  const signal = controller.signal
  const alreadySeen = seenAlerts()
  const menu = new InlineKeyboard()
    .text("Создать критический", "demo:critical").row()
    .text("Назначить", "demo:assign").text("Решить", "demo:resolve").row()
    .text("Восстановить JSON", "demo:confirm-reset")
  let stream: Promise<void> | undefined

  function allowed(user?: number, type?: string) {
    return type === "private" && admin !== undefined && admin > 0 && user === admin && canRunDemo()
  }

  function devAllowed(userId?: number, chatId?: number, chatType?: string) {
    if (chatId === recipient) return true
    return allowed(userId, chatType) || (admin !== undefined && admin > 0 && userId === admin)
  }

  async function fetchActiveIncidents(): Promise<BotIncident[]> {
    const response = await fetch(new URL("/api/incidents", apiUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { incidents?: BotIncident[] }
    const list = Array.isArray(data.incidents) ? data.incidents : []
    return list
      .filter((item) => item.status !== "closed" && item.status !== "resolved")
      .sort((a, b) => {
        const aCrit = a.priority === "critical" ? 0 : 1
        const bCrit = b.priority === "critical" ? 0 : 1
        if (aCrit !== bCrit) return aCrit - bCrit
        return (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0)
      })
  }

  async function buildTasksMenu(): Promise<{ text: string; keyboard?: InlineKeyboard }> {
    const active = await fetchActiveIncidents()
    if (!active.length) {
      return { text: "Активных инцидентов сейчас нет — все задачи решены." }
    }
    const kb = new InlineKeyboard()
    for (const inc of active.slice(0, 10)) {
      const marker = inc.priority === "critical" ? "[КРИТ]" : inc.priority === "high" ? "[ВЫС]" : "[АКТ]"
      const label = `${marker} ${inc.id} · ${inc.product}`.slice(0, 58)
      kb.text(label, `dev:pick:${inc.id}`).row()
    }
    return {
      text: `Активные задачи для разработчика (${active.length}). Выберите инцидент, чтобы изменить статус:`,
      keyboard: kb,
    }
  }

  // Команды регистрируются ДО wizard/interactive middleware, чтобы text-обработчики их не перехватывали
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Бот оповещений и задач.\n/tasks — активные задачи (решить / закрыть инцидент)\n/new — создать инцидент\n/demo — демо-пульт\n/ids — ID чата и пользователя\n/test — проверка доставки",
      {
        reply_markup: allowed(ctx.from?.id, ctx.chat.type) ? createEntry : undefined,
      },
    )
  })
  bot.command("ids", async (ctx) => {
    await ctx.reply(ctx.chat.type === "private"
      ? `ID чата: ${ctx.chat.id}\nID пользователя: ${ctx.from?.id ?? "недоступен"}`
      : `ID чата: ${ctx.chat.id}`)
  })
  bot.command("test", async (ctx) => {
    await ctx.reply(ctx.chat.id === chat ? "Этот чат принимает оповещения и задачи." : "Этот чат не настроен для оповещений.")
  })
  bot.command("tasks", async (ctx) => {
    console.log(`[bot] /tasks от user=${ctx.from?.id} chat=${ctx.chat.id}`)
    if (!devAllowed(ctx.from?.id, ctx.chat.id, ctx.chat.type)) {
      await ctx.reply("Доступ к управлению задачами ограничен.")
      return
    }
    try {
      const { text, keyboard } = await buildTasksMenu()
      await ctx.reply(text, { reply_markup: keyboard })
    } catch (err) {
      console.error("[bot] Ошибка /tasks:", err)
      await ctx.reply("Не удалось загрузить список задач с дашборда. Проверьте, что Next.js запущен.")
    }
  })

  bot.callbackQuery("dev:list", async (ctx) => {
    if (!devAllowed(ctx.from.id, ctx.chat?.id, ctx.chat?.type)) {
      await ctx.answerCallbackQuery({ text: "Доступ запрещён." })
      return
    }
    await ctx.answerCallbackQuery()
    try {
      const { text, keyboard } = await buildTasksMenu()
      await ctx.editMessageText(text, { reply_markup: keyboard })
    } catch {
      await ctx.reply("Не удалось обновить список задач.")
    }
  })

  bot.callbackQuery(/^dev:pick:(.+)$/, async (ctx) => {
    if (!devAllowed(ctx.from.id, ctx.chat?.id, ctx.chat?.type)) {
      await ctx.answerCallbackQuery({ text: "Доступ запрещён." })
      return
    }
    await ctx.answerCallbackQuery()
    const incidentId = ctx.match[1]
    try {
      const active = await fetchActiveIncidents()
      const found = active.find((item) => item.id === incidentId)
      if (!found) {
        await ctx.editMessageText(`Инцидент ${incidentId} уже решён или закрыт.`, {
          reply_markup: new InlineKeyboard().text("← К списку задач", "dev:list"),
        })
        return
      }
      await ctx.editMessageText(formatDevCard(found), {
        reply_markup: devActionKeyboard(found.id, true),
      })
    } catch {
      await ctx.reply("Не удалось загрузить карточку инцидента.")
    }
  })

  bot.callbackQuery(/^dev:set:(in_progress|resolved|closed):(.+)$/, async (ctx) => {
    if (!devAllowed(ctx.from.id, ctx.chat?.id, ctx.chat?.type)) {
      await ctx.answerCallbackQuery({ text: "Доступ запрещён." })
      return
    }
    const nextStatus = ctx.match[1]
    const incidentId = ctx.match[2]
    try {
      const response = await fetch(
        new URL(`/api/incidents/${encodeURIComponent(incidentId)}`, apiUrl),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: nextStatus,
            actor: "Разработчик (МТС Link)",
          }),
          signal: AbortSignal.timeout(6000),
        },
      )
      if (response.status === 409) {
        await ctx.answerCallbackQuery({ text: "Закрытый инцидент нельзя вернуть в работу.", show_alert: true })
        return
      }
      if (!response.ok) {
        await ctx.answerCallbackQuery({ text: `Ошибка сервера: ${response.status}`, show_alert: true })
        return
      }
      const statusLabel = DEV_STATUS_LABELS[nextStatus] ?? nextStatus
      await ctx.answerCallbackQuery({ text: `Статус обновлён: ${statusLabel}` })
      const nextMarkup = nextStatus === "in_progress"
        ? devActionKeyboard(incidentId, true)
        : new InlineKeyboard().text("← К активным задачам", "dev:list")
      await ctx.editMessageText(
        `Статус инцидента ${incidentId} обновлён разработчиком → «${statusLabel}».\nДашборд координатора обновлён автоматически.`,
        { reply_markup: nextMarkup },
      )
    } catch {
      await ctx.answerCallbackQuery({ text: "Не удалось обновить статус.", show_alert: true })
    }
  })

  bot.command("demo", async (ctx) => {
    if (!allowed(ctx.from?.id, ctx.chat.type)) {
      await ctx.reply("Демо-пульт доступен настроенному администратору в личном чате.")
      return
    }
    await ctx.reply("Демо-пульт", { reply_markup: menu })
  })
  bot.callbackQuery(/^demo:(critical|resolve|assign|confirm-reset|reset)$/, async (ctx) => {
    if (!allowed(ctx.from.id, ctx.chat?.type)) {
      await ctx.answerCallbackQuery({ text: "Доступ запрещён." })
      return
    }
    await ctx.answerCallbackQuery()
    const action = ctx.match[1]
    if (action === "confirm-reset") {
      await ctx.reply("Восстановить JSON из резервной копии?", {
        reply_markup: new InlineKeyboard().text("Подтвердить восстановление", "demo:reset"),
      })
      return
    }
    if (action !== "critical" && action !== "resolve" && action !== "assign" && action !== "reset") return
    try {
      if (action === "reset") await ctx.editMessageReplyMarkup()
      await ctx.reply(await runDemo(action))
    } catch (error) {
      const message = error instanceof Error && !("code" in error)
        ? error.message
        : "Демо-команда не выполнена. Проверьте журнал процесса бота."
      console.warn("Демо-команда не выполнена.", message)
      await ctx.reply(message)
    }
  })

  const criticalKeyboard = registerIncidentActions(bot, api, appUrl, recipient, (ctx) =>
    admin !== undefined && admin > 0 && ctx.from?.id === admin &&
    (ctx.chat?.type === "private" || ctx.chat?.id === recipient),
  )
  registerCreateWizard(bot, api, (ctx) => allowed(ctx.from?.id, ctx.chat?.type))

  bot.catch(({ error }) =>
    console.error(
      "Ошибка команды бота:",
      error instanceof GrammyError ? `${error.error_code} ${error.description}` : error,
    ),
  )

  async function sendAlert(text: string, keyboard?: InlineKeyboard): Promise<boolean> {
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
      try {
        await sender.sendMessage(recipient, text, {
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        })
        return true
      } catch (error) {
        const seconds = error instanceof GrammyError && error.error_code === 429
          ? error.parameters.retry_after : undefined
        if (attempt === 2 || seconds === undefined || seconds > 60) {
          console.error("Алерт не отправлен.", error instanceof GrammyError ? error.error_code : "Ошибка сети")
          return false
        }
        await delay(seconds * 1000, undefined, { signal }).catch(() => undefined)
      }
    }
    return false
  }

  const stop = () => {
    controller.abort()
    void bot.stop().catch(() => undefined)
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)

  try {
    await bot.start({
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
      onStart: ({ username }) => {
        console.log(`Бот @${username} запущен. Подключаю поток событий Next.js.`)
        void bot.api
          .setMyCommands([
            { command: "tasks", description: "Активные задачи (решить / закрыть)" },
            { command: "new", description: "Создать инцидент" },
            { command: "demo", description: "Демо-пульт" },
            { command: "test", description: "Проверка доставки" },
          ])
          .catch(() => undefined)
        stream = followStream(streamUrl, signal, async ({ events, incidents }) => {
          for (const event of events) {
            if (alreadySeen.has(event.id)) continue

            if (event.type === "MTS_LINK_SENT") {
              const target = (incidents as unknown as BotIncident[]).find(
                (item) => item.id === event.incidentId,
              )
              const cardText = target
                ? formatDevCard(target, "Назначена задача (МТС Link)")
                : event.message
              if (await sendAlert(cardText, devActionKeyboard(event.incidentId))) {
                alreadySeen.add(event.id)
              }
              continue
            }

            const alert = formatAlert(event, incidents, process.env.ITSM_URL_TEMPLATE)
            const keyboard = event.type === "NEW_CRITICAL"
              ? criticalKeyboard(event.incidentId)
              : alert.url ? new InlineKeyboard().url("Открыть в ITSM", alert.url) : undefined
            if (await sendAlert(alert.text, keyboard)) alreadySeen.add(event.id)
          }
        })
      },
    })
  } catch (error) {
    console.error("Бот остановлен.", error instanceof GrammyError ? `${error.error_code} ${error.description}` : "Проверьте токен и сеть")
    process.exitCode = 1
  } finally {
    controller.abort()
    await stream
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Не удалось запустить бота.")
  process.exitCode = 1
})