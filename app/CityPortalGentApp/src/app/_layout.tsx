import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'

import { AppProvider } from '@/context/AppContext'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'

SplashScreen.preventAutoHideAsync()

function RootStack() {
  const { status } = useAuth()
  const { palette: p, theme } = useTheme()
  const known = status !== 'unknown'

  // De splash blijft staan tot friends.me() antwoordt, zodat er geen aanmeldscherm flitst.
  useEffect(() => {
    if (known) void SplashScreen.hideAsync()
  }, [known])

  const base = theme === 'dark' ? DarkTheme : DefaultTheme
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: p.bg, card: p.surface, text: p.ink, border: p.border, primary: p.brand },
  }

  if (!known) return null

  const header = {
    headerStyle: { backgroundColor: p.surface },
    headerTintColor: p.ink,
    headerTitleStyle: { color: p.ink },
    contentStyle: { backgroundColor: p.bg },
  }

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <AppProvider enabled={status === 'in'}>
        <Stack screenOptions={header}>
          <Stack.Protected guard={status === 'in'}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="events/[id]" options={{ title: 'Evenement', headerBackTitle: 'Terug' }} />
            <Stack.Screen name="parking/[slug]" options={{ title: 'Parking', headerBackTitle: 'Terug' }} />
          </Stack.Protected>
          <Stack.Protected guard={status === 'out'}>
            <Stack.Screen name="login" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
      </AppProvider>
    </NavThemeProvider>
  )
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </ThemeProvider>
  )
}
