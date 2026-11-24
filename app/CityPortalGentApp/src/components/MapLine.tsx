import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native'

import { lineFeature } from '@/lib/map'

/** Een lijn op de kaart (route, loopdeel, OV-traject); `dash` maakt er een stippellijn van. */
export function MapLine({ id, points, color, width, dash }: { id: string; points: [number, number][]; color: string; width: number; dash?: number[] }) {
  return (
    <>
      <GeoJSONSource id={id} data={lineFeature(points)} />
      <Layer
        id={`${id}-line`}
        type="line"
        source={id}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{ 'line-color': color, 'line-width': width, ...(dash ? { 'line-dasharray': dash } : {}) }}
      />
    </>
  )
}
