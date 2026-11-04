
import type { ReactNode } from 'react'
import { View } from 'react-native'

import { Card, PageHead, Screen, Txt } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { usePalette } from '@/context/ThemeContext'
import { API_URL } from '@/lib/api'
import { nl } from '@/lib/format'
import { openExternal } from '@/lib/links'

function H2({ children }: { children: ReactNode }) {
  return (
    <Txt variant="h2" style={{ marginTop: 18, marginBottom: 6 }}>
      {children}
    </Txt>
  )
}

function P({ children }: { children: ReactNode }) {
  return <Txt style={{ marginBottom: 10 }}>{children}</Txt>
}

function B({ children }: { children: ReactNode }) {
  return <Txt style={{ fontWeight: '700' }}>{children}</Txt>
}

function Li({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
      <Txt>•</Txt>
      <Txt style={{ flex: 1 }}>{children}</Txt>
    </View>
  )
}

function A({ href, children }: { href: string; children: ReactNode }) {
  const p = usePalette()

  return (
    <Txt
      style={{ color: p.brand, textDecorationLine: 'underline' }}
      onPress={() => void openExternal(href)}
    >
      {children}
    </Txt>
  )
}

/**
 * Toelichting bij de gegevensbronnen, de werking en de beperkingen
 * van de informatie op dit dashboard.
 */
export function OverScreen({ footer }: { footer?: ReactNode }) {
  const { meta, stats } = useApp()

  return (
    <Screen>
      <PageHead
        title="Over Parkeren in Gent"
        subtitle="Ontdek waar de gegevens vandaan komen en hoe ze worden gebruikt."
      />

      <Card>
        <H2>Parkeergegevens</H2>
        <P>
          De parkeergegevens zijn afkomstig van het open dataportaal van
          Stad Gent, beschikbaar via{' '}
          <A href="https://open.stad.gent">open.stad.gent</A>.
          Deze gegevens vormen de basis voor de parkeerinformatie op de kaart.
        </P>

        <Li>
          <B>Parkeerbezetting.</B> Waar realtimegegevens beschikbaar zijn,
          wordt de actuele bezetting van parkings weergegeven.
        </Li>
        <Li>
          <B>Locaties en capaciteit.</B> Parkings en park-and-rides worden
          op de kaart geplaatst op basis van hun locatiegegevens en, waar
          beschikbaar, hun capaciteit.
        </Li>
        <Li>
          <B>Parkeerprijzen.</B> De parkeerprijzen worden opgehaald uit de
          beschikbare gegevensbronnen. Prijzen die niet automatisch kunnen
          worden opgehaald, kunnen handmatig worden toegevoegd of aangepast
          via het beheerdersaccount.
        </Li>

        <P>
          Niet elke parking beschikt over dezelfde hoeveelheid informatie.
          De beschikbaarheid van realtimebezetting, capaciteit en
          parkeerprijzen hangt af van de gegevens die voor die parking
          beschikbaar zijn.
        </P>

        <H2>Routeplanning</H2>
        <P>
          Voor het berekenen van routes maakt deze toepassing gebruik van{' '}
          <A href="https://openrouteservice.org/">
            OpenRouteService
          </A>.
          Deze dienst wordt gebruikt om routes te bepalen tussen locaties.
          De voorgestelde route kan verschillen naargelang de gekozen
          vervoerswijze en de beschikbare routegegevens.
        </P>

        <H2>Openbaar vervoer</H2>
        <P>
          De gegevens voor het openbaar vervoer van De Lijn worden
          ingelezen via het beschikbare GTFS-bestand:
          {' '}
          <A href="https://gtfs.flatturtle.cloud/delijn/_latest/delijn-gtfs">
            De Lijn GTFS-feed
          </A>.
        </P>
        <P>
          GTFS is een standaardformaat voor openbaarvervoergegevens.
          Het bevat onder meer informatie over lijnen, haltes en
          dienstregelingen. De weergegeven informatie is afhankelijk
          van de inhoud en actualiteit van de aangeleverde feed.
        </P>

        <H2>Evenementen</H2>
        <P>
          Evenementen worden verzameld met behulp van SocialFetch.
          Daarnaast kunnen evenementen ook handmatig worden toegevoegd
          via het beheerdersaccount. Zo kunnen evenementen worden opgenomen
          wanneer ze niet automatisch worden gevonden of wanneer
          aanvullende informatie nodig is.
        </P>
        <P>
          De volledigheid en actualiteit van de evenementenkalender
          zijn afhankelijk van de beschikbare brongegevens en eventuele
          handmatige aanvullingen.
        </P>

        <H2>Wat je moet weten</H2>
        <Li>
          <B>Niet alle gegevens zijn realtime.</B> Parkeerbezetting,
          parkeerprijzen, routegegevens, openbaar vervoer en evenementen
          kunnen elk een andere bron en actualisatiefrequentie hebben.
        </Li>
        <Li>
          <B>Geen garantie op beschikbaarheid.</B> Een weergegeven aantal
          vrije parkeerplaatsen kan veranderen voordat je aankomt.
        </Li>
        <Li>
          <B>Prijzen kunnen ontbreken.</B> Wanneer een prijs niet
          automatisch beschikbaar is, kan deze handmatig door een
          beheerder worden ingevoerd. Controleer bij twijfel de officiële
          informatie van de parking.
        </Li>
        <Li>
          <B>Evenementen zijn niet noodzakelijk volledig.</B> SocialFetch
          verzamelt beschikbare informatie, maar niet elk evenement wordt
          automatisch gevonden. Handmatige invoer kan dit aanvullen.
        </Li>
        <Li>
          <B>Externe bronnen kunnen wijzigen.</B> De kwaliteit van de
          informatie is mede afhankelijk van de beschikbaarheid en
          betrouwbaarheid van de gebruikte diensten.
        </Li>

        <H2>De gegevens zelf</H2>
        <P>
          De parkeerinformatie die deze toepassing via haar API aanbiedt,
          kan ook rechtstreeks worden opgevraagd als{' '}
          <A href={`${API_URL}/api/parkings`}>JSON</A> of als{' '}
          <A href={`${API_URL}/api/geojson`}>GeoJSON</A>.
          GeoJSON kan onder meer worden gebruikt in GIS-software zoals
          QGIS of in andere kaarttoepassingen.
        </P>
        <P>
          De informatie op deze website is samengesteld uit verschillende
          gegevensbronnen. Voor de oorspronkelijke gegevens blijven de
          voorwaarden en gebruiksrechten van de respectieve aanbieders
          van toepassing.
        </P>

        <H2>Over dit project</H2>
        <P>
          Deze toepassing werd ontwikkeld als graduaatsproef door
          <B> Maarten Ighade</B>. Het project brengt informatie over
          parkeren, parkeerprijzen, routeplanning, openbaar vervoer en
          evenementen samen op één plaats, met als doel bezoekers en
          inwoners te helpen bij hun verplaatsingen in Gent.
        </P>

        {stats && (
          <Txt variant="smallMuted">
            Momenteel: {stats.parkings} parkings, waarvan{' '}
            {stats.withLiveData} met realtimegegevens
            {meta?.lastSyncUtc
              ? ` · Laatste synchronisatie: ${new Date(
                  meta.lastSyncUtc,
                ).toLocaleString('nl-BE')}${
                  meta.lastSyncOk ? '' : ' (mislukt)'
                }`
              : ''}
            .
          </Txt>
        )}

        {meta && (
          <Txt variant="smallMuted" style={{ marginTop: 6 }}>
            De gegevens worden volgens de ingestelde synchronisatie
            opgehaald. De frequentie kan verschillen per gegevensbron.
            {` De parkeerdata wordt standaard elke ${
              meta.refreshMinutes ?? 5
            } minuten bijgewerkt.`}
            {` Meetgegevens worden ${
              meta.retentionDays ?? 120
            } dagen bewaard.`}
            {meta.measurementCount != null
              ? ` Er zijn momenteel ${nl(meta.measurementCount)} metingen opgeslagen.`
              : ''}
          </Txt>
        )}
      </Card>

      {footer}
    </Screen>
  )
}
