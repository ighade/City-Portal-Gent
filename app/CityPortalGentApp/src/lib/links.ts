import { Linking } from 'react-native'
import * as WebBrowser from 'expo-web-browser'

/** Opent een externe link in de in-app browser; lukt dat niet, dan in de standaardbrowser. */
export async function openExternal(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url)
  } catch {
    await Linking.openURL(url).catch(() => undefined)
  }
}
