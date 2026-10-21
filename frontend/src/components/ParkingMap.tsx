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
import type { EzParkLeg, GentEvent, Parking } from '../types'

interface RoutePoint {
  lat: number
  lon: number
  label: string
}

interface RouteOverlay {
  start: RoutePoint
  end: RoutePoint
  mode: 'car' | 'foot-walking' | 'cycling-regular'
  points: Array<{ lat: number; lon: number }>
}

/** Een evenement met coördinaat, voor de kalenderspelden op de routekaart. */
export interface MapEvent {
  event: GentEvent
  lat: number
  lon: number
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
  /** Info bij hoveren in plaats van een popup bij klikken; klikken meldt alleen de selectie. */
  hoverInfo?: boolean
  /** Klik op een EZ Park-speld. */
  onEzParkPick?: (slug: string) => void
  /** Evenementen als kalenderspeld; hoveren toont de kaart, klikken meldt het evenement. */
  events?: MapEvent[]
  onEventPick?: (event: MapEvent) => void
}

interface EzParkOverlay {
  start?: { lat: number; lon: number } | null
  end?: { lat: number; lon: number } | null
  legs: EzParkLeg[]
  parks?: Array<{ lat: number; lon: number; name: string; slug: string; details: string[]; available: number | null; capacity: number }>
}

/**
 * De kaart met een speld per parking.
 *
 * <b>Op de speld staat het aantal vrije plaatsen</b>, niet alleen een kleur. Dat is de reden om
 * de kaart te openen, en het maakt de kaart leesbaar voor wie kleur slecht onderscheidt: rood en
 * groen verschillen hier ook in wat erin staat. Een parking zonder meting krijgt een open ring
 * met haar capaciteit — zichtbaar anders dan een gemeten plek.
 */
/** Zwarte of witte tekst, afhankelijk van de lijnkleur. */
export function textOn(hex?: string) {
  if (!hex) return '#fff'
  const n = parseInt(hex, 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#111827' : '#fff'
}

export function ParkingMap({ parkings, basemap, showLez, selected, onSelect, route, onMapClick, ezpark, bluePins, hoverInfo, onEzParkPick, events, onEventPick }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const routeLayer = useRef<L.LayerGroup | null>(null)
  const ezLayer = useRef<L.LayerGroup | null>(null)
  const clickHandler = useRef(onMapClick)
  clickHandler.current = onMapClick
  const eventLayer = useRef<L.LayerGroup | null>(null)
  const eventPick = useRef(onEventPick)
  eventPick.current = onEventPick
  const ezPick = useRef(onEzParkPick)
  ezPick.current = onEzParkPick
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
      route.mode === 'foot-walking' ? { color: '#475569', weight: 4, opacity: 0.9, dashArray: '2 8' }
        : route.mode === 'cycling-regular' ? { color: '#16a34a', weight: 5, opacity: 0.9 }
        : { color: '#d94a4a', weight: 5, opacity: 0.9 },
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
      })
        .bindPopup(
          `<div class="pin-popup"><strong>${escape(park.name)}</strong>${park.available !== null && park.capacity > 0 ? occupancyBar(park.available, park.capacity) : '<p>Beschikbaarheid onbekend</p>'}${park.details.map((d) => `<p>${escape(d)}</p>`).join('')}</div>`,
          { closeButton: false, maxWidth: 260, autoPan: false, offset: [0, -8] },
        )
        .on('mouseover', (e) => e.target.openPopup())
        .on('mouseout', (e) => e.target.closePopup())
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          ezPick.current?.(park.slug)
        })
        .addTo(group)
      bounds.push([park.lat, park.lon])
    }

    for (const leg of ezpark.legs) {
      if (leg.coordinates.length < 2) continue
      const points = leg.coordinates.map(([lat, lon]) => [lat, lon] as [number, number])
      const transitColor = leg.color ? `#${leg.color}` : leg.mode === 'tram' ? '#d97706' : '#0f766e'
      const style =
        leg.mode === 'drive' ? { color: '#d94a4a', weight: 5 }
        : leg.mode === 'walk' ? { color: '#475569', weight: 4, dashArray: '2 8' }
        : { color: transitColor, weight: 6 }
      L.polyline(points, { ...style, opacity: 0.9 }).addTo(group)
      if ((leg.mode === 'bus' || leg.mode === 'tram') && leg.line) {
        const mid = points[Math.floor(points.length / 2)]
        L.marker(mid, {
          interactive: false,
          icon: L.divIcon({
            className: '',
            html: `<span class="line-badge" style="background:${transitColor};color:${textOn(leg.color)}">${leg.line}</span>`,
            iconSize: [0, 0],
          }),
        }).addTo(group)
      }
      bounds.push(...points)
    }

    ezLayer.current = group
    if (ezpark.legs.length > 0 && bounds.length > 0) m.fitBounds(L.latLngBounds(bounds).pad(0.15), { animate: true })
  }, [ezpark])

  // Evenementen van deze week: kalenderspeld, kaart bij hoveren, route bij klikken.
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!events || events.length === 0) return

    const draw = () => {
    eventLayer.current?.remove()
    const group = L.layerGroup().addTo(m)

    // Spelden die op het scherm dichter dan EVENT_CLUSTER_PX bij elkaar liggen worden één speld;
    // bij inzoomen vallen ze vanzelf uit elkaar.
    const clusters: Array<{ items: MapEvent[]; x: number; y: number }> = []
    for (const item of events) {
      const pt = m.project([item.lat, item.lon])
      const near = clusters.find((c) => Math.hypot(c.x - pt.x, c.y - pt.y) < EVENT_CLUSTER_PX)
      if (near) near.items.push(item)
      else clusters.push({ items: [item], x: pt.x, y: pt.y })
    }

    for (const { items } of clusters) {
      const first = items[0]
      const lat = items.reduce((sum, i) => sum + i.lat, 0) / items.length
      const lon = items.reduce((sum, i) => sum + i.lon, 0) / items.length
      let closeTimer: number | undefined
      L.marker([lat, lon], {
        title: items.length > 1 ? `${items.length} evenementen` : first.event.name,
        zIndexOffset: 500,
        icon: L.divIcon({
          className: '',
          html: `<span class="event-pin" title="${escape(first.event.name)}">${calendarSvg}${items.length > 1 ? `<span class="event-pin-count">${items.length}</span>` : ''}</span>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -14],
        }),
      })
        .bindPopup(eventGroupHtml(items), {
          closeButton: false,
          maxWidth: 800,
          minWidth: 260,
          autoPan: false,
          className: 'event-popup event-popup-group',
        })
        .on('mouseover', (e) => {
          const marker = e.target as L.Marker
          const popup = marker.getPopup()
          if (!popup) return
          window.clearTimeout(closeTimer)
          popup.options.offset = L.point(0, 0)
          // De kaart past in de ruimte boven of onder de speld, de grootste van de twee; wat niet past scrolt.
          const y = m.latLngToContainerPoint(marker.getLatLng()).y
          const roomAbove = y - 34 - 8
          const roomBelow = m.getSize().y - y - 56 - 8
          popup.options.maxHeight = Math.max(160, Math.max(roomAbove, roomBelow))
          marker.openPopup()
          const height = popup.getElement()?.offsetHeight ?? 0
          const below = height > roomAbove && roomBelow > roomAbove
          popup.getElement()?.classList.toggle('event-popup-below', below)
          if (below) {
            // Kaart helemaal onder de speld: boven de wrapper zit 20 px marge, de speld is 30 px hoog.
            popup.options.offset = L.point(0, height + 56)
            popup.update()
          }
          const el = popup.getElement()
          if (el && !el.dataset.bound) {
            // De kaart blijft open zolang de muis erboven staat, om te scrollen en een kaart aan te klikken.
            el.dataset.bound = '1'
            el.addEventListener('mouseenter', () => window.clearTimeout(closeTimer))
            el.addEventListener('mouseleave', () => { closeTimer = window.setTimeout(() => marker.closePopup(), 150) })
            el.addEventListener('click', (ev) => {
              const card = (ev.target as HTMLElement).closest<HTMLElement>('[data-event-index]')
              const picked = card ? items[Number(card.dataset.eventIndex)] : undefined
              if (!picked) return
              marker.closePopup()
              navigate(`/events/${encodeURIComponent(picked.event.id)}`)
            })
          }
        })
        .on('mouseout', (e) => {
          const marker = e.target as L.Marker
          closeTimer = window.setTimeout(() => marker.closePopup(), 250)
        })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          eventPick.current?.(first)
        })
        .addTo(group)
    }
    eventLayer.current = group
    }

    draw()
    m.on('zoomend', draw)
    return () => {
      m.off('zoomend', draw)
      eventLayer.current?.remove()
      eventLayer.current = null
    }
  }, [events])

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
      if (hoverInfo) {
        marker.bindPopup(popup(p, false), { closeButton: false, maxWidth: 260, autoPan: false })
        marker.on('mouseover', () => marker.openPopup())
        marker.on('mouseout', () => marker.closePopup())
      } else {
        marker.bindPopup(popup(p), { closeButton: true, maxWidth: 260 })
      }
      marker.on('click', (e) => {
        if (hoverInfo) L.DomEvent.stopPropagation(e)
        onSelect?.(p.slug)
      })
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
  }, [parkings, navigate, onSelect, bluePins, hoverInfo])

  // Wat in de lijst aangewezen wordt, opent op de kaart.
  useEffect(() => {
    if (!selected || hoverInfo) return
    const marker = markers.current.get(selected)
    if (!marker || !map.current) return
    map.current.panTo(marker.getLatLng(), { animate: true })
    marker.openPopup()
  }, [selected, parkings])

  return <div ref={host} className="map" role="application" aria-label="Kaart van de parkings in Gent" />
}

const EVENT_CLUSTER_PX = 34

const calendarSvg =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'

const eventDate = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short' })
const eventWeekday = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'long' })
const eventTime = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

// Zelfde opbouw en klassen als EventCard op de evenementenpagina.
function eventCardHtml(e: GentEvent, index?: number): string {
  const start = e.startsAtUtc ? new Date(e.startsAtUtc) : null
  const [day, month] = start ? eventDate.format(start).split(' ') : ['', '']
  const cover = e.coverImageUrl
    ? `<img src="${escape(e.coverImageUrl)}" alt="${escape(e.coverCaption ?? e.name)}" referrerpolicy="no-referrer" />`
    : `<div class="event-cover-fallback" aria-hidden="true">${escape(e.name.slice(0, 1).toUpperCase())}</div>`
  return `<div class="card event-card"${index === undefined ? '' : ` data-event-index="${index}"`}>
    <div class="event-cover">${cover}
      ${start ? `<div class="event-date"><b>${escape(day)}</b><span>${escape((month ?? '').replace('.', ''))}</span></div>` : ''}
      ${e.isHappeningNow ? '<span class="event-live">Nu bezig</span>' : ''}
    </div>
    <div class="event-body">
      <h3>${escape(e.name)}</h3>
      ${start ? `<p class="event-when">${escape(eventWeekday.format(start))} · ${escape(eventTime.format(start))}</p>` : ''}
      ${e.place ? `<p class="event-place">${escape(e.place)}</p>` : ''}
      <div class="event-foot">${e.socialSummary ? `<span>${escape(e.socialSummary)}</span>` : ''}${e.ticketPriceLabel ? `<span class="event-price">${escape(e.ticketPriceLabel)}</span>` : ''}</div>
      <p class="event-hint">Klik op de kaart voor details · klik op de speld voor de route</p>
    </div>
  </div>`
}

function eventGroupHtml(items: MapEvent[]): string {
  return `<div class="event-group${items.length === 1 ? ' event-group-single' : ''}">${items.map((item, i) => eventCardHtml(item.event, i)).join('')}</div>`
}

function icon(p: Parking, blue = false): L.DivIcon {
  // Op de routepagina is het een blauwe P-speld; de vrije plaatsen staan in de popup bij hover.
  if (blue) {
    return L.divIcon({
      className: '',
      html: `<span title="${escape(p.name)}" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#3b82f6;color:#fff;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font:700 16px/1 sans-serif">P</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -14],
    })
  }

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

function compact(n: number | null): string {
  if (n === null) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  return String(n)
}

function describe(p: Parking): string {
  if (!p.status) return `geen meting, ${p.capacity} plaatsen`
  const available = p.status.available === null
    ? `vrije plaatsen onbekend van ${p.status.capacity}`
    : `${p.status.available} vrij van ${p.status.capacity}`
  if (!p.isPublic) return `privaat, ${available}`
  if (!p.status.isOpen) return 'gesloten'
  return `${busynessLabel[busyness(p.status)]}, ${available}`
}

function popup(p: Parking, withLink = true): string {
  const kind = kindLabel[p.kind] + (p.isPublic ? '' : ' · privaat, voor personeel')
  const available = p.status?.available === null
    ? `<b>Onbekend</b> vrij van ${p.status.capacity.toLocaleString('nl-BE')}`
    : p.status
      ? `<b>${p.status.available.toLocaleString('nl-BE')}</b> vrij van ${p.status.capacity.toLocaleString('nl-BE')}`
      : ''
  const occupancy = p.status?.occupancy == null ? '' : ` · ${p.status.occupancy} % bezet`
  const status = p.status
    ? p.status.isOpen
      ? available + occupancy
      : '<b>Gesloten</b>'
    : `${p.capacity.toLocaleString('nl-BE')} plaatsen · de stad meet hier niet`
  const bar = !withLink && p.status?.isOpen && p.status.available !== null && p.status.capacity > 0
    ? occupancyBar(p.status.available, p.status.capacity)
    : ''
  return `
    <div class="pin-popup">
      <strong>${escape(p.name)}</strong>
      <small>${kind}${p.address ? ` · ${escape(p.address)}` : ''}</small>
      ${bar || `<p>${status}</p>`}
      ${withLink ? `<a id="popup-link-${escape(p.slug)}" href="/parking/${escape(p.slug)}">Verloop en drukte →</a>` : ''}
    </div>`
}

function occupancyBar(available: number, capacity: number): string {
  const pct = Math.min(100, Math.max(0, Math.round(((capacity - available) / capacity) * 100)))
  const color = pct < 50 ? '#16a34a' : pct < 80 ? '#f59e0b' : '#dc2626'
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px">
    <div title="${pct} % bezet" style="width:120px;height:8px;border-radius:999px;background:#e5e7eb;overflow:hidden">
      <div style="width:${Math.max(2, pct)}%;height:100%;background:${color}"></div>
    </div>
    <span style="white-space:nowrap">${available.toLocaleString('nl-BE')} vrij van ${capacity.toLocaleString('nl-BE')}</span>
  </div>`
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}
