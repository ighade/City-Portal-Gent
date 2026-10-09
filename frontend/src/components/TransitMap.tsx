import { useEffect, useRef } from 'react'
import L, { BASEMAP_ATTRIBUTION, BASEMAP_LAYER, BASEMAP_WMS, GENT_BOUNDS, GENT_CENTER } from '../leaflet'
import type { TransitRouteResult, TransitStop } from '../types'

interface Props {
  stops: TransitStop[]
  route?: TransitRouteResult | null
  selectedStopId?: string | null
  onStopClick?: (stop: TransitStop) => void
}

export function TransitMap({ stops, route, selectedStopId, onStopClick }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const stopLayer = useRef<L.LayerGroup | null>(null)
  const routeLayer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!host.current || map.current) return
    const instance = L.map(host.current, {
      center: GENT_CENTER,
      zoom: 13,
      minZoom: 11,
      maxZoom: 18,
      maxBounds: L.latLngBounds(GENT_BOUNDS),
      maxBoundsViscosity: 0.7,
      zoomControl: true,
    })
    L.tileLayer.wms(BASEMAP_WMS, {
      layers: BASEMAP_LAYER,
      format: 'image/png',
      version: '1.3.0',
      maxZoom: 21,
      tileSize: 512,
      updateWhenIdle: true,
      attribution: BASEMAP_ATTRIBUTION,
    }).addTo(instance)
    stopLayer.current = L.layerGroup().addTo(instance)
    map.current = instance

    return () => {
      instance.remove()
      map.current = null
      stopLayer.current = null
      routeLayer.current = null
    }
  }, [])

  useEffect(() => {
    const group = stopLayer.current
    if (!group) return
    group.clearLayers()
    for (const stop of stops) {
      const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: 4,
        color: '#0f766e',
        weight: 1.5,
        fillColor: '#ccfbf1',
        fillOpacity: 0.95,
      })
      marker.bindTooltip(stop.name, { direction: 'top', offset: [0, -4] })
      marker.bindPopup(`<strong>${escapeHtml(stop.name)}</strong><br><small>${escapeHtml(stop.lines.join(' · ') || 'De Lijn')}</small>`)
      marker.on('click', () => onStopClick?.(stop))
      if (stop.id === selectedStopId) marker.setStyle({ radius: 8, weight: 3, color: '#c2410c' })
      marker.addTo(group)
    }
  }, [onStopClick, selectedStopId, stops])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    routeLayer.current?.remove()
    routeLayer.current = null
    if (!route) return

    const group = L.layerGroup().addTo(instance)
    const bounds: Array<[number, number]> = []
    for (const leg of route.legs) {
      const points: Array<[number, number]> = leg.coordinates?.length
        ? leg.coordinates.map(([lat, lon]) => [lat, lon] as [number, number])
        : [[leg.fromLat, leg.fromLon], [leg.toLat, leg.toLon]]
      bounds.push(...points)
      L.polyline(points, {
        color: leg.mode === 'walk' ? '#6b7280' : leg.mode === 'tram' ? '#d97706' : '#0f766e',
        weight: leg.mode === 'walk' ? 3 : 6,
        dashArray: leg.mode === 'walk' ? '7 7' : undefined,
        opacity: 0.9,
      }).addTo(group)
    }
    if (bounds.length > 0) {
      L.circleMarker(bounds[0], { radius: 8, color: '#0f766e', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(group)
      L.circleMarker(bounds[bounds.length - 1], { radius: 8, color: '#c2410c', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(group)
      instance.fitBounds(L.latLngBounds(bounds).pad(0.2), { animate: true })
    }
    routeLayer.current = group
  }, [route])

  return <div ref={host} className="map" role="application" aria-label="Kaart met haltes van De Lijn" />
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character)
}
