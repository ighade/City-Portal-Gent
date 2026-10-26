import { useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useEzPark , LegBadge } from '@/components/EzParkPanel'
import type { EzOverlay } from '@/components/EzParkPanel'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import { ParkingMap } from '@/components/ParkingMap'
import type { MapEvent } from '@/components/ParkingMap'
import { GarageRate, ManualRateInfo, StreetRate } from '@/components/RateInfo'
import { useRouteInputs } from '@/components/RouteInputs'
import type { RoutePoint } from '@/components/RouteInputs'
import { Banner, Btn, Card, Fact, SwitchRow, Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { useApp } from '@/context/AppContext'
import { usePalette } from '@/context/ThemeContext'
import { api, ApiError } from '@/lib/api'
import { locatePlace } from '@/lib/eventGeo'
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
    <View accessibilityRole="radiogroup" accessibilityLabel="Vervoermiddel" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 }}>
      {MODES.map((m) => {
        const on = value === m.key
        return (
          <Pressable
            key={m.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(m.key)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 7,
              paddingHorizontal: 12,
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
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { parkings } = useApp()
  const params = useLocalSearchParams<{ destPlace?: string; destName?: string; n?: string }>()
  const [planning, setPlanning] = useState(false)
  const [showLez, setShowLez] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<RoutePlanResult | null>(null)
  const [transitRoute, setTransitRoute] = useState<TransitRouteResult | null>(null)
  const [mode, setMode] = useState<Mode>('foot')
  const [ezOn, setEzOn] = useState(false)
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
  const inputs = useRouteInputs(carParkings, mapClick)
  const { start, end } = inputs

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
      points: route.coordinates.map(([lon, lat]) => ({ lat: lat!, lon: lon! })),
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
    // eslint-disable-next-line react-hooks/purity
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

  const toggles = mode !== 'car' ? null : (
    <View style={{ gap: 12 }}>
      <SwitchRow label="Lage-emissiezone" value={showLez} onValueChange={(v) => { setShowLez(v); setError(null) }} />
      <SwitchRow label="EZ Park" value={ezOn} onValueChange={(v) => (v ? startEzPark() : setEzOn(false))} />
    </View>
  )

  const ez = useEzPark({
    avoidLez: showLez,
    start,
    end,
    canPlan: inputs.hasStart && inputs.hasEnd,
    resolveStart: inputs.resolveStart,
    resolveEnd: inputs.resolveEnd,
    departInMinutes: inputs.departInMinutes,
    fields: inputs.fields,
    toggles,
    hint: inputs.hint,
    onOverlay: setEzOverlay,
    pick: ezPick,
  })

  const mapHeight = Math.round(Math.max(260, height * 0.42))

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ParkingMap
        height={mapHeight}
        parkings={ezOn ? mapParkings : []}
        bluePins
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

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Card>
          <Txt variant="h1" style={{ fontSize: 20 }}>Routeplanner</Txt>
          <ModePicker value={mode} onChange={changeMode} />
          {ezOn ? (
            ez.controls
          ) : (
            <View style={{ gap: 14 }}>
              {inputs.fields}
              {toggles}
              <Btn
                variant="primary"
                label={planning ? 'Route berekenen…' : 'Route berekenen'}
                onPress={() => void handlePlan()}
                disabled={planning || !inputs.hasStart || !inputs.hasEnd}
              />
              {inputs.hint && <Txt variant="note" style={{ marginTop: 0 }}>{inputs.hint}</Txt>}
              {error && !lezBlocked && <Banner style={{ marginBottom: 0 }}>{error}</Banner>}
              {lezBlocked && (
                <Banner style={{ marginBottom: 0 }}>
                  Deze route komt in de LEZ. Wil je EZ Park gebruiken: parkeer buiten de zone en ga verder te voet of met het OV?
                  {'\n'}
                  <Txt style={{ color: p.brand, fontWeight: '700' }} onPress={startEzPark}>Gebruik EZ Park</Txt>
                </Banner>
              )}
            </View>
          )}
          {inputs.locateError && !start && <Banner style={{ marginTop: 16, marginBottom: 0 }}>{inputs.locateError}</Banner>}
        </Card>

        <Card>
          <Txt variant="h2">Routeoverzicht</Txt>
          {ezOn ? (
            ez.overview
          ) : (
            <>
              <View style={{ gap: 10, marginTop: 16 }}>
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
        </Card>
      </ScrollView>
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
