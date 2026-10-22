import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { FriendsMap } from '../components/FriendsMap'
import { friendStatus, initial, resizeAvatar } from '../friendsUi'
import type { Friend, FriendMe, FriendsOverview } from '../types'

const whenFmt = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Avatar({ name, src, size = 36, off = false }: { name: string; src?: string | null; size?: number; off?: boolean }) {
  return (
    <span className={`avatar${off ? ' avatar-off' : ''}`} style={{ width: size, height: size }} title={name}>
      {src ? <img src={src} alt={name} /> : <span>{initial(name)}</span>}
    </span>
  )
}

const message = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : 'Er ging iets mis.')

export function Vrienden() {
  const [me, setMe] = useState<FriendMe | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    api.friends.me()
      .then((s) => setMe(s.user))
      .catch(() => setMe(null))
      .finally(() => setChecked(true))
  }, [])

  if (!checked) return <div className="empty">Even geduld…</div>
  if (!me) return <AuthCard onDone={setMe} />
  return <Dashboard me={me} onMe={setMe} onLogout={() => setMe(null)} />
}

function AuthCard({ onDone }: { onDone: (me: FriendMe) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [avatar, setAvatar] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const s = mode === 'login'
        ? await api.friends.login(username, password)
        : await api.friends.register({ username, email, password, avatar })
      onDone(s.user)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return
    try {
      setAvatar(await resizeAvatar(file))
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <div className="card auth-card">
      <h1>Vrienden</h1>
      <p className="muted">Meld je aan om te zien waar je vrienden zijn en naar welke evenementen ze gaan.</p>
      <div className="seg" role="tablist">
        <button type="button" className={`btn btn-sm${mode === 'login' ? ' btn-primary' : ''}`} onClick={() => setMode('login')}>Aanmelden</button>
        <button type="button" className={`btn btn-sm${mode === 'register' ? ' btn-primary' : ''}`} onClick={() => setMode('register')}>Account maken</button>
      </div>
      <form onSubmit={submit} className="auth-form">
        <label>
          {mode === 'login' ? 'Gebruikersnaam of e-mail' : 'Gebruikersnaam'}
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required maxLength={200} />
        </label>
        {mode === 'register' && (
          <label>
            E-mail
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={200} />
          </label>
        )}
        <label>
          Wachtwoord
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : undefined} maxLength={200} />
        </label>
        {mode === 'register' && (
          <label>
            Profielfoto
            <span className="avatar-pick">
              <Avatar name={username || '?'} src={avatar} size={56} />
              <input type="file" accept="image/*" onChange={(e) => void pick(e.target.files?.[0])} />
            </span>
          </label>
        )}
        {error && <div className="banner" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{mode === 'login' ? 'Aanmelden' : 'Account maken'}</button>
      </form>
    </div>
  )
}

function Dashboard({ me, onMe, onLogout }: { me: FriendMe; onMe: (m: FriendMe) => void; onLogout: () => void }) {
  const [overview, setOverview] = useState<FriendsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newFriend, setNewFriend] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    try {
      setOverview(await api.friends.overview())
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout()
      else setError(message(err))
    }
  }, [onLogout])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => { void load(); setTick((n) => n + 1) }, 20_000)
    return () => window.clearInterval(t)
  }, [load])

  // Eigen locatie doorgeven, hoogstens om de 30 seconden, alleen als delen aanstaat.
  const lastSent = useRef(0)
  useEffect(() => {
    if (!me.shareLocation || !('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - lastSent.current < 30_000) return
        lastSent.current = Date.now()
        void api.friends.location(pos.coords.latitude, pos.coords.longitude).catch(() => undefined)
      },
      () => setError('Je locatie kon niet bepaald worden. Controleer de toestemming van je browser.'),
      { enableHighAccuracy: true, maximumAge: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [me.shareLocation])

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null)
    setInfo(null)
    try {
      await action()
      if (done) setInfo(done)
      await load()
    } catch (err) {
      setError(message(err))
    }
  }

  async function setting(b: Parameters<typeof api.friends.settings>[0]) {
    setError(null)
    try {
      onMe(await api.friends.settings(b))
    } catch (err) {
      setError(message(err))
    }
  }

  async function changeAvatar(file: File | undefined) {
    if (!file) return
    try {
      await setting({ avatar: await resizeAvatar(file) })
    } catch (err) {
      setError(message(err))
    }
  }

  async function logout() {
    await api.friends.logout().catch(() => undefined)
    onLogout()
  }

  const friends = overview?.friends ?? []
  const byId = new Map(friends.map((f) => [f.id, f]))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vrienden</h1>
          <p>Waar je vrienden zijn en naar welke evenementen ze willen gaan.</p>
        </div>
        <div className="friend-me">
          <Avatar name={me.username} src={me.avatar} />
          <strong>{me.username}</strong>
          <button className="btn btn-sm" onClick={() => void logout()}>Afmelden</button>
        </div>
      </div>

      {error && <div className="banner" role="alert">{error}</div>}
      {info && <div className="banner banner-ok" role="status">{info}</div>}

      <section className="card">
        <div className="card-title"><h2>Evenementen waar je vrienden naartoe willen</h2></div>
        {!overview ? <div className="empty">Even geduld…</div> : overview.events.length === 0 ? (
          <p className="muted">Nog geen interesses van je vrienden. Open een evenement en tik op “Ik ben geïnteresseerd”.</p>
        ) : (
          <div className="friend-events">
            {overview.events.map((e) => (
              <Link key={e.id} to={`/events/${encodeURIComponent(e.id)}`} className="friend-event">
                <div className="avatar-stack">
                  {e.friendIds.map((id) => byId.get(id)).filter((f): f is Friend => !!f).map((f) => (
                    <Avatar key={f.id} name={f.username} src={f.avatar} size={34} />
                  ))}
                </div>
                <strong>{e.name}</strong>
                <span className="muted small">
                  {e.startsAtUtc ? whenFmt.format(new Date(e.startsAtUtc)) : e.dayTimeLabel}
                  {e.place ? ` · ${e.place}` : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title"><h2>Locaties</h2></div>
        <FriendsMap friends={friends} />
        {friends.length === 0 && overview && <p className="muted">Je hebt nog geen vrienden toegevoegd.</p>}
        <ul className="friend-list">
          {friends.map((f) => (
            <li key={f.id}>
              <Avatar name={f.username} src={f.avatar} off={!f.online} />
              <div>
                <strong>{f.username}</strong>
                <div className="muted small">{friendStatus(f)}</div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={() => void run(() => api.friends.remove(f.id))}>Verwijderen</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-title"><h2>Vriend toevoegen</h2></div>
        <form
          className="friend-add"
          onSubmit={(e) => {
            e.preventDefault()
            const name = newFriend.trim()
            if (!name) return
            void run(() => api.friends.request(name), 'Verzoek verstuurd.').then(() => setNewFriend(''))
          }}
        >
          <input className="input" placeholder="Gebruikersnaam" value={newFriend} onChange={(e) => setNewFriend(e.target.value)} maxLength={30} />
          <button className="btn btn-primary">Verzoek sturen</button>
        </form>
        {overview?.incoming.map((p) => (
          <div key={p.id} className="friend-request">
            <Avatar name={p.username} src={p.avatar} />
            <strong>{p.username}</strong> wil je vriend zijn
            <button className="btn btn-sm btn-primary" onClick={() => void run(() => api.friends.accept(p.id))}>Aanvaarden</button>
            <button className="btn btn-sm" onClick={() => void run(() => api.friends.remove(p.id))}>Weigeren</button>
          </div>
        ))}
        {overview?.outgoing.map((p) => (
          <div key={p.id} className="friend-request muted">
            <Avatar name={p.username} src={p.avatar} />
            Verzoek aan <strong>{p.username}</strong> staat open
            <button className="btn btn-sm btn-ghost" onClick={() => void run(() => api.friends.remove(p.id))}>Intrekken</button>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-title"><h2>Instellingen</h2></div>
        <div className="friend-settings">
          <label className="toggle">
            <input type="checkbox" role="switch" checked={me.shareLocation} onChange={(e) => void setting({ shareLocation: e.target.checked })} />
            <span className="toggle-track" aria-hidden="true" />
            Mijn locatie delen met vrienden
          </label>
          <label className="toggle">
            <input type="checkbox" role="switch" checked={me.showFriendsOnMap} onChange={(e) => void setting({ showFriendsOnMap: e.target.checked })} />
            <span className="toggle-track" aria-hidden="true" />
            Vrienden tonen op de routekaart
          </label>
          <label className="avatar-pick">
            Profielfoto wijzigen
            <input type="file" accept="image/*" onChange={(e) => void changeAvatar(e.target.files?.[0])} />
          </label>
          {me.shareLocation && <p className="muted small">Je locatie wordt doorgegeven zolang deze pagina openstaat.</p>}
        </div>
      </section>
    </>
  )
}
