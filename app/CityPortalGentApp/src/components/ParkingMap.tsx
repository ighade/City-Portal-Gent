import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Camera, GeoJSONSource, Layer, Map as MapView } from '@maplibre/maplibre-react-native'
import type { CameraRef } from '@maplibre/maplibre-react-native'

import { BluePin, ChargingPin, DotLabel, EventPin, LineBadge, ParkingPin, PinMarker, RentalBikePin } from '@/components/MapPins'
import { MapLine } from '@/components/MapLine'
import { FriendMarkers } from '@/components/FriendsMap'
import { Btn, Txt } from '@/components/ui'
import type { EzOverlay } from '@/components/EzParkPanel'
import { Radius } from '@/constants/theme'
import { usePalette } from '@/context/ThemeContext'
import { api, assetUrl } from '@/lib/api'
import { dayMonthParts, nl, timeBrussels, weekdayLong } from '@/lib/format'
import { GENT_REGION, GENT_VIEW, boundsOf, lngLatOf, mapStyleUrl, regionOf } from '@/lib/map'
import type { Region } from '@/lib/map'
import type { RentalBike } from '@/lib/rentalBikes'
import type { ChargingStation } from '@/lib/chargingStations'
import { kindLabel } from '@/lib/types'
import type { Friend, GentEvent, Parking, TransitStop } from '@/lib/types'

interface RoutePoint {
  lat: number
  lon: number
  label: string
}

interface RouteOverlay {
  start: RoutePoint
  end: RoutePoint
  mode: 'car' | 'foot-walking' | 'cycling-regular'
  points: { lat: number; lon: number }[]
  /** Deelfiets: het stuk te voet van de start naar de fiets, gestippeld getekend. */
  walkPoints?: { lat: number; lon: number }[]
}

/** Een evenement met coördinaat, voor de kalenderspelden op de routekaart. */
export interface MapEvent {
  event: GentEvent
  lat: number
  lon: number
}

interface Props {
  parkings: Parking[]
  /** Tekent de lage-emissiezone eronder. */
  showLez: boolean
  /** Welke parking is aangewezen; die speld opent zijn infovenster. */
  selected?: string | null
  onSelect?: (slug: string | null) => void
  route?: RouteOverlay | null
  /** Alle spelden in één blauw, zonder drukte-kleur (routepagina). */
  bluePins?: boolean
  /** Tik op een leeg stuk kaart; voor het kiezen van start of bestemming. */
  onMapClick?: (lat: number, lon: number) => void
  /** EZ Park: start, bestemming en de benen van de gekozen route. */
  ezpark?: EzOverlay | null
  /** Infovenster zonder link naar de detailpagina. */
  hoverInfo?: boolean
  onEzParkPick?: (slug: string) => void
  events?: MapEvent[]
  friends?: Friend[]
  onEventPick?: (event: MapEvent) => void
  rentalBikes?: RentalBike[]
  selectedRentalBikeId?: string | null
  onRentalBikeSelect?: (id: string) => void
  chargingStations?: ChargingStation[]
  selectedChargingId?: string | null
  onChargingSelect?: (id: string) => void
  /** OV-haltes; alleen die in beeld staan worden getekend (max. 120). */
  transitStops?: TransitStop[]
  selectedStopId?: string | null
  onStopSelect?: (id: string) => void
  onUserPosition?: (position: { lat: number; lon: number } | null) => void
  focusLocation?: { lat: number; lon: number } | null
  /** Zet de evenementenkaarten bovenaan, deze afstand van de bovenkant, in plaats van onderaan. */
  eventSheetTop?: number
  height?: number | string
}

const EVENT_CLUSTER_PX = 34

const occupancyColor = (pct: number) => (pct < 50 ? '#16a34a' : pct < 80 ? '#f59e0b' : '#dc2626')

function Bar({ available, capacity }: { available: number; capacity: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(((capacity - available) / capacity) * 100)))
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <View style={{ width: 90, height: 8, borderRadius: 999, backgroundColor: '#e5e7eb', overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(2, pct)}%`, height: '100%', backgroundColor: occupancyColor(pct) }} />
      </View>
      <Txt variant="small" style={{ color: '#111827' }}>{nl(available)} vrij van {nl(capacity)}</Txt>
    </View>
  )
}

function ParkingCallout({ p, withLink }: { p: Parking; withLink: boolean }) {
  const kind = kindLabel[p.kind] + (p.isPublic ? '' : ' · privaat, voor personeel')
  const st = p.status
  const bar = !withLink && st?.isOpen && st.available != null && st.capacity > 0
  let status = ''
  if (!st) status = `${nl(p.capacity)} plaatsen · de stad meet hier niet`
  else if (!st.isOpen) status = 'Gesloten'
  else {
    status = `${st.available == null ? 'Onbekend' : nl(st.available)} vrij van ${nl(st.capacity)}`
    if (st.occupancy != null) status += ` · ${st.occupancy} % bezet`
  }
  return (
    <View style={{ minWidth: 200, maxWidth: 260 }}>
      <Txt variant="strong" style={{ color: '#111827' }}>{p.name}</Txt>
      <Txt variant="smallMuted" style={{ color: '#6b7280' }}>{kind}{p.address ? ` · ${p.address}` : ''}</Txt>
      {bar && st ? <Bar available={st.available!} capacity={st.capacity} /> : <Txt variant="small" style={{ color: '#111827', marginTop: 4 }}>{status}</Txt>}
      {withLink && <Txt variant="small" style={{ color: '#2563eb', marginTop: 6 }}>Verloop en drukte →</Txt>}
    </View>
  )
}

type LezCollection = Awaited<ReturnType<typeof api.lez>>

/** OV-haltes verschijnen pas als de kaart ver genoeg ingezoomd is (ongeveer zoomniveau 15). */
const STOP_MAX_LAT_DELTA = 0.02

export function ParkingMap({
  parkings,
  showLez,
  selected,
  onSelect,
  route,
  onMapClick,
  ezpark,
  bluePins,
  hoverInfo,
  onEzParkPick,
  events,
  onEventPick,
  eventSheetTop,
  friends,
  rentalBikes,
  selectedRentalBikeId,
  onRentalBikeSelect,
  chargingStations,
  selectedChargingId,
  onChargingSelect,  transitStops,
  selectedStopId,
  onStopSelect,
  onUserPosition,
  focusLocation,
  height = '100%',
}: Props) {
  const p = usePalette()
  const router = useRouter()
  const camera = useRef<CameraRef>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [region, setRegion] = useState<Region>(GENT_REGION)
  const [lez, setLez] = useState<LezCollection | null>(null)
  // Welke speld een popup open heeft ("parking-<slug>", "bike-<id>", enz.); null is alles dicht.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const visibleStops = useMemo(() => {
    if (!transitStops || transitStops.length === 0 || region.latitudeDelta > STOP_MAX_LAT_DELTA) return []
    const padLat = region.latitudeDelta * 0.6
    const padLon = region.longitudeDelta * 0.6
    const inView = transitStops.filter((s) => Math.abs(s.lat - region.latitude) <= padLat && Math.abs(s.lon - region.longitude) <= padLon)
    if (inView.length <= 120) return inView
    return inView
      .map((s) => ({ s, d: (s.lat - region.latitude) ** 2 + (s.lon - region.longitude) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 120)
      .map((x) => x.s)
  }, [transitStops, region])
  const [sheet, setSheet] = useState<MapEvent[] | null>(null)
  const markerPressAt = useRef(0)
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null)
  const [mapReady, setMapReady] = useState(false)

  // Eigen locatie volgen, alleen met toestemming.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null
    let cancelled = false
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (!perm.granted || cancelled) return
        sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 10 }, (pos) => {
          if (cancelled) return
          const { latitude: lat, longitude: lon } = pos.coords
          const position = { lat, lon }
          setUserPos(position)
          onUserPosition?.(position)
        })
        if (cancelled) sub.remove()
      } catch (error) {
        console.warn('Locatie volgen mislukt:', error)
      }
    })()
    return () => {
      cancelled = true
      sub?.remove()
    }
  }, [onUserPosition])
  // De lage-emissiezone wordt één keer opgehaald en daarna alleen aan- of uitgezet.
  useEffect(() => {
    if (!showLez || lez) return
    let cancelled = false
    api
      .lez()
      .then((collection) => {
        if (!cancelled && collection.features.length > 0) setLez(collection)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [showLez, lez])

  useEffect(() => {
    if (!focusLocation || !mapReady) return
    // De handmatig opgevraagde positie kan eerder aankomen dan de locatie-watch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserPos(focusLocation)
    camera.current?.easeTo({ center: lngLatOf(focusLocation.lat, focusLocation.lon), zoom: 15, duration: 300 })
  }, [focusLocation, mapReady])

  const edge = { top: 180, right: 60, bottom: 180, left: 60 }

  useEffect(() => {
    if (!route || !camera.current) return
    const pts: [number, number][] = [
      lngLatOf(route.start.lat, route.start.lon),
      lngLatOf(route.end.lat, route.end.lon),
      ...route.points.map((q): [number, number] => lngLatOf(q.lat, q.lon)),
      ...(route.walkPoints ?? []).map((q): [number, number] => lngLatOf(q.lat, q.lon)),
    ]
    camera.current.fitBounds(boundsOf(pts), { padding: edge, duration: 300 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  useEffect(() => {
    if (!ezpark || ezpark.legs.length === 0 || !camera.current) return
    const pts: [number, number][] = []
    if (ezpark.start) pts.push(lngLatOf(ezpark.start.lat, ezpark.start.lon))
    if (ezpark.end) pts.push(lngLatOf(ezpark.end.lat, ezpark.end.lon))
    for (const park of ezpark.parks) pts.push(lngLatOf(park.lat, park.lon))
    for (const leg of ezpark.legs) for (const [lat, lon] of leg.coordinates) pts.push(lngLatOf(lat!, lon!))
    if (pts.length > 0) camera.current.fitBounds(boundsOf(pts), { padding: edge, duration: 300 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ezpark])

  // Wat in de lijst aangewezen wordt, opent op de kaart.
  useEffect(() => {
    if (!selected || hoverInfo) return
    const target = parkings.find((x) => x.slug === selected)
    if (!target) return
    camera.current?.easeTo({ center: lngLatOf(target.lat, target.lon), duration: 300 })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenKey(`parking-${selected}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  useEffect(() => {
    if (!selectedRentalBikeId) return
    const bike = rentalBikes?.find((item) => item.id === selectedRentalBikeId)
    if (!bike) return
    camera.current?.easeTo({ center: lngLatOf(bike.lat, bike.lon), duration: 300 })
    // Keep the map centered on a bike only when a bike is selected, not after every map movement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRentalBikeId])

  useEffect(() => {
    if (!selectedChargingId) return
    const s = chargingStations?.find((item) => item.id === selectedChargingId)
    if (!s) return
    camera.current?.easeTo({ center: lngLatOf(s.lat, s.lon), duration: 300 })
    // Alleen bij een andere selectie centreren, niet na elke kaartbeweging.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChargingId])

  // Spelden die op het scherm dichter dan EVENT_CLUSTER_PX bij elkaar liggen worden één speld.
  const clusters = useMemo(() => {
    if (!events || events.length === 0 || size.w === 0) return []
    const out: { items: MapEvent[]; x: number; y: number }[] = []
    for (const item of events) {
      const x = ((item.lon - region.longitude) / region.longitudeDelta) * size.w
      const y = ((region.latitude - item.lat) / region.latitudeDelta) * size.h
      const near = out.find((c) => Math.hypot(c.x - x, c.y - y) < EVENT_CLUSTER_PX)
      if (near) near.items.push(item)
      else out.push({ items: [item], x, y })
    }
    return out.map((c) => ({
      items: c.items,
      lat: c.items.reduce((s, i) => s + i.lat, 0) / c.items.length,
      lon: c.items.reduce((s, i) => s + i.lon, 0) / c.items.length,
    }))
  }, [events, region, size])

  // De personeelsstalling van het Stadskantoor deelt haar coördinaat met de openbare; teken eerst
  // wat niet openbaar is, zodat de speld waar je wél terechtkunt bovenop ligt.
  const ordered = useMemo(() => [...parkings].sort((a, b) => Number(a.isPublic) - Number(b.isPublic)), [parkings])

  // Valt de bestemming op een parking of evenement, dan is dat icoon al de aanduiding.
  const onOtherIcon = (pt: { lat: number; lon: number }) => {
    const near = (a: { lat: number; lon: number }) => Math.abs(a.lat - pt.lat) < 0.0003 && Math.abs(a.lon - pt.lon) < 0.0004
    return parkings.some(near) || (events ?? []).some(near) || (ezpark?.parks ?? []).some(near)
  }

  // Valt de start op de eigen locatie, dan volstaat het blauwe locatiepunt.
  const onUser = (pt: { lat: number; lon: number }) =>
    !!userPos && Math.abs(userPos.lat - pt.lat) < 0.0003 && Math.abs(userPos.lon - pt.lon) < 0.0004

  const dot = (id: string, pt: { lat: number; lon: number }, color: string, label: string) =>
    (label !== 'Start' && onOtherIcon(pt)) || (label === 'Start' && onUser(pt)) ? null : (
      <PinMarker key={id} id={id} lat={pt.lat} lon={pt.lon} anchor="bottom">
        <DotLabel label={label} color={color} />
      </PinMarker>
    )

  return (
    <View style={[styles.box, { height: height as number, backgroundColor: p.surface3 }]} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyleUrl(p.scheme)}
        compass={false}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onRegionDidChange={(e) => setRegion(regionOf(e.nativeEvent.bounds))}
        onPress={(e) => {
          // Sommige platforms sturen na een markerklik ook een kaartklik; die mag de kaart niet meteen sluiten.
          if (Date.now() - markerPressAt.current < 400) return
          setSheet(null)
          setOpenKey(null)
          const [lon, lat] = e.nativeEvent.lngLat
          onMapClick?.(lat, lon)
        }}>
        <Camera ref={camera} initialViewState={GENT_VIEW} minZoom={11} maxZoom={18} />

        {showLez && lez && (
          <>
            <GeoJSONSource id="lez" data={lez as unknown as GeoJSON.FeatureCollection} />
            <Layer id="lez-fill" type="fill" source="lez" paint={{ 'fill-color': p.lezFill }} />
            <Layer id="lez-line" type="line" source="lez" paint={{ 'line-color': p.lezLine, 'line-width': 2, 'line-dasharray': [6, 6] }} />
          </>
        )}

        {route && (
          <MapLine
            id="route"
            points={route.points.map((q): [number, number] => lngLatOf(q.lat, q.lon))}
            color={route.mode === 'foot-walking' ? '#2563eb' : route.mode === 'cycling-regular' ? '#16a34a' : '#d94a4a'}
            width={route.mode === 'foot-walking' ? 4 : 5}
            dash={route.mode === 'foot-walking' ? [2, 8] : undefined}
          />
        )}

        {route?.walkPoints && route.walkPoints.length > 0 && (
          <MapLine id="route-walk" points={route.walkPoints.map((q): [number, number] => lngLatOf(q.lat, q.lon))} color="#2563eb" width={4} dash={[2, 8]} />
        )}

        {route && dot('route-start', route.start, '#2563eb', 'Start')}
        {route && dot('route-end', route.end, '#c2410c', 'Bestemming')}

        {visibleStops.map((s) => {
          const key = `stop-${s.id}`
          const selectedStop = selectedStopId === s.id
          return (
            <PinMarker
              key={key}
              id={key}
              lat={s.lat}
              lon={s.lon}
              open={openKey === key}
              callout={<View style={[styles.callout, { borderColor: p.border }]}><Txt variant="strong" style={{ color: '#111827' }}>{s.name}</Txt></View>}
              onPress={() => {
                markerPressAt.current = Date.now()
                setOpenKey(key)
                onStopSelect?.(s.id)
              }}>
              <View style={{ width: selectedStop ? 20 : 14, height: selectedStop ? 20 : 14, borderRadius: 10, borderWidth: 3, borderColor: selectedStop ? '#b45309' : '#1d4ed8', backgroundColor: selectedStop ? '#fbbf24' : '#fff' }} />
            </PinMarker>
          )
        })}

        {chargingStations?.map((s) => {
          const key = `charging-${s.id}`
          return (
            <PinMarker
              key={key}
              id={key}
              lat={s.lat}
              lon={s.lon}
              open={openKey === key}
              callout={<View style={[styles.callout, { borderColor: p.border }]}><Txt variant="strong" style={{ color: '#111827' }}>{`Laadpaal ${s.street}`}</Txt></View>}
              onPress={() => {
                markerPressAt.current = Date.now()
                setOpenKey(key)
                onChargingSelect?.(s.id)
              }}>
              <ChargingPin selected={selectedChargingId === s.id} />
            </PinMarker>
          )
        })}

        {rentalBikes?.map((bike) => {
          const key = `rental-${bike.provider}-${bike.id}`
          return (
            <PinMarker
              key={key}
              id={key}
              lat={bike.lat}
              lon={bike.lon}
              open={openKey === key}
              callout={
                <View style={[styles.callout, { borderColor: p.border }]}>
                  <Txt variant="strong" style={{ color: '#111827' }}>{bike.provider} deelfiets</Txt>
                  <Txt variant="small" style={{ color: '#111827' }}>Selecteer in het routepaneel om te openen.</Txt>
                </View>
              }
              onPress={() => {
                markerPressAt.current = Date.now()
                setOpenKey(key)
                onRentalBikeSelect?.(bike.id)
              }}>
              <RentalBikePin provider={bike.provider} selected={selectedRentalBikeId === bike.id} />
            </PinMarker>
          )
        })}

        {ordered.map((pk) => {
          const key = `parking-${pk.slug}`
          return (
            <PinMarker
              key={key}
              id={key}
              lat={pk.lat}
              lon={pk.lon}
              open={openKey === key}
              callout={
                <Pressable
                  onPress={() => !hoverInfo && router.push({ pathname: '/parking/[slug]', params: { slug: pk.slug } })}
                  style={[styles.callout, { borderColor: p.border }]}>
                  <ParkingCallout p={pk} withLink={!hoverInfo} />
                </Pressable>
              }
              onPress={() => {
                markerPressAt.current = Date.now()
                setOpenKey(key)
                onSelect?.(pk.slug)
              }}>
              {bluePins ? <BluePin /> : <ParkingPin parking={pk} />}
            </PinMarker>
          )
        })}

        {ezpark && (
          <>
            {ezpark.start && dot('ez-start', ezpark.start, '#2563eb', 'Start')}
            {ezpark.end && dot('ez-end', ezpark.end, '#c2410c', 'Bestemming')}
            {ezpark.parks.map((park) => {
              const key = `ez-${park.slug}`
              return (
                <PinMarker
                  key={key}
                  id={key}
                  lat={park.lat}
                  lon={park.lon}
                  open={openKey === key}
                  callout={
                    <View style={[styles.callout, { borderColor: p.border }]}>
                      <Txt variant="strong" style={{ color: '#111827' }}>{park.name}</Txt>
                      {park.available != null && park.capacity > 0 ? (
                        <Bar available={park.available} capacity={park.capacity} />
                      ) : (
                        <Txt variant="small" style={{ color: '#111827' }}>Beschikbaarheid onbekend</Txt>
                      )}
                      {park.details.map((d) => <Txt key={d} variant="small" style={{ color: '#111827' }}>{d}</Txt>)}
                    </View>
                  }
                  onPress={() => {
                    markerPressAt.current = Date.now()
                    setOpenKey(key)
                    onEzParkPick?.(park.slug)
                  }}>
                  <BluePin size={34} />
                </PinMarker>
              )
            })}
            {ezpark.legs.map((leg, i) => {
              if (leg.coordinates.length < 2) return null
              const coords = leg.coordinates.map(([lat, lon]): [number, number] => [lon!, lat!])
              const transitColor = leg.color ? `#${leg.color}` : leg.mode === 'tram' ? '#d97706' : '#0f766e'
              const mid = coords[Math.floor(coords.length / 2)]!
              return (
                <Fragment key={`leg-${i}`}>
                  <MapLine
                    id={`ez-leg-${i}`}
                    points={coords}
                    color={leg.mode === 'drive' ? '#d94a4a' : leg.mode === 'walk' ? '#2563eb' : transitColor}
                    width={leg.mode === 'drive' ? 5 : leg.mode === 'walk' ? 4 : 6}
                    dash={leg.mode === 'walk' ? [2, 8] : undefined}
                  />
                  {(leg.mode === 'bus' || leg.mode === 'tram') && leg.line ? (
                    <PinMarker id={`ez-line-${i}`} lat={mid[1]} lon={mid[0]}>
                      <LineBadge line={leg.line} color={transitColor} />
                    </PinMarker>
                  ) : null}
                </Fragment>
              )
            })}
          </>
        )}

        {clusters.map((c, ci) => (
          <PinMarker
            key={`event-${ci}`}
            id={`event-${ci}`}
            lat={c.lat}
            lon={c.lon}
            onPress={() => {
              markerPressAt.current = Date.now()
              setSheet(c.items)
            }}>
            <EventPin count={c.items.length} />
          </PinMarker>
        ))}

        {friends && friends.length > 0 && <FriendMarkers friends={friends} />}

        {userPos && (
          <PinMarker id="user-position" lat={userPos.lat} lon={userPos.lon}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#2563eb', borderWidth: 3, borderColor: '#fff' }} />
          </PinMarker>
        )}
      </MapView>

      {sheet && (
        <View
          style={[
            styles.sheet,
            { backgroundColor: p.surface, borderColor: p.border },
            eventSheetTop != null && { top: eventSheetTop, bottom: undefined, maxHeight: Math.max(160, size.h - eventSheetTop - 150) },
          ]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8 }}>
            <Txt variant="smallMuted">{sheet.length === 1 ? '1 evenement' : `${sheet.length} evenementen`}</Txt>
            <Btn label="Sluiten" size="sm" variant="ghost" onPress={() => setSheet(null)} />
          </View>
          <ScrollView style={{ maxHeight: Math.max(160, size.h * 0.6 - 44) }} nestedScrollEnabled contentContainerStyle={{ padding: 12, gap: 10 }}>
            {sheet.map((item, i) => (
              <MapEventCard
                key={`${item.event.id}-${i}`}
                item={item}
                onDetails={() => {
                  setSheet(null)
                  router.push({ pathname: '/events/[id]', params: { id: item.event.id } })
                }}
                onRoute={() => {
                  setSheet(null)
                  onEventPick?.(item)
                }}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

function MapEventCard({ item, onDetails, onRoute }: { item: MapEvent; onDetails: () => void; onRoute: () => void }) {
  const p = usePalette()
  const e = item.event
  const start = e.startsAtUtc ? new Date(e.startsAtUtc) : null
  const [day, month] = start ? dayMonthParts(start) : ['', '']
  return (
    <View style={{ flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: p.border, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: p.surface2 }}>
      <Pressable onPress={onDetails} style={{ width: 84, minHeight: 110, backgroundColor: p.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        {e.coverImageUrl ? (
          <Image source={{ uri: assetUrl(e.coverImageUrl) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Txt variant="h1" style={{ color: p.brandStrong }}>{e.name.slice(0, 1).toUpperCase()}</Txt>
        )}
        {start && (
          <View style={{ position: 'absolute', top: 4, left: 4, backgroundColor: p.surface, borderRadius: 6, paddingHorizontal: 5, alignItems: 'center' }}>
            <Txt variant="small" style={{ fontWeight: '700', lineHeight: 15 }}>{day}</Txt>
            <Txt variant="smallMuted" style={{ fontSize: 10, lineHeight: 12 }}>{month}</Txt>
          </View>
        )}
      </Pressable>
      <View style={{ flex: 1, paddingVertical: 8, paddingRight: 8, gap: 2 }}>
        <Txt variant="strong" numberOfLines={2}>{e.name}</Txt>
        {e.isHappeningNow && <Txt variant="small" style={{ color: p.brand, fontWeight: '700' }}>Nu bezig</Txt>}
        {start && <Txt variant="smallMuted">{weekdayLong(start)} · {timeBrussels(start)}</Txt>}
        {e.place && <Txt variant="smallMuted" numberOfLines={1}>{e.place}</Txt>}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <Btn label="Details" size="sm" onPress={onDetails} />
          <Btn label="Route hierheen" size="sm" variant="primary" onPress={onRoute} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden' },
  callout: { backgroundColor: '#ffffff', borderRadius: 10, padding: 10, borderWidth: 1 },
  sheet: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    maxHeight: '60%',
    zIndex: 10,
    elevation: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
})
