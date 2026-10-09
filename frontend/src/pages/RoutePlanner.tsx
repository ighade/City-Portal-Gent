import { useMemo, useState } from 'react'
import { api, ApiError } from '../api'
import { EzParkPanel } from '../components/EzParkPanel'
import type { EzOverlay } from '../components/EzParkPanel'
import { ParkingMap } from '../components/ParkingMap'
import { useRouteInputs } from '../components/RouteInputs'
import { useApp } from '../context/AppContext'
import type { RoutePlanResult } from '../types'

export function RoutePlanner() {
  const { parkings } = useApp()
  const [planning, setPlanning] = useState(false)
  const [showLez, setShowLez] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<RoutePlanResult | null>(null)
  const [ezOn, setEzOn] = useState(false)
  const [lezBlocked, setLezBlocked] = useState(false)
  const [ezOverlay, setEzOverlay] = useState<EzOverlay | null>(null)
  const [overviewEl, setOverviewEl] = useState<HTMLElement | null>(null)
  const [mapClick, setMapClick] = useState<{ lat: number; lon: number; n: number } | null>(null)

  const carParkings = useMemo(() => parkings.filter((p) => p.kind !== 'bicycle'), [parkings])
  const inputs = useRouteInputs(carParkings, mapClick)
  const { start, end } = inputs

  const routeOverlay = useMemo(() => {
    if (!route || !start || !end) return null
    return {
      start: { lat: start.lat, lon: start.lon, label: start.label },
      end: { lat: end.lat, lon: end.lon, label: end.label },
      mode: 'car' as const,
      points: route.coordinates.map(([lon, lat]) => ({ lat, lon })),
    }
  }, [route, start, end])

  const markerOverlay = useMemo<EzOverlay>(
    () => ({ start, end, legs: [], variant: null, parkingName: null, parks: [] }),
    [start, end],
  )

  const departAt = useMemo(
    () => new Date(Date.now() + inputs.departInMinutes() * 60000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route, inputs.departTime],
  )
  const arriveAt = route ? new Date(departAt.getTime() + route.durationMinutes * 60000) : null

  async function handlePlan() {
    if (!start || !end) {
      setError('Kies eerst een start- en eindpunt.')
      return
    }

    setPlanning(true)
    setError(null)
    setLezBlocked(false)

    try {
      const result = await api.routePlan({
        startLat: start.lat,
        startLon: start.lon,
        endLat: end.lat,
        endLon: end.lon,
        mode: 'car',
        checkLez: showLez,
      })
      setRoute(result)
    } catch (err) {
      setLezBlocked(err instanceof ApiError && err.code === 'lez')
      setError(err instanceof Error ? err.message : 'De route kon niet worden berekend.')
    } finally {
      setPlanning(false)
    }
  }

  function startEzPark() {
    setError(null)
    setLezBlocked(false)
    setEzOn(true)
  }

  const toggles = (<>
    <label className="toggle" title="Controleert in de backend of de route de LEZ raakt">
      <input type="checkbox" role="switch" checked={showLez} onChange={(e) => { setShowLez(e.target.checked); setError(null) }} />
      <span className="toggle-track" aria-hidden="true" />
      Lage-emissiezone
    </label>

    <label className="toggle" title="Rij naar een open parking en ga te voet of met het OV verder">
      <input type="checkbox" role="switch" checked={ezOn} onChange={(e) => (e.target.checked ? startEzPark() : setEzOn(false))} />
      <span className="toggle-track" aria-hidden="true" />
      EZ Park
    </label>
  </>)

  const time = (d: Date) => d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Routeplanner</h1>
          <p>Plan een route met de auto, of parkeer buiten de zone met EZ Park. Berekend met OpenRouteService.</p>
        </div>
      </div>

      <div className="card">
        {ezOn ? (
          <EzParkPanel
            avoidLez={showLez}
            start={start}
            end={end}
            departInMinutes={inputs.departInMinutes}
            fields={inputs.fields}
            toggles={toggles}
            overviewEl={overviewEl}
            hint={inputs.hint}
            onOverlay={setEzOverlay}
          />
        ) : (<>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {inputs.fields}

            {toggles}

            <button className="btn btn-primary" style={{ minWidth: 150, whiteSpace: 'nowrap' }} onClick={handlePlan} disabled={planning || !start || !end}>
              {planning ? 'Route berekenen…' : 'Route berekenen'}
            </button>
          </div>

          {inputs.hint && <p className="note">{inputs.hint}</p>}
          {error && <div className="banner" style={{ marginTop: 16 }}>{error}</div>}
          {lezBlocked && (
            <div className="banner" style={{ marginTop: 16 }}>
              Deze route komt in de LEZ. Wil je EZ Park gebruiken: parkeer buiten de zone en ga verder te voet of met het OV?
              <button className="btn btn-primary" style={{ marginLeft: 12 }} onClick={startEzPark}>Gebruik EZ Park</button>
            </div>
          )}
        </>)}
        {inputs.locateError && !start && <div className="banner" style={{ marginTop: 16 }}>{inputs.locateError}</div>}
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <ParkingMap
            parkings={ezOn ? [] : carParkings}
            bluePins
            basemap="grb"
            showLez={showLez}
            selected={null}
            route={ezOn ? null : routeOverlay}
            onMapClick={(lat, lon) => setMapClick({ lat, lon, n: Date.now() })}
            ezpark={ezOn ? ezOverlay : markerOverlay}
          />
        </div>

        <div className="card">
          <h2>Routeoverzicht</h2>
          {ezOn ? (
            <div ref={setOverviewEl} />
          ) : (<>
            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Start</span>
                <strong>{start?.label ?? '—'}</strong>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Eind</span>
                <strong>{end?.label ?? '—'}</strong>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Vertrek</span>
                <strong>{route ? time(departAt) : '—'}</strong>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Aankomst</span>
                <strong>{arriveAt ? time(arriveAt) : '—'}</strong>
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
              <p className="note">Kies start en bestemming en druk op “Route berekenen”.</p>
            )}
            {route && <p className="note">{route.routeSummary}</p>}
            {route?.lezWarning && <p className="note">{route.lezWarning}</p>}
          </>)}
        </div>
      </div>
    </>
  )
}
