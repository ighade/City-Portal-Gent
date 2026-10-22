using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Tests.Infrastructure;

/// <summary>
/// Een vaste, kleine wereld. De som van de getallen hieronder staat in de stats-tests:
/// <list type="bullet">
/// <item>Garage A: 100 van 500 vrij, open, vers (dit is ook de parking met metingen)</item>
/// <item>Garage B: 50 van 100 vrij, open, meting van een uur oud (dus "stale")</item>
/// <item>Garage C: 150 vrij van 90 — onmogelijk, dus niet geloofwaardig</item>
/// <item>Garage D: 0 van 200 vrij, gesloten</item>
/// <item>P+R E: alleen capaciteit, geen meting</item>
/// <item>Fiets F: openbaar, 20 van 100 vrij · Fiets G: personeel, 5 van 50 · Fiets H: openbaar maar onmogelijk (90 van 10)</item>
/// </list>
/// </summary>
public class SeededFactory : ApiFactory
{
    public static readonly DateTime Now = DateTime.UtcNow;

    public const string EventUpcoming = "ev-upcoming";
    public const string EventPast = "ev-past";
    public const string EventUndated = "ev-undated";
    public const string EventWithDescription = "ev-described";
    public const string EventFailing = "ev-failing";
    public const string EventEmptyDescription = "ev-empty";

    /// <summary>Drie metingen in hetzelfde uur van dezelfde weekdag, 10 dagen geleden: één vakje in de trend.</summary>
    public static readonly DateTime TrendHourUtc = new(Now.AddDays(-10).Year, Now.AddDays(-10).Month, Now.AddDays(-10).Day, Now.AddDays(-10).Hour, 0, 0, DateTimeKind.Utc);

    protected override async Task SeedAsync(AppDbContext db)
    {
        var a = Parking("t-garage-a", "Garage A", ParkingKind.Garage, 500, Status(100, 500, plausible: true, open: true, Now));
        var b = Parking("t-garage-b", "Garage B", ParkingKind.Garage, 100, Status(50, 100, true, true, Now.AddHours(-1)));
        var c = Parking("t-garage-c", "Garage C", ParkingKind.Garage, 90, Status(150, 90, false, true, Now));
        var d = Parking("t-garage-d", "Garage D", ParkingKind.Garage, 200, Status(0, 200, true, false, Now));
        var e = Parking("t-pr-e", "P+R E", ParkingKind.ParkAndRide, 300, null);
        var f = Parking("t-bike-f", "Fiets F", ParkingKind.Bicycle, 100, Status(20, 100, true, true, Now));
        var g = Parking("t-bike-g", "Fiets G", ParkingKind.Bicycle, 50, Status(5, 50, true, true, Now));
        g.IsPublic = false;
        var h = Parking("t-bike-h", "Fiets H", ParkingKind.Bicycle, 10, Status(90, 10, false, true, Now));
        db.Parkings.AddRange(a, b, c, d, e, f, g, h);

        // Recent: vier punten in het laatste uur; ouder: 10 dagen (drie in één uur) en 200 dagen (buiten elke grens).
        foreach (var minutes in new[] { 5, 20, 40, 50 })
            a.Measurements.Add(Measurement(Now.AddMinutes(-minutes), 100 + minutes, 500, 80));
        a.Measurements.Add(Measurement(Now.AddHours(-30), 250, 500, 50));
        foreach (var (minute, occupancy) in new[] { (5, 20), (25, 40), (45, 60) })
            a.Measurements.Add(Measurement(TrendHourUtc.AddMinutes(minute), 0, 500, (short)occupancy));
        a.Measurements.Add(Measurement(Now.AddDays(-200), 0, 500, 100));

        var place = new EventPlaceEntity { Id = "place-1", Name = "Vooruit" };
        db.Events.AddRange(
            Event(EventUpcoming, "Concert", Now.AddDays(2), place),
            Event(EventPast, "Oud feest", Now.AddDays(-5), place, isPast: true),
            Event(EventUndated, "Zonder datum", null, null),
            Event(EventWithDescription, "Beschreven", Now.AddDays(3), null, description: "Al bewaard"),
            Event(EventFailing, "Mislukt", Now.AddDays(4), null),
            Event(EventEmptyDescription, "Zonder tekst", Now.AddDays(5), null));

        // Latere ronde dan de mislukte opstartronde, zodat /meta een bekende "laatste" heeft.
        db.Runs.Add(new SyncRun
        {
            StartedUtc = Now.AddMinutes(1), DurationMs = 12, Ok = true, Trigger = "test",
            LiveCount = 4, CatalogueCount = 5, MeasurementsAdded = 4,
        });
        await db.SaveChangesAsync();
    }

    protected override void ConfigureFakes()
    {
        Social.Responder = request =>
        {
            var id = System.Web.HttpUtility.ParseQueryString(request.RequestUri!.Query)["eventId"];
            return id switch
            {
                EventFailing => StubHandler.Respond(HttpStatusCode.InternalServerError),
                EventEmptyDescription => StubHandler.Respond(HttpStatusCode.OK, new { data = new { @event = new { description = (string?)null } } }),
                _ => StubHandler.Respond(HttpStatusCode.OK, new { data = new { @event = new { description = "  Een gezellig feest.  " } } }),
            };
        };
    }

    private static Parking Parking(string slug, string name, ParkingKind kind, int capacity, ParkingStatus? status) => new()
    {
        Slug = slug, ExternalId = "ext-" + slug, Name = name, Kind = kind, Capacity = capacity,
        Latitude = 51.05, Longitude = 3.72, HasLiveData = status is not null,
        FirstSeenUtc = Now, LastSeenUtc = Now, Status = status,
    };

    private static ParkingStatus Status(int available, int total, bool plausible, bool open, DateTime measured) => new()
    {
        AvailableSpaces = available, TotalCapacity = total, IsPlausible = plausible, IsOpen = open,
        OccupancyPct = (short)(plausible ? Math.Round((total - available) * 100.0 / total) : 0),
        MeasuredAtUtc = measured, FetchedAtUtc = measured,
    };

    private static Measurement Measurement(DateTime at, int available, int total, short occupancy) => new()
    {
        MeasuredAtUtc = at, AvailableSpaces = available, TotalCapacity = total, OccupancyPct = occupancy,
    };

    private static EventEntity Event(string id, string name, DateTime? start, EventPlaceEntity? place,
        bool isPast = false, string? description = null) => new()
    {
        Id = id, Url = "https://facebook.test/events/" + id, Name = name, StartsAtUtc = start, IsPast = isPast,
        Place = place, Description = description, DescriptionFetchedAtUtc = description is null ? null : Now,
        ImportedAtUtc = Now,
    };
}
