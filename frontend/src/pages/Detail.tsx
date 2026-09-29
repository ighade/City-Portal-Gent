import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { OccupancyMeter } from '../components/OccupancyMeter'
import { TimeChart } from '../components/TimeChart'
import { TrendHeatmap } from '../components/TrendHeatmap'
import { kindLabel } from '../types'
import type { Parking, Point, Trend } from '../types'

const WINDOWS: [number, string][] = [
  [6, '6 uur'],
  [24, '24 uur'],
  [72, '3 dagen'],
  [168, 'een week'],
]

export function Detail() {
  const { slug = '' } = useParams()
  const [parking, setParking] = useState<Parking | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [trend, setTrend] = useState<Trend | null>(null)
  const [hours, setHours] = useState(24)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    api.parking(slug).then(setParking).catch((e: Error) => setError(e.message))
    api.trend(slug).then(setTrend).catch(() => setTrend(null))
  }, [slug])

  useEffect(() => {
    api.history(slug, hours).then(setPoints).catch(() => setPoints([]))
  }, [slug, hours])

  if (error) {
    return (
      <div className="empty">
        {error} <Link to="/">Terug naar de kaart</Link>
      </div>
    )
  }
  if (!parking) return <div className="empty">Even geduld…</div>

  const capacity = parking.status?.capacity || parking.capacity

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/" className="back">
            ← Alle parkings
          </Link>
          <h1>{parking.name}</h1>
          <p>
            {kindLabel[parking.kind]}
            {parking.address ? ` · ${parking.address}` : ''}
          </p>
        </div>
      </div>

      <div className="card">
        {!parking.isPublic && (
          <p className="banner" role="note">
            Deze stalling is voor personeel. Stad Gent meet en publiceert haar bezetting, maar je kunt
            er niet terecht — ze staat hier alleen omdat de cijfers er zijn.
          </p>
        )}
        <OccupancyMeter status={parking.status} />
        <dl className="facts">
          <Fact label="Plaatsen">{capacity.toLocaleString('nl-BE')}</Fact>
          {parking.openingHours && <Fact label="Open">{parking.openingHours}</Fact>}
          {parking.operator && <Fact label="Beheerder">{parking.operator}</Fact>}
          {parking.inLowEmissionZone !== undefined && parking.inLowEmissionZone !== null && (
            <Fact label="Lage-emissiezone">{parking.inLowEmissionZone ? 'binnen de LEZ' : 'buiten de LEZ'}</Fact>
          )}
          {parking.isFree !== undefined && parking.isFree !== null && (
            <Fact label="Tarief">{parking.isFree ? 'gratis' : 'betalend'}</Fact>
          )}
          {parking.status && (
            <Fact label="Laatste meting">
              {new Date(parking.status.measuredAtUtc).toLocaleString('nl-BE')}
            </Fact>
          )}
        </dl>
        <div className="row">
          <a
            className="btn"
            href={`https://www.openstreetmap.org/directions?to=${parking.lat}%2C${parking.lon}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Route hierheen
          </a>
          {parking.url && (
            <a className="btn btn-ghost" href={parking.url} target="_blank" rel="noreferrer noopener">
              Pagina van de stad
            </a>
          )}
        </div>
      </div>

      {parking.hasLiveData ? (
        <>
          <div className="card">
            <div className="card-title">
              <h2>Vrije plaatsen — de laatste {WINDOWS.find(([h]) => h === hours)?.[1] ?? `${hours} uur`}</h2>
              <div className="segmented" role="group" aria-label="Tijdvenster">
                {WINDOWS.map(([h, label]) => (
                  <button key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <TimeChart points={points} capacity={capacity} />
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Hoe druk is het hier normaal?</h2>
            </div>
            {trend ? (
              <TrendHeatmap trend={trend} />
            ) : (
              <p className="chart-empty muted small">Nog geen patroon beschikbaar.</p>
            )}
          </div>
        </>
      ) : (
        <div className="card">
          <p className="muted">
            Stad Gent publiceert voor deze plek geen bezetting — alleen waar ze ligt en hoeveel
            plaatsen ze heeft. Zodra daar een meetreeks voor komt, verschijnt ze hier vanzelf.
          </p>
        </div>
      )}
    </>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
