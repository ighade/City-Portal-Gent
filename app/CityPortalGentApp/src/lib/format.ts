/** Nederlandse (Belgische) opmaak; Hermes kent `nl-BE`, de tijdzone van de site blijft Brussel. */

const TZ = 'Europe/Brussels'

function safe<T>(fn: () => T, fallback: () => T): T {
  try {
    return fn()
  } catch {
    return fallback()
  }
}

export const nl = (n: number, options?: Intl.NumberFormatOptions) =>
  safe(() => n.toLocaleString('nl-BE', options), () => String(n))

export const euro = (n: number) => `€ ${nl(n, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

export const euro2 = (n: number) => `€ ${nl(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const pad = (n: number) => String(n).padStart(2, '0')

/** Uur:minuut van het toestel (zoals `toLocaleTimeString('nl-BE', …)` op de site). */
export function fmtTime(d: Date): string {
  return safe(
    () => d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }),
    () => `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  )
}

export const fmtTimeIso = (iso: string) => fmtTime(new Date(iso))

export function fmtDateTime(d: Date): string {
  return safe(() => d.toLocaleString('nl-BE'), () => d.toISOString())
}

export function fmtWeekday(d: Date): string {
  return safe(() => d.toLocaleDateString('nl-BE', { weekday: 'short' }), () => '')
}

function dtf(options: Intl.DateTimeFormatOptions) {
  return safe(
    () => new Intl.DateTimeFormat('nl-BE', { timeZone: TZ, ...options }),
    () => new Intl.DateTimeFormat('nl-BE', options),
  )
}

const dayMonthFmt = dtf({ day: 'numeric', month: 'short' })
const weekdayLongFmt = dtf({ weekday: 'long' })
const timeBxlFmt = dtf({ hour: '2-digit', minute: '2-digit' })
const dateLongFmt = dtf({ weekday: 'long', day: 'numeric', month: 'long' })
const whenFmt = dtf({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** ["12", "sep"] */
export function dayMonthParts(d: Date): [string, string] {
  const [day, month] = dayMonthFmt.format(d).split(' ')
  return [day ?? '', (month ?? '').replace('.', '')]
}

export const weekdayLong = (d: Date) => weekdayLongFmt.format(d)
export const timeBrussels = (d: Date) => timeBxlFmt.format(d)
export const dateLong = (d: Date) => dateLongFmt.format(d)
export const whenShort = (d: Date) => whenFmt.format(d)

/** Weekdag + tijd, voor de grafiek ("ma 10:23"). */
export function fmtChartStamp(iso: string): string {
  return safe(
    () => new Date(iso).toLocaleString('nl-BE', { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
    () => iso,
  )
}
