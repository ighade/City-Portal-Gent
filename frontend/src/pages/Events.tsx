import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { GentEvent } from '../types'

const dateFmt = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short' })
const weekdayFmt = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'long' })
const timeFmt = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

type Filter = 'all' | 'week' | 'free'

function EventCard({ event }: { event: GentEvent }) {
  const [imageFailed, setImageFailed] = useState(false)
  const start = event.startsAtUtc ? new Date(event.startsAtUtc) : null
  const showImage = event.coverImageUrl && !imageFailed

  return (
    <Link className="card event-card" to={`/events/${encodeURIComponent(event.id)}`}>
      <div className="event-cover">
        {showImage ? (
          <img src={event.coverImageUrl!} alt={event.coverCaption ?? event.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        ) : (
          <div className="event-cover-fallback" aria-hidden="true">{event.name.slice(0, 1).toUpperCase()}</div>
        )}
        {start && (
          <div className="event-date">
            <b>{dateFmt.format(start).split(' ')[0]}</b>
            <span>{dateFmt.format(start).split(' ')[1]?.replace('.', '')}</span>
          </div>
        )}
        {event.isHappeningNow && <span className="event-live">Nu bezig</span>}
      </div>
      <div className="event-body">
        <h3>{event.name}</h3>
        {start && <p className="event-when">{weekdayFmt.format(start)} · {timeFmt.format(start)}</p>}
        {event.place && <p className="event-place">{event.place}</p>}
        <div className="event-foot">
          {event.socialSummary && <span>{event.socialSummary}</span>}
          {event.ticketPriceLabel && <span className="event-price">{event.ticketPriceLabel}</span>}
          {event.isOnline && <span className="event-price">Online</span>}
        </div>
      </div>
    </Link>
  )
}

export function Events() {
  const [events, setEvents] = useState<GentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    let cancelled = false
    api.events()
      .then((rows) => { if (!cancelled) setEvents(rows) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'De evenementen konden niet worden opgehaald.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const visible = useMemo(() => {
    const now = Date.now()
    const weekAhead = now + 7 * 24 * 3600 * 1000
    const q = query.trim().toLowerCase()
    return events.filter((e) => {
      const startedAt = e.startsAtUtc ? new Date(e.startsAtUtc).getTime() : null
      if (e.isPast || (!e.isHappeningNow && startedAt !== null && startedAt < now)) return false
      if (q && !`${e.name} ${e.place ?? ''}`.toLowerCase().includes(q)) return false
      if (filter === 'week') return e.startsAtUtc != null && new Date(e.startsAtUtc).getTime() <= weekAhead
      if (filter === 'free') return !e.ticketPriceLabel
      return true
    })
  }, [events, query, filter])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Evenementen in Gent</h1>
          <p>Wat er binnenkort te doen is. Kom je met de wagen? Check de bezetting van de parkings op de kaart.</p>
        </div>
        <div className="event-tools">
          <input className="input" type="search" placeholder="Zoek op naam of plaats" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="event-filters" role="group" aria-label="Filter">
            {([['all', 'Alles'], ['week', 'Komende 7 dagen'], ['free', 'Zonder ticketprijs']] as const).map(([key, label]) => (
              <button key={key} type="button" className={`btn btn-sm${filter === key ? ' btn-primary' : ''}`} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="empty">Even geduld…</div>
      ) : error ? (
        <div className="empty">{error}</div>
      ) : visible.length === 0 ? (
        <div className="empty">Geen evenementen gevonden.</div>
      ) : (
        <div className="event-grid">
          {visible.map((e) => <EventCard key={e.id} event={e} />)}
        </div>
      )}
    </>
  )
}
