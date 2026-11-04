/** Het midden van Gent (Korenmarkt) en de grenzen waarbinnen de kaart iets te tonen heeft. */
export const GENT_CENTER: [number, number] = [51.0536, 3.7253]
export const GENT_BOUNDS: [[number, number], [number, number]] = [
  [50.96, 3.55],
  [51.15, 3.9],
]

export const GENT_REGION = {
  latitude: GENT_CENTER[0],
  longitude: GENT_CENTER[1],
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
}

/** Zwarte of witte tekst, afhankelijk van de lijnkleur (hex zonder #). */
export function textOn(hex?: string) {
  if (!hex) return '#fff'
  const n = parseInt(hex, 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#111827' : '#fff'
}

export interface LatLng {
  latitude: number
  longitude: number
}

export const toLatLng = (lat: number, lon: number): LatLng => ({ latitude: lat, longitude: lon })

/** GeoJSON-ringen ([lon, lat]) als kaartcoördinaten. */
const ring = (r: number[][]): LatLng[] => r.map(([lon, lat]) => ({ latitude: lat, longitude: lon }))

export interface MapPolygon {
  coordinates: LatLng[]
  holes: LatLng[][]
}

/** Polygon en MultiPolygon uit een GeoJSON-collectie; andere vormen zijn voor de zone niet nodig. */
export function geoJsonPolygons(features: unknown[]): MapPolygon[] {
  const out: MapPolygon[] = []
  const add = (rings: number[][][]) => {
    if (!Array.isArray(rings) || rings.length === 0) return
    out.push({ coordinates: ring(rings[0]), holes: rings.slice(1).map(ring) })
  }
  const visit = (geometry: { type?: string; coordinates?: unknown } | null | undefined) => {
    if (!geometry) return
    if (geometry.type === 'Polygon') add(geometry.coordinates as number[][][])
    else if (geometry.type === 'MultiPolygon') for (const p of geometry.coordinates as number[][][][]) add(p)
  }
  for (const f of features) {
    const feature = f as { type?: string; geometry?: { type?: string; coordinates?: unknown }; geometries?: unknown[] }
    if (feature.type === 'Feature') visit(feature.geometry)
    else if (feature.type === 'GeometryCollection') (feature.geometries ?? []).forEach((g) => visit(g as never))
    else visit(feature as never)
  }
  return out
}
