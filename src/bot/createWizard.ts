import { randomBytes } from "node:crypto"
import { InlineKeyboard } from "grammy"
import type { Bot, Context } from "grammy"
import type { IncidentGroup } from "@/types/incident"
import { groups, priorities, products, statuses } from "./catalog"
import type { IncidentApi } from "./incidentApi"
import type { CanUse } from "./interactiveBot"

const lifetime = 15 * 60_000
const demoGroups = [...groups, [null, "Штатный (без группы)"]] as const
const steps = [
  ["1/5 · Выбери группу", demoGroups.map(([, label]) => label)],
  ["2/5 · Выбери приоритет", priorities.map(([, label]) => label)],
  ["3/5 · Выбери статус", statuses.map(([, label]) => label)],
  ["4/5 · Выбери продукт", products],
] as const

type Session = {
  nonce: string
  chatId: number
  expires: number
  choices: number[]
  awaitingSla: boolean
}

export const createEntry = new InlineKeyboard().text(
  "➕ Создать инцидент",
  "new:start",
)

function parseHoursInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".")
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const hours = Number(normalized)
  if (!Number.isFinite(hours) || hours < 0.1 || hours > 168) return null
  return Math.max(1, Math.round(hours * 60))
}

function formatSlaLabel(slaMinutes: number | null): string {
  if (slaMinutes === null) return "Без срока"
  const hours = Number((slaMinutes / 60).toFixed(2))
  return `${hours} ч (${slaMinutes} мин)`
}

function buildSlaStep(nonce: string) {
  const prompt =
    "5/5 · Укажи срок SLA в часах\n" +
    "Выбери готовый вариант кнопкой или напиши число в чат (например: 2,5 или 2.5 = 150 мин, от 0.1 до 168 ч)."
  const keyboard = new InlineKeyboard()
    .text("0.5 ч (30 мин)", `new:${nonce}:sla:30`)
    .text("1 ч", `new:${nonce}:sla:60`)
    .row()
    .text("2 ч", `new:${nonce}:sla:120`)
    .text("2.5 ч (150 мин)", `new:${nonce}:sla:150`)
    .row()
    .text("4 ч", `new:${nonce}:sla:240`)
    .text("Без срока", `new:${nonce}:sla:none`)
    .row()
    .text("Отменить", `new:${nonce}:cancel`)
  return { prompt, keyboard }
}

export function registerCreateWizard(
  bot: Bot,
  api: IncidentApi,
  canCreate: CanUse,
) {
  const sessions = new Map<number, Session>()

  function step(session: Session) {
    const index = session.choices.length
    const [prompt, labels] = steps[index]
    const keyboard = new InlineKeyboard()
    labels.forEach((label, choice) =>
      keyboard.text(label, `new:${session.nonce}:${index}:${choice}`).row(),
    )
    keyboard.text("Отменить", `new:${session.nonce}:cancel`)
    return { prompt, keyboard }
  }

  async function finalizeCreation(
    session: Session,
    slaMinutes: number | null,
  ): Promise<string> {
    const [groupIndex, priorityIndex, statusIndex, productIndex] =
      session.choices
    const group = demoGroups[groupIndex][0]
    const priority = priorities[priorityIndex][0]
    const status = statuses[statusIndex][0]
    const product = products[productIndex]
    const selectedGroups: IncidentGroup[] = group === null ? [] : [group]

    try {
      const incident = await api.create({
        product,
        title: `Инцидент · ${product}`,
        priority,
        status,
        groups: selectedGroups,
        slaMinutes,
      })
      const actualGroups = incident.groups.map(
        (value) => groups.find(([id]) => id === value)?.[1] ?? value,
      )
      return (
        `✅ Инцидент ${incident.code || incident.id} создан и доступен на дашборде.\n` +
        `Продукт — ${incident.product}\n` +
        `Статус — ${incident.rawStatus || statuses[statusIndex][1]}\n` +
        `Приоритет — ${incident.rawPriority || priorities[priorityIndex][1]}\n` +
        `SLA — ${formatSlaLabel(slaMinutes)}\n` +
        `Группы — ${actualGroups.join(", ") || "Нет"}`
      )
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Не удалось подтвердить создание инцидента."
    }
  }

  async function start(ctx: Context) {
    if (!canCreate(ctx) || !ctx.from || !ctx.chat) {
      await ctx.reply(
        "Создание инцидента доступно администратору в личном чате при включённом демо-режиме.",
      )
      return
    }
    const session: Session = {
      nonce: randomBytes(8).toString("hex"),
      chatId: ctx.chat.id,
      expires: Date.now() + lifetime,
      choices: [],
      awaitingSla: false,
    }
    sessions.set(ctx.from.id, session)
    const { prompt, keyboard } = step(session)
    await ctx.reply(prompt, { reply_markup: keyboard })
  }

  bot.command(["new", "create"], start)
  bot.callbackQuery("new:start", async (ctx) => {
    await ctx.answerCallbackQuery()
    await start(ctx)
  })

  bot.callbackQuery(
    /^new:([a-f0-9]+):(?:(cancel)|sla:(30|60|120|150|240|none)|([0-3]):(\d+))$/,
    async (ctx) => {
      const [, nonce, cancel, slaChoice, stage, rawChoice] = ctx.match
      const session = sessions.get(ctx.from.id)
      if (
        !canCreate(ctx) ||
        !session ||
        session.nonce !== nonce ||
        session.chatId !== ctx.chat?.id ||
        session.expires < Date.now()
      ) {
        await ctx.answerCallbackQuery({ text: "Шаг устарел. Используйте /new." })
        return
      }

      if (cancel) {
        await ctx.answerCallbackQuery()
        sessions.delete(ctx.from.id)
        await ctx.editMessageText("Создание отменено.")
        return
      }

      if (slaChoice !== undefined) {
        if (!session.awaitingSla) {
          await ctx.answerCallbackQuery({ text: "Шаг устарел. Используйте /new." })
          return
        }
        await ctx.answerCallbackQuery()
        sessions.delete(ctx.from.id)
        const slaMinutes = slaChoice === "none" ? null : Number(slaChoice)
        const result = await finalizeCreation(session, slaMinutes)
        await ctx.editMessageText(result)
        return
      }

      if (session.awaitingSla || Number(stage) !== session.choices.length) {
        await ctx.answerCallbackQuery({ text: "Шаг устарел. Используйте /new." })
        return
      }

      const choice = Number(rawChoice)
      if (!steps[session.choices.length][1][choice]) {
        await ctx.answerCallbackQuery({ text: "Выбери вариант из списка." })
        return
      }

      await ctx.answerCallbackQuery()
      session.choices.push(choice)

      if (session.choices.length < steps.length) {
        const { prompt, keyboard } = step(session)
        await ctx.editMessageText(prompt, { reply_markup: keyboard })
        return
      }

      session.awaitingSla = true
      const { prompt, keyboard } = buildSlaStep(session.nonce)
      await ctx.editMessageText(prompt, { reply_markup: keyboard })
    },
  )

  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from?.id
    const session = userId ? sessions.get(userId) : undefined
    if (
      !session ||
      !session.awaitingSla ||
      session.chatId !== ctx.chat.id ||
      session.expires < Date.now()
    ) {
      return next()
    }

    const text = ctx.message.text.trim()
    if (text.startsWith("/")) {
      sessions.delete(userId)
      return next()
    }

    const slaMinutes = parseHoursInput(text)
    if (slaMinutes === null) {
      await ctx.reply(
        "Некорректный формат SLA. Введите число часов от 0.1 до 168 (например: 2,5 или 1.5) либо нажмите кнопку выше.",
      )
      return
    }

    sessions.delete(userId)
    const result = await finalizeCreation(session, slaMinutes)
    await ctx.reply(result)
  })
}