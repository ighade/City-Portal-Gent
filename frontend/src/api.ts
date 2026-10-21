import type { EzParkRequest, GentEvent, EzParkResult, GeoJsonCollection, Meta, Parking, Point, RoutePlanRequest, RoutePlanResult, Stats, SyncRun, TransitRouteRequest, TransitRouteResult, TransitStatus, TransitStop, TransitStopRealtime, Trend } from './types'

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

const GEO = 'https://geo.api.vlaanderen.be/geolocation/v4'

interface Place { lat: number; lon: number; label: string }

const inGent = (label: string) => /\bgent\b/i.test(label)

async function flemishGeocode(q: string): Promise<Place> {
  const res = await fetch(`${GEO}/Location?c=5&q=${encodeURIComponent(q)}`)
  const body = res.ok
    ? await res.json() as { LocationResult?: Array<{ FormattedAddress?: string; Municipality?: string; Location: { Lat_WGS84: number; Lon_WGS84: number } }> }
    : {}
  const hits = body.LocationResult ?? []
  const hit = hits.find((h) => h.Municipality?.toLowerCase() === 'gent') ?? hits[0]
  if (!hit) throw new Error('Dit adres werd niet gevonden.')
  return { lat: hit.Location.Lat_WGS84, lon: hit.Location.Lon_WGS84, label: hit.FormattedAddress ?? q }
}

// Eén oproep per voorstel-ronde; de coördinaten komen pas bij het berekenen, via flemishGeocode.
const suggestCache = new Map<string, string[]>()

async function flemishSuggest(q: string): Promise<string[]> {
  const cached = suggestCache.get(q)
  if (cached) return cached
  const res = await fetch(`${GEO}/Suggestion?c=10&q=${encodeURIComponent(q)}`)
  if (!res.ok) return []
  const body = await res.json() as { SuggestionResult?: string[] }
  const all = body.SuggestionResult ?? []
  const sorted = [...all.filter(inGent), ...all.filter((l) => !inGent(l))].slice(0, 5)
  suggestCache.set(q, sorted)
  return sorted
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })

  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!res.ok) {
    const d = data as { detail?: string; title?: string; error?: string; code?: string } | string | null
    const msg =
      typeof d === 'string' ? d : d?.detail || d?.error || d?.title || `${res.status} ${res.statusText}`
    throw new ApiError(res.status, msg, typeof d === 'object' ? d?.code : undefined)
  }
  return data as T
}

export const api = {
  parkings: () => call<Parking[]>('GET', '/api/parkings'),
  parking: (slug: string) => call<Parking>('GET', `/api/parkings/${slug}`),
  history: (slug: string, hours = 24) => call<Point[]>('GET', `/api/parkings/${slug}/history?hours=${hours}`),
  trend: (slug: string, days = 60) => call<Trend>('GET', `/api/parkings/${slug}/trend?days=${days}`),
  stats: () => call<Stats>('GET', '/api/stats'),
  /** De lage-emissiezone als GeoJSON. Verandert vrijwel nooit; één keer per bezoek volstaat. */
  lez: () => call<GeoJsonCollection>('GET', '/api/lez'),
  routePlan: (payload: RoutePlanRequest) => call<RoutePlanResult>('POST', '/api/route/plan', payload),
  suggest: flemishSuggest,
  geocode: flemishGeocode,
  ezPark: (payload: EzParkRequest) => call<EzParkResult>('POST', '/api/route/ezpark', payload),
  transit: {
    stops: () => call<TransitStop[]>('GET', '/api/transit/stops'),
    stopRealtime: (stopId: string) => call<TransitStopRealtime>('GET', `/api/transit/stops/${encodeURIComponent(stopId)}/realtime`),
    status: () => call<TransitStatus>('GET', '/api/transit/status'),
    route: (payload: TransitRouteRequest) => call<TransitRouteResult>('POST', '/api/transit/route', payload),
  },
  events: () => call<GentEvent[]>('GET', '/api/events'),
  meta: () => call<Meta>('GET', '/api/meta'),

  /**
   * Beheer. Extern komt hier altijd een 401 uit — de identiteitskoppen worden alleen door de
   * LAN-ingang (:8105) gezet, zie het Caddyfile. Het scherm gebruikt dat als de vraag "mag ik
   * hier beheren": lukt /whoami, dan verschijnt de beheerpagina.
   */
  admin: {
    whoami: () => call<{ email: string; name: string; isAdmin: boolean }>('GET', '/api/admin/whoami'),
    sync: () => call<SyncRun>('POST', '/api/admin/sync'),
    backfill: () => call<{ added: number }>('POST', '/api/admin/backfill'),
    runs: (take = 50) => call<SyncRun[]>('GET', `/api/admin/runs?take=${take}`),
  },
}
