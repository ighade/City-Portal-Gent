import { useState } from 'react'
import { Modal, Pressable, ScrollView, View } from 'react-native'

import { Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { usePalette } from '@/context/ThemeContext'
import { openExternal } from '@/lib/links'
import { euro } from '@/lib/format'
import type { ManualParkingRate, ParkingRate, StreetParking, StreetTariff } from '@/lib/types'

const hhmm = (d: Date) => d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })

function periodKeyAt(d: Date): ParkingRate['periods'][number]['key'] {
  if (d.getHours() < 7 || d.getHours() >= 19) return 'night'
  const day = d.getDay()
  return day === 0 ? 'sunday' : day === 6 ? 'saturday' : 'weekday'
}

/** Indicatieve kost: uur per uur het uurtarief, begrensd door het dagmaximum per 24 u en de nachtregel "N uur en langer: € X". */
export function estimateCost(rate: ParkingRate, start: Date, hours: number): number {
  const night = rate.periods.find((p) => p.key === 'night')
  const flat = night?.extra?.match(/(\d+) uur en langer: € ([\d.,]+)/)
  const flatAfter = flat ? Number(flat[1]) : null
  const flatAmount = flat ? Number(flat[2]!.replace(',', '.')) : null

  let total = 0
  for (let block = 0; block < hours; block += 24) {
    const blockStart = new Date(start.getTime() + block * 3600000)
    let blockCost = 0
    let nightHours = 0
    let nightCost = 0

    for (let h = block; h < Math.min(hours, block + 24); h++) {
      const at = new Date(start.getTime() + h * 3600000)
      const period = rate.periods.find((p) => p.key === periodKeyAt(at))
      if (!period) continue
      if (period.key === 'night') {
        nightHours++
        nightCost += period.hourlyEur
      } else {
        blockCost += period.hourlyEur
      }
    }

    if (flatAfter !== null && flatAmount !== null && nightHours >= flatAfter) nightCost = Math.min(nightCost, flatAmount)
    blockCost += nightCost

    const cap = rate.periods.find((p) => p.key === periodKeyAt(blockStart))?.dayMaxEur
    total += cap ? Math.min(blockCost, cap) : blockCost
  }

  return total
}

const zoneColor: Record<StreetParking['zone'], string> = {
  rood: '#e53935',
  oranje: '#fb8c00',
  geel: '#fdd835',
  groen: '#43a047',
  blauw: '#1e88e5',
}

/** Hele uren na `start` (24 stuks); de kost wordt over het afgeronde aantal uren berekend. */
export function endOptions(start: Date) {
  const first = new Date(start)
  first.setMinutes(0, 0, 0)
  first.setHours(first.getHours() + 1)
  return Array.from({ length: 24 }, (_, i) => {
    const end = new Date(first.getTime() + i * 3600000)
    const day = end.toDateString() === start.toDateString() ? '' : ` (${end.toLocaleDateString('nl-BE', { weekday: 'short' })})`
    return { end, hours: Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 3600000)), label: `${hhmm(end)}${day}` }
  })
}

export function EndTimeSelect({ start, index, onIndex }: { start: Date; index: number; onIndex: (i: number) => void }) {
  const p = usePalette()
  const [open, setOpen] = useState(false)
  const options = endOptions(start)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <Txt variant="smallMuted">Parkeren tot</Txt>
      <Pressable
        onPress={() => setOpen(true)}
        style={{ paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: p.borderStrong, borderRadius: Radius.sm, backgroundColor: p.surface }}>
        <Txt variant="small">{options[index]?.label ?? ''} ▾</Txt>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: p.overlay, justifyContent: 'center', padding: 32 }}>
          <View style={{ backgroundColor: p.surface, borderRadius: Radius.md, maxHeight: '70%', borderWidth: 1, borderColor: p.border }}>
            <ScrollView>
              {options.map((o, i) => (
                <Pressable
                  key={o.label}
                  onPress={() => {
                    onIndex(i)
                    setOpen(false)
                  }}
                  style={{ paddingVertical: 12, paddingHorizontal: 16, backgroundColor: i === index ? p.brandSoft : 'transparent' }}>
                  <Txt style={{ fontWeight: i === index ? '700' : '400' }}>{o.label}</Txt>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

/** Indicatieve straatkost vanaf `start`: uur per uur het tarief van dat tijdvak, met het dagtarief als plafond. */
export function estimateStreetCost(info: StreetParking, start: Date, hours: number): { cost: number; tooLong: string | null } {
  const amount = (period: StreetTariff['period'], h: number) =>
    info.tariffs.find((t) => t.period === period && t.hours === h)?.amountEur
  const dayCap = amount('dag', 0)
  const maxDayHours = Math.max(0, ...info.tariffs.filter((t) => t.period === 'dag').map((t) => t.hours))

  const perDay = new Map<string, { cost: number; hours: number }>()
  let evening = 0

  for (let h = 0; h < hours; h++) {
    const at = new Date(start.getTime() + h * 3600000)
    const hour = at.getHours()
    const sunday = at.getDay() === 0
    const paid = info.zone === 'rood' || info.zone === 'oranje'
      ? hour >= 9 && hour < 23
      : info.zone === 'geel' || info.zone === 'groen'
        ? !sunday && hour >= 9 && hour < 19
        : false
    if (!paid) continue

    if (hour < 19) {
      const key = at.toDateString()
      const d = perDay.get(key) ?? { cost: 0, hours: 0 }
      d.cost += amount('dag', 1) ?? 0
      d.hours += 1
      perDay.set(key, d)
    } else {
      evening += amount('avond', 1) ?? 0
    }
  }

  let cost = evening
  let tooLong: string | null = null
  for (const d of perDay.values()) {
    cost += dayCap !== undefined ? Math.min(d.cost, dayCap) : d.cost
    if (dayCap === undefined && maxDayHours > 0 && d.hours > maxDayHours) {
      tooLong = `In de ${info.name.toLowerCase()} mag je overdag (9–19 u) maximaal ${maxDayHours} uur parkeren.`
    }
  }

  return { cost, tooLong }
}

export function StreetRate({ info, arrival }: { info: StreetParking; arrival: Date | null }) {
  const [idx, setIdx] = useState(0)
  const start = arrival ?? new Date()
  const chosen = endOptions(start)[idx]!
  const { cost, tooLong } = estimateStreetCost(info, start, chosen.hours)

  return (
    <View style={{ marginTop: 16 }}>
      <Txt variant="h3">Parkeren op bestemming</Txt>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: zoneColor[info.zone] }} />
          <Txt variant="strong" style={{ flexShrink: 1 }}>{info.name}</Txt>
        </View>
        <Txt variant="strong">{info.zone === 'blauw' ? 'Gratis' : info.paidNow ? 'Nu betalend' : 'Nu gratis'}</Txt>
      </View>

      <EndTimeSelect start={start} index={idx} onIndex={setIdx} />
      <Txt variant="small" style={{ marginTop: 4 }}>
        {hhmm(start)}–{hhmm(chosen.end)} ·{' '}
        <Txt variant="small" style={{ fontWeight: '700' }}>
          {info.zone === 'blauw' ? 'gratis' : `≈ € ${cost.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </Txt>
      </Txt>
      {tooLong && <Txt variant="note">{tooLong}</Txt>}
    </View>
  )
}

export function GarageRate({ rate }: { rate?: ParkingRate }) {
  const p = usePalette()
  const [open, setOpen] = useState(false)
  if (!rate) return <Txt variant="smallMuted" style={{ marginTop: 8 }}>Tarief: zie de website van de uitbater</Txt>

  const active = rate.periods.find((q) => q.key === rate.activeKey) ?? rate.periods[0]!
  const text = (q: ParkingRate['periods'][number]) =>
    `${q.isMaximum ? 'Max. ' : ''}${euro(q.hourlyEur)} / uur${q.dayMaxEur ? ` · ${euro(q.dayMaxEur)} / 24 u` : ''}${q.extra ? ` · ${q.extra}` : ''}`

  return (
    <View style={{ marginTop: 8 }}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Txt variant="small">
          {open ? '▾' : '▸'} Tarief nu: <Txt variant="small" style={{ fontWeight: '700' }}>{text(active)}</Txt>
        </Txt>
      </Pressable>
      {open && (
        <View style={{ gap: 4, marginTop: 6 }}>
          {rate.periods.map((q) => (
            <Txt variant="small" key={q.key} style={q.key === rate.activeKey ? { fontWeight: '600' } : undefined}>
              <Txt variant="smallMuted">{q.label}</Txt> · {text(q)}
            </Txt>
          ))}
          {rate.notes.map((n) => <Txt variant="smallMuted" key={n}>{n}</Txt>)}
          <Txt variant="small" style={{ color: p.brand }} onPress={() => void openExternal(rate.sourceUrl)}>Bron: Stad Gent</Txt>
        </View>
      )}
    </View>
  )
}

export function ManualRateInfo({ rate }: { rate?: ManualParkingRate | null }) {
  if (!rate) return null
  const time = (value?: string | null) => value?.slice(0, 5) ?? ''

  return (
    <View style={{ gap: 4, marginTop: 8 }}>
      <Txt variant="small" style={{ fontWeight: '700' }}>Handmatig beheerd tarief</Txt>
      <Txt variant="small">Maandag–vrijdag, {time(rate.weekdayStart)}–{time(rate.weekdayEnd)}: {euro(rate.weekdayHourlyEur)} / uur</Txt>
      <Txt variant="small">Weekend: {euro(rate.weekendHourlyEur)} / uur</Txt>
      {rate.daytimeMaximumEur != null && (
        <Txt variant="small">Maximum overdag, {time(rate.daytimeStart)}–{time(rate.daytimeEnd)}: max. {euro(rate.daytimeMaximumEur)}</Txt>
      )}
      {rate.nighttimeMaximumEur != null && (
        <Txt variant="small">Maximum &apos;s nachts, {time(rate.nighttimeStart)}–{time(rate.nighttimeEnd)}: max. {euro(rate.nighttimeMaximumEur)}</Txt>
      )}
      {rate.dailyMaximumEur != null && <Txt variant="small">Maximum per 24 uur: {euro(rate.dailyMaximumEur)}</Txt>}
    </View>
  )
}
