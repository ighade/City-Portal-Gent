const CHARGING_API_URL = 'https://data.stad.gent/api/explore/v2.1/catalog/datasets/laadpalen-gent/records/?lang=nl&limit=500&offset=0'

export interface ChargingStation {
  id: string
  name: string
  lat: number
  lon: number
  address?: string
  status: 'free' | 'occupied' | 'error'
  connectorTypes: string[]
  operatingStatus: string
  operator?: string
}

export interface ChargingStationApiRecord {
  fields: {
    georef: {
      lon: number
      lat: number
    }
    adres?: string
    naam?: string
    operator?: string
    oplaadpunten_beschikbaar?: number
    oplaadpunten_totaal?: number
    status?: string
  }
}

export async function fetchChargingStations(): Promise<ChargingStation[]> {
  try {
    const res = await fetch(CHARGING_API_URL)
    if (!res.ok) throw new Error(`API error: ${res.status}`)

    const data = (await res.json()) as { records?: ChargingStationApiRecord[] }
    const records = data.records ?? []

    return records
      .filter((r) => r.fields?.georef?.lat && r.fields?.georef?.lon)
      .map((r, idx) => {
        const fields = r.fields
        const availableChargers = fields.oplaadpunten_beschikbaar ?? 0
        const isOccupied = availableChargers === 0

        return {
          id: `charging-${idx}`,
          name: fields.naam || 'Onbekende laadpaal',
          lat: fields.georef.lat,
          lon: fields.georef.lon,
          address: fields.adres,
          status: isOccupied ? 'occupied' : 'free',
          connectorTypes: [],
          operatingStatus: fields.status || 'operational',
          operator: fields.operator,
        }
      })
  } catch (e) {
    console.error('Failed to fetch charging stations:', e)
    return []
  }
}

export function filterAvailableChargingStations(stations: ChargingStation[]): ChargingStation[] {
  return stations.filter((s) => s.status === 'free')
}

export function getNearestChargingStation(
  stations: ChargingStation[],
  userLat: number,
  userLon: number,
  maxDistance: number = 5000,
): ChargingStation | null {
  const nearby = stations.filter((s) => {
    const distance = calculateDistance(userLat, userLon, s.lat, s.lon)
    return distance <= maxDistance
  })

  if (nearby.length === 0) return null

  return nearby.reduce((nearest, station) => {
    const dist = calculateDistance(userLat, userLon, station.lat, station.lon)
    const nearestDist = calculateDistance(userLat, userLon, nearest.lat, nearest.lon)
    return dist < nearestDist ? station : nearest
  })
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}
