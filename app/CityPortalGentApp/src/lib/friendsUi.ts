import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

import type { Friend } from './types'

/** "3 min geleden", "2 u geleden", … */
export function agoLabel(seconds: number): string {
  if (seconds < 60) return 'zojuist'
  const min = Math.floor(seconds / 60)
  if (min < 60) return `${min} min geleden`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} u geleden`
  return `${Math.floor(h / 24)} d geleden`
}

/** Leeftijd van de locatie nu, uitgaande van het tijdstip van de server (loopt dus niet achter op de klok van dit toestel). */
export function locationAge(f: Friend, now = Date.now()): number | null {
  if (!f.locationAtUtc) return null
  return Math.max(0, Math.floor((now - new Date(f.locationAtUtc).getTime()) / 1000))
}

export function friendStatus(f: Friend, now = Date.now()): string {
  const age = locationAge(f, now)
  if (age === null) return 'locatie niet gedeeld'
  return age <= 120 ? 'nu verbonden' : `laatst gezien ${agoLabel(age)}`
}

export function isOffline(f: Friend, now = Date.now()): boolean {
  const age = locationAge(f, now)
  return age === null || age > 120
}

export function initial(name: string): string {
  return (name[0] ?? '?').toUpperCase()
}

/** Laat de gebruiker een foto kiezen en verkleint ze tot een vierkant van 128 px (JPEG, data-URL) zodat ze klein blijft. */
export async function pickAvatar(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) throw new Error('Geef toegang tot je foto’s om een profielfoto te kiezen.')
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  })
  if (picked.canceled || !picked.assets[0]) return null
  try {
    const context = ImageManipulator.ImageManipulator.manipulate(picked.assets[0].uri)
    context.resize({ width: 128, height: 128 })
    const image = await context.renderAsync()
    const result = await image.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.85, base64: true })
    if (!result.base64) throw new Error('leeg')
    return `data:image/jpeg;base64,${result.base64}`
  } catch {
    throw new Error('Dat bestand is geen afbeelding.')
  }
}
