import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import { LegBadge } from '@/components/EzParkPanel'
import { Card, Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { api } from '@/lib/api'
import type { TransitDeparturesResult } from '@/lib/types'

const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function TransitDeparturesPanel({ stopId, stopName, onClose }: { stopId: string; stopName: string; onClose: () => void }) {
  const p = usePalette()
  const [data, setData] = useState<TransitDeparturesResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    const load = () => api.transit.departures(stopId)
      .then((r) => { if (alive) { setData(r); setError(null) } })
      .catch(() => { if (alive) setError('Vertrektijden konden niet geladen worden.') })
    void load()
    const timer = setInterval(load, 30000)
    return () => { alive = false; clearInterval(timer) }
  }, [stopId])

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Txt variant="strong" style={{ flexShrink: 1 }}>Volgende vertrekken · {data?.stopName ?? stopName}</Txt>
        <Pressable onPress={onClose} accessibilityLabel="Sluiten" hitSlop={10}><Txt variant="strong">✕</Txt></Pressable>
      </View>
      {error && <Txt variant="note" style={{ color: p.critInk }}>{error}</Txt>}
      {!data && !error && <Txt variant="note">Laden…</Txt>}
      {data && !data.realtimeAvailable && <Txt variant="note">Live vertragingen zijn momenteel niet beschikbaar; dit zijn de geplande uren.</Txt>}
      {data && data.departures.length === 0 && <Txt variant="note">Geen vertrekken in de komende uren.</Txt>}
      {data?.departures.map((d, i) => {
        const late = !d.canceled && d.delayMinutes >= 2
        return (
          <View key={`${d.line}-${d.scheduledAt}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
            <LegBadge mode={d.mode === 'tram' ? 'tram' : 'bus'} line={d.line} color={d.color && d.color !== 'FFFFFF' ? d.color : undefined} />
            <Txt numberOfLines={1} style={{ flex: 1, textDecorationLine: d.canceled ? 'line-through' : 'none', color: d.canceled ? p.critInk : undefined }}>{d.destination ?? ''}</Txt>
            {(d.canceled || late) && <Txt variant="small" style={{ textDecorationLine: 'line-through' }}>{hhmm(d.scheduledAt)}</Txt>}
            {!d.canceled && <Txt variant="strong">{hhmm(d.expectedAt)}</Txt>}
            {d.canceled && <Txt style={{ backgroundColor: p.crit, color: '#fff', fontWeight: '700', fontSize: 12, paddingHorizontal: 8, borderRadius: 10, overflow: 'hidden' }}>Geschrapt</Txt>}
            {late && <Txt style={{ backgroundColor: p.warn, color: '#fff', fontWeight: '700', fontSize: 12, paddingHorizontal: 8, borderRadius: 10, overflow: 'hidden' }}>+{d.delayMinutes} min</Txt>}
          </View>
        )
      })}
    </Card>
  )
}
