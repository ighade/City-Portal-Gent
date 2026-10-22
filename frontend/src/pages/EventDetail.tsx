import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import type { GentEventDetail } from '../types'

const dateFmt = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })

const URL_RE = /https?:\/\/[^\s<>"']+/g
const TICKET_RE = /ticket|eventbrite|patronbase|paylogic|eventix|xceed|\bra\.co|tix|kaartje|billet/i

// Facebook verpakt links soms in een doorverwijzing (l.facebook.com/l.php?u=...).
function clean(raw: string): string {
  const url = raw.replace(/[).,;:!?]+$/, '')
  try {
    const u = new URL(url)
    if (/(^|\.)facebook\.com$/.test(u.hostname) && u.pathname === '/l.php') return u.searchParams.get('u') ?? url
  } catch {
    // geen geldige URL; laat staan
  }
  return url
}

function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    out.push(text.slice(last, start))
    const href = clean(m[0])
    out.push(<a key={start} href={href} target="_blank" rel="noreferrer noopener">{href}</a>)
    last = start + m[0].replace(/[).,;:!?]+$/, '').length
  }
  out.push(text.slice(last))
  return out.map((n, i) => <Fragment key={i}>{n}</Fragment>)
}

function ticketLinks(description: string | null | undefined): string[] {
  const urls = (description?.match(URL_RE) ?? []).map(clean)
  return [...new Set(urls.filter((u) => TICKET_RE.test(u)))]
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function EventDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<GentEventDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  // null = niet aangemeld bij de vriendenservice: dan tonen we geen knop.
  const [interested, setInterested] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    api.friends.me()
      .then((s) => { if (!cancelled) setInterested(s.interests.includes(id)) })
      .catch(() => { if (!cancelled) setInterested(null) })
    return () => { cancelled = true }
  }, [id])

  async function toggleInterest() {
    if (interested === null) return
    const next = !interested
    setInterested(next)
    try {
      await api.friends.interest(id, next)
    } catch {
      setInterested(!next)
    }
  }

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    api.event(id)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError && err.status === 404 ? 'Dit evenement bestaat niet (meer).' : 'Het evenement kon niet worden opgehaald.')
      })
    return () => { cancelled = true }
  }, [id])

  const tickets = useMemo(() => ticketLinks(data?.description), [data])

  if (error) return <div className="empty">{error} <Link to="/events">Terug naar alle evenementen</Link></div>
  if (!data) return <div className="empty">Even geduld…</div>

  const { event, description } = data
  const start = event.startsAtUtc ? new Date(event.startsAtUtc) : null
  const canRoute = !event.isOnline && !!event.place

  return (
    <>
      <Link className="back" to="/events">← Alle evenementen</Link>
      <article className="event-detail card">
        {event.coverImageUrl && !imageFailed && (
          <img
            className="event-detail-cover"
            src={event.coverImageUrl}
            alt={event.coverCaption ?? event.name}
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        )}
        <div className="event-detail-body">
          <h1>{event.name}</h1>
          <div className="event-detail-meta">
            {start && <p className="event-when">{dateFmt.format(start)} · {timeFmt.format(start)}</p>}
            {event.isHappeningNow && <span className="event-live-inline">Nu bezig</span>}
            {event.place && <p className="event-place">{event.place}</p>}
            {event.isOnline && <p className="event-place">Online evenement</p>}
            <div className="event-foot">
              {event.ticketPriceLabel && <span className="event-price">{event.ticketPriceLabel}</span>}
              {event.socialSummary && <span>{event.socialSummary}</span>}
            </div>
          </div>

          <div className="event-actions">
            {tickets.map((url) => (
              <a key={url} className="btn btn-primary" href={url} target="_blank" rel="noreferrer noopener">
                Tickets kopen <small>({host(url)})</small>
              </a>
            ))}
            {interested !== null && (
              <button type="button" className={`btn${interested ? ' btn-primary' : ''}`} onClick={toggleInterest} aria-pressed={interested}>
                {interested ? '★ Geïnteresseerd' : '☆ Ik ben geïnteresseerd'}
              </button>
            )}
            {canRoute && (
              <button
                type="button"
                className={`btn${tickets.length === 0 ? ' btn-primary' : ''}`}
                onClick={() => navigate('/route', { state: { destination: { place: event.place, name: event.name } } })}
              >
                Route naar dit evenement
              </button>
            )}
            <a className="btn" href={event.url} target="_blank" rel="noreferrer noopener">Bekijk op Facebook</a>
          </div>
          {tickets.length === 0 && description && (
            <p className="muted small">In de beschrijving staat geen ticketlink.</p>
          )}

          {description ? (
            <div className="event-description">{linkify(description)}</div>
          ) : (
            <p className="muted">Geen beschrijving beschikbaar.</p>
          )}
        </div>
      </article>
    </>
  )
}
