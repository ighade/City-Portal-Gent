import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../context/AppContext'

export function Shell() {
  const { meta, refreshedAt, theme, toggleTheme, error, isAdmin } = useApp()

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              P
            </span>
            <span>
              Parkeren in Gent
              <small>live bezetting uit de open data van de stad</small>
            </span>
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end>
              Kaart
            </NavLink>
            <NavLink to="/route">Route</NavLink>
            <NavLink to="/ov">OV</NavLink>
            <NavLink to="/over">Over</NavLink>
            {isAdmin && <NavLink to="/beheer">Beheer</NavLink>}
          </nav>
          <div className="topbar-right">
            {refreshedAt && (
              <span className="small muted desktop-only" title={`Scherm bijgewerkt om ${refreshedAt.toLocaleTimeString('nl-BE')}`}>
                {meta?.lastSyncOk === false ? 'bron hapert' : 'live'}
                <span className={`beacon ${meta?.lastSyncOk === false ? 'beacon-off' : ''}`} aria-hidden="true" />
              </span>
            )}
            <button className="btn btn-ghost" onClick={toggleTheme} title="Licht of donker" aria-label="Licht of donker">
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {error && (
          <div className="banner" role="alert">
            De gegevens konden niet opgehaald worden: {error}. Wat hieronder staat, is de laatste stand
            die dit scherm kreeg.
          </div>
        )}
        <Outlet />
      </main>

      <footer className="footer">
        Gegevens: <a href="https://data.stad.gent">Stad Gent — Open Data</a>, onder een open licentie ·
        kaart: <a href="https://www.vlaanderen.be/digitaal-vlaanderen">Digitaal Vlaanderen (GRB)</a> ·
        oorspronkelijk een graduaatsproef van Asilhan Tavukcu (HoGent, 2025)
      </footer>
    </div>
  )
}
