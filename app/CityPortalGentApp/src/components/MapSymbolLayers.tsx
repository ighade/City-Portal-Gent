import { GeoJSONSource, Images, Layer } from '@maplibre/maplibre-react-native'

import { textOn } from '@/lib/map'
import { RENTAL_BIKE_ICONS } from '@/lib/rentalBikes'
import type { RentalBike } from '@/lib/rentalBikes'

// De donkere stijl heeft alleen "Noto Sans Regular"; de lichte ook Bold.
const fontFor = (dark: boolean) => [dark ? 'Noto Sans Regular' : 'Noto Sans Bold']

export interface LineBadgeItem {
  id: string
  lat: number
  lon: number
  line: string
  /** Hex met #. */
  color: string
}

/**
 * Lijnnummers als kaartlagen in plaats van views: views op de kaart tekent Android in een laag die
 * bij de eerste view ontstaat, waardoor later toegevoegde lijnen erboven liggen. Een laag die ná
 * de lijnen komt, ligt wel altijd erboven.
 */
export function LineBadgeLayer({ badges, dark }: { badges: LineBadgeItem[]; dark: boolean }) {
  if (badges.length === 0) return null
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: badges.map((b) => ({
      type: 'Feature',
      id: b.id,
      properties: { line: b.line, color: b.color, textColor: textOn(b.color.replace('#', '')), radius: 8 + 3.5 * b.line.length },
      geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
    })),
  }
  return (
    <>
      <GeoJSONSource id="line-badges" data={data} />
      <Layer
        id="line-badges-bg"
        type="circle"
        source="line-badges"
        paint={{
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-pitch-alignment': 'map',
        }}
      />
      <Layer
        id="line-badges-text"
        type="symbol"
        source="line-badges"
        layout={{
          'text-field': ['get', 'line'],
          'text-font': fontFor(dark),
          'text-size': 11,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{ 'text-color': ['get', 'textColor'] }}
      />
    </>
  )
}

const BIKE_ICON_NAMES = { Dott: 'rental-dott', Bolt: 'rental-bolt' } as const

/**
 * Deelfietsen als kaartlaag: het logo wordt één keer als kaartafbeelding geladen. Als view op de
 * kaart bleef het logo soms leeg, omdat de momentopname van de view al gemaakt was voor de
 * afbeelding geladen was.
 */
export function RentalBikeLayer({ bikes, selectedId, onPress }: { bikes: RentalBike[]; selectedId?: string | null; onPress: (bikeId: string) => void }) {
  if (bikes.length === 0) return null
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: bikes.map((b) => ({
      type: 'Feature',
      id: `${b.provider}-${b.id}`,
      properties: { bikeId: b.id, icon: BIKE_ICON_NAMES[b.provider], selected: b.id === selectedId ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
    })),
  }
  return (
    <>
      <Images images={{ [BIKE_ICON_NAMES.Dott]: RENTAL_BIKE_ICONS.Dott, [BIKE_ICON_NAMES.Bolt]: RENTAL_BIKE_ICONS.Bolt }} />
      <GeoJSONSource
        id="rental-bikes"
        data={data}
        onPress={(e) => {
          const id = e.nativeEvent.features[0]?.properties?.bikeId
          if (typeof id === 'string') onPress(id)
        }}
      />
      <Layer
        id="rental-bikes-bg"
        type="circle"
        source="rental-bikes"
        paint={{
          'circle-radius': 17,
          'circle-color': '#ffffff',
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 4, 3],
          'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#facc15', '#ffffff'],
        }}
      />
      <Layer
        id="rental-bikes-icon"
        type="symbol"
        source="rental-bikes"
        layout={{
          'icon-image': ['get', 'icon'],
          'icon-size': 0.058,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        }}
      />
    </>
  )
}
