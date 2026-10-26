import { useLocalSearchParams } from 'expo-router'

import { EventDetailScreen } from '@/screens/EventDetailScreen'

export default function EventRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <EventDetailScreen id={id} />
}
