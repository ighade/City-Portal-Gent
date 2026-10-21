/** De Lijn-rit: één vast tarief, ook als je overstapt op een tweede bus of tram. */
export const TRANSIT_FARE_EUR = 3

export function transitFareLabel(legs: { mode: string }[]): string | null {
  if (!legs.some((l) => l.mode === 'bus' || l.mode === 'tram')) return null
  return `€ ${TRANSIT_FARE_EUR.toLocaleString('nl-BE', { minimumFractionDigits: 2 })}`
}
