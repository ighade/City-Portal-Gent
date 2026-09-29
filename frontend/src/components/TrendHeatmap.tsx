import { useMemo, useState } from 'react'
import type { Trend, TrendCell } from '../types'

const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

/**
 * "Hoe druk is het hier normaal?" — het gemiddelde per weekdag en uur over de bewaarde metingen.
 *
 * <b>Waarom een rooster en geen lijnen.</b> Zeven lijnen over vierentwintig uur is een kluwen, en
 * de vraag is niet hoe dinsdag zich tot woensdag verhoudt maar wanneer het rustig is. Een rooster
 * laat dat patroon in één oogopslag zien: de ochtendspits als donkere kolom, het weekend als
 * lichte hoek.
 *
 * <b>De kleurschaal is één kleur, licht naar donker</b> — dat is de regel voor een grootte, en
 * geen regenboog: meer inkt betekent voller. In het donkere thema draait die schaal om (donker
 * naar licht), want daar is *meer licht* wat opvalt tegen het vlak.
 *
 * <b>Een leeg vakje is leeg.</b> Onder drie metingen rekent de backend geen gemiddelde uit; dan
 * staat hier een lege cel in plaats van één toevallige meting die als "normaal" leest.
 */
export function TrendHeatmap({ trend }: { trend: Trend }) {
  const [hover, setHover] = useState<TrendCell | null>(null)

  const grid = useMemo(() => {
    const map = new Map<string, TrendCell>()
    for (const c of trend.cells) map.set(`${c.weekday}-${c.hour}`, c)
    return map
  }, [trend.cells])

  if (trend.cells.length === 0) {
    return (
      <p className="chart-empty muted small">
        Er zijn nog te weinig metingen bewaard om een patroon te tonen. Dat komt vanzelf: er wordt
        elke vijf minuten gemeten.
      </p>
    )
  }

  return (
    <div className="heatmap">
      <div className="heatmap-grid" onMouseLeave={() => setHover(null)}>
        <div className="heatmap-corner" />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={`h${h}`} className="heatmap-hour">
            {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
          </div>
        ))}

        {DAYS.map((label, d) => (
          <Row key={label} label={label} day={d} grid={grid} onHover={setHover} />
        ))}
      </div>

      <div className="heatmap-foot">
        <div className="heatmap-scale" aria-hidden="true">
          <span className="muted small">leeg</span>
          {[0, 20, 40, 60, 80, 100].map((v) => (
            <span key={v} className="heatmap-swatch" data-step={step(v)} />
          ))}
          <span className="muted small">vol</span>
        </div>
        <p className="small muted">
          {hover ? (
            <>
              <b>
                {DAYS[hover.weekday]} {String(hover.hour).padStart(2, '0')}:00
              </b>{' '}
              — gemiddeld {hover.occupancy} % bezet over {hover.samples.toLocaleString('nl-BE')}{' '}
              {hover.samples === 1 ? 'meting' : 'metingen'}
            </>
          ) : (
            <>Gemiddelde bezetting over de laatste {trend.days} dagen, in Belgische tijd.</>
          )}
        </p>
      </div>
    </div>
  )
}

function Row({
  label,
  day,
  grid,
  onHover,
}: {
  label: string
  day: number
  grid: Map<string, TrendCell>
  onHover: (c: TrendCell | null) => void
}) {
  return (
    <>
      <div className="heatmap-day">{label}</div>
      {Array.from({ length: 24 }, (_, h) => {
        const cell = grid.get(`${day}-${h}`)
        return (
          <div
            key={h}
            className="heatmap-cell"
            data-step={cell ? step(cell.occupancy) : 'leeg'}
            title={
              cell
                ? `${label} ${String(h).padStart(2, '0')}:00 — gemiddeld ${cell.occupancy} % bezet (${cell.samples} metingen)`
                : `${label} ${String(h).padStart(2, '0')}:00 — geen metingen`
            }
            onMouseEnter={() => onHover(cell ?? null)}
          />
        )
      })}
    </>
  )
}

/** Zes stappen van één kleur. De grenzen lopen gelijk met de woorden in `types.ts`. */
function step(occupancy: number): string {
  if (occupancy >= 90) return '6'
  if (occupancy >= 75) return '5'
  if (occupancy >= 60) return '4'
  if (occupancy >= 40) return '3'
  if (occupancy >= 20) return '2'
  return '1'
}
