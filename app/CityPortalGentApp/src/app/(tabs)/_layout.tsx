import { Tabs } from 'expo-router'

import { AppHeader } from '@/components/AppHeader'
import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import { useTheme } from '@/context/ThemeContext'

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color, size }: { color: unknown; size: number }) => <Icon name={icon} color={color as string} size={size} />,
})

export default function TabsLayout() {
  const { palette: p } = useTheme()
  return (
    <Tabs
      screenOptions={{
        header: () => <AppHeader />,
        tabBarActiveTintColor: p.brand,
        tabBarInactiveTintColor: p.muted,
        tabBarStyle: { backgroundColor: p.surface, borderTopColor: p.border },
        sceneStyle: { backgroundColor: p.bg },
      }}>
      <Tabs.Screen name="route" options={tab('Route', 'route')} />
      <Tabs.Screen name="index" options={tab('Events', 'events')} />
      <Tabs.Screen name="vrienden" options={tab('Vrienden', 'friends')} />
      <Tabs.Screen name="over" options={tab('Over', 'info')} />
    </Tabs>
  )
}
