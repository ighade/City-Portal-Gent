export type ParkingKind = 'garage' | 'park-and-ride' | 'bicycle'

export interface Status {
  available: number
  capacity: number
  /** Leeg als de meting zichzelf tegensprak — dan is er wel een aantal vrije plaatsen, maar geen percentage. */
  occupancy?: number
  isOpen: boolean
  temporarilyClosed: boolean
  measuredAtUtc: string
  fetchedAtUtc: string
  isStale: boolean
}

export interface Parking {
  slug: string
  name: string
  kind: ParkingKind
  lat: number
  lon: number
  address?: string
  capacity: number
  url?: string
  operator?: string
  openingHours?: string
  inLowEmissionZone?: boolean
  isFree?: boolean
  hasLiveData: boolean
  /** Onwaar voor de personeelsstalling van het Stadskantoor: gemeten, maar je kunt er niet terecht. */
  isPublic: boolean
  status?: Status
}

export const kindLabel: Record<ParkingKind, string> = {
  garage: 'Parking',
  'park-and-ride': 'Park and ride',
  bicycle: 'Fietsenstalling',
}

export interface Point {
  atUtc: string
  available: number
  occupancy: number
}

export interface TrendCell {
  weekday: number
  hour: number
  occupancy: number
  samples: number
}

export interface Trend {
  slug: string
  name: string
  days: number
  cells: TrendCell[]
}

export interface Stats {
  parkings: number
  withLiveData: number
  open: number
  totalCapacity: number
  availableSpaces: number
  occupancy?: number
  measuredAtUtc?: string
  /** Apart geteld: fietsplaatsen bij autoplaatsen optellen levert een getal op dat niets zegt. */
  bicycle: BicycleStats
}

export interface BicycleStats {
  facilities: number
  totalCapacity: number
  availableSpaces: number
  occupancy?: number
}

/** Genoeg van GeoJSON om de zone aan Leaflet te kunnen geven; die kent de rest zelf. */
export interface GeoJsonCollection {
  type: 'FeatureCollection'
  features: unknown[]
}

export interface Meta {
  source: string
  sourceUrl: string
  datasets: string[]
  refreshMinutes: number
  retentionDays: number
  lastSyncUtc?: string
  lastSyncOk: boolean
  measurementCount: number
}

export interface RoutePlanRequest {
  startLat: number
  startLon: number
  endLat: number
  endLon: number
  mode: 'car'
}

export interface RoutePlanResult {
  mode: 'car'
  distanceKm: number
  durationMinutes: number
  coordinates: number[][]
  routeSummary: string
}

export interface SyncRun {
  startedUtc: string
  durationMs: number
  ok: boolean
  trigger: string
  liveCount: number
  catalogueCount: number
  measurementsAdded: number
  measurementsPruned: number
  message?: string
}

/** Hoe vol, in woorden. De kleur alleen mag het nooit vertellen — zie `app.css`. */
export type Busyness = 'vrij' | 'rustig' | 'druk' | 'bijna-vol' | 'vol' | 'onbekend'

export function busyness(status: Status | undefined): Busyness {
  if (!status || status.occupancy === undefined || status.occupancy === null) return 'onbekend'
  if (!status.isOpen) return 'onbekend'
  if (status.occupancy >= 97) return 'vol'
  if (status.occupancy >= 90) return 'bijna-vol'
  if (status.occupancy >= 70) return 'druk'
  if (status.occupancy >= 40) return 'rustig'
  return 'vrij'
}

export const busynessLabel: Record<Busyness, string> = {
  vrij: 'Veel plaats',
  rustig: 'Ruim',
  druk: 'Druk',
  'bijna-vol': 'Bijna vol',
  vol: 'Vol',
  onbekend: 'Geen meting',
}
