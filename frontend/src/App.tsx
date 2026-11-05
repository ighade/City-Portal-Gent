import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { useApp } from './context/AppContext'
import { AdminLayout } from './pages/AdminLayout'
import { AdminDashboard } from './pages/AdminDashboard'
import { AdminPrices } from './pages/AdminPrices'
import { AdminUsers } from './pages/AdminUsers'
import { EventManagement } from './pages/AdminEvents'
import { AdminLogin } from './pages/AdminLogin'
import { Events } from './pages/Events'
import { EventDetail } from './pages/EventDetail'
import { Detail } from './pages/Detail'
import { Over } from './pages/Over'
import { RoutePlanner } from './pages/RoutePlanner'
import { Vrienden } from './pages/Vrienden'
import { Werken } from './pages/Werken'
import { AdminWorks } from './pages/AdminWorks'

export default function App() {
  const { isAdmin, adminChecked } = useApp()
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/events" replace />} />
        <Route path="route" element={<RoutePlanner />} />
        <Route path="vrienden" element={<Vrienden />} />
        <Route path="events" element={<Events />} />
        <Route path="werken" element={<Werken />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="parking/:slug" element={<Detail />} />
        <Route path="over" element={<Over />} />
        {/* Pas omleiden als vaststaat dat het antwoord "nee" is; anders kaatst een
            rechtstreekse link naar /beheer terug voordat de controle binnen is. */}
        <Route
          path="beheer"
          element={!adminChecked ? <div className="empty">Even geduld…</div> : isAdmin ? <AdminLayout /> : <AdminLogin />}
        >
          <Route index element={<AdminDashboard />} />
          <Route path="tarieven" element={<AdminPrices />} />
          <Route path="gebruikers" element={<AdminUsers />} />
          <Route path="events" element={<EventManagement />} />
          <Route path="werken" element={<AdminWorks />} />
        </Route>
        <Route path="*" element={<Navigate to="/events" replace />} />
      </Route>
    </Routes>
  )
}
