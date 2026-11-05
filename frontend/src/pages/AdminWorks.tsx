import { useEffect, useMemo, useState } from 'react'
import { fetchWorks, isOpenEnded, KIND_ORDER, KINDS, timing } from '../roadworks'
import type { Timing, Work } from '../roadworks'

const fmt = (d: Date | null) => (d ? d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const TIMING_LABEL: Record<Timing, string> = { actief: 'Nu bezig', gepland: 'Gepland', afgelopen: 'Afgelopen' }

export function AdminWorks() {
  const [works, setWorks] = useState<Work[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    fetchWorks(ctrl.signal).then(setWorks).catch((e: unknown) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Werken konden niet geladen worden.')
    })
    return () => ctrl.abort()
  }, [])

  const stats = useMemo(() => {
    const now = Date.now()
    const byTiming: Record<Timing, number> = { actief: 0, gepland: 0, afgelopen: 0 }
    const byKind = Object.fromEntries(KIND_ORDER.map((k) => [k, 0])) as Record<Work['kind'], number>
    const owners = new Map<string, number>()
    let severe = 0
    for (const w of works ?? []) {
      const t = timing(w, now)
      byTiming[t]++
      if (t !== 'actief') continue
      byKind[w.kind]++
      if (w.severe) severe++
      owners.set(w.owner, (owners.get(w.owner) ?? 0) + 1)
    }
    return { byTiming, byKind, severe, owners: [...owners].sort((a, b) => b[1] - a[1]).slice(0, 8) }
  }, [works])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (works ?? [])
      .filter((w) => timing(w) === 'actief')
      .filter((w) => !q || `${w.owner} ${w.description} ${w.consequences.join(' ')} ${KINDS[w.kind].label}`.toLowerCase().includes(q))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.end?.getTime() ?? 0) - (b.end?.getTime() ?? 0))
  }, [works, query])

  if (error) return <div className="empty">Kon de werken niet laden: {error}</div>
  if (!works) return <div className="empty">Werken laden…</div>

  return (
    <>
      <section className="card">
        <div className="card-title">
          <div>
            <h2>Werken in Gent</h2>
            <p className="small muted">Overzicht van data.stad.gent (GIPOD). Aantallen tellen enkel de werken die nu bezig zijn, tenzij anders vermeld.</p>
          </div>
        </div>
        <div className="admin-zones">
          {(Object.keys(TIMING_LABEL) as Timing[]).map((t) => (
            <div key={t} className="admin-field"><span>{TIMING_LABEL[t]}</span><strong>{stats.byTiming[t]}</strong></div>
          ))}
          <div className="admin-field"><span>Ernstige hinder (nu)</span><strong>{stats.severe}</strong></div>
          {KIND_ORDER.map((k) => (
            <div key={k} className="admin-field">
              <span><span className="werken-dot" style={{ background: KINDS[k].color }} /> {KINDS[k].label}</span>
              <strong>{stats.byKind[k]}</strong>
            </div>
          ))}
        </div>
      </section>

      <div className="admin-columns" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Top eigenaars (nu bezig)</h2>
          <ul className="admin-list">
            {stats.owners.map(([name, n]) => (
              <li key={name}><span>{name}</span><b>{n}</b></li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card-title">
          <h2>Lopende werken ({rows.length})</h2>
          <input className="input" type="search" placeholder="Zoek op eigenaar, gevolg of soort" aria-label="Zoek werken"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="table-wrap admin-scroll" style={{ maxHeight: 520 }}>
          <table className="table">
            <thead>
              <tr><th>Soort</th><th>Gevolgen</th><th>Eigenaar</th><th>Start</th><th>Einde</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((w) => (
                <tr key={w.id}>
                  <td><span className="werken-dot" style={{ background: KINDS[w.kind].color }} /> {KINDS[w.kind].label}{w.severe ? ' ⚠' : ''}</td>
                  <td>{w.consequences.join(', ') || '—'}</td>
                  <td>{w.owner}</td>
                  <td>{fmt(w.start)}</td>
                  <td>{isOpenEnded(w.end) ? 'onbepaald' : fmt(w.end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 300 && <p className="small muted">Eerste 300 van {rows.length} getoond; verfijn de zoekopdracht.</p>}
      </section>
    </>
  )
}
