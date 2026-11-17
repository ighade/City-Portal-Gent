import type { ReactNode } from 'react'
import { View } from 'react-native'

import { LegBadge } from '@/components/LegBadge'
import { Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import type { EzParkLeg } from '@/lib/types'

const BADGE = 30

/** Een stap van een traject: de OV-stappen en de auto-stappen delen dezelfde weergave. */
export type OverviewLeg = Pick<EzParkLeg, 'mode' | 'line' | 'from' | 'to' | 'departureAt' | 'arrivalAt' | 'distanceKm' | 'color'> & {
  delayMinutes?: number
}

function legColor(leg: OverviewLeg): string {
  if (leg.color) return `#${leg.color}`
  switch (leg.mode) {
    case 'drive': return '#dc2626'
    case 'park': return '#3b82f6'
    case 'walk': return '#2563eb'
    case 'tram': return '#d97706'
    default: return '#0f766e'
  }
}

function legMinutes(leg: OverviewLeg): number {
  const minutes = Math.round((new Date(leg.arrivalAt).getTime() - new Date(leg.departureAt).getTime()) / 60000)
  // Parkeren bij de bestemming heeft geen eigen duur.
  return leg.mode === 'park' ? Math.max(0, minutes) : Math.max(1, minutes)
}

function legTitle(leg: OverviewLeg): string {
  switch (leg.mode) {
    case 'drive': return 'Drive'
    case 'park': return 'Park'
    case 'walk': return 'Walk'
    case 'tram': return `Tram ${leg.line ?? ''}`
    default: return `Bus ${leg.line ?? ''}`
  }
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
}

export function TransitLegsOverview({ legs, renderExtra }: { legs: OverviewLeg[]; renderExtra?: (leg: OverviewLeg, index: number) => ReactNode }) {
  const p = usePalette()
  const minutes = legs.map(legMinutes)
  const total = minutes.reduce((a, b) => a + b, 0)

  return (
    <View>
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, marginBottom: 6 }}>
        {legs.map((leg, i) => (
          <View
            key={`bar-${i}`}
            style={{
              flex: Math.max(minutes[i]!, total * 0.04),
              backgroundColor: legColor(leg),
              opacity: leg.mode === 'walk' ? 0.55 : 1,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
        <Txt variant="smallMuted">{legs.length ? hhmm(legs[0]!.departureAt) : ''}</Txt>
        <Txt variant="smallMuted">{total} min</Txt>
        <Txt variant="smallMuted">{legs.length ? hhmm(legs[legs.length - 1]!.arrivalAt) : ''}</Txt>
      </View>

      {legs.map((leg, i) => {
        const last = i === legs.length - 1
        const color = legColor(leg)
        const delayMinutes = leg.delayMinutes ?? 0
        const delayed = (leg.mode === 'bus' || leg.mode === 'tram') && delayMinutes >= 2
        const parked = leg.mode === 'park' && minutes[i] === 0
        return (
          <View key={`${leg.from}-${leg.to}-${i}`} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center', width: BADGE }}>
              <LegBadge mode={leg.mode} line={leg.line} color={leg.color} />
              {!last && (
                <View
                  style={{
                    flex: 1,
                    width: 0,
                    marginVertical: 2,
                    borderLeftWidth: 3,
                    borderLeftColor: color,
                    borderStyle: leg.mode === 'walk' ? 'dotted' : 'solid',
                    minHeight: 16,
                  }}
                />
              )}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Txt variant="strong" style={{ flexShrink: 1 }}>{legTitle(leg)}</Txt>
                {!parked && (
                  <View style={{ backgroundColor: p.brandSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Txt variant="small" style={{ fontWeight: '700' }}>{minutes[i]} min</Txt>
                  </View>
                )}
              </View>
              <Txt variant="smallMuted">{leg.mode === 'park' ? leg.from : `${leg.from} → ${leg.to}`}</Txt>
              <Txt variant="small">
                {parked ? `Arrival ${hhmm(leg.arrivalAt)}` : `${hhmm(leg.departureAt)}–${hhmm(leg.arrivalAt)}${leg.distanceKm > 0 ? ` · ${leg.distanceKm.toFixed(1)} km` : ''}`}
              </Txt>
              {renderExtra?.(leg, i)}
              {delayed && (
                <Txt variant="small" style={{ color: p.crit, fontWeight: '700' }}>+{delayMinutes} min delay</Txt>
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}
