/* eslint-disable react-hooks/set-state-in-effect */
import { Link, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Image, View } from 'react-native'

import { Icon } from '@/components/Icon'
import type { IconName } from '@/components/Icon'
import { Btn, Card, Empty, Loading, Screen, Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { useAuth } from '@/context/AuthContext'
import { usePalette } from '@/context/ThemeContext'
import { api, ApiError } from '@/lib/api'
import { dateLong, timeBrussels } from '@/lib/format'
import { openExternal } from '@/lib/links'
import type { GentEventDetail } from '@/lib/types'

const URL_RE = /https?:\/\/[^\s<>"']+/g
const TICKET_RE = /ticket|eventbrite|patronbase|paylogic|eventix|xceed|\bra\.co|tix|kaartje|billet/i

// Facebook verpakt links soms in een doorverwijzing (l.facebook.com/l.php?u=...).
function clean(raw: string): string {
  const url = raw.replace(/[).,;:!?]+$/, '')
  const m = /^https?:\/\/(?:[^/]*\.)?facebook\.com\/l\.php\?(.*)$/.exec(url)
  if (m) {
    const u = /(?:^|&)u=([^&]+)/.exec(m[1]!)
    if (u) {
      try {
        return decodeURIComponent(u[1]!)
      } catch {
        return url
      }
    }
  }
  return url
}

function host(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/.exec(url)
  return m ? m[1]!.replace(/^www\./, '') : url
}

function ticketLinks(description: string | null | undefined): string[] {
  const urls = (description?.match(URL_RE) ?? []).map(clean)
  return [...new Set(urls.filter((u) => TICKET_RE.test(u)))]
}

function Linkified({ text }: { text: string }) {
  const p = usePalette()
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    out.push(text.slice(last, start))
    const href = clean(m[0])
    out.push(
      <Txt key={start} style={{ color: p.brand, textDecorationLine: 'underline' }} onPress={() => void openExternal(href)}>
        {href}
      </Txt>,
    )
    last = start + m[0].replace(/[).,;:!?]+$/, '').length
  }
  out.push(text.slice(last))
  return <Txt>{out}</Txt>
}

export function EventDetailScreen({ id }: { id: string }) {
  const p = usePalette()
  const router = useRouter()
  const { interests, setInterest } = useAuth()
  const [data, setData] = useState<GentEventDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const interested = interests.includes(id)

  async function toggleInterest() {
    const next = !interested
    setInterest(id, next)
    try {
      await api.friends.interest(id, next)
    } catch {
      setInterest(id, !next)
    }
  }

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    api.event(id)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError && err.status === 404 ? 'Dit evenement bestaat niet (meer).' : 'Het evenement kon niet worden opgehaald.')
      })
    return () => { cancelled = true }
  }, [id])

  const tickets = useMemo(() => ticketLinks(data?.description), [data])

  if (error) {
    return (
      <Screen>
        <Empty>{error}</Empty>
        <Link href="/" style={{ color: p.brand, textAlign: 'center' }}>Terug naar alle evenementen</Link>
      </Screen>
    )
  }
  if (!data) {
    return (
      <Screen>
        <Loading />
      </Screen>
    )
  }

  const { event, description } = data
  const start = event.startsAtUtc ? new Date(event.startsAtUtc) : null
  const canRoute = !event.isOnline && !!event.place

  return (
    <Screen>
      <Card style={{ padding: 0, overflow: 'hidden', borderRadius: Radius.lg + 4 }}>
        <View style={{ height: 240, backgroundColor: p.brandSoft, justifyContent: 'flex-end' }}>
          {event.coverImageUrl && !imageFailed ? (
            <Image
              source={{ uri: event.coverImageUrl }}
              accessibilityLabel={event.coverCaption ?? event.name}
              style={{ position: 'absolute', width: '100%', height: '100%' }}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Txt variant="h1" style={{ position: 'absolute', alignSelf: 'center', top: 70, color: p.brandStrong, fontSize: 72, lineHeight: 80 }}>
              {event.name.slice(0, 1).toUpperCase()}
            </Txt>
          )}
          {event.coverImageUrl && !imageFailed && (
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 130, backgroundColor: 'rgba(0,0,0,0.45)' }} />
          )}
          <View style={{ padding: 16, gap: 8, alignItems: 'flex-start' }}>
            {event.isHappeningNow && (
              <View style={{ backgroundColor: p.crit, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                <Txt variant="small" style={{ color: '#fff', fontWeight: '700' }}>Nu bezig</Txt>
              </View>
            )}
            <Txt variant="h1" style={{ color: event.coverImageUrl && !imageFailed ? '#fff' : p.ink }}>{event.name}</Txt>
          </View>
        </View>

        <View style={{ padding: 16, gap: 16 }}>
          <View style={{ gap: 12, backgroundColor: p.surface2, borderRadius: Radius.md, padding: 14, borderWidth: 1, borderColor: p.border }}>
            {start && (
              <InfoRow icon="calendar" label="Wanneer">
                <Txt variant="strong" style={{ textTransform: 'capitalize' }}>{dateLong(start)}</Txt>
                <Txt variant="muted">{timeBrussels(start)}</Txt>
              </InfoRow>
            )}
            {event.place && <InfoRow icon="route" label="Waar"><Txt variant="strong">{event.place}</Txt></InfoRow>}
            {event.isOnline && <InfoRow icon="info" label="Waar"><Txt variant="strong">Online evenement</Txt></InfoRow>}
            {event.ticketPriceLabel && <InfoRow icon="info" label="Prijs"><Txt variant="strong">{event.ticketPriceLabel}</Txt></InfoRow>}
            {event.socialSummary && <InfoRow icon="friends" label="Interesse"><Txt variant="strong">{event.socialSummary}</Txt></InfoRow>}
          </View>

          <View style={{ gap: 8 }}>
            {tickets.map((url) => (
              <Btn key={url} variant="primary" label={`Tickets kopen (${host(url)})`} onPress={() => void openExternal(url)} />
            ))}
            {canRoute && (
              <Btn
                label="Route naar dit evenement"
                variant={tickets.length === 0 ? 'primary' : 'default'}
                onPress={() =>
                  router.navigate({ pathname: '/route', params: { destPlace: event.place!, destName: event.name, n: String(Date.now()) } })
                }
              />
            )}
            <Btn
              label={interested ? '★ Geïnteresseerd' : '☆ Ik ben geïnteresseerd'}
              variant={interested ? 'primary' : 'default'}
              onPress={() => void toggleInterest()}
            />
            {event.url ? <Btn label="Bekijk op Facebook" onPress={() => void openExternal(event.url)} /> : null}
          </View>
          {tickets.length === 0 && description && <Txt variant="smallMuted">In de beschrijving staat geen ticketlink.</Txt>}

          <View style={{ gap: 8 }}>
            {description && <Txt variant="h2">Over dit evenement</Txt>}
            {description ? <Linkified text={description} /> : <Txt variant="muted">Geen beschrijving beschikbaar.</Txt>}
          </View>
        </View>
      </Card>
    </Screen>
  )
}

function InfoRow({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} color={p.brand} size={17} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="smallMuted" style={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>{label}</Txt>
        {children}
      </View>
    </View>
  )
}
