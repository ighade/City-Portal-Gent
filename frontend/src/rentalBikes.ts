export type RentalBikeProvider = 'Dott' | 'Bolt'

export const RENTAL_BIKE_ICONS: Record<RentalBikeProvider, string> = {
  Dott: '/dott.webp',
  Bolt: '/bolt.png',
}

export interface RentalBike {
  id: string
  provider: RentalBikeProvider
  lat: number
  lon: number
  rangeMeters: number | null
  batteryPercent: number | null
  rentalUris: { android?: string; ios?: string } | null
}

interface ApiResponse {
  total_count?: unknown
  results?: unknown[]
}

interface ApiBike {
  bike_id?: unknown
  lat?: unknown
  lon?: unknown
  loc?: { lat?: unknown; lon?: unknown }
  is_disabled?: unknown
  is_reserved?: unknown
  current_range_meters?: unknown
  current_fuel_percent?: unknown
  rental_uris?: unknown
}

const DATASETS = [
  {
    provider: 'Dott',
    url: 'https://data.stad.gent/api/explore/v2.1/catalog/datasets/dott-deelfietsen-gent/records/',
  },
  {
    provider: 'Bolt',
    url: 'https://gent.opendatasoft.com/api/explore/v2.1/catalog/datasets/bolt-deelfietsen-gent/records/',
  },
] as const

const PAGE_SIZE = 100

function rentalUris(value: unknown): RentalBike['rentalUris'] {
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const uris = parsed as { android?: unknown; ios?: unknown }
    return {
      android: typeof uris.android === 'string' ? uris.android : undefined,
      ios: typeof uris.ios === 'string' ? uris.ios : undefined,
    }
  } catch {
    return null
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseBike(value: unknown, provider: RentalBikeProvider): RentalBike | null {
  if (!value || typeof value !== 'object') return null
  const record = value as ApiBike
  if (record.is_disabled === 1 || record.is_disabled === true || record.is_reserved === 1 || record.is_reserved === true) return null

  const lat = asNumber(record.lat) ?? asNumber(record.loc?.lat)
  const lon = asNumber(record.lon) ?? asNumber(record.loc?.lon)
  if (typeof record.bike_id !== 'string' || lat === null || lon === null) return null

  const fuel = asNumber(record.current_fuel_percent)
  return {
    id: record.bike_id,
    provider,
    lat,
    lon,
    rangeMeters: asNumber(record.current_range_meters),
    batteryPercent: fuel === null ? null : Math.round(fuel * 100),
    rentalUris: rentalUris(record.rental_uris),
  }
}

async function fetchPage(
  dataset: (typeof DATASETS)[number],
  offset: number,
  signal: AbortSignal,
): Promise<{ totalCount: number; bikes: RentalBike[] }> {
  const url = `${dataset.url}?lang=nl&limit=${PAGE_SIZE}&offset=${offset}`
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (!response.ok) throw new Error(`${dataset.provider}: fietsen konden niet worden opgehaald (${response.status}).`)

  const body = await response.json() as ApiResponse
  if (!Array.isArray(body.results) || typeof body.total_count !== 'number') {
    throw new Error(`${dataset.provider}: de fietsgegevens hebben een ongeldig formaat.`)
  }
  const bikes = body.results
    .map((item) => parseBike(item, dataset.provider))
    .filter((bike): bike is RentalBike => bike !== null)
  return { totalCount: body.total_count, bikes }
}

async function fetchDataset(
  dataset: (typeof DATASETS)[number],
  signal: AbortSignal,
): Promise<RentalBike[]> {
  const firstPage = await fetchPage(dataset, 0, signal)
  const offsets = Array.from(
    { length: Math.ceil(firstPage.totalCount / PAGE_SIZE) - 1 },
    (_, index) => (index + 1) * PAGE_SIZE,
  )
  const remainingPages = await Promise.all(offsets.map((offset) => fetchPage(dataset, offset, signal)))
  return [...firstPage.bikes, ...remainingPages.flatMap((page) => page.bikes)]
}

export async function fetchRentalBikes(signal: AbortSignal): Promise<RentalBike[]> {
  const datasets = await Promise.all(DATASETS.map((dataset) => fetchDataset(dataset, signal)))
  return datasets.flat()
}

export const RENTAL_UNLOCK_EUR = 1
export const RENTAL_PER_MINUTE_EUR = 0.3
export const RENTAL_TARIFF_LABEL = '€1 ontgrendelen + €0,30 per minuut'

/** Schatting: ontgrendelen plus de rijtijd van de route (afgerond op hele minuten). */
export function rentalCostLabel(rideMinutes: number): string {
  const cost = RENTAL_UNLOCK_EUR + Math.max(1, Math.ceil(rideMinutes)) * RENTAL_PER_MINUTE_EUR
  return `€${cost.toFixed(2).replace('.', ',')}`
}

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180
  const latDistance = radians(b.lat - a.lat)
  const lonDistance = radians(b.lon - a.lon)
  const h =
    Math.sin(latDistance / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lonDistance / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function openRentalBike(bike: RentalBike): void {
  const website = bike.provider === 'Dott'
    ? `https://go.ridedott.com/vehicles/${encodeURIComponent(bike.id)}`
    : 'https://bolt.eu/'
  const ua = navigator.userAgent
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua)
  const appUrl = mobile ? bike.rentalUris?.[/iPhone|iPad|iPod/i.test(ua) ? 'ios' : 'android'] : undefined
  if (appUrl && !appUrl.startsWith('https:')) {
    window.location.href = appUrl
    return
  }
  window.open(appUrl ?? website, '_blank', 'noopener')
}
