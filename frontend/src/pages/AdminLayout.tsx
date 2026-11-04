import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../context/AppContext'

/** Gemeenschappelijk kader van alle beheerpagina's: titel, submenu en afmelden. */
export function AdminLayout() {
  const { logoutAdmin } = useApp()
  const [error, setError] = useState<string | null>(null)

  async function logout() {
    try {
      await logoutAdmin()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Afmelden is niet gelukt.')
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Beheer</h1>
          <nav className="admin-nav" aria-label="Beheer">
            <NavLink to="/beheer" end>Dashboard</NavLink>
            <NavLink to="/beheer/tarieven">Tarieven</NavLink>
            <NavLink to="/beheer/gebruikers">Gebruikers</NavLink>
            <NavLink to="/beheer/events">Events</NavLink>
          </nav>
        </div>
        <button className="btn" onClick={() => void logout()}>Afmelden</button>
      </div>
      {error && <p className="small note" role="alert">{error}</p>}
      <Outlet />
    </>
  )
}
