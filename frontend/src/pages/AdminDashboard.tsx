import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../context/AppContext'
import { ParkingMap } from '../components/ParkingMap'
import { activeRateText } from '../components/RateInfo'
import type { AdminParking, AuditEntry, StaleParking, SyncRun } from '../types'

const STALE_MINUTES = 30

const actionLabel: Record<string, string> = {
  'zoneprijzen-gewijzigd': 'Zoneprijzen gewijzigd',
  'parking-toegevoegd': 'Parking toegevoegd',
  'parking-verwijderd': 'Parking verwijderd',
  'tarief-gewijzigd': 'Tarief gewijzigd',
  'tarief-verwijderd': 'Tarief verwijderd',
  'event-toegevoegd': 'Event toegevoegd',
  'event-verwijderd': 'Event verwijderd',
  'gebruiker-geschorst': 'Gebruiker geschorst',
  'gebruiker-heractiveerd': 'Gebruiker heractiveerd',
  'gebruiker-verwijderd': 'Gebruiker verwijderd',
}

function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} u` : `${Math.round(hours / 24)} d`
}

export function AdminDashboard() {
  const { refresh, meta, parkings } = useApp()
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [stale, setStale] = useState<StaleParking[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [adminParkings, setAdminParkings] = useState<AdminParking[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    const fail = (e: unknown) => setNote(e instanceof Error ? e.message : 'Beheergegevens konden niet geladen worden.')
    api.admin.runs(50).then(setRuns).catch(fail)
    api.admin.stale(STALE_MINUTES).then(setStale).catch(fail)
    api.admin.audit(10).then(setAudit).catch(fail)
    api.admin.parkings().then(setAdminParkings).catch(fail)
  }, [])

  useEffect(load, [load])

  const withData = parkings.filter((p) => p.hasLiveData)
  const withRates = adminParkings.filter((p) => p.cityRate || p.rate)

  async function run(what: 'sync' | 'backfill') {
    setBusy(what)
    setNote(null)
    try {
      if (what === 'sync') {
        const r = await api.admin.sync()
        setNote(
          r.ok
            ? `Klaar in ${r.durationMs} ms: ${r.liveCount} metingen, ${r.catalogueCount} uit de catalogus, ${r.measurementsAdded} nieuw bewaard.`
            : `Mislukt: ${r.message ?? 'onbekende reden'}`,
        )
      } else {
        const r = await api.admin.backfill()
        setNote(`${r.added} historische metingen ingelezen.`)
      }
      load()
      await refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Onbekende fout')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="card">
        <div className="row">
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => run('sync')}>
            {busy === 'sync' ? 'Bezig…' : 'Nu ophalen'}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => run('backfill')}>
            {busy === 'backfill' ? 'Bezig…' : 'Geschiedenis van de stad inlezen'}
          </button>
          <span className="small muted">De ophaalronde loopt vanzelf om de {meta?.refreshMinutes ?? 5} minuten.</span>
        </div>
        {note && <p className="small note">{note}</p>}
      </div>

      {stale.length > 0 && (
        <div className="card admin-warning" role="alert">
          <h2>Verouderde data</h2>
          <p className="small muted">Geen nieuwe meting sinds meer dan {STALE_MINUTES} minuten:</p>
          <ul className="admin-list">
            {stale.map((s) => (
              <li key={s.slug}>
                <Link to={`/parking/${s.slug}`}>{s.name}</Link>
                <span className="small muted">laatste meting {ago(s.lastMeasuredUtc)} geleden</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <h2>Parkings</h2>
          <span className="small muted">Klik op een speld voor de detailpagina, bv. /parking/savaan.</span>
        </div>
        <ParkingMap parkings={parkings} basemap="grb" showLez={false} />
      </div>

      <div className="admin-columns">
        <ParkingOverview title="Parkings met bekende data" empty="Geen parkings met livedata."
          items={withData.map((p) => ({
            slug: p.slug,
            name: p.name,
            detail: p.status?.available != null ? `${p.status.available}/${p.capacity} vrij` : 'meting onbekend',
          }))}
          total={parkings.length} />
        <ParkingOverview title="Parkings met bekende tarieven" empty="Geen parkings met een tarief."
          items={withRates.map((p) => ({
            slug: p.slug,
            name: p.name,
            detail: p.cityRate
              ? `Tarief nu: ${activeRateText(p.cityRate)}`
              : `Tarief nu: €${(p.rate?.weekdayHourlyEur ?? 0).toFixed(2).replace('.', ',')} / uur (handmatig)`,
          }))}
          total={adminParkings.length} />
      </div>

      <div className="admin-columns">
        <RunsCard runs={runs} onRefresh={load} />
        <div className="card">
          <h2>Logboek</h2>
          {audit.length === 0 && <p className="small muted">Nog geen acties.</p>}
          <ul className="admin-list">
            {audit.map((a, i) => (
              <li key={`${a.atUtc}-${i}`}>
                <span>{actionLabel[a.action] ?? a.action}: <strong>{a.target}</strong></span>
                <span className="small muted">{a.actor} · {new Date(a.atUtc).toLocaleString('nl-BE')}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  )
}

function ParkingOverview({ title, empty, items, total }: {
  title: string
  empty: string
  items: Array<{ slug: string; name: string; detail: string }>
  total: number
}) {
  return (
    <div className="card">
      <div className="card-title">
        <h2>{title}</h2>
        <span className="pill pill-grey">{items.length} van {total}</span>
      </div>
      {items.length === 0 && <p className="small muted">{empty}</p>}
      <ul className="admin-list admin-scroll">
        {items.map((i) => (
          <li key={i.slug}>
            <Link to={`/parking/${i.slug}`}>{i.name}</Link>
            <span className="small muted">{i.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RunsCard({ runs, onRefresh }: { runs: SyncRun[]; onRefresh: () => void }) {
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const shown = all ? runs : runs.slice(0, 5)

  return (
    <div className="card">
      <div className="card-title">
        <h2>Laatste ophaalrondes</h2>
        <button className="btn btn-sm btn-ghost" onClick={onRefresh}>Ververs</button>
      </div>
      {runs.length === 0 && <p className="small muted">Nog geen rondes.</p>}
      <ul className="admin-list">
        {shown.map((r) => (
          <li key={r.startedUtc} className="admin-run">
            <button className="admin-run-row" aria-expanded={open === r.startedUtc}
              onClick={() => setOpen(open === r.startedUtc ? null : r.startedUtc)}>
              <span className="small">{new Date(r.startedUtc).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span className="small muted">{r.trigger}</span>
              <span className="small">+{r.measurementsAdded}</span>
              {r.ok ? <span className="pill pill-green">gelukt</span> : <span className="pill pill-red">mislukt</span>}
            </button>
            {open === r.startedUtc && (
              <p className="small muted admin-run-detail">
                Duur {r.durationMs} ms · live {r.liveCount} · catalogus {r.catalogueCount}
                {r.measurementsPruned ? ` · opgeruimd ${r.measurementsPruned}` : ''}
                {r.message ? ` · ${r.message}` : ''}
              </p>
            )}
          </li>
        ))}
      </ul>
      {runs.length > 5 && (
        <button className="btn btn-sm btn-ghost" onClick={() => setAll(!all)}>
          {all ? 'Toon minder' : `Toon alle ${runs.length}`}
        </button>
      )}
    </div>
  )
}
