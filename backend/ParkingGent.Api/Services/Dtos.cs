using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

/// <summary>Eén parking zoals het scherm haar nodig heeft: plek, capaciteit en — als die er is — de stand.</summary>
public sealed record ParkingDto(
    string Slug,
    string Name,
    string Kind,
    double Lat,
    double Lon,
    string? Address,
    int Capacity,
    string? Url,
    string? Operator,
    string? OpeningHours,
    bool? InLowEmissionZone,
    bool? IsFree,
    bool HasLiveData,
    /// <summary>Onwaar voor de personeelsstalling van het Stadskantoor; het scherm zegt dat erbij.</summary>
    bool IsPublic,
    StatusDto? Status);

/// <summary>
/// De stand van nu. <see cref="Occupancy"/> is leeg als de meting zichzelf tegensprak — dan toont
/// het scherm het aantal vrije plaatsen zonder percentage, in plaats van "leeg" te beweren.
/// </summary>
public sealed record StatusDto(
    int Available,
    int Capacity,
    short? Occupancy,
    bool IsOpen,
    bool TemporarilyClosed,
    DateTime MeasuredAtUtc,
    DateTime FetchedAtUtc,
    bool IsStale);

/// <summary>Eén punt van de reeks, voor de grafiek op de detailpagina.</summary>
public sealed record PointDto(DateTime AtUtc, int Available, short Occupancy);

/// <summary>
/// Het gemiddelde per weekdag en uur: "hoe druk is het hier normaal op donderdag om negen uur".
/// <see cref="Samples"/> staat erbij zodat het scherm een vakje met te weinig metingen leeg kan
/// laten in plaats van één toevallige meting als gemiddelde te tonen.
/// </summary>
public sealed record TrendCellDto(int Weekday, int Hour, short Occupancy, int Samples);

public sealed record TrendDto(string Slug, string Name, int Days, IReadOnlyList<TrendCellDto> Cells);

/// <summary>
/// De optelsom over alle <b>auto</b>parkings met bezetting — de vier getallen bovenaan het scherm.
/// <para>
/// Fietsplaatsen staan er met opzet apart in: 486 fietsplaatsen bij 7 351 autoplaatsen optellen
/// zou een getal opleveren dat niets betekent, en "38 % bezet" zou dan over twee onvergelijkbare
/// dingen gaan.
/// </para>
/// </summary>
public sealed record StatsDto(
    int Parkings,
    int WithLiveData,
    int Open,
    int TotalCapacity,
    int AvailableSpaces,
    short? Occupancy,
    DateTime? MeasuredAtUtc,
    BicycleStatsDto Bicycle);

/// <summary>Hetzelfde, maar voor de fietsenstallingen. Alleen de openbare tellen mee.</summary>
public sealed record BicycleStatsDto(
    int Facilities,
    int TotalCapacity,
    int AvailableSpaces,
    short? Occupancy);

/// <summary>Waar de gegevens vandaan komen en hoe vers ze zijn. Hangt onderaan elk scherm.</summary>
public sealed record MetaDto(
    string Source,
    string SourceUrl,
    IReadOnlyList<string> Datasets,
    int RefreshMinutes,
    int RetentionDays,
    DateTime? LastSyncUtc,
    bool LastSyncOk,
    int MeasurementCount);

public sealed record SyncRunDto(
    DateTime StartedUtc, int DurationMs, bool Ok, string Trigger,
    int LiveCount, int CatalogueCount, int MeasurementsAdded, int MeasurementsPruned, string? Message);

public static class Mapping
{
    /// <summary>
    /// Vanaf wanneer een meting oud heet. De stad vernieuwt om de vijf minuten; een kwartier
    /// zonder nieuws betekent dat er iets hapert, en dan hoort het scherm dat te zeggen.
    /// </summary>
    public static readonly TimeSpan StaleAfter = TimeSpan.FromMinutes(15);

    public static string KindSlug(ParkingKind kind) => kind switch
    {
        ParkingKind.ParkAndRide => "park-and-ride",
        ParkingKind.Bicycle => "bicycle",
        _ => "garage",
    };

    public static ParkingDto ToDto(this Parking p, DateTime now) => new(
        p.Slug, p.Name, KindSlug(p.Kind),
        p.Latitude, p.Longitude, p.Address, p.Capacity, p.Url, p.Operator, p.OpeningHours,
        p.InLowEmissionZone, p.IsFree, p.HasLiveData, p.IsPublic,
        p.Status is null ? null : new StatusDto(
            p.Status.AvailableSpaces,
            p.Status.TotalCapacity,
            p.Status.IsPlausible ? p.Status.OccupancyPct : null,
            p.Status.IsOpen,
            p.Status.TemporarilyClosed,
            p.Status.MeasuredAtUtc,
            p.Status.FetchedAtUtc,
            now - p.Status.MeasuredAtUtc > StaleAfter));
}
