"use client"

import { useState } from "react"
import { IncidentAlertControls, IncidentToastTray, useIncidentAlerts } from "@/components/alerts/incidentAlerts"
import { useLiveIncidents } from "@/hooks/useLiveIncidents"

export default function AlertsPage() {
  const alerts = useIncidentAlerts()
  const { data, connectionState, isLoading, isError } = useLiveIncidents({ onEvents: alerts.onEvents })
  const [selectedId, setSelectedId] = useState<string>()
  const selected = data?.incidents.find((incident) => incident.id === selectedId)

  function openIncident(id: string) {
    setSelectedId(id)
    requestAnimationFrame(() => document.getElementById("incident-details")?.focus())
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Оповещения об инцидентах</h1>
          <p aria-live="polite" className="text-sm">
            {connectionState === "connected" ? "Поток событий подключён" : "Подключение к потоку событий…"}
          </p>
        </div>
        <IncidentAlertControls alerts={alerts} />
      </header>

      {selected && (
        <section id="incident-details" tabIndex={-1} className="space-y-2 rounded-xl border p-4">
          <h2 className="text-lg font-semibold">{selected.code} · {selected.title}</h2>
          <p>{selected.description}</p>
          <p>{selected.rawStatus} · {selected.assigneeTeam}</p>
          {/^https:\/\//i.test(selected.itsmUrl) && (
            <a href={selected.itsmUrl} className="underline" target="_blank" rel="noreferrer">
              Открыть в ITSM
            </a>
          )}
        </section>
      )}

      {isLoading && <p>Загрузка инцидентов…</p>}
      {isError && <p role="alert">Не удалось загрузить инциденты.</p>}
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Инциденты">
        {data?.incidents.map((incident) => (
          <li key={incident.id}>
            <button type="button" className="w-full rounded-xl border p-4 text-left"
              aria-pressed={selectedId === incident.id} onClick={() => openIncident(incident.id)}>
              <strong>{incident.code} · {incident.product}</strong>
              <span className="block text-sm">{incident.rawPriority} · {incident.rawStatus}</span>
            </button>
          </li>
        ))}
      </ul>

      <IncidentToastTray alerts={alerts} onOpenIncident={openIncident} />
    </main>
  )
}
