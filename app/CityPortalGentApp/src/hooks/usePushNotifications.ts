import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { Platform } from 'react-native'

import { conversationOf, registerForPush } from '@/lib/notifications'

/** Registreert het toestel voor meldingen zodra je aangemeld bent, en opent het gesprek bij een tik op een melding. */
export function usePushNotifications(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn || Platform.OS === 'web') return
    void registerForPush()

    const open = (notification: Notifications.Notification) => {
      const id = conversationOf(notification)
      if (!id) return
      router.push({ pathname: '/chat/[id]', params: { id } })
      Notifications.clearLastNotificationResponse()
    }

    // De app werd door een tik op een melding gestart.
    const last = Notifications.getLastNotificationResponse()
    if (last) open(last.notification)

    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification))
    return () => sub.remove()
  }, [signedIn])
}
