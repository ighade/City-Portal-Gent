const BASE = 'https://data.stad.gent/api/explore/v2.1/catalog/datasets/laadpalen-gent/records'

export interface ChargingStation {
  id: string
  street: string
  lat: number
  lon: number
  operator: string | null
  type: string | null
  kw: number | null
  location: string | null
  url: string | null
  distanceMeters: number
}

interface ApiRecord {
  urid: string
  straatnaam: string | null
  huisnummer: string | null
  cpo: string | null
  type: string | null
  kw: number | null
  ligging: string | null
  url: string | null
  geo_point_2d: { lat: number; lon: number }
}

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/** De laadpalen in dienst die het dichtst bij het punt liggen, dichtstbijzijnde eerst. */
export async function fetchNearbyChargingStations(
  lat: number,
  lon: number,
  limit = 10,
  signal?: AbortSignal,
): Promise<ChargingStation[]> {
  const params = new URLSearchParams({
    lang: 'nl',
    limit: String(limit),
    where: "status='In dienst'",
    order_by: `distance(geo_point_2d, geom'POINT(${lon} ${lat})')`,
  })
  const res = await fetch(`${BASE}?${params}`, { signal })
  if (!res.ok) throw new Error('Laadpalen konden niet worden geladen.')
  const body = (await res.json()) as { results?: ApiRecord[] }
  return (body.results ?? []).map((r) => ({
    id: r.urid,
    street: [r.straatnaam, r.huisnummer].filter(Boolean).join(' ') || 'Laadpaal',
    lat: r.geo_point_2d.lat,
    lon: r.geo_point_2d.lon,
    operator: r.cpo,
    type: r.type,
    kw: r.kw,
    location: r.ligging,
    url: r.url,
    distanceMeters: haversineMeters(lat, lon, r.geo_point_2d.lat, r.geo_point_2d.lon),
  }))
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
}
