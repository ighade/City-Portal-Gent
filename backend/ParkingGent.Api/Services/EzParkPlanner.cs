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
    double[][] Coordinates);

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
    int Available,
    int Capacity,
    double DriveMinutes,
    double DriveKm,
    int ParkMinutes,
    EzParkVariant[] Variants);

public sealed record EzParkResult(
    DateTime DepartureAt,
    EzParkOption[] Options,
    string? Warning);

public sealed class EzParkPlanner(
    AppDbContext db,
    RoutePlanner routes,
    TransitService transit,
    LowEmissionZone lez,
    ILogger<EzParkPlanner> log)
{
    public const int ParkMinutes = 5;
    private const int Shortlist = 4;
    private const int Suggestions = 3;
    private const double WalkMetersPerSecond = 1.35;

    public async Task<EzParkResult?> PlanAsync(EzParkRequest request, CancellationToken ct)
    {
        var departure = DateTime.Now.AddMinutes(Math.Clamp(request.DepartInMinutes, 0, 720));
        var utcNow = DateTime.UtcNow;

        var rows = await db.Parkings
            .Include(p => p.Status)
            .AsNoTracking()
            .Where(p => p.Kind != ParkingKind.Bicycle && p.IsPublic && p.Status != null)
            .ToListAsync(ct);

        var open = rows.Where(p =>
            p.Status!.IsOpen
            && !p.Status.TemporarilyClosed
            && p.Status.IsPlausible
            && p.Status.AvailableSpaces > 0
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

        var built = await Task.WhenAll(candidates.Select(p => BuildAsync(p, request, departure, ct)));
        var options = built
            .Where(o => o is not null)
            .Select(o => o!)
            .OrderBy(o => o.Variants.Min(v => v.TotalMinutes))
            .Take(Suggestions)
            .ToArray();

        return new EzParkResult(departure, options, options.Length == 0 ? "De routes konden niet berekend worden." : null);
    }

    private async Task<EzParkOption?> BuildAsync(Parking p, EzParkRequest request, DateTime departure, CancellationToken ct)
    {
        var driveTask = routes.PlanAsync(request.StartLat, request.StartLon, p.Latitude, p.Longitude, "car", false, ct);
        var walkTask = routes.PlanAsync(p.Latitude, p.Longitude, request.EndLat, request.EndLon, "foot-walking", false, ct);
        var drive = await driveTask;
        var walk = await walkTask;
        if (drive is null) return null;

        var driveArrival = departure.AddMinutes(drive.DurationMinutes);
        var parked = driveArrival.AddMinutes(ParkMinutes);
        var start = "Start";
        var driveLeg = new EzParkLeg("drive", null, start, p.Name, departure, driveArrival, drive.DistanceKm, Flip(drive.Coordinates));
        var parkLeg = new EzParkLeg("park", null, p.Name, p.Name, driveArrival, parked, 0, []);

        var variants = new List<EzParkVariant>();

        var walkMinutes = walk?.DurationMinutes
            ?? Haversine(p.Latitude, p.Longitude, request.EndLat, request.EndLon) * 1.3 / WalkMetersPerSecond / 60d;
        var walkArrival = parked.AddMinutes(walkMinutes);
        var walkCoords = walk is null
            ? new[] { new[] { p.Latitude, p.Longitude }, new[] { request.EndLat, request.EndLon } }
            : Flip(walk.Coordinates);
        variants.Add(new EzParkVariant("walk", walkArrival, (walkArrival - departure).TotalMinutes,
        [
            driveLeg, parkLeg,
            new EzParkLeg("walk", null, p.Name, "Eindpunt", parked, walkArrival, walk?.DistanceKm ?? 0, walkCoords),
        ]));

        // Under ~400 m the bus stop is farther than the destination.
        if (Haversine(p.Latitude, p.Longitude, request.EndLat, request.EndLon) > 400)
        {
            try
            {
                var ov = await transit.PlanAsync(p.Latitude, p.Longitude, request.EndLat, request.EndLon, ct, parked);
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
                        l.Coordinates)));
                    variants.Add(new EzParkVariant("transit", ov.ArrivalAt, (ov.ArrivalAt - departure).TotalMinutes, legs.ToArray()));
                }
            }
            catch (TransitUnavailableException)
            {
                log.LogInformation("OV niet beschikbaar voor EZ Park-optie {Parking}.", p.Name);
            }
        }

        return new EzParkOption(
            p.Slug, p.Name, p.Address, p.Latitude, p.Longitude,
            p.Status!.AvailableSpaces, p.Status.TotalCapacity,
            drive.DurationMinutes, drive.DistanceKm, ParkMinutes,
            variants.ToArray());
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
