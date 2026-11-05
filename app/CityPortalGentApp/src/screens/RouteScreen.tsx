import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'

import { BottomSheet } from '@/components/BottomSheet'
import { useEzPark , LegBadge } from '@/components/EzParkPanel'
import type { EzOverlay } from '@/components/EzParkPanel'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import { ParkingMap } from '@/components/ParkingMap'
import type { MapEvent } from '@/components/ParkingMap'
import { RentalBikesPanel } from '@/components/RentalBikesPanel'
import { GarageRate, ManualRateInfo, StreetRate } from '@/components/RateInfo'
import { useRouteInputs } from '@/components/RouteInputs'
import type { RoutePoint } from '@/components/RouteInputs'
import { Banner, Card, Fact, SwitchRow, Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { useApp } from '@/context/AppContext'
import { usePalette } from '@/context/ThemeContext'
import { api, ApiError } from '@/lib/api'
import { locatePlace } from '@/lib/eventGeo'
import { distanceMeters, fetchRentalBikes, openRentalBike, rentalCostLabel } from '@/lib/rentalBikes'
import type { RentalBike } from '@/lib/rentalBikes'
import { GENT_CENTER } from '@/lib/map'
import { transitFareLabel } from '@/lib/fare'
import type { EzParkLeg, Friend, GentEvent, RoutePlanResult, TransitRouteResult } from '@/lib/types'

type Mode = 'foot' | 'bike' | 'car' | 'transit'

const MODES: { key: Mode; label: string; icon: IconName }[] = [
  { key: 'foot', label: 'Te voet', icon: 'foot' },
  { key: 'bike', label: 'Fiets', icon: 'bike' },
  { key: 'car', label: 'Auto', icon: 'car' },
  { key: 'transit', label: 'OV', icon: 'transit' },
]

const API_MODE = { foot: 'foot-walking', bike: 'cycling-regular', car: 'car' } as const
const MODE_LABEL: Record<Mode, string> = { foot: 'Te voet', bike: 'Fiets', car: 'Auto', transit: 'OV' }

const time = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

function ModePicker({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const p = usePalette()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Vervoermiddel" style={{ flexDirection: 'row', gap: 6 }}>
      {MODES.map((m) => {
        const on = value === m.key
        return (
          <Pressable
            key={m.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(m.key)}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingVertical: 7,
              paddingHorizontal: 4,
              borderRadius: Radius.full,
              borderWidth: 1,
              borderColor: on ? p.brand : p.borderStrong,
              backgroundColor: on ? p.brandSoft : p.surface,
            }}>
            <Icon name={m.icon} size={18} color={on ? p.brandStrong : p.ink2} />
            <Txt variant="small" style={{ color: on ? p.brandStrong : p.ink2, fontWeight: '600' }}>{m.label}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

export function RouteScreen() {
  const p = usePalette()
  const { parkings } = useApp()
  const params = useLocalSearchParams<{ destPlace?: string; destName?: string; n?: string }>()
  const [containerH, setContainerH] = useState(0)
  const [plannerBottom, setPlannerBottom] = useState(0)
  const [planning, setPlanning] = useState(false)
  const [showLez, setShowLez] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<RoutePlanResult | null>(null)
  const [transitRoute, setTransitRoute] = useState<TransitRouteResult | null>(null)
  const [mode, setMode] = useState<Mode>('foot')
  const [showRentalBikes, setShowRentalBikes] = useState(true)
  const [rentalBikes, setRentalBikes] = useState<RentalBike[]>([])
  const [rentalBikesLoading, setRentalBikesLoading] = useState(false)
  const [rentalBikesError, setRentalBikesError] = useState<string | null>(null)
  const [selectedRentalBikeId, setSelectedRentalBikeId] = useState<string | null>(null)
  // Met een gekozen deelfiets: eerst te voet naar de fiets (walk), daarna met de fiets naar de bestemming (ride).
  const [bikeTrip, setBikeTrip] = useState<{ walk: RoutePlanResult; ride: RoutePlanResult } | null>(null)
  const [rentalBikeOpenError, setRentalBikeOpenError] = useState<string | null>(null)
  const [userPosition, setUserPosition] = useState<{ lat: number; lon: number } | null>(null)
  const [ezOn, setEzOn] = useState(false)
  const [carOpen, setCarOpen] = useState(0)
  const [lezBlocked, setLezBlocked] = useState(false)
  const [ezOverlay, setEzOverlay] = useState<EzOverlay | null>(null)
  const [mapClick, setMapClick] = useState<{ lat: number; lon: number; n: number } | null>(null)
  const [ezPick, setEzPick] = useState<{ slug: string; n: number } | null>(null)

  const carParkings = useMemo(() => parkings.filter((x) => x.kind !== 'bicycle'), [parkings])
  // Parkings staan alleen op de kaart als EZ Park aan staat; de parkings uit het EZ Park-voorstel
  // hebben al een eigen P-speld, dus die tekenen we hier niet dubbel.
  const mapParkings = useMemo(() => {
    const proposed = new Set((ezOverlay?.parks ?? []).map((k) => k.slug))
    return carParkings.filter((c) => !proposed.has(c.slug))
  }, [carParkings, ezOverlay])
  const weekEvents = useWeekEvents()
  const friendsOnMap = useFriendsOnMap()
  const submit = useRef<() => void>(() => undefined)
  const endSelection = useRef<(target: RoutePoint | string) => void>(() => undefined)
  const inputs = useRouteInputs(carParkings, mapClick, () => submit.current(), (target) => endSelection.current(target))
  const { start, end } = inputs
  const onUserPosition = useCallback((position: { lat: number; lon: number } | null) => setUserPosition(position), [])
  const rentalBikeOrigin = useMemo(
    () => userPosition ?? (start ? { lat: start.lat, lon: start.lon } : { lat: GENT_CENTER[0], lon: GENT_CENTER[1] }),
    [userPosition, start?.lat, start?.lon],
  )
  const rentalBikeSortLabel = userPosition ? 'je locatie' : start ? 'je route-start' : 'Gent centrum'
  const nearbyRentalBikes = useMemo(
    () => rentalBikes
      .map((bike) => ({ ...bike, distanceMeters: distanceMeters(rentalBikeOrigin, bike) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id))
      .slice(0, 10),
    [rentalBikes, rentalBikeOrigin],
  )

  useEffect(() => {
    if (mode !== 'bike' || !showRentalBikes) return
    const controller = new AbortController()
    let cancelled = false
    void fetchRentalBikes(controller.signal)
      .then((bikes) => {
        if (!cancelled) setRentalBikes(bikes)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setRentalBikes([])
        setRentalBikesError(err instanceof Error ? err.message : 'Deelfietsen konden niet worden geladen.')
      })
      .finally(() => {
        if (!cancelled) setRentalBikesLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [mode, showRentalBikes])

  // Komt de bezoeker van een evenement, dan staat de bestemming al ingevuld.
  const chooseEnd = useRef(inputs.chooseEnd)
  useEffect(() => {
    chooseEnd.current = inputs.chooseEnd
  })
  const { destPlace, destName, n: destN } = params
  useEffect(() => {
    if (!destPlace || !destName) return
    let cancelled = false
    void locatePlace(destPlace).then((at) => {
      if (at && !cancelled) chooseEnd.current({ lat: at.lat, lon: at.lon, label: destName })
    })
    return () => { cancelled = true }
  }, [destPlace, destName, destN])

  const routeOverlay = useMemo(() => {
    if (!route || !start || !end) return null
    return {
      start: { lat: start.lat, lon: start.lon, label: start.label },
      end: { lat: end.lat, lon: end.lon, label: end.label },
      mode: route.mode,
      points: (bikeTrip ? bikeTrip.ride : route).coordinates.map(([lon, lat]) => ({ lat: lat!, lon: lon! })),
      walkPoints: bikeTrip?.walk.coordinates.map(([lon, lat]) => ({ lat: lat!, lon: lon! })),
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

  function changeMode(next: Mode) {
    if (next === 'car' && mode !== 'car') setCarOpen((n) => n + 1)
    if (next !== mode) {
      setRentalBikesLoading(next === 'bike' && showRentalBikes)
      setRentalBikesError(null)
    }
    setMode(next)
    setSelectedRentalBikeId(null)
    setRentalBikeOpenError(null)
    setRoute(null)
    setBikeTrip(null)
    setTransitRoute(null)
    setError(null)
    setLezBlocked(false)
    setEzOn(next === 'car')
  }

  const departAt = useMemo(
    // eslint-disable-next-line react-hooks/purity
    () => new Date(Date.now() + inputs.departInMinutes() * 60000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route, inputs.departTime],
  )
  const arriveAt = route ? new Date(departAt.getTime() + route.durationMinutes * 60000) : null

  async function handlePlan(target?: RoutePoint | string, forMode: Mode = mode) {
    setPlanning(true)
    setError(null)
    setLezBlocked(false)

    try {
      const [from, dest] = await Promise.all([
        inputs.resolveStart(),
        typeof target === 'string' ? api.geocode(target) : target ?? inputs.resolveEnd(),
      ])
      if (typeof target === 'string') inputs.chooseEnd(dest, false)
      if (forMode === 'transit') {
        setRoute(null)
        setBikeTrip(null)
        setTransitRoute(null)
        setTransitRoute(await api.transit.route({ startLat: from.lat, startLon: from.lon, endLat: dest.lat, endLon: dest.lon }))
        return
      }
      const bike = forMode === 'bike' && showRentalBikes
        ? rentalBikes.find((item) => item.id === selectedRentalBikeId)
        : undefined
      if (bike) {
        const [walk, ride] = await Promise.all([
          api.routePlan({ startLat: from.lat, startLon: from.lon, endLat: bike.lat, endLon: bike.lon, mode: 'foot-walking', checkLez: false }),
          api.routePlan({ startLat: bike.lat, startLon: bike.lon, endLat: dest.lat, endLon: dest.lon, mode: 'cycling-regular', checkLez: false }),
        ])
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
        mode: API_MODE[forMode],
        checkLez: forMode === 'car' && showLez,
      })
      setBikeTrip(null)
      setRoute(result)
    } catch (err) {
      setLezBlocked(forMode === 'car' && err instanceof ApiError && err.code === 'lez')
      setError(err instanceof Error ? err.message : 'De route kon niet worden berekend.')
    } finally {
      setPlanning(false)
    }
  }

  // Kiezen van een vervoermiddel berekent meteen de route met dat vervoermiddel.
  function selectMode(next: Mode) {
    const useEz = next === 'car' && (next !== mode || ezOn)
    changeMode(next)
    if (!inputs.hasStart || !inputs.hasEnd) return
    // Wisselen naar auto plant via het effect hieronder, zodat het met de nieuwe instellingen rekent.
    if (next === 'car' && next !== mode) return
    if (useEz) void ez.plan()
    else void handlePlan(undefined, next)
  }

  // Wijzigen van LEZ of EZ Park in het auto-tabblad zoekt meteen opnieuw.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (mode !== 'car' || !inputs.hasStart || !inputs.hasEnd) return
    if (ezOn) void ez.plan()
    else void handlePlan(undefined, 'car')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ezOn, showLez])

  // Een deelfiets kiezen (of de keuze opheffen) herberekent de route: eerst naar de fiets, dan naar de bestemming.
  useEffect(() => {
    if (mode !== 'bike' || !start || !end) return
    if (!selectedRentalBikeId && !bikeTrip) return
    void handlePlan(undefined, 'bike')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRentalBikeId])

  // Wordt het startpunt ingevuld terwijl de bestemming al bekend is, dan wordt meteen berekend.
  useEffect(() => {
    if (!start || !end) return
    if (mode === 'car' && ezOn) void ez.plan()
    else void handlePlan(undefined, mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])

  useEffect(() => {
    submit.current = () => selectMode(mode)
    endSelection.current = (target) => {
      if (!ezOn && inputs.hasStart) void handlePlan(target)
    }
  })

  function pickEvent(item: MapEvent) {
    const point = { lat: item.lat, lon: item.lon, label: item.event.name }
    inputs.chooseEnd(point)
  }

  function startEzPark() {
    setError(null)
    setLezBlocked(false)
    setEzOn(true)
  }

  const toggles = mode !== 'car' ? null : (
    <View style={{ gap: 12 }}>
      <SwitchRow label="Lage-emissiezone" value={showLez} onValueChange={(v) => { setShowLez(v); setError(null) }} />
      <SwitchRow label="EZ Park" value={ezOn} onValueChange={(v) => (v ? startEzPark() : setEzOn(false))} />
    </View>
  )
  const rentalBikeToggle = mode === 'bike' ? (
    <SwitchRow
      label="Toon Dott- en Bolt-deelfietsen"
      value={showRentalBikes}
      onValueChange={(value) => {
        setShowRentalBikes(value)
        setRentalBikesLoading(value)
        setRentalBikesError(null)
        if (!value) {
          setSelectedRentalBikeId(null)
          setRentalBikeOpenError(null)
        }
      }}
    />
  ) : null

  async function openSelectedRentalBike() {
    const bike = nearbyRentalBikes.find((item) => item.id === selectedRentalBikeId)
    if (!bike) return
    setRentalBikeOpenError(null)
    try {
      await openRentalBike(bike)
    } catch (err) {
      setRentalBikeOpenError(err instanceof Error ? err.message : 'De aanbieder kon niet worden geopend.')
    }
  }

  const ez = useEzPark({
    avoidLez: showLez,
    start,
    end,
    canPlan: inputs.hasStart && inputs.hasEnd,
    resolveStart: inputs.resolveStart,
    resolveEnd: inputs.resolveEnd,
    departInMinutes: inputs.departInMinutes,
    hint: inputs.hint,
    onOverlay: setEzOverlay,
    pick: ezPick,
  })

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }} onLayout={(e) => setContainerH(e.nativeEvent.layout.height)}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <ParkingMap
          height="100%"
          parkings={ezOn ? mapParkings : []}
          bluePins
          showLez={showLez}
          selected={null}
          hoverInfo
          events={weekEvents}
          friends={friendsOnMap}
          onEventPick={pickEvent}
          onUserPosition={onUserPosition}
          eventSheetTop={plannerBottom + 8}
          onEzParkPick={(slug) => setEzPick({ slug, n: Date.now() })}
          route={ezOn ? null : routeOverlay}
          rentalBikes={mode === 'bike' && showRentalBikes ? nearbyRentalBikes : undefined}
          selectedRentalBikeId={selectedRentalBikeId}
          onRentalBikeSelect={(id) => {
            setSelectedRentalBikeId(id)
            setRentalBikeOpenError(null)
          }}
          onMapClick={(lat, lon) => setMapClick({ lat, lon, n: Date.now() })}
          ezpark={ezOn ? ezOverlay : (mode === 'transit' && transitOverlay) || markerOverlay}
        />
      </View>

      <View pointerEvents="box-none" style={{ paddingHorizontal: 12, paddingTop: 8 }} onLayout={(e) => setPlannerBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        <Card style={{ marginBottom: 0, padding: 8 }}>{inputs.fields}</Card>
      </View>

      <BottomSheet containerHeight={containerH} minHeight={132} initialHeight={230} topInset={plannerBottom + 12} expandKey={carOpen}>
        <ModePicker value={mode} onChange={selectMode} />
        {inputs.departField}
        {toggles}
        {rentalBikeToggle}
        {mode === 'bike' && showRentalBikes && (
          <RentalBikesPanel
            bikes={nearbyRentalBikes}
            selectedBikeId={selectedRentalBikeId}
            loading={rentalBikesLoading}
            error={rentalBikesError}
            openError={rentalBikeOpenError}
            sortLabel={rentalBikeSortLabel}
            rideMinutes={bikeTrip ? bikeTrip.ride.durationMinutes : route?.durationMinutes ?? null}
            onSelect={(id) => {
              setSelectedRentalBikeId(id)
              setRentalBikeOpenError(null)
            }}
            onOpen={() => void openSelectedRentalBike()}
          />
        )}
        {inputs.locateError && !start && <Banner style={{ marginBottom: 0 }}>{inputs.locateError}</Banner>}
        {error && !lezBlocked && <Banner style={{ marginBottom: 0 }}>{error}</Banner>}
        {lezBlocked && (
          <Banner style={{ marginBottom: 0 }}>
            Deze route komt in de LEZ. Wil je EZ Park gebruiken: parkeer buiten de zone en ga verder te voet of met het OV?
            {'\n'}
            <Txt style={{ color: p.brand, fontWeight: '700' }} onPress={startEzPark}>Gebruik EZ Park</Txt>
          </Banner>
        )}
        {ezOn && ez.controls}
        <Txt variant="h2">Routeoverzicht</Txt>
        <View>
          {ezOn ? (
            ez.overview
          ) : (
            <>
              <View style={{ gap: 10 }}>
                <Fact label="Start">{start?.label ?? '—'}</Fact>
                <Fact label="Eind">{end?.label ?? '—'}</Fact>
                <Fact label="Vervoer">{MODE_LABEL[mode]}</Fact>
                <Fact label="Vertrek">{transitRoute ? time(new Date(transitRoute.departureAt)) : route ? time(departAt) : '—'}</Fact>
                <Fact label="Aankomst">{transitRoute ? time(new Date(transitRoute.arrivalAt)) : arriveAt ? time(arriveAt) : '—'}</Fact>
                <Fact label="Afstand">{transitRoute ? `${transitRoute.distanceKm.toFixed(1)} km` : route ? `${route.distanceKm.toFixed(1)} km` : '—'}</Fact>
                {transitRoute && transitFareLabel(transitRoute.legs) && (
                  <Fact label="Ticketprijs">
                    <Txt variant="strong" style={{ textAlign: 'right' }}>
                      {transitFareLabel(transitRoute.legs)} <Txt variant="smallMuted">(overstappen inbegrepen)</Txt>
                    </Txt>
                  </Fact>
                )}
                <Fact label="Geschatte tijd">{transitRoute ? `${Math.round(transitRoute.durationMinutes)} min` : route ? `${Math.round(route.durationMinutes)} min` : '—'}</Fact>
                {mode === 'bike' && showRentalBikes && route && <Fact label="Deelfiets (schatting)">{rentalCostLabel(bikeTrip ? bikeTrip.ride.durationMinutes : route.durationMinutes)}</Fact>}
              </View>

              {transitRoute && (
                <View style={{ gap: 12, marginTop: 12 }}>
                  {transitRoute.legs.map((leg, i) => (
                    <View key={`${leg.from}-${leg.to}-${i}`} style={{ flexDirection: 'row', gap: 10 }}>
                      <LegBadge mode={leg.mode} line={leg.line} color={leg.color} />
                      <View style={{ flex: 1 }}>
                        <Txt variant="strong">{leg.mode === 'walk' ? 'Wandelen' : `${leg.mode === 'tram' ? 'Tram' : 'Bus'} ${leg.line ?? ''}`}</Txt>
                        <Txt variant="smallMuted">{leg.from} → {leg.to}</Txt>
                        <Txt variant="small">{time(new Date(leg.departureAt))}–{time(new Date(leg.arrivalAt))} · {leg.distanceKm.toFixed(1)} km</Txt>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {!route && !transitRoute && !planning && <Txt variant="note">Kies start en bestemming en druk op “Route berekenen”.</Txt>}
              {route && <Txt variant="note">{route.routeSummary}</Txt>}
              {transitRoute && <Txt variant="note">{transitRoute.summary}</Txt>}
              {route?.lezWarning && <Txt variant="note">{route.lezWarning}</Txt>}
              {route?.destinationGarage && (
                <View style={{ marginTop: 16 }}>
                  <Txt variant="h3">Tarief {route.destinationGarage.name}</Txt>
                  {route.destinationGarage.manualRate
                    ? <ManualRateInfo rate={route.destinationGarage.manualRate} />
                    : <GarageRate rate={route.destinationGarage.rate ?? undefined} />}
                </View>
              )}
              {route?.destinationParking && <StreetRate info={route.destinationParking} arrival={arriveAt} />}
            </>
          )}
        </View>
      </BottomSheet>
    </View>
  )
}

/** Vrienden met locatie, alleen als "toon op routekaart" aanstaat; ververst elke 30 seconden. */
function useFriendsOnMap(): Friend[] {
  const [friends, setFriends] = useState<Friend[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
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
        if (!cancelled) setFriends([])
      }
      if (!cancelled) timer = setTimeout(tick, 30_000)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return friends
}

/** Evenementen van de komende 7 dagen, met coördinaat uit de Vlaamse geolocatie (onthouden in AsyncStorage). */
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
