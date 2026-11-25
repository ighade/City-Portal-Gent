import { useState } from 'react'
import type { ReactNode } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { ViewAnnotation } from '@maplibre/maplibre-react-native'

import { Icon } from '@/components/Icon'
import { usePalette } from '@/context/ThemeContext'
import { levelColor } from '@/components/OccupancyMeter'
import { agoLabel, initial, isOffline, locationAge } from '@/lib/friendsUi'
import { textOn } from '@/lib/map'
import { RENTAL_BIKE_ICONS } from '@/lib/rentalBikes'
import type { RentalBikeProvider } from '@/lib/rentalBikes'
import { busyness } from '@/lib/types'
import type { Friend, Parking } from '@/lib/types'
export interface PinMarkerProps {
  id: string
  lat: number
  lon: number
  onPress?: () => void
  /** Waar de speld op de coördinaat zit: midden (de meeste pinnen) of onderkant (de punt van een pin). */
  anchor?: 'center' | 'bottom'
  children: ReactNode
  /** Popup boven de speld; wordt alleen getoond als `open` waar is. */
  callout?: ReactNode
  open?: boolean
}

/**
 * Een speld als React-view op de kaart. De popup is een tweede view boven de speld, die alleen bestaat
 * terwijl hij open is, zodat er niet voortdurend extra views op de kaart staan.
 */
export function PinMarker({ id, lat, lon, onPress, anchor = 'center', children, callout, open = false }: PinMarkerProps) {
  const lngLat: [number, number] = [lon, lat]
  return (
    <>
      <ViewAnnotation id={id} lngLat={lngLat} anchor={anchor} onPress={onPress ? () => onPress() : undefined}>
        <>{children}</>
      </ViewAnnotation>
      {open && callout ? (
        <ViewAnnotation id={`${id}-callout`} lngLat={lngLat} anchor="bottom" offset={[0, -24]}>
          <>{callout}</>
        </ViewAnnotation>
      ) : null}
    </>
  )
}

export function compact(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  return String(n)
}

export const BLUE = '#3b82f6'

/** De blauwe P-speld (routepagina, EZ Park). */
export function BluePin({ size = 30 }: { size?: number }) {
  return (
    <View style={[styles.round, { width: size, height: size, borderRadius: size / 2, backgroundColor: BLUE, borderColor: '#fff' }]}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.53 }}>P</Text>
    </View>
  )
}

export function RentalBikePin({ provider, selected }: { provider: RentalBikeProvider; selected: boolean }) {
  // De kaart maakt een momentopname van de view; zonder fade en met een herrender na het laden is die niet meer wit.
  const [, setLoaded] = useState(false)
  return (
    <View style={{
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: '#fff',
      borderWidth: selected ? 4 : 3,
      borderColor: selected ? '#facc15' : '#fff',
    }}>
      <Image
        source={RENTAL_BIKE_ICONS[provider]}
        fadeDuration={0}
        onLoad={() => setLoaded(true)}
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  )
}

/** Laadpaal-speld: bliksemicoon; lichtblauw, en de geselecteerde paal is groter en paars (merkkleur). */
export function ChargingPin({ selected }: { selected: boolean }) {
  const pal = usePalette()
  const size = selected ? 42 : 34
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: selected ? pal.brand : '#38bdf8',
      borderWidth: 3,
      borderColor: '#fff',
    }}>
      <Text style={{ fontSize: selected ? 22 : 18, color: selected ? pal.brandInk : '#0c4a6e', fontWeight: '800' }}>⚡</Text>
    </View>
  )
}

/** De drukte-speld van een parking: aantal vrij in een kleur, vierkant voor fietsen, open ring zonder meting. */
export function ParkingPin({ parking: p }: { parking: Parking }) {
  const pal = usePalette()
  const level = busyness(p.status)
  const open = p.status?.isOpen !== false
  const bg = levelColor(pal, level)
  const ink = level === 'druk' ? '#1a1205' : '#ffffff'

  if (p.kind === 'bicycle' && p.status) {
    return (
      <View style={[styles.square, { backgroundColor: bg, opacity: p.isPublic ? 1 : 0.58, borderStyle: p.isPublic ? 'solid' : 'dashed' }]}>
        <Text style={[styles.pinText, { color: ink }]}>{compact(p.status.available)}</Text>
      </View>
    )
  }

  if (!p.hasLiveData || !p.status) {
    return (
      <View style={[styles.round, { width: 34, height: 34, borderRadius: 17, backgroundColor: pal.surface, borderColor: pal.muted, borderStyle: 'dashed' }]}>
        <Text style={[styles.pinText, { color: pal.ink }]}>{compact(p.capacity)}</Text>
      </View>
    )
  }

  return (
    <View style={[styles.round, { width: 38, height: 38, borderRadius: 19, backgroundColor: bg, borderColor: '#fff' }]}>
      <Text style={[styles.pinText, { color: ink }]}>{open ? compact(p.status.available) : '—'}</Text>
    </View>
  )
}

/** Kalenderspeld; bij meerdere evenementen staat het aantal erop. */
export function EventPin({ count }: { count: number }) {
  const pal = usePalette()
  return (
    <View style={[styles.round, { width: 30, height: 30, borderRadius: 15, backgroundColor: pal.brand, borderColor: '#fff' }]}>
      <Icon name="calendar" color={pal.brandInk} size={16} />
      {count > 1 && (
        <View style={styles.count}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{count}</Text>
        </View>
      )}
    </View>
  )
}

/** Vriend met profielfoto; offline krijgt een grijze rand en de tijd erbij. */
export function FriendPin({ friend }: { friend: Friend }) {
  const pal = usePalette()
  const off = isOffline(friend)
  const age = locationAge(friend)
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          overflow: 'hidden',
          borderWidth: 3,
          borderColor: off ? '#94a3b8' : '#fff',
          backgroundColor: pal.brand,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {friend.avatar ? (
          <Image source={{ uri: friend.avatar }} style={{ width: '100%', height: '100%' }} />
        ) : (
          <Text style={{ color: pal.brandInk, fontWeight: '700', fontSize: 16 }}>{initial(friend.username)}</Text>
        )}
      </View>
      {off && age !== null && (
        <View style={{ marginTop: 2, paddingHorizontal: 5, borderRadius: 8, backgroundColor: 'rgba(15,23,42,0.85)' }}>
          <Text style={{ color: '#fff', fontSize: 9 }}>{agoLabel(age)}</Text>
        </View>
      )}
    </View>
  )
}

export function LineBadge({ line, color }: { line: string; color: string }) {
  const hex = color.replace('#', '')
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, backgroundColor: color, borderWidth: 1, borderColor: '#fff' }}>
      <Text style={{ color: textOn(hex), fontSize: 11, fontWeight: '700' }}>{line}</Text>
    </View>
  )
}

/** Start (blauw) en einde (oranje): een label met het woord erin en een pijltje naar het punt. */
export function DotLabel({ label }: { label: string; color?: string }) {
  const isStart = label === 'Start'
  const color = isStart ? '#2563eb' : '#c2410c'
  return (
    <View style={{ width: 48, height: 32, alignItems: 'center' }}>
      <View
        style={{
          width: 44,
          height: 22,
          borderRadius: 11,
          backgroundColor: '#fff',
          borderWidth: 2,
          borderColor: color,
          overflow: 'hidden',
        }}>
        <Text allowFontScaling={false} numberOfLines={1} style={{ width: 40, height: 18, color, fontSize: 11, lineHeight: 18, fontWeight: '700', textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false }}>{isStart ? 'Start' : 'Eind'}</Text>
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 5,
          borderRightWidth: 5,
          borderTopWidth: 7,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: color,
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  round: { alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  square: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' },
  pinText: { fontWeight: '700', fontSize: 13 },
  count: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
})
