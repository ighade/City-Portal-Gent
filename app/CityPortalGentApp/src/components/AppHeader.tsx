import { StyleSheet, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon } from '@/components/Icon'
import { useApp } from '@/context/AppContext'
import { useTheme } from '@/context/ThemeContext'

/** Merknaam, "live"-baken, themaknop en de foutbanner. */
export function AppHeader() {
  const { palette: p, theme, toggleTheme } = useTheme()
  const { error, meta } = useApp()
  const insets = useSafeAreaInsets()
  const stale = meta?.lastSyncOk === false

  return (
    <View style={{ backgroundColor: p.surface, paddingTop: insets.top, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: p.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: p.brandInk, fontWeight: '800', fontSize: 18 }}>P</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: p.ink, fontWeight: '700', fontSize: 15 }}>Parkeren in Gent</Text>
          <Text style={{ color: p.muted, fontSize: 11.5 }} numberOfLines={1}>live bezetting uit de open data van de stad</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stale ? p.warn : p.ok }} />
          <Text style={{ color: p.muted, fontSize: 12 }}>{stale ? 'bron hapert' : 'live'}</Text>
        </View>
        <Pressable
          onPress={toggleTheme}
          accessibilityRole="button"
          accessibilityLabel={theme === 'dark' ? 'Licht thema' : 'Donker thema'}
          hitSlop={8}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: p.border }}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} color={p.ink2} size={18} />
        </Pressable>
      </View>
      {error && (
        <View accessibilityRole="alert" style={{ backgroundColor: p.scheme === 'dark' ? '#2a2412' : '#fdf5e4', borderTopWidth: 1, borderTopColor: p.warn, padding: 10 }}>
          <Text style={{ color: p.warnInk, fontSize: 12.5, lineHeight: 18 }}>
            De gegevens konden niet opgehaald worden: {error}. Wat hieronder staat, is de laatste stand die dit scherm kreeg.
          </Text>
        </View>
      )}
    </View>
  )
}
