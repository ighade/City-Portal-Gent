import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ParkingMap } from '../components/ParkingMap'
import { useApp } from '../context/AppContext'
import { busyness, busynessLabel, kindLabel } from '../types'
import type { Parking } from '../types'

type Kind = 'alles' | 'garage' | 'park-and-ride' | 'bicycle'
type Sort = 'vrij' | 'naam' | 'bezetting'

export function Kaart() {
  const { parkings, stats, loading } = useApp()
  const [kind, setKind] = useState<Kind>('alles')
  const [onlyLive, setOnlyLive] = useState(false)
  const [sort, setSort] = useState<Sort>('vrij')
  const [basemap, setBasemap] = useState<'grb' | 'osm'>('grb')
  const [showLez, setShowLez] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const shown = useMemo(() => {
    const filtered = parkings.filter(
      (p) => (kind === 'alles' || p.kind === kind) && (!onlyLive || (p.hasLiveData && p.status?.isOpen)),
    )
    return [...filtered].sort(comparer(sort))
  }, [parkings, kind, onlyLive, sort])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Waar is er plaats in Gent?</h1>
          <p>
            De bezetting van de parkeergarages en de drie grote fietsenstallingen komt elke vijf
            minuten rechtstreeks van de stad. De park-and-rides en de kleinere parkings staan er met
            hun capaciteit bij; daar meet de stad niet.
          </p>
        </div>
      </div>

      {stats && (
        <div className="tiles">
          <Tile label="Vrije plaatsen nu" value={stats.availableSpaces} accent />
          <Tile label="Gemeten plaatsen" value={stats.totalCapacity} />
          <Tile
            label="Samen bezet"
            value={stats.occupancy === undefined || stats.occupancy === null ? '—' : `${stats.occupancy} %`}
          />
          <Tile label="Parkings op de kaart" value={stats.parkings} sub={`${stats.withLiveData} met meting`} />
          {stats.bicycle.facilities > 0 && (
            <Tile
              label="Fietsplaatsen vrij"
              value={stats.bicycle.availableSpaces}
              sub={`van ${stats.bicycle.totalCapacity.toLocaleString('nl-BE')} · ${stats.bicycle.occupancy ?? '—'} % bezet`}
            />
          )}
        </div>
      )}

      {/* Filters in één rij boven de kaart, niet ernaast: zo blijft de kaart de breedte houden. */}
      <div className="filters">
        <div className="segmented" role="group" aria-label="Soort parking">
          {(
            [
              ['alles', 'Alles'],
              ['garage', 'Parkings'],
              ['park-and-ride', 'Park and ride'],
              ['bicycle', 'Fietsen'],
            ] as [Kind, string][]
          ).map(([value, label]) => (
            <button key={value} className={kind === value ? 'on' : ''} onClick={() => setKind(value)}>
              {label}
            </button>
          ))}
        </div>

        <label className="switch">
          <input type="checkbox" checked={onlyLive} onChange={(e) => setOnlyLive(e.target.checked)} />
          Alleen open, met meting
        </label>

        <label className="switch" title="De zone waar niet elke wagen binnen mag">
          <input type="checkbox" checked={showLez} onChange={(e) => setShowLez(e.target.checked)} />
          <span className="lez-swatch" aria-hidden="true" />
          Lage-emissiezone
        </label>

        <label className="field-inline">
          Sorteer
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="vrij">meeste plaats eerst</option>
            <option value="bezetting">minst bezet eerst</option>
            <option value="naam">op naam</option>
          </select>
        </label>

        <div className="segmented grow-end" role="group" aria-label="Achtergrondkaart">
          <button className={basemap === 'grb' ? 'on' : ''} onClick={() => setBasemap('grb')}>
            GRB
          </button>
          <button className={basemap === 'osm' ? 'on' : ''} onClick={() => setBasemap('osm')}>
            OpenStreetMap
          </button>
        </div>
      </div>

      <div className="split">
        <ParkingMap
          parkings={shown}
          basemap={basemap}
          showLez={showLez}
          selected={selected}
          onSelect={setSelected}
        />

        <div className="list" aria-label="Parkings">
          {loading && shown.length === 0 && <p className="empty">Even geduld…</p>}
          {!loading && shown.length === 0 && <p className="empty">Geen parking voldoet aan deze keuze.</p>}
          {shown.map((p) => (
            <Row key={p.slug} parking={p} active={p.slug === selected} onHover={() => setSelected(p.slug)} />
          ))}
        </div>
      </div>
    </>
  )
}

function Row({ parking, active, onHover }: { parking: Parking; active: boolean; onHover: () => void }) {
  const level = busyness(parking.status)
  const status = parking.status

  return (
    <Link
      to={`/parking/${parking.slug}`}
      className={`row ${active ? 'row-active' : ''}`}
      onMouseEnter={onHover}
      onFocus={onHover}
    >
      <span className={`dot level-${level}`} aria-hidden="true" />
      <span className="row-main">
        <b>{parking.name}</b>
        <small className="muted">
          {kindLabel[parking.kind]}
          {parking.isPublic ? '' : ' · privaat'}
          {parking.address ? ` · ${parking.address}` : ''}
        </small>
      </span>
      <span className="row-num">
        {status && status.isOpen ? (
          <>
            <b>{status.available.toLocaleString('nl-BE')}</b>
            <small className="muted">vrij</small>
          </>
        ) : status && !status.isOpen ? (
          <small className="muted">gesloten</small>
        ) : (
          <>
            <b className="muted">{parking.capacity.toLocaleString('nl-BE')}</b>
            <small className="muted">plaatsen</small>
          </>
        )}
      </span>
      <span className="row-level small muted">{busynessLabel[level]}</span>
    </Link>
  )
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: number | string
  sub?: string
  accent?: boolean
}) {
  return (
    <div className={`tile ${accent ? 'tile-accent' : ''}`}>
      <span className="tile-value">{typeof value === 'number' ? value.toLocaleString('nl-BE') : value}</span>
      <span className="tile-label">{label}</span>
      {sub && <span className="tile-sub muted">{sub}</span>}
    </div>
  )
}

function comparer(sort: Sort): (a: Parking, b: Parking) => number {
  if (sort === 'naam') return (a, b) => a.name.localeCompare(b.name, 'nl-BE')
  if (sort === 'bezetting') {
    // Zonder meting achteraan: "onbekend" is geen 0 %.
    return (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'nl-BE')
  }
  return (a, b) => free(b) - free(a) || a.name.localeCompare(b.name, 'nl-BE')
}

function free(p: Parking): number {
  return p.status?.isOpen ? p.status.available : -1
}

function rank(p: Parking): number {
  const pct = p.status?.isOpen ? p.status.occupancy : undefined
  return pct === undefined || pct === null ? 999 : pct
}
