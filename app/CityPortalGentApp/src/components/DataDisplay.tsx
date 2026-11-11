import { useRef } from 'react'
import { Animated, Text, View, StyleSheet } from 'react-native'
import type { ReactNode, ViewStyle } from 'react'
import { usePalette } from '@/context/ThemeContext'
import { Radius } from '@/constants/theme'
import { useSlideInAnimation } from '@/hooks/useAnimations'

interface StatBoxProps {
  label: string
  value: string | number
  unit?: string
  icon?: ReactNode
  highlight?: boolean
  trend?: 'up' | 'down' | 'neutral'
  animate?: boolean
}

/**
 * Professional stat box for displaying key metrics
 */
export function StatBox({
  label,
  value,
  unit,
  icon,
  highlight = false,
  trend,
  animate = true,
}: StatBoxProps) {
  const p = usePalette()
  const animationStyle = useSlideInAnimation(animate)

  const trendColor = trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : p.ink2

  return (
    <Animated.View
      style={[
        {
          backgroundColor: highlight ? p.brandSoft : p.surface2,
          borderRadius: Radius.lg,
          padding: 16,
          borderWidth: 1,
          borderColor: highlight ? p.brand : p.border,
          flex: 1,
          minHeight: 100,
          justifyContent: 'space-between',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 2,
          elevation: 1,
        },
        animationStyle,
      ]}>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: p.muted, fontSize: 12, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {label}
          </Text>
          {icon && <View>{icon}</View>}
        </View>
      </View>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text style={{ color: highlight ? p.brandStrong : p.ink, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 }}>
            {value}
          </Text>
          {unit && <Text style={{ color: p.muted, fontSize: 12, fontWeight: '500' }}>{unit}</Text>}
        </View>
        {trend && (
          <Text style={{ color: trendColor, fontSize: 12, fontWeight: '600', marginTop: 4 }}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} Trend
          </Text>
        )}
      </View>
    </Animated.View>
  )
}

interface DataGridProps {
  columns?: number
  gap?: number
  children: ReactNode
}

/**
 * Grid layout for displaying multiple stat boxes
 */
export function DataGrid({ columns = 2, gap = 12, children }: DataGridProps) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, marginBottom: 20 }}>
      {children}
    </View>
  )
}

interface DetailItemProps {
  label: string
  value: string | number | ReactNode
  icon?: ReactNode
  highlight?: boolean
  animate?: boolean
}

/**
 * Professional detail item for showing information with label and value
 */
export function DetailItem({ label, value, icon, highlight = false, animate = true }: DetailItemProps) {
  const p = usePalette()
  const animationStyle = useSlideInAnimation(animate)

  return (
    <Animated.View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          paddingHorizontal: 14,
          backgroundColor: highlight ? p.brandSoft : p.surface2,
          borderRadius: Radius.md,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: highlight ? p.brand : p.border,
        },
        animationStyle,
      ]}>
      {icon && <View style={{ marginRight: 12 }}>{icon}</View>}
      <View style={{ flex: 1 }}>
        <Text style={{ color: p.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
          {label}
        </Text>
        <Text style={{ color: p.ink, fontSize: 15, fontWeight: '600' }}>
          {typeof value === 'string' || typeof value === 'number' ? value : value}
        </Text>
      </View>
    </Animated.View>
  )
}

interface SectionProps {
  title: string
  children: ReactNode
  action?: ReactNode
  animate?: boolean
}

/**
 * Professional section with title and optional action
 */
export function Section({ title, children, action, animate = true }: SectionProps) {
  const p = usePalette()
  const animationStyle = useSlideInAnimation(animate)

  return (
    <Animated.View style={[{ marginBottom: 24 }, animationStyle]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingHorizontal: 2 }}>
        <Text style={{ color: p.ink, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 }}>{title}</Text>
        {action}
      </View>
      <View style={{ gap: 8 }}>{children}</View>
    </Animated.View>
  )
}

interface BadgeProps {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info'
  size?: 'sm' | 'md'
}

/**
 * Professional badge component
 */
export function Badge({ children, variant = 'default', size = 'md' }: BadgeProps) {
  const p = usePalette()

  const variants = {
    default: { bg: p.surface2, fg: p.ink },
    success: { bg: '#d1fae5', fg: '#065f46' },
    warning: { bg: '#fef3c7', fg: '#92400e' },
    error: { bg: '#fee2e2', fg: '#991b1b' },
    info: { bg: p.brandSoft, fg: p.brandStrong },
  }

  const v = variants[variant]
  const padding = size === 'sm' ? { px: 8, py: 4 } : { px: 10, py: 6 }

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: v.bg,
        borderRadius: Radius.full,
        paddingHorizontal: padding.px,
        paddingVertical: padding.py,
      }}>
      <Text style={{ color: v.fg, fontSize: size === 'sm' ? 11 : 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {children}
      </Text>
    </View>
  )
}

interface ValueDisplayProps {
  label: string
  value: string | number
  unit?: string
  size?: 'sm' | 'md' | 'lg'
  animate?: boolean
}

/**
 * Centered value display with label
 */
export function ValueDisplay({ label, value, unit, size = 'md', animate = true }: ValueDisplayProps) {
  const p = usePalette()
  const animationStyle = useSlideInAnimation(animate)

  const sizes = {
    sm: { labelSize: 11, valueSize: 18 },
    md: { labelSize: 12, valueSize: 24 },
    lg: { labelSize: 13, valueSize: 32 },
  }

  const s = sizes[size]

  return (
    <Animated.View style={[{ alignItems: 'center', justifyContent: 'center', gap: 4 }, animationStyle]}>
      <Text style={{ color: p.muted, fontSize: s.labelSize, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
        <Text style={{ color: p.ink, fontSize: s.valueSize, fontWeight: '700', letterSpacing: -0.5 }}>
          {value}
        </Text>
        {unit && <Text style={{ color: p.muted, fontSize: s.labelSize, fontWeight: '500' }}>{unit}</Text>}
      </View>
    </Animated.View>
  )
}
