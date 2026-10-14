using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

public sealed record TariffZoneShape(string Id, string? Zone, string? Subzone, JsonElement Geometry);

public sealed record StreetTariffDto(string Period, int Hours, decimal AmountEur);

public sealed record StreetParkingDto(
    string Zone,
    string Name,
    string? Subzone,
    bool PaidNow,
    string Rules,
    string[] Notes,
    StreetTariffDto[] Tariffs,
    string SourceUrl);

/// <summary>
/// De tariefzones voor straatparkeren, op dezelfde manier bijgehouden als <see cref="LowEmissionZone"/>:
/// een dag lang hergebruikt, en de laatst gelukte versie blijft staan als de stad wegvalt.
/// </summary>
public sealed class StreetParkingZones(IServiceScopeFactory scopes, ILogger<StreetParkingZones> log)
{
    public const string SourceUrl = "https://stad.gent/nl/mobiliteit-openbare-werken/parkeren/parkeren-op-straat/parkeertarieven-op-straat";

    private static readonly TimeSpan MaxAge = TimeSpan.FromHours(24);
    private static readonly string[] Priority = ["rood", "oranje", "geel", "groen", "blauw"];

    /// <summary>Lokale tijd in Gent; valt terug op de servertijd als de tijdzone ontbreekt in de container.</summary>
    public static DateTime LocalTime(DateTime utc)
    {
        try { return TimeZoneInfo.ConvertTimeFromUtc(utc, TimeZoneInfo.FindSystemTimeZoneById("Europe/Brussels")); }
        catch (TimeZoneNotFoundException) { return utc.ToLocalTime(); }
    }

    private readonly SemaphoreSlim gate = new(1, 1);
    private List<TariffZoneShape>? zones;
    private List<StreetParkingTariff>? tariffs;
    private DateTime fetchedUtc = DateTime.MinValue;

    /// <summary>De zone op dit punt met haar tarieven, of null als het punt in geen tariefzone ligt.</summary>
    public async Task<StreetParkingDto?> FindAsync(double lat, double lon, DateTime localTime, CancellationToken ct)
    {
        await EnsureLoadedAsync(ct);
        if (zones is null || tariffs is null) return null;

        var hits = zones
            .Select(z => (Zone: z, Key: KeyOf(z.Id)))
            .Where(x => x.Key is not null && Contains(x.Zone.Geometry, lat, lon))
            .OrderBy(x => Array.IndexOf(Priority, x.Key))
            .ToList();
        if (hits.Count == 0) return null;

        var (shape, key) = hits[0];
        var notes = new List<string>();
        var sub = shape.Subzone?.Trim();
        if (sub is not null && sub.Contains("commerci", StringComparison.OrdinalIgnoreCase))
            notes.Add("Commerciële straat: tussen 9 en 19 u maximaal 3 uur parkeren, langparkeren is niet mogelijk.");
        if (sub is not null && sub.Contains("bewoner", StringComparison.OrdinalIgnoreCase))
            notes.Add("Bewonersparkeerzone: bewoners met vergunning parkeren er gratis.");
        notes.Add("Deze info is indicatief; de verkeersborden op straat hebben altijd voorrang.");

        return new StreetParkingDto(
            key!,
            shape.Zone ?? key!,
            string.IsNullOrWhiteSpace(sub) ? null : sub,
            IsPaid(key!, localTime),
            Rules(key!),
            notes.ToArray(),
            tariffs.Where(t => t.Zone == key)
                .OrderBy(t => t.Period).ThenBy(t => t.Hours)
                .Select(t => new StreetTariffDto(t.Period, t.Hours, t.AmountEur))
                .ToArray(),
            SourceUrl);
    }

    private static string? KeyOf(string id)
    {
        var u = id.ToUpperInvariant();
        if (u.Contains("ROOD")) return "rood";
        if (u.Contains("ORANJE")) return "oranje";
        if (u.Contains("GEEL")) return "geel";
        if (u.Contains("GROEN")) return "groen";
        if (u.Contains("BLAUW")) return "blauw";
        return null;
    }

    // Feestdagen worden niet herkend; alleen zondag.
    private static bool IsPaid(string key, DateTime t) => key switch
    {
        "rood" or "oranje" => t.Hour is >= 9 and < 23,
        "geel" or "groen" => t.DayOfWeek != DayOfWeek.Sunday && t.Hour is >= 9 and < 19,
        _ => false,
    };

    private static string Rules(string key) => key switch
    {
        "rood" => "Betalend elke dag van 9 tot 23 u. Maximaal 3 uur tussen 9 en 19 u. Gratis van 23 tot 9 u. Gratis ticket: 2 × 20 minuten per dag.",
        "oranje" => "Betalend elke dag van 9 tot 23 u. Maximaal 5 uur tussen 9 en 19 u. Gratis van 23 tot 9 u. Gratis ticket: 2 × 20 minuten per dag.",
        "geel" => "Betalend maandag t.e.m. zaterdag van 9 tot 19 u. Maximaal 5 uur. Gratis van 19 tot 9 u en op zon- en feestdagen. Gratis ticket: 2 × 20 minuten per dag.",
        "groen" => "Betalend maandag t.e.m. zaterdag van 9 tot 19 u. Gratis van 19 tot 9 u en op zon- en feestdagen. Gratis ticket: 2 × 30 minuten per dag.",
        _ => "Niet betalend. Maximaal 2 uur met parkeerschijf van 9 tot 18 u, tenzij anders aangegeven. Onbeperkt van 18 tot 9 u en op zon- en feestdagen.",
    };

    private async Task EnsureLoadedAsync(CancellationToken ct)
    {
        if (zones is not null && DateTime.UtcNow - fetchedUtc < MaxAge) return;

        await gate.WaitAsync(ct);
        try
        {
            if (zones is not null && DateTime.UtcNow - fetchedUtc < MaxAge) return;

            using var scope = scopes.CreateScope();
            var fresh = await scope.ServiceProvider.GetRequiredService<GentOpenData>().GetParkingTariffZonesAsync(ct);
            if (fresh.Count == 0)
            {
                log.LogWarning("De parkeertariefzones kwamen leeg terug; de vorige versie blijft staan.");
                return;
            }

            tariffs = await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .StreetParkingTariffs.AsNoTracking().ToListAsync(ct);
            zones = fresh;
            fetchedUtc = DateTime.UtcNow;
            log.LogInformation("Parkeertariefzones opgehaald: {Aantal} vlakken.", fresh.Count);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "De parkeertariefzones konden niet opgehaald worden; de vorige versie blijft staan.");
        }
        finally
        {
            gate.Release();
        }
    }

    private static bool Contains(JsonElement geometry, double lat, double lon)
    {
        if (geometry.ValueKind != JsonValueKind.Object || !geometry.TryGetProperty("type", out var type)) return false;
        if (!geometry.TryGetProperty("coordinates", out var coords)) return false;

        switch (type.GetString())
        {
            case "Polygon":
                return InPolygon(coords, lat, lon);
            case "MultiPolygon":
                foreach (var polygon in coords.EnumerateArray())
                    if (InPolygon(polygon, lat, lon)) return true;
                return false;
            default:
                return false;
        }
    }

    // Eerste ring is de buitenrand, de rest zijn gaten.
    private static bool InPolygon(JsonElement rings, double lat, double lon)
    {
        var first = true;
        foreach (var ring in rings.EnumerateArray())
        {
            var inside = InRing(ring, lat, lon);
            if (first)
            {
                if (!inside) return false;
                first = false;
            }
            else if (inside)
            {
                return false;
            }
        }

        return !first;
    }

    private static bool InRing(JsonElement ring, double lat, double lon)
    {
        var pts = new List<(double X, double Y)>();
        foreach (var p in ring.EnumerateArray())
        {
            if (p.ValueKind != JsonValueKind.Array || p.GetArrayLength() < 2) continue;
            pts.Add((p[0].GetDouble(), p[1].GetDouble()));
        }

        var inside = false;
        for (int i = 0, j = pts.Count - 1; i < pts.Count; j = i++)
        {
            if ((pts[i].Y > lat) != (pts[j].Y > lat)
                && lon < (pts[j].X - pts[i].X) * (lat - pts[i].Y) / (pts[j].Y - pts[i].Y) + pts[i].X)
            {
                inside = !inside;
            }
        }

        return inside;
    }
}
