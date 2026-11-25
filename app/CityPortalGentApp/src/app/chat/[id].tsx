import { useLocalSearchParams } from 'expo-router'

import { ChatScreen } from '@/screens/ChatScreen'

export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ChatScreen id={id} />
}
