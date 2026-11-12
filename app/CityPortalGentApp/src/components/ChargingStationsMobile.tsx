import { useEffect, useState } from 'react'
import { View, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { usePalette } from '@/context/ThemeContext'
import { Txt, Card } from '@/components/ui'
import type { ChargingStation } from '@/lib/chargingStations'
import { fetchChargingStations, getNearestChargingStation, formatDistance } from '@/lib/chargingStations'

interface ChargingStationsMobileProps {
  destination?: { lat: number; lon: number }
  onStationSelect?: (station: ChargingStation) => void
}

export function ChargingStationsMobile({ destination, onStationSelect }: ChargingStationsMobileProps) {
  const p = usePalette()
  const [stations, setStations] = useState<ChargingStation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedStation, setSelectedStation] = useState<ChargingStation | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadStations = async () => {
      setLoading(true)
      setError(null)
      try {
        const stationsData = await fetchChargingStations()
        if (!cancelled) {
          setStations(stationsData)

          if (destination) {
            const nearest = getNearestChargingStation(stationsData, destination.lat, destination.lon, 10000)
            if (nearest) {
              setSelectedStation(nearest)
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Kon laadpalen niet laden')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadStations()
    return () => { cancelled = true }
  }, [destination?.lat, destination?.lon])

  const handleStationPress = (station: ChargingStation) => {
    setSelectedStation(station)
    onStationSelect?.(station)
  }

  const availableStations = stations.filter((s) => s.status === 'free')
  const occupiedStations = stations.filter((s) => s.status === 'occupied')

  return (
    <View style={{ gap: 12 }}>
      <Txt style={{ fontSize: 16, fontWeight: '600' }}>🔌 Laadpalen voor elektrische auto's</Txt>

      {loading && (
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <ActivityIndicator size="large" color={p.brand} />
          <Txt style={{ marginTop: 8 }}>Laadpalen laden...</Txt>
        </View>
      )}

      {error && !loading && (
        <Card
          style={{
            backgroundColor: p.surface,
            borderLeftWidth: 4,
            borderLeftColor: p.crit,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <Txt style={{ color: p.crit }}>Fout: {error}</Txt>
        </Card>
      )}

      {!loading && !error && (
        <>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View
              style={{
                flex: 1,
                backgroundColor: p.surface,
                padding: 10,
                borderRadius: 6,
                alignItems: 'center',
              }}
            >
              <Txt style={{ fontSize: 12, color: p.ink2, marginBottom: 4 }}>Beschikbaar</Txt>
              <Txt style={{ fontSize: 18, fontWeight: '700', color: p.ok }}>{availableStations.length}</Txt>
            </View>
            <View
              style={{
                flex: 1,
                backgroundColor: p.surface,
                padding: 10,
                borderRadius: 6,
                alignItems: 'center',
              }}
            >
              <Txt style={{ fontSize: 12, color: p.ink2, marginBottom: 4 }}>Bezet</Txt>
              <Txt style={{ fontSize: 18, fontWeight: '700', color: p.crit }}>{occupiedStations.length}</Txt>
            </View>
          </View>

          <ScrollView style={{ maxHeight: 400 }} scrollEnabled contentContainerStyle={{ gap: 8 }}>
            {stations.length === 0 ? (
              <Txt style={{ textAlign: 'center', color: p.ink2, paddingVertical: 20 }}>
                Geen laadpalen gevonden
              </Txt>
            ) : (
              stations.map((station) => {
                const isSelected = selectedStation?.id === station.id
                const distance = destination
                  ? Math.sqrt(
                      Math.pow(destination.lat - station.lat, 2) + Math.pow(destination.lon - station.lon, 2),
                    ) * 111000
                  : null

                return (
                  <Pressable
                    key={station.id}
                    onPress={() => handleStationPress(station)}
                    style={{
                      backgroundColor: isSelected ? p.brandSoft : p.surface,
                      borderRadius: 6,
                      padding: 10,
                      borderLeftWidth: 4,
                      borderLeftColor: station.status === 'free' ? p.ok : p.crit,
                      opacity: 1,
                    }}
                    android_ripple={{ color: p.brand, radius: 100 }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                          <View
                            style={{
                              backgroundColor: station.status === 'free' ? p.ok : p.crit,
                              paddingVertical: 2,
                              paddingHorizontal: 6,
                              borderRadius: 3,
                            }}
                          >
                            <Txt
                              style={{
                                fontSize: 11,
                                fontWeight: '600',
                                color: p.bg,
                              }}
                            >
                              {station.status === 'free' ? '✓ Vrij' : '✗ Bezet'}
                            </Txt>
                          </View>
                          <Txt style={{ fontSize: 13, fontWeight: '600', flex: 1 }}>{station.name}</Txt>
                        </View>
                        {station.address && <Txt style={{ fontSize: 12, color: p.ink2 }}>{station.address}</Txt>}
                        {distance !== null && (
                          <Txt style={{ fontSize: 11, color: p.ink2, marginTop: 2 }}>
                            ~{formatDistance(distance)}
                          </Txt>
                        )}
                        {station.operator && (
                          <Txt style={{ fontSize: 11, color: p.ink2, marginTop: 2, fontStyle: 'italic' }}>
                            {station.operator}
                          </Txt>
                        )}
                      </View>
                    </View>
                  </Pressable>
                )
              })
            )}
          </ScrollView>
        </>
      )}
    </View>
  )
}
