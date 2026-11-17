import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Txt } from '@/components/ui'
import { usePalette, useTheme } from '@/context/ThemeContext'
import { fetchNearbyChargingStations, formatDistance } from '@/lib/chargingStations'
import type { ChargingStation } from '@/lib/chargingStations'

interface Props {
  destination: { lat: number; lon: number } | null
  selectedId: string | null
  onSelect: (id: string | null) => void
  onShownChange: (stations: ChargingStation[]) => void
  onRouteTo: (station: ChargingStation) => void
}

export function ChargingStationsMobile({ destination, selectedId, onSelect, onShownChange, onRouteTo }: Props) {
  const p = usePalette()
  const dark = useTheme().theme === 'dark'
  const [stations, setStations] = useState<ChargingStation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Er is geen live bezetting beschikbaar; de gebruiker kan een paal zelf als bezet markeren.
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const lat = destination?.lat
  const lon = destination?.lon

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(new Set())
    if (lat === undefined || lon === undefined) {
      setStations([])
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchNearbyChargingStations(lat, lon, 15, controller.signal)
      .then(setStations)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Laadpalen konden niet worden geladen.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [lat, lon])

  const shown = useMemo(() => stations.filter((s) => !busy.has(s.id)).slice(0, 5), [stations, busy])

  useEffect(() => {
    onShownChange(shown)
    if (selectedId && !shown.some((s) => s.id === selectedId)) onSelect(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])

  // Bij het verlaten van het paneel verdwijnen de laadpalen ook van de kaart.
  useEffect(() => () => { onShownChange([]); onSelect(null) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: 8 }}>
      {!destination && <Txt variant="note">Kies eerst een bestemming.</Txt>}
      {loading && <Txt variant="note">Laadpalen laden…</Txt>}
      {error && <Txt style={{ color: p.crit }}>{error}</Txt>}
      {!loading && !error && destination && shown.length === 0 && <Txt variant="note">Geen laadpalen gevonden.</Txt>}
      {shown.map((s, i) => {
        const sel = s.id === selectedId
        return (
        <Pressable
          key={s.id}
          onPress={() => onSelect(s.id)}
          style={{
            padding: 10,
            borderRadius: 8,
            borderWidth: sel ? 2 : 1,
            borderColor: sel ? (dark ? '#38bdf8' : '#0ea5e9') : i === 0 ? p.brand : p.border,
            backgroundColor: sel ? (dark ? '#0c4a6e' : '#e0f2fe') : i === 0 ? p.brandSoft : p.surface,
            gap: 6,
          }}>
          <Txt style={{ fontWeight: '600', color: sel ? (dark ? '#f0f9ff' : '#111827') : undefined }}>{s.street} · {formatDistance(s.distanceMeters)}</Txt>
          <Txt variant="small" style={{ color: sel ? (dark ? '#f0f9ff' : '#111827') : undefined }}>{[s.operator, s.type, s.kw ? `${s.kw} kW` : null, s.location].filter(Boolean).join(' · ')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable
              onPress={() => onRouteTo(s)}
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: p.brand }}>
              <Txt style={{ color: p.brandInk, fontWeight: '600' }}>Route hierheen</Txt>
            </Pressable>
            <Pressable
              onPress={() => setBusy(new Set(busy).add(s.id))}
              style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: p.borderStrong, backgroundColor: p.surface }}>
              <Txt>Bezet</Txt>
            </Pressable>
          </View>
        </Pressable>
        )
      })}
      {stations.length > 0 && <Txt variant="note">Live bezetting is niet beschikbaar. Markeer een paal als bezet om de volgende te zien.</Txt>}
    </View>
  )
}
