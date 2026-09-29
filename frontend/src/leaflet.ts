import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

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
