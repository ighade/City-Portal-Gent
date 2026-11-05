import { useEffect, useState } from 'react'
import { api } from '../api'
import type { TransitDeparture, TransitDeparturesResult } from '../types'
import { textOn } from './ParkingMap'

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })

export function DepartureTimes({ d }: { d: TransitDeparture }) {
  if (d.canceled) {
    return <span className="dep-times"><s className="dep-sched">{hhmm(d.scheduledAt)}</s> <span className="dep-badge dep-badge-cancel">Geschrapt</span></span>
  }
  if (d.delayMinutes >= 2) {
    return <span className="dep-times"><s className="dep-sched">{hhmm(d.scheduledAt)}</s> <strong>{hhmm(d.expectedAt)}</strong> <span className="dep-badge dep-badge-late">+{d.delayMinutes} min</span></span>
  }
  return <span className="dep-times"><strong>{hhmm(d.expectedAt)}</strong></span>
}

export function TransitDeparturesPanel({ stopId, stopName, onClose }: { stopId: string; stopName: string; onClose: () => void }) {
  const [data, setData] = useState<TransitDeparturesResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    const load = () => api.transit.departures(stopId)
      .then((r) => { if (alive) { setData(r); setError(null) } })
      .catch(() => { if (alive) setError('Vertrektijden konden niet geladen worden.') })
    load()
    const timer = window.setInterval(load, 30000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [stopId])

  return (
    <div className="dep-panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Volgende vertrekken · {data?.stopName ?? stopName}</strong>
        <button type="button" className="btn" onClick={onClose} aria-label="Sluiten">✕</button>
      </div>
      {error && <div className="banner">{error}</div>}
      {!data && !error && <p className="note">Laden…</p>}
      {data && !data.realtimeAvailable && <p className="note">Live vertragingen zijn momenteel niet beschikbaar; dit zijn de geplande uren.</p>}
      {data && data.departures.length === 0 && <p className="note">Geen vertrekken in de komende uren.</p>}
      {data?.departures.map((d, i) => (
        <div key={`${d.line}-${d.scheduledAt}-${i}`} className={`dep-row${d.canceled ? ' dep-cancelled' : ''}`}>
          <span className={`ov-mode ov-mode-${d.mode}`} style={d.color && d.color !== 'FFFFFF' ? { background: `#${d.color}`, color: textOn(d.color) } : undefined}>{d.line}</span>
          <span className="dep-dest">{d.destination ?? ''}</span>
          <DepartureTimes d={d} />
        </div>
      ))}
    </div>
  )
}
