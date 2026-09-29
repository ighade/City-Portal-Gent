using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace ParkingGent.Api.Services;

/// <summary>Waar één gemeten fietsenstalling ligt, en waarom we dat denken.</summary>
public sealed class BicycleLocation
{
    /// <summary>Waarop gekoppeld wordt: het veld <c>id</c> van het record, anders <c>id_parking</c>.</summary>
    [JsonPropertyName("sleutel")] public string Key { get; set; } = string.Empty;

    [JsonPropertyName("naam")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("lat")] public double Latitude { get; set; }
    [JsonPropertyName("lon")] public double Longitude { get; set; }
    [JsonPropertyName("adres")] public string? Address { get; set; }
    [JsonPropertyName("openbaar")] public bool IsPublic { get; set; } = true;
    [JsonPropertyName("beheerder")] public string? Operator { get; set; }
    [JsonPropertyName("url")] public string? Url { get; set; }

    /// <summary>Waar de coördinaat vandaan komt. Wordt niet getoond, maar hoort er te staan.</summary>
    [JsonPropertyName("herkomst")] public string[] Provenance { get; set; } = Array.Empty<string>();
}

/// <summary>
/// Leest <c>seed/fietsenstallingen.json</c> in: de coördinaten die Stad Gent niet publiceert.
/// <para>
/// Dit is het enige stukje van deze toepassing waar een plaats níét uit de open data komt, en dat
/// is precies waarom het in een apart bestand staat in plaats van in de code: zo is te zien wat er
/// met de hand is toegevoegd, en waarom. Verschijnt er ooit wél een coördinaat in de bron, dan
/// hoort die rij uit het bestand te verdwijnen.
/// </para>
/// <para>
/// Ontbreekt of hapert het bestand, dan verschijnen de fietsenstallingen gewoon niet — de auto's
/// blijven werken. Een kapotte coördinatenlijst mag geen ophaalronde slopen.
/// </para>
/// </summary>
public sealed class BicycleLocations(IOptions<GentOptions> options, IHostEnvironment env, ILogger<BicycleLocations> log)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private Dictionary<string, BicycleLocation>? cache;

    public IReadOnlyDictionary<string, BicycleLocation> All => cache ??= Load();

    public BicycleLocation? Find(string key) => All.GetValueOrDefault(key);

    private Dictionary<string, BicycleLocation> Load()
    {
        var configured = options.Value.BicycleLocationsPath;
        var path = Path.IsPathRooted(configured)
            ? configured
            : Path.Combine(env.ContentRootPath, configured);

        if (!File.Exists(path))
        {
            log.LogWarning(
                "{Pad} bestaat niet; de fietsenstallingen blijven van de kaart omdat de stad er geen coördinaten bij levert.",
                path);
            return new Dictionary<string, BicycleLocation>(StringComparer.Ordinal);
        }

        try
        {
            using var stream = File.OpenRead(path);
            var file = JsonSerializer.Deserialize<LocationsFile>(stream, Json);
            var rows = file?.Stallingen ?? new List<BicycleLocation>();

            var map = new Dictionary<string, BicycleLocation>(StringComparer.Ordinal);
            foreach (var row in rows)
            {
                if (string.IsNullOrWhiteSpace(row.Key))
                {
                    log.LogWarning("Een rij in {Pad} heeft geen sleutel; overgeslagen.", path);
                    continue;
                }
                // Een coördinaat buiten Vlaanderen is hier een tikfout, geen bedoeling.
                if (row.Latitude is < 50.6 or > 51.6 || row.Longitude is < 2.4 or > 6.0)
                {
                    log.LogWarning(
                        "{Naam} in {Pad} ligt op {Lat},{Lon} — buiten Vlaanderen. Overgeslagen; controleer breedte en lengte.",
                        row.Name, path, row.Latitude, row.Longitude);
                    continue;
                }
                if (row.Provenance.Length == 0)
                {
                    log.LogWarning("{Naam} in {Pad} heeft geen 'herkomst'. Zet erbij waar de coördinaat vandaan komt.", row.Name, path);
                }
                map[row.Key.Trim()] = row;
            }

            log.LogInformation("{Aantal} fietsenstallingen met een coördinaat ingelezen uit {Pad}.", map.Count, path);
            return map;
        }
        catch (Exception ex) when (ex is JsonException or IOException)
        {
            log.LogError(ex, "{Pad} kon niet gelezen worden; de fietsenstallingen blijven van de kaart.", path);
            return new Dictionary<string, BicycleLocation>(StringComparer.Ordinal);
        }
    }

    private sealed class LocationsFile
    {
        [JsonPropertyName("stallingen")] public List<BicycleLocation> Stallingen { get; set; } = new();
    }
}
