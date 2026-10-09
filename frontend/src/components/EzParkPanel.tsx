import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import type { RoutePoint } from './RouteInputs'
import type { EzParkLeg, EzParkOption, EzParkResult, EzParkVariant } from '../types'

export type EzPoint = RoutePoint

export interface EzOverlay {
  start: EzPoint | null
  end: EzPoint | null
  legs: EzParkLeg[]
  variant: EzParkVariant | null
  parkingName: string | null
  parks: Array<{ lat: number; lon: number; name: string }>
}

interface Props {
  avoidLez: boolean
  start: EzPoint | null
  end: EzPoint | null
  departInMinutes: () => number
  /** De gedeelde invoervelden van de routeplanner. */
  fields: ReactNode
  /** Schakelaars van de routeplanner, zodat ze in dezelfde rij als de invoervelden staan. */
  toggles: ReactNode
  /** Waar de suggesties en het traject getoond worden (het Routeoverzicht). */
  overviewEl: HTMLElement | null
  hint: string | null
  onOverlay: (overlay: EzOverlay) => void
}

export function EzParkPanel({ avoidLez, start, end, departInMinutes, fields, toggles, overviewEl, hint, onOverlay }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EzParkResult | null>(null)
  const [selected, setSelected] = useState<{ slug: string; type: EzParkVariant['type'] } | null>(null)

  const option = useMemo(() => result?.options.find((o) => o.slug === selected?.slug) ?? null, [result, selected])
  const variant = useMemo(() => option?.variants.find((v) => v.type === selected?.type) ?? null, [option, selected])

  useEffect(() => {
    const parks = (option ? [option] : result?.options ?? []).map((o) => ({ lat: o.lat, lon: o.lon, name: o.name }))
    onOverlay({ start, end, legs: variant?.legs ?? [], variant, parkingName: option?.name ?? null, parks })
  }, [start, end, variant, option, result, onOverlay])

  async function plan() {
    if (!start || !end) {
      setError('Kies een start en een bestemming.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setSelected(null)
    try {
      const res = await api.ezPark({
        startLat: start.lat,
        startLon: start.lon,
        endLat: end.lat,
        endLon: end.lon,
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

  return (
    <div>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {fields}

        {toggles}

        <button className="btn btn-primary" style={{ minWidth: 150, whiteSpace: 'nowrap' }} onClick={plan} disabled={loading || !start || !end}>
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
              <Legs variant={variant} />
            </>
          )}

          {!result && <p className="note">Kies start en bestemming en druk op “Zoek parkings”; de suggesties verschijnen hier.</p>}
        </>,
        overviewEl,
      )}
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
          <div className="small muted">
            {option.available} vrij van {option.capacity} · rijden {Math.round(option.driveMinutes)} min ({option.driveKm.toFixed(1)} km) · parkeren {option.parkMinutes} min
          </div>
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
    </div>
  )
}

export function Legs({ variant }: { variant: EzParkVariant }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3>Jouw traject · {Math.round(variant.totalMinutes)} min</h3>
      <div className="ov-legs">
        {variant.legs.map((leg, i) => (
          <div className="ov-leg" key={`${leg.mode}-${i}`}>
            <span className={`ov-mode ov-mode-${leg.mode}`} aria-hidden="true">{legIcon(leg.mode)}</span>
            <div>
              <strong>{legTitle(leg)}</strong>
              <div className="small muted">{leg.mode === 'park' ? leg.from : `${leg.from} → ${leg.to}`}</div>
              <div className="small">
                {formatTime(leg.departureAt)}–{formatTime(leg.arrivalAt)}
                {leg.distanceKm > 0 ? ` · ${leg.distanceKm.toFixed(1)} km` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function legIcon(mode: EzParkLeg['mode']): string {
  return mode === 'drive' ? 'A' : mode === 'park' ? 'P' : mode === 'walk' ? '↗' : mode === 'tram' ? 'T' : 'B'
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
