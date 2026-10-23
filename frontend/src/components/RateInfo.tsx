import { useState } from 'react'
import type { ManualParkingRate, ParkingRate, StreetParking, StreetTariff } from '../types'

const euro = (n: number) => `€ ${n.toLocaleString('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

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
  const flatAmount = flat ? Number(flat[2].replace(',', '.')) : null

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
    const time = end.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
    const day = end.toDateString() === start.toDateString() ? '' : ` (${end.toLocaleDateString('nl-BE', { weekday: 'short' })})`
    return { end, hours: Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 3600000)), label: `${time}${day}` }
  })
}

export function EndTimeSelect({ start, index, onIndex }: { start: Date; index: number; onIndex: (i: number) => void }) {
  return (
    <label className="row small" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
      <span className="muted">Parkeren tot</span>
      <select className="select" value={index} onChange={(e) => onIndex(Number(e.target.value))}>
        {endOptions(start).map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
      </select>
    </label>
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
  const chosen = endOptions(start)[idx]
  const time = (d: Date) => d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
  const { cost, tooLong } = estimateStreetCost(info, start, chosen.hours)

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Parkeren op bestemming</h3>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <span className="row" style={{ gap: 8 }}>
          <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 6, background: zoneColor[info.zone] }} />
          <strong>{info.name}</strong>
        </span>
        <strong>{info.zone === 'blauw' ? 'Gratis' : info.paidNow ? 'Nu betalend' : 'Nu gratis'}</strong>
      </div>

      <EndTimeSelect start={start} index={idx} onIndex={setIdx} />
      <div className="small" style={{ marginTop: 4 }}>
        {time(start)}–{time(chosen.end)} ·{' '}
        {info.zone === 'blauw'
          ? <strong>gratis</strong>
          : <strong>≈ € {cost.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>}
      </div>
      {tooLong && <p className="note">{tooLong}</p>}
    </div>
  )
}

export function GarageRate({ rate }: { rate?: ParkingRate }) {
  if (!rate) return <div className="small muted" style={{ marginTop: 8 }}>Tarief: zie de website van de uitbater</div>

  const active = rate.periods.find((p) => p.key === rate.activeKey) ?? rate.periods[0]
  const text = (p: ParkingRate['periods'][number]) =>
    `${p.isMaximum ? 'Max. ' : ''}${euro(p.hourlyEur)} / uur${p.dayMaxEur ? ` · ${euro(p.dayMaxEur)} / 24 u` : ''}${p.extra ? ` · ${p.extra}` : ''}`

  return (
    <details style={{ marginTop: 8 }}>
      <summary className="small">
        Tarief nu: <strong>{text(active)}</strong>
      </summary>
      <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
        {rate.periods.map((p) => (
          <div className="small" key={p.key} style={p.key === rate.activeKey ? { fontWeight: 600 } : undefined}>
            <span className="muted">{p.label}</span> · {text(p)}
          </div>
        ))}
        {rate.notes.map((n) => <div className="small muted" key={n}>{n}</div>)}
        <a className="small" href={rate.sourceUrl} target="_blank" rel="noreferrer">Bron: Stad Gent</a>
      </div>
    </details>
  )
}

export function ManualRateInfo({ rate }: { rate?: ManualParkingRate | null }) {
  if (!rate) return null
  const euroText = (n: number) => euro(n)
  const time = (value?: string | null) => value?.slice(0, 5) ?? ''

  return (
    <div className="small" style={{ display: 'grid', gap: 4, marginTop: 8 }}>
      <strong>Handmatig beheerd tarief</strong>
      <div>Maandag–vrijdag, {time(rate.weekdayStart)}–{time(rate.weekdayEnd)}: {euroText(rate.weekdayHourlyEur)} / uur</div>
      <div>Weekend: {euroText(rate.weekendHourlyEur)} / uur</div>
      {rate.daytimeMaximumEur != null && (
        <div>Maximum overdag, {time(rate.daytimeStart)}–{time(rate.daytimeEnd)}: max. {euroText(rate.daytimeMaximumEur)}</div>
      )}
      {rate.nighttimeMaximumEur != null && (
        <div>Maximum 's nachts, {time(rate.nighttimeStart)}–{time(rate.nighttimeEnd)}: max. {euroText(rate.nighttimeMaximumEur)}</div>
      )}
      {rate.dailyMaximumEur != null && <div>Maximum per 24 uur: {euroText(rate.dailyMaximumEur)}</div>}
    </div>
  )
}
