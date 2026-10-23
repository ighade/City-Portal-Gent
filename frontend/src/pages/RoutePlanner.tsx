import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, ApiError } from '../api'
import { EzParkPanel } from '../components/EzParkPanel'
import { GarageRate, ManualRateInfo, StreetRate } from '../components/RateInfo'
import type { EzOverlay } from '../components/EzParkPanel'
import { ParkingMap, textOn } from '../components/ParkingMap'
import { transitFareLabel } from '../fare'
import { locatePlace } from '../eventGeo'
import type { MapEvent } from '../components/ParkingMap'
import { Fact } from '../components/ParkingInfo'
import { useRouteInputs } from '../components/RouteInputs'
import type { RoutePoint } from '../components/RouteInputs'
import { useApp } from '../context/AppContext'
import type { EzParkLeg, Friend, GentEvent, RoutePlanResult, TransitRouteResult } from '../types'

type Mode = 'foot' | 'bike' | 'car' | 'transit'

const MODES: Array<{ key: Mode; label: string; icon: string }> = [
  { key: 'foot', label: 'Te voet', icon: 'M13 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 21l2-6-2-2 1-5 3 2 2 3M11 13l-3 1' },
  { key: 'bike', label: 'Fiets', icon: 'M5.5 18.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 18.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12 18.5l-2-7h7M10 11.5 8 7H6M14 7h2' },
  { key: 'car', label: 'Auto', icon: 'M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 13h.01M17 13h.01' },
  { key: 'transit', label: 'OV', icon: 'M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM4 11h16M8 21l1.5-4M16 21l-1.5-4M8 14h.01M16 14h.01' },
]

const API_MODE = { foot: 'foot-walking', bike: 'cycling-regular', car: 'car' } as const
const MODE_LABEL: Record<Mode, string> = { foot: 'Te voet', bike: 'Fiets', car: 'Auto', transit: 'OV' }

function ModePicker({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="mode-picker" role="radiogroup" aria-label="Vervoermiddel">
      {MODES.map((m) => (
        <label key={m.key} className="mode-option">
          <input type="radio" name="route-mode" value={m.key} checked={value === m.key} onChange={() => onChange(m.key)} />
          <span className="mode-chip">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={m.icon} /></svg>
            {m.label}
          </span>
        </label>
      ))}
    </div>
  )
}

export function RoutePlanner() {
  const { parkings } = useApp()
  const [planning, setPlanning] = useState(false)
  const [showLez, setShowLez] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<RoutePlanResult | null>(null)
  const [transitRoute, setTransitRoute] = useState<TransitRouteResult | null>(null)
  const [mode, setMode] = useState<Mode>('foot')
  const [ezOn, setEzOn] = useState(false)
  const [lezBlocked, setLezBlocked] = useState(false)
  const [ezOverlay, setEzOverlay] = useState<EzOverlay | null>(null)
  const [overviewEl, setOverviewEl] = useState<HTMLElement | null>(null)
  const [mapClick, setMapClick] = useState<{ lat: number; lon: number; n: number } | null>(null)
  const [ezPick, setEzPick] = useState<{ slug: string; n: number } | null>(null)

  const carParkings = useMemo(() => parkings.filter((p) => p.kind !== 'bicycle'), [parkings])
  // Parkings staan alleen op de kaart als EZ Park aan staat; de parkings uit het EZ Park-voorstel
  // hebben al een eigen P-speld, dus die tekenen we hier niet dubbel.
  const mapParkings = useMemo(() => {
    const proposed = new Set((ezOverlay?.parks ?? []).map((k) => k.slug))
    return carParkings.filter((c) => !proposed.has(c.slug))
  }, [carParkings, ezOverlay])
  const weekEvents = useWeekEvents()
  const friendsOnMap = useFriendsOnMap()
  const inputs = useRouteInputs(carParkings, mapClick)
  const { start, end } = inputs

  // Komt de bezoeker van een evenement, dan staat de bestemming al ingevuld.
  const incoming = (useLocation().state as { destination?: { place: string; name: string } } | null)?.destination
  const chooseEnd = useRef(inputs.chooseEnd)
  chooseEnd.current = inputs.chooseEnd
  useEffect(() => {
    if (!incoming) return
    let cancelled = false
    void locatePlace(incoming.place).then((at) => {
      if (at && !cancelled) chooseEnd.current({ lat: at.lat, lon: at.lon, label: incoming.name })
    })
    return () => { cancelled = true }
  }, [incoming?.place, incoming?.name])

  const routeOverlay = useMemo(() => {
    if (!route || !start || !end) return null
    return {
      start: { lat: start.lat, lon: start.lon, label: start.label },
      end: { lat: end.lat, lon: end.lon, label: end.label },
      mode: route.mode,
      points: route.coordinates.map(([lon, lat]) => ({ lat, lon })),
    }
  }, [route, start, end])

  const transitOverlay = useMemo<EzOverlay | null>(() => {
    if (!transitRoute || !start || !end) return null
    const legs: EzParkLeg[] = transitRoute.legs.map((l) => ({
      mode: l.mode,
      line: l.line,
      from: l.from,
      to: l.to,
      departureAt: l.departureAt,
      arrivalAt: l.arrivalAt,
      distanceKm: l.distanceKm,
      coordinates: l.coordinates,
      color: l.color,
    }))
    return { start, end, legs, variant: null, parkingName: null, parks: [] }
  }, [transitRoute, start, end])

  const markerOverlay = useMemo<EzOverlay>(
    () => ({ start, end, legs: [], variant: null, parkingName: null, parks: [] }),
    [start, end],
  )

  function changeMode(next: Mode) {
    setMode(next)
    setRoute(null)
    setTransitRoute(null)
    setError(null)
    setLezBlocked(false)
    setEzOn(next === 'car')
  }

  const departAt = useMemo(
    () => new Date(Date.now() + inputs.departInMinutes() * 60000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route, inputs.departTime],
  )
  const arriveAt = route ? new Date(departAt.getTime() + route.durationMinutes * 60000) : null

  async function handlePlan(target?: RoutePoint) {
    setPlanning(true)
    setError(null)
    setLezBlocked(false)

    try {
      const [from, dest] = await Promise.all([inputs.resolveStart(), target ?? inputs.resolveEnd()])
      if (mode === 'transit') {
        setRoute(null)
        setTransitRoute(null)
        setTransitRoute(await api.transit.route({ startLat: from.lat, startLon: from.lon, endLat: dest.lat, endLon: dest.lon }))
        return
      }
      const result = await api.routePlan({
        startLat: from.lat,
        startLon: from.lon,
        endLat: dest.lat,
        endLon: dest.lon,
        mode: API_MODE[mode],
        checkLez: mode === 'car' && showLez,
      })
      setRoute(result)
    } catch (err) {
      setLezBlocked(mode === 'car' && err instanceof ApiError && err.code === 'lez')
      setError(err instanceof Error ? err.message : 'De route kon niet worden berekend.')
    } finally {
      setPlanning(false)
    }
  }

  function pickEvent(item: MapEvent) {
    const point = { lat: item.lat, lon: item.lon, label: item.event.name }
    inputs.chooseEnd(point)
    if (!ezOn && inputs.hasStart) void handlePlan(point)
  }

  function startEzPark() {
    setError(null)
    setLezBlocked(false)
    setEzOn(true)
  }

  const toggles = mode !== 'car' ? null : (<>
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
    <div className="route-stage">
      <div className="route-map">
          <ParkingMap
            parkings={ezOn ? mapParkings : []}
            bluePins
            basemap="grb"
            showLez={showLez}
            selected={null}
            hoverInfo
            events={weekEvents}
            friends={friendsOnMap}
            onEventPick={pickEvent}
            onEzParkPick={(slug) => setEzPick({ slug, n: Date.now() })}
            route={ezOn ? null : routeOverlay}
            onMapClick={(lat, lon) => setMapClick({ lat, lon, n: Date.now() })}
            ezpark={ezOn ? ezOverlay : (mode === 'transit' && transitOverlay) || markerOverlay}
          />
      </div>

      <div className="card route-form">
        <h1 className="route-title">Routeplanner</h1>
        <ModePicker value={mode} onChange={changeMode} />
        {ezOn ? (
          <EzParkPanel
            avoidLez={showLez}
            start={start}
            end={end}
            canPlan={inputs.hasStart && inputs.hasEnd}
            resolveStart={inputs.resolveStart}
            resolveEnd={inputs.resolveEnd}            departInMinutes={inputs.departInMinutes}
            fields={inputs.fields}
            toggles={toggles}
            overviewEl={overviewEl}
            hint={inputs.hint}
            onOverlay={setEzOverlay}
            pick={ezPick}
          />
        ) : (<>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {inputs.fields}

            {toggles}

            <button className="btn btn-primary" style={{ minWidth: 150, whiteSpace: 'nowrap' }} onClick={() => handlePlan()} disabled={planning || !inputs.hasStart || !inputs.hasEnd}>
              {planning ? 'Route berekenen…' : 'Route berekenen'}
            </button>
          </div>

          {inputs.hint && <p className="note">{inputs.hint}</p>}
          {error && !lezBlocked && <div className="banner" style={{ marginTop: 16 }}>{error}</div>}
          {lezBlocked && (
            <div className="banner" style={{ marginTop: 16 }}>
              Deze route komt in de LEZ. Wil je EZ Park gebruiken: parkeer buiten de zone en ga verder te voet of met het OV?
              <button className="btn btn-primary" style={{ marginLeft: 12 }} onClick={startEzPark}>Gebruik EZ Park</button>
            </div>
          )}
        </>)}
        {inputs.locateError && !start && <div className="banner" style={{ marginTop: 16 }}>{inputs.locateError}</div>}
      </div>

      <div className="card route-overview">
          <h2>Routeoverzicht</h2>
          {ezOn ? (
            <div ref={setOverviewEl} />
          ) : (<>
            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              <Fact label="Start">{start?.label ?? '—'}</Fact>
              <Fact label="Eind">{end?.label ?? '—'}</Fact>
              <Fact label="Vervoer">{MODE_LABEL[mode]}</Fact>
              <Fact label="Vertrek">{transitRoute ? time(new Date(transitRoute.departureAt)) : route ? time(departAt) : '—'}</Fact>
              <Fact label="Aankomst">{transitRoute ? time(new Date(transitRoute.arrivalAt)) : arriveAt ? time(arriveAt) : '—'}</Fact>
              <Fact label="Afstand">{transitRoute ? `${transitRoute.distanceKm.toFixed(1)} km` : route ? `${route.distanceKm.toFixed(1)} km` : '—'}</Fact>
              {transitRoute && transitFareLabel(transitRoute.legs) && <Fact label="Ticketprijs">{transitFareLabel(transitRoute.legs)} <span className="small muted">(overstappen inbegrepen)</span></Fact>}
              <Fact label="Geschatte tijd">{transitRoute ? `${Math.round(transitRoute.durationMinutes)} min` : route ? `${Math.round(route.durationMinutes)} min` : '—'}</Fact>
            </div>

            {transitRoute && (
              <div className="ov-legs" style={{ marginTop: 12 }}>
                {transitRoute.legs.map((leg, i) => (
                  <div className="ov-leg" key={`${leg.from}-${leg.to}-${i}`}>
                    <span className={`ov-mode ov-mode-${leg.mode}`} style={leg.color ? { background: `#${leg.color}`, color: textOn(leg.color) } : undefined} aria-hidden="true">{leg.mode === 'walk' ? '↗' : leg.line ?? (leg.mode === 'tram' ? 'T' : 'B')}</span>
                    <div>
                      <strong>{leg.mode === 'walk' ? 'Wandelen' : `${leg.mode === 'tram' ? 'Tram' : 'Bus'} ${leg.line ?? ''}`}</strong>
                      <div className="small muted">{leg.from} → {leg.to}</div>
                      <div className="small">{time(new Date(leg.departureAt))}–{time(new Date(leg.arrivalAt))} · {leg.distanceKm.toFixed(1)} km</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!route && !transitRoute && !planning && (
              <p className="note">Kies start en bestemming en druk op “Route berekenen”.</p>
            )}
            {route && <p className="note">{route.routeSummary}</p>}
            {transitRoute && <p className="note">{transitRoute.summary}</p>}
            {route?.lezWarning && <p className="note">{route.lezWarning}</p>}
            {route?.destinationGarage && (
              <div style={{ marginTop: 16 }}>
                <h3>Tarief {route.destinationGarage.name}</h3>
                {route.destinationGarage.manualRate
                  ? <ManualRateInfo rate={route.destinationGarage.manualRate} />
                  : <GarageRate rate={route.destinationGarage.rate ?? undefined} />}
              </div>
            )}
            {route?.destinationParking && <StreetRate info={route.destinationParking} arrival={arriveAt} />}
          </>)}
      </div>
    </div>
  )
}

/** Vrienden met locatie, alleen als je bent aangemeld en "toon op routekaart" aanstaat; ververst elke 30 seconden. */
function useFriendsOnMap(): Friend[] {
  const [friends, setFriends] = useState<Friend[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const tick = async () => {
      try {
        const { user } = await api.friends.me()
        if (!user.showFriendsOnMap) {
          if (!cancelled) setFriends([])
        } else {
          const overview = await api.friends.overview()
          if (!cancelled) setFriends(overview.friends.filter((f) => f.lat != null && f.lon != null))
        }
      } catch {
        // niet aangemeld of offline: dan is er niets te tonen
        if (!cancelled) setFriends([])
      }
      if (!cancelled) timer = window.setTimeout(tick, 30_000)
    }
    void tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  return friends
}

/** Evenementen van de komende 7 dagen, met coördinaat uit de Vlaamse geolocatie (onthouden in localStorage). */
function useWeekEvents(): MapEvent[] {
  const [items, setItems] = useState<MapEvent[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let events: GentEvent[]
      try {
        events = await api.events()
      } catch {
        return
      }
      const now = Date.now()
      const weekAhead = now + 7 * 24 * 3600 * 1000
      const thisWeek = events.filter((e) => {
        if (e.isPast || e.isOnline || !e.place) return false
        if (e.isHappeningNow) return true
        const t = e.startsAtUtc ? new Date(e.startsAtUtc).getTime() : NaN
        return t >= now - 3 * 3600 * 1000 && t <= weekAhead
      })

      const found: MapEvent[] = []
      for (const e of thisWeek) {
        const at = await locatePlace(e.place!)
        if (cancelled) return
        if (at) {
          found.push({ event: e, lat: at.lat, lon: at.lon })
          setItems([...found])
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  return items
}
