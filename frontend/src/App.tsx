import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { useApp } from './context/AppContext'
import { Beheer } from './pages/Beheer'
import { AdminLogin } from './pages/AdminLogin'
import { Events } from './pages/Events'
import { EventDetail } from './pages/EventDetail'
import { Detail } from './pages/Detail'
import { Over } from './pages/Over'
import { RoutePlanner } from './pages/RoutePlanner'
import { Vrienden } from './pages/Vrienden'

export default function App() {
  const { isAdmin, adminChecked } = useApp()
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/events" replace />} />
        <Route path="route" element={<RoutePlanner />} />
        <Route path="vrienden" element={<Vrienden />} />
        <Route path="events" element={<Events />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="parking/:slug" element={<Detail />} />
        <Route path="over" element={<Over />} />
        {/* Pas omleiden als vaststaat dat het antwoord "nee" is; anders kaatst een
            rechtstreekse link naar /beheer terug voordat de controle binnen is. */}
        <Route
          path="beheer"
          element={!adminChecked ? <div className="empty">Even geduld…</div> : isAdmin ? <Beheer /> : <AdminLogin />}
        />
        <Route path="*" element={<Navigate to="/events" replace />} />
      </Route>
    </Routes>
  )
}
