import { View } from 'react-native'

import { Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { busyness, busynessLabel } from '@/lib/types'
import type { Busyness, Status } from '@/lib/types'
import { fmtDateTime, nl } from '@/lib/format'
import type { Palette } from '@/constants/theme'

export function levelColor(p: Palette, level: Busyness): string {
  switch (level) {
    case 'vrij': return p.levelVrij
    case 'rustig': return p.levelRustig
    case 'druk': return p.levelDruk
    case 'bijna-vol': return p.levelBijnaVol
    case 'vol': return p.levelVol
    default: return p.levelOnbekend
  }
}

/**
 * Hoe vol een parking is, als balk én als woord.
 *
 * De kleur draagt het nooit alleen: er staat altijd "Druk · 78 % · 112 vrij" bij. Dat is niet
 * alleen voor wie kleuren slecht onderscheidt — "bijna vol" en "druk" liggen in oranje dicht bij
 * elkaar, en het verschil is precies wat iemand wil weten die nog moet beslissen waar hij rijdt.
 */
export function OccupancyMeter({ status }: { status?: Status }) {
  const p = usePalette()
  const level = busyness(status)

  if (!status) {
    return <Txt variant="smallMuted" style={{ marginVertical: 4 }}>Van deze parking meet de stad de bezetting niet.</Txt>
  }
  if (!status.isOpen) {
    return (
      <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, backgroundColor: p.surface3 }}>
        <Txt variant="smallMuted" style={{ fontWeight: '600' }}>{status.temporarilyClosed ? 'Tijdelijk gesloten' : 'Gesloten'}</Txt>
      </View>
    )
  }

  const pct = status.occupancy
  const color = levelColor(p, level)
  const available = status.available == null ? 'onbekend' : nl(status.available)
  const label =
    pct === undefined || pct === null
      ? `${busynessLabel[level]}, ${available} vrije plaatsen`
      : `${busynessLabel[level]}, ${pct} procent bezet, ${available} vrije plaatsen`

  return (
    <View style={{ gap: 8 }}>
      <View
        accessibilityRole="image"
        accessibilityLabel={label}
        style={{ height: 10, borderRadius: 999, backgroundColor: p.surface3, overflow: 'hidden', borderWidth: 1, borderColor: p.border }}>
        {pct !== undefined && pct !== null && (
          <View style={{ width: `${Math.min(100, Math.max(2, pct))}%`, height: '100%', borderRadius: 999, backgroundColor: color }} />
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
        <Txt style={{ fontWeight: '700' }}>{busynessLabel[level]}</Txt>
        {pct !== undefined && pct !== null && <Txt variant="muted">{pct} % bezet</Txt>}
        <Txt style={{ marginLeft: 'auto' }}>
          <Txt style={{ fontWeight: '700' }}>{available}</Txt> vrij van {nl(status.capacity)}
        </Txt>
      </View>
      {status.available === null ? (
        <Txt variant="smallMuted">Het aantal vrije plaatsen is onbekend.</Txt>
      ) : pct === undefined || pct === null ? (
        <Txt variant="smallMuted">De stad meldt meer vrije plaatsen dan er plaatsen zijn; daarom staat er geen percentage.</Txt>
      ) : null}
      {status.isStale && (
        <Txt variant="smallMuted">Laatste meting van {fmtDateTime(new Date(status.measuredAtUtc))} — de bron loopt achter.</Txt>
      )}
    </View>
  )
}
