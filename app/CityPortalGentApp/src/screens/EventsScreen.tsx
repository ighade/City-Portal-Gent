import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'

import { EventCard } from '@/components/EventCard'
import { Btn, Empty, Input, Loading, PageHead, Screen } from '@/components/ui'
import { api } from '@/lib/api'
import type { GentEvent } from '@/lib/types'

type Filter = 'all' | 'week' | 'free'

const FILTERS: [Filter, string][] = [['all', 'Alles'], ['week', 'Komende 7 dagen'], ['free', 'Zonder ticketprijs']]

export function EventsScreen() {
  const [events, setEvents] = useState<GentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    let cancelled = false
    api.events()
      .then((rows) => { if (!cancelled) setEvents(rows) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'De evenementen konden niet worden opgehaald.') })
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

  return (
    <Screen>
      <PageHead
        title="Evenementen in Gent"
        subtitle="Wat er binnenkort te doen is. Kom je met de wagen? Check de bezetting van de parkings op de kaart."
      />
      <View style={{ gap: 10, marginBottom: 16 }}>
        <Input placeholder="Zoek op naam of plaats" value={query} onChangeText={setQuery} returnKeyType="search" autoCapitalize="none" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {FILTERS.map(([key, label]) => (
            <Btn key={key} size="sm" label={label} variant={filter === key ? 'primary' : 'default'} onPress={() => setFilter(key)} />
          ))}
        </View>
      </View>

      {loading ? (
        <Loading />
      ) : error ? (
        <Empty>{error}</Empty>
      ) : visible.length === 0 ? (
        <Empty>Geen evenementen gevonden.</Empty>
      ) : (
        visible.map((e) => <EventCard key={e.id} event={e} />)
      )}
    </Screen>
  )
}
