import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Callout } from 'react-native-maps'

import { FriendPin, PinMarker } from '@/components/MapPins'
import { Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { friendStatus } from '@/lib/friendsUi'
import { GENT_REGION } from '@/lib/map'
import type { Friend } from '@/lib/types'

/** De vrienden met een bekende locatie als markers; gedeeld door de vriendenpagina en de routekaart. */
export function FriendMarkers({ friends }: { friends: Friend[] }) {
  return (
    <>
      {friends.map((f) =>
        f.lat == null || f.lon == null ? null : (
          <PinMarker
            key={f.id}
            coordinate={{ latitude: f.lat, longitude: f.lon }}
            title={f.username}
            zIndex={800}
            anchor={{ x: 0.5, y: 0.5 }}
            version={`${f.avatar ?? ''}${f.locationAtUtc ?? ''}`}>
            <FriendPin friend={f} />
            <Callout tooltip={false}>
              <View style={{ minWidth: 120 }}>
                <Txt variant="strong" style={{ color: '#111827' }}>{f.username}</Txt>
                <Txt variant="smallMuted">{friendStatus(f)}</Txt>
              </View>
            </Callout>
          </PinMarker>
        ),
      )}
    </>
  )
}

export function FriendsMap({ friends, height = 280 }: { friends: Friend[]; height?: number }) {
  const p = usePalette()
  const ref = useRef<MapView>(null)
  const fitted = useRef(false)

  useEffect(() => {
    const points = friends.filter((f) => f.lat != null && f.lon != null).map((f) => ({ latitude: f.lat!, longitude: f.lon! }))
    if (points.length > 0 && !fitted.current && ref.current) {
      fitted.current = true
      ref.current.fitToCoordinates(points, { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: false })
    }
  }, [friends])

  return (
    <View style={[styles.box, { height, borderColor: p.border }]}>
      <MapView ref={ref} style={StyleSheet.absoluteFill} initialRegion={GENT_REGION} userInterfaceStyle={p.scheme} maxZoomLevel={18}>
        <FriendMarkers friends={friends} />
      </MapView>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
})
