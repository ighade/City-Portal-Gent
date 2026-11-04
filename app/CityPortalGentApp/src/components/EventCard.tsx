import { Link } from 'expo-router'
import { useState } from 'react'
import { Image, Pressable, View } from 'react-native'

import { Card, Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { dayMonthParts, timeBrussels, weekdayLong } from '@/lib/format'
import type { GentEvent } from '@/lib/types'

export function EventCard({ event }: { event: GentEvent }) {
  const p = usePalette()
  const [imageFailed, setImageFailed] = useState(false)
  const start = event.startsAtUtc ? new Date(event.startsAtUtc) : null
  const showImage = event.coverImageUrl && !imageFailed
  const [day, month] = start ? dayMonthParts(start) : ['', '']

  return (
    <Link href={{ pathname: '/events/[id]', params: { id: event.id } }} asChild>
      <Pressable accessibilityRole="link">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ height: 150, backgroundColor: p.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
            {showImage ? (
              <Image
                source={{ uri: event.coverImageUrl! }}
                accessibilityLabel={event.coverCaption ?? event.name}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <Txt variant="h1" style={{ color: p.brandStrong, fontSize: 44, lineHeight: 52 }}>{event.name.slice(0, 1).toUpperCase()}</Txt>
            )}
            {start && (
              <View style={{ position: 'absolute', top: 10, left: 10, backgroundColor: p.surface, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center' }}>
                <Txt variant="strong" style={{ lineHeight: 18 }}>{day}</Txt>
                <Txt variant="smallMuted" style={{ fontSize: 11, lineHeight: 14 }}>{month}</Txt>
              </View>
            )}
            {event.isHappeningNow && (
              <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: p.brand, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
                <Txt variant="small" style={{ color: p.brandInk, fontWeight: '700' }}>Nu bezig</Txt>
              </View>
            )}
          </View>
          <View style={{ padding: 14, gap: 3 }}>
            <Txt variant="h3">{event.name}</Txt>
            {start && <Txt variant="muted">{weekdayLong(start)} · {timeBrussels(start)}</Txt>}
            {event.place && <Txt variant="muted">{event.place}</Txt>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
              {event.socialSummary && <Txt variant="smallMuted">{event.socialSummary}</Txt>}
              {event.ticketPriceLabel && <Txt variant="small" style={{ fontWeight: '700' }}>{event.ticketPriceLabel}</Txt>}
              {event.isOnline && <Txt variant="small" style={{ fontWeight: '700' }}>Online</Txt>}
            </View>
          </View>
        </Card>
      </Pressable>
    </Link>
  )
}
