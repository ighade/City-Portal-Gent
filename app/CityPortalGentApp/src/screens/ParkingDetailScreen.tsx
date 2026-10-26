/* eslint-disable react-hooks/set-state-in-effect */
import { Link } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { OccupancyMeter } from '@/components/OccupancyMeter'
import { ManualRateInfo } from '@/components/RateInfo'
import { TimeChart } from '@/components/TimeChart'
import { TrendHeatmap } from '@/components/TrendHeatmap'
import { Banner, Btn, Card, CardTitle, Empty, FactBlock, Loading, Screen, Segmented, Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { api } from '@/lib/api'
import { nl } from '@/lib/format'
import { openExternal } from '@/lib/links'
import { kindLabel } from '@/lib/types'
import type { Parking, Point, Trend } from '@/lib/types'

const WINDOWS: [number, string][] = [
  [6, '6 uur'],
  [24, '24 uur'],
  [72, '3 dagen'],
  [168, 'een week'],
]

export function ParkingDetailScreen({ slug }: { slug: string }) {
  const p = usePalette()
  const [parking, setParking] = useState<Parking | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [trend, setTrend] = useState<Trend | null>(null)
  const [hours, setHours] = useState(24)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    api.parking(slug).then(setParking).catch((e: Error) => setError(e.message))
    api.trend(slug).then(setTrend).catch(() => setTrend(null))
  }, [slug])

  useEffect(() => {
    api.history(slug, hours).then(setPoints).catch(() => setPoints([]))
  }, [slug, hours])

  const back = (
    <Link href="/route" style={{ color: p.brand, marginBottom: 8, fontWeight: '500' }}>
      ← Naar routeplanner
    </Link>
  )

  if (error) {
    return (
      <Screen>
        <Empty>{error}</Empty>
        <Link href="/route" style={{ color: p.brand, textAlign: 'center' }}>Terug naar de routeplanner</Link>
      </Screen>
    )
  }
  if (!parking) {
    return (
      <Screen>
        <Loading />
      </Screen>
    )
  }

  const capacity = parking.status?.capacity || parking.capacity

  return (
    <Screen>
      {back}
      <Txt variant="h1">{parking.name}</Txt>
      <Txt variant="muted" style={{ marginBottom: 16 }}>
        {kindLabel[parking.kind]}
        {parking.address ? ` · ${parking.address}` : ''}
      </Txt>

      <Card>
        {!parking.isPublic && (
          <Banner>
            Deze stalling is voor personeel. Stad Gent meet en publiceert haar bezetting, maar je kunt er niet terecht — ze staat hier alleen omdat de cijfers er zijn.
          </Banner>
        )}
        <OccupancyMeter status={parking.status} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginVertical: 14 }}>
          <FactBlock label="Plaatsen">{nl(capacity)}</FactBlock>
          {parking.openingHours && <FactBlock label="Open">{parking.openingHours}</FactBlock>}
          {parking.operator && <FactBlock label="Beheerder">{parking.operator}</FactBlock>}
          {parking.inLowEmissionZone !== undefined && parking.inLowEmissionZone !== null && (
            <FactBlock label="Lage-emissiezone">{parking.inLowEmissionZone ? 'binnen de LEZ' : 'buiten de LEZ'}</FactBlock>
          )}
          {parking.isFree !== undefined && parking.isFree !== null && (
            <FactBlock label="Tarief">{parking.isFree ? 'gratis' : 'betalend'}</FactBlock>
          )}
          {parking.status && (
            <FactBlock label="Laatste meting">{new Date(parking.status.measuredAtUtc).toLocaleString('nl-BE')}</FactBlock>
          )}
        </View>
        <ManualRateInfo rate={parking.manualRate} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <Btn
            label="Route hierheen"
            onPress={() => void openExternal(`https://www.openstreetmap.org/directions?to=${parking.lat}%2C${parking.lon}`)}
          />
          {parking.url ? <Btn variant="ghost" label="Pagina van de stad" onPress={() => void openExternal(parking.url!)} /> : null}
        </View>
      </Card>

      {parking.hasLiveData ? (
        <>
          <Card>
            <CardTitle>Vrije plaatsen — de laatste {WINDOWS.find(([h]) => h === hours)?.[1] ?? `${hours} uur`}</CardTitle>
            <View style={{ marginBottom: 12 }}>
              <Segmented options={WINDOWS} value={hours} onChange={setHours} />
            </View>
            <TimeChart points={points} capacity={capacity} />
          </Card>

          <Card>
            <CardTitle>Hoe druk is het hier normaal?</CardTitle>
            {trend ? <TrendHeatmap trend={trend} /> : <Txt variant="smallMuted">Nog geen patroon beschikbaar.</Txt>}
          </Card>
        </>
      ) : (
        <Card>
          <Txt variant="muted">
            {parking.isManual
              ? 'Deze parking is handmatig toegevoegd. Er zijn geen gegevens over de bezetting beschikbaar.'
              : 'Stad Gent publiceert voor deze plek geen bezetting — alleen waar ze ligt en hoeveel plaatsen ze heeft. Zodra daar een meetreeks voor komt, verschijnt ze hier vanzelf.'}
          </Txt>
        </Card>
      )}
    </Screen>
  )
}
