import { euro2 } from './format'

/** De Lijn-rit: één vast tarief, ook als je overstapt op een tweede bus of tram. */
export const TRANSIT_FARE_EUR = 3

export function transitFareLabel(legs: { mode: string }[]): string | null {
  if (!legs.some((l) => l.mode === 'bus' || l.mode === 'tram')) return null
  return euro2(TRANSIT_FARE_EUR)
}
