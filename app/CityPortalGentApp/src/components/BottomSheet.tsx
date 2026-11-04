import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PanResponder, ScrollView, View } from 'react-native'

import { Radius } from '@/constants/theme'
import { usePalette } from '@/context/ThemeContext'

interface Props {
  children: ReactNode
  /** Hoogte van de container waarin het paneel onderaan hangt. */
  containerHeight: number
  minHeight?: number
  initialHeight?: number
  /** Ruimte die bovenaan vrij blijft als het paneel helemaal open staat. */
  topInset?: number
  /** Een nieuwe waarde (> 0) klapt het paneel open tot de maximale hoogte. */
  expandKey?: number
}

/** Paneel onderaan het scherm; sleep aan de greep om het hoger of lager te zetten. */
export function BottomSheet({ children, containerHeight, minHeight = 150, initialHeight = 220, topInset, expandKey = 0 }: Props) {
  const p = usePalette()
  const [height, setHeight] = useState(initialHeight)
  const startHeight = useRef(initialHeight)
  const max = useRef(0)
  const min = useRef(minHeight)
  const current = useRef(height)
  max.current = Math.max(minHeight, topInset ? containerHeight - topInset : Math.round(containerHeight * 0.85))
  min.current = minHeight
  current.current = height

  useEffect(() => {
    if (expandKey > 0) setHeight(max.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandKey])

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startHeight.current = current.current
      },
      onPanResponderMove: (_, g) => {
        setHeight(Math.min(max.current, Math.max(min.current, startHeight.current - g.dy)))
      },
    }),
  ).current

  const shown = Math.min(height, max.current)

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: shown,
        backgroundColor: p.surface,
        borderTopLeftRadius: Radius.md,
        borderTopRightRadius: Radius.md,
        borderWidth: 1,
        borderBottomWidth: 0,
        borderColor: p.border,
        elevation: 12,
        zIndex: 20,
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 8,
      }}>
      <View {...pan.panHandlers} accessibilityLabel="Sleep om de hoogte te wijzigen" style={{ paddingVertical: 10, alignItems: 'center' }}>
        <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: p.borderStrong }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 16, gap: 10 }}>
        {children}
      </ScrollView>
    </View>
  )
}
