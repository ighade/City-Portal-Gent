import { useEffect, useState } from 'react'
import type { ChargingStation } from '../chargingStations'
import { fetchChargingStations, getNearestChargingStation, formatDistance } from '../chargingStations'
import './ChargingStationsPanel.css'

interface ChargingStationsPanelProps {
  destination?: { lat: number; lon: number }
  onStationSelect?: (station: ChargingStation) => void
  isVisible: boolean
}

export function ChargingStationsPanel({ destination, onStationSelect, isVisible }: ChargingStationsPanelProps) {
  const [stations, setStations] = useState<ChargingStation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedStation, setSelectedStation] = useState<ChargingStation | null>(null)

  useEffect(() => {
    if (!isVisible) return

    let cancelled = false

    const loadStations = async () => {
      setLoading(true)
      setError(null)
      try {
        const stationsData = await fetchChargingStations()
        if (!cancelled) {
          setStations(stationsData)

          if (destination) {
            const nearest = getNearestChargingStation(stationsData, destination.lat, destination.lon, 10000)
            if (nearest) {
              setSelectedStation(nearest)
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Kon laadpalen niet laden')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadStations()
    return () => { cancelled = true }
  }, [isVisible, destination?.lat, destination?.lon])

  const handleStationClick = (station: ChargingStation) => {
    setSelectedStation(station)
    onStationSelect?.(station)
  }

  if (!isVisible) return null

  const availableStations = stations.filter((s) => s.status === 'free')
  const occupiedStations = stations.filter((s) => s.status === 'occupied')

  return (
    <div className="charging-panel">
      <div className="charging-header">
        <h3>🔌 Laadpalen voor elektrische auto's</h3>
      </div>

      {loading && <div className="charging-loading">Laadpalen laden...</div>}
      {error && <div className="charging-error">Fout: {error}</div>}

      {!loading && !error && (
        <>
          <div className="charging-stats">
            <div className="stat-item">
              <span className="stat-label">Beschikbaar:</span>
              <span className="stat-value available">{availableStations.length}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Bezet:</span>
              <span className="stat-value occupied">{occupiedStations.length}</span>
            </div>
          </div>

          <div className="charging-list">
            {stations.length === 0 ? (
              <p className="no-stations">Geen laadpalen gevonden</p>
            ) : (
              stations.map((station) => {
                const isSelected = selectedStation?.id === station.id
                const distance = destination
                  ? Math.sqrt(
                      Math.pow(destination.lat - station.lat, 2) + Math.pow(destination.lon - station.lon, 2),
                    ) * 111000
                  : null

                return (
                  <div
                    key={station.id}
                    className={`station-item ${station.status} ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleStationClick(station)}
                  >
                    <div className="station-header">
                      <span className={`status-badge ${station.status}`}>
                        {station.status === 'free' ? '✓ Vrij' : '✗ Bezet'}
                      </span>
                      <span className="station-name">{station.name}</span>
                    </div>
                    {station.address && <p className="station-address">{station.address}</p>}
                    {distance !== null && <p className="station-distance">~{formatDistance(distance)}</p>}
                    {station.operator && <p className="station-operator">{station.operator}</p>}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
