/* eslint-disable react-hooks/set-state-in-effect */
import { Link } from 'expo-router'
import * as Location from 'expo-location'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'

import { errorMessage } from '@/components/AuthForm'
import { FriendsMap } from '@/components/FriendsMap'
import { Avatar, Banner, Btn, Card, CardTitle, Input, Loading, PageHead, Screen, SwitchRow, Txt } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { api, ApiError } from '@/lib/api'
import { whenShort } from '@/lib/format'
import { friendStatus, pickAvatar } from '@/lib/friendsUi'
import type { Friend, FriendsOverview } from '@/lib/types'

export function FriendsScreen() {
  const { user: me, setUser, logout } = useAuth()
  const [overview, setOverview] = useState<FriendsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newFriend, setNewFriend] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    try {
      setOverview(await api.friends.overview())
    } catch (err) {
      // Een 401 meldt de gebruiker af via de AuthContext; hier blijft alleen de rest over.
      if (!(err instanceof ApiError && err.status === 401)) setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => {
      void load()
      setTick((n) => n + 1)
    }, 20_000)
    return () => clearInterval(t)
  }, [load])

  // Eigen locatie doorgeven, hoogstens om de 30 seconden, alleen als delen aanstaat.
  const lastSent = useRef(0)
  const share = me?.shareLocation ?? false
  useEffect(() => {
    if (!share) return
    let sub: Location.LocationSubscription | undefined
    let cancelled = false
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync()
        if (perm.status !== 'granted') throw new Error('denied')
        const s = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 15_000 }, (pos) => {
          if (Date.now() - lastSent.current < 30_000) return
          lastSent.current = Date.now()
          void api.friends.location(pos.coords.latitude, pos.coords.longitude).catch(() => undefined)
        })
        if (cancelled) s.remove()
        else sub = s
      } catch {
        if (!cancelled) setError('Je locatie kon niet bepaald worden. Controleer de toestemming van je toestel.')
      }
    })()
    return () => {
      cancelled = true
      sub?.remove()
    }
  }, [share])

  if (!me) return null

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null)
    setInfo(null)
    try {
      await action()
      if (done) setInfo(done)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function setting(b: Parameters<typeof api.friends.settings>[0]) {
    setError(null)
    try {
      setUser(await api.friends.settings(b))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function changeAvatar() {
    try {
      const avatar = await pickAvatar()
      if (avatar) await setting({ avatar })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const friends = overview?.friends ?? []
  const byId = new Map(friends.map((f) => [f.id, f]))

  return (
    <Screen>
      <PageHead
        title="Vrienden"
        subtitle="Waar je vrienden zijn en naar welke evenementen ze willen gaan."
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Avatar name={me.username} src={me.avatar} />
        <Txt variant="strong" style={{ flex: 1 }}>{me.username}</Txt>
        <Btn size="sm" label="Afmelden" onPress={() => void logout()} />
      </View>

      {error && <Banner>{error}</Banner>}
      {info && <Banner ok>{info}</Banner>}

      <Card>
        <CardTitle>Evenementen waar je vrienden naartoe willen</CardTitle>
        {!overview ? (
          <Loading />
        ) : overview.events.length === 0 ? (
          <Txt variant="muted">Nog geen interesses van je vrienden. Open een evenement en tik op “Ik ben geïnteresseerd”.</Txt>
        ) : (
          <View style={{ gap: 14 }}>
            {overview.events.map((e) => (
              <Link key={e.id} href={{ pathname: '/events/[id]', params: { id: e.id } }} asChild>
                <Pressable style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row' }}>
                    {e.friendIds.map((id) => byId.get(id)).filter((f): f is Friend => !!f).map((f, i) => (
                      <View key={f.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                        <Avatar name={f.username} src={f.avatar} size={34} />
                      </View>
                    ))}
                  </View>
                  <Txt variant="strong">{e.name}</Txt>
                  <Txt variant="smallMuted">
                    {e.startsAtUtc ? whenShort(new Date(e.startsAtUtc)) : e.dayTimeLabel}
                    {e.place ? ` · ${e.place}` : ''}
                  </Txt>
                </Pressable>
              </Link>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <CardTitle>Locaties</CardTitle>
        <FriendsMap friends={friends} />
        {friends.length === 0 && overview && <Txt variant="muted" style={{ marginTop: 10 }}>Je hebt nog geen vrienden toegevoegd.</Txt>}
        <View style={{ marginTop: 12, gap: 12 }}>
          {friends.map((f) => (
            <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar name={f.username} src={f.avatar} off={!f.online} />
              <View style={{ flex: 1 }}>
                <Txt variant="strong">{f.username}</Txt>
                <Txt variant="smallMuted">{friendStatus(f)}</Txt>
              </View>
              <Btn size="sm" variant="ghost" label="Verwijderen" onPress={() => void run(() => api.friends.remove(f.id))} />
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <CardTitle>Vriend toevoegen</CardTitle>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Input
            style={{ flex: 1 }}
            placeholder="Gebruikersnaam"
            value={newFriend}
            onChangeText={setNewFriend}
            maxLength={30}
            returnKeyType="send"
            onSubmitEditing={() => {
              const name = newFriend.trim()
              if (name) void run(() => api.friends.request(name), 'Verzoek verstuurd.').then(() => setNewFriend(''))
            }}
          />
          <Btn
            variant="primary"
            label="Verzoek sturen"
            onPress={() => {
              const name = newFriend.trim()
              if (name) void run(() => api.friends.request(name), 'Verzoek verstuurd.').then(() => setNewFriend(''))
            }}
          />
        </View>
        <View style={{ gap: 10, marginTop: 12 }}>
          {overview?.incoming.map((r) => (
            <View key={r.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Avatar name={r.username} src={r.avatar} />
                <Txt style={{ flex: 1 }}><Txt variant="strong">{r.username}</Txt> wil je vriend zijn</Txt>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn size="sm" variant="primary" label="Aanvaarden" onPress={() => void run(() => api.friends.accept(r.id))} />
                <Btn size="sm" label="Weigeren" onPress={() => void run(() => api.friends.remove(r.id))} />
              </View>
            </View>
          ))}
          {overview?.outgoing.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Avatar name={r.username} src={r.avatar} />
              <Txt variant="muted" style={{ flex: 1 }}>Verzoek aan <Txt variant="strong">{r.username}</Txt> staat open</Txt>
              <Btn size="sm" variant="ghost" label="Intrekken" onPress={() => void run(() => api.friends.remove(r.id))} />
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <CardTitle>Instellingen</CardTitle>
        <View style={{ gap: 14 }}>
          <SwitchRow label="Mijn locatie delen met vrienden" value={me.shareLocation} onValueChange={(v) => void setting({ shareLocation: v })} />
          <SwitchRow label="Vrienden tonen op de routekaart" value={me.showFriendsOnMap} onValueChange={(v) => void setting({ showFriendsOnMap: v })} />
          <Btn label="Profielfoto wijzigen" onPress={() => void changeAvatar()} style={{ alignSelf: 'flex-start' }} />
          {me.shareLocation && <Txt variant="smallMuted">Je locatie wordt doorgegeven zolang deze pagina openstaat.</Txt>}
        </View>
      </Card>
    </Screen>
  )
}
