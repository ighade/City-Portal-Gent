import { useEffect, useMemo, useState } from 'react'
import { fetchNearbyChargingStations, formatDistance } from '../chargingStations'
import type { ChargingStation } from '../chargingStations'
import './ChargingStationsPanel.css'

interface Props {
  destination: { lat: number; lon: number } | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  onShownChange: (stations: ChargingStation[]) => void
  onRouteTo: (station: ChargingStation) => void
}

export function ChargingStationsPanel({ destination, selectedId, onSelect, onShownChange, onRouteTo }: Props) {
  const [stations, setStations] = useState<ChargingStation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Er is geen live bezetting beschikbaar; de gebruiker kan een paal zelf als bezet markeren.
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const lat = destination?.lat
  const lon = destination?.lon

  useEffect(() => {
    setBusy(new Set())
    if (lat === undefined || lon === undefined) { setStations([]); return }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchNearbyChargingStations(lat, lon, 15, controller.signal)
      .then(setStations)
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Laadpalen konden niet worden geladen.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [lat, lon])

  const shown = useMemo(() => stations.filter((s) => !busy.has(s.id)).slice(0, 5), [stations, busy])

  useEffect(() => {
    onShownChange(shown)
    if (selectedId && !shown.some((s) => s.id === selectedId)) onSelect(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])

  // Bij het verlaten van het paneel verdwijnen de laadpalen ook van de kaart.
  useEffect(() => () => { onShownChange([]); onSelect(null) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="charging-panel">
      <strong>Laadpalen bij je bestemming</strong>
      {!destination && <p className="note">Kies eerst een bestemming.</p>}
      {loading && <p className="note">Laadpalen laden…</p>}
      {error && <div className="banner">{error}</div>}
      {!loading && !error && destination && shown.length === 0 && <p className="note">Geen laadpalen gevonden.</p>}
      {shown.map((s, i) => (
        <div key={s.id} className={`charging-item${i === 0 ? ' nearest' : ''}${s.id === selectedId ? ' selected' : ''}`} onClick={() => onSelect(s.id)}>
          <span>
            {s.street} · {formatDistance(s.distanceMeters)}
            <small>{[s.operator, s.type, s.kw ? `${s.kw} kW` : null, s.location].filter(Boolean).join(' · ')}</small>
          </span>
          <span className="charging-actions">
            <button type="button" className="btn btn-primary" onClick={() => onRouteTo(s)}>Route hierheen</button>
            <button type="button" className="btn" onClick={() => setBusy(new Set(busy).add(s.id))}>Bezet</button>
          </span>
        </div>
      ))}
      {stations.length > 0 && <p className="note">Live bezetting is niet beschikbaar. Markeer een paal als bezet om de volgende dichtstbijzijnde te zien.</p>}
    </div>
  )
}
