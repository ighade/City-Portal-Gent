import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useApp } from '../context/AppContext'
import { EventManagement } from './AdminEvents'
import type { AdminParking, ManualParkingRate, StreetTariffAdmin, SyncRun } from '../types'

type AmountField = 'weekdayHourlyEur' | 'daytimeMaximumEur' | 'nighttimeMaximumEur' | 'dailyMaximumEur' | 'weekendHourlyEur'
type TimeField = 'weekdayStart' | 'weekdayEnd' | 'daytimeStart' | 'daytimeEnd' | 'nighttimeStart' | 'nighttimeEnd'

const blankRate: ManualParkingRate = {
  weekdayHourlyEur: 0,
  weekdayStart: '07:00',
  weekdayEnd: '19:00',
  daytimeMaximumEur: null,
  daytimeStart: '07:00',
  daytimeEnd: '19:00',
  nighttimeMaximumEur: null,
  nighttimeStart: '19:00',
  nighttimeEnd: '07:00',
  dailyMaximumEur: null,
  weekendHourlyEur: 0,
}

function editRate(rate?: ManualParkingRate | null): ManualParkingRate {
  if (!rate) return { ...blankRate }
  return {
    ...rate,
    weekdayStart: rate.weekdayStart.slice(0, 5),
    weekdayEnd: rate.weekdayEnd.slice(0, 5),
    daytimeStart: rate.daytimeStart?.slice(0, 5) ?? '',
    daytimeEnd: rate.daytimeEnd?.slice(0, 5) ?? '',
    nighttimeStart: rate.nighttimeStart?.slice(0, 5) ?? '',
    nighttimeEnd: rate.nighttimeEnd?.slice(0, 5) ?? '',
  }
}

function requestRate(rate: ManualParkingRate): ManualParkingRate {
  const time = (value?: string | null) => value ? `${value.slice(0, 5)}:00` : null
  return {
    ...rate,
    weekdayStart: time(rate.weekdayStart)!,
    weekdayEnd: time(rate.weekdayEnd)!,
    daytimeStart: rate.daytimeMaximumEur == null ? null : time(rate.daytimeStart),
    daytimeEnd: rate.daytimeMaximumEur == null ? null : time(rate.daytimeEnd),
    nighttimeStart: rate.nighttimeMaximumEur == null ? null : time(rate.nighttimeStart),
    nighttimeEnd: rate.nighttimeMaximumEur == null ? null : time(rate.nighttimeEnd),
  }
}

function missingRateTime(rate: ManualParkingRate): string | null {
  if (!rate.weekdayStart || !rate.weekdayEnd) return 'Vul de begin- en eindtijd voor weekdagen in.'
  if (rate.daytimeMaximumEur != null && (!rate.daytimeStart || !rate.daytimeEnd)) {
    return 'Vul de begin- en eindtijd voor het dagmaximum in.'
  }
  if (rate.nighttimeMaximumEur != null && (!rate.nighttimeStart || !rate.nighttimeEnd)) {
    return 'Vul de begin- en eindtijd voor het nachtmaximum in.'
  }
  return null
}

/**
 * Beheer is pas bereikbaar nadat de ingelogde gebruiker als beheerder is bevestigd.
 */
export function Beheer() {
  const { refresh, meta, logoutAdmin } = useApp()
  const [runs, setRuns] = useState<SyncRun[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    api.admin
      .runs(50)
      .then(setRuns)
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : 'Ophaalrondes konden niet geladen worden.'))
  }, [])

  useEffect(load, [load])

  async function run(what: 'sync' | 'backfill') {
    setBusy(what)
    setNote(null)
    try {
      if (what === 'sync') {
        const r = await api.admin.sync()
        setNote(
          r.ok
            ? `Klaar in ${r.durationMs} ms: ${r.liveCount} metingen, ${r.catalogueCount} uit de catalogus, ${r.measurementsAdded} nieuw bewaard.`
            : `Mislukt: ${r.message ?? 'onbekende reden'}`,
        )
      } else {
        const r = await api.admin.backfill()
        setNote(`${r.added} historische metingen ingelezen.`)
      }
      load()
      await refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Onbekende fout')
    } finally {
      setBusy(null)
    }
  }

  async function logout() {
    try {
      await logoutAdmin()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Afmelden is niet gelukt.')
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Beheer</h1>
          <p>
            De ophaalronde loopt vanzelf om de {meta?.refreshMinutes ?? 5} minuten. Hier kan ze met de
            hand gestart worden, en staat wat er van de vorige rondes terechtkwam.
          </p>
        </div>
        <button className="btn" onClick={() => void logout()}>Afmelden</button>
      </div>

      <div className="card">
        <div className="row">
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => run('sync')}>
            {busy === 'sync' ? 'Bezig…' : 'Nu ophalen'}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => run('backfill')}>
            {busy === 'backfill' ? 'Bezig…' : 'Geschiedenis van de stad inlezen'}
          </button>
        </div>
        {note && <p className="small note">{note}</p>}
        <p className="small muted">
          "Geschiedenis inlezen" haalt de negen reeksen <code>recente-bezetting-parking-*</code> op —
          elk de laatste 180 metingen van de stad. Dat gebeurt automatisch bij het opstarten, en doet
          niets voor een parking die hier al metingen heeft.
        </p>
      </div>

      <PriceManagement />

      <EventManagement />

      <div className="card">
        <div className="card-title">
          <h2>Laatste ophaalrondes</h2>
          <button className="btn btn-sm btn-ghost" onClick={load}>
            Ververs
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Wanneer</th>
                <th>Aanleiding</th>
                <th className="num">Duur</th>
                <th className="num">Live</th>
                <th className="num">Catalogus</th>
                <th className="num">Nieuw</th>
                <th className="num">Opgeruimd</th>
                <th>Uitkomst</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Nog geen rondes.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.startedUtc}>
                  <td>{new Date(r.startedUtc).toLocaleString('nl-BE')}</td>
                  <td>{r.trigger}</td>
                  <td className="num">{r.durationMs} ms</td>
                  <td className="num">{r.liveCount}</td>
                  <td className="num">{r.catalogueCount}</td>
                  <td className="num">{r.measurementsAdded}</td>
                  <td className="num">{r.measurementsPruned || ''}</td>
                  <td>
                    {r.ok ? (
                      <span className="pill pill-green">gelukt</span>
                    ) : (
                      <span className="pill pill-red" title={r.message ?? ''}>
                        mislukt
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function PriceManagement() {
  const [section, setSection] = useState<'zones' | 'parkings'>('zones')
  const [tariffs, setTariffs] = useState<StreetTariffAdmin[]>([])
  const [parkings, setParkings] = useState<AdminParking[]>([])
  const [selectedSlug, setSelectedSlug] = useState('')
  const [rate, setRate] = useState<ManualParkingRate>({ ...blankRate })
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newRate, setNewRate] = useState<ManualParkingRate>({ ...blankRate })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadParkings = useCallback(async () => {
    const rows = await api.admin.parkings()
    setParkings(rows)
    return rows
  }, [])

  useEffect(() => {
    void Promise.all([api.admin.streetTariffs(), loadParkings()])
      .then(([street, rows]) => {
        setTariffs(street)
        if (rows[0]) {
          setSelectedSlug(rows[0].slug)
          setRate(editRate(rows[0].rate))
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Tarieven konden niet geladen worden.'))
      .finally(() => setLoading(false))
  }, [loadParkings])

  const selected = parkings.find((p) => p.slug === selectedSlug)

  async function saveStreetTariffs() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api.admin.updateStreetTariffs(tariffs)
      setMessage('De tarieven van de straatparkeerzones zijn opgeslagen.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'De zoneprijzen konden niet opgeslagen worden.')
    } finally {
      setBusy(false)
    }
  }

  async function saveParkingRate() {
    if (!selected) return
    const invalid = missingRateTime(rate)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api.admin.updateParkingRate(selected.slug, requestRate(rate))
      const rows = await loadParkings()
      setRate(editRate(rows.find((p) => p.slug === selected.slug)?.rate))
      setMessage(`Het tarief van ${selected.name} is opgeslagen.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Het parkeertarief kon niet opgeslagen worden.')
    } finally {
      setBusy(false)
    }
  }

  async function createParking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = missingRateTime(newRate)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const place = await api.geocode(`${newAddress}, Gent`)
      const created = await api.admin.createParking({
        name: newName.trim(),
        address: place.label,
        latitude: place.lat,
        longitude: place.lon,
        rate: requestRate(newRate),
      })
      const rows = await loadParkings()
      setSelectedSlug(created.slug)
      setRate(editRate(created.rate))
      setNewName('')
      setNewAddress('')
      setNewRate({ ...blankRate })
      setMessage(`${created.name} is toegevoegd. De locatie is op basis van het adres bepaald.`)
      if (rows.length === 0) setParkings([created])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'De parking kon niet toegevoegd worden.')
    } finally {
      setBusy(false)
    }
  }

  async function removeParking() {
    if (!selected) return
    const confirm = window.confirm(selected.isManual
      ? `Parking "${selected.name}" en het tarief verwijderen?`
      : `Het handmatige tarief van "${selected.name}" verwijderen?`)
    if (!confirm) return

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      if (selected.isManual) await api.admin.deleteParking(selected.slug)
      else await api.admin.deleteParkingRate(selected.slug)
      const rows = await loadParkings()
      const next = rows.find((p) => p.slug !== selected.slug)
      setSelectedSlug(next?.slug ?? '')
      setRate(editRate(next?.rate))
      setMessage(selected.isManual ? 'De handmatige parking is verwijderd.' : 'Het handmatige tarief is verwijderd.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'De verwijdering is mislukt.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-title">
        <div>
          <h2>Parkeertarieven</h2>
          <p className="small muted">Pas de straatzones aan of beheer tarieven voor parkings.</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Tariefbeheer">
          <button role="tab" aria-selected={section === 'zones'} className={section === 'zones' ? 'on' : ''} onClick={() => setSection('zones')}>Straatzones</button>
          <button role="tab" aria-selected={section === 'parkings'} className={section === 'parkings' ? 'on' : ''} onClick={() => setSection('parkings')}>Parkings</button>
        </div>
      </div>

      {loading && <p className="muted">Tarieven laden…</p>}
      {!loading && section === 'zones' && (
        <>
          <p className="small muted" style={{ marginBottom: 12 }}>
            De prijzen gelden per duur en tijdvak. De blauwe zone is gratis en heeft geen prijstabel.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Zone</th><th>Tijdvak</th><th>Duur</th><th className="num">Prijs</th></tr></thead>
              <tbody>
                {tariffs.map((item, index) => (
                  <tr key={`${item.zone}-${item.period}-${item.hours}`}>
                    <td>{zoneLabel[item.zone] ?? item.zone}</td>
                    <td>{item.period === 'dag' ? 'Overdag' : 'Avond'}</td>
                    <td>{item.hours === 0 ? '24 uur' : `${item.hours} ${item.hours === 1 ? 'uur' : 'uur'}`}</td>
                    <td className="num">
                      <label className="row" style={{ justifyContent: 'flex-end' }}>
                        <span>€</span>
                        <input className="input tariff-input" type="number" min="0" step="0.01"
                          aria-label={`${zoneLabel[item.zone] ?? item.zone}, ${item.period}, ${item.hours} uur`}
                          value={item.amountEur}
                          onChange={(e) => {
                            const amountEur = Number(e.target.value)
                            setTariffs((current) => current.map((r, i) => i === index ? { ...r, amountEur } : r))
                          }} />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy || tariffs.length === 0} onClick={saveStreetTariffs}>
            {busy ? 'Opslaan…' : 'Zoneprijzen opslaan'}
          </button>
        </>
      )}

      {!loading && section === 'parkings' && (
        <div style={{ display: 'grid', gap: 24 }}>
          <div>
            <label className="admin-field">
              <span>Parking</span>
              <select className="select" value={selectedSlug} onChange={(e) => {
                const parking = parkings.find((p) => p.slug === e.target.value)
                setSelectedSlug(e.target.value)
                setRate(editRate(parking?.rate))
              }}>
                <option value="">Kies een parking</option>
                {parkings.map((p) => <option key={p.slug} value={p.slug}>{p.name}{p.isManual ? ' · handmatig' : ''}</option>)}
              </select>
            </label>
            {selected && (
              <div className="admin-rate-editor">
                <p className="small muted">
                  {selected.address ?? 'Geen adres'} · {selected.isManual ? 'publieke, handmatig toegevoegde parking' : 'bestaande parking'}
                </p>
                <RateFields rate={rate} onAmount={(key, value) => setRate((r) => ({ ...r, [key]: value }))}
                  onTime={(key, value) => setRate((r) => ({ ...r, [key]: value }))} />
                <div className="row">
                  <button className="btn btn-primary" disabled={busy} onClick={saveParkingRate}>{busy ? 'Opslaan…' : 'Parkingtarief opslaan'}</button>
                  {selected.rate && <button className="btn" disabled={busy} onClick={removeParking}>{selected.isManual ? 'Parking verwijderen' : 'Tarief verwijderen'}</button>}
                </div>
              </div>
            )}
          </div>

          <div className="admin-add-parking">
            <h3>Nieuwe publieke parking</h3>
            <p className="small muted">Niet opgenomen in de stadsdata? Voeg haar toe met een adres in Gent; de kaartlocatie wordt automatisch bepaald. Bezetting blijft onbekend.</p>
            <form onSubmit={createParking}>
              <div className="admin-grid">
                <label className="admin-field"><span>Naam</span><input className="input" required maxLength={200} value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
                <label className="admin-field"><span>Adres in Gent</span><input className="input" required value={newAddress} onChange={(e) => setNewAddress(e.target.value)} /></label>
              </div>
              <RateFields rate={newRate} onAmount={(key, value) => setNewRate((r) => ({ ...r, [key]: value }))}
                onTime={(key, value) => setNewRate((r) => ({ ...r, [key]: value }))} />
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Toevoegen…' : 'Publieke parking toevoegen'}</button>
            </form>
          </div>
        </div>
      )}

      {error && <p className="small note" role="alert">{error}</p>}
      {message && <p className="small note" role="status">{message}</p>}
    </section>
  )
}

const zoneLabel: Record<string, string> = {
  rood: 'Rood',
  oranje: 'Oranje',
  geel: 'Geel',
  groen: 'Groen',
}

function RateFields({ rate, onAmount, onTime }: {
  rate: ManualParkingRate
  onAmount: (key: AmountField, value: number | null) => void
  onTime: (key: TimeField, value: string) => void
}) {
  const amountFields: Array<[AmountField, string, boolean]> = [
    ['weekdayHourlyEur', 'Weekdag — uurtarief', false],
    ['daytimeMaximumEur', 'Maximum overdag', true],
    ['nighttimeMaximumEur', 'Maximum ’s nachts', true],
    ['dailyMaximumEur', 'Maximum per 24 uur', true],
    ['weekendHourlyEur', 'Weekend — uurtarief', false],
  ]
  const timeFields: Array<[TimeField, string]> = [
    ['weekdayStart', 'Weekdag vanaf'],
    ['weekdayEnd', 'Weekdag tot'],
    ['daytimeStart', 'Overdag vanaf'],
    ['daytimeEnd', 'Overdag tot'],
    ['nighttimeStart', 'Nacht vanaf'],
    ['nighttimeEnd', 'Nacht tot'],
  ]

  return (
    <div className="admin-rate-editor">
      <div className="admin-grid">
        {amountFields.map(([key, label, optional]) => (
          <label className="admin-field" key={key}>
            <span>{label} (€{optional ? ', leeg = geen maximum' : ' per uur'})</span>
            <input className="input" type="number" min="0" max="9999.99" step="0.01"
              value={rate[key] ?? ''} onChange={(e) => onAmount(key, e.target.value === '' && optional ? null : Number(e.target.value))} />
          </label>
        ))}
        {timeFields.map(([key, label]) => (
          <label className="admin-field" key={key}>
            <span>{label}</span>
            <input className="input" type="time" required={key === 'weekdayStart' || key === 'weekdayEnd'}
              value={rate[key]?.slice(0, 5) ?? ''} onChange={(e) => onTime(key, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  )
}
