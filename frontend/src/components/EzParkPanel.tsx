import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { transitFareLabel } from '../fare'
import { textOn } from './ParkingMap'
import { GarageRate, ManualRateInfo, EndTimeSelect, endOptions, estimateCost } from './RateInfo'
import type { RoutePoint } from './RouteInputs'
import type { EzParkLeg, EzParkOption, EzParkResult, EzParkVariant, ParkingRate } from '../types'

export type EzPoint = RoutePoint

export interface EzOverlay {
  start: EzPoint | null
  end: EzPoint | null
  legs: EzParkLeg[]
  variant: EzParkVariant | null
  parkingName: string | null
  parks: Array<{ lat: number; lon: number; name: string; slug: string; details: string[]; available: number | null; capacity: number }>
}

interface Props {
  avoidLez: boolean
  start: EzPoint | null
  end: EzPoint | null
  canPlan: boolean
  resolveStart: () => Promise<EzPoint>
  resolveEnd: () => Promise<EzPoint>
  departInMinutes: () => number
  /** De gedeelde invoervelden van de routeplanner. */
  fields: ReactNode
  /** Schakelaars van de routeplanner, zodat ze in dezelfde rij als de invoervelden staan. */
  toggles: ReactNode
  /** Waar de suggesties en het traject getoond worden (het Routeoverzicht). */
  overviewEl: HTMLElement | null
  hint: string | null
  onOverlay: (overlay: EzOverlay) => void
  /** Een P-speld op de kaart is aangeklikt; kiest de snelste variant van die parking. */
  pick: { slug: string; n: number } | null
}

export function EzParkPanel({ avoidLez, start, end, canPlan, resolveStart, resolveEnd, departInMinutes, fields, toggles, overviewEl, hint, onOverlay, pick }: Props) {
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
      details: [
        `rijden ${Math.round(o.driveMinutes)} min (${o.driveKm.toFixed(1)} km) · parkeren ${o.parkMinutes} min`,
      ],
      available: o.available,
      capacity: o.capacity,
    }))
    onOverlay({ start, end, legs: variant?.legs ?? [], variant, parkingName: option?.name ?? null, parks })
  }, [start, end, variant, option, result, onOverlay])

  useEffect(() => {
    const picked = pick && result?.options.find((o) => o.slug === pick.slug)
    if (picked) setSelected({ slug: picked.slug, type: bestVariant(picked).type })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick])

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

  // Zodra start en bestemming bekend zijn (of de LEZ-keuze wijzigt) wordt meteen gezocht.
  useEffect(() => {
    if (start && end) void plan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, avoidLez])

  return (
    <div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {fields}

        {toggles}

        <button className="btn btn-primary" style={{ minWidth: 150, whiteSpace: 'nowrap' }} onClick={plan} disabled={loading || !canPlan}>
          {loading ? 'Zoeken…' : 'Zoek parkings'}
        </button>
      </div>

      {hint && <p className="note">{hint}</p>}
      {error && <div className="banner" style={{ marginTop: 12 }}>{error}</div>}
      {result?.warning && <div className="banner" style={{ marginTop: 12 }}>{result.warning}</div>}

      {overviewEl && createPortal(
        <>
          {result && result.options.length > 0 && !selected && (
            <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
              {result.options.map((o) => (
                <OptionCard key={o.slug} option={o} selected={selected} onSelect={(type) => setSelected({ slug: o.slug, type })} />
              ))}
            </div>
          )}

          {variant && option && (
            <>
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                <span>Gekozen: <strong>{option.name}</strong> · {variant.type === 'walk' ? 'te voet' : 'OV'}</span>
                <button className="btn" onClick={() => setSelected(null)}>Andere optie kiezen</button>
              </div>
              <Legs variant={variant} rate={option.rate} manualRate={option.manualRate} />
            </>
          )}

          {!result && <p className="note">Kies start en bestemming en druk op “Zoek parkings”; de suggesties verschijnen hier.</p>}
        </>,
        overviewEl,
      )}
    </div>
  )
}

function OccupancyBar({ available, capacity }: { available: number | null; capacity: number }) {
  if (available == null || capacity <= 0) return <div className="small muted">Beschikbaarheid onbekend</div>
  const pct = Math.min(100, Math.max(0, Math.round(((capacity - available) / capacity) * 100)))
  const color = pct < 50 ? '#16a34a' : pct < 80 ? '#f59e0b' : '#dc2626'
  return (
    <div className="row" style={{ marginTop: 6, gap: 10, flexWrap: 'nowrap', alignItems: 'center' }}>
      <div role="img" aria-label={`${pct} % bezet`} title={`${pct} % bezet`}
        style={{ width: 200, maxWidth: '100%', height: 8, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: color }} />
      </div>
      <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{available} vrij van {capacity}</span>
    </div>
  )
}

function bestVariant(o: EzParkOption): EzParkVariant {
  return o.variants.reduce((a, b) => (b.totalMinutes < a.totalMinutes ? b : a))
}

function OptionCard({ option, selected, onSelect }: {
  option: EzParkOption
  selected: { slug: string; type: EzParkVariant['type'] } | null
  onSelect: (type: EzParkVariant['type']) => void
}) {
  const best = bestVariant(option)
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>{option.name}</strong>
          <OccupancyBar available={option.available} capacity={option.capacity} />
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {option.variants.map((v) => {
          const active = selected?.slug === option.slug && selected.type === v.type
          return (
            <button key={v.type} className={`btn${active ? ' btn-primary' : ''}`} onClick={() => onSelect(v.type)}>
              {v.type === 'walk' ? 'Te voet' : 'OV'} · {Math.round(v.totalMinutes)} min · aankomst {formatTime(v.arrivalAt)}
              {v === best ? ' · snelst' : ''}
            </button>
          )
        })}
      </div>
      {option.manualRate
        ? <ManualRateInfo rate={option.manualRate} />
        : <GarageRate rate={option.rate} />}
    </div>
  )
}

export function Legs({ variant, rate, manualRate }: {
  variant: EzParkVariant
  rate?: ParkingRate
  manualRate?: EzParkOption['manualRate']
}) {
  const [idx, setIdx] = useState(0)
  const legs = variant.legs
  const minutes = legs.map((l) => Math.max(1, Math.round((new Date(l.arrivalAt).getTime() - new Date(l.departureAt).getTime()) / 60000)))
  const total = minutes.reduce((a, b) => a + b, 0)
  const colorOf = (l: EzParkLeg) => (l.color ? `#${l.color}` : LEG_COLOR[l.mode])
  const lineStyle = (l: EzParkLeg) => ({ borderLeftColor: colorOf(l), borderLeftStyle: l.mode === 'walk' ? ('dotted' as const) : ('solid' as const) })

  return (
    <div className="tl" style={{ marginTop: 16 }}>
      <h3>Jouw traject · {Math.round(variant.totalMinutes)} min</h3>
      {transitFareLabel(legs) && <p className="small muted">OV-ticket: <strong>{transitFareLabel(legs)}</strong> (overstappen inbegrepen)</p>}
      {legs.length > 0 && (
        <>
          <div className="tl-bar" aria-hidden="true" style={{ marginTop: 10 }}>
            {legs.map((l, i) => (
              <span key={i} style={{ flex: Math.max(minutes[i]!, total * 0.04), background: colorOf(l), opacity: l.mode === 'walk' ? 0.55 : 1 }} />
            ))}
          </div>
          <div className="tl-times small muted">
            <span>{formatTime(legs[0]!.departureAt)}</span>
            <span>{total} min</span>
            <span>{formatTime(legs[legs.length - 1]!.arrivalAt)}</span>
          </div>
        </>
      )}
      <ol className="tl-list">
        {legs.length > 0 && (
          <li className="tl-leg">
            <div className="tl-rail">
              <span className="tl-dot" aria-hidden="true" />
              <span className="tl-line" style={lineStyle(legs[0]!)} />
            </div>
            <div className="tl-body">
              <div className="small muted">Start · {formatTime(legs[0]!.departureAt)}</div>
              <strong>{legs[0]!.from}</strong>
            </div>
          </li>
        )}
        {legs.map((leg, i) => (
          <li className="tl-leg" key={`${leg.mode}-${i}`}>
            <div className="tl-rail">
              <span className="ov-mode" style={{ background: colorOf(leg), color: leg.color ? textOn(leg.color) : '#fff' }} aria-hidden="true">{legIcon(leg)}</span>
              <span className="tl-line" style={lineStyle(leg)} />
            </div>
            <div className="tl-body">
              <div className="tl-head">
                <strong>{legTitle(leg)}</strong>
                <span className="tl-dur">{minutes[i]} min</span>
              </div>
              <div className="small muted">{leg.mode === 'park' ? leg.from : `${leg.from} → ${leg.to}`}</div>
              <div className="small">
                {formatTime(leg.departureAt)}–{formatTime(leg.arrivalAt)}
                {leg.distanceKm > 0 ? ` · ${leg.distanceKm.toFixed(1)} km` : ''}
              </div>
              {leg.mode === 'park' && (manualRate
                ? <ManualRateInfo rate={manualRate} />
                : <ParkCost leg={leg} rate={rate} index={idx} onIndex={setIdx} />)}
            </div>
          </li>
        ))}
        {legs.length > 0 && (
          <li className="tl-leg">
            <div className="tl-rail"><span className="tl-dot" aria-hidden="true" /></div>
            <div className="tl-body">
              <div className="small muted">Aankomst · {formatTime(legs[legs.length - 1]!.arrivalAt)}</div>
              <strong>{legs[legs.length - 1]!.to}</strong>
            </div>
          </li>
        )}
      </ol>
    </div>
  )
}

function ParkCost({ leg, rate, index, onIndex }: {
  leg: EzParkLeg
  rate?: ParkingRate
  index: number
  onIndex: (i: number) => void
}) {
  const start = new Date(leg.departureAt)
  const chosen = endOptions(start)[index]
  const cost = rate ? estimateCost(rate, start, chosen.hours) : null

  return (
    <div className="small" style={{ marginTop: 6, display: 'grid', gap: 4 }}>
      <EndTimeSelect start={start} index={index} onIndex={onIndex} />
      <div>
        {formatTime(start.toISOString())}–{formatTime(chosen.end.toISOString())}
        {cost === null
          ? ' · tarief onbekend (zie website uitbater)'
          : <> · <strong>≈ € {cost.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></>}
      </div>
    </div>
  )
}

const LEG_COLOR = { drive: '#d94a4a', park: '#3b82f6', walk: '#2563eb', bus: '#0f766e', tram: '#d97706' } as const

function legIcon(leg: EzParkLeg): string {
  const { mode } = leg
  if (mode === 'bus' || mode === 'tram') return leg.line ?? (mode === 'tram' ? 'T' : 'B')
  return mode === 'drive' ? 'A' : mode === 'park' ? 'P' : '↗'
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

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
}
