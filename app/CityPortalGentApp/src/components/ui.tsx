import { useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import type { StyleProp, TextInputProps, TextProps, TextStyle, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Radius } from '@/constants/theme'
import { usePalette } from '@/context/ThemeContext'
import { initial } from '@/lib/friendsUi'

type Variant = 'body' | 'small' | 'muted' | 'smallMuted' | 'strong' | 'h1' | 'h2' | 'h3' | 'note'

/** Tekst in de kleuren van het thema. */
export function Txt({ variant = 'body', style, ...rest }: TextProps & { variant?: Variant }) {
  const p = usePalette()
  const base: Record<Variant, TextStyle> = {
    body: { color: p.ink, fontSize: 14, lineHeight: 21 },
    small: { color: p.ink, fontSize: 12.5, lineHeight: 18 },
    muted: { color: p.muted, fontSize: 14, lineHeight: 21 },
    smallMuted: { color: p.muted, fontSize: 12.5, lineHeight: 18 },
    strong: { color: p.ink, fontSize: 14, lineHeight: 21, fontWeight: '700' },
    h1: { color: p.ink, fontSize: 24, lineHeight: 30, fontWeight: '600', letterSpacing: -0.2 },
    h2: { color: p.ink, fontSize: 17, lineHeight: 23, fontWeight: '600' },
    h3: { color: p.ink, fontSize: 15, lineHeight: 21, fontWeight: '600' },
    note: { color: p.ink2, fontSize: 14, lineHeight: 21, marginTop: 10 },
  }
  return <Text style={[base[variant], style]} {...rest} />
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette()
  return (
    <View
      style={[
        {
          backgroundColor: p.surface,
          borderColor: p.border,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: Radius.lg,
          padding: 16,
          marginBottom: 14,
        },
        style,
      ]}>
      {children}
    </View>
  )
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
      <Txt variant="h2" style={{ flexShrink: 1 }}>{children}</Txt>
      {right}
    </View>
  )
}

interface BtnProps {
  label: string
  onPress?: () => void
  variant?: 'default' | 'primary' | 'ghost'
  size?: 'md' | 'sm'
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

export function Btn({ label, onPress, variant = 'default', size = 'md', disabled, style }: BtnProps) {
  const p = usePalette()
  const primary = variant === 'primary'
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          paddingVertical: size === 'sm' ? 5 : 9,
          paddingHorizontal: size === 'sm' ? 10 : 14,
          borderRadius: size === 'sm' ? Radius.xs : Radius.sm,
          borderWidth: 1,
          borderColor: primary ? p.brand : variant === 'ghost' ? 'transparent' : p.borderStrong,
          backgroundColor: primary ? (pressed ? p.brandStrong : p.brand) : pressed ? p.surface3 : variant === 'ghost' ? 'transparent' : p.surface,
          opacity: disabled ? 0.5 : 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <Text style={{ color: primary ? p.brandInk : p.ink, fontWeight: '500', fontSize: size === 'sm' ? 12.5 : 14 }}>{label}</Text>
    </Pressable>
  )
}

export function Input(props: TextInputProps & { style?: StyleProp<TextStyle> }) {
  const p = usePalette()
  const { style, ...rest } = props
  return (
    <TextInput
      placeholderTextColor={p.muted}
      autoCapitalize="none"
      autoCorrect={false}
      {...rest}
      style={[
        {
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderWidth: 1,
          borderColor: p.borderStrong,
          borderRadius: Radius.sm,
          backgroundColor: p.surface,
          color: p.ink,
          fontSize: 14,
          minWidth: 0,
        },
        style,
      ]}
    />
  )
}

export function Label({ children }: { children: ReactNode }) {
  const p = usePalette()
  return <Text style={{ color: p.ink2, fontSize: 12.5, fontWeight: '600', marginBottom: 4 }}>{children}</Text>
}

export function Banner({ children, ok, style }: { children: ReactNode; ok?: boolean; style?: StyleProp<ViewStyle> }) {
  const p = usePalette()
  return (
    <View
      accessibilityRole="alert"
      style={[
        {
          backgroundColor: ok ? p.surface2 : p.scheme === 'dark' ? '#2a2412' : '#fdf5e4',
          borderColor: ok ? p.border : p.warn,
          borderWidth: 1,
          borderRadius: Radius.md,
          padding: 12,
          marginBottom: 14,
        },
        style,
      ]}>
      <Text style={{ color: ok ? p.ink : p.warnInk, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <View style={{ paddingVertical: 28, paddingHorizontal: 4, alignItems: 'center' }}>
      <Txt variant="muted" style={{ textAlign: 'center' }}>{children}</Txt>
    </View>
  )
}

export function Loading({ label = 'Even geduld…' }: { label?: string }) {
  const p = usePalette()
  return (
    <View style={{ paddingVertical: 28, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={p.brand} />
      <Txt variant="muted">{label}</Txt>
    </View>
  )
}

export function Pill({ children, tone = 'grey' }: { children: ReactNode; tone?: 'grey' | 'red' | 'green' }) {
  const p = usePalette()
  const color = tone === 'red' ? p.critInk : tone === 'green' ? p.okInk : p.muted
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 2, borderRadius: Radius.full, backgroundColor: p.surface3 }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{children}</Text>
    </View>
  )
}

export function SwitchRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: p.borderStrong, true: '#3b82f6' }}
        thumbColor="#ffffff"
      />
      <Txt style={{ flex: 1, fontWeight: '500' }}>{label}</Txt>
    </View>
  )
}

export function Segmented<T extends string | number>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  const p = usePalette()
  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: p.borderStrong, borderRadius: Radius.sm, overflow: 'hidden', alignSelf: 'flex-start' }}>
      {options.map(([key, label], i) => {
        const on = key === value
        return (
          <Pressable
            key={String(key)}
            onPress={() => onChange(key)}
            style={{
              paddingVertical: 6,
              paddingHorizontal: 11,
              backgroundColor: on ? p.brandSoft : p.surface,
              borderLeftWidth: i === 0 ? 0 : 1,
              borderLeftColor: p.border,
            }}>
            <Text style={{ color: on ? p.brandStrong : p.ink2, fontSize: 12.5, fontWeight: on ? '600' : '500' }}>{label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Label links, waarde rechts. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <Txt variant="muted">{label}</Txt>
      <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
        {typeof children === 'string' || typeof children === 'number' ? <Txt variant="strong" style={{ textAlign: 'right' }}>{children}</Txt> : children}
      </View>
    </View>
  )
}

/** Gestapeld label en waarde (de feiten op de parkingpagina). */
export function FactBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ minWidth: '45%', flexGrow: 1 }}>
      <Txt variant="smallMuted" style={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 }}>{label}</Txt>
      <Txt style={{ marginTop: 2 }}>{children}</Txt>
    </View>
  )
}

export function Avatar({ name, src, size = 36, off = false }: { name: string; src?: string | null; size?: number; off?: boolean }) {
  const p = usePalette()
  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: p.brand,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: p.surface,
        opacity: off ? 0.6 : 1,
      }}>
      {src ? (
        <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <Text style={{ color: p.brandInk, fontWeight: '700', fontSize: size * 0.4 }}>{initial(name)}</Text>
      )}
    </View>
  )
}

/** Titel en ondertitel bovenaan een pagina. */
export function PageHead({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={{ marginBottom: 16, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <Txt variant="h1" style={{ flex: 1 }}>{title}</Txt>
        {right}
      </View>
      {subtitle ? <Txt variant="muted">{subtitle}</Txt> : null}
    </View>
  )
}

/** Scrollbare pagina met de achtergrond en marges van het thema. */
export function Screen({ children, bottomInset = 0, style }: { children: ReactNode; bottomInset?: number; style?: StyleProp<ViewStyle> }) {
  const p = usePalette()
  const insets = useSafeAreaInsets()
  const contentStyle = useMemo(
    () => [{ padding: 16, paddingBottom: 32 + bottomInset + insets.bottom }, style],
    [bottomInset, insets.bottom, style],
  )
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.bg }}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      {children}
    </ScrollView>
  )
}
