import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import L, {
  addThemedBasemap,
  GENT_BOUNDS,
  GENT_CENTER,
  OSM_ATTRIBUTION,
  OSM_REFERRER_POLICY,
  OSM_TILES,
} from '../leaflet'
import { api } from '../api'
import { busyness, busynessLabel, kindLabel } from '../types'
import type { EzParkLeg, Parking } from '../types'

interface RoutePoint {
  lat: number
  lon: number
  label: string
}

interface RouteOverlay {
  start: RoutePoint
  end: RoutePoint
  mode: 'car'
  points: Array<{ lat: number; lon: number }>
}

interface Props {
  parkings: Parking[]
  basemap: 'grb' | 'osm'
  /** Tekent de lage-emissiezone eronder. Achtergrond, geen meting — zie de stijl in app.css. */
  showLez: boolean
  /** Welke parking in de lijst is aangewezen; die speld springt naar voren. */
  selected?: string | null
  onSelect?: (slug: string | null) => void
  route?: RouteOverlay | null
  /** Alle spelden in één blauw, zonder drukte-kleur (routepagina). */
  bluePins?: boolean
  /** Klik op een leeg stuk kaart; voor het kiezen van start of bestemming. */
  onMapClick?: (lat: number, lon: number) => void
  /** EZ Park: start, bestemming en de benen van de gekozen route. */
  ezpark?: EzParkOverlay | null
}

interface EzParkOverlay {
  start?: { lat: number; lon: number } | null
  end?: { lat: number; lon: number } | null
  legs: EzParkLeg[]
  parks?: Array<{ lat: number; lon: number; name: string }>
}

/**
 * De kaart met een speld per parking.
 *
 * <b>Op de speld staat het aantal vrije plaatsen</b>, niet alleen een kleur. Dat is de reden om
 * de kaart te openen, en het maakt de kaart leesbaar voor wie kleur slecht onderscheidt: rood en
 * groen verschillen hier ook in wat erin staat. Een parking zonder meting krijgt een open ring
 * met haar capaciteit — zichtbaar anders dan een gemeten plek.
 */
export function ParkingMap({ parkings, basemap, showLez, selected, onSelect, route, onMapClick, ezpark, bluePins }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const routeLayer = useRef<L.LayerGroup | null>(null)
  const ezLayer = useRef<L.LayerGroup | null>(null)
  const clickHandler = useRef(onMapClick)
  clickHandler.current = onMapClick
  const base = useRef<{ remove(): void; bringToBack(): void } | null>(null)
  const lez = useRef<L.GeoJSON | null>(null)
  const markers = useRef<Map<string, L.Marker>>(new Map())
  const navigate = useNavigate()

  // De kaart zelf: één keer aanmaken en laten staan. Hem bij elke nieuwe meting opnieuw bouwen
  // zou de bezoeker om de minuut terugzetten naar het beginzicht.
  useEffect(() => {
    if (!host.current || map.current) return
    const m = L.map(host.current, {
      center: GENT_CENTER,
      zoom: 13,
      minZoom: 11,
      maxZoom: 18,
      maxBounds: L.latLngBounds(GENT_BOUNDS),
      maxBoundsViscosity: 0.7,
      zoomControl: true,
      scrollWheelZoom: true,
    })
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    m.on('click', (e: L.LeafletMouseEvent) => clickHandler.current?.(e.latlng.lat, e.latlng.lng))

    return () => {
      m.remove()
      map.current = null
      layer.current = null
      base.current = null
      lez.current = null
      markers.current.clear()
    }
  }, [])

  // De achtergrondkaart, apart, want die is verwisselbaar.
  useEffect(() => {
    const m = map.current
    if (!m) return
    base.current?.remove()
    base.current =
      basemap === 'osm'
        ? L.tileLayer(OSM_TILES, {
            attribution: OSM_ATTRIBUTION,
            maxZoom: 19,
            // Caddy zet `Referrer-Policy: no-referrer` op de pagina, en OpenStreetMap weigert
            // naamloze tegelverzoeken. Dit attribuut geldt alleen voor deze plaatjes.
            referrerPolicy: OSM_REFERRER_POLICY,
          }).addTo(m)
        : addThemedBasemap(m)
    base.current.bringToBack()
  }, [basemap])

  // De lage-emissiezone. Ze wordt één keer opgehaald en daarna alleen aan- of uitgezet: het
  // vinkje mag geen nieuwe oproep kosten, en de zone verandert toch niet tussendoor.
  useEffect(() => {
    const m = map.current
    if (!m) return

    if (!showLez) {
      lez.current?.remove()
      return
    }
    if (lez.current) {
      lez.current.addTo(m)
      lez.current.bringToBack()
      base.current?.bringToBack()
      return
    }

    let cancelled = false
    void api
      .lez()
      .then((collection) => {
        if (cancelled || !map.current) return
        if (collection.features.length === 0) return
        lez.current = L.geoJSON(collection as unknown as Parameters<typeof L.geoJSON>[0], {
          // De kleuren staan in app.css, niet hier: een SVG-presentatieattribuut lost `var()`
          // niet op, dus `color: 'var(--lez-line)'` zou stilzwijgend zwart worden. Via een
          // klasse volgt de zone bovendien vanzelf het lichte of donkere thema.
          style: { className: 'lez-shape', interactive: false },
        })
        lez.current.addTo(map.current)
        lez.current.bringToBack()
        base.current?.bringToBack()
      })
      .catch(() => {
        // Een ontbrekende achtergrondlaag is geen reden om de kaart te laten struikelen.
      })

    return () => {
      cancelled = true
    }
  }, [showLez])

  // Route-overlay: één lijn en twee markers. Dit is voor de routepagina en hoeft de kaart van de
  // parkinglijst niet te veranderen.
  useEffect(() => {
    const m = map.current
    if (!m) return

    routeLayer.current?.remove()
    routeLayer.current = null
    if (!route) return

    const group = L.layerGroup().addTo(m)
    const polyline = L.polyline(
      route.points.map((p) => [p.lat, p.lon] as [number, number]),
      { color: '#d94a4a', weight: 5, opacity: 0.9 },
    )
    polyline.addTo(group)


    routeLayer.current = group
    const bounds = L.latLngBounds([
      [route.start.lat, route.start.lon],
      [route.end.lat, route.end.lon],
      ...route.points.map((p) => [p.lat, p.lon] as [number, number]),
    ])
    m.fitBounds(bounds.pad(0.18), { animate: true })
  }, [route])

  // EZ Park: gekozen start/bestemming plus de benen van de geselecteerde optie.
  useEffect(() => {
    const m = map.current
    if (!m) return

    ezLayer.current?.remove()
    ezLayer.current = null
    if (!ezpark) return

    const group = L.layerGroup().addTo(m)
    const bounds: Array<[number, number]> = []
    const dot = (p: { lat: number; lon: number }, color: string, label: string) => {
      L.circleMarker([p.lat, p.lon], { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 })
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(group)
      bounds.push([p.lat, p.lon])
    }
    if (ezpark.start) dot(ezpark.start, '#2563eb', 'Start')
    if (ezpark.end) dot(ezpark.end, '#c2410c', 'Bestemming')

    for (const park of ezpark.parks ?? []) {
      L.marker([park.lat, park.lon], {
        title: park.name,
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: '',
          html: '<span style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:#3b82f6;color:#fff;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font:700 18px/1 sans-serif">P</span>',
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      }).bindTooltip(park.name, { direction: 'top', offset: [0, -16] }).addTo(group)
      bounds.push([park.lat, park.lon])
    }

    for (const leg of ezpark.legs) {
      if (leg.coordinates.length < 2) continue
      const points = leg.coordinates.map(([lat, lon]) => [lat, lon] as [number, number])
      const style =
        leg.mode === 'drive' ? { color: '#d94a4a', weight: 5 }
        : leg.mode === 'walk' ? { color: '#475569', weight: 4, dashArray: '2 8' }
        : { color: '#0f766e', weight: 5 }
      L.polyline(points, { ...style, opacity: 0.9 }).addTo(group)
      bounds.push(...points)
    }

    ezLayer.current = group
    if (ezpark.legs.length > 0 && bounds.length > 0) m.fitBounds(L.latLngBounds(bounds).pad(0.15), { animate: true })
  }, [ezpark])

  // De spelden: bij elke vernieuwing opnieuw tekenen. Vijftig spelden is niets.
  useEffect(() => {
    const m = map.current
    const group = layer.current
    if (!m || !group) return

    group.clearLayers()
    markers.current.clear()

    // De personeelsstalling van het Stadskantoor deelt haar coördinaat met de openbare — dat is
    // hetzelfde gebouw, en er is met opzet geen kunstmatige verschuiving bij gezet. Teken daarom
    // eerst wat niet openbaar is, zodat de speld waar je wél terechtkunt bovenop ligt.
    for (const p of [...parkings].sort((a, b) => Number(a.isPublic) - Number(b.isPublic))) {
      const marker = L.marker([p.lat, p.lon], {
        icon: icon(p, bluePins),
        title: p.name,
        riseOnHover: true,
        keyboard: true,
        alt: `${p.name}, ${describe(p)}`,
      })
      marker.bindPopup(popup(p), { closeButton: true, maxWidth: 260 })
      marker.on('click', () => onSelect?.(p.slug))
      marker.on('popupopen', () => {
        const link = document.getElementById(`popup-link-${p.slug}`)
        link?.addEventListener('click', (e) => {
          e.preventDefault()
          navigate(`/parking/${p.slug}`)
        })
      })
      marker.addTo(group)
      markers.current.set(p.slug, marker)
    }
  }, [parkings, navigate, onSelect, bluePins])

  // Wat in de lijst aangewezen wordt, opent op de kaart.
  useEffect(() => {
    if (!selected) return
    const marker = markers.current.get(selected)
    if (!marker || !map.current) return
    map.current.panTo(marker.getLatLng(), { animate: true })
    marker.openPopup()
  }, [selected, parkings])

  return <div ref={host} className="map" role="application" aria-label="Kaart van de parkings in Gent" />
}

function icon(p: Parking, blue = false): L.DivIcon {
  const level = busyness(p.status)
  const open = p.status?.isOpen !== false
  const blueStyle = blue ? ' style="background:#3b82f6;border-color:#3b82f6;color:#fff"' : ''

  // Een fietsenstalling krijgt een vierkante speld in plaats van een ronde. Zo is de soort af te
  // lezen zonder op de kleur te steunen — die draagt hier al de drukte.
  if (p.kind === 'bicycle' && p.status) {
    const shape = p.isPublic ? 'pin-bike' : 'pin-bike pin-bike-private'
    return L.divIcon({
      className: '',
      html: `<span class="pin ${shape} level-${level}" title="${escape(p.name)}">${compact(p.status.available)}</span>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -17],
    })
  }

  if (!p.hasLiveData || !p.status) {
    // Geen meting: een open ring met de capaciteit. Onmiskenbaar iets anders dan een gemeten plek.
    return L.divIcon({
      className: '',
      html: `<span class="pin pin-unknown"${blueStyle} title="${escape(p.name)}">${compact(p.capacity)}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -16],
    })
  }

  const text = open ? compact(p.status.available) : '—'
  return L.divIcon({
    className: '',
    html: `<span class="pin level-${level}"${blueStyle} title="${escape(p.name)}">${text}</span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -18],
  })
}

function compact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  return String(n)
}

function describe(p: Parking): string {
  if (!p.status) return `geen meting, ${p.capacity} plaatsen`
  if (!p.isPublic) return `privaat, ${p.status.available} vrij van ${p.status.capacity}`
  if (!p.status.isOpen) return 'gesloten'
  return `${busynessLabel[busyness(p.status)]}, ${p.status.available} vrij van ${p.status.capacity}`
}

function popup(p: Parking): string {
  const kind = kindLabel[p.kind] + (p.isPublic ? '' : ' · privaat, voor personeel')
  const status = p.status
    ? p.status.isOpen
      ? `<b>${p.status.available.toLocaleString('nl-BE')}</b> vrij van ${p.status.capacity.toLocaleString('nl-BE')}` +
        (p.status.occupancy === undefined || p.status.occupancy === null ? '' : ` · ${p.status.occupancy} % bezet`)
      : '<b>Gesloten</b>'
    : `${p.capacity.toLocaleString('nl-BE')} plaatsen · de stad meet hier niet`
  return `
    <div class="pin-popup">
      <strong>${escape(p.name)}</strong>
      <small>${kind}${p.address ? ` · ${escape(p.address)}` : ''}</small>
      <p>${status}</p>
      <a id="popup-link-${escape(p.slug)}" href="/parking/${escape(p.slug)}">Verloop en drukte →</a>
    </div>`
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}
