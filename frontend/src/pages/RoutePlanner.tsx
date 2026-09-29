import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { ParkingMap } from '../components/ParkingMap'
import { useApp } from '../context/AppContext'
import type { RoutePlanResult } from '../types'

export function RoutePlanner() {
  const { parkings, loading } = useApp()
  const [startSlug, setStartSlug] = useState('')
  const [endSlug, setEndSlug] = useState('')
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<RoutePlanResult | null>(null)

  const startParking = useMemo(() => parkings.find((p) => p.slug === startSlug) ?? null, [parkings, startSlug])
  const endParking = useMemo(() => parkings.find((p) => p.slug === endSlug) ?? null, [parkings, endSlug])

  useEffect(() => {
    if (parkings.length === 0) return
    if (!startSlug) {
      const fallback = parkings.find((p) => /sint-pieters|dok/i.test(p.name)) ?? parkings[0]
      setStartSlug(fallback.slug)
    }
    if (!endSlug) {
      const fallback = parkings.find((p) => /gravensteen|korenmarkt|brug|mergel/i.test(p.name)) ?? parkings[parkings.length - 1]
      setEndSlug(fallback.slug)
    }
  }, [parkings, startSlug, endSlug])

  const routeOverlay = useMemo(() => {
    if (!route || !startParking || !endParking) return null
    return {
      start: { lat: startParking.lat, lon: startParking.lon, label: startParking.name },
      end: { lat: endParking.lat, lon: endParking.lon, label: endParking.name },
      mode: 'car' as const,
      points: route.coordinates.map(([lon, lat]) => ({ lat, lon })),
    }
  }, [route, startParking, endParking])

  async function handlePlan() {
    if (!startParking || !endParking) {
      setError('Kies eerst een start- en eindpunt.')
      return
    }
    if (startParking.slug === endParking.slug) {
      setError('Kies twee verschillende locaties.')
      return
    }

    setPlanning(true)
    setError(null)

    try {
      const result = await api.routePlan({
        startLat: startParking.lat,
        startLon: startParking.lon,
        endLat: endParking.lat,
        endLon: endParking.lon,
        mode: 'car',
      })
      setRoute(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'De route kon niet worden berekend.')
    } finally {
      setPlanning(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Routeplanner</h1>
          <p>Route tussen parkeerlocaties uit de database van deze app. Eén route per keer, berekend met OpenRouteService.</p>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
            <label htmlFor="route-start">Start</label>
            <select id="route-start" className="input" value={startSlug} onChange={(e) => setStartSlug(e.target.value)} disabled={loading || parkings.length === 0}>
              {parkings.map((parking) => (
                <option key={parking.slug} value={parking.slug}>
                  {parking.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
            <label htmlFor="route-end">Eindpunt</label>
            <select id="route-end" className="input" value={endSlug} onChange={(e) => setEndSlug(e.target.value)} disabled={loading || parkings.length === 0}>
              {parkings.map((parking) => (
                <option key={parking.slug} value={parking.slug}>
                  {parking.name}
                </option>
              ))}
            </select>
          </div>

          <button className="btn btn-primary" onClick={handlePlan} disabled={planning || !startParking || !endParking || loading}>
            {planning ? 'Route berekenen…' : 'Route berekenen'}
          </button>
        </div>

        {error && <div className="banner" style={{ marginTop: 16 }}>{error}</div>}
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <ParkingMap
            parkings={parkings}
            basemap="grb"
            showLez={false}
            selected={null}
            route={routeOverlay}
          />
        </div>

        <div className="card">
          <h2>Routeoverzicht</h2>
          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">Start</span>
              <strong>{startParking?.name ?? '—'}</strong>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">Eind</span>
              <strong>{endParking?.name ?? '—'}</strong>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">Afstand</span>
              <strong>{route ? `${route.distanceKm.toFixed(1)} km` : '—'}</strong>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">Geschatte tijd</span>
              <strong>{route ? `${Math.round(route.durationMinutes)} min` : '—'}</strong>
            </div>
          </div>

          {!route && !planning && (
            <p className="note">Kies start en eindpunt en druk op “Route berekenen”.</p>
          )}
          {route && <p className="note">{route.routeSummary}</p>}
        </div>
      </div>
    </>
  )
}
