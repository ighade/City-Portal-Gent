namespace ParkingGent.Api.Services;

/// <summary>Eén tijdvenster van een garagetarief; <see cref="IsMaximum"/> is "Max. € X / uur".</summary>
public sealed record RatePeriod(string Key, string Label, decimal HourlyEur, bool IsMaximum, decimal? DayMaxEur, string? Extra);

public sealed record ParkingRate(string ActiveKey, RatePeriod[] Periods, string[] Notes, string SourceUrl);

/// <summary>
/// Uurtarieven van de parkings in beheer van Stad Gent, overgenomen van
/// stad.gent/.../tarieven-parkings-stad-gent. Andere parkings (Kouter, Gent Zuid, stations) hebben geen tarief.
/// </summary>
public static class ParkingRates
{
    public const string SourceUrl = "https://stad.gent/nl/mobiliteit-openbare-werken/parkeren/parkings-gent/tarieven-parkings-stad-gent";

    private const string Extra5h9 = "5 uur en langer: € 9";
    private const string Extra5h7 = "5 uur en langer: € 7";
    private const string Extra5h5 = "5 uur en langer: € 5";

    private static readonly string[] Notes =
    [
        "In- en uitrijden binnen 7 minuten is gratis, behalve in parking Vrijdagmarkt.",
        "Tijdens grote evenementen kunnen de tarieven afwijken.",
    ];

    /// <summary>De vier tijdvensters van de tariefpagina, in kolomvolgorde.</summary>
    public static readonly (string Key, string Label)[] Slots =
    [
        ("weekday", "Maandag – vrijdag, 7–19 u"),
        ("saturday", "Zaterdag, 7–19 u"),
        ("sunday", "Zondag, 7–19 u"),
        ("night", "Nacht, 19–7 u"),
    ];

    private static RatePeriod[] Make(
        (decimal Hourly, bool Max, decimal? Day) weekday,
        (decimal Hourly, bool Max, decimal? Day) saturday,
        (decimal Hourly, bool Max, decimal? Day) sunday,
        (decimal Hourly, bool Max, decimal? Day) night,
        string? nightExtra) =>
    [
        new(Slots[0].Key, Slots[0].Label, weekday.Hourly, weekday.Max, weekday.Day, null),
        new(Slots[1].Key, Slots[1].Label, saturday.Hourly, saturday.Max, saturday.Day, null),
        new(Slots[2].Key, Slots[2].Label, sunday.Hourly, sunday.Max, sunday.Day, null),
        new(Slots[3].Key, Slots[3].Label, night.Hourly, night.Max, night.Day, nightExtra),
    ];

    // Sleutel: een stuk van de slug van de parking.
    /// <summary>De ingebouwde waarden; ze gelden zolang er niets uit de tariefpagina is opgeslagen.</summary>
    public static readonly (string Key, RatePeriod[] Periods)[] Table =
    [
        ("ramen", Make((3, true, 31), (4, true, 31), (3, true, 31), (2, false, null), Extra5h9)),
        ("reep", Make((3, true, 31), (4, true, 31), (3, true, 31), (2, false, null), Extra5h9)),
        ("sint-michiels", Make((3, true, 31), (4, true, 31), (3, true, 31), (2, false, null), Extra5h9)),
        ("vrijdagmarkt", Make((3, true, 31), (4, true, 31), (3, true, 31), (2, false, null), Extra5h9)),
        ("savaan", Make((2.5m, false, 20), (2.5m, false, 20), (2.5m, false, 20), (1.8m, true, null), Extra5h7)),
        ("tolhuis", Make((1.8m, true, 12.8m), (1.8m, true, 12.8m), (1.8m, true, 12.8m), (1.8m, true, null), Extra5h7)),
        ("sint-pietersplein", Make((1.8m, true, 12.8m), (1.8m, true, 12.8m), (1.8m, true, 12.8m), (1.8m, true, null), Extra5h7)),
        ("getouw", Make((1, false, 8), (1, false, 8), (1, false, 5), (1, false, null), Extra5h5)),
        ("ledeberg", Make((1.2m, false, 9.6m), (1.2m, false, 9.6m), (1, false, 5), (1, false, null), Extra5h5)),
        ("the-loop-b", Make((3.6m, true, 18), (3.6m, true, 18), (3.6m, true, 18), (3.6m, true, 18), null)),
        ("the-loop-c", Make((3.6m, true, 18), (3.6m, true, 18), (3.6m, true, 18), (3.6m, true, 18), null)),
        ("the-loop-d", Make((3.6m, true, 18), (3.6m, true, 18), (3.6m, true, 18), (3.6m, true, 18), null)),
    ];

    public static ParkingRate? For(string slug, DateTime localTime) => For(slug, localTime, Table);

    public static ParkingRate? For(string slug, DateTime localTime, IEnumerable<(string Key, RatePeriod[] Periods)> table)
    {
        var hit = table.FirstOrDefault(t => slug.Contains(t.Key, StringComparison.OrdinalIgnoreCase));
        return hit.Periods is null ? null : new ParkingRate(ActiveKey(localTime), hit.Periods, Notes, SourceUrl);
    }

    public static string ActiveKey(DateTime localTime)
    {
        if (localTime.Hour is < 7 or >= 19) return "night";
        return localTime.DayOfWeek switch
        {
            DayOfWeek.Sunday => "sunday",
            DayOfWeek.Saturday => "saturday",
            _ => "weekday",
        };
    }
}
