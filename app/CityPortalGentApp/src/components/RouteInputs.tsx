/* eslint-disable react-hooks/set-state-in-effect */
import * as Location from 'expo-location'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import type { TextInputProps } from 'react-native'

import { Icon } from '@/components/Icon'
import { Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { usePalette } from '@/context/ThemeContext'
import { api } from '@/lib/api'
import type { Parking, TransitStop } from '@/lib/types'

export interface RoutePoint {
  lat: number
  lon: number
  label: string
}

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

/** Invoerveld met het label als vast voorvoegsel binnen het kader. */
function PrefixInput({ prefix, right, style, ...rest }: { prefix: string; right?: ReactNode } & TextInputProps) {
  const p = usePalette()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: p.borderStrong,
        borderRadius: Radius.sm,
        backgroundColor: p.surface,
        minHeight: 44,
        paddingHorizontal: 10,
        gap: 8,
      }}>
      <Txt variant="smallMuted" style={{ fontWeight: '700', minWidth: 74 }}>{prefix}</Txt>
      <TextInput
        placeholderTextColor={p.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        {...rest}
        style={[{ flex: 1, paddingVertical: 7, color: p.ink, fontSize: 14, minWidth: 0 }, style]}
      />
      {right}
    </View>
  )
}

const two = (n: number) => String(n).padStart(2, '0')

/** Vertrekuur kiezen met uur- en minuutknoppen; leeg betekent "nu". */
function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const p = usePalette()
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  const base = () => {
    if (m) return Number(m[1]) * 60 + Number(m[2])
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  }
  const shift = (delta: number) => {
    const total = (((base() + delta) % 1440) + 1440) % 1440
    onChange(`${two(Math.floor(total / 60))}:${two(total % 60)}`)
  }
  // Bij ingedrukt houden herhaalt de knop; de interval leest altijd de nieuwste shift.
  const latestShift = useRef(shift)
  latestShift.current = shift
  const repeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const stopRepeat = () => {
    clearInterval(repeat.current)
    repeat.current = undefined
  }
  useEffect(() => stopRepeat, [])
  const step = (label: string, delta: number) => {
    // Minuten lopen bij vasthouden per 5, uren blijven per uur.
    const hold = Math.abs(delta) === 1 ? delta * 5 : delta
    return (
      <Pressable
        onPress={() => shift(delta)}
        onLongPress={() => {
          stopRepeat()
          latestShift.current(hold)
          repeat.current = setInterval(() => latestShift.current(hold), 225)
        }}
        delayLongPress={350}
        onPressOut={stopRepeat}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={4}
        style={{ width: 30, height: 30, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: p.brandSoft }}>
        <Txt style={{ color: p.brandStrong, fontWeight: '700', fontSize: 17, lineHeight: 20 }}>{delta > 0 ? '+' : '−'}</Txt>
      </Pressable>
    )
  }
  // Zonder gekozen uur tonen we het huidige uur gedempt; elke stap kiest dan een vast uur.
  const shown = m ? { h: two(Number(m[1])), min: m[2]! } : (() => {
    const t = base()
    return { h: two(Math.floor(t / 60) % 24), min: two(t % 60) }
  })()
  const part = (text: string) => (
    <Txt style={{ fontSize: 17, fontWeight: '700', minWidth: 26, textAlign: 'center', color: value ? p.ink : p.muted }}>{text}</Txt>
  )
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: p.borderStrong,
        borderRadius: Radius.sm,
        backgroundColor: p.surface,
        paddingHorizontal: 10,
        minHeight: 44,
        gap: 8,
      }}>
      <Txt variant="smallMuted" style={{ fontWeight: '700', minWidth: 74 }}>Vertrek</Txt>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        {step('Uur eerder', -60)}
        {part(shown.h)}
        {step('Uur later', 60)}
        <Txt style={{ fontSize: 17, fontWeight: '700', color: p.muted }}>:</Txt>
        {step('Minuut eerder', -1)}
        {part(shown.min)}
        {step('Minuut later', 1)}
      </View>
      <Pressable
        onPress={() => onChange('')}
        accessibilityRole="button"
        accessibilityState={{ selected: !value }}
        accessibilityLabel="Vertrek nu"
        hitSlop={6}
        style={{
          paddingVertical: 5,
          paddingHorizontal: 10,
          borderRadius: Radius.full,
          borderWidth: 1,
          borderColor: value ? p.borderStrong : p.brand,
          backgroundColor: value ? p.surface : p.brandSoft,
        }}>
        <Txt variant="small" style={{ fontWeight: '700', color: value ? p.ink2 : p.brandStrong }}>Nu</Txt>
      </Pressable>
    </View>
  )
}

/** Gedeelde invoer voor de gewone route en EZ Park: start, bestemming en vertrektijd. */
export function useRouteInputs(parkings: Parking[], mapClick: { lat: number; lon: number; n: number } | null, onSubmit?: () => void) {
  const p = usePalette()
  const [start, setStart] = useState<RoutePoint | null>(null)
  const [startText, setStartText] = useState('')
  const [end, setEnd] = useState<RoutePoint | null>(null)
  const [endText, setEndText] = useState('')
  const [stops, setStops] = useState<TransitStop[]>([])
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
      const { latitude, longitude } = pos.coords
      // Een emulator geeft vaak een vaste locatie (Californië); daarmee is geen route naar Gent mogelijk.
      if (Math.abs(latitude - 51.05) > 1.5 || Math.abs(longitude - 3.72) > 2.5) {
        setLocateError('Je toestel-locatie ligt te ver van Gent om een route te berekenen; typ een startpunt of klik het op de kaart.')
        return
      }
      setStart({ lat: latitude, lon: longitude, label: 'Mijn locatie' })
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
    if (!mapClick) return
    const point = { lat: mapClick.lat, lon: mapClick.lon, label: 'Gekozen op kaart' }
    if (!start && !startText.trim()) {
      setStart(point)
      setStartText(point.label)
    } else {
      setEnd(point)
      setEndText(point.label)
    }
    // Alleen een nieuwe klik (n) telt.
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
    <View style={{ gap: 4 }}>
      <View>
        <PrefixInput
          prefix="Start"
          value={startText}
          onChangeText={onStartText}
          placeholder="Adres of mijn locatie"
          onSubmitEditing={onSubmit}
          right={
            <Pressable
              onPress={() => void locate()}
              disabled={locating}
              accessibilityRole="button"
              accessibilityLabel="Gebruik mijn locatie"
              hitSlop={8}
              style={{ padding: 6, borderRadius: Radius.full, backgroundColor: p.brandSoft, opacity: locating ? 0.5 : 1 }}>
              <Icon name="locate" size={18} color={p.brandStrong} />
            </Pressable>
          }
        />
        <SuggestionList
          items={startSuggestions}
          onPick={(label) => {
            setStartText(label)
            setStart(null)
            clearStart()
          }}
        />
      </View>

      <View>
        <PrefixInput prefix="Bestemming" value={endText} onChangeText={onEndText} placeholder="Adres, parking of halte" onSubmitEditing={onSubmit} />
        <SuggestionList
          items={endSuggestions}
          onPick={(label) => {
            applyEndText(label)
            clearEnd()
          }}
        />
      </View>
    </View>
  )

  const departField: ReactNode = <TimeSelect value={departTime} onChange={setDepartTime} />

  const hint = null

  return {
    departField,
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
