import { randomBytes } from "node:crypto"
import { InlineKeyboard } from "grammy"
import type { Bot, Context } from "grammy"
import type { NormalizedIncident } from "@/types/incident"
import { employees, groups, statuses } from "./catalog"
import { formatCriticalAlert } from "./formatAlert"
import type { IncidentApi, IncidentPatch } from "./incidentApi"

type Action = "assign" | "group" | "status"
export type CanUse = (ctx: Context) => boolean

const editableStatuses = statuses.slice(1)

export function registerIncidentActions(bot: Bot, api: IncidentApi, appUrl: URL, recipient: number, canEdit: CanUse) {
  const refs = new Map<string, string>()

  function toRef(id: string) {
    if (!id.startsWith("~") && Buffer.byteLength(id) <= 50) return id
    const ref = "~" + randomBytes(8).toString("hex")
    refs.set(ref, id)
    if (refs.size > 1024) {
      const oldest = refs.keys().next()
      if (!oldest.done) refs.delete(oldest.value)
    }
    return ref
  }

  function dashboardLink(id: string) {
    const target = new URL(appUrl)
    if (!target.pathname.endsWith("/")) target.pathname += "/"
    target.searchParams.set("incident", id)
    return target.href
  }

  function criticalKeyboard(id: string) {
    const ref = toRef(id)
    const keyboard = new InlineKeyboard()
      .text("👤 Исполнитель", `cb:assign:${ref}`)
      .text("📂 Группа", `cb:group:${ref}`).row()
      .text("🔄 Статус", `cb:status:${ref}`)
    const local = /(?:^|\.)localhost\.?$/i.test(appUrl.hostname) ||
      appUrl.hostname.startsWith("127.") || appUrl.hostname === "[::1]"
    return appUrl.protocol === "https:" && !local
      ? keyboard.url("🌐 На сайт", dashboardLink(id))
      : keyboard.text("🌐 На сайт", `cb:open:${ref}`)
  }

  async function showIncident(ctx: Context, incident: NormalizedIncident) {
    await ctx.editMessageText(formatCriticalAlert(incident), {
      reply_markup: criticalKeyboard(incident.id),
    })
  }

  async function showOptions(ctx: Context, action: Action, ref: string, id: string) {
    const keyboard = new InlineKeyboard()
    let prompt: string
    if (action === "assign") {
      prompt = "Выбери исполнителя"
      employees.forEach(([name, , team], index) => {
        keyboard.text(`${name} (${team})`, `ci:assign:${index}:${ref}`).row()
      })
    } else if (action === "group") {
      prompt = "Выбери группу для добавления"
      const current = await api.find(id)
      groups.forEach(([group, label], index) => {
        keyboard.text(`${current.groups.includes(group) ? "✓ " : ""}${label}`, `ci:group:${index}:${ref}`).row()
      })
    } else {
      prompt = "Выбери статус"
      editableStatuses.forEach(([, label], index) => keyboard.text(label, `ci:status:${index}:${ref}`).row())
    }
    keyboard.text("⬅️ Назад", `cb:back:${ref}`)
    await ctx.editMessageText(`${prompt}\nИнцидент — ${id}`, { reply_markup: keyboard })
  }

  async function applyChoice(ctx: Context, id: string, action: Action, index: number) {
    let patch: IncidentPatch
    let label: string

    switch (action) {
      case "assign": {
        const employee = employees[index]
        if (!employee) return
        patch = { assigneeEmployee: employee[0], assigneeTeam: employee[1], sendToMtsLink: true }
        label = employee[0]
        break
      }
      case "group": {
        const entry = groups[index]
        if (!entry) return
        const [group, name] = entry
        const current = await api.find(id)
        if (current.groups.includes(group)) {
          await ctx.reply(`Группа «${name}» уже есть у инцидента ${id}.`)
          return
        }

        const mutuallyExclusive = group === "CRITICAL" ? "HIGH_PRIORITY" : group === "HIGH_PRIORITY" ? "CRITICAL" : undefined
        patch = { groups: [...current.groups.filter((existing) => existing !== mutuallyExclusive), group] }
        label = name
        break
      }
      case "status": {
        const entry = editableStatuses[index]
        if (!entry) return
        patch = { status: entry[0] }
        label = entry[1]
        break
      }
    }

    const { incident, mtsLinkSent } = await api.patch(id, patch)
    let feedback: string
    if (action === "assign") {
      feedback = mtsLinkSent
        ? `✅ Назначен ${label}, данные отправлены в МТС Link.`
        : `✅ Назначен ${label}. CyberGarden не подтвердил отправку в МТС Link.`
    } else if (action === "group") {
      feedback = incident.groups.includes(groups[index][0])
        ? `✅ Добавлена группа «${label}».`
        : `Сервер сохранил изменение. Группа «${label}» не появилась при текущем статусе и приоритете.`
    } else {
      feedback = `✅ Статус — ${incident.rawStatus || label}.`
    }
    await showIncident(ctx, incident).catch(() => undefined)
    await ctx.reply(feedback)
  }

  bot.callbackQuery(/^cb:(assign|group|status|open|back):(.+)$/, async (ctx) => {
    const [, action, ref] = ctx.match
    if (!canEdit(ctx) && (action !== "open" || ctx.chat?.id !== recipient)) {
      await ctx.answerCallbackQuery({ text: "Доступ запрещён." })
      return
    }
    const id = ref.startsWith("~") ? refs.get(ref) : ref
    if (!id) {
      await ctx.answerCallbackQuery({ text: "Кнопка устарела." })
      return
    }
    await ctx.answerCallbackQuery()
    try {
      if (action === "open") {
        await ctx.reply(`Дашборд: ${dashboardLink(id)}`, { link_preview_options: { is_disabled: true } })
      } else if (action === "back") {
        await showIncident(ctx, await api.find(id))
      } else if (action === "assign" || action === "group" || action === "status") {
        await showOptions(ctx, action, ref, id)
      }
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Действие не выполнено.")
    }
  })

  bot.callbackQuery(/^ci:(assign|group|status):([0-4]):(.+)$/, async (ctx) => {
    if (!canEdit(ctx)) {
      await ctx.answerCallbackQuery({ text: "Доступ запрещён." })
      return
    }
    const [, action, choice, ref] = ctx.match
    const id = ref.startsWith("~") ? refs.get(ref) : ref
    if (!id) {
      await ctx.answerCallbackQuery({ text: "Кнопка устарела." })
      return
    }
    await ctx.answerCallbackQuery()
    if (action !== "assign" && action !== "group" && action !== "status") return
    try {
      await applyChoice(ctx, id, action, Number(choice))
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "Изменение не выполнено.")
    }
  })

  return criticalKeyboard
}
