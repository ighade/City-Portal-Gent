import { Stack, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native'
import type { ScrollViewInstance } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { errorMessage } from '@/components/AuthForm'
import { chatTitle } from '@/components/ChatList'
import { Dialog } from '@/components/Dialog'
import { Banner, Btn, Input, Label, Loading, Txt } from '@/components/ui'
import { Radius } from '@/constants/theme'
import { useAuth } from '@/context/AuthContext'
import { usePalette } from '@/context/ThemeContext'
import { api, ApiError } from '@/lib/api'
import { fmtTimeIso } from '@/lib/format'
import { setOpenConversation } from '@/lib/notifications'
import type { ChatConversation, Friend } from '@/lib/types'

const POLL_MS = 4_000

export function ChatScreen({ id }: { id: string }) {
  const p = usePalette()
  const { user: me } = useAuth()
  const insets = useSafeAreaInsets()
  const [conv, setConv] = useState<ChatConversation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [friends, setFriends] = useState<Friend[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const scroll = useRef<ScrollViewInstance>(null)

  const load = useCallback(async () => {
    try {
      setConv(await api.friends.chats.get(id))
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true)
      else if (!(err instanceof ApiError && err.status === 401)) setError(errorMessage(err))
    }
  }, [id])

  // Verversen en meldingen onderdrukken zolang dit gesprek open en zichtbaar is.
  useFocusEffect(
    useCallback(() => {
      setOpenConversation(id)
      void load()
      const t = setInterval(() => {
        if (AppState.currentState === 'active') void load()
      }, POLL_MS)
      return () => {
        clearInterval(t)
        setOpenConversation(null)
      }
    }, [id, load]),
  )

  const count = conv?.recentMessages.length ?? 0
  const lastId = conv?.recentMessages[count - 1]?.id
  useEffect(() => {
    scroll.current?.scrollToEnd({ animated: false })
  }, [lastId])

  async function send() {
    const content = text.trim()
    if (!content || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.friends.chats.sendMessage(id, content)
      setText('')
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function openAdd() {
    setSelected([])
    setAdding(true)
    try {
      setFriends((await api.friends.overview()).friends)
    } catch (err) {
      setAdding(false)
      setError(errorMessage(err))
    }
  }

  async function addMembers() {
    const names = friends.filter((f) => selected.includes(f.id)).map((f) => f.username)
    if (names.length === 0) return
    setBusy(true)
    setError(null)
    try {
      for (const name of names) await api.friends.chats.addMember(id, name)
      setAdding(false)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (missing) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, padding: 16 }}>
        <Banner>Dat gesprek bestaat niet of je bent er geen lid van.</Banner>
      </View>
    )
  }
  if (!conv) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <Stack.Screen options={{ title: 'Chat' }} />
        {error ? <View style={{ padding: 16 }}><Banner>{error}</Banner></View> : <Loading />}
      </View>
    )
  }

  const isGroup = conv.groupName != null
  const members = conv.groupMembers ?? []
  const addable = friends.filter((f) => !members.includes(f.id))
  const messages = conv.recentMessages

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={insets.top + (Platform.OS === 'ios' ? 44 : 56)}
      style={{ flex: 1, backgroundColor: p.bg }}>
      <Stack.Screen options={{ title: chatTitle(conv) }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: p.border, backgroundColor: p.surface }}>
        <Txt variant="smallMuted" style={{ flex: 1 }}>
          {members.length || 2} deelnemer{members.length === 1 ? '' : 's'}
        </Txt>
        {isGroup && <Btn size="sm" variant="primary" label="Leden toevoegen" onPress={() => void openAdd()} />}
      </View>

      {error && <View style={{ paddingHorizontal: 16, paddingTop: 12 }}><Banner>{error}</Banner></View>}

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 4, flexGrow: 1, justifyContent: messages.length === 0 ? 'center' : 'flex-end' }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {messages.length === 0 ? (
          <Txt variant="muted" style={{ textAlign: 'center' }}>Geen berichten. Start een gesprek!</Txt>
        ) : (
          messages.map((m, i) => {
            const mine = m.sentByUserId === me?.id
            const next = messages[i + 1]
            const prev = messages[i - 1]
            const lastInRun = !next || next.senderUsername !== m.senderUsername
            const firstInRun = !prev || prev.senderUsername !== m.senderUsername
            return (
              <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: firstInRun ? 8 : 0 }}>
                {!mine && isGroup && firstInRun && <Txt variant="smallMuted" style={{ marginBottom: 2 }}>{m.senderUsername}</Txt>}
                <View
                  style={{
                    maxWidth: '80%',
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: Radius.md,
                    backgroundColor: mine ? p.brand : p.surface3,
                  }}>
                  <Txt style={{ color: mine ? p.brandInk : p.ink }}>{m.content}</Txt>
                </View>
                {lastInRun && <Txt variant="smallMuted" style={{ marginTop: 2, fontSize: 11 }}>{fmtTimeIso(m.sentAtUtc)}</Txt>}
              </View>
            )
          })
        )}
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
          paddingHorizontal: 12,
          paddingTop: 10,
          paddingBottom: 10 + insets.bottom,
          borderTopWidth: 1,
          borderTopColor: p.border,
          backgroundColor: p.surface,
        }}>
        <Input
          style={{ flex: 1, maxHeight: 110 }}
          value={text}
          onChangeText={setText}
          placeholder="Typ een bericht..."
          maxLength={2000}
          multiline
          autoCapitalize="sentences"
          autoCorrect
        />
        <Btn variant="primary" label="Verstuur" disabled={busy || !text.trim()} onPress={() => void send()} />
      </View>

      {adding && (
        <Dialog title="Vrienden toevoegen" onClose={() => setAdding(false)}>
          <Label>Selecteer vrienden:</Label>
          {addable.length === 0 ? (
            <Txt variant="muted">Al je vrienden zitten al in deze groep.</Txt>
          ) : (
            addable.map((f) => {
              const on = selected.includes(f.id)
              return (
                <Pressable
                  key={f.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setSelected((s) => (on ? s.filter((x) => x !== f.id) : [...s, f.id]))}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 10,
                    borderRadius: Radius.sm,
                    borderWidth: 1.5,
                    borderColor: on ? p.brand : p.border,
                    backgroundColor: on ? p.brandSoft : p.surface2,
                  }}>
                  <Txt variant="strong" style={{ flex: 1 }}>{f.username}</Txt>
                  <Txt variant="smallMuted">{on ? 'Geselecteerd' : ''}</Txt>
                </Pressable>
              )
            })
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Btn label="Annuleren" onPress={() => setAdding(false)} />
            <Btn variant="primary" label={`Toevoegen (${selected.length})`} disabled={busy || selected.length === 0} onPress={() => void addMembers()} />
          </View>
        </Dialog>
      )}
    </KeyboardAvoidingView>
  )
}
