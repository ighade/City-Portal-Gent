import L from '../leaflet'
import { api } from '../api'
import type { Museum, MuseumCollection } from '../types'

const icon = L.divIcon({
  className: '',
  html: '<span class="museum-pin" aria-hidden="true"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18L12 3 3 9ZM4 21h16M6 9v9m4-9v9m4-9v9m4-9v9M3 18h18"/></svg></span>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16],
})

function popupContent(museum: Museum) {
  const root = document.createElement('div')
  root.className = 'museum-popup-content'
  const heading = document.createElement('strong')
  heading.textContent = museum.name
  const collection = document.createElement('div')
  if (museum.collectionSummary) {
    const summary = document.createElement('p')
    summary.textContent = museum.collectionSummary
    root.append(heading, summary)
  } else {
    root.append(heading)
  }
  collection.textContent = 'Collectie laden…'
  const hours = document.createElement('p')
  hours.textContent = museum.hours
  const site = document.createElement('a')
  site.href = museum.website
  site.target = '_blank'
  site.rel = 'noopener noreferrer'
  site.textContent = 'Controleer openingsuren op de museumwebsite'
  root.append(collection, hours, site)
  return { root, collection }
}

function renderCollection(root: HTMLElement, item: MuseumCollection | undefined) {
  root.replaceChildren()
  if (!item) {
    root.textContent = 'Geen collectiegegevens beschikbaar via Wikidata.'
    return
  }
  const img = document.createElement('img')
  img.src = item.imageUrl
  img.alt = item.title
  img.loading = 'lazy'
  img.referrerPolicy = 'no-referrer'
  img.addEventListener('error', () => { img.remove() })
  const title = document.createElement('strong')
  title.textContent = item.title
  const description = document.createElement('p')
  description.textContent = item.description ?? 'Object uit de collectie.'
  const source = document.createElement('a')
  source.href = item.imageSourceUrl
  source.target = '_blank'
  source.rel = 'noopener noreferrer'
  source.textContent = 'Afbeelding: Wikimedia Commons (maker en licentie)'
  const object = document.createElement('a')
  object.href = item.objectUrl
  object.target = '_blank'
  object.rel = 'noopener noreferrer'
  object.textContent = 'Collectieobject op Wikidata'
  root.append(img, title, description, object, document.createTextNode(' · '), source)
}

export function drawMuseums(group: L.LayerGroup, museums: Museum[]) {
  const timers = new Set<number>()
  for (const museum of museums) {
    const { root, collection } = popupContent(museum)
    const marker = L.marker([museum.lat, museum.lon], { icon, title: museum.name, alt: museum.name, riseOnHover: true })
      .bindPopup(root, { maxWidth: 280, autoPan: false, className: 'museum-popup' })
      .addTo(group)
    let timer: number | undefined
    let loading = false
    const cancelClose = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timers.delete(timer)
        timer = undefined
      }
    }
    const closeLater = () => {
      cancelClose()
      timer = window.setTimeout(() => { cancelClose(); marker.closePopup() }, 350)
      timers.add(timer)
    }
    const load = () => {
      if (loading) return
      loading = true
      collection.textContent = 'Collectie laden…'
      api.museumCollection(museum.id)
        .then((item) => { renderCollection(collection, item); marker.getPopup()?.update() })
        .catch(() => { collection.textContent = 'Collectie kon niet worden geladen. Probeer opnieuw.'; marker.getPopup()?.update() })
        .finally(() => { loading = false })
    }
    marker.on('mouseover', () => { cancelClose(); marker.openPopup() })
    marker.on('mouseout', closeLater)
    marker.on('click', (e) => { L.DomEvent.stopPropagation(e); cancelClose(); marker.openPopup() })
    marker.on('popupopen', load)
    root.addEventListener('mouseenter', cancelClose)
    root.addEventListener('mouseleave', closeLater)
    marker.getElement()?.addEventListener('focus', () => { cancelClose(); marker.openPopup() })
  }
  return () => timers.forEach(window.clearTimeout)
}
