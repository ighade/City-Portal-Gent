import { Image, Pressable, View } from 'react-native'

import { Btn, Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { usePalette } from '@/context/ThemeContext'
import { RENTAL_BIKE_ICONS, RENTAL_TARIFF_LABEL, rentalCostLabel } from '@/lib/rentalBikes'
import type { RentalBike } from '@/lib/rentalBikes'

interface NearbyRentalBike extends RentalBike {
  distanceMeters: number
}

interface Props {
  bikes: NearbyRentalBike[]
  selectedBikeId: string | null
  loading: boolean
  error: string | null
  openError: string | null
  sortLabel: string
  rideMinutes?: number | null
  onSelect: (id: string) => void
  onOpen: () => void
}

const distanceLabel = (meters: number) => meters < 1000
  ? `${Math.round(meters)} m`
  : `${(meters / 1000).toFixed(1).replace('.', ',')} km`

export function RentalBikesPanel({
  bikes,
  selectedBikeId,
  loading,
  error,
  openError,
  sortLabel,
  rideMinutes,
  onSelect,
  onOpen,
}: Props) {
  const p = usePalette()
  const selectedBike = bikes.find((bike) => bike.id === selectedBikeId)

  return (
    <View style={{ gap: 8 }}>
      <View>
        <Txt variant="h2">Deelfietsen</Txt>
        <Txt variant="smallMuted">Dichtstbij eerst · vanaf {sortLabel}</Txt>
        <Txt variant="smallMuted">
          Normaal tarief: {RENTAL_TARIFF_LABEL}.
          {rideMinutes != null ? ` Geschatte kost voor deze rit: ${rentalCostLabel(rideMinutes)}.` : ''}
        </Txt>
      </View>

      {loading && <Txt variant="smallMuted">Deelfietsen laden…</Txt>}
      {error && <Txt accessibilityRole="alert" style={{ color: p.warnInk }}>{error}</Txt>}
      {!loading && !error && bikes.length === 0 && <Txt variant="smallMuted">Geen beschikbare deelfietsen gevonden.</Txt>}

      {!error && bikes.map((bike) => {
        const selected = bike.id === selectedBikeId
        const details = [
          distanceLabel(bike.distanceMeters),
          bike.rangeMeters !== null ? `${(bike.rangeMeters / 1000).toFixed(1).replace('.', ',')} km bereik` : null,
          bike.batteryPercent !== null ? `${bike.batteryPercent}% batterij` : null,
        ].filter(Boolean).join(' · ')

        return (
          <Pressable
            key={`${bike.provider}-${bike.id}`}
            onPress={() => onSelect(bike.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${bike.provider}, ${details}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderRadius: Radius.sm,
              borderWidth: 1,
              borderColor: selected ? p.brand : p.border,
              backgroundColor: selected ? p.brandSoft : p.surface,
            }}>
            <Image source={RENTAL_BIKE_ICONS[bike.provider]} style={{ width: 30, height: 30, borderRadius: 15 }} />
            <View style={{ flex: 1 }}>
              <Txt variant="strong">{bike.provider} · {distanceLabel(bike.distanceMeters)}</Txt>
              <Txt variant="smallMuted">{details}</Txt>
            </View>
          </Pressable>
        )
      })}

      {selectedBike && (
        <Btn
          label={`Open in de ${selectedBike.provider}-app of website`}
          onPress={onOpen}
          variant="primary"
          disabled={loading}
        />
      )}
      {openError && <Txt accessibilityRole="alert" style={{ color: p.warnInk }}>{openError}</Txt>}
    </View>
  )
}
