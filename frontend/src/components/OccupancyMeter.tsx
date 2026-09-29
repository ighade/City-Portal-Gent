import { busyness, busynessLabel } from '../types'
import type { Status } from '../types'

/**
 * Hoe vol een parking is, als balk én als woord.
 *
 * De kleur draagt het nooit alleen: er staat altijd "Druk · 78 % · 112 vrij" bij. Dat is niet
 * alleen voor wie kleuren slecht onderscheidt — "bijna vol" en "druk" liggen in oranje dicht bij
 * elkaar, en het verschil is precies wat iemand wil weten die nog moet beslissen waar hij rijdt.
 */
export function OccupancyMeter({ status, size = 'normal' }: { status?: Status; size?: 'normal' | 'compact' }) {
  const level = busyness(status)

  if (!status) {
    return <p className="meter-empty small muted">Van deze parking meet de stad de bezetting niet.</p>
  }
  if (!status.isOpen) {
    return (
      <div className={`meter meter-${size}`}>
        <span className="pill pill-grey">{status.temporarilyClosed ? 'Tijdelijk gesloten' : 'Gesloten'}</span>
      </div>
    )
  }

  const pct = status.occupancy
  return (
    <div className={`meter meter-${size}`}>
      <div className="meter-bar" role="img" aria-label={meterLabel(status)}>
        {pct !== undefined && pct !== null && (
          <span className={`meter-fill level-${level}`} style={{ width: `${Math.max(2, pct)}%` }} />
        )}
      </div>
      <div className="meter-legend">
        <span className={`dot level-${level}`} aria-hidden="true" />
        <b>{busynessLabel[level]}</b>
        {pct !== undefined && pct !== null && <span className="muted">{pct} % bezet</span>}
        <span className="meter-free">
          <b>{status.available.toLocaleString('nl-BE')}</b> vrij van {status.capacity.toLocaleString('nl-BE')}
        </span>
      </div>
      {pct === undefined || pct === null ? (
        <p className="small muted meter-note">
          De stad meldt meer vrije plaatsen dan er plaatsen zijn; daarom staat er geen percentage.
        </p>
      ) : null}
      {status.isStale && (
        <p className="small muted meter-note">
          Laatste meting van {new Date(status.measuredAtUtc).toLocaleString('nl-BE')} — de bron loopt achter.
        </p>
      )}
    </div>
  )
}

function meterLabel(status: Status): string {
  const level = busynessLabel[busyness(status)]
  return status.occupancy === undefined || status.occupancy === null
    ? `${level}, ${status.available} vrije plaatsen`
    : `${level}, ${status.occupancy} procent bezet, ${status.available} vrije plaatsen`
}
