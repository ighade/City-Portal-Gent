import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useColorScheme } from 'react-native'

import { Palettes } from '@/constants/theme'
import type { Palette } from '@/constants/theme'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  palette: Palette
  toggleTheme: () => void
}

const Ctx = createContext<ThemeState | null>(null)
const THEME_KEY = 'parkinggent-theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [stored, setStored] = useState<Theme | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark') setStored(v)
      })
      .catch(() => undefined)
  }, [])

  const theme: Theme = stored ?? (system === 'dark' ? 'dark' : 'light')

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setStored(next)
    AsyncStorage.setItem(THEME_KEY, next).catch(() => undefined)
  }, [theme])

  const value = useMemo(() => ({ theme, palette: Palettes[theme], toggleTheme }), [theme, toggleTheme])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme buiten ThemeProvider')
  return ctx
}

/** Kort voor het palet. */
export const usePalette = () => useTheme().palette
