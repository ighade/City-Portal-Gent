const BASE = 'https://data.stad.gent/api/explore/v2.1/catalog/datasets/inname-openbaar-domein-werken-gent/records'
const PAGE = 100 // maximum per aanvraag van het portaal

export interface RawWork {
  zoneid: string
  zonetype: 'HinderZone' | 'WerfZone' | string
  severehindrance: string | null
  consequences: string | null
  hindrancegipodid: string
  hindranceuri: string | null
  hindrancedescription: string | null
  hindranceowner: string | null
  hindrancestart: string | null
  hindranceend: string | null
  geo_point_2d: { lat: number; lon: number } | null
  geo_shape: { geometry: GeoJSON.Geometry } | null
}

/**
 * Soorten werken, van zwaar naar licht. Een zone krijgt de zwaarste soort waar ze aan voldoet.
 * - afgesloten: weg of pad dicht voor minstens één verkeersgroep
 * - parkeer:    parkeerverbod (voor deze app het belangrijkste)
 * - beperkt:    voetgangers of fietsers moeten er omheen of kunnen er maar smal door
 * - rijstrook:  rijstroken vermindert of versmald (942 van de 1000 zones)
 * - werf:       de werf zelf (WerfZone), geen hinderzone errond
 */
export type WorkKind = 'afgesloten' | 'parkeer' | 'beperkt' | 'rijstrook' | 'werf'

export const KINDS: Record<WorkKind, { label: string; color: string; hint: string }> = {
  afgesloten: { label: 'Afgesloten', color: '#d03b3b', hint: 'Geen doorgang voor (een deel van) het verkeer' },
  parkeer: { label: 'Parkeerverbod', color: '#e8590c', hint: 'Parkeren niet toegestaan' },
  beperkt: { label: 'Beperkte doorgang', color: '#2a78d6', hint: 'Voetgangers of fietsers hebben minder ruimte' },
  rijstrook: { label: 'Minder rijstroken', color: '#d9a400', hint: 'Rijstroken weggenomen of versmald' },
  werf: { label: 'Werf', color: '#5c5470', hint: 'De werfzone zelf' },
}

export const KIND_ORDER: WorkKind[] = ['afgesloten', 'parkeer', 'beperkt', 'rijstrook', 'werf']

export interface Work {
  id: string
  kind: WorkKind
  isWerf: boolean
  severe: boolean
  consequences: string[]
  description: string
  owner: string
  start: Date | null
  end: Date | null
  center: [number, number]
  geometry: GeoJSON.Geometry
  link: string | null
}

export type Timing = 'actief' | 'gepland' | 'afgelopen'

/** Einddatums in de 2090's zijn een "geen einde in zicht"-waarde van GIPOD. */
export const isOpenEnded = (d: Date | null) => !d || d.getFullYear() >= 2090

export function timing(w: Work, now = Date.now()): Timing {
  if (w.start && w.start.getTime() > now) return 'gepland'
  if (w.end && w.end.getTime() < now) return 'afgelopen'
  return 'actief'
}

function classify(r: RawWork, consequences: string[]): WorkKind {
  const text = consequences.join(';').toLowerCase()
  if (/geen doorgang|afgesloten/.test(text)) return 'afgesloten'
  if (/parkeerverbod/.test(text)) return 'parkeer'
  if (/beperkte doorgang/.test(text)) return 'beperkt'
  if (r.zonetype === 'WerfZone') return 'werf'
  return 'rijstrook'
}

const GENERIC = new Set(['HinderZone', 'WerfZone', ''])

function toWork(r: RawWork): Work | null {
  if (!r.geo_shape?.geometry || !r.geo_point_2d) return null
  const consequences = (r.consequences ?? '').split(';').map((s) => s.trim()).filter(Boolean)
  const description = (r.hindrancedescription ?? '').trim()
  return {
    id: r.zoneid,
    kind: classify(r, consequences),
    isWerf: r.zonetype === 'WerfZone',
    severe: r.severehindrance === 'True',
    consequences,
    description: GENERIC.has(description) ? '' : description,
    owner: r.hindranceowner ?? 'Onbekend',
    start: r.hindrancestart ? new Date(r.hindrancestart) : null,
    end: r.hindranceend ? new Date(r.hindranceend) : null,
    center: [r.geo_point_2d.lat, r.geo_point_2d.lon],
    geometry: r.geo_shape.geometry,
    link: r.hindranceuri,
  }
}

/** Haalt alle pagina's op; het portaal geeft er maximaal 100 per keer. */
export async function fetchWorks(signal?: AbortSignal): Promise<Work[]> {
  const get = async (offset: number) => {
    const res = await fetch(`${BASE}?limit=${PAGE}&offset=${offset}`, { signal })
    if (!res.ok) throw new Error(`data.stad.gent antwoordde met ${res.status}`)
    return (await res.json()) as { total_count: number; results: RawWork[] }
  }
  const first = await get(0)
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, Math.ceil(first.total_count / PAGE) - 1) }, (_, i) => get((i + 1) * PAGE)),
  )
  return [first, ...rest].flatMap((p) => p.results).map(toWork).filter((w): w is Work => w !== null)
}
