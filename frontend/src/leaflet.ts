import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import { setWorkerUrl } from 'maplibre-gl'
import type { StyleSpecification } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

setWorkerUrl(workerUrl)

// Onder Vite breken de standaard markers van Leaflet: de bibliotheek raadt de paden van haar
// afbeeldingen relatief aan leaflet.css, en dat klopt niet meer zodra alles gebundeld en van een
// hash voorzien is. Wijs ze dus aan met de adressen die Vite voor de ingelezen PNG's maakt.
// (Deze kaart tekent haar eigen spelden, maar de standaard blijft nodig voor "u staat hier".)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

/**
 * De achtergrondkaart — dezelfde afweging als in MDRWeb (`frontend/src/utils/leaflet.ts`), waar
 * ze uitgebreid staat opgeschreven. Kort:
 *
 * De GRB-basiskaart van Digitaal Vlaanderen is de standaard: openbaar, geen sleutel, een licentie
 * die hergebruik toestaat, en ze tekent Vlaamse straten en gebouwen beter dan eender welke
 * wereldkaart. Voor Gent — waar deze hele toepassing over gaat — is het bereik geen beperking.
 */
export const BASEMAP_WMS = 'https://geo.api.vlaanderen.be/GRB-basiskaart/wms'
export const BASEMAP_LAYER = 'GRB_BSK'
export const BASEMAP_ATTRIBUTION =
  'Kaart: &copy; GRB-basiskaart, <a href="https://www.vlaanderen.be/digitaal-vlaanderen">Digitaal Vlaanderen</a>'

export const THEME_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">&copy; OpenMapTiles</a> data van <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

export const MAP_COLORS = {
  land: '#EDE7F6',
  buildings: '#D6C8EB',
  parks: '#6FC276',
  roads: '#B8A7E0',
  borders: '#6F5BB7',
  water: '#4DD0F0',
} as const

const PARK_ID = /park|grass|wood|forest|cemetery|garden|pitch|playground|recreation|sport|golf|farm|scrub|wetland|meadow|orchard|vineyard/i

/** Kleurt de OpenFreeMap-stijl "bright" om naar het eigen palet; de lagen en hun volgorde blijven. */
function themeStyle(style: StyleSpecification): StyleSpecification {
  const c = MAP_COLORS
  for (const layer of style.layers) {
    const id = layer.id
    const src = 'source-layer' in layer ? (layer['source-layer'] as string | undefined) : undefined
    const paint = (layer.paint ??= {}) as Record<string, unknown>

    if (layer.type === 'background') {
      paint['background-color'] = c.land
    } else if (layer.type === 'fill') {
      let color: string = c.land
      if (src === 'water' || /water/i.test(id)) color = c.water
      else if (src === 'building' || /building/i.test(id)) color = c.buildings
      else if (src === 'park' || ((src === 'landcover' || src === 'landuse') && PARK_ID.test(id))) color = c.parks
      else if (src === 'transportation' || src === 'aeroway') color = c.roads
      paint['fill-color'] = color
      if (src === 'building') paint['fill-outline-color'] = c.borders
      else delete paint['fill-outline-color']
    } else if (layer.type === 'line') {
      if (src === 'boundary') {
        paint['line-color'] = c.borders
      } else if (src === 'waterway' || /water/i.test(id)) {
        paint['line-color'] = c.water
      } else if (src === 'transportation' || src === 'aeroway') {
        if (/casing/i.test(id)) {
          paint['line-color'] = c.borders
          paint['line-opacity'] = 0.35
        } else if (/rail|transit|hatching/i.test(id)) {
          paint['line-color'] = c.borders
          paint['line-opacity'] = 0.5
        } else {
          paint['line-color'] = c.roads
        }
      }
    } else if (layer.type === 'symbol') {
      paint['text-color'] = c.borders
      paint['text-halo-color'] = c.land
    }
  }
  return style
}

let themedStyle: Promise<StyleSpecification> | null = null
function loadThemedStyle(): Promise<StyleSpecification> {
  themedStyle ??= fetch('https://tiles.openfreemap.org/styles/bright')
    .then((r) => {
      if (!r.ok) throw new Error(`Kaartstijl niet beschikbaar (${r.status})`)
      return r.json() as Promise<StyleSpecification>
    })
    .then(themeStyle)
    .catch((err) => {
      themedStyle = null
      throw err
    })
  return themedStyle
}

export interface Basemap {
  remove(): void
  bringToBack(): void
}

/** De vectorkaart in het eigen kleurenpalet. De stijl komt async binnen; remove() werkt ook dan. */
export function addThemedBasemap(map: L.Map): Basemap {
  let layer: L.Layer | null = null
  let removed = false
  void loadThemedStyle()
    .then((style) => {
      if (removed) return
      // Een kopie: de gedeelde stijl mag niet door MapLibre aangepast worden.
      layer = maplibreGL({ style: structuredClone(style), attribution: THEME_ATTRIBUTION } as never)
      layer.addTo(map)
    })
    .catch(() => {
      // Zonder achtergrond blijven spelden en routes gewoon werken.
    })
  return {
    remove() {
      removed = true
      layer?.remove()
    },
    bringToBack() {
      ;(layer as unknown as { bringToBack?: () => void } | null)?.bringToBack?.()
    },
  }
}

/**
 * OpenStreetMap als tweede keuze, voor wie liever een gewone stadskaart ziet.
 *
 * Deze tegels leken een tijd lang geblokkeerd ("App is not following the tile usage policy"),
 * maar dat was het niet: OpenStreetMap weigert *naamloze* tegelverzoeken, en Caddy zet
 * `Referrer-Policy: no-referrer` op elke pagina. Vandaar de eigen verwijzingspolitie hieronder,
 * die alleen op deze plaatjes geldt en niet op de site. Nagemeten in MDRWeb op 13-09-2026.
 */
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_REFERRER_POLICY = 'strict-origin-when-cross-origin' as const
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers'

/** Het midden van Gent (Korenmarkt) en de grenzen waarbinnen de kaart iets te tonen heeft. */
export const GENT_CENTER: [number, number] = [51.0536, 3.7253]
export const GENT_BOUNDS: [[number, number], [number, number]] = [
  [50.96, 3.55],
  [51.15, 3.9],
]

export default L
