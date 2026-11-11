import { useEffect, useRef } from 'react'
import { Animated, View, StyleSheet } from 'react-native'
import { usePalette } from '@/context/ThemeContext'
import { Radius } from '@/constants/theme'

interface SkeletonLoaderProps {
  width?: number | string
  height?: number
  borderRadius?: number
  style?: any
}

export function SkeletonLoader({ width = '100%', height = 20, borderRadius = Radius.sm, style }: SkeletonLoaderProps) {
  const p = usePalette()
  const shimmer = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1500, useNativeDriver: false }),
        Animated.timing(shimmer, { toValue: 0, duration: 1500, useNativeDriver: false }),
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [shimmer])

  const opacity = shimmer.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 0.7, 0.3],
  })

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: p.surface3,
          opacity,
        },
        style,
      ]}
    />
  )
}

export function SkeletonCard() {
  const p = usePalette()
  return (
    <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }]}>
      <SkeletonLoader width="70%" height={20} borderRadius={Radius.sm} style={{ marginBottom: 12 }} />
      <SkeletonLoader width="100%" height={16} borderRadius={Radius.sm} style={{ marginBottom: 8 }} />
      <SkeletonLoader width="85%" height={16} borderRadius={Radius.sm} />
    </View>
  )
}

export function SkeletonEventCard() {
  const p = usePalette()
  return (
    <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.border }]}>
      <SkeletonLoader width="100%" height={150} borderRadius={Radius.md} style={{ marginBottom: 12 }} />
      <SkeletonLoader width="60%" height={18} borderRadius={Radius.sm} style={{ marginBottom: 8 }} />
      <SkeletonLoader width="100%" height={14} borderRadius={Radius.sm} style={{ marginBottom: 8 }} />
      <SkeletonLoader width="75%" height={14} borderRadius={Radius.sm} />
    </View>
  )
}

export function SkeletonParkingCard() {
  const p = usePalette()
  return (
    <View style={[styles.parkingCard, { backgroundColor: p.surface, borderColor: p.border }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <SkeletonLoader width="50%" height={20} borderRadius={Radius.sm} />
        <SkeletonLoader width="30%" height={24} borderRadius={Radius.full} />
      </View>
      <SkeletonLoader width="100%" height={40} borderRadius={Radius.sm} style={{ marginBottom: 12 }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SkeletonLoader width="48%" height={14} borderRadius={Radius.xs} />
        <SkeletonLoader width="48%" height={14} borderRadius={Radius.xs} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: 16,
    marginBottom: 14,
  },
  parkingCard: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: 16,
    marginBottom: 12,
  },
})
