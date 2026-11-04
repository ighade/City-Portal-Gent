using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

/// <summary>Een stadstarief met het moment waarop het veranderde en voor het laatst gecontroleerd werd (null = ingebouwde waarde).</summary>
public sealed record CityRateEntry(string Key, RatePeriod[] Periods, DateTime? UpdatedAtUtc, DateTime? CheckedAtUtc);

/// <summary>
/// De garagetarieven van Stad Gent in het geheugen: de ingebouwde tabel, overschreven door wat in de
/// databank staat. Na een sync via <see cref="CityRateSync"/> is <see cref="LoadAsync"/> genoeg om ze te vernieuwen.
/// </summary>
public sealed class CityRates(IServiceScopeFactory scopes)
{
    private volatile CityRateEntry[] entries = Defaults();

    private static CityRateEntry[] Defaults() =>
        ParkingRates.Table.Select(t => new CityRateEntry(t.Key, t.Periods, null, null)).ToArray();

    public async Task LoadAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var rows = await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .CityParkingRates.AsNoTracking().ToListAsync(ct);

        var merged = Defaults().ToList();
        foreach (var row in rows)
        {
            var periods = JsonSerializer.Deserialize<RatePeriod[]>(row.PeriodsJson);
            if (periods is null || periods.Length != ParkingRates.Slots.Length) continue;
            var entry = new CityRateEntry(row.Key, periods, row.UpdatedAtUtc, row.CheckedAtUtc);
            var at = merged.FindIndex(e => e.Key == row.Key);
            if (at >= 0) merged[at] = entry;
            else merged.Add(entry);
        }
        entries = merged.ToArray();
    }

    public CityRateEntry? Find(string slug) =>
        entries.FirstOrDefault(e => slug.Contains(e.Key, StringComparison.OrdinalIgnoreCase));

    public ParkingRate? For(string slug, DateTime localTime) =>
        ParkingRates.For(slug, localTime, entries.Select(e => (e.Key, e.Periods)));
}

public sealed record CityRateSyncResult(bool Ok, int Parsed, int Changed, DateTime CheckedAtUtc, string? Message);

/// <summary>Leest de tariefpagina van Stad Gent en bewaart de uurtarieven per parking in de databank.</summary>
public sealed class CityRateSync(HttpClient http, AppDbContext db, CityRates store, ILogger<CityRateSync> log)
{
    public async Task<CityRateSyncResult> RunAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        List<ParsedRate> parsed;
        try
        {
            var html = await http.GetStringAsync(ParkingRates.SourceUrl, ct);
            parsed = CityRateParser.Parse(html);
        }
        catch (Exception ex) when (ex is HttpRequestException or FormatException or TaskCanceledException)
        {
            log.LogWarning(ex, "De tariefpagina van Stad Gent kon niet gelezen worden.");
            return new CityRateSyncResult(false, 0, 0, now, ex is FormatException
                ? "De tariefpagina heeft een onverwachte opbouw; niets is gewijzigd."
                : "De tariefpagina van Stad Gent is niet bereikbaar.");
        }

        var existing = await db.CityParkingRates.ToDictionaryAsync(r => r.Key, ct);
        var changed = 0;
        foreach (var rate in parsed)
        {
            var json = JsonSerializer.Serialize(rate.Periods);
            if (!existing.TryGetValue(rate.Key, out var row))
            {
                db.CityParkingRates.Add(new CityParkingRate
                {
                    Key = rate.Key, Name = rate.Name, PeriodsJson = json, UpdatedAtUtc = now, CheckedAtUtc = now,
                });
                changed++;
                continue;
            }
            row.CheckedAtUtc = now;
            row.Name = rate.Name;
            if (row.PeriodsJson == json) continue;
            row.PeriodsJson = json;
            row.UpdatedAtUtc = now;
            changed++;
        }
        await db.SaveChangesAsync(ct);
        await store.LoadAsync(ct);
        return new CityRateSyncResult(true, parsed.Count, changed, now, null);
    }
}

public sealed record ParsedRate(string Key, string Name, RatePeriod[] Periods);

/// <summary>Haalt de tabel "Tarieven per uur" uit de HTML van de tariefpagina. Bij twijfel een <see cref="FormatException"/>: liever niets opslaan.</summary>
public static partial class CityRateParser
{
    [GeneratedRegex(@"<table[^>]*>(.*?)</table>", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex Tables();
    [GeneratedRegex(@"<tr[^>]*>(.*?)</tr>", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex Rows();
    [GeneratedRegex(@"<t([hd])[^>]*>(.*?)</t\1>", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex Cells();
    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex Tags();
    [GeneratedRegex(@"(Max\.\s*)?€\s*(\d+(?:[.,]\d+)?)\s*/\s*uur", RegexOptions.IgnoreCase)]
    private static partial Regex Hourly();
    [GeneratedRegex(@"€\s*(\d+(?:[.,]\d+)?)\s*/\s*24\s*uur", RegexOptions.IgnoreCase)]
    private static partial Regex Day();
    [GeneratedRegex(@"(\d+)\s*uur en langer:\s*€\s*(\d+(?:[.,]\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex Extra();
    [GeneratedRegex(@"\b[A-Z]\b")]
    private static partial Regex Letter();

    public static List<ParsedRate> Parse(string html)
    {
        var table = Tables().Matches(html)
            .Select(m => m.Groups[1].Value)
            .FirstOrDefault(t => t.Contains("per uur", StringComparison.OrdinalIgnoreCase))
            ?? throw new FormatException("Tabel met uurtarieven niet gevonden.");

        var result = new List<ParsedRate>();
        foreach (Match row in Rows().Matches(table))
        {
            var cells = Cells().Matches(row.Groups[1].Value).Select(c => (Head: c.Groups[1].Value == "h", Text: Clean(c.Groups[2].Value))).ToList();
            if (cells.Count == 0 || cells.All(c => c.Head)) continue;
            if (cells.Count != 1 + ParkingRates.Slots.Length || !cells[0].Head)
                throw new FormatException("Een rij in de tarieventabel heeft een onverwachte opbouw.");

            var periods = ParkingRates.Slots.Select((slot, i) => ParsePeriod(slot, cells[i + 1].Text)).ToArray();
            foreach (var key in KeysFor(cells[0].Text))
                result.Add(new ParsedRate(key, cells[0].Text, periods));
        }

        if (result.Count < 8) throw new FormatException("De tarieventabel bevat te weinig parkings.");
        return result;
    }

    private static string Clean(string html) =>
        Regex.Replace(WebUtility.HtmlDecode(Tags().Replace(html, " ")).Replace('\u00a0', ' '), @"\s+", " ").Trim();

    private static RatePeriod ParsePeriod((string Key, string Label) slot, string text)
    {
        var hourly = Hourly().Match(text);
        if (!hourly.Success) throw new FormatException($"Geen uurtarief gevonden in \"{text}\".");
        var day = Day().Match(text);
        var extra = Extra().Match(text);
        return new RatePeriod(slot.Key, slot.Label, Number(hourly.Groups[2].Value), hourly.Groups[1].Success,
            day.Success ? Number(day.Groups[1].Value) : null,
            extra.Success ? $"{extra.Groups[1].Value} uur en langer: € {extra.Groups[2].Value}" : null);
    }

    private static decimal Number(string value) => decimal.Parse(value.Replace(',', '.'), CultureInfo.InvariantCulture);

    /// <summary>"Het Getouw" → getouw, "The Loop B &amp; C" → the-loop-b en the-loop-c. Sleutels worden met de slug van een parking vergeleken.</summary>
    private static IEnumerable<string> KeysFor(string name)
    {
        var trimmed = name.Trim();
        if (trimmed.StartsWith("The Loop", StringComparison.OrdinalIgnoreCase))
        {
            var letters = Letter().Matches(trimmed["The Loop".Length..]).Select(m => $"the-loop-{m.Value.ToLowerInvariant()}").ToList();
            if (letters.Count == 0) throw new FormatException($"Onbekende parking \"{name}\".");
            return letters;
        }
        var slug = Regex.Replace(trimmed.ToLowerInvariant(), @"^het\s+", "");
        return [Regex.Replace(slug, @"\s+", "-")];
    }
}
