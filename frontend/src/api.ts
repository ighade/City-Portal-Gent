import type { GeoJsonCollection, Meta, Parking, Point, Stats, SyncRun, Trend } from './types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })

  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!res.ok) {
    const d = data as { detail?: string; title?: string; error?: string } | string | null
    const msg =
      typeof d === 'string' ? d : d?.detail || d?.error || d?.title || `${res.status} ${res.statusText}`
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export const api = {
  parkings: () => call<Parking[]>('GET', '/api/parkings'),
  parking: (slug: string) => call<Parking>('GET', `/api/parkings/${slug}`),
  history: (slug: string, hours = 24) => call<Point[]>('GET', `/api/parkings/${slug}/history?hours=${hours}`),
  trend: (slug: string, days = 60) => call<Trend>('GET', `/api/parkings/${slug}/trend?days=${days}`),
  stats: () => call<Stats>('GET', '/api/stats'),
  /** De lage-emissiezone als GeoJSON. Verandert vrijwel nooit; één keer per bezoek volstaat. */
  lez: () => call<GeoJsonCollection>('GET', '/api/lez'),
  meta: () => call<Meta>('GET', '/api/meta'),

  /**
   * Beheer. Extern komt hier altijd een 401 uit — de identiteitskoppen worden alleen door de
   * LAN-ingang (:8105) gezet, zie het Caddyfile. Het scherm gebruikt dat als de vraag "mag ik
   * hier beheren": lukt /whoami, dan verschijnt de beheerpagina.
   */
  admin: {
    whoami: () => call<{ email: string; name: string; isAdmin: boolean }>('GET', '/api/admin/whoami'),
    sync: () => call<SyncRun>('POST', '/api/admin/sync'),
    backfill: () => call<{ added: number }>('POST', '/api/admin/backfill'),
    runs: (take = 50) => call<SyncRun[]>('GET', `/api/admin/runs?take=${take}`),
  },
}
