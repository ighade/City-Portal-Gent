import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../context/AppContext'
import type { SyncRun } from '../types'

/**
 * Beheer — alleen binnen het huis. Extern zet niemand de identiteitskoppen, dus geeft
 * /api/admin/* daar een 401 en verschijnt deze pagina niet eens in het menu.
 */
export function Beheer() {
  const { refresh, meta } = useApp()
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    api.admin
      .runs(50)
      .then(setRuns)
      .catch(() => setRuns([]))
  }, [])

  useEffect(load, [load])

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
      <div className="page-head">
        <div>
          <h1>Beheer</h1>
          <p>
            De ophaalronde loopt vanzelf om de {meta?.refreshMinutes ?? 5} minuten. Hier kan ze met de
            hand gestart worden, en staat wat er van de vorige rondes terechtkwam.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => run('sync')}>
            {busy === 'sync' ? 'Bezig…' : 'Nu ophalen'}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => run('backfill')}>
            {busy === 'backfill' ? 'Bezig…' : 'Geschiedenis van de stad inlezen'}
          </button>
        </div>
        {note && <p className="small note">{note}</p>}
        <p className="small muted">
          "Geschiedenis inlezen" haalt de negen reeksen <code>recente-bezetting-parking-*</code> op —
          elk de laatste 180 metingen van de stad. Dat gebeurt automatisch bij het opstarten, en doet
          niets voor een parking die hier al metingen heeft.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Laatste ophaalrondes</h2>
          <button className="btn btn-sm btn-ghost" onClick={load}>
            Ververs
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Wanneer</th>
                <th>Aanleiding</th>
                <th className="num">Duur</th>
                <th className="num">Live</th>
                <th className="num">Catalogus</th>
                <th className="num">Nieuw</th>
                <th className="num">Opgeruimd</th>
                <th>Uitkomst</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Nog geen rondes.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.startedUtc}>
                  <td>{new Date(r.startedUtc).toLocaleString('nl-BE')}</td>
                  <td>{r.trigger}</td>
                  <td className="num">{r.durationMs} ms</td>
                  <td className="num">{r.liveCount}</td>
                  <td className="num">{r.catalogueCount}</td>
                  <td className="num">{r.measurementsAdded}</td>
                  <td className="num">{r.measurementsPruned || ''}</td>
                  <td>
                    {r.ok ? (
                      <span className="pill pill-green">gelukt</span>
                    ) : (
                      <span className="pill pill-red" title={r.message ?? ''}>
                        mislukt
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
