import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Een aan/uit-keuze die op het toestel onthouden wordt; zonder bewaarde keuze staat ze uit. */
export function usePersistedFlag(key: string): readonly [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(false)
  const changed = useRef(false)

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(key)
      .then((stored) => {
        // Een keuze die de bezoeker al maakte voor het lezen klaar was, blijft staan.
        if (!cancelled && !changed.current && stored !== null) setValue(stored === '1')
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [key])

  const update = useCallback((next: boolean) => {
    changed.current = true
    setValue(next)
    AsyncStorage.setItem(key, next ? '1' : '0').catch(() => undefined)
  }, [key])

  return [value, update] as const
}
