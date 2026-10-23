import { useState } from 'react'
import { useApp } from '../context/AppContext'

export function AdminLogin() {
  const { loginAdmin } = useApp()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await loginAdmin(email, password)
      setPassword('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aanmelden is niet gelukt.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card admin-login">
      <h1>Aanmelden als beheerder</h1>
      <p className="muted">Gebruik het beheerdersadres dat door de server is toegestaan.</p>
      <form onSubmit={submit}>
        <label className="admin-field">
          <span>E-mailadres</span>
          <input
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="admin-field">
          <span>Wachtwoord</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="small note" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Aanmelden…' : 'Aanmelden'}
        </button>
      </form>
    </section>
  )
}
