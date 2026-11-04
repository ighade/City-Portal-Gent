import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { AdminUser } from '../types'

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (q: string) => {
    try {
      setUsers(await api.admin.users(q))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gebruikers konden niet geladen worden.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), 250)
    return () => window.clearTimeout(timer)
  }, [query, load])

  async function act(user: AdminUser, action: 'suspend' | 'unsuspend' | 'delete') {
    if (action === 'delete' && !window.confirm(`"${user.username}" definitief verwijderen? Account, vriendschappen en interesses gaan verloren.`)) return
    if (action === 'suspend' && !window.confirm(`"${user.username}" schorsen? De gebruiker wordt afgemeld en kan niet meer aanmelden.`)) return
    setBusyId(user.id)
    setMessage(null)
    setError(null)
    try {
      if (action === 'suspend') await api.admin.suspendUser(user.id)
      else if (action === 'unsuspend') await api.admin.unsuspendUser(user.id)
      else await api.admin.deleteUser(user.id)
      setMessage(
        action === 'suspend' ? `${user.username} is geschorst.`
          : action === 'unsuspend' ? `${user.username} is heractiveerd.`
            : `${user.username} is verwijderd.`,
      )
      await load(query)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'De actie is mislukt.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card">
      <div className="card-title">
        <div>
          <h2>Gebruikers</h2>
          <p className="small muted">Accounts van de vriendenservice. Een geschorste gebruiker kan niet aanmelden.</p>
        </div>
        <input className="input" type="search" placeholder="Zoek op naam of e-mail" aria-label="Zoek gebruikers"
          value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {loading && <p className="muted">Gebruikers laden…</p>}
      {!loading && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Gebruiker</th><th>E-mail</th><th>Aangemaakt</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {users.length === 0 && <tr><td colSpan={5} className="muted">Geen gebruikers gevonden.</td></tr>}
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.email}</td>
                  <td>{new Date(u.createdAtUtc).toLocaleDateString('nl-BE')}</td>
                  <td>{u.isSuspended ? <span className="pill pill-red">geschorst</span> : <span className="pill pill-green">actief</span>}</td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {u.isSuspended
                        ? <button className="btn btn-sm" disabled={busyId === u.id} onClick={() => void act(u, 'unsuspend')}>Heractiveren</button>
                        : <button className="btn btn-sm" disabled={busyId === u.id} onClick={() => void act(u, 'suspend')}>Schorsen</button>}
                      <button className="btn btn-sm" disabled={busyId === u.id} onClick={() => void act(u, 'delete')}>Verwijderen</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="small note" role="alert">{error}</p>}
      {message && <p className="small note" role="status">{message}</p>}
    </section>
  )
}
