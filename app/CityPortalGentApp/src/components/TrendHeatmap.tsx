import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { nl } from '@/lib/format'
import type { Trend, TrendCell } from '@/lib/types'

const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

/** Zes stappen van één kleur. De grenzen lopen gelijk met de woorden in `types.ts`. */
function step(occupancy: number): number {
  if (occupancy >= 90) return 5
  if (occupancy >= 75) return 4
  if (occupancy >= 60) return 3
  if (occupancy >= 40) return 2
  if (occupancy >= 20) return 1
  return 0
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Het gemiddelde per weekdag en uur over de bewaarde metingen, als rooster. */
export function TrendHeatmap({ trend }: { trend: Trend }) {
  const p = usePalette()
  const [hover, setHover] = useState<TrendCell | null>(null)

  const grid = useMemo(() => {
    const map = new Map<string, TrendCell>()
    for (const c of trend.cells) map.set(`${c.weekday}-${c.hour}`, c)
    return map
  }, [trend.cells])

  if (trend.cells.length === 0) {
    return (
      <Txt variant="smallMuted" style={{ paddingVertical: 20 }}>
        Er zijn nog te weinig metingen bewaard om een patroon te tonen. Dat komt vanzelf: er wordt elke vijf minuten gemeten.
      </Txt>
    )
  }

  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        <View style={{ width: 22 }} />
        {Array.from({ length: 24 }, (_, h) => (
          <View key={h} style={{ flex: 1, alignItems: 'center', overflow: 'visible' }}>
            <Txt variant="smallMuted" numberOfLines={1} style={{ fontSize: 9, lineHeight: 12 }}>
              {h % 3 === 0 ? pad2(h) : ''}
            </Txt>
          </View>
        ))}
      </View>
      {DAYS.map((label, d) => (
        <View key={label} style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
          <View style={{ width: 22 }}>
            <Txt variant="smallMuted" style={{ fontSize: 11 }}>{label}</Txt>
          </View>
          {Array.from({ length: 24 }, (_, h) => {
            const cell = grid.get(`${d}-${h}`)
            return (
              <Pressable
                key={h}
                onPress={() => setHover(cell ?? null)}
                accessibilityLabel={
                  cell
                    ? `${label} ${pad2(h)}:00 — gemiddeld ${cell.occupancy} % bezet (${cell.samples} metingen)`
                    : `${label} ${pad2(h)}:00 — geen metingen`
                }
                style={{
                  flex: 1,
                  height: 22,
                  borderRadius: 3,
                  backgroundColor: cell ? p.heat[step(cell.occupancy)] : 'transparent',
                  borderWidth: cell ? 0 : 1,
                  borderStyle: cell ? 'solid' : 'dashed',
                  borderColor: p.border,
                }}
              />
            )
          })}
        </View>
      ))}
      <View style={{ gap: 6, marginTop: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Txt variant="smallMuted">leeg</Txt>
          {[0, 20, 40, 60, 80, 100].map((v) => (
            <View key={v} style={{ width: 18, height: 12, borderRadius: 3, backgroundColor: p.heat[step(v === 100 ? 100 : v)] }} />
          ))}
          <Txt variant="smallMuted">vol</Txt>
        </View>
        <Txt variant="small" style={{ color: p.muted }}>
          {hover ? (
            <>
              <Txt variant="small" style={{ fontWeight: '700' }}>{DAYS[hover.weekday]} {pad2(hover.hour)}:00</Txt>
              {` — gemiddeld ${hover.occupancy} % bezet over ${nl(hover.samples)} ${hover.samples === 1 ? 'meting' : 'metingen'}`}
            </>
          ) : (
            `Gemiddelde bezetting over de laatste ${trend.days} dagen, in Belgische tijd.`
          )}
        </Txt>
      </View>
    </View>
  )
}
