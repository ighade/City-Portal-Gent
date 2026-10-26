/* eslint-disable react-hooks/set-state-in-effect */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppState } from 'react-native'

import { api } from '@/lib/api'
import type { Meta, Parking, Stats } from '@/lib/types'

interface AppData {
  parkings: Parking[]
  stats: Stats | null
  meta: Meta | null
  loading: boolean
  error: string | null
  /** Wanneer dit scherm voor het laatst iets ophaalde — niet wanneer de stad voor het laatst mat. */
  refreshedAt: Date | null
  refresh: () => Promise<void>
}

const Ctx = createContext<AppData | null>(null)

/** Hoe vaak het scherm zelf opnieuw ophaalt. De stad vernieuwt om de vijf minuten; dit zit eronder. */
const REFRESH_MS = 60_000

export function AppProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [parkings, setParkings] = useState<Parking[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)

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
    if (!enabled) {
      setParkings([])
      setStats(null)
      setMeta(null)
      setRefreshedAt(null)
      setError(null)
      setLoading(true)
      return
    }
    void refresh()

    // Niet verder ophalen terwijl de app op de achtergrond staat: dat is verkeer voor niemand, en
    // bij terugkeer is de eerste ronde meteen weer vers.
    let id: ReturnType<typeof setInterval> | undefined
    const start = () => {
      if (id === undefined) id = setInterval(() => void refresh(), REFRESH_MS)
    }
    const stop = () => {
      if (id !== undefined) clearInterval(id)
      id = undefined
    }
    if (AppState.currentState === 'active') start()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh()
        start()
      } else {
        stop()
      }
    })
    return () => {
      stop()
      sub.remove()
    }
  }, [enabled, refresh])

  const value = useMemo<AppData>(
    () => ({ parkings, stats, meta, loading, error, refreshedAt, refresh }),
    [parkings, stats, meta, loading, error, refreshedAt, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppData {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp buiten AppProvider')
  return ctx
}
