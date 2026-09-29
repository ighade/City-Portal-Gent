namespace ParkingGent.Api.Services;

/// <summary>Waar de open data van Stad Gent staat, en hoe vaak we kijken.</summary>
public sealed class GentOptions
{
    public const string SectionName = "Gent";

    public string BaseUrl { get; set; } = "https://data.stad.gent/api/explore/v2.1";

    /// <summary>De realtime bezetting van de parkeergarages — 13 plekken, elke vijf minuten vernieuwd.</summary>
    public string LiveDataset { get; set; } = "bezetting-parkeergarages-real-time";

    /// <summary>De catalogus van openbare parkings — 36 plekken met capaciteit en coördinaten, P en P+R.</summary>
    public string CatalogueDataset { get; set; } = "locaties-openbare-parkings-gent";

    /// <summary>
    /// De twee datasets met de bezetting van fietsenstallingen. Twee, want de stad heeft het
    /// Stadskantoor in een eigen dataset gezet met andere veldnamen dan de rest.
    /// </summary>
    public string[] BicycleDatasets { get; set; } =
    {
        "real-time-bezettingen-fietsenstallingen-gent",
        "real-time-bezetting-fietsenstalling-stadskantoor-gent",
    };

    /// <summary>
    /// Waar de coördinaten van die stallingen staan, want de stad publiceert ze niet. Elke rij
    /// draagt daar haar herkomst bij zich; zie het bestand zelf.
    /// </summary>
    public string BicycleLocationsPath { get; set; } = "seed/fietsenstallingen.json";

    /// <summary>
    /// De lage-emissiezone: twee vlakken die samen de zone vormen. Achtergrond bij de kaart, geen
    /// meting — ze verandert vrijwel nooit.
    /// </summary>
    public string LowEmissionZoneDataset { get; set; } = "lage-emissie-zone-gent";

    /// <summary>Hoe vaak we opnieuw ophalen, in minuten. De stad vernieuwt zelf om de vijf minuten.</summary>
    public int RefreshMinutes { get; set; } = 5;

    /// <summary>Hoe lang de losse metingen blijven staan. Daarna ruimt de ophaalronde ze op.</summary>
    public int RetentionDays { get; set; } = 120;

    /// <summary>
    /// Het adres waarop de beheerder van deze installatie aanspreekbaar is. Gaat mee in de
    /// User-Agent naar data.stad.gent, want de stad vraagt in haar voorwaarden om herkenbaar
    /// verkeer. Leeg mag: dan vertrekt alleen de naam van de toepassing.
    /// <para>
    /// Staat niet in de broncode maar in de omgeving, zodat wie deze code overneemt niet ongemerkt
    /// het adres van iemand anders meestuurt.
    /// </para>
    /// </summary>
    public string? ContactUrl { get; set; }

    /// <summary>
    /// Eenmalig bij het opstarten de <c>recente-bezetting-parking-*</c>-reeksen van de stad
    /// inlezen. Die dragen elk 180 metingen (ruim vijftien uur) en geven de trendgrafieken
    /// meteen iets te tonen in plaats van na een week.
    /// </summary>
    public bool BackfillOnStartup { get; set; } = true;
}

/// <summary>
/// Wie de beheerknoppen mag gebruiken. Het lézen is openbaar — dit is data van de stad en de
/// hele opzet is dat een Gentenaar de kaart gewoon kan bekijken.
/// <para>
/// Voor het schrijven gelden dezelfde twee sloten als in LvCRM (bouwsteen 21) en AlgemeneTaken:
/// de identiteitskop wordt alleen geloofd samen met het proxygeheim dat enkel het eigen
/// Caddy-blok meestuurt. Deze dienst staat openbaar, dus zet alleen de afgeschermde ingang op
/// poort 8105 die kop — van buiten komt er nooit een identiteit binnen, en dus ook geen beheer.
/// </para>
/// </summary>
public sealed class AuthOptions
{
    public const string SectionName = "Auth";
    public string HeaderName { get; set; } = "Remote-Email";
    public string NameHeader { get; set; } = "Remote-Name";
    public string ProxyKeyHeader { get; set; } = "X-Proxy-Key";
    public string? ProxyKey { get; set; }

    /// <summary>
    /// Wie beheerder is: adressen gescheiden door een puntkomma of een komma. Leeg betekent
    /// <b>niemand</b>, en dan zijn de beheerknoppen dicht — dat is de veilige kant om op te falen.
    /// <para>
    /// Eén string en geen lijst, met opzet: een array vullen vanuit een omgevingsvariabele vraagt
    /// <c>Auth__AdminEmails__0</c>, <c>__1</c> enzovoort, en dan ligt het aantal vast in de compose.
    /// </para>
    /// <para>
    /// De waarde staat <b>niet in de repo</b>, net zomin als het proxygeheim: ze komt uit
    /// <c>PARKINGGENT_ADMIN_EMAILS</c> in de server-<c>.env</c>. Zo draagt de broncode geen
    /// persoonsgegevens mee als ze wordt doorgegeven.
    /// </para>
    /// </summary>
    public string? AdminEmails { get; set; }

    /// <summary>Alleen in Development: de identiteit als er geen kop is.</summary>
    public string? DevEmail { get; set; }

    /// <summary>De adressen uit <see cref="AdminEmails"/>, opgesplitst en genormaliseerd.</summary>
    public IEnumerable<string> Admins() =>
        (AdminEmails ?? string.Empty)
            .Split(new[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(e => e.ToLowerInvariant());
}

public sealed class RoutePlannerOptions
{
    public const string SectionName = "RoutePlanner";

    public string BaseUrl { get; set; } = "https://api.heigit.org/openrouteservice";
    public string ApiKey { get; set; } = string.Empty;
}
