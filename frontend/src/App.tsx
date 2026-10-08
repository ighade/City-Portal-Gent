import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { useApp } from './context/AppContext'
import { Beheer } from './pages/Beheer'
import { Detail } from './pages/Detail'
import { Kaart } from './pages/Kaart'
import { Over } from './pages/Over'
import { RoutePlanner } from './pages/RoutePlanner'
import { Ov } from './pages/Ov'

export default function App() {
  const { isAdmin, adminChecked } = useApp()
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Kaart />} />
        <Route path="route" element={<RoutePlanner />} />
        <Route path="ov" element={<Ov />} />
        <Route path="parking/:slug" element={<Detail />} />
        <Route path="over" element={<Over />} />
        {/* Pas omleiden als vaststaat dat het antwoord "nee" is; anders kaatst een
            rechtstreekse link naar /beheer terug voordat de controle binnen is. */}
        <Route
          path="beheer"
          element={!adminChecked ? <div className="empty">Even geduld…</div> : isAdmin ? <Beheer /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
