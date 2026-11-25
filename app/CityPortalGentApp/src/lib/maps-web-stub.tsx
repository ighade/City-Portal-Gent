import { forwardRef } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'

// MapLibre heeft geen webversie; op het web tonen we alleen een plaatsaanduiding.
export function Map({ style }: { style?: unknown; children?: ReactNode }) {
  return (
    <View
      style={[{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#e5e7eb' }, style as object]}>
      <Text style={{ color: '#6b7280' }}>De kaart is alleen beschikbaar in de mobiele app.</Text>
    </View>
  )
}

const Nothing = () => null

export const Camera = forwardRef(Nothing)
export const ViewAnnotation = Nothing
export const GeoJSONSource = Nothing
export const Layer = Nothing
