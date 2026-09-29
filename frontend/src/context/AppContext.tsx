import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api'
import type { Meta, Parking, Stats } from '../types'

type Theme = 'light' | 'dark'

interface AppState {
  parkings: Parking[]
  stats: Stats | null
  meta: Meta | null
  loading: boolean
  error: string | null
  /** Wanneer dit scherm voor het laatst iets ophaalde — niet wanneer de stad voor het laatst mat. */
  refreshedAt: Date | null
  refresh: () => Promise<void>
  /** Waar is beheer? Alleen binnen het huis; extern geeft /api/admin/whoami een 401. */
  isAdmin: boolean
  /**
   * Is die vraag al beantwoord? Zonder dit stuurt /beheer een rechtstreekse bezoeker meteen
   * terug naar de kaart: bij de eerste render is `isAdmin` nog false omdat het antwoord van
   * /api/admin/whoami onderweg is.
   */
  adminChecked: boolean
  theme: Theme
  toggleTheme: () => void
}

const Ctx = createContext<AppState | null>(null)

/** Hoe vaak het scherm zelf opnieuw ophaalt. De stad vernieuwt om de vijf minuten; dit zit eronder. */
const REFRESH_MS = 60_000

export function AppProvider({ children }: { children: ReactNode }) {
  const [parkings, setParkings] = useState<Parking[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminChecked, setAdminChecked] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => readTheme())

  // Een lopende ronde mag niet door de volgende ingehaald worden.
  const busy = useRef(false)

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const [p, s, m] = await Promise.all([api.parkings(), api.stats(), api.meta()])
      setParkings(p)
      setStats(s)
      setMeta(m)
      setRefreshedAt(new Date())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Onbekende fout')
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    void api.admin
      .whoami()
      .then((w) => setIsAdmin(w.isAdmin))
      .catch(() => setIsAdmin(false))
      .finally(() => setAdminChecked(true))
  }, [refresh])

  useEffect(() => {
    // Niet verder ophalen terwijl het tabblad weg is: dat is verkeer voor niemand, en bij
    // terugkeer is de eerste ronde meteen weer vers.
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const id = window.setInterval(tick, REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [refresh])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('parkinggent-theme', theme)
    } catch {
      // Een privévenster mag niet betekenen dat de knop niets doet.
    }
  }, [theme])

  const value = useMemo<AppState>(
    () => ({
      parkings,
      stats,
      meta,
      loading,
      error,
      refreshedAt,
      refresh,
      isAdmin,
      adminChecked,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    }),
    [parkings, stats, meta, loading, error, refreshedAt, refresh, isAdmin, adminChecked, theme],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp buiten AppProvider')
  return ctx
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem('parkinggent-theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Geen opslag beschikbaar; dan telt wat het toestel zelf zegt.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
