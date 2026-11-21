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
  ["1/4 · Выбери группу", demoGroups.map(([, label]) => label)],
  ["2/4 · Выбери приоритет", priorities.map(([, label]) => label)],
  ["3/4 · Выбери статус", statuses.map(([, label]) => label)],
  ["4/4 · Выбери продукт", products],
] as const

type Session = {
  nonce: string
  chatId: number
  expires: number
  choices: number[]
}

export const createEntry = new InlineKeyboard().text("➕ Создать инцидент", "new:start")

export function registerCreateWizard(bot: Bot, api: IncidentApi, canCreate: CanUse) {
  const sessions = new Map<number, Session>()

  function step(session: Session) {
    const index = session.choices.length
    const [prompt, labels] = steps[index]
    const keyboard = new InlineKeyboard()
    labels.forEach((label, choice) => keyboard.text(label, `new:${session.nonce}:${index}:${choice}`).row())
    keyboard.text("Отменить", `new:${session.nonce}:cancel`)
    return { prompt, keyboard }
  }

  async function start(ctx: Context) {
    if (!canCreate(ctx) || !ctx.from || !ctx.chat) {
      await ctx.reply("Создание демо доступно администратору в личном чате при включённом демо-режиме.")
      return
    }
    const session = { nonce: randomBytes(8).toString("hex"), chatId: ctx.chat.id, expires: Date.now() + lifetime, choices: [] }
    sessions.set(ctx.from.id, session)
    const { prompt, keyboard } = step(session)
    await ctx.reply(prompt, { reply_markup: keyboard })
  }

  bot.command(["new", "create"], start)
  bot.callbackQuery("new:start", async (ctx) => {
    await ctx.answerCallbackQuery()
    await start(ctx)
  })

  bot.callbackQuery(/^new:([a-f0-9]+):(?:(cancel)|([0-3]):([0-4]))$/, async (ctx) => {
    const [, nonce, cancel, stage, rawChoice] = ctx.match
    const session = sessions.get(ctx.from.id)
    if (!canCreate(ctx) || !session || session.nonce !== nonce || session.chatId !== ctx.chat?.id ||
      session.expires < Date.now() || (!cancel && Number(stage) !== session.choices.length)) {
      await ctx.answerCallbackQuery({ text: "Шаг устарел. Используйте /new." })
      return
    }
    const choice = Number(rawChoice)
    if (!cancel && !steps[session.choices.length][1][choice]) {
      await ctx.answerCallbackQuery({ text: "Выбери вариант из списка." })
      return
    }
    await ctx.answerCallbackQuery()
    if (cancel) {
      sessions.delete(ctx.from.id)
      await ctx.editMessageText("Создание отменено.")
      return
    }
    session.choices.push(choice)
    if (session.choices.length < steps.length) {
      const { prompt, keyboard } = step(session)
      await ctx.editMessageText(prompt, { reply_markup: keyboard })
      return
    }

    sessions.delete(ctx.from.id)
    const [groupIndex, priorityIndex, statusIndex, productIndex] = session.choices
    const group = demoGroups[groupIndex][0]
    const priority = priorities[priorityIndex][0]
    const status = statuses[statusIndex][0]
    const product = products[productIndex]
    const selectedGroups: IncidentGroup[] = group === null ? [] : [group]

    let result: string
    try {
      const incident = await api.create({
        product,
        title: `Демо-инцидент · ${product}`,
        priority,
        status,
        groups: selectedGroups,
        slaMinutes: priority === "critical" ? 20 : 120,
      })
      const actualGroups = incident.groups.map((value) => groups.find(([id]) => id === value)?.[1] ?? value)
      result = `✅ Инцидент ${incident.code || incident.id} создан и доступен на дашборде.\n` +
        `Статус — ${incident.rawStatus || statuses[statusIndex][1]}\n` +
        `Приоритет — ${incident.rawPriority || priorities[priorityIndex][1]}\n` +
        `Группы — ${actualGroups.join(", ") || "Нет"}`
    } catch (error) {
      result = error instanceof Error ? error.message : "Не удалось подтвердить создание инцидента."
    }
    await ctx.editMessageText(result)
  })
}
