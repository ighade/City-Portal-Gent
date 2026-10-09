import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { Parking, TransitStop } from '../types'

export interface RoutePoint {
  lat: number
  lon: number
  label: string
}

type Pick = 'start' | 'end' | null

/** Gedeelde invoer voor de gewone route en EZ Park: start, bestemming en vertrektijd. */
export function useRouteInputs(parkings: Parking[], mapClick: { lat: number; lon: number; n: number } | null) {
  const [start, setStart] = useState<RoutePoint | null>(null)
  const [end, setEnd] = useState<RoutePoint | null>(null)
  const [endText, setEndText] = useState('')
  const [stops, setStops] = useState<TransitStop[]>([])
  const [pick, setPick] = useState<Pick>(null)
  const [departTime, setDepartTime] = useState('')
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  useEffect(() => {
    api.transit.stops().then(setStops).catch(() => undefined)
  }, [])

  function locate() {
    setLocateError(null)
    if (!navigator.geolocation) {
      setLocateError('Locatie wordt niet ondersteund; klik je startpunt op de kaart.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStart({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Mijn locatie' })
        setLocating(false)
      },
      () => {
        setLocateError('Je locatie is niet beschikbaar; klik je startpunt op de kaart.')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 8000 },
    )
  }

  useEffect(() => {
    locate()
  }, [])

  useEffect(() => {
    if (!mapClick || !pick) return
    const point = { lat: mapClick.lat, lon: mapClick.lon, label: 'Gekozen op kaart' }
    if (pick === 'start') setStart(point)
    else {
      setEnd(point)
      setEndText(point.label)
    }
    setPick(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapClick?.n])

  const places = useMemo(
    () => [
      ...parkings.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })),
      ...stops.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon })),
    ],
    [parkings, stops],
  )

  function onEndText(value: string) {
    setEndText(value)
    const key = value.trim().toLocaleLowerCase('nl-BE')
    const place = places.find((p) => p.name.toLocaleLowerCase('nl-BE') === key)
    if (place) setEnd({ lat: place.lat, lon: place.lon, label: place.name })
  }

  function departInMinutes(): number {
    if (!departTime) return 0
    const [h, m] = departTime.split(':').map(Number)
    const at = new Date()
    at.setHours(h, m, 0, 0)
    return Math.max(0, Math.round((at.getTime() - Date.now()) / 60000))
  }

  const fields: ReactNode = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 260px', minWidth: 0 }}>
        <label>Start</label>
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <input className="input" style={{ flex: 1 }} readOnly value={start ? start.label : ''} title={start ? `${start.lat.toFixed(4)}, ${start.lon.toFixed(4)}` : undefined} placeholder="Geen startpunt" />
          <button className="btn" style={{ whiteSpace: 'nowrap' }} onClick={locate} disabled={locating}>{locating ? '…' : 'Mijn locatie'}</button>
          <button className={`btn${pick === 'start' ? ' btn-primary' : ''}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setPick(pick === 'start' ? null : 'start')}>Op kaart</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 260px', minWidth: 0 }}>
        <label htmlFor="route-end">Bestemming</label>
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <input id="route-end" className="input" style={{ flex: 1 }} list="route-places" value={endText} onChange={(e) => onEndText(e.target.value)} placeholder="Zoek een parking of halte" />
          <datalist id="route-places">
            {places.map((p, i) => <option key={`${p.name}-${i}`} value={p.name} />)}
          </datalist>
          <button className={`btn${pick === 'end' ? ' btn-primary' : ''}`} style={{ whiteSpace: 'nowrap' }} onClick={() => setPick(pick === 'end' ? null : 'end')}>Op kaart</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="route-time">Vertrek (vandaag)</label>
        <input id="route-time" className="input" type="time" value={departTime} onChange={(e) => setDepartTime(e.target.value)} />
      </div>
    </>
  )

  const hint = pick
    ? `Klik op de kaart om je ${pick === 'start' ? 'startpunt' : 'bestemming'} te kiezen.`
    : null

  return { start, end, departTime, departInMinutes, fields, hint, locateError }
}
