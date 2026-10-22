import { useEffect, useRef } from 'react'
import L, { addThemedBasemap, GENT_BOUNDS, GENT_CENTER } from '../leaflet'
import { friendPinHtml, friendStatus } from '../friendsUi'
import type { Friend } from '../types'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Tekent de vrienden met een bekende locatie in een laag; gedeeld door de vriendenpagina en de routekaart. */
export function drawFriends(group: L.LayerGroup, friends: Friend[]): Array<[number, number]> {
  group.clearLayers()
  const points: Array<[number, number]> = []
  const now = Date.now()
  for (const f of friends) {
    if (f.lat == null || f.lon == null) continue
    points.push([f.lat, f.lon])
    L.marker([f.lat, f.lon], {
      title: f.username,
      zIndexOffset: 800,
      icon: L.divIcon({ className: '', html: friendPinHtml(f, now), iconSize: [42, 42], iconAnchor: [21, 21], popupAnchor: [0, -20] }),
    })
      .bindPopup(`<strong>${esc(f.username)}</strong><br><small>${esc(friendStatus(f, now))}</small>`)
      .addTo(group)
  }
  return points
}

export function FriendsMap({ friends }: { friends: Friend[] }) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)

  useEffect(() => {
    if (!host.current || map.current) return
    const instance = L.map(host.current, {
      center: GENT_CENTER,
      zoom: 13,
      minZoom: 3,
      maxZoom: 18,
      maxBounds: L.latLngBounds(GENT_BOUNDS).pad(10),
    })
    addThemedBasemap(instance)
    layer.current = L.layerGroup().addTo(instance)
    map.current = instance
    return () => {
      instance.remove()
      map.current = null
      layer.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m || !layer.current) return
    const points = drawFriends(layer.current, friends)
    if (points.length > 0 && !fitted.current) {
      fitted.current = true
      m.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 15 })
    }
  }, [friends])

  return <div ref={host} className="friends-map" />
}
