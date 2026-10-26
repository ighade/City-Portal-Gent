import type { ReactNode } from 'react'
import { View } from 'react-native'

import { Card, PageHead, Screen, Txt } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { usePalette } from '@/context/ThemeContext'
import { API_URL } from '@/lib/api'
import { nl } from '@/lib/format'
import { openExternal } from '@/lib/links'

function H2({ children }: { children: ReactNode }) {
  return <Txt variant="h2" style={{ marginTop: 18, marginBottom: 6 }}>{children}</Txt>
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
    <Txt style={{ color: p.brand, textDecorationLine: 'underline' }} onPress={() => void openExternal(href)}>
      {children}
    </Txt>
  )
}

/**
 * Waar de cijfers vandaan komen en wat ze niet zijn. Een dashboard dat leunt op andermans
 * metingen hoort te zeggen welke metingen dat zijn, hoe oud ze mogen worden en waar ze ophouden.
 */
export function OverScreen({ footer }: { footer?: ReactNode }) {
  const { meta, stats } = useApp()

  return (
    <Screen>
      <PageHead title="Over Parkeren in Gent" subtitle="Wat er getoond wordt, waar het vandaan komt, en wat het niet is." />

      <Card>
        <H2>De bron</H2>
        <P>
          Alles op deze kaart komt van <A href="https://data.stad.gent">data.stad.gent</A>, het open dataportaal van Stad Gent. Vier lijsten:
        </P>
        <Li>
          <B>Real time bezetting parkeergarages</B> — dertien parkings waarvan de stad om de vijf minuten meldt hoeveel plaatsen er vrij zijn.
        </Li>
        <Li>
          <B>Locaties openbare parkings</B> — zesendertig plekken (zeventien parkings, negentien park-and-rides) met hun ligging en capaciteit, zonder bezetting.
        </Li>
        <Li>
          <B>Real time bezetting fietsenstallingen</B>, in twee aparte datasets — de Graslei en het Stadskantoor, dat laatste met een openbare en een personeelsstalling.
        </Li>
        <Li>
          <B>Lage emissie zone Gent</B> — de twee vlakken die samen de LEZ vormen. Die is met het vinkje boven de kaart aan en uit te zetten. Het is een grens, geen meting: ze wordt hooguit één keer per dag opgehaald.
        </Li>
        <P>
          Bij die fietsenstallingen hoort een kanttekening: <B>de stad publiceert er geen coördinaten bij.</B> Zonder meer zouden ze nergens op de kaart staan. De plaatsen komen daarom uit een lijst die bij deze toepassing hoort, waarin bij elke coördinaat staat waar ze vandaan komt — het register van de stad zelf voor de Graslei, het Vlaamse adressenregister voor het Stadskantoor. Verschijnt er ooit wél een coördinaat in de open data, dan hoort die lijst te krimpen.
        </P>
        <P>
          Alle vier worden hier elke {meta?.refreshMinutes ?? 5} minuten opgehaald en bewaard, zodat het verloop en het gemiddelde per weekdag en uur uitgerekend kunnen worden. Losse metingen blijven {meta?.retentionDays ?? 120} dagen staan.
          {meta ? ` Er staan er nu ${nl(meta.measurementCount)}.` : ''}
        </P>

        <H2>Wat het niet is</H2>
        <Li>
          <B>Geen straatparkeren.</B> Hoeveel plaats er langs de weg is, meet niemand. Er bestaan datasets van parkeerautomaten en tariefzones, maar die zeggen waar je moet betalen, niet of er plaats is. Een geschat percentage zou hier een verzonnen getal zijn.
        </Li>
        <Li>
          <B>Geen fietsnietjes.</B> De stad kent ruim zevenduizend fietsbeugels op straat, met hun ligging. Van geen enkele wordt geteld of er een fiets in staat, dus zeggen ze niets over plaats. Alleen de drie gemeten stallingen staan hier.
        </Li>
        <Li>
          <B>Geen voorspelling.</B> &quot;Hoe druk is het hier normaal&quot; is een gemiddelde van wat er gemeten is, niet wat er straks zal zijn. Een evenement of een wegomlegging staat er niet in.
        </Li>
        <Li>
          <B>Niet altijd volledig.</B> Valt de bron weg, dan blijft de laatste stand staan met de vermelding hoe oud die is. Een meting ouder dan een kwartier wordt als achterstallig gemarkeerd.
        </Li>

        <H2>Waar de cijfers elkaar tegenspreken</H2>
        <P>
          De twee lijsten van de stad noemen dezelfde parking soms anders (&quot;Dok Noord&quot; tegenover &quot;Dok noord&quot;) en geven verschillende capaciteiten: voor het Sint-Pietersplein 708 in de catalogus en 700 in de meting. Hier telt de meting, want die telt de vakken die de sensoren zien. Waar een meting zichzelf tegenspreekt — meer vrije plaatsen dan plaatsen — staat het aantal vrije plaatsen er wel, maar geen percentage.
        </P>
        <P>
          &quot;The Loop&quot; staat in de realtime-lijst als één parking van 2490 plaatsen en in de catalogus als vier deelparkings van samen 2931. Dat is een optelsom, geen parking, dus staan ze hier allebei: de gemeten optelsom én de vier plekken met hun capaciteit.
        </P>

        <H2>De gegevens zelf</H2>
        <P>
          Alles wat deze kaart toont, is ook rechtstreeks op te halen — als <A href={`${API_URL}/api/parkings`}>JSON</A> of als <A href={`${API_URL}/api/geojson`}>GeoJSON</A>, dat laatste te openen in QGIS, uMap of een ander dashboard. Het is open data; dan hoort ze ook weer open naar buiten te gaan.
        </P>

        <H2>Herkomst</H2>
        <P>
          Dit dashboard begon als de graduaatsproef van Asilhan Tavukcu (HoGent, maart 2025) en is daarna herbouwd op de infrastructuur van deze server.
        </P>

        {stats && (
          <Txt variant="smallMuted">
            Nu: {stats.parkings} parkings, waarvan {stats.withLiveData} met een meting
            {meta?.lastSyncUtc
              ? ` · laatste ophaalronde ${new Date(meta.lastSyncUtc).toLocaleString('nl-BE')}${meta.lastSyncOk ? '' : ' (mislukt)'}`
              : ''}
            .
          </Txt>
        )}
      </Card>

      {footer}
    </Screen>
  )
}
