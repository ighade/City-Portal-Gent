import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ManualRateInfo } from './RateInfo'
import { kindLabel } from '../types'
import type { Parking } from '../types'

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="muted">{label}</span>
      <strong>{children}</strong>
    </div>
  )
}

export function ParkingInfo({ parking, onBack }: { parking: Parking; onBack: () => void }) {
  const status = parking.status
  const free = status?.isOpen === false ? 'Gesloten'
    : status?.available != null ? `${status.available.toLocaleString('nl-BE')} van ${status.capacity.toLocaleString('nl-BE')}`
    : `onbekend (${parking.capacity.toLocaleString('nl-BE')} plaatsen)`

  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
      <strong>{parking.name}</strong>
      <span className="small muted">
        {kindLabel[parking.kind]}{parking.isPublic ? '' : ' · privaat'}{parking.address ? ` · ${parking.address}` : ''}
      </span>
      <Fact label="Vrije plaatsen">{free}</Fact>
      {status?.occupancy != null && <Fact label="Bezetting">{status.occupancy} %</Fact>}
      {parking.openingHours && <Fact label="Openingsuren">{parking.openingHours}</Fact>}
      {parking.operator && <Fact label="Uitbater">{parking.operator}</Fact>}
      <ManualRateInfo rate={parking.manualRate} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn" to={`/parking/${parking.slug}`}>Verloop en drukte</Link>
        <button className="btn" onClick={onBack}>Terug naar route</button>
      </div>
    </div>
  )
}
