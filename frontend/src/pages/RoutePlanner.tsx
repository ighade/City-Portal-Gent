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
import { distanceMeters, fetchRentalBikes, openRentalBike, RENTAL_BIKE_ICONS, RENTAL_TARIFF_LABEL, rentalCostLabel } from '../rentalBikes'
import type { RentalBike } from '../rentalBikes'
import { GENT_BOUNDS, GENT_CENTER } from '../leaflet'
import { useRouteInputs } from '../components/RouteInputs'
import type { RoutePoint } from '../components/RouteInputs'
import { useApp } from '../context/AppContext'
import type { EzParkLeg, Friend, GentEvent, RoutePlanResult, TransitRouteResult, TransitStop } from '../types'
import { TransitDeparturesPanel } from '../components/TransitDepartures'

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
  const planRun = useRef(0)
  // Met een gekozen deelfiets: eerst te voet naar de fiets (walk), daarna met de fiets naar de bestemming (ride).
  const [bikeTrip, setBikeTrip] = useState<{ walk: RoutePlanResult; ride: RoutePlanResult } | null>(null)
  const [showLez, setShowLez] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<RoutePlanResult | null>(null)
  const [transitRoute, setTransitRoute] = useState<TransitRouteResult | null>(null)
  const [mode, setMode] = useState<Mode>('foot')
  const [transitStops, setTransitStops] = useState<TransitStop[]>([])
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [ezOn, setEzOn] = useState(false)
  const [lezBlocked, setLezBlocked] = useState(false)
  const [ezOverlay, setEzOverlay] = useState<EzOverlay | null>(null)
  const [overviewEl, setOverviewEl] = useState<HTMLElement | null>(null)
  const [mapClick, setMapClick] = useState<{ lat: number; lon: number; n: number } | null>(null)
  const [showRentalBikes, setShowRentalBikes] = useState(true)
  const [rentalBikes, setRentalBikes] = useState<RentalBike[]>([])
  const [rentalLoading, setRentalLoading] = useState(false)
  const [rentalError, setRentalError] = useState<string | null>(null)
  const [rentalSelected, setRentalSelected] = useState<string | null>(null)
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null)
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
      points: (bikeTrip ? bikeTrip.ride : route).coordinates.map(([lon, lat]) => ({ lat, lon })),
      walkPoints: bikeTrip?.walk.coordinates.map(([lon, lat]) => ({ lat, lon })),
    }
  }, [route, bikeTrip, start, end])

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

  const rentalActive = mode === 'bike' && showRentalBikes

  useEffect(() => {
    if (mode !== 'transit') { setSelectedStopId(null); return }
    if (transitStops.length > 0) return
    let alive = true
    api.transit.stops().then((s) => { if (alive) setTransitStops(s) }).catch(() => {})
    return () => { alive = false }
  }, [mode, transitStops.length])

  const selectedStop = transitStops.find((s) => s.id === selectedStopId) ?? null

  useEffect(() => {
    if (!rentalActive) return
    const controller = new AbortController()
    setRentalLoading(true)
    setRentalError(null)
    fetchRentalBikes(controller.signal)
      .then(setRentalBikes)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setRentalError(e instanceof Error ? e.message : 'Deelfietsen konden niet worden geladen.')
      })
      .finally(() => { if (!controller.signal.aborted) setRentalLoading(false) })
    return () => controller.abort()
  }, [rentalActive])

  useEffect(() => {
    if (!rentalActive || userPos || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords
        const [[south, west], [north, east]] = GENT_BOUNDS
        if (lat >= south && lat <= north && lon >= west && lon <= east) setUserPos({ lat, lon })
      },
      () => undefined,
      { timeout: 8000 },
    )
  }, [rentalActive, userPos])

  const rentalOrigin = userPos ?? (start ? { lat: start.lat, lon: start.lon } : { lat: GENT_CENTER[0], lon: GENT_CENTER[1] })
  const rentalOriginLabel = userPos ? 'je locatie' : start ? 'je route-start' : 'Gent centrum'
  const nearbyBikes = useMemo(
    () => rentalBikes
      .map((bike) => ({ bike, distance: distanceMeters(rentalOrigin, bike) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rentalBikes, rentalOrigin.lat, rentalOrigin.lon],
  )
  const selectedBike = rentalBikes.find((b) => b.id === rentalSelected) ?? null

  function changeMode(next: Mode) {
    setMode(next)
    setRentalSelected(null)
    setRoute(null)
    setBikeTrip(null)
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
  const rideMinutes = bikeTrip ? bikeTrip.ride.durationMinutes : route?.durationMinutes
  const arriveAt = route ? new Date(departAt.getTime() + route.durationMinutes * 60000) : null

  async function handlePlan(target?: RoutePoint) {
    const run = ++planRun.current
    setPlanning(true)
    setError(null)
    setLezBlocked(false)

    try {
      const [from, dest] = await Promise.all([inputs.resolveStart(), target ?? inputs.resolveEnd()])
      if (mode === 'transit') {
        setRoute(null)
        setBikeTrip(null)
        setTransitRoute(null)
        const transit = await api.transit.route({ startLat: from.lat, startLon: from.lon, endLat: dest.lat, endLon: dest.lon })
        if (run === planRun.current) setTransitRoute(transit)
        return
      }
      const bike = mode === 'bike' && rentalActive ? rentalBikes.find((b) => b.id === rentalSelected) : undefined
      if (bike) {
        const [walk, ride] = await Promise.all([
          api.routePlan({ startLat: from.lat, startLon: from.lon, endLat: bike.lat, endLon: bike.lon, mode: 'foot-walking', checkLez: false }),
          api.routePlan({ startLat: bike.lat, startLon: bike.lon, endLat: dest.lat, endLon: dest.lon, mode: 'cycling-regular', checkLez: false }),
        ])
        if (run !== planRun.current) return
        setBikeTrip({ walk, ride })
        setRoute({
          ...ride,
          distanceKm: walk.distanceKm + ride.distanceKm,
          durationMinutes: walk.durationMinutes + ride.durationMinutes,
          routeSummary: `Te voet naar de ${bike.provider}-deelfiets (${walk.distanceKm.toFixed(1)} km, ${Math.round(walk.durationMinutes)} min), daarna met de fiets naar de bestemming (${ride.distanceKm.toFixed(1)} km, ${Math.round(ride.durationMinutes)} min).`,
        })
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
      if (run === planRun.current) {
        setBikeTrip(null)
        setRoute(result)
      }
    } catch (err) {
      if (run !== planRun.current) return
      setLezBlocked(mode === 'car' && err instanceof ApiError && err.code === 'lez')
      setError(err instanceof Error ? err.message : 'De route kon niet worden berekend.')
    } finally {
      if (run === planRun.current) setPlanning(false)
    }
  }

  // Zodra start en bestemming bekend zijn, of het vervoermiddel/LEZ wijzigt, wordt de route meteen (opnieuw) berekend.
  useEffect(() => {
    if (ezOn || !start || !end) return
    void handlePlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, mode, showLez, ezOn, rentalSelected, rentalActive, rentalBikes])

  function pickEvent(item: MapEvent) {
    const point = { lat: item.lat, lon: item.lon, label: item.event.name }
    inputs.chooseEnd(point)
  }

  function startEzPark() {
    setError(null)
    setLezBlocked(false)
    setEzOn(true)
  }

  const toggles = mode === 'bike' ? (
    <label className="toggle" title="Toon Dott- en Bolt-deelfietsen op de kaart">
      <input type="checkbox" role="switch" checked={showRentalBikes} onChange={(e) => { setShowRentalBikes(e.target.checked); setRentalSelected(null) }} />
      <span className="toggle-track" aria-hidden="true" />
      Deelfietsen
    </label>
  ) : mode !== 'car' ? null : (<>
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
            rentalBikes={rentalActive ? nearbyBikes.map((n) => n.bike) : undefined}
            selectedRentalBikeId={rentalSelected}
            transitStops={mode === 'transit' ? transitStops : undefined}
            selectedStopId={selectedStopId}
            onStopSelect={setSelectedStopId}
            onRentalBikeSelect={setRentalSelected}
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
          {mode === 'transit' && !selectedStop && <p className="note">Klik op een halte op de kaart om de volgende vertrekken en vertragingen te zien.</p>}
          {mode === 'transit' && selectedStop && <TransitDeparturesPanel stopId={selectedStop.id} stopName={selectedStop.name} onClose={() => setSelectedStopId(null)} />}
          {rentalActive && (
            <div className="rental-list">
              <strong>Deelfietsen dichtbij ({rentalOriginLabel})</strong>
              <p className="note">Normaal tarief: {RENTAL_TARIFF_LABEL}.{rideMinutes !== undefined ? ` Geschatte kost voor deze rit${bikeTrip ? ' (alleen het fietsgedeelte)' : ''}: ${rentalCostLabel(rideMinutes)}.` : ''}</p>
              {rentalLoading && <p className="note">Deelfietsen laden…</p>}
              {rentalError && <div className="banner">{rentalError}</div>}
              {!rentalLoading && !rentalError && nearbyBikes.length === 0 && <p className="note">Geen beschikbare deelfietsen gevonden.</p>}
              {nearbyBikes.map(({ bike, distance }) => (
                <button type="button" key={`${bike.provider}-${bike.id}`} className={`rental-item${bike.id === rentalSelected ? ' active' : ''}`} onClick={() => setRentalSelected(bike.id)}>
                  <img src={RENTAL_BIKE_ICONS[bike.provider]} alt="" />
                  <span>
                    {bike.provider} · {distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`}
                    <small>
                      {[bike.rangeMeters !== null ? `bereik ${(bike.rangeMeters / 1000).toFixed(1)} km` : null, bike.batteryPercent !== null ? `batterij ${bike.batteryPercent}%` : null].filter(Boolean).join(' · ')}
                    </small>
                  </span>
                </button>
              ))}
              {selectedBike && (
                <button type="button" className="btn btn-primary" onClick={() => openRentalBike(selectedBike)}>
                  Open in de {selectedBike.provider}-app of website
                </button>
              )}
            </div>
          )}
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
              {rentalActive && route && rideMinutes !== undefined && <Fact label="Deelfiets (schatting)">{rentalCostLabel(rideMinutes)} <span className="small muted">({RENTAL_TARIFF_LABEL})</span></Fact>}
            </div>

            {transitRoute && (
              <div className="ov-legs" style={{ marginTop: 12 }}>
                {transitRoute.legs.map((leg, i) => (
                  <div className="ov-leg" key={`${leg.from}-${leg.to}-${i}`}>
                    <span className={`ov-mode ov-mode-${leg.mode}`} style={leg.color ? { background: `#${leg.color}`, color: textOn(leg.color) } : undefined} aria-hidden="true">{leg.mode === 'walk' ? '↗' : leg.line ?? (leg.mode === 'tram' ? 'T' : 'B')}</span>
                    <div>
                      <strong>{leg.mode === 'walk' ? 'Wandelen' : `${leg.mode === 'tram' ? 'Tram' : 'Bus'} ${leg.line ?? ''}`}</strong>
                      <div className="small muted">{leg.from} → {leg.to}</div>
                      <div className="small">{time(new Date(leg.departureAt))}–{time(new Date(leg.arrivalAt))} · {leg.distanceKm.toFixed(1)} km{leg.mode !== 'walk' && leg.delayMinutes >= 2 && <> <span className="dep-badge dep-badge-late">+{leg.delayMinutes} min vertraging</span></>}</div>
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
