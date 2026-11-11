import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { Museum } from '../types'

type Form = {
  id: string
  name: string
  lat: string
  lon: string
  hours: string
  website: string
  wikidataId: string
  featuredObjectId: string
  collectionSummary: string
}

const blank: Form = { id: '', name: '', lat: '', lon: '', hours: '', website: '', wikidataId: '', featuredObjectId: '', collectionSummary: '' }

function toForm(museum: Museum): Form {
  return {
    ...museum,
    lat: String(museum.lat),
    lon: String(museum.lon),
    wikidataId: museum.wikidataId ?? '',
    featuredObjectId: museum.featuredObjectId ?? '',
    collectionSummary: museum.collectionSummary ?? '',
  }
}

export function MuseumManagement() {
  const [museums, setMuseums] = useState<Museum[]>([])
  const [form, setForm] = useState<Form>(blank)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setMuseums(await api.admin.museums()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Musea konden niet worden geladen.') }
  }, [])
  useEffect(() => { void load() }, [load])

  function field(key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) {
    return <label className="admin-field"><span>{label}</span>
      <input className="input" value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...props} />
    </label>
  }

  function start(museum?: Museum) {
    setForm(museum ? toForm(museum) : blank)
    setEditing(museum?.id ?? null)
    setOpen(true)
    setError(null)
    setMessage(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    const museum: Museum = {
      ...form,
      lat: Number(form.lat),
      lon: Number(form.lon),
      wikidataId: form.wikidataId.trim() || undefined,
      featuredObjectId: form.featuredObjectId.trim() || undefined,
      collectionSummary: form.collectionSummary.trim() || undefined,
    }
    try {
      if (editing) await api.admin.updateMuseum(museum)
      else await api.admin.createMuseum(museum)
      setOpen(false)
      setMessage(`"${museum.name}" is opgeslagen.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Het museum kon niet worden opgeslagen.')
    } finally { setBusy(false) }
  }

  async function remove(museum: Museum) {
    if (!window.confirm(`Museum "${museum.name}" verwijderen?`)) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api.admin.deleteMuseum(museum.id)
      if (editing === museum.id) setOpen(false)
      setMessage(`"${museum.name}" is verwijderd.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Het museum kon niet worden verwijderd.')
    } finally { setBusy(false) }
  }

  return <section className="card">
    <div className="card-title">
      <div><h2>Musea</h2><p className="small muted">Beheer de museumspelden en hun collectiegegevens op de routekaart.</p></div>
      <button type="button" className="btn btn-primary" onClick={() => start()}>Museum toevoegen</button>
    </div>
    {error && <p className="small note" role="alert">{error}</p>}
    {message && <p className="small note" role="status">{message}</p>}
    {open && <form onSubmit={submit}>
      <div className="admin-grid">
        {field('id', 'Sleutel (kleine letters, cijfers en koppeltekens)', { required: true, maxLength: 80, pattern: '[a-z0-9]+(-[a-z0-9]+)*', disabled: editing !== null })}
        {field('name', 'Naam', { required: true, maxLength: 200 })}
        {field('lat', 'Breedtegraad', { type: 'number', required: true, min: -90, max: 90, step: 'any' })}
        {field('lon', 'Lengtegraad', { type: 'number', required: true, min: -180, max: 180, step: 'any' })}
        {field('website', 'Museumwebsite (HTTPS)', { type: 'url', required: true, maxLength: 500, pattern: 'https://.+' })}
        {field('wikidataId', 'Wikidata-ID van het museum (bv. Q123)', { maxLength: 20, pattern: 'Q[1-9][0-9]*' })}
        {field('featuredObjectId', 'Wikidata-ID van een collectieobject (optioneel)', { maxLength: 20, pattern: 'Q[1-9][0-9]*' })}
      </div>
      <label className="admin-field"><span>Openingsinformatie</span><textarea className="input" rows={3} required maxLength={2000} value={form.hours} onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} /></label>
      <label className="admin-field"><span>Korte collectiebeschrijving (optioneel)</span><textarea className="input" rows={3} maxLength={2000} value={form.collectionSummary} onChange={(e) => setForm((f) => ({ ...f, collectionSummary: e.target.value }))} /></label>
      <p className="small muted">Een collectieobject wordt alleen getoond als Wikidata het object aan dit museum koppelt en een afbeelding heeft.</p>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Opslaan…' : 'Opslaan'}</button>{' '}
      <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>Annuleren</button>
    </form>}
    <div className="table-wrap" style={{ marginTop: 16 }}>
      <table className="table"><thead><tr><th>Naam</th><th>Sleutel</th><th>Coördinaten</th><th /></tr></thead>
        <tbody>{museums.map((museum) => <tr key={museum.id}>
          <td>{museum.name}</td><td>{museum.id}</td><td>{museum.lat}, {museum.lon}</td>
          <td className="num"><button type="button" className="btn btn-sm" disabled={busy} onClick={() => start(museum)}>Bewerken</button>{' '}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void remove(museum)}>Verwijderen</button></td>
        </tr>)}</tbody>
      </table>
      {museums.length === 0 && <p className="small muted">Geen musea aanwezig.</p>}
    </div>
  </section>
}
