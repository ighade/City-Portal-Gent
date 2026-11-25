import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { AndroidImportance } from 'expo-notifications'
import { Platform } from 'react-native'

import { api } from '@/lib/api'

const TOKEN_KEY = 'parkinggent.pushToken'
export const CHAT_CHANNEL = 'chat'

// Het gesprek dat nu open staat: daarvoor tonen we geen melding, het bericht verschijnt al in beeld.
let openConversation: string | null = null

export function setOpenConversation(id: string | null) {
  openConversation = id
}

/** Id van het gesprek waar een melding bij hoort, als het er een van de chat is. */
export function conversationOf(notification: Notifications.Notification): string | null {
  const id = notification.request.content.data?.conversationId
  return typeof id === 'string' ? id : null
}

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const show = openConversation === null || conversationOf(notification) !== openConversation
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false }
    },
  })
}

/** Vraagt toestemming, haalt het pushtoken van dit toestel op en geeft het door aan de server. */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web') return
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHAT_CHANNEL, {
        name: 'Berichten',
        importance: AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      })
    }
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
    if (status !== 'granted') return

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data
    await api.friends.registerPushToken(token)
    await AsyncStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Zonder meldingen werkt de chat nog; meestal een emulator zonder Google Play of een build zonder pushinstellingen.
  }
}

/** Meldt dit toestel af voor meldingen van de huidige gebruiker; bij afmelden. */
export async function unregisterForPush(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY)
    if (!token) return
    await api.friends.removePushToken(token).catch(() => undefined)
    await AsyncStorage.removeItem(TOKEN_KEY)
  } catch {
    // niets te wissen
  }
}
