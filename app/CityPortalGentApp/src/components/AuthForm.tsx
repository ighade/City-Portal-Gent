import { useState } from 'react'
import { View } from 'react-native'

import { Avatar, Banner, Btn, Card, Input, Label, Txt } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/lib/api'
import { pickAvatar } from '@/lib/friendsUi'

export const errorMessage = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : 'Er ging iets mis.')

/** Aanmelden of een account maken bij de vriendenservice. */
export function AuthForm({ title = 'Vrienden' }: { title?: string }) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [avatar, setAvatar] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!username.trim() || !password || (mode === 'register' && !email.trim())) {
      setError('Vul alle velden in.')
      return
    }
    if (mode === 'register' && password.length < 8) {
      setError('Het wachtwoord moet minstens 8 tekens hebben.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') await login(username, password)
      else await register({ username, email, password, avatar })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function choose() {
    try {
      const picked = await pickAvatar()
      if (picked) setAvatar(picked)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Card>
      <Txt variant="h1">{title}</Txt>
      <Txt variant="muted" style={{ marginBottom: 12 }}>Meld je aan om te zien waar je vrienden zijn en naar welke evenementen ze gaan.</Txt>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        <Btn size="sm" label="Aanmelden" variant={mode === 'login' ? 'primary' : 'default'} onPress={() => setMode('login')} />
        <Btn size="sm" label="Account maken" variant={mode === 'register' ? 'primary' : 'default'} onPress={() => setMode('register')} />
      </View>

      <View style={{ gap: 12 }}>
        <View>
          <Label>{mode === 'login' ? 'Gebruikersnaam of e-mail' : 'Gebruikersnaam'}</Label>
          <Input value={username} onChangeText={setUsername} autoComplete="username" textContentType="username" maxLength={200} />
        </View>
        {mode === 'register' && (
          <View>
            <Label>E-mail</Label>
            <Input value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" maxLength={200} />
          </View>
        )}
        <View>
          <Label>Wachtwoord</Label>
          <Input
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            textContentType={mode === 'login' ? 'password' : 'newPassword'}
            maxLength={200}
            onSubmitEditing={() => void submit()}
          />
        </View>
        {mode === 'register' && (
          <View>
            <Label>Profielfoto</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={username || '?'} src={avatar} size={56} />
              <Btn label={avatar ? 'Andere foto kiezen' : 'Foto kiezen'} onPress={() => void choose()} />
            </View>
          </View>
        )}
        {error && <Banner style={{ marginBottom: 0 }}>{error}</Banner>}
        <Btn variant="primary" disabled={busy} label={mode === 'login' ? 'Aanmelden' : 'Account maken'} onPress={() => void submit()} />
      </View>
    </Card>
  )
}
