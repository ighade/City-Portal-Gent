import { useApp } from '../context/AppContext'

/**
 * Waar de cijfers vandaan komen en wat ze niet zijn. Een dashboard dat leunt op andermans
 * metingen hoort te zeggen welke metingen dat zijn, hoe oud ze mogen worden en waar ze ophouden.
 */
export function Over() {
  const { meta, stats } = useApp()

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Over deze kaart</h1>
          <p>Wat er getoond wordt, waar het vandaan komt, en wat het niet is.</p>
        </div>
      </div>

      <div className="card prose">
        <h2>De bron</h2>
        <p>
          Alles op deze kaart komt van <a href="https://data.stad.gent">data.stad.gent</a>, het open
          dataportaal van Stad Gent. Vier lijsten:
        </p>
        <ul>
          <li>
            <b>Real time bezetting parkeergarages</b> — dertien parkings waarvan de stad om de vijf
            minuten meldt hoeveel plaatsen er vrij zijn.
          </li>
          <li>
            <b>Locaties openbare parkings</b> — zesendertig plekken (zeventien parkings, negentien
            park-and-rides) met hun ligging en capaciteit, zonder bezetting.
          </li>
          <li>
            <b>Real time bezetting fietsenstallingen</b>, in twee aparte datasets — de Graslei en het
            Stadskantoor, dat laatste met een openbare en een personeelsstalling.
          </li>
          <li>
            <b>Lage emissie zone Gent</b> — de twee vlakken die samen de LEZ vormen. Die is met het
            vinkje boven de kaart aan en uit te zetten. Het is een grens, geen meting: ze wordt
            hooguit één keer per dag opgehaald.
          </li>
        </ul>
        <p>
          Bij die fietsenstallingen hoort een kanttekening: <b>de stad publiceert er geen
          coördinaten bij.</b> Zonder meer zouden ze nergens op de kaart staan. De plaatsen komen
          daarom uit een lijst die bij deze toepassing hoort, waarin bij elke coördinaat staat waar
          ze vandaan komt — het register van de stad zelf voor de Graslei, het Vlaamse
          adressenregister voor het Stadskantoor. Verschijnt er ooit wél een coördinaat in de open
          data, dan hoort die lijst te krimpen.
        </p>
        <p>
          Alle vier worden hier elke {meta?.refreshMinutes ?? 5} minuten opgehaald en bewaard, zodat het
          verloop en het gemiddelde per weekdag en uur uitgerekend kunnen worden. Losse metingen
          blijven {meta?.retentionDays ?? 120} dagen staan.
          {meta ? ` Er staan er nu ${meta.measurementCount.toLocaleString('nl-BE')}.` : ''}
        </p>

        <h2>Wat het niet is</h2>
        <ul>
          <li>
            <b>Geen straatparkeren.</b> Hoeveel plaats er langs de weg is, meet niemand. Er bestaan
            datasets van parkeerautomaten en tariefzones, maar die zeggen waar je moet betalen, niet
            of er plaats is. Een geschat percentage zou hier een verzonnen getal zijn.
          </li>
          <li>
            <b>Geen fietsnietjes.</b> De stad kent ruim zevenduizend fietsbeugels op straat, met hun
            ligging. Van geen enkele wordt geteld of er een fiets in staat, dus zeggen ze niets over
            plaats. Alleen de drie gemeten stallingen staan hier.
          </li>
          <li>
            <b>Geen voorspelling.</b> "Hoe druk is het hier normaal" is een gemiddelde van wat er
            gemeten is, niet wat er straks zal zijn. Een evenement of een wegomlegging staat er niet in.
          </li>
          <li>
            <b>Niet altijd volledig.</b> Valt de bron weg, dan blijft de laatste stand staan met de
            vermelding hoe oud die is. Een meting ouder dan een kwartier wordt als achterstallig
            gemarkeerd.
          </li>
        </ul>

        <h2>Waar de cijfers elkaar tegenspreken</h2>
        <p>
          De twee lijsten van de stad noemen dezelfde parking soms anders ("Dok Noord" tegenover
          "Dok noord") en geven verschillende capaciteiten: voor het Sint-Pietersplein 708 in de
          catalogus en 700 in de meting. Hier telt de meting, want die telt de vakken die de sensoren
          zien. Waar een meting zichzelf tegenspreekt — meer vrije plaatsen dan plaatsen — staat het
          aantal vrije plaatsen er wel, maar geen percentage.
        </p>
        <p>
          "The Loop" staat in de realtime-lijst als één parking van 2490 plaatsen en in de catalogus
          als vier deelparkings van samen 2931. Dat is een optelsom, geen parking, dus staan ze hier
          allebei: de gemeten optelsom én de vier plekken met hun capaciteit.
        </p>

        <h2>De gegevens zelf</h2>
        <p>
          Alles wat deze kaart toont, is ook rechtstreeks op te halen — als{' '}
          <a href="/api/parkings">JSON</a> of als <a href="/api/geojson">GeoJSON</a>, dat laatste te
          openen in QGIS, uMap of een ander dashboard. Het is open data; dan hoort ze ook weer open
          naar buiten te gaan.
        </p>

        <h2>Herkomst</h2>
        <p>
          Dit dashboard begon als de graduaatsproef van Asilhan Tavukcu (HoGent, maart 2025) en is
          daarna herbouwd op de infrastructuur van deze server.
        </p>

        {stats && (
          <p className="small muted">
            Nu: {stats.parkings} parkings, waarvan {stats.withLiveData} met een meting
            {meta?.lastSyncUtc
              ? ` · laatste ophaalronde ${new Date(meta.lastSyncUtc).toLocaleString('nl-BE')}${meta.lastSyncOk ? '' : ' (mislukt)'}`
              : ''}
            .
          </p>
        )}
      </div>
    </>
  )
}
