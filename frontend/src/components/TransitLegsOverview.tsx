import { textOn } from './ParkingMap'
import type { TransitLeg } from '../types'

export type OverviewLeg = Omit<TransitLeg, 'mode'> & { mode: TransitLeg['mode'] | 'bike' | 'car' }

const FALLBACK = { walk: '#2563eb', bus: '#0f766e', tram: '#d97706', bike: '#16a34a', car: '#d94a4a' } as const
const TITLE = { walk: 'Wandelen', bike: 'Fietsen', car: 'Rijden', bus: 'Bus', tram: 'Tram' } as const
const BADGE = { walk: '↗', bike: 'F', car: 'A', bus: 'B', tram: 'T' } as const

const legColor = (leg: OverviewLeg) => (leg.color ? `#${leg.color}` : FALLBACK[leg.mode])
const legMinutes = (leg: OverviewLeg) =>
  Math.max(1, Math.round((new Date(leg.arrivalAt).getTime() - new Date(leg.departureAt).getTime()) / 60000))
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })

export function TransitLegsOverview({ legs, startLabel, endLabel }: { legs: OverviewLeg[]; startLabel?: string; endLabel?: string }) {
  if (legs.length === 0) return null
  const minutes = legs.map(legMinutes)
  const total = minutes.reduce((a, b) => a + b, 0)

  return (
    <div className="tl" style={{ marginTop: 16 }}>
      <div className="tl-bar" aria-hidden="true">
        {legs.map((leg, i) => (
          <span
            key={i}
            style={{ flex: Math.max(minutes[i]!, total * 0.04), background: legColor(leg), opacity: leg.mode === 'walk' ? 0.55 : 1 }}
          />
        ))}
      </div>
      <div className="tl-times small muted">
        <span>{hhmm(legs[0]!.departureAt)}</span>
        <span>{total} min</span>
        <span>{hhmm(legs[legs.length - 1]!.arrivalAt)}</span>
      </div>

      <ol className="tl-list">
        <li className="tl-leg">
          <div className="tl-rail">
            <span className="tl-dot" aria-hidden="true" />
            <span className="tl-line" style={{ borderLeftColor: legColor(legs[0]!), borderLeftStyle: legs[0]!.mode === 'walk' ? 'dotted' : 'solid' }} />
          </div>
          <div className="tl-body">
            <div className="small muted">Start · {hhmm(legs[0]!.departureAt)}</div>
            <strong>{startLabel ?? legs[0]!.from}</strong>
          </div>
        </li>
        {legs.map((leg, i) => {
          const color = legColor(leg)
          const delayed = (leg.mode === 'bus' || leg.mode === 'tram') && leg.delayMinutes >= 2
          return (
            <li className="tl-leg" key={`${leg.from}-${leg.to}-${i}`}>
              <div className="tl-rail">
                <span
                  className="ov-mode"
                  style={{ background: color, color: leg.color ? textOn(leg.color) : '#fff' }}
                  aria-hidden="true"
                >
                  {leg.mode === 'tram' || leg.mode === 'bus' ? leg.line ?? BADGE[leg.mode] : BADGE[leg.mode]}
                </span>
                <span className="tl-line" style={{ borderLeftColor: color, borderLeftStyle: leg.mode === 'walk' ? 'dotted' : 'solid' }} />
              </div>
              <div className="tl-body">
                <div className="tl-head">
                  <strong>{`${TITLE[leg.mode]} ${leg.mode === 'bus' || leg.mode === 'tram' ? leg.line ?? '' : ''}`.trim()}</strong>
                  <span className="tl-dur">{minutes[i]} min</span>
                </div>
                <div className="small muted">{leg.from} → {leg.to}</div>
                <div className="small">{hhmm(leg.departureAt)}–{hhmm(leg.arrivalAt)} · {leg.distanceKm.toFixed(1)} km</div>
                {delayed && <span className="dep-badge dep-badge-late">+{leg.delayMinutes} min vertraging</span>}
              </div>
            </li>
          )
        })}
        <li className="tl-leg">
          <div className="tl-rail"><span className="tl-dot" aria-hidden="true" /></div>
          <div className="tl-body">
            <div className="small muted">Aankomst · {hhmm(legs[legs.length - 1]!.arrivalAt)}</div>
            <strong>{endLabel ?? legs[legs.length - 1]!.to}</strong>
          </div>
        </li>
      </ol>
    </div>
  )
}
