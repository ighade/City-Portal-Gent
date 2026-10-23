import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { AdminEvent, ManualEventInput } from '../types'

const blank = {
  name: '',
  url: '',
  coverImageUrl: '',
  coverPhotoId: '',
  coverAccessibilityCaption: '',
  isOnline: false,
  isPast: false,
  isHappeningNow: false,
  startsAt: '',
  dayTimeLabel: '',
  placeName: '',
  kind: '',
  socialSummary: '',
  interestedCount: '',
  goingCount: '',
  wentCount: '',
  ticketPriceLabel: '',
  description: '',
}

type Form = typeof blank

const text = (value: string) => (value.trim() === '' ? null : value.trim())
const count = (value: string) => (value.trim() === '' ? null : Number(value))

function toInput(form: Form): ManualEventInput {
  return {
    name: form.name.trim(),
    url: text(form.url),
    coverImageUrl: text(form.coverImageUrl),
    coverPhotoId: text(form.coverPhotoId),
    coverAccessibilityCaption: text(form.coverAccessibilityCaption),
    isOnline: form.isOnline,
    isPast: form.isPast,
    isHappeningNow: form.isHappeningNow,
    startsAtUtc: form.startsAt ? new Date(form.startsAt).toISOString() : null,
    dayTimeLabel: text(form.dayTimeLabel),
    placeName: text(form.placeName),
    kind: text(form.kind),
    socialSummary: text(form.socialSummary),
    interestedCount: count(form.interestedCount),
    goingCount: count(form.goingCount),
    wentCount: count(form.wentCount),
    ticketPriceLabel: text(form.ticketPriceLabel),
    description: text(form.description),
  }
}

export function EventManagement() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Form>({ ...blank })
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(() => {
    api.admin
      .events()
      .then(setEvents)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Evenementen konden niet geladen worden.'))
  }, [])

  useEffect(load, [load])

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))

  const field = (key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="admin-field">
      <span>{label}</span>
      <input
        className="input"
        value={form[key] as string}
        onChange={(e) => set(key, e.target.value as Form[typeof key])}
        {...props}
      />
    </label>
  )

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const created = await api.admin.createEvent(toInput(form))
      setForm({ ...blank })
      setOpen(false)
      setMessage(`"${created.name}" is aan de catalogus toegevoegd.`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Het evenement kon niet toegevoegd worden.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: AdminEvent) {
    if (!window.confirm(`Evenement "${item.name}" verwijderen?`)) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api.admin.deleteEvent(item.id)
      setMessage(`"${item.name}" is verwijderd.`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Het evenement kon niet verwijderd worden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-title">
        <div>
          <h2>Evenementen</h2>
          <p className="small muted">Voeg zelf een evenement toe aan de catalogus. Het verschijnt meteen in Events.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Sluiten' : 'Evenement toevoegen'}
        </button>
      </div>

      {error && <p className="small note" role="alert">{error}</p>}
      {message && <p className="small note" role="status">{message}</p>}

      {open && (
        <form onSubmit={submit}>
          <div className="admin-grid">
            {field('name', 'Naam', { required: true, maxLength: 500 })}
            {field('placeName', 'Locatie (naam van de plaats)', { maxLength: 500 })}
            {field('startsAt', 'Start', { type: 'datetime-local' })}
            {field('dayTimeLabel', 'Tijdslabel (bv. "Za 25 okt, 20:00")', { maxLength: 100 })}
            {field('kind', 'Soort', { maxLength: 30 })}
            {field('ticketPriceLabel', 'Prijslabel (bv. "Gratis" of "€ 12")', { maxLength: 100 })}
            {field('url', 'Link naar het evenement', { type: 'url', maxLength: 500, placeholder: 'https://' })}
            {field('coverImageUrl', 'Link naar afbeelding', { type: 'url', maxLength: 2000, placeholder: 'https://' })}
            {field('coverPhotoId', 'Foto-id', { maxLength: 60 })}
            {field('coverAccessibilityCaption', 'Beschrijving van de afbeelding', { maxLength: 1000 })}
            {field('socialSummary', 'Sociale samenvatting', { maxLength: 200 })}
            {field('interestedCount', 'Geïnteresseerd', { type: 'number', min: 0, max: 100000000, step: 1 })}
            {field('goingCount', 'Gaan', { type: 'number', min: 0, max: 100000000, step: 1 })}
            {field('wentCount', 'Waren er', { type: 'number', min: 0, max: 100000000, step: 1 })}
          </div>
          <label className="admin-field">
            <span>Beschrijving</span>
            <textarea
              className="input"
              style={{ width: '100%' }}
              rows={5}
              maxLength={20000}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </label>
          <div className="admin-checks">
            <label><input type="checkbox" checked={form.isOnline} onChange={(e) => set('isOnline', e.target.checked)} /> Online evenement</label>
            <label><input type="checkbox" checked={form.isHappeningNow} disabled={form.isPast} onChange={(e) => set('isHappeningNow', e.target.checked)} /> Nu bezig</label>
            <label><input type="checkbox" checked={form.isPast} disabled={form.isHappeningNow} onChange={(e) => set('isPast', e.target.checked)} /> Voorbij</label>
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Toevoegen…' : 'Aan catalogus toevoegen'}</button>
        </form>
      )}

      {events.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="table">
            <thead><tr><th>Handmatig toegevoegd</th><th>Start</th><th>Locatie</th><th /></tr></thead>
            <tbody>
              {events.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.startsAtUtc ? new Date(item.startsAtUtc).toLocaleString('nl-BE') : '—'}</td>
                  <td>{item.place ?? '—'}</td>
                  <td className="num"><button className="btn btn-sm" disabled={busy} onClick={() => void remove(item)}>Verwijderen</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
