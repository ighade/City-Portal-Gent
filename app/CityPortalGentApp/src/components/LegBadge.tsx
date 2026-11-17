import { View } from 'react-native'

import { Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { textOn } from '@/lib/map'
import type { EzParkLeg } from '@/lib/types'

/** Eén stap van een traject: een rondje met het vervoermiddel. */
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
