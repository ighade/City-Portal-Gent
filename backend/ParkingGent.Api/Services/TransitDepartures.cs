using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;

namespace ParkingGent.Api.Services;

public sealed record TransitDepartureDto(
    string Line,
    string Mode,
    string? Color,
    string Destination,
    DateTime ScheduledAt,
    DateTime ExpectedAt,
    int DelayMinutes,
    bool Canceled);

public sealed record TransitDeparturesResult(
    string StopId,
    string StopName,
    bool RealtimeAvailable,
    DateTime? RealtimeUpdatedAt,
    TransitDepartureDto[] Departures);

/// <summary>Het vertrekbord van één halte: de dienstregeling van vandaag met de De Lijn-realtime (vertraging, geschrapt) erover.</summary>
public sealed class TransitDepartures(AppDbContext db, TransitRealtimeFeed feed)
{
    // Een bus die 30 minuten te laat is, hoort nog op het bord terwijl hij gepland al weg was.
    private const int LookBackSeconds = 30 * 60;
    private const int LookAheadSeconds = 4 * 3600;

    public async Task<TransitDeparturesResult?> GetAsync(string stopId, int count, CancellationToken ct)
    {
        var stop = await db.TransitStops.AsNoTracking().FirstOrDefaultAsync(s => s.Id == stopId, ct);
        if (stop is null) return null;

        var realtime = await feed.GetAsync(ct);
        var now = DateTime.Now;
        var nowSeconds = (int)now.TimeOfDay.TotalSeconds;

        var scheduled = await db.TransitConnections.AsNoTracking()
            .Where(c => c.FromStopId == stopId
                && c.DepartureSeconds >= nowSeconds - LookBackSeconds
                && c.DepartureSeconds <= nowSeconds + LookAheadSeconds)
            .OrderBy(c => c.DepartureSeconds)
            .Take(300)
            .ToListAsync(ct);

        var upcoming = scheduled
            .Select(c =>
            {
                var scheduledAt = DateTime.Today.AddSeconds(c.DepartureSeconds);
                var canceled = realtime.IsCanceled(c.TripId, stopId);
                var delay = canceled ? 0 : realtime.DelayMinutes(c.TripId, stopId, new DateTimeOffset(scheduledAt).ToUnixTimeSeconds());
                return (Connection: c, ScheduledAt: scheduledAt, Expected: scheduledAt.AddMinutes(delay), Delay: delay, Canceled: canceled);
            })
            .Where(x => x.Expected >= now.AddMinutes(-1))
            .OrderBy(x => x.Expected)
            .Take(Math.Clamp(count, 1, 20))
            .ToList();

        var routeIds = upcoming.Select(x => x.Connection.RouteId).Distinct().ToList();
        var tripIds = upcoming.Select(x => x.Connection.TripId).Distinct().ToList();
        var routes = await db.TransitRoutes.AsNoTracking().Where(r => routeIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, ct);
        var legs = await db.TransitConnections.AsNoTracking()
            .Where(c => routeIds.Contains(c.RouteId) && tripIds.Contains(c.TripId))
            .Select(c => new { c.TripId, c.ToStopId, c.ArrivalSeconds })
            .ToListAsync(ct);
        var terminalByTrip = legs
            .GroupBy(l => l.TripId, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.MaxBy(l => l.ArrivalSeconds)!.ToStopId, StringComparer.Ordinal);
        var terminalIds = terminalByTrip.Values.Distinct().ToList();
        var terminalNames = await db.TransitStops.AsNoTracking()
            .Where(s => terminalIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, s => s.Name, ct);

        var departures = upcoming.Select(x =>
        {
            routes.TryGetValue(x.Connection.RouteId, out var route);
            var destination = terminalByTrip.TryGetValue(x.Connection.TripId, out var terminalId)
                ? terminalNames.GetValueOrDefault(terminalId, string.Empty)
                : string.Empty;
            return new TransitDepartureDto(
                route?.Name ?? x.Connection.RouteId,
                route?.Mode ?? "bus",
                route?.Color,
                destination,
                x.ScheduledAt,
                x.Expected,
                x.Delay,
                x.Canceled);
        }).ToArray();

        return new TransitDeparturesResult(
            stop.Id,
            stop.Name,
            realtime.Available,
            realtime.Available ? realtime.UpdatedAtUtc : null,
            departures);
    }
}
