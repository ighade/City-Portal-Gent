import type { Friend } from './types'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

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

export function initial(name: string): string {
  return (name[0] ?? '?').toUpperCase()
}

/** HTML voor een kaartspeld met profielfoto; offline vrienden krijgen een grijze rand en de tijd erbij. */
export function friendPinHtml(f: Friend, now = Date.now()): string {
  const age = locationAge(f, now)
  const offline = age === null || age > 120
  const img = f.avatar
    ? `<img src="${esc(f.avatar)}" alt="" />`
    : `<span class="friend-pin-initial">${esc(initial(f.username))}</span>`
  const label = offline && age !== null ? `<span class="friend-pin-ago">${esc(agoLabel(age))}</span>` : ''
  return `<span class="friend-pin ${offline ? 'friend-pin-off' : ''}" title="${esc(f.username)}">${img}${label}</span>`
}

/** Verkleint een gekozen afbeelding tot een vierkant van 128 px (JPEG) zodat ze klein blijft. */
export function resizeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const size = 128
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const side = Math.min(img.width, img.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Afbeelding verwerken mislukt.'))
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Dat bestand is geen afbeelding.'))
    }
    img.src = url
  })
}
