using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

/// <summary>
/// Leest eenmalig de reeksen in die de stad zelf bewaart, zodat de trendgrafieken meteen iets
/// tonen in plaats van na een week meten.
/// <para>
/// Er zijn negen datasets <c>recente-bezetting-parking-*</c>, elk met de laatste 180 metingen —
/// ruim vijftien uur. Aan welke parking ze horen, staat alleen in hun naam: uit
/// <c>recente-bezetting-parking-savaanstraat-gent</c> valt "savaanstraat" te halen, en dat moet
/// bij de parking "Savaan" landen. Vandaar eerst een exacte vergelijking op de genormaliseerde
/// naam en daarna een vergelijking op het begin ervan.
/// </para>
/// <para>
/// Dit draait alleen voor parkings die nog zo goed als geen geschiedenis hebben. De drempel is
/// een <i>aantal</i> en niet "nul metingen": de ophaalronde bij het opstarten zet er al één per
/// parking neer, en met "nul" zou deze stap zichzelf meteen uitschakelen. Boven de drempel voegt
/// ze niets toe — de unieke index weigert dubbels — en haalt ze negen datasets op voor niets.
/// </para>
/// </summary>
public sealed class Backfill(AppDbContext db, GentOpenData gent, ILogger<Backfill> log)
{
    private const string Prefix = "recente-bezetting-parking-";

    /// <summary>
    /// Tot hoeveel metingen een parking als "zonder geschiedenis" telt. Eén ophaalronde levert er
    /// één per parking; twaalf is dus een uur meten, ruim onder de 180 die hier te halen zijn.
    /// </summary>
    private const int SparseThreshold = 12;

    public async Task<int> RunAsync(CancellationToken ct)
    {
        var candidates = await db.Parkings
            .Where(p => p.HasLiveData && p.Measurements.Count < SparseThreshold)
            .Select(p => new { p.Id, p.Name, p.Slug })
            .ToListAsync(ct);

        if (candidates.Count == 0) return 0;

        var datasets = await gent.GetHistoryDatasetsAsync(ct);
        if (datasets.Count == 0)
        {
            log.LogInformation("Geen reeksen 'recente-bezetting-parking-*' gevonden; niets in te lezen.");
            return 0;
        }

        var normalized = candidates
            .Select(c => (c.Id, c.Name, Key: ParkingSync.Normalize(c.Name)))
            .ToList();

        var total = 0;
        foreach (var dataset in datasets)
        {
            var key = DatasetKey(dataset);
            if (key.Length == 0) continue;

            var match = normalized.FirstOrDefault(c => c.Key == key);
            if (match.Id == 0)
            {
                // "savaanstraat" tegenover "savaan": de dataset heet naar de straat, de parking niet.
                match = normalized.FirstOrDefault(c =>
                    key.StartsWith(c.Key, StringComparison.Ordinal) || c.Key.StartsWith(key, StringComparison.Ordinal));
            }
            if (match.Id == 0)
            {
                log.LogInformation("{Dataset} hoort bij geen bekende parking; overgeslagen.", dataset);
                continue;
            }

            try
            {
                var points = await gent.GetHistoryAsync(dataset, ct);
                var added = await StoreAsync(match.Id, points, ct);
                total += added;
                log.LogInformation("{Dataset} → {Naam}: {Aantal} metingen ingelezen.", dataset, match.Name, added);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "{Dataset} kon niet ingelezen worden; overgeslagen.", dataset);
            }
        }

        return total;
    }

    /// <summary>"recente-bezetting-parking-sint-michiels-gent" → "sintmichiels".</summary>
    internal static string DatasetKey(string datasetId)
    {
        if (!datasetId.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) return string.Empty;
        var middle = datasetId[Prefix.Length..];
        // Niet elke dataset eindigt op "-gent": 'recente-bezetting-parking-vrijdagmarkt' doet het niet.
        if (middle.EndsWith("-gent", StringComparison.OrdinalIgnoreCase)) middle = middle[..^5];
        return ParkingSync.Normalize(middle);
    }

    private async Task<int> StoreAsync(int parkingId, List<HistoryPoint> points, CancellationToken ct)
    {
        if (points.Count == 0) return 0;

        var known = await db.Measurements
            .Where(m => m.ParkingId == parkingId)
            .Select(m => m.MeasuredAtUtc)
            .ToListAsync(ct);
        var seen = known.ToHashSet();

        var added = 0;
        foreach (var p in points)
        {
            var (occupancy, plausible) = ParkingSync.Occupancy(p.AvailableSpaces, p.TotalCapacity);
            if (!plausible) continue;
            if (!seen.Add(p.MeasuredAtUtc)) continue;

            db.Measurements.Add(new Measurement
            {
                ParkingId = parkingId,
                MeasuredAtUtc = p.MeasuredAtUtc,
                AvailableSpaces = p.AvailableSpaces,
                TotalCapacity = p.TotalCapacity,
                OccupancyPct = occupancy,
            });
            added++;
        }

        if (added > 0) await db.SaveChangesAsync(ct);
        return added;
    }
}
