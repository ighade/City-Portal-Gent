using System.Text.Json;

namespace ParkingGent.Api.Services;

public sealed record PlaceHit(double Lat, double Lon, string Label);

/// <summary>
/// Zoekt een plaats op naam ("Kuipke", "De Vierde Zaal") in OpenStreetMap, beperkt tot de omgeving van Gent.
/// Dit gebeurt op de server: Nominatim weigert aanvragen zonder herkenbare User-Agent, en dat is wat een
/// telefoon rechtstreeks stuurt.
/// </summary>
public static class PlaceLookup
{
    private const string UserAgent = "ParkingGent/2.0";

    public static async Task<PlaceHit?> FindAsync(HttpClient http, string name, CancellationToken ct) =>
        await Nominatim(http, name, ct) ?? await Photon(http, name, ct);

    private static async Task<PlaceHit?> Nominatim(HttpClient http, string name, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=3.55,51.15,3.9,50.96&q={Uri.EscapeDataString(name)}");
        request.Headers.UserAgent.ParseAdd(UserAgent);
        using var res = await http.SendAsync(request, ct);
        if (!res.IsSuccessStatusCode) return null;

        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        foreach (var hit in doc.RootElement.EnumerateArray())
        {
            if (double.TryParse(hit.GetProperty("lat").GetString(), System.Globalization.CultureInfo.InvariantCulture, out var lat)
                && double.TryParse(hit.GetProperty("lon").GetString(), System.Globalization.CultureInfo.InvariantCulture, out var lon))
                return new PlaceHit(lat, lon, hit.TryGetProperty("display_name", out var label) ? label.GetString() ?? name : name);
        }
        return null;
    }

    // Photon kent ook zaken die onder een samengeschreven naam of zonder soortwoord in OpenStreetMap staan.
    // Alleen treffers waarvan de naam echt op de gezochte lijkt tellen; anders krijg je een straat of een
    // stad met dezelfde klank.
    private static async Task<PlaceHit?> Photon(HttpClient http, string name, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"https://photon.komoot.io/api/?limit=5&lat=51.05&lon=3.72&bbox=3.55,50.96,3.9,51.15&q={Uri.EscapeDataString(name)}");
        request.Headers.UserAgent.ParseAdd(UserAgent);
        using var res = await http.SendAsync(request, ct);
        if (!res.IsSuccessStatusCode) return null;

        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        if (!doc.RootElement.TryGetProperty("features", out var features)) return null;

        var want = Squash(System.Text.RegularExpressions.Regex.Replace(name, @"\s+(in\s+)?(gent|ghent)$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase));
        foreach (var f in features.EnumerateArray())
        {
            var props = f.GetProperty("properties");
            var got = Squash(Text(props, "name"));
            if (got.Length < 5 || want.Length < 5 || !(got.Contains(want) || want.Contains(got))) continue;

            var coords = f.GetProperty("geometry").GetProperty("coordinates");
            var street = string.Join(' ', new[] { Text(props, "street"), Text(props, "housenumber") }.Where(s => s.Length > 0));
            var label = string.Join(", ", new[] { Text(props, "name"), street, Text(props, "city") }.Where(s => s.Length > 0));
            return new PlaceHit(coords[1].GetDouble(), coords[0].GetDouble(), label);
        }
        return null;
    }

    private static string Text(JsonElement props, string key) =>
        props.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static string Squash(string value)
    {
        var decomposed = value.Normalize(System.Text.NormalizationForm.FormD);
        var sb = new System.Text.StringBuilder();
        foreach (var c in decomposed)
        {
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.NonSpacingMark) continue;
            if (char.IsAsciiLetterOrDigit(c)) sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }
}
