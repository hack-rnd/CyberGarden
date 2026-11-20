import { Api, Bot, GrammyError, InlineKeyboard } from "grammy"
import { setTimeout as delay } from "node:timers/promises"
import { loadLocalEnv } from "../../scripts/demo/config"
import { canRunDemo, runDemo } from "../../scripts/demo/runDemo"
import { seenAlerts } from "./alertKinds"
import { formatAlert } from "./formatAlert"
import { followStream } from "./sse"

function telegramId(value: string | undefined): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id !== 0 ? id : undefined
}

async function main() {
  loadLocalEnv()
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chat = telegramId(process.env.TELEGRAM_CHAT_ID?.trim())
  const admin = telegramId(process.env.TELEGRAM_ADMIN_USER_ID?.trim())
  if (!token || !/^\d+:[\w-]+$/.test(token)) throw new Error("Проверьте TELEGRAM_BOT_TOKEN в .env.")
  if (chat === undefined) throw new Error("Проверьте TELEGRAM_CHAT_ID в .env.")

  const recipient = chat
  const streamUrl = new URL(process.env.MTS_SSE_URL || "http://localhost:3000/api/stream")
  const bot = new Bot(token)
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

  bot.command("start", async (ctx) => {
    await ctx.reply("Бот оповещений. /ids — ID чата и пользователя. /test — проверка доставки. /demo — демо-пульт.")
  })
  bot.command("ids", async (ctx) => {
    await ctx.reply(ctx.chat.type === "private"
      ? `ID чата: ${ctx.chat.id}\nID пользователя: ${ctx.from?.id ?? "недоступен"}`
      : `ID чата: ${ctx.chat.id}`)
  })
  bot.command("test", async (ctx) => {
    await ctx.reply(ctx.chat.id === chat ? "✅ Этот чат принимает оповещения." : "Этот чат не настроен для оповещений.")
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
  bot.catch(({ error }) => console.error("Ошибка команды Telegram.", error instanceof GrammyError ? error.error_code : ""))

  async function sendAlert(text: string, url?: string) {
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
      try {
        await sender.sendMessage(recipient, text, {
          reply_markup: url ? new InlineKeyboard().url("Открыть в ITSM", url) : undefined,
          link_preview_options: { is_disabled: true },
        })
        return
      } catch (error) {
        const seconds = error instanceof GrammyError && error.error_code === 429
          ? error.parameters.retry_after : undefined
        if (attempt === 2 || seconds === undefined || seconds > 60) {
          console.error("Алерт не отправлен.", error instanceof GrammyError ? error.error_code : "Ошибка сети")
          return
        }
        await delay(seconds * 1000, undefined, { signal }).catch(() => undefined)
      }
    }
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
        console.log(`Telegram @${username} запущен. Подключаю поток событий Next.js.`)
        stream = followStream(streamUrl, signal, async ({ events, incidents }) => {
          for (const event of events) {
            if (alreadySeen(event.id)) continue
            const alert = formatAlert(event, incidents, process.env.ITSM_URL_TEMPLATE)
            await sendAlert(alert.text, alert.url)
          }
        })
      },
    })
  } catch (error) {
    console.error("Telegram остановлен.", error instanceof GrammyError ? error.error_code : "Проверьте токен и сеть")
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
