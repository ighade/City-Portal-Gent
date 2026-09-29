# ParkingGent

Waar er plaats is in de parkings en park-and-rides van Gent, uit de open data van de stad.
Begonnen als de graduaatsproef van **Asilhan Tavukcu** (HoGent, maart 2025) en in september
2026 herbouwd (.NET + React).

De backend houdt één regel aan: **lezen mag iedereen, schrijven vraagt een identiteit.**

Omdat de dienst op het open internet staat, is de begrenzing strakker dan elders: 60 verzoeken
per tien seconden **per IP-adres**, en een antwoordcache van 30 seconden (30 minuten voor de
trendgrafiek) zodat honderd bezoekers in dezelfde minuut de databank één keer raken.

## De bron, en wat ze niet geeft

Vier datasets van [data.stad.gent](https://data.stad.gent), elke vijf minuten opgehaald:

- **`bezetting-parkeergarages-real-time`** — 13 parkings met hun werkelijke bezetting.
- **`locaties-openbare-parkings-gent`** — 36 plekken (17 parkings, 19 park-and-rides) met
  ligging en capaciteit, zonder bezetting.
- **`real-time-bezettingen-fietsenstallingen-gent`** — de fietsenparking Graslei.
- **`real-time-bezetting-fietsenstalling-stadskantoor-gent`** — het Stadskantoor, met een
  openbare stalling (486) en een personeelsstalling (444).
- **`lage-emissie-zone-gent`** — twee vlakken die samen de LEZ vormen. Achtergrond bij de kaart,
  geen meting: ze wordt pas opgehaald als iemand het vinkje aanzet en daarna een dag lang
  hergebruikt. Valt de bron weg, dan blijft de laatst gelukte versie staan — voor een grens die
  jaren hetzelfde blijft is oude informatie beter dan geen.

Samen 40 rijen: 36 uit de catalogus, "The Loop" (die alleen in de realtime-lijst staat) en de
drie fietsenstallingen.

### Fietsplaatsen worden nooit bij autoplaatsen opgeteld

`/api/stats` houdt ze apart. 486 fietsplaatsen bij 7 351 autoplaatsen optellen levert een getal
op dat niets betekent, en "38 % bezet" zou dan over twee onvergelijkbare dingen gaan. De
personeelsstalling telt niet mee in het fietstotaal — je kunt er niet terecht — maar staat wel
op de kaart, met de vermelding erbij.

### De coördinaten van de fietsenstallingen staan hier, niet in de open data

Dit is het enige stukje van de toepassing waar een plaats **niet** uit de bron komt: Stad Gent
publiceert bij geen van de drie gemeten stallingen een coördinaat (`geo_point_2d` is leeg in de
ene dataset en ontbreekt in de andere). Zonder meer stonden ze dus nergens.

Ze staan in **`backend/ParkingGent.Api/seed/fietsenstallingen.json`**, elk mét de herkomst van
de coördinaat erbij. Dat veld is geen sier: een speld waarvan niemand meer weet waar hij vandaan
komt, is niet te onderhouden en niet te corrigeren. Waar ze vandaan komen:

| stalling | coördinaat uit |
|---|---|
| Graslei | Stad Gent zelf — `fietsenstallingen-gent`, rij `mob/ftsst13995`, de enige openbare rij daar met `bezettingsinfo=True` |
| Stadskantoor (beide) | het Vlaamse adressenregister, Woodrow Wilsonplein 1 |

De Graslei-koppeling verdiende uitzoekwerk: het stadsregister noemt die stalling **Korenmarkt**
(Pakhuisstraat 2, 215 plaatsen), de realtime-feed **Gent Graslei** (220) en De Fietsambassade
**Graslei, onder de Sint-Michielsbrug, via de Pakhuisstraat** (203). Het adrespunt van
Pakhuisstraat 1 ligt 50 m van het registerpunt, dus het gaat om één stalling met drie namen.

Staat een gemeten stalling niet in dat bestand, dan verschijnt ze niet op de kaart en zegt het
logboek welke sleutel ontbrak — liever geen speld dan een geraden plaats. Verschijnt er ooit wél
een coördinaat in de open data, dan hoort die rij uit het bestand te verdwijnen.

Wat er **niet** is, en waarom dat zo blijft:

- **Straatparkeren.** De oude opzet toonde "parkeerzones" met een bezetting die met
  `Math.random()` verzonnen was. Er bestaan datasets van parkeerautomaten en tariefzones, maar
  die zeggen waar je betaalt, niet of er plaats is. Liever geen cijfer dan een verzonnen cijfer.
- **Fietsnietjes op straat.** De stad kent ruim 7 000 fietsbeugels mét hun ligging
  (`fietsenstallingen-gent`), maar van geen enkele wordt geteld of er een fiets in staat. Ze
  zeggen dus niets over plaats. Alleen de drie gemeten stallingen staan er.
- **P+R-bezetting.** `real-time-bezetting-pr-gent` bestaat niet meer (404). De P+R's staan er
  met hun capaciteit; meer meet de stad niet.

## Waar de twee lijsten elkaar tegenspreken

Dit is het echte werk in `Services/ParkingSync.cs`, en het is de reden dat de koppeling niet op
afstand alleen gebeurt:

- **Andere namen.** "Dok Noord" ↔ "Dok noord", "Het Getouw" ↔ "Getouw", "Gent Sint-Pieters" ↔
  "B-Park Gent Sint-Pieters". Er wordt gekoppeld op een genormaliseerde naam (zonder accenten,
  leestekens en de woordjes `b-park`, `parking`, `het`, `de`), en alleen bij een exacte match.
- **Naamgenoten.** "Ledeberg" bestaat als parking én als P+R. Dan beslist de afstand — en
  alleen als die catalogusrij ook de naaste is van álle naamgenoten.
- **Een optelsom die geen parking is.** De realtime-lijst kent één "The Loop" van 2490
  plaatsen; de catalogus kent The Loop A0, B, C en D van samen 2931. De namen zijn niet gelijk,
  dus blijft "The Loop" een eigen rij en houden de vier hun capaciteit zonder bezetting. Een
  koppeling op afstand zou de meting aan een willekeurige van de vier hangen.
- **Metingen die zichzelf tegenspreken.** B-Park Dampoort gaf "142 vrij van 90 plaatsen" met
  `occupation: 0`, wat als een lege parking leest. Het veld `occupation` van de stad wordt
  daarom niet gebruikt: het percentage wordt zelf gerekend, en is onmogelijk, dan toont het
  scherm het aantal vrije plaatsen **zonder** percentage, en blijft die meting uit de tijdreeks.
- **Twee capaciteiten.** Sint-Pietersplein: 708 in de catalogus, 700 in de meting. De meting
  telt, want die telt de vakken die de sensoren zien.

## Wat er bijgekomen is: de geschiedenis

De oorspronkelijke opzet toonde alleen de stand van nu. Hier wordt elke meting bewaard (ruim
honderd dagen, daarna ruimt de ophaalronde op), en daaruit komen twee dingen:

- het **verloop** van de vrije plaatsen over 6 uur tot een week;
- de **drukte per weekdag en uur** — "hoe druk is het hier normaal op donderdag om negen uur",
  gerekend in Belgische tijd, met een leeg vakje waar minder dan drie metingen staan.

Om niet een week leeg te beginnen, leest de dienst bij het opstarten eenmalig de negen reeksen
`recente-bezetting-parking-*` van de stad in — elk 180 metingen. Welke dat zijn, wordt aan de
catalogus gevraagd in plaats van in de code gezet; `savaanstraat` hoort daarbij bij `Savaan`.

## De vorm

| | |
|---|---|
| backend | .NET 10 minimal API, EF Core 10 + Npgsql, Serilog |
| databank | PostgreSQL-sidecar op `/mnt/data/parkinggent-postgres` |
| bron ophalen | `IHttpClientFactory` + `AddStandardResilienceHandler` (nieuwe pogingen, stroomonderbreker, tijdslimiet) |
| frontend | React 19, Vite 8, react-router 7, Leaflet 1.9 — geen grafiekbibliotheek, de SVG's staan in `components/` |
| kaart | GRB-basiskaart van Digitaal Vlaanderen, met OpenStreetMap als tweede keuze |
| uitrol | nginx + Caddy, `docker-compose.yml` van deze repo |

De achtergrondkaart is een afweging; ze staat uitgeschreven in `frontend/src/leaflet.ts`. Eén toevoeging hier: de GRB-dienst tekent elke tegel ter plekke, en doet
er ongeveer een seconde over. Een kaartbeeld van deze grootte kostte zo twintig oproepen en
laadde zichtbaar traag; met tegels van 512 px in plaats van 256 zijn het er vijf.

## Instellen

Drie waarden komen uit de omgeving en staan **niet in de broncode**:

| | |
|---|---|
| `PARKINGGENT_DB_PASSWORD` | het wachtwoord van de postgres-sidecar; zonder dit start die niet |
| `PARKINGGENT_PROXY_KEY` | het proxygeheim; leeg betekent dat de backend de identiteitskop niet meer controleert |
| `PARKINGGENT_ADMIN_EMAILS` | wie beheerder is, gescheiden door een puntkomma; **leeg = niemand** |

Die laatste staat bewust buiten de repo: zo draagt de broncode geen persoonsgegevens mee als ze
wordt doorgegeven. Alle drie falen ze naar de veilige kant — zonder beheerders zijn de
beheerknoppen dicht, niet open.

De app zelf heeft verder niets nodig: er is geen sleutel of registratie voor de open data van
Stad Gent.

## Ontwikkelen

```bash
docker run -d --name pg-parkinggent-dev \
  -e POSTGRES_USER=parkinggent -e POSTGRES_PASSWORD=parkinggent -e POSTGRES_DB=parkinggent \
  -p 5434:5432 postgres:16-alpine

cd backend/ParkingGent.Api
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:5101 dotnet run

cd ../../frontend && npm install && npm run dev      # :5175, proxyt /api naar :5101
```

Poort 5434 en niet de gebruikelijke 5432: zo botst deze databank niet met een postgres die
al op je machine draait. In Development geldt `Auth:DevEmail` als identiteit en staat datzelfde
adres in `Auth:AdminEmails`, dus is de beheerpagina lokaal meteen zichtbaar — zonder dat er een
echt adres in de broncode staat.

## Eindpunten

| | |
|---|---|
| `GET /api/parkings` | alles, met de huidige stand |
| `GET /api/parkings/{slug}` | één parking |
| `GET /api/parkings/{slug}/history?hours=24` | de reeks, 1 uur tot 14 dagen |
| `GET /api/parkings/{slug}/trend?days=60` | gemiddelde per weekdag en uur |
| `GET /api/stats` | de optelsom over wat gemeten wordt |
| `GET /api/meta` | bron, versheid, aantal bewaarde metingen |
| `GET /api/geojson` | hetzelfde als `application/geo+json` |
| `GET /api/lez` | de lage-emissiezone als GeoJSON, voor de laag op de kaart |
| `GET /api/health` | leeft de container (databank) |
| `GET /api/health/source` | is data.stad.gent bereikbaar |
| `POST /api/admin/sync` · `POST /api/admin/backfill` · `GET /api/admin/runs` | alleen voor een beheerder |
