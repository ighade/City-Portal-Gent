/** Het midden van Gent (Korenmarkt) en de grenzen waarbinnen de kaart iets te tonen heeft. */
export const GENT_CENTER: [number, number] = [51.0536, 3.7253]
export const GENT_BOUNDS: [[number, number], [number, number]] = [
  [50.96, 3.55],
  [51.15, 3.9],
]

export interface Region {
  latitude: number
  longitude: number
  latitudeDelta: number
  longitudeDelta: number
}

export const GENT_REGION: Region = {
  latitude: GENT_CENTER[0],
  longitude: GENT_CENTER[1],
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
}

/** Startzoom van de kaart; komt overeen met GENT_REGION. */
export const GENT_VIEW = { center: [GENT_CENTER[1], GENT_CENTER[0]] as [number, number], zoom: 11.5 }

/** Gratis OpenStreetMap-stijl van OpenFreeMap (geen API-sleutel nodig). */
export const mapStyleUrl = (scheme: string) =>
  scheme === 'dark' ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/liberty'

/** MapLibre werkt met [lon, lat]. */
export const lngLatOf = (lat: number, lon: number): [number, number] => [lon, lat]

/** Het zichtbare gebied (MapLibre-grenzen west, zuid, oost, noord) als Region. */
export const regionOf = (bounds: [number, number, number, number]): Region => {
  const [west, south, east, north] = bounds
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    latitudeDelta: north - south,
    longitudeDelta: east - west,
  }
}

/** Kaderbounds (west, zuid, oost, noord) rond een lijst punten. */
export const boundsOf = (points: [number, number][]): [number, number, number, number] => {
  const lons = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
}

/** Een GeoJSON-lijn door [lon, lat]-punten. */
export const lineFeature = (points: [number, number][]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: points },
})

/** Zwarte of witte tekst, afhankelijk van de lijnkleur (hex zonder #). */
export function textOn(hex?: string) {
  if (!hex) return '#fff'
  const n = parseInt(hex, 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#111827' : '#fff'
}

