import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { api, clearSessionCookie, loadSessionCookie, setUnauthorizedHandler } from '@/lib/api'
import type { FriendMe, FriendSessionInfo } from '@/lib/types'

type Status = 'unknown' | 'in' | 'out'

interface AuthState {
  /** `unknown` zolang friends.me() nog onderweg is. */
  status: Status
  user: FriendMe | null
  interests: string[]
  setUser: (user: FriendMe) => void
  setInterest: (eventId: string, on: boolean) => void
  login: (identifier: string, password: string) => Promise<void>
  register: (b: { username: string; email: string; password: string; avatar?: string }) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('unknown')
  const [user, setUserState] = useState<FriendMe | null>(null)
  const [interests, setInterests] = useState<string[]>([])

  const accept = useCallback((s: FriendSessionInfo) => {
    setUserState(s.user)
    setInterests(s.interests)
    setStatus('in')
  }, [])

  const drop = useCallback(() => {
    setUserState(null)
    setInterests([])
    setStatus('out')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(drop)
    let cancelled = false
    void (async () => {
      await loadSessionCookie()
      try {
        const s = await api.friends.me()
        if (!cancelled) accept(s)
      } catch {
        if (!cancelled) drop()
      }
    })()
    return () => {
      cancelled = true
      setUnauthorizedHandler(null)
    }
  }, [accept, drop])

  const login = useCallback(async (identifier: string, password: string) => {
    accept(await api.friends.login(identifier, password))
  }, [accept])

  const register = useCallback(async (b: { username: string; email: string; password: string; avatar?: string }) => {
    accept(await api.friends.register(b))
  }, [accept])

  const logout = useCallback(async () => {
    await api.friends.logout().catch(() => undefined)
    await clearSessionCookie()
    drop()
  }, [drop])

  const setInterest = useCallback((eventId: string, on: boolean) => {
    setInterests((list) => (on ? (list.includes(eventId) ? list : [...list, eventId]) : list.filter((i) => i !== eventId)))
  }, [])

  const value = useMemo<AuthState>(
    () => ({ status, user, interests, setUser: setUserState, setInterest, login, register, logout }),
    [status, user, interests, setInterest, login, register, logout],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth buiten AuthProvider')
  return ctx
}
