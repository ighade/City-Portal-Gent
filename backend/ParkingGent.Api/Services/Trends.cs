using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;

namespace ParkingGent.Api.Services;

/// <summary>
/// Rekent uit de bewaarde metingen het gemiddelde per weekdag en uur: "hoe druk is het hier
/// normaal op donderdag om negen uur". Dat is wat de oorspronkelijke opzet niet kon — die had
/// alleen de stand van nu, en verzon voor straatparkings zelfs een bezetting met
/// <c>Math.random()</c>.
/// <para>
/// <b>Waarom de klok van Brussel en niet UTC.</b> Een parkeerdrukte hangt aan de plaatselijke
/// werkdag, niet aan de nulmeridiaan. In de zomer scheelt dat twee uur, en dan zou de ochtendpiek
/// in de grafiek een uur verspringen bij de overgang naar de wintertijd. Daarom wordt elk tijdstip
/// eerst naar de Belgische klok gezet en pas dan bij een uurvak gelegd.
/// </para>
/// <para>
/// <b>Waarom het in het geheugen gebeurt.</b> Honderdtwintig dagen maal 288 metingen is 35 000
/// rijen per parking — een index-scan van niets. Het in SQL doen zou een tijdzoneconversie per rij
/// vragen die per databank anders heet; dit blijft leesbaar en is snel genoeg. Bovendien hangt er
/// een antwoordcache voor.
/// </para>
/// </summary>
public sealed class Trends(AppDbContext db)
{
    /// <summary>
    /// De Belgische klok. In een Linux-container heet die zone "Europe/Brussels"; op Windows
    /// "Romance Standard Time". <c>FindSystemTimeZoneById</c> van .NET kent sinds .NET 6 beide
    /// namen op beide besturingssystemen, dus de eerste volstaat — met een terugval voor het geval
    /// de tijdzonedatabank in het beeld ontbreekt.
    /// </summary>
    private static readonly TimeZoneInfo Brussels = ResolveBrussels();

    /// <summary>Onder dit aantal metingen in een vakje is het gemiddelde geen gemiddelde.</summary>
    private const int MinimumSamples = 3;

    public async Task<TrendDto?> ForParkingAsync(string slug, int days, CancellationToken ct)
    {
        var parking = await db.Parkings
            .Where(p => p.Slug == slug)
            .Select(p => new { p.Id, p.Name })
            .FirstOrDefaultAsync(ct);
        if (parking is null) return null;

        days = Math.Clamp(days, 7, 120);
        var since = DateTime.UtcNow.AddDays(-days);

        var rows = await db.Measurements
            .Where(m => m.ParkingId == parking.Id && m.MeasuredAtUtc >= since)
            .Select(m => new { m.MeasuredAtUtc, m.OccupancyPct })
            .ToListAsync(ct);

        return new TrendDto(slug, parking.Name, days, Aggregate(rows.Select(r => (r.MeasuredAtUtc, r.OccupancyPct))));
    }

    public async Task<IReadOnlyList<PointDto>> HistoryAsync(string slug, int hours, CancellationToken ct)
    {
        hours = Math.Clamp(hours, 1, 24 * 14);
        var since = DateTime.UtcNow.AddHours(-hours);

        return await db.Measurements
            .Where(m => m.Parking.Slug == slug && m.MeasuredAtUtc >= since)
            .OrderBy(m => m.MeasuredAtUtc)
            .Select(m => new PointDto(m.MeasuredAtUtc, m.AvailableSpaces, m.OccupancyPct))
            .ToListAsync(ct);
    }

    private static List<TrendCellDto> Aggregate(IEnumerable<(DateTime AtUtc, short Occupancy)> rows)
    {
        // [weekdag 0..6 (maandag eerst), uur 0..23] → som en aantal.
        var sums = new long[7, 24];
        var counts = new int[7, 24];

        foreach (var (atUtc, occupancy) in rows)
        {
            var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(atUtc, DateTimeKind.Utc), Brussels);
            // DayOfWeek begint op zondag; de kalender hier begint op maandag.
            var weekday = ((int)local.DayOfWeek + 6) % 7;
            sums[weekday, local.Hour] += occupancy;
            counts[weekday, local.Hour]++;
        }

        var cells = new List<TrendCellDto>(7 * 24);
        for (var d = 0; d < 7; d++)
        {
            for (var h = 0; h < 24; h++)
            {
                if (counts[d, h] < MinimumSamples) continue;
                var average = (short)Math.Round((double)sums[d, h] / counts[d, h], MidpointRounding.AwayFromZero);
                cells.Add(new TrendCellDto(d, h, average, counts[d, h]));
            }
        }
        return cells;
    }

    private static TimeZoneInfo ResolveBrussels()
    {
        foreach (var id in new[] { "Europe/Brussels", "Romance Standard Time" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch (TimeZoneNotFoundException) { }
            catch (InvalidTimeZoneException) { }
        }
        // Liever een uur ernaast dan geen grafiek. Dit hoort niet voor te komen.
        return TimeZoneInfo.Utc;
    }
}
