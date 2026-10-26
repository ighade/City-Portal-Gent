import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

// react-native-maps heeft geen webversie; op het web tonen we alleen een plaatsaanduiding.
export default function MapView({ style }: { style?: unknown; children?: ReactNode }) {
  return (
    <View
      style={[{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#e5e7eb' }, style as object]}>
      <Text style={{ color: '#6b7280' }}>De kaart is alleen beschikbaar in de mobiele app.</Text>
    </View>
  )
}

const Nothing = () => null

export const Marker = Nothing
export const Callout = Nothing
export const Polygon = Nothing
export const Polyline = Nothing
