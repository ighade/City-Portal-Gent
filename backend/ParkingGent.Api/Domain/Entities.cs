namespace ParkingGent.Api.Domain;

/// <summary>Wat voor plek het is. De stad houdt er twee lijsten op na en noemt ze P en P+R.</summary>
public enum ParkingKind
{
    /// <summary>Een parkeergarage of bovengrondse stadsparking.</summary>
    Garage = 0,

    /// <summary>Park and ride: aan de rand, met openbaar vervoer naar het centrum.</summary>
    ParkAndRide = 1,

    /// <summary>
    /// Een fietsenstalling. De stad meet er drie, en publiceert bij géén ervan een coördinaat —
    /// die staan daarom in <c>seed/fietsenstallingen.json</c>, elk met de herkomst erbij.
    /// </summary>
    Bicycle = 2,
}

/// <summary>
/// Eén parkeerplek in Gent, zoals die blijft bestaan tussen twee metingen.
/// <para>
/// Er zijn twee bronnen en die overlappen maar deels: <c>locaties-openbare-parkings-gent</c>
/// kent 36 plekken met hun capaciteit en coördinaten (17 P, 19 P+R), en
/// <c>bezetting-parkeergarages-real-time</c> geeft voor 13 daarvan de echte bezetting. Een rij
/// hier kan dus uit één of uit beide komen; <see cref="HasLiveData"/> zegt welke.
/// </para>
/// <para>
/// De namen in de twee bronnen lopen uiteen ("Dok noord" ↔ "Dok Noord", "Getouw" ↔ "Het
/// Getouw", "B-Park Gent Sint-Pieters" ↔ "Gent Sint-Pieters"), dus wordt er gekoppeld op
/// afstand én genormaliseerde naam — zie <c>Services/ParkingSync.cs</c>.
/// </para>
/// </summary>
public class Parking
{
    public int Id { get; set; }

    /// <summary>Wat in het adres van een pagina staat: "sint-pietersplein", "p-r-bourgoyen".</summary>
    public string Slug { get; set; } = string.Empty;

    /// <summary>
    /// De sleutel van de stad: het <c>urid</c> uit de catalogus ("mob/parking1069"), of bij een
    /// plek die alleen in de realtime-lijst staat het <c>id</c> daarvan (een stad.gent-adres).
    /// </summary>
    public string ExternalId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;
    public ParkingKind Kind { get; set; }

    public double Latitude { get; set; }
    public double Longitude { get; set; }

    public string? Address { get; set; }

    /// <summary>
    /// Het aantal plaatsen zoals de stad het in haar catalogus zet. Wijkt vaak af van de
    /// <c>totalcapacity</c> in de realtime-meting (Sint-Pietersplein: 708 tegenover 700), want
    /// de meting kent alleen de vakken die de tellers zien. Voor het rekenen geldt de meting.
    /// </summary>
    public int Capacity { get; set; }

    /// <summary>De pagina van de stad over deze parking.</summary>
    public string? Url { get; set; }

    public string? Operator { get; set; }
    public string? OpeningHours { get; set; }

    /// <summary>Ligt de parking binnen de lage-emissiezone? Onbekend voor plekken zonder realtime-meting.</summary>
    public bool? InLowEmissionZone { get; set; }

    /// <summary>Gratis parkeren? Onbekend voor plekken zonder realtime-meting.</summary>
    public bool? IsFree { get; set; }

    /// <summary>Komt er bezetting binnen voor deze plek, of staat alleen de capaciteit bekend?</summary>
    public bool HasLiveData { get; set; }

    /// <summary>
    /// Kan iedereen hier terecht? Onwaar voor de personeelsstalling van het Stadskantoor: de stad
    /// publiceert haar bezetting wel, maar je kunt er niet parkeren. Het scherm zegt dat erbij in
    /// plaats van de plek weg te laten — een gemeten plaats verzwijgen is óók misleidend.
    /// </summary>
    public bool IsPublic { get; set; } = true;

    public DateTime FirstSeenUtc { get; set; }

    /// <summary>Wanneer een bron deze plek voor het laatst noemde. Verdwijnt ze uit beide, dan verouderd dit.</summary>
    public DateTime LastSeenUtc { get; set; }

    public ParkingStatus? Status { get; set; }
    public List<Measurement> Measurements { get; set; } = new();
}

/// <summary>De huidige stand van één parking — precies één rij per parking, telkens overschreven.</summary>
public class ParkingStatus
{
    public int ParkingId { get; set; }
    public Parking Parking { get; set; } = null!;

    public int AvailableSpaces { get; set; }

    /// <summary>De capaciteit volgens de meting zelf.</summary>
    public int TotalCapacity { get; set; }

    /// <summary>
    /// Hoe vol, in procent. Zelf gerekend uit vrij en totaal, en begrensd op 0–100: de stad
    /// stuurt soms meer vrije plaatsen dan er plaatsen zijn (B-Park Dampoort gaf 142 vrij van 90)
    /// en zet <c>occupation</c> dan op 0, wat "leeg" suggereert waar het "onbekend" is.
    /// </summary>
    public short OccupancyPct { get; set; }

    /// <summary>Is de capaciteit geloofwaardig? Zo niet, dan toont het scherm geen percentage.</summary>
    public bool IsPlausible { get; set; }

    public bool IsOpen { get; set; }
    public bool TemporarilyClosed { get; set; }

    /// <summary>Wat de stad zelf over de richting zegt. Staat in de praktijk vrijwel altijd op "unknown".</summary>
    public string? SourceTrend { get; set; }

    /// <summary>Het tijdstip dat de stad aan de meting hangt (<c>lastupdate</c>).</summary>
    public DateTime MeasuredAtUtc { get; set; }

    /// <summary>Wanneer wij het ophaalden. Verschilt van <see cref="MeasuredAtUtc"/> als de stad blijft stilstaan.</summary>
    public DateTime FetchedAtUtc { get; set; }
}

/// <summary>
/// Eén meting in de tijdreeks. Hier zit de waarde die de oorspronkelijke opzet niet had: met
/// een paar weken hiervan is te zeggen hoe druk een parking op een gewone donderdag om 9 u ís,
/// en niet alleen hoe druk hij nú is.
/// </summary>
public class Measurement
{
    public long Id { get; set; }

    public int ParkingId { get; set; }
    public Parking Parking { get; set; } = null!;

    /// <summary>Het tijdstip van de stad, niet van ons. Uniek per parking, zodat dubbel ophalen niets toevoegt.</summary>
    public DateTime MeasuredAtUtc { get; set; }

    public int AvailableSpaces { get; set; }
    public int TotalCapacity { get; set; }
    public short OccupancyPct { get; set; }
}

/// <summary>Wat een ophaalronde deed. Staat er zodat "de kaart is oud" een antwoord heeft.</summary>
public class SyncRun
{
    public long Id { get; set; }
    public DateTime StartedUtc { get; set; }
    public int DurationMs { get; set; }
    public bool Ok { get; set; }

    /// <summary>"opstart", "klok", "handmatig".</summary>
    public string Trigger { get; set; } = "klok";

    public int LiveCount { get; set; }
    public int CatalogueCount { get; set; }
    public int MeasurementsAdded { get; set; }
    public int MeasurementsPruned { get; set; }
    public string? Message { get; set; }
}

public class TransitStopEntity
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public List<TransitStopRouteEntity> Routes { get; set; } = new();
}

public class TransitRouteEntity
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Mode { get; set; } = "bus";
    public DateTime UpdatedAtUtc { get; set; }
    public List<TransitStopRouteEntity> Stops { get; set; } = new();
}

public class TransitStopRouteEntity
{
    public string StopId { get; set; } = string.Empty;
    public TransitStopEntity Stop { get; set; } = null!;
    public string RouteId { get; set; } = string.Empty;
    public TransitRouteEntity Route { get; set; } = null!;
}

public class TransitConnectionEntity
{
    public long Id { get; set; }
    public string TripId { get; set; } = string.Empty;
    public string RouteId { get; set; } = string.Empty;
    public string FromStopId { get; set; } = string.Empty;
    public string ToStopId { get; set; } = string.Empty;
    public int DepartureSeconds { get; set; }
    public int ArrivalSeconds { get; set; }
    public string ServiceId { get; set; } = string.Empty;
    public string ShapeId { get; set; } = string.Empty;
    public DateTime UpdatedAtUtc { get; set; }
}

public class TransitShapePointEntity
{
    public string ShapeId { get; set; } = string.Empty;
    public int Sequence { get; set; }
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}
