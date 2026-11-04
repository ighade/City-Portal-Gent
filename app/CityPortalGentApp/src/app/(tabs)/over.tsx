import { Txt } from '@/components/ui'
import { OverScreen } from '@/screens/OverScreen'

export default function AboutTab() {
  return (
    <OverScreen
      footer={
        <Txt variant="smallMuted" style={{ textAlign: 'center' }}>
          Gegevens: Stad Gent — Open Data, onder een open licentie · kaart: Digitaal Vlaanderen (GRB) · oorspronkelijk een graduaatsproef van Asilhan Tavukcu (HoGent, 2025)
        </Txt>
      }
    />
  )
}
