import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { activeRateText } from '../components/RateInfo'
import type { AdminParking, ManualParkingRate, StreetTariffAdmin } from '../types'

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

const zoneLabel: Record<string, string> = { rood: 'Rood', oranje: 'Oranje', geel: 'Geel', groen: 'Groen' }

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

const euro = (n: number) => `€${n.toFixed(2).replace('.', ',')}`

export function AdminPrices() {
  const [tariffs, setTariffs] = useState<StreetTariffAdmin[]>([])
  const [parkings, setParkings] = useState<AdminParking[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [rate, setRate] = useState<ManualParkingRate>({ ...blankRate })
  const [adding, setAdding] = useState(false)
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
      .then(([street]) => setTariffs(street))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Tarieven konden niet geladen worden.'))
      .finally(() => setLoading(false))
  }, [loadParkings])

  const zones = useMemo(() => {
    const map = new Map<string, Array<{ item: StreetTariffAdmin; index: number }>>()
    tariffs.forEach((item, index) => map.set(item.zone, [...(map.get(item.zone) ?? []), { item, index }]))
    return [...map.entries()]
  }, [tariffs])

  const visible = parkings.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  const saveZones = () => run(async () => {
    await api.admin.updateStreetTariffs(tariffs)
    setMessage('De zoneprijzen zijn opgeslagen.')
  }, 'De zoneprijzen konden niet opgeslagen worden.')

  function startEdit(p: AdminParking) {
    setEditing(editing === p.slug ? null : p.slug)
    setRate(editRate(p.rate))
  }

  async function saveRate(p: AdminParking) {
    const invalid = missingRateTime(rate)
    if (invalid) return setError(invalid)
    await run(async () => {
      await api.admin.updateParkingRate(p.slug, requestRate(rate))
      await loadParkings()
      setEditing(null)
      setMessage(`Het tarief van ${p.name} is opgeslagen.`)
    }, 'Het tarief kon niet opgeslagen worden.')
  }

  async function remove(p: AdminParking) {
    const ok = window.confirm(p.isManual
      ? `Parking "${p.name}" en het tarief verwijderen?`
      : `Het handmatige tarief van "${p.name}" verwijderen?`)
    if (!ok) return
    await run(async () => {
      if (p.isManual) await api.admin.deleteParking(p.slug)
      else await api.admin.deleteParkingRate(p.slug)
      await loadParkings()
      setEditing(null)
      setMessage(p.isManual ? 'De parking is verwijderd.' : 'Het tarief is verwijderd.')
    }, 'De verwijdering is mislukt.')
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = missingRateTime(newRate)
    if (invalid) return setError(invalid)
    await run(async () => {
      const place = await api.geocode(`${newAddress}, Gent`)
      const created = await api.admin.createParking({
        name: newName.trim(),
        address: place.label,
        latitude: place.lat,
        longitude: place.lon,
        rate: requestRate(newRate),
      })
      await loadParkings()
      setNewName('')
      setNewAddress('')
      setNewRate({ ...blankRate })
      setAdding(false)
      setMessage(`${created.name} is toegevoegd.`)
    }, 'De parking kon niet toegevoegd worden.')
  }

  if (loading) return <p className="muted">Tarieven laden…</p>

  return (
    <>
      <section className="card">
        <div className="card-title">
          <div>
            <h2>Straatzones</h2>
            <p className="small muted">Prijs per duur en tijdvak. De blauwe zone is gratis.</p>
          </div>
          <button className="btn btn-primary" disabled={busy || tariffs.length === 0} onClick={saveZones}>Opslaan</button>
        </div>
        <div className="admin-zones">
          {zones.map(([zone, rows]) => (
            <div className="admin-zone" key={zone}>
              <h3>{zoneLabel[zone] ?? zone}</h3>
              {rows.map(({ item, index }) => (
                <label className="admin-zone-row" key={`${item.period}-${item.hours}`}>
                  <span>{item.period === 'dag' ? 'Overdag' : 'Avond'} · {item.hours === 0 ? '24 u' : `${item.hours} u`}</span>
                  <input className="input tariff-input" type="number" min="0" step="0.01" value={item.amountEur}
                    aria-label={`${zoneLabel[zone] ?? zone}, ${item.period}, ${item.hours} uur`}
                    onChange={(e) => {
                      const amountEur = Number(e.target.value)
                      setTariffs((cur) => cur.map((r, i) => i === index ? { ...r, amountEur } : r))
                    }} />
                </label>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h2>Parkings</h2>
          <div className="row">
            <input className="input" type="search" placeholder="Zoek een parking" aria-label="Zoek een parking"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="btn" onClick={() => setAdding(!adding)}>{adding ? 'Annuleer' : 'Nieuwe parking'}</button>
          </div>
        </div>

        {adding && (
          <form className="admin-add-parking" onSubmit={create}>
            <p className="small muted">De kaartlocatie wordt bepaald op basis van het adres. Bezetting blijft onbekend.</p>
            <div className="admin-grid">
              <label className="admin-field"><span>Naam</span><input className="input" required maxLength={200} value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
              <label className="admin-field"><span>Adres in Gent</span><input className="input" required value={newAddress} onChange={(e) => setNewAddress(e.target.value)} /></label>
            </div>
            <RateFields rate={newRate} onAmount={(k, v) => setNewRate((r) => ({ ...r, [k]: v }))} onTime={(k, v) => setNewRate((r) => ({ ...r, [k]: v }))} />
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Toevoegen…' : 'Toevoegen'}</button>
          </form>
        )}

        <ul className="admin-list">
          {visible.length === 0 && <li className="muted">Geen parkings gevonden.</li>}
          {visible.map((p) => (
            <li key={p.slug} className="admin-parking">
              <div className="admin-parking-row">
                <div>
                  <strong>{p.name}</strong>
                  {p.isManual && <span className="pill pill-grey" style={{ marginLeft: 8 }}>handmatig</span>}
                  <div className="small muted">
                    {p.rate
                      ? `${euro(p.rate.weekdayHourlyEur)}/u weekdag · ${euro(p.rate.weekendHourlyEur)}/u weekend`
                      : p.cityRate ? `Tarief nu: ${activeRateText(p.cityRate)}` : 'Geen tarief bekend'}
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => startEdit(p)}>{editing === p.slug ? 'Sluit' : 'Bewerk'}</button>
              </div>
              {editing === p.slug && (
                <div>
                  <RateFields rate={rate} onAmount={(k, v) => setRate((r) => ({ ...r, [k]: v }))} onTime={(k, v) => setRate((r) => ({ ...r, [k]: v }))} />
                  <div className="row">
                    <button className="btn btn-primary" disabled={busy} onClick={() => void saveRate(p)}>Opslaan</button>
                    {p.rate && <button className="btn" disabled={busy} onClick={() => void remove(p)}>{p.isManual ? 'Parking verwijderen' : 'Tarief verwijderen'}</button>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="small note" role="alert">{error}</p>}
        {message && <p className="small note" role="status">{message}</p>}
      </section>
    </>
  )
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
