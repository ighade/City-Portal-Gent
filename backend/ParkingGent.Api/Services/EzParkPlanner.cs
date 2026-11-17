using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

public sealed record EzParkRequest(
    double StartLat,
    double StartLon,
    double EndLat,
    double EndLon,
    int DepartInMinutes = 0,
    bool AvoidLez = true);

/// <summary>Coordinates are [lat, lon], same as the transit legs.</summary>
public sealed record EzParkLeg(
    string Mode,
    string? Line,
    string From,
    string To,
    DateTime DepartureAt,
    DateTime ArrivalAt,
    double DistanceKm,
    double[][] Coordinates,
    string? Color = null);

/// <summary>One way to finish the trip from a parking: "walk" or "transit".</summary>
public sealed record EzParkVariant(
    string Type,
    DateTime ArrivalAt,
    double TotalMinutes,
    EzParkLeg[] Legs);

public sealed record EzParkOption(
    string Slug,
    string Name,
    string? Address,
    double Lat,
    double Lon,
    int? Available,
    int Capacity,
    double DriveMinutes,
    double DriveKm,
    int ParkMinutes,
    EzParkVariant[] Variants,
    ParkingRate? Rate,
    ManualParkingRateDto? ManualRate);

public sealed record EzParkResult(
    DateTime DepartureAt,
    EzParkOption[] Options,
    string? Warning);

public sealed class EzParkPlanner(
    AppDbContext db,
    RoutePlanner routes,
    TransitService transit,
    LowEmissionZone lez,
    CityRates cityRates,
    ILogger<EzParkPlanner> log)
{
    public const int ParkMinutes = 5;
    private const int Shortlist = 6;
    private const int Suggestions = 6;
    private const double WalkMetersPerSecond = 1.35;
    private static readonly TimeSpan RoutingBudget = TimeSpan.FromSeconds(12);

    public async Task<EzParkResult?> PlanAsync(EzParkRequest request, CancellationToken ct)
    {
        var departure = DateTime.Now.AddMinutes(Math.Clamp(request.DepartInMinutes, 0, 720));
        var utcNow = DateTime.UtcNow;

        var rows = await db.Parkings
            .AsNoTracking()
            .Include(p => p.Status)
            .Include(p => p.ManualRate)
            .Where(p => p.Kind != ParkingKind.Bicycle && p.IsPublic)
            .ToListAsync(ct);

        var open = rows.Where(p => p.Status is null
                ? true
                : p.Status.IsOpen
                    && !p.Status.TemporarilyClosed
                    && (!p.Status.IsPlausible || p.Status.AvailableSpaces > 0)
                    && utcNow - p.Status.MeasuredAtUtc <= Mapping.StaleAfter);

        if (request.AvoidLez)
        {
            var zone = await lez.GetAsync(ct);
            open = open.Where(p => p.InLowEmissionZone != true && !RoutePlanner.IsInsideLez(p.Latitude, p.Longitude, zone));
        }

        // Cheap straight-line estimate to keep the number of routing calls small.
        var candidates = open
            .OrderBy(p =>
                Haversine(request.StartLat, request.StartLon, p.Latitude, p.Longitude) * 1.3 / 8.3
                + Haversine(p.Latitude, p.Longitude, request.EndLat, request.EndLon) * 1.3 / 2.5)
            .Take(Shortlist)
            .ToList();

        if (candidates.Count == 0)
            return new EzParkResult(departure, [], "Geen open parkings met vrije plaatsen gevonden.");

        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        budget.CancelAfter(RoutingBudget);

        try
        {
            // Queue driving routes first: without one, an option cannot be offered at all.
            var drives = candidates.Select(p =>
                routes.PlanAsync(request.StartLat, request.StartLon, p.Latitude, p.Longitude, "car", false, budget.Token)).ToArray();
            var built = await Task.WhenAll(candidates.Select((p, i) =>
                TryBuildAsync(p, request, departure, drives[i], budget.Token, ct)));
            var options = built
                .Where(o => o.Option is not null)
                .Select(o => o.Option!)
                .OrderBy(o => o.Variants.Min(v => v.TotalMinutes))
                .Take(Suggestions)
                .ToArray();

            var warning = options.Length == 0
                ? "De routes konden niet berekend worden."
                : built.Any(o => o.Incomplete)
                    ? "Sommige routes of OV-opties konden niet worden berekend. Een wandelroute kan een schatting in rechte lijn zijn."
                    : null;
            if (budget.IsCancellationRequested && !ct.IsCancellationRequested)
                log.LogWarning("EZ Park-routing overschreed de tijdslimiet van {Seconds} seconden; {Count} opties beschikbaar.", RoutingBudget.TotalSeconds, options.Length);
            ct.ThrowIfCancellationRequested();
            return new EzParkResult(departure, options, warning);
        }
        finally
        {
            budget.Dispose();
        }
    }

    private async Task<(EzParkOption? Option, bool Incomplete)> TryBuildAsync(
        Parking p, EzParkRequest request, DateTime departure, Task<RoutePlanResult?> driveTask,
        CancellationToken budget, CancellationToken ct)
    {
        try { return await BuildAsync(p, request, departure, driveTask, budget, ct); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested && budget.IsCancellationRequested)
        {
            return (null, true);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "EZ Park-optie {Parking} kon niet berekend worden.", p.Name);
            return (null, true);
        }
    }

    private async Task<(EzParkOption? Option, bool Incomplete)> BuildAsync(
        Parking p, EzParkRequest request, DateTime departure, Task<RoutePlanResult?> driveTask,
        CancellationToken budget, CancellationToken ct)
    {
        var drive = await driveTask;
        if (drive is null) return (null, true);

        RoutePlanResult? walk = null;
        bool incomplete = false;
        if (!budget.IsCancellationRequested)
        {
            try
            {
                walk = await routes.PlanAsync(p.Latitude, p.Longitude, request.EndLat, request.EndLon, "foot-walking", false, budget);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested && budget.IsCancellationRequested)
            {
                incomplete = true;
            }
        }
        else
        {
            incomplete = true;
        }

        ct.ThrowIfCancellationRequested();

        var driveArrival = departure.AddMinutes(drive.DurationMinutes);
        var parked = driveArrival.AddMinutes(ParkMinutes);
        var start = "Start";
        var driveLeg = new EzParkLeg("drive", null, start, p.Name, departure, driveArrival, drive.DistanceKm, Flip(drive.Coordinates));
        var parkLeg = new EzParkLeg("park", null, p.Name, p.Name, driveArrival, parked, 0, []);

        var variants = new List<EzParkVariant>();

        var walkDistance = Haversine(p.Latitude, p.Longitude, request.EndLat, request.EndLon) * 1.3;
        var walkMinutes = walk?.DurationMinutes ?? walkDistance / WalkMetersPerSecond / 60d;
        var walkArrival = parked.AddMinutes(walkMinutes);
        var walkCoords = walk is null
            ? new[] { new[] { p.Latitude, p.Longitude }, new[] { request.EndLat, request.EndLon } }
            : Flip(walk.Coordinates);
        variants.Add(new EzParkVariant("walk", walkArrival, (walkArrival - departure).TotalMinutes,
        [
            driveLeg, parkLeg,
            new EzParkLeg("walk", null, p.Name, "Eindpunt", parked, walkArrival, walk?.DistanceKm ?? walkDistance / 1000d, walkCoords),
        ]));

        // Under ~400 m the bus stop is farther than the destination.
        if (walkDistance / 1.3 > 400 && !budget.IsCancellationRequested)
        {
            try
            {
                var ov = await transit.PlanAsync(p.Latitude, p.Longitude, request.EndLat, request.EndLon, budget, parked);
                if (ov is not null)
                {
                    var legs = new List<EzParkLeg> { driveLeg, parkLeg };
                    legs.AddRange(ov.Legs.Select(l => new EzParkLeg(
                        l.Mode,
                        l.Line,
                        l.From == "Start" ? p.Name : l.From,
                        l.To,
                        l.DepartureAt,
                        l.ArrivalAt,
                        l.DistanceKm,
                        l.Coordinates,
                        l.Color)));
                    variants.Add(new EzParkVariant("transit", ov.ArrivalAt, (ov.ArrivalAt - departure).TotalMinutes, legs.ToArray()));
                }
            }
            catch (TransitUnavailableException)
            {
                log.LogInformation("OV niet beschikbaar voor EZ Park-optie {Parking}.", p.Name);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested && budget.IsCancellationRequested)
            {
                incomplete = true;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "OV-route niet beschikbaar voor EZ Park-optie {Parking}; de wandeloptie blijft behouden.", p.Name);
            }
        }
        else if (walkDistance / 1.3 > 400 && budget.IsCancellationRequested)
        {
            incomplete = true;
        }

        ct.ThrowIfCancellationRequested();
        return (new EzParkOption(
            p.Slug, p.Name, p.Address, p.Latitude, p.Longitude,
            p.Status is { IsPlausible: true } ? p.Status.AvailableSpaces : null, p.Status?.TotalCapacity ?? p.Capacity,
            drive.DurationMinutes, drive.DistanceKm, ParkMinutes,
            variants.ToArray(),
            cityRates.For(p.Slug, parked),
            p.ManualRate?.ToDto()), incomplete);
    }

    private static double[][] Flip(double[][] lonLat) =>
        lonLat.Where(c => c.Length >= 2).Select(c => new[] { c[1], c[0] }).ToArray();

    private static double Haversine(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6_371_000d;
        var dLat = (lat2 - lat1) * Math.PI / 180d;
        var dLon = (lon2 - lon1) * Math.PI / 180d;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
            + Math.Cos(lat1 * Math.PI / 180d) * Math.Cos(lat2 * Math.PI / 180d) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }
}
