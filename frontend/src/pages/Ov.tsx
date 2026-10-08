import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { TransitMap } from '../components/TransitMap'
import type { TransitRouteResult, TransitStatus, TransitStop, TransitStopRealtime } from '../types'

export function Ov() {
  const [stops, setStops] = useState<TransitStop[]>([])
  const [status, setStatus] = useState<TransitStatus | null>(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [route, setRoute] = useState<TransitRouteResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedStop, setSelectedStop] = useState<TransitStop | null>(null)
  const [stopRealtime, setStopRealtime] = useState<TransitStopRealtime | null>(null)
  const [stopLoading, setStopLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.transit.stops(), api.transit.status()])
      .then(([loadedStops, loadedStatus]) => {
        if (cancelled) return
        setStops(loadedStops)
        setStatus(loadedStatus)
        const preferredStart = loadedStops.find((stop) => /sint-pietersstation|sint-pieters/i.test(stop.name))
        const preferredEnd = loadedStops.find((stop) => /korenmarkt|gravensteen/i.test(stop.name))
        setStart(preferredStart?.name ?? loadedStops[0]?.name ?? '')
        setEnd(preferredEnd?.name ?? loadedStops[loadedStops.length - 1]?.name ?? '')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'De OV-gegevens konden niet worden opgehaald.'))
      .finally(() => setLoading(false))
    return () => { cancelled = true }
  }, [])

  const names = useMemo(() => stops.map((stop) => stop.name), [stops])

  async function selectStop(stop: TransitStop) {
    setSelectedStop(stop)
    setStopRealtime(null)
    setStopLoading(true)
    setError(null)
    try {
      setStopRealtime(await api.transit.stopRealtime(stop.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'De realtime haltegegevens konden niet worden opgehaald.')
    } finally {
      setStopLoading(false)
    }
  }

  function findStop(value: string): TransitStop | undefined {
    return stops.find((stop) => stop.name.toLocaleLowerCase('nl-BE') === value.trim().toLocaleLowerCase('nl-BE'))
      ?? stops.find((stop) => stop.id === value.trim())
  }

  async function planRoute() {
    const from = findStop(start)
    const to = findStop(end)
    if (!from || !to) {
      setError('Kies een geldige halte uit de lijst voor vertrek en bestemming.')
      return
    }
    if (from.id === to.id) {
      setError('Kies twee verschillende haltes.')
      return
    }
    setPlanning(true)
    setError(null)
    setRoute(null)
    try {
      setRoute(await api.transit.route({ startLat: from.lat, startLon: from.lon, endLat: to.lat, endLon: to.lon }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Geen OV-route gevonden.')
    } finally {
      setPlanning(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Openbaar vervoer</h1>
          <p>De Lijn-haltes in Gent, met de actuele dienstregeling en realtime vertragingen waar beschikbaar.</p>
        </div>
        {status && (
          <span className="small muted">
            {status.stopCount.toLocaleString('nl-BE')} haltes · realtime {status.realtimeUpdatedAtUtc ? 'bijgewerkt' : 'niet beschikbaar'}
          </span>
        )}
      </div>

      {error && <div className="banner" role="alert">{error}</div>}

      <div className="ov-layout">
        <section className="card ov-map-card">
          <TransitMap stops={stops} route={route} selectedStopId={selectedStop?.id} onStopClick={selectStop} />
        </section>

        <aside className="ov-panel">
          <section className="card">
            <div className="card-title">
              <h2>Plan met het OV</h2>
              {loading && <span className="small muted">Haltes laden…</span>}
            </div>
            <div className="ov-form">
              <label>
                Vertrek
                <input className="input" list="transit-stops" value={start} onChange={(event) => { setStart(event.target.value); setError(null) }} placeholder="Zoek een halte" disabled={loading || planning} />
              </label>
              <label>
                Bestemming
                <input className="input" list="transit-stops" value={end} onChange={(event) => { setEnd(event.target.value); setError(null) }} placeholder="Zoek een halte" disabled={loading || planning} />
              </label>
              <datalist id="transit-stops">
                {names.map((name, index) => <option key={`${name}-${index}`} value={name} />)}
              </datalist>
              <button className="btn btn-primary" onClick={planRoute} disabled={loading || planning || stops.length === 0}>
                {planning ? 'Route zoeken…' : 'Plan OV-route'}
              </button>
            </div>
          </section>

          {route ? <RouteSummary route={route} /> : (
            <section className="card ov-empty">
              <strong>Alle haltes staan op de kaart.</strong>
              <p className="note">Kies vertrek en bestemming om een route met wandelen, bus of tram te zien.</p>
            </section>
          )}
          {selectedStop && <StopRealtimePanel stop={selectedStop} realtime={stopRealtime} loading={stopLoading} />}
        </aside>
      </div>
    </>
  )
}

function StopRealtimePanel({ stop, realtime, loading }: { stop: TransitStop; realtime: TransitStopRealtime | null; loading: boolean }) {
  return (
    <section className="card ov-stop-panel">
      <div className="card-title">
        <h2>{stop.name}</h2>
        {loading && <span className="small muted">Realtime laden…</span>}
      </div>
      {!loading && realtime && (
        realtime.departures.length === 0
          ? <p className="note">Geen geplande vertrekken in de komende twee uur.</p>
          : <div className="ov-departures">
            {realtime.departures.map((departure, index) => (
              <div className="ov-departure" key={`${departure.line}-${departure.expectedAt}-${index}`}>
                <span className={`ov-mode ov-mode-${departure.mode}`}>{departure.mode === 'tram' ? 'T' : 'B'}</span>
                <strong>{departure.line}</strong>
                <span className="ov-departure-destination">{departure.destination}</span>
                <time>{formatTime(departure.expectedAt)}</time>
                {departure.delayMinutes > 0 && <span className="small muted">+{departure.delayMinutes} min</span>}
              </div>
            ))}
          </div>
      )}
    </section>
  )
}

function RouteSummary({ route }: { route: TransitRouteResult }) {
  return (
    <section className="card">
      <div className="card-title">
        <h2>Jouw route</h2>
        <span className="pill pill-green">{route.summary}</span>
      </div>
      <div className="ov-route-meta">
        <span>Vertrek <b>{formatTime(route.departureAt)}</b></span>
        <span>Aankomst <b>{formatTime(route.arrivalAt)}</b></span>
      </div>
      <div className="ov-legs">
        {route.legs.map((leg, index) => (
          <div className="ov-leg" key={`${leg.from}-${leg.to}-${index}`}>
            <span className={`ov-mode ov-mode-${leg.mode}`} aria-hidden="true">{leg.mode === 'walk' ? '↗' : leg.mode === 'tram' ? 'T' : 'B'}</span>
            <div>
              <strong>{leg.mode === 'walk' ? 'Wandelen' : `${leg.mode === 'tram' ? 'Tram' : 'Bus'} ${leg.line ?? ''}`}</strong>
              <div className="small muted">{leg.from} → {leg.to}</div>
              <div className="small">{formatTime(leg.departureAt)}–{formatTime(leg.arrivalAt)} · {leg.distanceKm.toFixed(1)} km{leg.delayMinutes > 0 ? ` · +${leg.delayMinutes} min` : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
}
