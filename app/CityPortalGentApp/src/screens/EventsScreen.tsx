import { useEffect, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

import { EventCard } from '@/components/EventCard'
import { Btn, Empty, Input, Loading, PageHead, Screen, Txt } from '@/components/ui'
import { SkeletonEventCard } from '@/components/SkeletonLoader'
import { api } from '@/lib/api'
import type { GentEvent } from '@/lib/types'

const PAGE_SIZE = 10

type Filter = 'all' | 'week' | 'free'

const FILTERS: [Filter, string][] = [['all', 'Alles'], ['week', 'Komende 7 dagen'], ['free', 'Zonder ticketprijs']]

export function EventsScreen() {
  const [events, setEvents] = useState<GentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [count, setCount] = useState(PAGE_SIZE)

  useEffect(() => {
    let cancelled = false
    api.events()
      .then((rows) => { if (!cancelled) setEvents(rows) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Events could not be loaded.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const visible = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now()
    const weekAhead = now + 7 * 24 * 3600 * 1000
    const q = query.trim().toLowerCase()
    return events.filter((e) => {
      const startedAt = e.startsAtUtc ? new Date(e.startsAtUtc).getTime() : null
      if (e.isPast || (!e.isHappeningNow && startedAt !== null && startedAt < now)) return false
      if (q && !`${e.name} ${e.place ?? ''}`.toLowerCase().includes(q)) return false
      if (filter === 'week') return e.startsAtUtc != null && new Date(e.startsAtUtc).getTime() <= weekAhead
      if (filter === 'free') return !e.ticketPriceLabel
      return true
    })
  }, [events, query, filter])

  useEffect(() => { setCount(PAGE_SIZE) }, [query, filter])

  const shown = visible.slice(0, count)

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 200) {
      setCount((c) => (c < visible.length ? c + PAGE_SIZE : c))
    }
  }

  return (
    <Screen onScroll={onScroll}>
      <PageHead
        title="Evenementen in Gent"
        subtitle="Wat er binnenkort te doen is. Kom je met de wagen? Check de bezetting van de parkings op de kaart."
      />
      <View style={{ gap: 10, marginBottom: 12 }}>
        <Input placeholder="Zoek op naam of plaats" value={query} onChangeText={setQuery} returnKeyType="search" autoCapitalize="none" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map(([key, label]) => (
            <Btn key={key} size="sm" label={label} variant={filter === key ? 'primary' : 'default'} onPress={() => setFilter(key)} />
          ))}
        </ScrollView>
      </View>
      {!loading && !error && visible.length > 0 && (
        <Txt variant="smallMuted" style={{ marginBottom: 10 }}>{visible.length} evenement{visible.length === 1 ? '' : 'en'}</Txt>
      )}

      {loading ? (
        <View style={{ gap: 14 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonEventCard key={i} />
          ))}
        </View>
      ) : error ? (
        <Empty>{error}</Empty>
      ) : visible.length === 0 ? (
        <Empty>Geen evenementen gevonden.</Empty>
      ) : (
        shown.map((e, index) => <EventCard key={e.id} event={e} animate={index < PAGE_SIZE} />)
      )}
    </Screen>
  )
}
