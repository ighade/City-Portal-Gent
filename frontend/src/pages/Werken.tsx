import { useEffect, useMemo, useRef, useState } from 'react'
import L, { addThemedBasemap, GENT_BOUNDS, GENT_CENTER } from '../leaflet'
import { fetchWorks, isOpenEnded, KIND_ORDER, KINDS, timing } from '../roadworks'
import type { Timing, Work, WorkKind } from '../roadworks'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const fmt = (d: Date | null) => (d ? d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

// De zeldzame soorten krijgen naast hun vlak ook een icoon, anders verdwijnen ze tussen de 900+ rijstrookzones.
const ICONS: Partial<Record<WorkKind, string>> = { afgesloten: '⛔', parkeer: 'P', beperkt: '🚶' }

function polygonStyle(w: Work): L.PathOptions {
  const color = KINDS[w.kind].color
  switch (w.kind) {
    case 'afgesloten':
      return { color, weight: 3, dashArray: '6 4', fillColor: color, fillOpacity: 0.45 }
    case 'parkeer':
      return { color, weight: 2, fillColor: color, fillOpacity: 0.4 }
    case 'beperkt':
      return { color, weight: 2, dashArray: '2 4', fillColor: color, fillOpacity: 0.3 }
    case 'werf':
      return { color: '#2b2640', weight: 2, fillColor: color, fillOpacity: 0.7 }
    default:
      return { color, weight: 1, fillColor: color, fillOpacity: 0.25 }
  }
}

function popupHtml(w: Work): string {
  const k = KINDS[w.kind]
  const when = isOpenEnded(w.end) ? `Sinds ${fmt(w.start)} · geen einddatum` : `${fmt(w.start)} → ${fmt(w.end)}`
  return `<div class="werk-popup">
    <strong style="color:${k.color}">${esc(k.label)}</strong>${w.severe ? ' <span class="werk-severe">ernstige hinder</span>' : ''}
    ${w.description ? `<p>${esc(w.description.slice(0, 220))}</p>` : ''}
    ${w.consequences.length ? `<ul>${w.consequences.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <small>${esc(when)}<br>${esc(w.owner)}</small>
  </div>`
}

const TIMINGS: Array<{ id: Timing; label: string }> = [
  { id: 'actief', label: 'Nu bezig' },
  { id: 'gepland', label: 'Gepland' },
  { id: 'afgelopen', label: 'Afgelopen' },
]

export function Werken() {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)

  const [works, setWorks] = useState<Work[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kinds, setKinds] = useState<Set<WorkKind>>(() => new Set(KIND_ORDER))
  const [times, setTimes] = useState<Set<Timing>>(() => new Set<Timing>(['actief']))

  useEffect(() => {
    const ctrl = new AbortController()
    fetchWorks(ctrl.signal).then(setWorks).catch((e: unknown) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Laden mislukt')
    })
    return () => ctrl.abort()
  }, [])

  useEffect(() => {
    if (!host.current || map.current) return
    const instance = L.map(host.current, {
      center: GENT_CENTER,
      zoom: 13,
      minZoom: 9,
      maxZoom: 19,
      maxBounds: L.latLngBounds(GENT_BOUNDS).pad(1),
      preferCanvas: true,
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

  const counts = useMemo(() => {
    const c: Record<WorkKind, number> = { afgesloten: 0, parkeer: 0, beperkt: 0, rijstrook: 0, werf: 0 }
    for (const w of works ?? []) if (times.has(timing(w))) c[w.kind]++
    return c
  }, [works, times])

  const visible = useMemo(
    () => (works ?? []).filter((w) => kinds.has(w.kind) && times.has(timing(w))),
    [works, kinds, times],
  )

  useEffect(() => {
    const m = map.current
    const group = layer.current
    if (!m || !group) return
    group.clearLayers()
    // Zwaarste soorten als laatste tekenen zodat ze bovenop liggen.
    const sorted = [...visible].sort((a, b) => KIND_ORDER.indexOf(b.kind) - KIND_ORDER.indexOf(a.kind))
    for (const w of sorted) {
      L.geoJSON(w.geometry, { style: () => polygonStyle(w) }).bindPopup(popupHtml(w), { maxWidth: 280 }).addTo(group)
      const icon = ICONS[w.kind]
      if (icon) {
        L.marker(w.center, {
          title: KINDS[w.kind].label,
          zIndexOffset: 500,
          icon: L.divIcon({
            className: '',
            html: `<span class="werk-pin" style="background:${KINDS[w.kind].color}">${icon}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            popupAnchor: [0, -12],
          }),
        })
          .bindPopup(popupHtml(w), { maxWidth: 280 })
          .addTo(group)
      }
    }
    if (!fitted.current && works && visible.length > 0) {
      fitted.current = true
      const inGent = visible.filter((w) => L.latLngBounds(GENT_BOUNDS).contains(w.center))
      if (inGent.length > 0) m.fitBounds(L.latLngBounds(inGent.map((w) => w.center)).pad(0.1))
    }
  }, [visible, works])

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set)
    if (!next.delete(v)) next.add(v)
    apply(next)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Werken in Gent</h1>
          <p>Wegenwerken en inname van openbaar domein, rechtstreeks van data.stad.gent. Parkeerverboden vallen het meest op.</p>
        </div>
      </div>

      <div className="werken-bar">
        <div className="werken-filters">
          {TIMINGS.map((t) => (
            <button key={t.id} type="button" className={`chip${times.has(t.id) ? ' on' : ''}`} onClick={() => toggle(times, t.id, setTimes)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="werken-filters">
          {KIND_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              title={KINDS[k].hint}
              className={`chip${kinds.has(k) ? ' on' : ''}`}
              onClick={() => toggle(kinds, k, setKinds)}
            >
              <span className="werken-dot" style={{ background: KINDS[k].color }} />
              {KINDS[k].label} <small>{counts[k]}</small>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="empty">Kon de werken niet laden: {error}</div>}
      {!works && !error && <div className="empty">Werken laden…</div>}
      <div ref={host} className="werken-map" />
      {works && <p className="werken-note">{visible.length} zones getoond. Bron: GIPOD via data.stad.gent.</p>}
    </>
  )
}
