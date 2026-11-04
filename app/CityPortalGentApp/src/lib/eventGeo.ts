import AsyncStorage from '@react-native-async-storage/async-storage'

import { api } from './api'
import { GENT_BOUNDS } from './map'

const GEO_CACHE = 'parkinggent.eventGeo.v3'

type Coord = { lat: number; lon: number }

let memory: Record<string, Coord | null> | null = null

async function readGeoCache(): Promise<Record<string, Coord | null>> {
  if (memory) return memory
  try {
    memory = JSON.parse((await AsyncStorage.getItem(GEO_CACHE)) ?? '{}')
  } catch {
    memory = {}
  }
  return memory!
}

// Het adres staat achteraan de plaatsnaam ("De Vooruit, Sint-Pietersnieuwstraat 23, Ghent"); probeer
// eerst alles, daarna vanaf het eerste deel met een huisnummer.
function addressCandidates(place: string): string[] {
  const parts = place.split(',').map((p) => p.trim()).filter(Boolean)
  const firstWithNumber = parts.findIndex((p) => /\d/.test(p))
  const candidates = [place]
  if (firstWithNumber > 0) candidates.push(parts.slice(firstWithNumber).join(', '))
  return candidates
}

// Een loutere naam staat zelden zo in OpenStreetMap: probeer ook zonder "in Gent" en zonder
// soortwoord ("Club Wintercircus" → "Wintercircus").
function nameCandidates(place: string): string[] {
  const first = place.split(',')[0].trim()
  const base = first.replace(/\s+(in\s+)?(gent|ghent)$/i, '')
  const bare = base.replace(/^(club|feestzaal|muziekcentrum|kunstencentrum)\s+/i, '')
  return [...new Set([first, base, bare])].filter(Boolean)
}

const inGentArea = (hit: Coord) =>
  hit.lat >= GENT_BOUNDS[0][0] && hit.lat <= GENT_BOUNDS[1][0] && hit.lon >= GENT_BOUNDS[0][1] && hit.lon <= GENT_BOUNDS[1][1]

// Plaatsen die dit bezoek al mislukten, zodat elk evenement op dezelfde plek niet opnieuw zoekt.
const failedPlaces = new Set<string>()

/** Coördinaat van de plaats van een evenement; onthouden in AsyncStorage. Null als ze niet te vinden is. */
export async function locatePlace(place: string): Promise<Coord | null> {
  const cache = await readGeoCache()
  if (cache[place]) return cache[place]
  if (failedPlaces.has(place)) return null

  let found: Coord | null = null
  for (const q of /\d/.test(place) ? addressCandidates(place) : []) {
    try {
      const hit = await api.geocode(q)
      if (!inGentArea(hit)) continue
      found = { lat: hit.lat, lon: hit.lon }
      break
    } catch {
      // volgende kandidaat
    }
  }
  if (!found) {
    // Alleen een naam, of een adres dat niet gevonden werd: zoek de plaats zelf.
    for (const q of nameCandidates(place)) {
      try {
        const hit = await api.placeByName(q)
        if (!inGentArea(hit)) continue
        found = { lat: hit.lat, lon: hit.lon }
        break
      } catch {
        // volgende kandidaat
      }
      await new Promise((r) => setTimeout(r, 1100))
    }
  }

  if (!found) {
    failedPlaces.add(place)
    return null
  }
  cache[place] = found
  void AsyncStorage.setItem(GEO_CACHE, JSON.stringify(cache)).catch(() => undefined)
  return found
}
