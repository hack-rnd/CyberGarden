"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { DiffEvent } from "@/types/incident"
import { alertKinds, isAlertKind, seenAlerts } from "@/bot/alertKinds"
import type { AlertKind } from "@/bot/alertKinds"
import styles from "./incidentAlerts.module.css"

type ToastEvent = DiffEvent & { type: AlertKind }

const mutedKey = "mts.incident-alerts.muted"
const preferenceChanged = "mts-incident-alert-preference"
let fallbackMuted = true

function readMuted() {
  try {
    return (localStorage.getItem(mutedKey) ?? String(fallbackMuted)) !== "false"
  } catch {
    return fallbackMuted
  }
}

function readNotificationPermission(): NotificationPermission | "unavailable" {
  return typeof Notification === "undefined" ? "unavailable" : Notification.permission
}

function subscribePreferences(listener: () => void) {
  window.addEventListener(preferenceChanged, listener)
  window.addEventListener("storage", listener)
  window.addEventListener("focus", listener)
  return () => {
    window.removeEventListener(preferenceChanged, listener)
    window.removeEventListener("storage", listener)
    window.removeEventListener("focus", listener)
  }
}

const tones: Record<AlertKind, readonly number[]> = {
  NEW_CRITICAL: [480, 650],
  CRITICAL_RESOLVED: [520, 680],
  ASSIGNED_TO_COORDINATORS: [520],
  INVESTIGATION_ASSIGNED: [520],
}

function play(context: AudioContext, type: AlertKind) {
  tones[type].forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    const volume = context.createGain()
    const start = context.currentTime + index * 0.13
    oscillator.frequency.value = frequency
    volume.gain.setValueAtTime(0.001, start)
    volume.gain.exponentialRampToValueAtTime(0.12, start + 0.025)
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.12)
    oscillator.connect(volume).connect(context.destination)
    oscillator.onended = () => { oscillator.disconnect(); volume.disconnect() }
    oscillator.start(start)
    oscillator.stop(start + 0.13)
  })
}

export function useIncidentAlerts() {
  const alreadySeen = useRef(seenAlerts())
  const audio = useRef<AudioContext | null>(null)
  const muted = useSyncExternalStore(subscribePreferences, readMuted, () => true)
  const notifications = useSyncExternalStore(subscribePreferences, readNotificationPermission, () => "unavailable")
  const [toasts, setToasts] = useState<ToastEvent[]>([])

  const unlockAudio = useCallback(() => {
    if (typeof AudioContext === "undefined") return
    audio.current ??= new AudioContext()
    if (audio.current.state === "suspended") void audio.current.resume().catch(() => undefined)
  }, [])

  useEffect(() => () => {
    if (audio.current) void audio.current.close().catch(() => undefined)
    audio.current = null
  }, [])

  useEffect(() => {
    if (muted) return
    window.addEventListener("pointerdown", unlockAudio)
    window.addEventListener("keydown", unlockAudio)
    return () => {
      window.removeEventListener("pointerdown", unlockAudio)
      window.removeEventListener("keydown", unlockAudio)
    }
  }, [muted, unlockAudio])

  const toggleMute = useCallback(() => {
    const next = !readMuted()
    fallbackMuted = next
    if (!next) unlockAudio()
    try {
      localStorage.setItem(mutedKey, String(next))
    } catch {
      // --- STORAGE UNAVAILABLE ---
    }
    window.dispatchEvent(new Event(preferenceChanged))
  }, [unlockAudio])

  const enableNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") return
    try {
      await Notification.requestPermission()
    } catch {
      // --- NOTIFICATION UNAVAILABLE ---
    }
    window.dispatchEvent(new Event(preferenceChanged))
  }, [])

  const dismiss = useCallback((id: DiffEvent["id"]) => {
    setToasts((current) => current.filter((event) => event.id !== id))
  }, [])

  const onEvents = useCallback((events: DiffEvent[]) => {
    const fresh = events.filter((event): event is ToastEvent => {
      if (!isAlertKind(event.type) || alreadySeen.current.has(event.id)) return false
      alreadySeen.current.add(event.id)
      return true
    })
    if (!fresh.length) return
    setToasts((current) => [...current, ...fresh].slice(-4))
    if (!readMuted() && audio.current?.state === "running") {
      const mostUrgent = fresh.find((event) => event.type === "NEW_CRITICAL") ?? fresh[0]
      play(audio.current, mostUrgent.type)
    }

    if (!document.hidden || typeof Notification === "undefined" || Notification.permission !== "granted") return
    for (const event of fresh) {
      try {
        const notification = new Notification(alertKinds[event.type], {
          body: `${event.incidentCode} · ${event.product}\n${event.message}`.slice(0, 260),
          tag: String(event.id),
        })
        notification.onclick = () => { window.focus(); notification.close() }
      } catch {
        // --- NOTIFICATION UNAVAILABLE ---
      }
    }
  }, [])

  return { onEvents, toasts, dismiss, muted, toggleMute, notifications, enableNotifications }
}

type Alerts = ReturnType<typeof useIncidentAlerts>

export function IncidentAlertControls({ alerts }: { alerts: Alerts }) {
  return (
    <div className={styles.controls}>
      <button type="button" onClick={alerts.toggleMute}>
        {alerts.muted ? "Включить звук" : "Выключить звук"}
      </button>
      {alerts.notifications === "default" && (
        <button type="button" onClick={() => void alerts.enableNotifications()}>
          Включить уведомления
        </button>
      )}
    </div>
  )
}

function Toast({
  event,
  dismiss,
  open,
}: {
  event: ToastEvent
  dismiss: Alerts["dismiss"]
  open: (id: DiffEvent["incidentId"]) => void
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(event.id), 10_000)
    return () => window.clearTimeout(timer)
  }, [event.id, dismiss])

  return (
    <li className={styles.toast} data-kind={event.type}>
      <strong>{alertKinds[event.type]}</strong>
      <span>{event.incidentCode} · {event.product}</span>
      <p>{event.message}</p>
      <div className={styles.controls}>
        <button type="button" onClick={() => { open(event.incidentId); dismiss(event.id) }}>
          Открыть инцидент
        </button>
        <button type="button" onClick={() => dismiss(event.id)}>Закрыть</button>
      </div>
    </li>
  )
}

export function IncidentToastTray({
  alerts,
  onOpenIncident,
}: {
  alerts: Alerts
  onOpenIncident: (id: DiffEvent["incidentId"]) => void
}) {
  return (
    <ul className={styles.tray} aria-label="Оповещения об инцидентах" aria-live="polite">
      {alerts.toasts.map((event) => (
        <Toast key={event.id} event={event} dismiss={alerts.dismiss} open={onOpenIncident} />
      ))}
    </ul>
  )
}
