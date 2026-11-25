import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, View } from 'react-native'

import { errorMessage } from '@/components/AuthForm'
import { Dialog } from '@/components/Dialog'
import { Avatar, Banner, Btn, Card, CardTitle, Input, Label, Loading, Txt } from '@/components/ui'
import { usePalette } from '@/context/ThemeContext'
import { api } from '@/lib/api'
import { fmtTimeIso } from '@/lib/format'
import type { ChatConversation, Friend } from '@/lib/types'

const POLL_MS = 10_000

export const chatTitle = (c: ChatConversation) => c.groupName || c.directChatFriend?.username || 'Direct bericht'

/** De chats van de gebruiker bovenaan de vriendenpagina: openen, een nieuw bericht starten of een groep maken. */
export function ChatList({ friends }: { friends: Friend[] }) {
  const p = usePalette()
  const router = useRouter()
  const [chats, setChats] = useState<ChatConversation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<'direct' | 'group' | null>(null)
  const [groupName, setGroupName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setChats(await api.friends.chats.list())
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  // Alleen verversen terwijl dit tabblad zichtbaar is.
  useFocusEffect(
    useCallback(() => {
      void load()
      const t = setInterval(() => void load(), POLL_MS)
      return () => clearInterval(t)
    }, [load]),
  )

  const open = (id: string) => router.push({ pathname: '/chat/[id]', params: { id } })

  async function startDirect(friend: Friend) {
    setBusy(true)
    try {
      const { conversationId } = await api.friends.chats.createDirect(friend.id)
      setDialog(null)
      void load()
      open(conversationId)
    } catch (err) {
      setDialog(null)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function createGroup() {
    const name = groupName.trim()
    if (!name) return
    setBusy(true)
    try {
      const { conversationId } = await api.friends.chats.createGroup({ groupName: name })
      setGroupName('')
      setDialog(null)
      void load()
      open(conversationId)
    } catch (err) {
      setDialog(null)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const shown = (chats ?? []).filter((c) => chatTitle(c).toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <Card>
      <CardTitle
        right={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn size="sm" label="Nieuw bericht" onPress={() => setDialog('direct')} />
            <Btn size="sm" variant="primary" label="Nieuwe groep" onPress={() => setDialog('group')} />
          </View>
        }>
        Chats
      </CardTitle>

      {error && <Banner>{error}</Banner>}
      {chats && chats.length > 0 && (
        <Input placeholder="Zoeken op naam..." value={query} onChangeText={setQuery} style={{ marginBottom: 8 }} />
      )}

      {!chats ? (
        <Loading />
      ) : shown.length === 0 ? (
        <Txt variant="muted">{chats.length === 0 ? 'Geen chats. Start een gesprek met een vriend of maak een groep.' : 'Geen resultaten'}</Txt>
      ) : (
        <View>
          {shown.map((c, i) => {
            const last = c.recentMessages[c.recentMessages.length - 1]
            const title = chatTitle(c)
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                onPress={() => open(c.id)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 10,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: p.border,
                  opacity: pressed ? 0.7 : 1,
                })}>
                <Avatar name={title} src={c.directChatFriend?.avatar} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Txt variant="strong" numberOfLines={1} style={{ flex: 1 }}>{title}</Txt>
                    {last && <Txt variant="smallMuted">{fmtTimeIso(last.sentAtUtc)}</Txt>}
                  </View>
                  <Txt variant="smallMuted" numberOfLines={1}>
                    {last ? `${last.senderUsername}: ${last.content}` : 'Geen berichten'}
                  </Txt>
                </View>
              </Pressable>
            )
          })}
        </View>
      )}

      {dialog === 'direct' && (
        <Dialog title="Bericht sturen naar vrienden" onClose={() => setDialog(null)}>
          <Label>Selecteer een vriend:</Label>
          {friends.length === 0 ? (
            <Txt variant="muted" style={{ textAlign: 'center' }}>Je hebt nog geen vrienden</Txt>
          ) : (
            friends.map((f) => (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void startDirect(f)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor: pressed ? p.surface3 : 'transparent',
                })}>
                <Avatar name={f.username} src={f.avatar} size={32} />
                <Txt variant="strong">{f.username}</Txt>
              </Pressable>
            ))
          )}
          <Btn label="Sluiten" onPress={() => setDialog(null)} />
        </Dialog>
      )}

      {dialog === 'group' && (
        <Dialog title="Groep maken" onClose={() => setDialog(null)}>
          <View>
            <Label>Groepsnaam</Label>
            <Input
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Naam van de groep"
              maxLength={200}
              autoFocus
              autoCapitalize="sentences"
              returnKeyType="done"
              onSubmitEditing={() => void createGroup()}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Btn label="Annuleren" onPress={() => { setDialog(null); setGroupName('') }} />
            <Btn variant="primary" label="Groep maken" disabled={busy || !groupName.trim()} onPress={() => void createGroup()} />
          </View>
        </Dialog>
      )}
    </Card>
  )
}
