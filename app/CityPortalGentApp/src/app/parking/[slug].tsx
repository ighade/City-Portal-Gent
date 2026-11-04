import { useLocalSearchParams } from 'expo-router'

import { ParkingDetailScreen } from '@/screens/ParkingDetailScreen'

export default function ParkingRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  return <ParkingDetailScreen slug={slug} />
}
