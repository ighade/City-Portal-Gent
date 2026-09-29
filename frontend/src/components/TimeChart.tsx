import { useMemo, useState } from 'react'
import type { Point } from '../types'

interface Props {
  points: Point[]
  /** Hoeveel plaatsen de parking heeft — de bovenkant van de schaal, zodat 40 vrij van 500 ook als weinig leest. */
  capacity: number
  height?: number
}

const PAD = { top: 12, right: 14, bottom: 22, left: 40 }

/**
 * Het verloop van de vrije plaatsen over het gekozen venster.
 *
 * <b>Eén reeks, dus geen legende</b> — de titel erboven zegt al wat er getekend staat. Wel een
 * draadkruis met een tooltip, want dat is de enige manier om een los tijdstip af te lezen zonder
 * elk punt van een getal te voorzien.
 *
 * <b>De schaal begint op nul en eindigt op de capaciteit</b>, niet op het hoogste gemeten punt.
 * Een grafiek die op het maximum inzoomt maakt van "tussen 380 en 420 vrij" een bergketen, en
 * dat is precies de verkeerde indruk: die parking stond de hele dag zo goed als leeg.
 */
export function TimeChart({ points, capacity, height = 180 }: Props) {
  const [hover, setHover] = useState<number | null>(null)

  const width = 720
  const plot = {
    w: width - PAD.left - PAD.right,
    h: height - PAD.top - PAD.bottom,
  }

  const { path, area, xs, top, ticks } = useMemo(() => {
    if (points.length === 0) {
      return { path: '', area: '', xs: [] as number[], top: Math.max(capacity, 1), ticks: [] as Tick[] }
    }

    const t0 = new Date(points[0]!.atUtc).getTime()
    const t1 = new Date(points[points.length - 1]!.atUtc).getTime()
    const span = Math.max(1, t1 - t0)
    const highest = Math.max(capacity, ...points.map((p) => p.available), 1)

    const xs = points.map((p) => PAD.left + ((new Date(p.atUtc).getTime() - t0) / span) * plot.w)
    const ys = points.map((p) => PAD.top + plot.h - (p.available / highest) * plot.h)

    const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(' ')
    const area = `${path} L${xs[xs.length - 1]!.toFixed(1)},${(PAD.top + plot.h).toFixed(1)} L${xs[0]!.toFixed(1)},${(PAD.top + plot.h).toFixed(1)} Z`

    return { path, area, xs, top: highest, ticks: hourTicks(t0, span, plot.w) }
  }, [points, capacity, plot.w, plot.h])

  if (points.length < 2) {
    return <p className="chart-empty muted small">Nog te weinig metingen om een verloop te tekenen.</p>
  }

  const active = hover === null ? null : points[hover]
  const activeX = hover === null ? null : xs[hover]
  const activeY =
    active === undefined || active === null ? null : PAD.top + plot.h - (active.available / top) * plot.h

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={`Vrije plaatsen, van ${fmt(points[0]!.atUtc)} tot ${fmt(points[points.length - 1]!.atUtc)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - box.left) / box.width) * width
          setHover(nearest(xs, x))
        }}
      >
        {/* Rooster en assen blijven terugtredend: ze zijn er om af te lezen, niet om te lezen. */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = PAD.top + plot.h - f * plot.h
          return (
            <g key={f}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} className="chart-grid" />
              <text x={PAD.left - 8} y={y + 4} className="chart-tick" textAnchor="end">
                {Math.round(f * top)}
              </text>
            </g>
          )
        })}
        {ticks.map((t) => (
          <text key={t.x} x={t.x} y={height - 6} className="chart-tick" textAnchor="middle">
            {t.label}
          </text>
        ))}

        <path d={area} className="chart-area" />
        <path d={path} className="chart-line" />

        {activeX !== null && activeY !== null && (
          <g className="chart-cursor">
            <line x1={activeX} x2={activeX} y1={PAD.top} y2={PAD.top + plot.h} />
            {/* De ring in de kleur van het vlak houdt de speld leesbaar bovenop de lijn. */}
            <circle cx={activeX} cy={activeY} r={5} className="chart-dot" />
          </g>
        )}
      </svg>

      {active && (
        <div
          className="chart-tip"
          style={{ left: `${((activeX ?? 0) / width) * 100}%` }}
          role="status"
          aria-live="polite"
        >
          <b>{active.available.toLocaleString('nl-BE')} vrij</b>
          <span className="muted">
            {active.occupancy} % bezet · {fmt(active.atUtc)}
          </span>
        </div>
      )}
    </div>
  )
}

interface Tick {
  x: number
  label: string
}

/** Een handvol uurmarkeringen, niet één per meting: 288 labels op een dag is geen as. */
function hourTicks(t0: number, span: number, plotWidth: number): Tick[] {
  const wanted = 6
  const ticks: Tick[] = []
  let previous = ''
  for (let i = 0; i < wanted; i++) {
    const t = t0 + (span * i) / (wanted - 1)
    const label = new Date(t).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
    // Zes keer "10:23" is geen as. Beslaat de reeks minder dan een handvol minuten — wat gebeurt
    // zodra een plek pas net gemeten wordt — dan blijft alleen het eerste en het laatste staan.
    ticks.push({ x: PAD.left + ((t - t0) / span) * plotWidth, label: label === previous ? '' : label })
    previous = label
  }
  return ticks
}

function nearest(xs: number[], x: number): number | null {
  if (xs.length === 0) return null
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i]! - x)
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('nl-BE', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
