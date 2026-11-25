import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Camera, Map as MapView } from '@maplibre/maplibre-react-native'
import type { CameraRef } from '@maplibre/maplibre-react-native'

import { FriendPin, PinMarker } from '@/components/MapPins'
import { Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { friendStatus } from '@/lib/friendsUi'
import { GENT_VIEW, boundsOf, lngLatOf, mapStyleUrl } from '@/lib/map'
import type { Friend } from '@/lib/types'

/** De vrienden met een bekende locatie als markers; gedeeld door de vriendenpagina en de routekaart. */
export function FriendMarkers({ friends }: { friends: Friend[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <>
      {friends.map((f) =>
        f.lat == null || f.lon == null ? null : (
          <PinMarker
            key={f.id}
            id={`friend-${f.id}`}
            lat={f.lat}
            lon={f.lon}
            onPress={() => setOpenId((cur) => (cur === f.id ? null : f.id))}
            open={openId === f.id}
            callout={
              <View style={styles.callout}>
                <Txt variant="strong" style={{ color: '#111827' }}>{f.username}</Txt>
                <Txt variant="smallMuted">{friendStatus(f)}</Txt>
              </View>
            }>
            <FriendPin friend={f} />
          </PinMarker>
        ),
      )}
    </>
  )
}

export function FriendsMap({ friends, height = 280 }: { friends: Friend[]; height?: number }) {
  const p = usePalette()
  const camera = useRef<CameraRef>(null)
  const fitted = useRef(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const points = friends.filter((f) => f.lat != null && f.lon != null).map((f) => lngLatOf(f.lat!, f.lon!))
    if (points.length > 0 && loaded && !fitted.current && camera.current) {
      fitted.current = true
      camera.current.fitBounds(boundsOf(points), { padding: { top: 60, right: 60, bottom: 60, left: 60 }, duration: 0 })
    }
  }, [friends, loaded])

  return (
    <View style={[styles.box, { height, borderColor: p.border }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyleUrl(p.scheme)}
        onDidFinishLoadingMap={() => setLoaded(true)}>
        <Camera ref={camera} initialViewState={GENT_VIEW} maxZoom={18} />
        <FriendMarkers friends={friends} />
      </MapView>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  callout: { minWidth: 120, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', padding: 8 },
})
