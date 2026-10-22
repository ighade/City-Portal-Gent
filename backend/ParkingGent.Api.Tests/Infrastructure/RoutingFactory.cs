using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Tests.Infrastructure;

/// <summary>
/// Voor de route-eindpunten: een nep-OpenRouteService met sleutel, een LEZ-vlak
/// (lengte 3,70–3,72, breedte 51,03–51,05) en parkings in en buiten die zone.
/// </summary>
public class RoutingFactory : ApiFactory
{
    public const string OrsKey = "ors-test-key";

    public static readonly object LezRecord = new
    {
        zone = "LEZ1",
        geometry = new
        {
            type = "Feature",
            geometry = new
            {
                type = "Polygon",
                coordinates = new[] { new[] { new[] { 3.70, 51.03 }, new[] { 3.72, 51.03 }, new[] { 3.72, 51.05 }, new[] { 3.70, 51.05 }, new[] { 3.70, 51.03 } } },
            },
        },
    };

    public static HttpResponseMessage OrsRoute(double meters = 1200, double seconds = 300) => StubHandler.Respond(HttpStatusCode.OK, new
    {
        features = new[]
        {
            new
            {
                geometry = new { type = "LineString", coordinates = new[] { new[] { 3.70, 51.00 }, new[] { 3.71, 51.01 } } },
                properties = new { summary = new { distance = meters, duration = seconds } },
            },
        },
    });

    protected override void Configure(Dictionary<string, string?> settings) => settings["RoutePlanner:ApiKey"] = OrsKey;

    protected override void ConfigureFakes()
    {
        Gent.Datasets["lage-emissie-zone-gent"] = [LezRecord];
        Ors.Responder = _ => OrsRoute();
    }

    protected override async Task SeedAsync(AppDbContext db)
    {
        var now = DateTime.UtcNow;
        db.Parkings.AddRange(
            Ez("ez-outside-open", 51.0600, 3.7300, Status(40, 100, true, now)),
            Ez("ez-no-status", 51.0610, 3.7310, null),
            Ez("ez-inside-lez", 51.0400, 3.7100, Status(40, 100, true, now)),
            Ez("ez-closed", 51.0620, 3.7320, Status(40, 100, false, now)),
            Ez("ez-full", 51.0630, 3.7330, Status(0, 100, true, now)),
            Ez("ez-stale", 51.0640, 3.7340, Status(40, 100, true, now.AddHours(-2))),
            Ez("ez-private", 51.0650, 3.7350, Status(40, 100, true, now), isPublic: false),
            Ez("ez-bike", 51.0660, 3.7360, Status(40, 100, true, now), kind: ParkingKind.Bicycle));
        await db.SaveChangesAsync();
    }

    private static Parking Ez(string slug, double lat, double lon, ParkingStatus? status,
        bool isPublic = true, ParkingKind kind = ParkingKind.Garage) => new()
    {
        Slug = slug, ExternalId = "ext-" + slug, Name = slug, Kind = kind, Capacity = 100,
        Latitude = lat, Longitude = lon, IsPublic = isPublic, HasLiveData = status is not null,
        FirstSeenUtc = DateTime.UtcNow, LastSeenUtc = DateTime.UtcNow, Status = status,
    };

    private static ParkingStatus Status(int available, int total, bool open, DateTime measured) => new()
    {
        AvailableSpaces = available, TotalCapacity = total, IsPlausible = true, IsOpen = open,
        OccupancyPct = (short)((total - available) * 100 / total), MeasuredAtUtc = measured, FetchedAtUtc = measured,
    };
}

public class NoOrsKeyFactory : RoutingFactory
{
    protected override void Configure(Dictionary<string, string?> settings) => settings["RoutePlanner:ApiKey"] = "";
}

/// <summary>De Lijn-data is geïmporteerd: haltes en lijnen staan in de databank, verbindingen niet.</summary>
public class TransitStopsFactory : ApiFactory
{
    protected override async Task SeedAsync(AppDbContext db)
    {
        var now = DateTime.UtcNow;
        var line = new TransitRouteEntity { Id = "r1", Name = "Tram 1", Mode = "tram", UpdatedAtUtc = now };
        var zuid = new TransitStopEntity { Id = "s2", Name = "Zuid", Latitude = 51.0300, Longitude = 3.7000, UpdatedAtUtc = now };
        var centrum = new TransitStopEntity { Id = "s1", Name = "Centrum", Latitude = 51.0500, Longitude = 3.7200, UpdatedAtUtc = now };
        db.TransitRoutes.Add(line);
        db.TransitStops.AddRange(zuid, centrum);
        db.TransitStopRoutes.Add(new TransitStopRouteEntity { Stop = centrum, Route = line });
        await db.SaveChangesAsync();
    }
}
