/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'

import { EndTimeSelect, endOptions, estimateCost, GarageRate, ManualRateInfo } from '@/components/RateInfo'
import type { RoutePoint } from '@/components/RouteInputs'
import { Banner, Btn, Card, Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { api } from '@/lib/api'
import { transitFareLabel } from '@/lib/fare'
import { textOn } from '@/lib/map'
import type { EzParkLeg, EzParkOption, EzParkResult, EzParkVariant, ParkingRate } from '@/lib/types'

export type EzPoint = RoutePoint

export interface EzOverlay {
  start: EzPoint | null
  end: EzPoint | null
  legs: EzParkLeg[]
  variant: EzParkVariant | null
  parkingName: string | null
  parks: { lat: number; lon: number; name: string; slug: string; details: string[]; available: number | null; capacity: number }[]
}

interface Props {
  avoidLez: boolean
  start: EzPoint | null
  end: EzPoint | null
  canPlan: boolean
  resolveStart: () => Promise<EzPoint>
  resolveEnd: () => Promise<EzPoint>
  departInMinutes: () => number
  hint: string | null
  onOverlay: (overlay: EzOverlay) => void
  /** Een P-speld op de kaart is aangetikt; kiest de snelste variant van die parking. */
  pick: { slug: string; n: number } | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const formatTime = (value: string) => {
  const d = new Date(value)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function bestVariant(o: EzParkOption): EzParkVariant {
  return o.variants.reduce((a, b) => (b.totalMinutes < a.totalMinutes ? b : a))
}

/**
 * EZ Park: de invoer en de knop (`controls`) staan in het formulier, de voorstellen en het
 * gekozen traject (`overview`) in het Routeoverzicht.
 */
export function useEzPark({ avoidLez, start, end, canPlan, resolveStart, resolveEnd, departInMinutes, hint, onOverlay, pick }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EzParkResult | null>(null)
  const [selected, setSelected] = useState<{ slug: string; type: EzParkVariant['type'] } | null>(null)

  const option = useMemo(() => result?.options.find((o) => o.slug === selected?.slug) ?? null, [result, selected])
  const variant = useMemo(() => option?.variants.find((v) => v.type === selected?.type) ?? null, [option, selected])

  useEffect(() => {
    const parks = (option ? [option] : result?.options ?? []).map((o) => ({
      lat: o.lat,
      lon: o.lon,
      name: o.name,
      slug: o.slug,
      details: [`rijden ${Math.round(o.driveMinutes)} min (${o.driveKm.toFixed(1)} km) · parkeren ${o.parkMinutes} min`],
      available: o.available,
      capacity: o.capacity,
    }))
    onOverlay({ start, end, legs: variant?.legs ?? [], variant, parkingName: option?.name ?? null, parks })
  }, [start, end, variant, option, result, onOverlay])

  const pickN = pick?.n
  useEffect(() => {
    const picked = pick && result?.options.find((o) => o.slug === pick.slug)
    if (picked) setSelected({ slug: picked.slug, type: bestVariant(picked).type })
    // Alleen een nieuwe aantik (n) telt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickN])

  async function plan() {
    if (!canPlan) {
      setError('Kies een start en een bestemming.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setSelected(null)
    try {
      const [from, to] = await Promise.all([resolveStart(), resolveEnd()])
      const res = await api.ezPark({
        startLat: from.lat,
        startLon: from.lon,
        endLat: to.lat,
        endLon: to.lon,
        departInMinutes: departInMinutes(),
        avoidLez,
      })
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'EZ Park kon niet berekend worden.')
    } finally {
      setLoading(false)
    }
  }

  const controls = (
    <View style={{ gap: 10 }}>
      {loading && <Txt variant="note" style={{ marginTop: 0 }}>Parkings zoeken…</Txt>}
      {hint && <Txt variant="note" style={{ marginTop: 0 }}>{hint}</Txt>}
      {error && <Banner style={{ marginBottom: 0 }}>{error}</Banner>}
      {result?.warning && <Banner style={{ marginBottom: 0 }}>{result.warning}</Banner>}
    </View>
  )

  const overview = (
    <View>
      {result && result.options.length > 0 && !selected && (
        <View style={{ gap: 12, marginTop: 16 }}>
          {result.options.map((o) => (
            <OptionCard key={o.slug} option={o} selected={selected} onSelect={(type) => setSelected({ slug: o.slug, type })} />
          ))}
        </View>
      )}

      {variant && option && (
        <>
          <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <Txt style={{ flex: 1 }}>
              Gekozen: <Txt variant="strong">{option.name}</Txt> · {variant.type === 'walk' ? 'te voet' : 'OV'}
            </Txt>
            <Btn label="Andere optie kiezen" onPress={() => setSelected(null)} />
          </View>
          <Legs variant={variant} rate={option.rate} manualRate={option.manualRate} />
        </>
      )}

      {!result && <Txt variant="note">Kies start en bestemming en druk op “Zoek parkings”; de suggesties verschijnen hier.</Txt>}
    </View>
  )

  return { controls, overview, plan }
}

function OccupancyBar({ available, capacity }: { available: number | null; capacity: number }) {
  const p = usePalette()
  if (available == null || capacity <= 0) return <Txt variant="smallMuted">Beschikbaarheid onbekend</Txt>
  const pct = Math.min(100, Math.max(0, Math.round(((capacity - available) / capacity) * 100)))
  const color = pct < 50 ? '#16a34a' : pct < 80 ? '#f59e0b' : '#dc2626'
  return (
    <View style={{ marginTop: 6, gap: 4 }}>
      <View accessibilityLabel={`${pct} % bezet`} accessibilityRole="image" style={{ width: 200, maxWidth: '100%', height: 8, borderRadius: 999, backgroundColor: p.surface3, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(2, pct)}%`, height: '100%', backgroundColor: color }} />
      </View>
      <Txt variant="smallMuted">{available} vrij van {capacity}</Txt>
    </View>
  )
}

function OptionCard({ option, selected, onSelect }: {
  option: EzParkOption
  selected: { slug: string; type: EzParkVariant['type'] } | null
  onSelect: (type: EzParkVariant['type']) => void
}) {
  const best = bestVariant(option)
  return (
    <Card style={{ padding: 12, marginBottom: 0 }}>
      <Txt variant="strong">{option.name}</Txt>
      <OccupancyBar available={option.available} capacity={option.capacity} />
      <View style={{ gap: 8, marginTop: 8 }}>
        {option.variants.map((v) => {
          const active = selected?.slug === option.slug && selected.type === v.type
          return (
            <Btn
              key={v.type}
              variant={active ? 'primary' : 'default'}
              onPress={() => onSelect(v.type)}
              label={`${v.type === 'walk' ? 'Te voet' : 'OV'} · ${Math.round(v.totalMinutes)} min · aankomst ${formatTime(v.arrivalAt)}${v === best ? ' · snelst' : ''}`}
            />
          )
        })}
      </View>
      {option.manualRate ? <ManualRateInfo rate={option.manualRate} /> : <GarageRate rate={option.rate} />}
    </Card>
  )
}

/** Eén stap van een traject: een rondje met het vervoermiddel en de uren eronder. */
export function LegBadge({ mode, line, color }: { mode: EzParkLeg['mode']; line?: string; color?: string }) {
  const p = usePalette()
  const transit = mode === 'bus' || mode === 'tram'
  const bg = color ? `#${color}` : mode === 'drive' ? p.crit : mode === 'park' ? '#3b82f6' : mode === 'walk' ? '#2563eb' : mode === 'tram' ? '#d97706' : '#0f766e'
  const text = color ? textOn(color) : '#fff'
  const label = transit && line ? line : mode === 'drive' ? 'A' : mode === 'park' ? 'P' : mode === 'walk' ? '↗' : mode === 'tram' ? 'T' : 'B'
  return (
    <View style={{ minWidth: 30, height: 30, paddingHorizontal: 6, borderRadius: 15, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt style={{ color: text, fontWeight: '700', fontSize: 13, lineHeight: 16 }}>{label}</Txt>
    </View>
  )
}

export function Legs({ variant, rate, manualRate }: {
  variant: EzParkVariant
  rate?: ParkingRate
  manualRate?: EzParkOption['manualRate']
}) {
  const [idx, setIdx] = useState(0)
  const fare = transitFareLabel(variant.legs)

  return (
    <View style={{ marginTop: 16 }}>
      <Txt variant="h3">Jouw traject · {Math.round(variant.totalMinutes)} min</Txt>
      {fare && (
        <Txt variant="smallMuted">OV-ticket: <Txt variant="small" style={{ fontWeight: '700' }}>{fare}</Txt> (overstappen inbegrepen)</Txt>
      )}
      <View style={{ gap: 12, marginTop: 8 }}>
        {variant.legs.map((leg, i) => (
          <View key={`${leg.mode}-${i}`} style={{ flexDirection: 'row', gap: 10 }}>
            <LegBadge mode={leg.mode} color={leg.color} />
            <View style={{ flex: 1 }}>
              <Txt variant="strong">{legTitle(leg)}</Txt>
              <Txt variant="smallMuted">{leg.mode === 'park' ? leg.from : `${leg.from} → ${leg.to}`}</Txt>
              <Txt variant="small">
                {formatTime(leg.departureAt)}–{formatTime(leg.arrivalAt)}
                {leg.distanceKm > 0 ? ` · ${leg.distanceKm.toFixed(1)} km` : ''}
              </Txt>
              {leg.mode === 'park' && (manualRate ? <ManualRateInfo rate={manualRate} /> : <ParkCost leg={leg} rate={rate} index={idx} onIndex={setIdx} />)}
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

function ParkCost({ leg, rate, index, onIndex }: {
  leg: EzParkLeg
  rate?: ParkingRate
  index: number
  onIndex: (i: number) => void
}) {
  const start = new Date(leg.departureAt)
  const chosen = endOptions(start)[index]!
  const cost = rate ? estimateCost(rate, start, chosen.hours) : null

  return (
    <View style={{ marginTop: 6, gap: 4 }}>
      <EndTimeSelect start={start} index={index} onIndex={onIndex} />
      <Txt variant="small">
        {formatTime(start.toISOString())}–{formatTime(chosen.end.toISOString())}
        {cost === null ? (
          ' · tarief onbekend (zie website uitbater)'
        ) : (
          <>
            {' · '}
            <Txt variant="small" style={{ fontWeight: '700' }}>
              ≈ € {cost.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Txt>
          </>
        )}
      </Txt>
    </View>
  )
}

function legTitle(leg: EzParkLeg): string {
  switch (leg.mode) {
    case 'drive': return 'Rijden'
    case 'park': return 'Parkeren'
    case 'walk': return 'Wandelen'
    case 'tram': return `Tram ${leg.line ?? ''}`
    default: return `Bus ${leg.line ?? ''}`
  }
}
