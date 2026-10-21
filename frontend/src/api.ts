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

// Plaatsen zonder adres ("Kuipke", "Bijloke") kent de Vlaamse geolocatie niet; OpenStreetMap wel,
// beperkt tot de omgeving van Gent.
async function placeByName(name: string): Promise<Place> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=3.55,51.15,3.9,50.96&q=${encodeURIComponent(name)}`,
    { headers: { Accept: 'application/json' } },
  )
  const hits = res.ok ? await res.json() as Array<{ lat: string; lon: string; display_name: string }> : []
  if (hits[0]) return { lat: Number(hits[0].lat), lon: Number(hits[0].lon), label: hits[0].display_name }
  return photonByName(name)
}

const squash = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Laatste redmiddel: Photon kent ook zaken die onder een samengeschreven naam of zonder soortwoord
// in OpenStreetMap staan ("deVierdeZaal, Driebeekstraat 4"). Alleen treffers waarvan de naam
// echt op de gezochte lijkt tellen; anders krijg je een straat of een stad met dezelfde klank.
async function photonByName(name: string): Promise<Place> {
  const res = await fetch(
    `https://photon.komoot.io/api/?limit=5&lat=51.05&lon=3.72&bbox=3.55,50.96,3.9,51.15&q=${encodeURIComponent(name)}`,
  )
  const body = res.ok
    ? await res.json() as { features?: Array<{ geometry: { coordinates: [number, number] }; properties: { name?: string; street?: string; housenumber?: string; city?: string } }> }
    : {}
  const want = squash(name.replace(/\s+(in\s+)?(gent|ghent)$/i, ''))
  const hit = (body.features ?? []).find((f) => {
    const got = squash(f.properties.name ?? '')
    return got.length >= 5 && want.length >= 5 && (got.includes(want) || want.includes(got))
  })
  if (!hit) throw new Error('Deze plaats werd niet gevonden.')
  const p = hit.properties
  const [lon, lat] = hit.geometry.coordinates
  return { lat, lon, label: [p.name, [p.street, p.housenumber].filter(Boolean).join(' '), p.city].filter(Boolean).join(', ') }
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
  placeByName,
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
