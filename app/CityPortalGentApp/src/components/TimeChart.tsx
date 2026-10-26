import { useMemo, useState } from 'react'
import { LayoutChangeEvent, Pressable, View } from 'react-native'
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg'

import { Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { fmtChartStamp, nl } from '@/lib/format'
import type { Point } from '@/lib/types'

interface Props {
  points: Point[]
  /** Hoeveel plaatsen de parking heeft — de bovenkant van de schaal, zodat 40 vrij van 500 ook als weinig leest. */
  capacity: number
  height?: number
}

const PAD = { top: 12, right: 14, bottom: 22, left: 40 }

interface Tick {
  x: number
  label: string
}

function hourLabel(t: number): string {
  try {
    return new Date(t).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
  } catch {
    const d = new Date(t)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
}

/** Een handvol uurmarkeringen, niet één per meting. */
function hourTicks(t0: number, span: number, plotWidth: number): Tick[] {
  const wanted = 6
  const ticks: Tick[] = []
  let previous = ''
  for (let i = 0; i < wanted; i++) {
    const t = t0 + (span * i) / (wanted - 1)
    const label = hourLabel(t)
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

/** Het verloop van de vrije plaatsen; de schaal loopt van nul tot de capaciteit. */
export function TimeChart({ points, capacity, height = 180 }: Props) {
  const p = usePalette()
  const [width, setWidth] = useState(320)
  const [hover, setHover] = useState<number | null>(null)

  const plot = { w: Math.max(10, width - PAD.left - PAD.right), h: height - PAD.top - PAD.bottom }

  const { path, area, xs, top, ticks } = useMemo(() => {
    if (points.length === 0) {
      return { path: '', area: '', xs: [] as number[], top: Math.max(capacity, 1), ticks: [] as Tick[] }
    }
    const t0 = new Date(points[0]!.atUtc).getTime()
    const t1 = new Date(points[points.length - 1]!.atUtc).getTime()
    const span = Math.max(1, t1 - t0)
    const highest = Math.max(capacity, ...points.map((q) => q.available), 1)
    const xs = points.map((q) => PAD.left + ((new Date(q.atUtc).getTime() - t0) / span) * plot.w)
    const ys = points.map((q) => PAD.top + plot.h - (q.available / highest) * plot.h)
    const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(' ')
    const base = (PAD.top + plot.h).toFixed(1)
    const area = `${path} L${xs[xs.length - 1]!.toFixed(1)},${base} L${xs[0]!.toFixed(1)},${base} Z`
    return { path, area, xs, top: highest, ticks: hourTicks(t0, span, plot.w) }
  }, [points, capacity, plot.w, plot.h])

  if (points.length < 2) {
    return <Txt variant="smallMuted" style={{ paddingVertical: 20 }}>Nog te weinig metingen om een verloop te tekenen.</Txt>
  }

  const active = hover === null ? null : points[hover]
  const activeX = hover === null ? null : xs[hover]
  const activeY = active == null ? null : PAD.top + plot.h - (active.available / top) * plot.h

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)

  return (
    <View onLayout={onLayout}>
      <Pressable
        onPressIn={(e) => setHover(nearest(xs, e.nativeEvent.locationX))}
        onTouchMove={(e) => setHover(nearest(xs, e.nativeEvent.locationX))}
        accessibilityRole="image"
        accessibilityLabel={`Vrije plaatsen, van ${fmtChartStamp(points[0]!.atUtc)} tot ${fmtChartStamp(points[points.length - 1]!.atUtc)}`}>
        <Svg width={width} height={height}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = PAD.top + plot.h - f * plot.h
            return (
              <G key={f}>
                <Line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke={p.grid} strokeWidth={1} />
                <SvgText x={PAD.left - 8} y={y + 4} fill={p.axis} fontSize={11} textAnchor="end">
                  {String(Math.round(f * top))}
                </SvgText>
              </G>
            )
          })}
          {ticks.map((t, i) => (
            <SvgText key={i} x={t.x} y={height - 6} fill={p.axis} fontSize={11} textAnchor="middle">
              {t.label}
            </SvgText>
          ))}
          <Path d={area} fill={p.c1} fillOpacity={0.14} />
          <Path d={path} fill="none" stroke={p.c1} strokeWidth={2} strokeLinejoin="round" />
          {activeX !== null && activeY !== null && (
            <>
              <Line x1={activeX} x2={activeX} y1={PAD.top} y2={PAD.top + plot.h} stroke={p.axis} strokeWidth={1} />
              <Circle cx={activeX} cy={activeY} r={5} fill={p.c1} stroke={p.surface} strokeWidth={2} />
            </>
          )}
        </Svg>
      </Pressable>
      {active && (
        <View accessibilityRole="summary" style={{ marginTop: 4 }}>
          <Txt style={{ fontWeight: '700' }}>{nl(active.available)} vrij</Txt>
          <Txt variant="smallMuted">{active.occupancy} % bezet · {fmtChartStamp(active.atUtc)}</Txt>
        </View>
      )}
    </View>
  )
}
