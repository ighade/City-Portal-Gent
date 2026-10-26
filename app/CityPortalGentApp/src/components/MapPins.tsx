/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { Marker } from 'react-native-maps'
import type { MapMarkerProps } from 'react-native-maps'

import { Icon } from '@/components/Icon'
import { usePalette } from '@/context/ThemeContext'
import { levelColor } from '@/components/OccupancyMeter'
import { agoLabel, initial, isOffline, locationAge } from '@/lib/friendsUi'
import { textOn } from '@/lib/map'
import { busyness } from '@/lib/types'
import type { Friend, Parking } from '@/lib/types'

/**
 * Een marker met een eigen view. Native kaarten tekenen die view één keer als bitmap; daarom blijft
 * `tracksViewChanges` even aan en gaat daarna uit, anders zou elke marker de kaart blijven herschilderen.
 */
export function PinMarker({ children, version, ref, ...rest }: MapMarkerProps & { children: ReactNode; version?: string | number; ref?: Ref<InstanceType<typeof Marker>> }) {
  const [tracks, setTracks] = useState(true)
  useEffect(() => {
    setTracks(true)
    const id = setTimeout(() => setTracks(false), 900)
    return () => clearTimeout(id)
  }, [version])
  return (
    <Marker ref={ref} {...rest} tracksViewChanges={tracks}>
      {children}
    </Marker>
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

export function DotLabel({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: '#fff', marginBottom: 2 }}>
        <Text style={{ color: '#111827', fontSize: 11, fontWeight: '600' }}>{label}</Text>
      </View>
      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: color, borderWidth: 3, borderColor: '#fff' }} />
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
