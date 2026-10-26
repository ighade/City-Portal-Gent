import { useRouter } from 'expo-router'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import MapView, { Callout, Marker, Polygon, Polyline } from 'react-native-maps'
import type { Region } from 'react-native-maps'

import { BluePin, DotLabel, EventPin, LineBadge, ParkingPin, PinMarker } from '@/components/MapPins'
import { FriendMarkers } from '@/components/FriendsMap'
import { Btn, Txt } from '@/components/ui'
import type { EzOverlay } from '@/components/EzParkPanel'
import { Radius } from '@/constants/theme'
import { usePalette } from '@/context/ThemeContext'
import { api } from '@/lib/api'
import { dayMonthParts, nl, timeBrussels, weekdayLong } from '@/lib/format'
import { GENT_BOUNDS, GENT_REGION, geoJsonPolygons } from '@/lib/map'
import type { MapPolygon } from '@/lib/map'
import { busyness, busynessLabel, kindLabel } from '@/lib/types'
import type { Friend, GentEvent, Parking } from '@/lib/types'

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
  height?: number | string
}

const EVENT_CLUSTER_PX = 34

const occupancyColor = (pct: number) => (pct < 50 ? '#16a34a' : pct < 80 ? '#f59e0b' : '#dc2626')

function describe(p: Parking): string {
  if (!p.status) return `geen meting, ${p.capacity} plaatsen`
  const available = p.status.available === null
    ? `vrije plaatsen onbekend van ${p.status.capacity}`
    : `${p.status.available} vrij van ${p.status.capacity}`
  if (!p.isPublic) return `privaat, ${available}`
  if (!p.status.isOpen) return 'gesloten'
  return `${busynessLabel[busyness(p.status)]}, ${available}`
}

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
  friends,
  height = '100%',
}: Props) {
  const p = usePalette()
  const router = useRouter()
  const map = useRef<MapView>(null)
  const markers = useRef<Map<string, InstanceType<typeof Marker> | null>>(new Map())
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [region, setRegion] = useState<Region>(GENT_REGION)
  const [lez, setLez] = useState<MapPolygon[] | null>(null)
  const [sheet, setSheet] = useState<MapEvent[] | null>(null)

  // De lage-emissiezone wordt één keer opgehaald en daarna alleen aan- of uitgezet.
  useEffect(() => {
    if (!showLez || lez) return
    let cancelled = false
    api
      .lez()
      .then((collection) => {
        if (!cancelled && collection.features.length > 0) setLez(geoJsonPolygons(collection.features))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [showLez, lez])

  const onReady = useCallback(() => {
    if (Platform.OS === 'android') {
      map.current?.setMapBoundaries(
        { latitude: GENT_BOUNDS[1][0], longitude: GENT_BOUNDS[1][1] },
        { latitude: GENT_BOUNDS[0][0], longitude: GENT_BOUNDS[0][1] },
      )
    }
  }, [])

  const edge = { top: 60, right: 60, bottom: 60, left: 60 }

  useEffect(() => {
    if (!route || !map.current) return
    const pts = [
      { latitude: route.start.lat, longitude: route.start.lon },
      { latitude: route.end.lat, longitude: route.end.lon },
      ...route.points.map((q) => ({ latitude: q.lat, longitude: q.lon })),
    ]
    map.current.fitToCoordinates(pts, { edgePadding: edge, animated: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  useEffect(() => {
    if (!ezpark || ezpark.legs.length === 0 || !map.current) return
    const pts: { latitude: number; longitude: number }[] = []
    if (ezpark.start) pts.push({ latitude: ezpark.start.lat, longitude: ezpark.start.lon })
    if (ezpark.end) pts.push({ latitude: ezpark.end.lat, longitude: ezpark.end.lon })
    for (const park of ezpark.parks) pts.push({ latitude: park.lat, longitude: park.lon })
    for (const leg of ezpark.legs) for (const [lat, lon] of leg.coordinates) pts.push({ latitude: lat!, longitude: lon! })
    if (pts.length > 0) map.current.fitToCoordinates(pts, { edgePadding: edge, animated: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ezpark])

  // Wat in de lijst aangewezen wordt, opent op de kaart.
  useEffect(() => {
    if (!selected || hoverInfo) return
    const mk = markers.current.get(selected)
    const target = parkings.find((x) => x.slug === selected)
    if (!mk || !target) return
    map.current?.animateToRegion({ ...region, latitude: target.lat, longitude: target.lon }, 300)
    mk.showCallout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

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

  const dot = (pt: { lat: number; lon: number }, color: string, label: string) => (
    <Marker key={label} coordinate={{ latitude: pt.lat, longitude: pt.lon }} anchor={{ x: 0.5, y: 0.9 }} tracksViewChanges={false}>
      <DotLabel label={label} color={color} />
    </Marker>
  )

  return (
    <View style={[styles.box, { height: height as number, backgroundColor: p.surface3 }]} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={GENT_REGION}
        minZoomLevel={11}
        maxZoomLevel={18}
        userInterfaceStyle={p.scheme}
        showsCompass={false}
        onMapReady={onReady}
        onRegionChangeComplete={setRegion}
        onPress={(e) => {
          setSheet(null)
          onMapClick?.(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)
        }}>
        {showLez &&
          lez?.map((poly, i) => (
            <Polygon key={i} coordinates={poly.coordinates} holes={poly.holes} strokeColor={p.lezLine} fillColor={p.lezFill} strokeWidth={2} lineDashPattern={[6, 6]} />
          ))}

        {route && (
          <Polyline
            coordinates={route.points.map((q) => ({ latitude: q.lat, longitude: q.lon }))}
            strokeColor={route.mode === 'foot-walking' ? '#475569' : route.mode === 'cycling-regular' ? '#16a34a' : '#d94a4a'}
            strokeWidth={route.mode === 'foot-walking' ? 4 : 5}
            lineDashPattern={route.mode === 'foot-walking' ? [2, 8] : undefined}
            lineCap="round"
          />
        )}

        {route && dot(route.start, '#2563eb', 'Start')}
        {route && dot(route.end, '#c2410c', 'Bestemming')}

        {ordered.map((pk) => (
          <PinMarker
            key={pk.slug}
            ref={(r) => {
              markers.current.set(pk.slug, r)
            }}
            coordinate={{ latitude: pk.lat, longitude: pk.lon }}
            title={pk.name}
            description={describe(pk)}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={pk.isPublic ? 2 : 1}
            version={`${pk.status?.available}-${pk.status?.isOpen}-${bluePins}`}
            onPress={() => onSelect?.(pk.slug)}>
            {bluePins ? <BluePin /> : <ParkingPin parking={pk} />}
            <Callout tooltip onPress={() => !hoverInfo && router.push({ pathname: '/parking/[slug]', params: { slug: pk.slug } })}>
              <View style={[styles.callout, { borderColor: p.border }]}>
                <ParkingCallout p={pk} withLink={!hoverInfo} />
              </View>
            </Callout>
          </PinMarker>
        ))}

        {ezpark && (
          <>
            {ezpark.start && dot(ezpark.start, '#2563eb', 'Start')}
            {ezpark.end && dot(ezpark.end, '#c2410c', 'Bestemming')}
            {ezpark.parks.map((park) => (
              <PinMarker
                key={`ez-${park.slug}`}
                coordinate={{ latitude: park.lat, longitude: park.lon }}
                title={park.name}
                zIndex={1000}
                anchor={{ x: 0.5, y: 0.5 }}
                version={park.slug}
                onPress={() => onEzParkPick?.(park.slug)}>
                <BluePin size={34} />
                <Callout tooltip>
                  <View style={[styles.callout, { borderColor: p.border }]}>
                    <Txt variant="strong" style={{ color: '#111827' }}>{park.name}</Txt>
                    {park.available != null && park.capacity > 0 ? (
                      <Bar available={park.available} capacity={park.capacity} />
                    ) : (
                      <Txt variant="small" style={{ color: '#111827' }}>Beschikbaarheid onbekend</Txt>
                    )}
                    {park.details.map((d) => <Txt key={d} variant="small" style={{ color: '#111827' }}>{d}</Txt>)}
                  </View>
                </Callout>
              </PinMarker>
            ))}
            {ezpark.legs.map((leg, i) => {
              if (leg.coordinates.length < 2) return null
              const coords = leg.coordinates.map(([lat, lon]) => ({ latitude: lat!, longitude: lon! }))
              const transitColor = leg.color ? `#${leg.color}` : leg.mode === 'tram' ? '#d97706' : '#0f766e'
              const mid = coords[Math.floor(coords.length / 2)]!
              return (
                <Fragment key={`leg-${i}`}>
                  <Polyline
                    coordinates={coords}
                    strokeColor={leg.mode === 'drive' ? '#d94a4a' : leg.mode === 'walk' ? '#475569' : transitColor}
                    strokeWidth={leg.mode === 'drive' ? 5 : leg.mode === 'walk' ? 4 : 6}
                    lineDashPattern={leg.mode === 'walk' ? [2, 8] : undefined}
                    lineCap="round"
                  />
                  {(leg.mode === 'bus' || leg.mode === 'tram') && leg.line ? (
                    <Marker coordinate={mid} tracksViewChanges={false} anchor={{ x: 0.5, y: 0.5 }}>
                      <LineBadge line={leg.line} color={transitColor} />
                    </Marker>
                  ) : null}
                </Fragment>
              )
            })}
          </>
        )}

        {clusters.map((c) => (
          <PinMarker
            key={`ev-${c.items.map((i) => i.event.id).join('|')}`}
            coordinate={{ latitude: c.lat, longitude: c.lon }}
            zIndex={500}
            anchor={{ x: 0.5, y: 0.5 }}
            version={c.items.length}
            title={c.items.length > 1 ? `${c.items.length} evenementen` : c.items[0]!.event.name}
            onPress={() => setSheet(c.items)}>
            <EventPin count={c.items.length} />
          </PinMarker>
        ))}

        {friends && friends.length > 0 && <FriendMarkers friends={friends} />}
      </MapView>

      {sheet && (
        <View style={[styles.sheet, { backgroundColor: p.surface, borderColor: p.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8 }}>
            <Txt variant="smallMuted">{sheet.length === 1 ? '1 evenement' : `${sheet.length} evenementen`}</Txt>
            <Btn label="Sluiten" size="sm" variant="ghost" onPress={() => setSheet(null)} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
            {sheet.map((item) => (
              <MapEventCard
                key={item.event.id}
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
      <Pressable onPress={onDetails} style={{ width: 84, backgroundColor: p.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        {e.coverImageUrl ? (
          <Image source={{ uri: e.coverImageUrl }} style={{ width: 84, height: '100%', minHeight: 84 }} />
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
    borderRadius: Radius.md,
    borderWidth: 1,
  },
})
