import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { FriendsMap } from '../components/FriendsMap'
import { Chat } from '../components/Chat'
import { friendStatus, initial, resizeAvatar } from '../friendsUi'
import type { Friend, FriendMe, FriendsOverview } from '../types'
import './Vrienden.css'

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
  const [activeTab, setActiveTab] = useState<'chats' | 'vrienden' | 'evenementen' | 'instellingen'>('vrienden')

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

  return (
    <div className="vrienden-dashboard">
      {/* Header */}
      <header className="vrienden-header">
        <div className="vrienden-header-content">
          <div className="vrienden-header-left">
            <h1>Vrienden</h1>
            <p>Verbind met vrienden, deel evenementen en houd hun locatie bij</p>
          </div>
          <div className="vrienden-header-right">
            <div className="user-profile">
              <Avatar name={me.username} src={me.avatar} size={40} />
              <div className="user-info">
                <strong>{me.username}</strong>
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => void logout()} title="Afmelden">🚪</button>
          </div>
        </div>

        {/* Tabs */}
        <nav className="vrienden-tabs">
          <button 
            className={`tab${activeTab === 'vrienden' ? ' tab-active' : ''}`}
            onClick={() => setActiveTab('vrienden')}
          >
            👥 Vrienden
          </button>
          <button 
            className={`tab${activeTab === 'evenementen' ? ' tab-active' : ''}`}
            onClick={() => setActiveTab('evenementen')}
          >
            📅 Evenementen
          </button>
          <button 
            className={`tab${activeTab === 'instellingen' ? ' tab-active' : ''}`}
            onClick={() => setActiveTab('instellingen')}
          >
            ⚙️ Instellingen
          </button>
        </nav>
      </header>

      {/* Messages */}
      {error && <div className="banner" role="alert">{error}</div>}
      {info && <div className="banner banner-ok" role="status">{info}</div>}

      {/* Content */}
      <main className="vrienden-main">
        {/* Left Panel - Content */}
        <div className="vrienden-left-panel">
          {/* Vrienden Tab */}
          {activeTab === 'vrienden' && (
            <div className="tab-content">
              <section className="vrienden-section">
                <div className="section-header">
                  <h2>Locaties van vrienden</h2>
                </div>
                <div className="friends-map-wrapper">
                  {!overview ? <div className="empty">Even geduld…</div> : (
                    <FriendsMap friends={overview.friends} />
                  )}
                </div>
                
                <div className="friends-list-section">
                  {overview?.friends.length === 0 ? (
                    <p className="muted text-center">Je hebt nog geen vrienden toegevoegd.</p>
                  ) : (
                    <>
                      <div className="friends-list-header">
                        <h3>Jouw vrienden ({overview?.friends.length ?? 0})</h3>
                      </div>
                      <ul className="friends-list">
                        {overview?.friends.map((f) => (
                          <li key={f.id} className="friend-item">
                            <Avatar name={f.username} src={f.avatar} size={40} off={!f.online} />
                            <div className="friend-details">
                              <strong>{f.username}</strong>
                              <div className="friend-status">{friendStatus(f)}</div>
                            </div>
                            <button className="btn btn-sm btn-icon" onClick={() => void run(() => api.friends.remove(f.id))} title="Verwijderen">✕</button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                <div className="add-friend-section">
                  <h3>Voeg vrienden toe</h3>
                  <form
                    className="friend-add-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const name = newFriend.trim()
                      if (!name) return
                      void run(() => api.friends.request(name), 'Verzoek verstuurd.').then(() => setNewFriend(''))
                    }}
                  >
                    <input className="input" placeholder="Voer gebruikersnaam in" value={newFriend} onChange={(e) => setNewFriend(e.target.value)} maxLength={30} />
                    <button className="btn btn-primary">Verzoek sturen</button>
                  </form>

                  {(overview?.incoming.length ?? 0) > 0 && (
                    <div className="friend-requests-section">
                      <h4>Verzoeken ontvangen</h4>
                      {overview?.incoming.map((p) => (
                        <div key={p.id} className="friend-request incoming">
                          <Avatar name={p.username} src={p.avatar} size={36} />
                          <div className="request-info">
                            <strong>{p.username}</strong>
                            <span className="text-small muted">wil je vriend zijn</span>
                          </div>
                          <div className="request-actions">
                            <button className="btn btn-sm btn-primary" onClick={() => void run(() => api.friends.accept(p.id))}>✓</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => void run(() => api.friends.remove(p.id))}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(overview?.outgoing.length ?? 0) > 0 && (
                    <div className="friend-requests-section">
                      <h4>Openstaande verzoeken</h4>
                      {overview?.outgoing.map((p) => (
                        <div key={p.id} className="friend-request outgoing">
                          <Avatar name={p.username} src={p.avatar} size={36} />
                          <div className="request-info">
                            <span className="text-small muted">Verzoek aan</span>
                            <strong>{p.username}</strong>
                          </div>
                          <button className="btn btn-sm btn-ghost" onClick={() => void run(() => api.friends.remove(p.id))}>Intrekken</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* Evenementen Tab */}
          {activeTab === 'evenementen' && (
            <div className="tab-content">
              <section className="vrienden-section">
                <div className="section-header">
                  <h2>Evenementen van vrienden</h2>
                </div>
                {!overview ? (
                  <div className="empty">Even geduld…</div>
                ) : overview.events.length === 0 ? (
                  <p className="muted text-center">Nog geen interesses van je vrienden. Open een evenement en tik op "Ik ben geïnteresseerd".</p>
                ) : (
                  <div className="events-grid">
                    {overview.events.map((e) => {
                      const byId = new Map(overview.friends.map((f) => [f.id, f]))
                      return (
                        <Link key={e.id} to={`/events/${encodeURIComponent(e.id)}`} className="event-card">
                          <div className="event-header">
                            <strong>{e.name}</strong>
                          </div>
                          <div className="event-details">
                            <span className="event-when">
                              {e.startsAtUtc ? whenFmt.format(new Date(e.startsAtUtc)) : e.dayTimeLabel}
                            </span>
                            {e.place && <span className="event-place">{e.place}</span>}
                          </div>
                          <div className="event-avatars">
                            <span className="avatar-stack">
                              {e.friendIds.map((id) => byId.get(id)).filter((f): f is Friend => !!f).map((f) => (
                                <Avatar key={f.id} name={f.username} src={f.avatar} size={32} />
                              ))}
                            </span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Instellingen Tab */}
          {activeTab === 'instellingen' && (
            <div className="tab-content">
              <section className="vrienden-section">
                <div className="section-header">
                  <h2>Profiel instellingen</h2>
                </div>

                <div className="settings-group">
                  <h3>Profielfoto</h3>
                  <div className="profile-photo-section">
                    <Avatar name={me.username} src={me.avatar} size={80} />
                    <label className="btn btn-primary btn-sm">
                      Foto wijzigen
                      <input type="file" accept="image/*" onChange={(e) => void changeAvatar(e.target.files?.[0])} style={{ display: 'none' }} />
                    </label>
                  </div>
                </div>

                <div className="settings-group">
                  <h3>Privacy & delen</h3>
                  <label className="toggle-label">
                    <input type="checkbox" role="switch" checked={me.shareLocation} onChange={(e) => void setting({ shareLocation: e.target.checked })} />
                    <span className="toggle-track" aria-hidden="true" />
                    <div>
                      <strong>Locatie delen</strong>
                      <p className="muted">Vrienden kunnen je locatie zien op de kaart</p>
                    </div>
                  </label>
                  <label className="toggle-label">
                    <input type="checkbox" role="switch" checked={me.showFriendsOnMap} onChange={(e) => void setting({ showFriendsOnMap: e.target.checked })} />
                    <span className="toggle-track" aria-hidden="true" />
                    <div>
                      <strong>Vrienden op routekaart</strong>
                      <p className="muted">Toon locaties van vrienden op je routeplan</p>
                    </div>
                  </label>
                </div>

                {me.shareLocation && (
                  <div className="info-box">
                    <span>ℹ️</span> Je locatie wordt doorgegeven zolang deze pagina openstaat.
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        {/* Right Panel - Chat */}
        <aside className="vrienden-chat-panel">
          <Chat me={me} onClose={() => {}} />
        </aside>
      </main>
    </div>
  )
}
