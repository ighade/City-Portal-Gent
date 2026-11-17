import { Link } from 'expo-router'
import { useState } from 'react'
import { Animated, Image, Pressable, View } from 'react-native'

import { Icon } from '@/components/Icon'
import { Card, Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { useSlideInAnimation } from '@/hooks/useAnimations'
import { usePalette } from '@/context/ThemeContext'
import { assetUrl } from '@/lib/api'
import { dayMonthParts, timeBrussels, weekdayLong } from '@/lib/format'
import type { GentEvent } from '@/lib/types'

export function EventCard({ event, animate = true }: { event: GentEvent; animate?: boolean }) {
  const p = usePalette()
  const [imageFailed, setImageFailed] = useState(false)
  const animationStyle = useSlideInAnimation(animate)
  const start = event.startsAtUtc ? new Date(event.startsAtUtc) : null
  const showImage = event.coverImageUrl && !imageFailed
  const [day, month] = start ? dayMonthParts(start) : ['', '']

  return (
    <Link href={{ pathname: '/events/[id]', params: { id: event.id } }} asChild>
      <Pressable accessibilityRole="link" style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}>
        <Card style={{ padding: 0, overflow: 'hidden', borderRadius: Radius.lg + 4 }} animate={false}>
          <Animated.View style={animationStyle}>
            <View style={{ height: 180, backgroundColor: p.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              {showImage ? (
                <Image
                  source={{ uri: assetUrl(event.coverImageUrl!) }}
                  accessibilityLabel={event.coverCaption ?? event.name}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                  onError={() => setImageFailed(true)}
                />
              ) : (
                <Txt variant="h1" style={{ color: p.brandStrong, fontSize: 56, lineHeight: 64 }}>{event.name.slice(0, 1).toUpperCase()}</Txt>
              )}
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, backgroundColor: 'rgba(0,0,0,0.22)' }} />
              {start && (
                <View style={{ position: 'absolute', top: 12, left: 12, backgroundColor: p.surface, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 5, alignItems: 'center', elevation: 3 }}>
                  <Txt variant="strong" style={{ lineHeight: 20, fontSize: 17 }}>{day}</Txt>
                  <Txt variant="smallMuted" style={{ fontSize: 11, lineHeight: 14, textTransform: 'uppercase', color: p.brand, fontWeight: '700' }}>{month}</Txt>
                </View>
              )}
              {event.isHappeningNow && (
                <View style={{ position: 'absolute', top: 12, right: 12, backgroundColor: p.crit, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Txt variant="small" style={{ color: '#fff', fontWeight: '700' }}>Nu bezig</Txt>
                </View>
              )}
              {event.ticketPriceLabel && (
                <View style={{ position: 'absolute', bottom: 12, right: 12, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Txt variant="small" style={{ color: '#101828', fontWeight: '700' }}>{event.ticketPriceLabel}</Txt>
                </View>
              )}
            </View>
            <View style={{ padding: 16, gap: 6 }}>
              <Txt variant="h2" numberOfLines={2}>{event.name}</Txt>
              {start && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="calendar" color={p.brand} size={15} />
                  <Txt variant="small" style={{ color: p.brand, fontWeight: '600', textTransform: 'capitalize' }}>{weekdayLong(start)} · {timeBrussels(start)}</Txt>
                </View>
              )}
              {event.place && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="route" color={p.muted} size={15} />
                  <Txt variant="smallMuted" style={{ flex: 1 }} numberOfLines={1}>{event.place}</Txt>
                </View>
              )}
              {(event.socialSummary || event.isOnline) && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
                  {event.socialSummary && <Txt variant="smallMuted">{event.socialSummary}</Txt>}
                  {event.isOnline && <Txt variant="small" style={{ fontWeight: '700' }}>Online</Txt>}
                </View>
              )}
            </View>
          </Animated.View>
        </Card>
      </Pressable>
    </Link>
  )
}
