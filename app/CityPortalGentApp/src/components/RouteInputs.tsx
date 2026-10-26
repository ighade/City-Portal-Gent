/* eslint-disable react-hooks/set-state-in-effect */
import * as Location from 'expo-location'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { Btn, Input, Label, Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { usePalette } from '@/context/ThemeContext'
import { api } from '@/lib/api'
import type { Parking, TransitStop } from '@/lib/types'

export interface RoutePoint {
  lat: number
  lon: number
  label: string
}

type Pick = 'start' | 'end' | null

/** Adresvoorstellen, alleen opgehaald door een toetsaanslag en niet door het kiezen van een voorstel. */
function useSuggestions() {
  const [items, setItems] = useState<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(0)

  const request = useCallback((text: string) => {
    clearTimeout(timer.current)
    const q = text.trim()
    const id = ++latest.current
    if (q.length < 3) {
      setItems([])
      return
    }
    timer.current = setTimeout(() => {
      api.suggest(q).then((r) => id === latest.current && setItems(r)).catch(() => id === latest.current && setItems([]))
    }, 350)
  }, [])

  const clear = useCallback(() => {
    clearTimeout(timer.current)
    latest.current++
    setItems([])
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])
  return [items, request, clear] as const
}

function SuggestionList({ items, onPick }: { items: string[]; onPick: (label: string) => void }) {
  const p = usePalette()
  if (items.length === 0) return null
  return (
    <View style={{ borderWidth: 1, borderColor: p.border, borderRadius: Radius.sm, backgroundColor: p.surface, overflow: 'hidden' }}>
      {items.slice(0, 6).map((label, i) => (
        <Pressable
          key={label}
          onPress={() => onPick(label)}
          style={{ paddingVertical: 9, paddingHorizontal: 10, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: p.border }}>
          <Txt variant="small">{label}</Txt>
        </Pressable>
      ))}
    </View>
  )
}

/** Gedeelde invoer voor de gewone route en EZ Park: start, bestemming en vertrektijd. */
export function useRouteInputs(parkings: Parking[], mapClick: { lat: number; lon: number; n: number } | null) {
  const [start, setStart] = useState<RoutePoint | null>(null)
  const [startText, setStartText] = useState('')
  const [end, setEnd] = useState<RoutePoint | null>(null)
  const [endText, setEndText] = useState('')
  const [stops, setStops] = useState<TransitStop[]>([])
  const [pick, setPick] = useState<Pick>(null)
  const [departTime, setDepartTime] = useState('')
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  useEffect(() => {
    api.transit.stops().then(setStops).catch(() => undefined)
  }, [])

  const locate = useCallback(async () => {
    setLocateError(null)
    setLocating(true)
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (perm.status !== 'granted') throw new Error('denied')
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      setStart({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Mijn locatie' })
      setStartText('Mijn locatie')
    } catch {
      setLocateError('Je locatie is niet beschikbaar; klik je startpunt op de kaart.')
    } finally {
      setLocating(false)
    }
  }, [])

  useEffect(() => {
    void locate()
  }, [locate])

  const clickN = mapClick?.n
  useEffect(() => {
    if (!mapClick || !pick) return
    const point = { lat: mapClick.lat, lon: mapClick.lon, label: 'Gekozen op kaart' }
    if (pick === 'start') {
      setStart(point)
      setStartText(point.label)
    } else {
      setEnd(point)
      setEndText(point.label)
    }
    setPick(null)
    // Alleen een nieuwe klik (n) telt, niet een wijziging van `pick`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickN])

  const places = useMemo(
    () => [
      ...parkings.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })),
      ...stops.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon })),
    ],
    [parkings, stops],
  )

  const [startSuggestions, suggestStart, clearStart] = useSuggestions()
  const [endSuggestions, suggestEnd, clearEnd] = useSuggestions()

  const sameLabel = (a: string, b: string) => a.trim().toLocaleLowerCase('nl-BE') === b.trim().toLocaleLowerCase('nl-BE')

  function onStartText(value: string) {
    setStartText(value)
    setStart(null)
    suggestStart(value)
  }

  function applyEndText(value: string) {
    setEndText(value)
    const place = places.find((p) => sameLabel(p.name, value))
    setEnd(place ? { lat: place.lat, lon: place.lon, label: place.name } : null)
  }

  function onEndText(value: string) {
    applyEndText(value)
    suggestEnd(value)
  }

  async function resolveStart(): Promise<RoutePoint> {
    if (start) return start
    const text = startText.trim()
    if (!text) throw new Error('Kies eerst een startpunt.')
    const hit = await api.geocode(text)
    setStart(hit)
    return hit
  }

  /** De gekozen bestemming, of een getypt adres dat eerst opgezocht wordt. */
  async function resolveEnd(): Promise<RoutePoint> {
    if (end) return end
    const text = endText.trim()
    if (!text) throw new Error('Kies eerst een bestemming.')
    const hit = await api.geocode(text)
    setEnd(hit)
    return hit
  }

  const chooseEnd = useCallback((point: RoutePoint) => {
    setEnd(point)
    setEndText(point.label)
    setPick(null)
    clearEnd()
  }, [clearEnd])

  function departInMinutes(): number {
    const m = /^(\d{1,2}):(\d{2})$/.exec(departTime.trim())
    if (!m) return 0
    const at = new Date()
    at.setHours(Number(m[1]), Number(m[2]), 0, 0)
    return Math.max(0, Math.round((at.getTime() - Date.now()) / 60000))
  }

  const fields: ReactNode = (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 6 }}>
        <Label>Start</Label>
        <Input value={startText} onChangeText={onStartText} placeholder="Adres of mijn locatie" />
        <SuggestionList
          items={startSuggestions}
          onPick={(label) => {
            setStartText(label)
            setStart(null)
            clearStart()
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn label={locating ? '…' : 'Mijn locatie'} onPress={() => void locate()} disabled={locating} />
          <Btn label="Op kaart" variant={pick === 'start' ? 'primary' : 'default'} onPress={() => setPick(pick === 'start' ? null : 'start')} />
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Label>Bestemming</Label>
        <Input value={endText} onChangeText={onEndText} placeholder="Adres, parking of halte" />
        <SuggestionList
          items={endSuggestions}
          onPick={(label) => {
            applyEndText(label)
            clearEnd()
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn label="Op kaart" variant={pick === 'end' ? 'primary' : 'default'} onPress={() => setPick(pick === 'end' ? null : 'end')} />
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Label>Vertrek (vandaag)</Label>
        <Input
          value={departTime}
          onChangeText={setDepartTime}
          placeholder="UU:MM"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          style={{ alignSelf: 'flex-start', minWidth: 110 }}
        />
      </View>
    </View>
  )

  const hint = pick
    ? `Klik op de kaart om je ${pick === 'start' ? 'startpunt' : 'bestemming'} te kiezen.`
    : null

  return {
    start,
    end,
    hasStart: start !== null || startText.trim() !== '',
    hasEnd: end !== null || endText.trim() !== '',
    resolveStart,
    resolveEnd,
    departTime,
    departInMinutes,
    fields,
    hint,
    locateError,
    chooseEnd,
  }
}
