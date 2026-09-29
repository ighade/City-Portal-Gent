using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

/// <summary>
/// Haalt de twee lijsten van de stad op, legt ze over elkaar en zet het resultaat in de databank.
/// <para>
/// <b>Het koppelprobleem.</b> De catalogus en de realtime-meting noemen dezelfde parking anders:
/// "Dok Noord" tegenover "Dok noord", "Het Getouw" tegenover "Getouw", "Gent Sint-Pieters"
/// tegenover "B-Park Gent Sint-Pieters". Er wordt daarom gekoppeld op een <i>genormaliseerde</i>
/// naam (zonder accenten, leestekens en de woordjes "b-park", "parking", "het", "de"), en alleen
/// als die exact gelijk is. Staan er dan nog twee kandidaten — "Ledeberg" bestaat als P én als
/// P+R — dan beslist de afstand.
/// </para>
/// <para>
/// <b>Wat er opzettelijk níét gekoppeld wordt.</b> De realtime-lijst kent één "The Loop" met 2490
/// plaatsen; de catalogus kent The Loop A0, B, C en D, samen 2931. Dat is een optelsom, geen
/// parking, en de namen zijn niet gelijk, dus blijft "The Loop" een eigen rij en houden de vier
/// deelparkings hun capaciteit zonder bezetting. Een koppeling op afstand alleen zou de meting
/// aan een willekeurige van de vier hangen.
/// </para>
/// </summary>
public sealed class ParkingSync(
    AppDbContext db, GentOpenData gent, BicycleLocations bicycleLocations,
    IOptions<GentOptions> options, ILogger<ParkingSync> log)
{
    /// <summary>Hoe ver een naamgenoot maximaal mag liggen voor het toch dezelfde parking heet.</summary>
    private const double MaxMatchMeters = 2000;

    public async Task<SyncRun> RunAsync(string trigger, CancellationToken ct)
    {
        var run = new SyncRun { StartedUtc = DateTime.UtcNow, Trigger = trigger };
        var stopwatch = Stopwatch.StartNew();

        try
        {
            // Alle bronnen tegelijk; valt er één weg, dan is dat geen ronde zonder resultaat.
            var catalogueTask = gent.GetCatalogueAsync(ct);
            var liveTask = gent.GetLiveAsync(ct);
            var bicycleTask = gent.GetBicycleAsync(ct);
            await Task.WhenAll(catalogueTask, liveTask, bicycleTask);
            var catalogue = catalogueTask.Result;
            var live = liveTask.Result;
            var bicycle = bicycleTask.Result;

            run.CatalogueCount = catalogue.Count;
            run.LiveCount = live.Count + bicycle.Count;

            if (catalogue.Count == 0 && live.Count == 0)
            {
                throw new InvalidOperationException("Beide datasets kwamen leeg terug.");
            }

            var matches = Match(catalogue, live);
            var now = DateTime.UtcNow;
            matches.AddRange(MatchBicycles(bicycle, now));

            var existing = await db.Parkings.Include(p => p.Status).ToListAsync(ct);
            var byExternalId = existing.ToDictionary(p => p.ExternalId, StringComparer.Ordinal);
            var takenSlugs = existing.Select(p => p.Slug).ToHashSet(StringComparer.Ordinal);

            foreach (var m in matches)
            {
                var externalId = m.Catalogue?.ExternalId ?? m.Live!.ExternalId;

                if (!byExternalId.TryGetValue(externalId, out var parking))
                {
                    parking = new Parking
                    {
                        ExternalId = externalId,
                        FirstSeenUtc = now,
                        Slug = UniqueSlug(m.Name, m.Kind, takenSlugs),
                    };
                    db.Parkings.Add(parking);
                    byExternalId[externalId] = parking;
                }

                parking.Name = m.Name;
                parking.Kind = m.Kind;
                parking.Latitude = m.Latitude;
                parking.Longitude = m.Longitude;
                parking.LastSeenUtc = now;
                parking.HasLiveData = m.Live is not null;
                parking.IsPublic = m.IsPublic;

                // De catalogus is de betere bron voor het adres en de capaciteit; de meting voor de rest.
                parking.Address = m.Catalogue?.Address ?? m.Live?.Address ?? parking.Address;
                parking.Capacity = m.Catalogue?.Capacity is > 0 ? m.Catalogue.Capacity
                    : m.Live?.TotalCapacity is > 0 ? m.Live.TotalCapacity : parking.Capacity;
                parking.Url = m.Live?.Url ?? m.Catalogue?.Url ?? parking.Url;
                parking.Operator = m.Live?.Operator ?? parking.Operator;
                parking.OpeningHours = m.Live?.OpeningHours ?? parking.OpeningHours;
                parking.InLowEmissionZone = m.Live?.InLowEmissionZone ?? parking.InLowEmissionZone;
                parking.IsFree = m.Live?.IsFree ?? parking.IsFree;

                if (m.Live is not null)
                {
                    ApplyStatus(parking, m.Live, now);
                }
            }

            // Eerst bewaren: de metingen hebben de sleutels van nieuwe parkings nodig.
            await db.SaveChangesAsync(ct);

            run.MeasurementsAdded = await StoreMeasurementsAsync(matches, ct);
            run.MeasurementsPruned = await PruneAsync(ct);
            run.Ok = true;

            log.LogInformation(
                "Parkeerdata bijgewerkt: {Catalogue} uit de catalogus, {Live} met bezetting "
                + "(waarvan {Bicycle} fietsenstallingen), {Added} nieuwe metingen.",
                run.CatalogueCount, run.LiveCount, bicycle.Count, run.MeasurementsAdded);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            run.Ok = false;
            run.Message = ex.Message.Length > 900 ? ex.Message[..900] : ex.Message;
            log.LogWarning(ex, "De parkeerdata van Gent kon niet bijgewerkt worden; de vorige stand blijft staan.");
        }

        stopwatch.Stop();
        run.DurationMs = (int)stopwatch.ElapsedMilliseconds;
        db.Runs.Add(run);
        await db.SaveChangesAsync(CancellationToken.None);
        return run;
    }

    private static void ApplyStatus(Parking parking, LiveEntry live, DateTime now)
    {
        var (occupancy, plausible) = Occupancy(live.AvailableSpaces, live.TotalCapacity);

        parking.Status ??= new ParkingStatus { Parking = parking };
        parking.Status.AvailableSpaces = live.AvailableSpaces;
        parking.Status.TotalCapacity = live.TotalCapacity;
        parking.Status.OccupancyPct = occupancy;
        parking.Status.IsPlausible = plausible;
        parking.Status.IsOpen = live.IsOpen && !live.TemporarilyClosed;
        parking.Status.TemporarilyClosed = live.TemporarilyClosed;
        parking.Status.SourceTrend = live.Trend;
        parking.Status.MeasuredAtUtc = live.MeasuredAtUtc;
        parking.Status.FetchedAtUtc = now;
    }

    /// <summary>
    /// Hoe vol, uit vrij en totaal — en of dat te vertrouwen is.
    /// <para>
    /// Het veld <c>occupation</c> van de stad wordt hier <b>niet</b> gebruikt. B-Park Dampoort gaf
    /// op 29-09-2026 "142 vrij van 90 plaatsen" met <c>occupation: 0</c>, en dat leest als een
    /// lege parking terwijl het onzin is. Zelf rekenen legt de tegenspraak bloot: meer vrij dan
    /// totaal, dus <c>IsPlausible = false</c>, en dan toont het scherm het aantal vrije plaatsen
    /// zonder percentage in plaats van een groene bol.
    /// </para>
    /// </summary>
    internal static (short Occupancy, bool Plausible) Occupancy(int available, int total)
    {
        if (total <= 0 || available > total) return (0, false);
        var pct = (int)Math.Round((total - available) * 100.0 / total, MidpointRounding.AwayFromZero);
        return ((short)Math.Clamp(pct, 0, 100), true);
    }

    private async Task<int> StoreMeasurementsAsync(List<MatchedParking> matches, CancellationToken ct)
    {
        var withLive = matches.Where(m => m.Live is not null).ToList();
        if (withLive.Count == 0) return 0;

        var externalIds = withLive
            .Select(m => m.Catalogue?.ExternalId ?? m.Live!.ExternalId)
            .ToList();
        var ids = await db.Parkings
            .Where(p => externalIds.Contains(p.ExternalId))
            .Select(p => new { p.Id, p.ExternalId })
            .ToDictionaryAsync(x => x.ExternalId, x => x.Id, ct);

        // Wat we al hebben voor precies deze tijdstippen: de stad vernieuwt om de vijf minuten en
        // wij kijken even vaak, dus de helft van de rondes levert een meting die er al staat.
        var stamps = withLive.Select(m => m.Live!.MeasuredAtUtc).Distinct().ToList();
        var known = await db.Measurements
            .Where(m => stamps.Contains(m.MeasuredAtUtc))
            .Select(m => new { m.ParkingId, m.MeasuredAtUtc })
            .ToListAsync(ct);
        var knownSet = known.Select(k => (k.ParkingId, k.MeasuredAtUtc)).ToHashSet();

        var added = 0;
        foreach (var m in withLive)
        {
            var externalId = m.Catalogue?.ExternalId ?? m.Live!.ExternalId;
            if (!ids.TryGetValue(externalId, out var parkingId)) continue;

            var live = m.Live!;
            var (occupancy, plausible) = Occupancy(live.AvailableSpaces, live.TotalCapacity);
            // Een onmogelijke meting hoort niet in de reeks: ze zou het gemiddelde van de
            // trendgrafiek vervuilen met een parking die "leeg" leek.
            if (!plausible) continue;
            if (!knownSet.Add((parkingId, live.MeasuredAtUtc))) continue;

            db.Measurements.Add(new Measurement
            {
                ParkingId = parkingId,
                MeasuredAtUtc = live.MeasuredAtUtc,
                AvailableSpaces = live.AvailableSpaces,
                TotalCapacity = live.TotalCapacity,
                OccupancyPct = occupancy,
            });
            added++;
        }

        if (added > 0) await db.SaveChangesAsync(ct);
        return added;
    }

    /// <summary>
    /// Metingen ouder dan <see cref="GentOptions.RetentionDays"/> gaan eruit. Vijftig parkings maal
    /// 288 metingen per dag is ruim 14 000 rijen per dag; zonder opruimen groeit dat ongemerkt door.
    /// De trendgrafieken rekenen op dit venster, dus korter maken maakt ze dunner.
    /// </summary>
    private async Task<int> PruneAsync(CancellationToken ct)
    {
        var cutoff = DateTime.UtcNow.AddDays(-Math.Max(7, options.Value.RetentionDays));
        var removed = await db.Measurements.Where(m => m.MeasuredAtUtc < cutoff).ExecuteDeleteAsync(ct);
        // Het logboek van de ophaalrondes mag ook niet eeuwig groeien.
        await db.Runs.Where(r => r.StartedUtc < DateTime.UtcNow.AddDays(-30)).ExecuteDeleteAsync(ct);
        return removed;
    }

    // ---------- koppelen ----------

    private sealed record MatchedParking(
        string Name, ParkingKind Kind, double Latitude, double Longitude,
        CatalogueEntry? Catalogue, LiveEntry? Live, bool IsPublic = true);

    /// <summary>
    /// De gemeten fietsenstallingen, gekoppeld aan hun coördinaat uit
    /// <c>seed/fietsenstallingen.json</c>. Zonder coördinaat gaat een stalling er niet in: een
    /// speld met een geraden plaats is slechter dan geen speld.
    /// </summary>
    private List<MatchedParking> MatchBicycles(List<BicycleEntry> bicycle, DateTime now)
    {
        var result = new List<MatchedParking>(bicycle.Count);

        foreach (var b in bicycle)
        {
            var where = bicycleLocations.Find(b.Key);
            if (where is null)
            {
                log.LogWarning(
                    "Fietsenstalling {Naam} (sleutel {Sleutel}) staat niet in de coördinatenlijst en blijft van de kaart. "
                    + "Voeg haar toe aan seed/fietsenstallingen.json, mét herkomst.",
                    b.Name, b.Key);
                continue;
            }

            // De fietsdatasets dragen geen openingsuren, geen LEZ en geen trend; wat ze wél geven
            // is capaciteit en vrije plaatsen, en dat is waar het om gaat.
            var live = new LiveEntry(
                ExternalId: $"fiets:{b.Key}",
                Name: where.Name,
                Latitude: where.Latitude,
                Longitude: where.Longitude,
                AvailableSpaces: b.AvailableSpaces,
                TotalCapacity: b.TotalCapacity,
                IsOpen: true,
                TemporarilyClosed: false,
                Trend: null,
                Address: where.Address,
                Url: where.Url,
                Operator: where.Operator,
                OpeningHours: null,
                InLowEmissionZone: null,
                IsFree: true,
                // De Stadskantoor-dataset draagt geen tijdstip; dan is het ophaalmoment het beste
                // dat er is. Zie GentOpenData.GetBicycleAsync.
                MeasuredAtUtc: b.MeasuredAtUtc ?? now);

            result.Add(new MatchedParking(
                where.Name, ParkingKind.Bicycle, where.Latitude, where.Longitude,
                Catalogue: null, Live: live, IsPublic: where.IsPublic));
        }

        return result;
    }

    private List<MatchedParking> Match(List<CatalogueEntry> catalogue, List<LiveEntry> live)
    {
        var result = new List<MatchedParking>(catalogue.Count + live.Count);
        var usedLive = new HashSet<string>(StringComparer.Ordinal);

        // Naamgenoten uit de catalogus, gegroepeerd op de genormaliseerde naam.
        var byName = catalogue
            .GroupBy(c => Normalize(c.Name), StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        foreach (var entry in catalogue)
        {
            var key = Normalize(entry.Name);
            var candidates = live
                .Where(l => !usedLive.Contains(l.ExternalId) && Normalize(l.Name) == key)
                .ToList();

            LiveEntry? chosen = null;
            if (candidates.Count > 0)
            {
                // Bij naamgenoten (Ledeberg als P en als P+R) beslist de afstand.
                var nearest = candidates
                    .Select(l => (Live: l, Meters: Distance(entry.Latitude, entry.Longitude, l.Latitude, l.Longitude)))
                    .OrderBy(x => x.Meters)
                    .First();
                if (nearest.Meters <= MaxMatchMeters)
                {
                    // Maar alleen als deze catalogusrij óók de naaste van de naamgenoten is.
                    var siblings = byName[key];
                    var closest = siblings
                        .OrderBy(c => Distance(c.Latitude, c.Longitude, nearest.Live.Latitude, nearest.Live.Longitude))
                        .First();
                    if (ReferenceEquals(closest, entry))
                    {
                        chosen = nearest.Live;
                        usedLive.Add(chosen.ExternalId);
                    }
                }
                else
                {
                    log.LogWarning(
                        "{Naam} heeft in beide bronnen dezelfde naam maar ligt {Meters:F0} m uiteen; niet gekoppeld.",
                        entry.Name, nearest.Meters);
                }
            }

            result.Add(new MatchedParking(
                // De catalogusnaam is de nettere ("Dok Noord", niet "Dok noord").
                Name: entry.Name, Kind: entry.Kind,
                Latitude: chosen?.Latitude ?? entry.Latitude,
                Longitude: chosen?.Longitude ?? entry.Longitude,
                Catalogue: entry, Live: chosen));
        }

        // Wat de realtime-lijst kent en de catalogus niet: "The Loop" (de optelsom van vier).
        foreach (var l in live.Where(l => !usedLive.Contains(l.ExternalId)))
        {
            log.LogInformation("{Naam} staat alleen in de realtime-lijst en krijgt een eigen rij.", l.Name);
            result.Add(new MatchedParking(l.Name, ParkingKind.Garage, l.Latitude, l.Longitude, null, l));
        }

        return result;
    }

    /// <summary>
    /// De naam zonder wat er per bron aan verschilt: accenten, leestekens, hoofdletters, en de
    /// woorden die de ene bron erbij zet en de andere niet.
    /// </summary>
    internal static string Normalize(string name)
    {
        var lower = name.ToLowerInvariant();
        foreach (var noise in new[] { "b-park", "bpark", "park and ride", "p+r", "parking", "het ", "de " })
        {
            lower = lower.Replace(noise, " ", StringComparison.Ordinal);
        }

        var decomposed = lower.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsLetterOrDigit(ch)) sb.Append(ch);
        }
        return sb.ToString();
    }

    /// <summary>Afstand in meters over de bol (haversine). Op deze schaal ruim nauwkeurig genoeg.</summary>
    internal static double Distance(double lat1, double lon1, double lat2, double lon2)
    {
        const double earthRadius = 6_371_000;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180)
                  * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return earthRadius * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static string UniqueSlug(string name, ParkingKind kind, HashSet<string> taken)
    {
        // "Ledeberg" bestaat als parking én als P+R; het voorvoegsel houdt hun adressen uit elkaar.
        var basis = kind switch
        {
            ParkingKind.ParkAndRide => $"p-r-{Slugger.Make(name)}",
            ParkingKind.Bicycle => $"fiets-{Slugger.Make(name)}",
            _ => Slugger.Make(name),
        };
        if (taken.Add(basis)) return basis;

        for (var n = 2; n < 100; n++)
        {
            var candidate = $"{basis}-{n}";
            if (taken.Add(candidate)) return candidate;
        }
        var fallback = $"{basis}-{Guid.NewGuid():N}"[..40];
        taken.Add(fallback);
        return fallback;
    }
}

/// <summary>Elke vijf minuten, en één keer kort na het opstarten.</summary>
public sealed class ParkingSyncService(
    IServiceScopeFactory scopes, IOptions<GentOptions> options, ILogger<ParkingSyncService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Even wachten: de migratie en de eenmalige inleesronde zijn dan klaar.
        try { await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken); }
        catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Clamp(options.Value.RefreshMinutes, 1, 60)));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<ParkingSync>().RunAsync("klok", stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex)
            {
                log.LogWarning(ex, "De ophaalronde liep vast; de volgende volgt over {Minuten} minuten.",
                    options.Value.RefreshMinutes);
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
