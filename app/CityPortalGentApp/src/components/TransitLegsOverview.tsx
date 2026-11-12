import { View } from 'react-native'

import { LegBadge } from '@/components/EzParkPanel'
import { Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import type { TransitLeg } from '@/lib/types'

const BADGE = 30

function legColor(leg: TransitLeg): string {
  if (leg.color) return `#${leg.color}`
  return leg.mode === 'walk' ? '#2563eb' : leg.mode === 'tram' ? '#d97706' : '#0f766e'
}

function legMinutes(leg: TransitLeg): number {
  return Math.max(1, Math.round((new Date(leg.arrivalAt).getTime() - new Date(leg.departureAt).getTime()) / 60000))
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
}

export function TransitLegsOverview({ legs }: { legs: TransitLeg[] }) {
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
        const delayed = leg.mode !== 'walk' && leg.delayMinutes >= 2
        const title = leg.mode === 'walk' ? 'Walk' : `${leg.mode === 'tram' ? 'Tram' : 'Bus'} ${leg.line ?? ''}`
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
                <Txt variant="strong" style={{ flexShrink: 1 }}>{title}</Txt>
                <View style={{ backgroundColor: p.brandSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                  <Txt variant="small" style={{ fontWeight: '700' }}>{minutes[i]} min</Txt>
                </View>
              </View>
              <Txt variant="smallMuted">{leg.from} → {leg.to}</Txt>
              <Txt variant="small">
                {hhmm(leg.departureAt)}–{hhmm(leg.arrivalAt)} · {leg.distanceKm.toFixed(1)} km
              </Txt>
              {delayed && (
                <Txt variant="small" style={{ color: p.crit, fontWeight: '700' }}>+{leg.delayMinutes} min delay</Txt>
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}
