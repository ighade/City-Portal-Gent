using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

/// <summary>Een plek uit de catalogus <c>locaties-openbare-parkings-gent</c>: waar en hoe groot.</summary>
public sealed record CatalogueEntry(
    string ExternalId, string Name, ParkingKind Kind, double Latitude, double Longitude,
    int Capacity, string? Address, string? Url);

/// <summary>Een meting uit <c>bezetting-parkeergarages-real-time</c>: hoe vol, nu.</summary>
public sealed record LiveEntry(
    string ExternalId, string Name, double Latitude, double Longitude,
    int AvailableSpaces, int TotalCapacity, bool IsOpen, bool TemporarilyClosed,
    string? Trend, string? Address, string? Url, string? Operator, string? OpeningHours,
    bool? InLowEmissionZone, bool? IsFree, DateTime MeasuredAtUtc);

/// <summary>Eén punt uit een <c>recente-bezetting-parking-*</c>-reeks: de geschiedenis die de stad zelf bewaart.</summary>
public sealed record HistoryPoint(DateTime MeasuredAtUtc, int AvailableSpaces, int TotalCapacity);

/// <summary>
/// Een gemeten fietsenstalling. <see cref="Key"/> is waarop <c>seed/fietsenstallingen.json</c>
/// koppelt: het veld <c>id</c> als het record dat heeft, anders <c>id_parking</c>.
/// </summary>
public sealed record BicycleEntry(
    string Key, string Name, int AvailableSpaces, int TotalCapacity, DateTime? MeasuredAtUtc);

/// <summary>
/// De enige plek die met data.stad.gent praat.
/// <para>
/// <b>Wat hier anders is dan in de eerste opzet.</b> Die las elk antwoord als
/// <c>result.record.fields ?? result.fields ?? result</c> — een overblijfsel van de oudere v1/v2-API.
/// De Explore-API v2.1 geeft de velden plat, zonder omhulsel; nagemeten op 29-09-2026. Verder:
/// </para>
/// <list type="bullet">
/// <item><c>limit</c> gaat tot 100, niet hoger. De oude code vroeg er 1000 en kreeg dus 400
/// terug op de dataset van de parkeerautomaten; daarom hier bladeren met <c>offset</c>.</item>
/// <item><c>real-time-bezetting-pr-gent</c> bestaat niet meer (404). De P+R-plekken staan nu in
/// de gewone catalogus, en van hen komt geen bezetting binnen.</item>
/// <item>Coördinaten komen uit <c>location</c> of <c>geo_point_2d</c>, met
/// <c>locationanddimension</c> als derde kans. Ze worden nooit verzonnen — de oude code zette
/// een plek met een willekeurige afwijking in het midden van Gent als ze niets vond, en dan
/// staat er een speld op de kaart die nergens op wijst.</item>
/// </list>
/// </summary>
public sealed class GentOpenData(HttpClient http, IOptions<GentOptions> options, ILogger<GentOpenData> log)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>De hoogste <c>limit</c> die de Explore-API aanvaardt; daarboven antwoordt ze met 400.</summary>
    private const int PageSize = 100;

    public async Task<List<CatalogueEntry>> GetCatalogueAsync(CancellationToken ct)
    {
        var rows = await FetchAllAsync<CatalogueRecord>(options.Value.CatalogueDataset, orderBy: null, max: 500, ct);
        var result = new List<CatalogueEntry>(rows.Count);

        foreach (var r in rows)
        {
            if (string.IsNullOrWhiteSpace(r.Urid) || string.IsNullOrWhiteSpace(r.Naam)) continue;

            var (lat, lon) = Coordinates(r.GeoPoint, r.Geometry);
            if (lat is null || lon is null)
            {
                log.LogWarning("Catalogus: {Naam} heeft geen coördinaten en wordt overgeslagen.", r.Naam);
                continue;
            }

            // "P+R" in het veld parking; het veld type zegt hetzelfde met woorden ("Park and Ride").
            var kind = r.Parking?.Contains("P+R", StringComparison.OrdinalIgnoreCase) == true
                ? ParkingKind.ParkAndRide
                : ParkingKind.Garage;

            var address = Join(r.Straatnaam, r.Huisnr);
            result.Add(new CatalogueEntry(
                ExternalId: r.Urid.Trim(),
                Name: Clean(r.Naam)!,
                Kind: kind,
                Latitude: lat.Value,
                Longitude: lon.Value,
                Capacity: Math.Max(0, r.Capaciteit ?? 0),
                Address: address,
                Url: Clean(r.Url)));
        }

        return result;
    }

    public async Task<List<LiveEntry>> GetLiveAsync(CancellationToken ct)
    {
        var rows = await FetchAllAsync<LiveRecord>(options.Value.LiveDataset, orderBy: null, max: 200, ct);
        var result = new List<LiveEntry>(rows.Count);

        foreach (var r in rows)
        {
            if (string.IsNullOrWhiteSpace(r.Name)) continue;

            var detail = ParseLocationAndDimension(r.LocationAndDimension);
            var (lat, lon) = Coordinates(r.Location, geometry: null);
            lat ??= detail?.Latitude;
            lon ??= detail?.Longitude;
            if (lat is null || lon is null)
            {
                log.LogWarning("Realtime: {Naam} heeft geen coördinaten en wordt overgeslagen.", r.Name);
                continue;
            }

            var measured = r.LastUpdate ?? DateTimeOffset.UtcNow;

            result.Add(new LiveEntry(
                // Het id is een stad.gent-adres en is uniek per parking; als het ontbreekt is de naam de sleutel.
                ExternalId: string.IsNullOrWhiteSpace(r.Id) ? $"live:{Slugger.Make(r.Name)}" : r.Id.Trim(),
                Name: Clean(r.Name)!,
                Latitude: lat.Value,
                Longitude: lon.Value,
                AvailableSpaces: Math.Max(0, r.AvailableCapacity ?? 0),
                TotalCapacity: Math.Max(0, r.TotalCapacity ?? 0),
                IsOpen: (r.IsOpenNow ?? 1) == 1,
                TemporarilyClosed: (r.TemporaryClosed ?? 0) == 1,
                Trend: Clean(r.OccupancyTrend),
                Address: detail?.RoadName ?? Clean(r.Description),
                Url: Clean(r.UrlLinkAddress) ?? Clean(r.Id),
                Operator: Clean(r.OperatorInformation),
                OpeningHours: Clean(r.OpeningTimesDescription),
                // "parking in LEZ" tegenover "parking buiten LEZ".
                InLowEmissionZone: r.Categorie is null ? null
                    : r.Categorie.Contains("buiten", StringComparison.OrdinalIgnoreCase) ? false
                    : r.Categorie.Contains("LEZ", StringComparison.OrdinalIgnoreCase) ? true : null,
                IsFree: r.FreeParking is null ? null : r.FreeParking == 1,
                MeasuredAtUtc: measured.UtcDateTime));
        }

        return result;
    }

    /// <summary>
    /// De bezetting van de fietsenstallingen, uit twee datasets tegelijk.
    /// <para>
    /// Twee, want de stad heeft het Stadskantoor apart gezet met eigen veldnamen:
    /// <c>totalplaces</c>/<c>freeplaces</c> in de ene, <c>parkingcapacity</c>/<c>vacantspaces</c>
    /// (als kommagetallen) in de andere. Vandaar één record-type dat beide vormen aankan.
    /// </para>
    /// <para>
    /// <b>De Stadskantoor-dataset draagt géén tijdstip.</b> Bij die records is het meetmoment dus
    /// het ophaalmoment — anders dan bij de auto's, waar het tijdstip van de stad telt. Dat is het
    /// eerlijkste dat er is, maar het betekent ook dat twee ophaalrondes binnen dezelfde minuut
    /// twee metingen opleveren in plaats van één.
    /// </para>
    /// </summary>
    public async Task<List<BicycleEntry>> GetBicycleAsync(CancellationToken ct)
    {
        var result = new List<BicycleEntry>();

        foreach (var dataset in options.Value.BicycleDatasets)
        {
            List<BicycleRecord> rows;
            try
            {
                rows = await FetchAllAsync<BicycleRecord>(dataset, orderBy: null, max: 100, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Eén wegvallende dataset mag de andere niet meeslepen.
                log.LogWarning(ex, "Fietsdataset {Dataset} kon niet opgehaald worden; overgeslagen.", dataset);
                continue;
            }

            foreach (var r in rows)
            {
                var key = Clean(r.Id) ?? Clean(r.IdParking);
                if (key is null)
                {
                    log.LogWarning("Een rij uit {Dataset} heeft id noch id_parking; overgeslagen.", dataset);
                    continue;
                }

                var total = (int)Math.Round(r.TotalPlaces ?? r.ParkingCapacity ?? 0);
                var free = (int)Math.Round(r.FreePlaces ?? r.VacantSpaces ?? 0);
                if (total <= 0) continue;

                result.Add(new BicycleEntry(
                    Key: key,
                    Name: Clean(r.FacilityName) ?? Clean(r.Naam) ?? Clean(r.Name) ?? key,
                    AvailableSpaces: Math.Max(0, free),
                    TotalCapacity: total,
                    MeasuredAtUtc: r.Time?.UtcDateTime));
            }
        }

        return result;
    }

    /// <summary>
    /// De reeksen die de stad zelf bewaart: per parking één dataset met de laatste 180 metingen.
    /// Er zijn er negen (<c>recente-bezetting-parking-reep-gent</c> en zo verder); welke, dat
    /// vragen we aan de catalogus in plaats van het in de code te zetten, want die lijst groeit.
    /// </summary>
    public async Task<List<string>> GetHistoryDatasetsAsync(CancellationToken ct)
    {
        using var response = await http.GetAsync(
            "catalog/datasets?limit=100&where=" + Uri.EscapeDataString("search(dataset_id, \"recente-bezetting-parking\")"), ct);
        response.EnsureSuccessStatusCode();
        var page = await response.Content.ReadFromJsonAsync<CatalogPage>(Json, ct);
        return page?.Results
            .Select(d => d.DatasetId)
            .Where(id => !string.IsNullOrWhiteSpace(id)
                         && id.StartsWith("recente-bezetting-parking", StringComparison.OrdinalIgnoreCase))
            .ToList() ?? new List<string>();
    }

    public async Task<List<HistoryPoint>> GetHistoryAsync(string dataset, CancellationToken ct)
    {
        var rows = await FetchAllAsync<HistoryRecord>(dataset, orderBy: "datetime desc", max: 200, ct);
        return rows
            .Where(r => r.Datetime is not null && r.NumberOfSpaces is > 0)
            .Select(r => new HistoryPoint(r.Datetime!.Value.UtcDateTime,
                Math.Max(0, r.AvailableSpaces ?? 0), r.NumberOfSpaces!.Value))
            .ToList();
    }

    /// <summary>
    /// De lage-emissiezone als GeoJSON-geometrieën. Twee vlakken (LEZ1 en LEZ2), samen de zone
    /// waar niet elke wagen in mag.
    /// <para>
    /// Dit is de enige vraag aan de stad die niets met bezetting te maken heeft: het is
    /// achtergrond bij de kaart, geen meting. De zone verandert vrijwel nooit, dus ze wordt
    /// hooguit één keer per dag opnieuw opgehaald — zie <see cref="LowEmissionZone"/>.
    /// </para>
    /// </summary>
    public async Task<List<JsonElement>> GetLowEmissionZoneAsync(CancellationToken ct)
    {
        var rows = await FetchAllAsync<ZoneRecord>(options.Value.LowEmissionZoneDataset, orderBy: null, max: 50, ct);
        var shapes = new List<JsonElement>();

        foreach (var r in rows)
        {
            // De dataset verpakt haar vlak als een GeoJSON-Feature in een veld dat "geometry"
            // heet, met de eigenlijke geometrie er nóg een laag dieper in — dezelfde vorm als bij
            // de parkeercatalogus.
            if (r.Geometry.ValueKind != JsonValueKind.Object) continue;
            if (!r.Geometry.TryGetProperty("geometry", out var inner)) continue;
            if (inner.ValueKind != JsonValueKind.Object) continue;
            shapes.Add(inner.Clone());
        }

        return shapes;
    }

    /// <summary>
    /// Kan de bron bereikt worden? Alleen de kop van de realtime-dataset, met een korte limiet —
    /// dit hangt aan <c>/api/health</c> en mag een statuscontrole niet laten wachten.
    /// </summary>
    public async Task<bool> PingAsync(CancellationToken ct)
    {
        try
        {
            using var response = await http.GetAsync(
                $"catalog/datasets/{options.Value.LiveDataset}/records?limit=1", ct);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    // ---------- bladeren ----------

    private async Task<List<T>> FetchAllAsync<T>(string dataset, string? orderBy, int max, CancellationToken ct)
    {
        var all = new List<T>();
        var offset = 0;

        while (all.Count < max)
        {
            var url = $"catalog/datasets/{dataset}/records?limit={PageSize}&offset={offset}";
            if (orderBy is not null) url += "&order_by=" + Uri.EscapeDataString(orderBy);

            using var response = await http.GetAsync(url, ct);
            response.EnsureSuccessStatusCode();
            var page = await response.Content.ReadFromJsonAsync<RecordPage<T>>(Json, ct);
            if (page is null || page.Results.Count == 0) break;

            all.AddRange(page.Results);
            offset += page.Results.Count;
            if (page.Results.Count < PageSize || offset >= page.TotalCount) break;
        }

        return all;
    }

    // ---------- lezen wat er staat ----------

    private static (double? lat, double? lon) Coordinates(GeoPoint? point, GeoFeature? geometry)
    {
        if (point is { Lat: not null, Lon: not null } && IsInFlanders(point.Lat.Value, point.Lon.Value))
        {
            return (point.Lat, point.Lon);
        }

        // De catalogus verpakt haar punt als een GeoJSON-Feature in een veld dat "geometry" heet,
        // met de eigenlijke geometrie er nóg een laag dieper in.
        var coords = geometry?.Geometry?.Coordinates;
        if (coords is { Count: >= 2 } && IsInFlanders(coords[1], coords[0]))
        {
            return (coords[1], coords[0]);       // GeoJSON is lengte, breedte — in die volgorde.
        }

        return (null, null);
    }

    /// <summary>
    /// Een ruwe zeef rond Vlaanderen. Niet om nauwkeurig te zijn, maar om een verwisseling van
    /// breedte en lengte (3,7 en 51,0 zijn beide geldige getallen) te laten opvallen in plaats van
    /// een speld in Somalië te zetten.
    /// </summary>
    private static bool IsInFlanders(double lat, double lon)
        => lat is > 50.6 and < 51.6 && lon is > 2.4 and < 6.0;

    private sealed record LocationDetail(double? Latitude, double? Longitude, string? RoadName);

    /// <summary>
    /// <c>locationanddimension</c> is geen object maar een <b>string met JSON erin</b> — zo staat
    /// het in de dataset. Daarbinnen zit <c>coordinatesForDisplay</c> (de inrit, nauwkeuriger dan
    /// het middelpunt) en <c>roadName</c>, met een harde regelovergang tussen straat en gemeente.
    /// </summary>
    private LocationDetail? ParseLocationAndDimension(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            double? lat = null, lon = null;
            if (doc.RootElement.TryGetProperty("coordinatesForDisplay", out var c))
            {
                if (c.TryGetProperty("latitude", out var la) && la.TryGetDouble(out var lav)) lat = lav;
                if (c.TryGetProperty("longitude", out var lo) && lo.TryGetDouble(out var lov)) lon = lov;
            }
            if (lat is not null && lon is not null && !IsInFlanders(lat.Value, lon.Value))
            {
                (lat, lon) = (null, null);
            }

            string? road = null;
            if (doc.RootElement.TryGetProperty("roadName", out var rn) && rn.ValueKind == JsonValueKind.String)
            {
                road = Clean(rn.GetString()?.Replace('\n', ' '));
            }
            return new LocationDetail(lat, lon, road);
        }
        catch (JsonException ex)
        {
            log.LogDebug(ex, "locationanddimension was geen geldige JSON; overgeslagen.");
            return null;
        }
    }

    /// <summary>Leegte, "-" en "?" betekenen in deze datasets alle drie "niets ingevuld".</summary>
    private static string? Clean(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed is "-" or "?" or "null" ? null : trimmed;
    }

    private static string? Join(string? street, string? number)
    {
        var s = Clean(street);
        var n = Clean(number);
        if (s is null) return null;
        return n is null ? $"{s}, Gent" : $"{s} {n}, Gent";
    }

    // ---------- de vorm waarin de API antwoordt ----------

    private sealed class RecordPage<T>
    {
        [JsonPropertyName("total_count")] public int TotalCount { get; set; }
        public List<T> Results { get; set; } = new();
    }

    private sealed class CatalogPage
    {
        [JsonPropertyName("total_count")] public int TotalCount { get; set; }
        public List<CatalogDataset> Results { get; set; } = new();
    }

    private sealed class CatalogDataset
    {
        [JsonPropertyName("dataset_id")] public string DatasetId { get; set; } = string.Empty;
    }

    private sealed class GeoPoint
    {
        public double? Lat { get; set; }
        public double? Lon { get; set; }
    }

    private sealed class GeoFeature
    {
        public InnerGeometry? Geometry { get; set; }

        internal sealed class InnerGeometry
        {
            public List<double>? Coordinates { get; set; }
        }
    }

    private sealed class CatalogueRecord
    {
        public string? Urid { get; set; }
        public string? Naam { get; set; }
        public string? Parking { get; set; }
        public string? Type { get; set; }
        public string? Straatnaam { get; set; }
        public string? Huisnr { get; set; }
        public int? Capaciteit { get; set; }
        public string? Url { get; set; }
        [JsonPropertyName("geo_point_2d")] public GeoPoint? GeoPoint { get; set; }
        public GeoFeature? Geometry { get; set; }
    }

    private sealed class LiveRecord
    {
        public string? Id { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        [JsonPropertyName("totalcapacity")] public int? TotalCapacity { get; set; }
        [JsonPropertyName("availablecapacity")] public int? AvailableCapacity { get; set; }
        public int? Occupation { get; set; }
        [JsonPropertyName("isopennow")] public int? IsOpenNow { get; set; }
        [JsonPropertyName("temporaryclosed")] public int? TemporaryClosed { get; set; }
        [JsonPropertyName("freeparking")] public int? FreeParking { get; set; }
        [JsonPropertyName("occupancytrend")] public string? OccupancyTrend { get; set; }
        [JsonPropertyName("openingtimesdescription")] public string? OpeningTimesDescription { get; set; }
        [JsonPropertyName("operatorinformation")] public string? OperatorInformation { get; set; }
        [JsonPropertyName("urllinkaddress")] public string? UrlLinkAddress { get; set; }
        public string? Categorie { get; set; }
        [JsonPropertyName("locationanddimension")] public string? LocationAndDimension { get; set; }
        public GeoPoint? Location { get; set; }
        [JsonPropertyName("lastupdate")] public DateTimeOffset? LastUpdate { get; set; }
    }

    /// <summary>
    /// Beide fietsdatasets in één vorm. Welk veld gevuld is, hangt af van welke dataset de rij
    /// komt; de twee tellen hun plaatsen bovendien in verschillende types (geheel tegenover komma).
    /// </summary>
    private sealed class ZoneRecord
    {
        public JsonElement Geometry { get; set; }
    }

    private sealed class BicycleRecord
    {
        public string? Id { get; set; }
        [JsonPropertyName("id_parking")] public string? IdParking { get; set; }
        [JsonPropertyName("facilityname")] public string? FacilityName { get; set; }
        public string? Name { get; set; }
        public string? Naam { get; set; }
        [JsonPropertyName("totalplaces")] public double? TotalPlaces { get; set; }
        [JsonPropertyName("freeplaces")] public double? FreePlaces { get; set; }
        [JsonPropertyName("parkingcapacity")] public double? ParkingCapacity { get; set; }
        [JsonPropertyName("vacantspaces")] public double? VacantSpaces { get; set; }
        public DateTimeOffset? Time { get; set; }
    }

    private sealed class HistoryRecord
    {
        [JsonPropertyName("availablespaces")] public int? AvailableSpaces { get; set; }
        [JsonPropertyName("numberofspaces")] public int? NumberOfSpaces { get; set; }
        public DateTimeOffset? Datetime { get; set; }
    }
}

/// <summary>Maakt van een naam een stuk adres: "Sint-Pietersplein" → "sint-pietersplein".</summary>
public static class Slugger
{
    public static string Make(string name)
    {
        var normalized = name.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalized.Length);
        var lastWasDash = true;                     // begin nooit met een streepje

        foreach (var ch in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(char.ToLowerInvariant(ch));
                lastWasDash = false;
            }
            else if (!lastWasDash)
            {
                sb.Append('-');
                lastWasDash = true;
            }
        }

        var slug = sb.ToString().Trim('-');
        return slug.Length == 0 ? "parking" : slug;
    }
}
