using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;
using ParkingGent.Api.Services;

namespace ParkingGent.Api.Endpoints;

/// <summary>
/// De REST-laag. Eén regel bepaalt de vorm: <b>lezen is openbaar, schrijven niet</b>.
/// <para>
/// Dit is data van Stad Gent onder een open licentie, en een dashboard dat een Gentenaar moet
/// helpen een plaats te vinden heeft niets aan een aanmeldscherm. Alles onder <c>/api</c> is dus
/// vrij op te vragen. De drie knoppen die iets veranderen — nu ophalen, geschiedenis inlezen, het
/// logboek bekijken — hangen onder <c>/api/admin</c> en vragen een identiteit, en die komt alleen
/// binnen via de LAN-ingang <c>:8105</c> (zie <c>caddy/Caddyfile</c>).
/// </para>
/// </summary>
public static class Api
{
    public static void MapApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");

        // Openbaar, en met een antwoordcache: de stad vernieuwt om de vijf minuten, dus honderd
        // bezoekers in diezelfde minuut hoeven de databank niet honderd keer te bevragen.
        api.MapGet("/parkings", Parkings).CacheOutput("kort");
        api.MapGet("/parkings/{slug}", Detail).CacheOutput("kort");
        api.MapGet("/parkings/{slug}/history", History).CacheOutput("kort");
        api.MapGet("/parkings/{slug}/trend", Trend).CacheOutput("lang");
        api.MapGet("/stats", Stats).CacheOutput("kort");
        api.MapGet("/meta", Meta).CacheOutput("kort");
        api.MapGet("/geojson", GeoJson).CacheOutput("kort");
        // De lage-emissiezone verandert hooguit eens in de zoveel jaar; die mag lang blijven staan.
        api.MapGet("/lez", LowEmissionZone).CacheOutput("lang");
        api.MapGet("/transit/stops", TransitStops).CacheOutput("lang");
        api.MapGet("/transit/stops/{stopId}/realtime", TransitStopRealtime);
        api.MapGet("/transit/status", TransitStatus).CacheOutput("kort");
        api.MapPost("/transit/route", TransitRoute);
        api.MapPost("/route/plan", RoutePlan);
        api.MapPost("/route/ezpark", EzPark);

        var admin = api.MapGroup("/admin").AddEndpointFilter(async (ctx, next) =>
        {
            var caller = ctx.HttpContext.Items["caller"] as Caller;
            return caller is { IsAdmin: true } ? await next(ctx) : Results.Unauthorized();
        });
        admin.MapGet("/whoami", (HttpContext ctx) =>
        {
            var caller = (Caller)ctx.Items["caller"]!;
            return Results.Ok(new { caller.Email, caller.Name, caller.IsAdmin });
        });
        admin.MapPost("/sync", ManualSync);
        admin.MapPost("/backfill", ManualBackfill);
        admin.MapGet("/runs", Runs);
    }

    // ---------- openbaar ----------

    private static async Task<IResult> Parkings(AppDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var rows = await db.Parkings
            .Include(p => p.Status)
            .AsNoTracking()
            .OrderBy(p => p.Kind).ThenBy(p => p.Name)
            .ToListAsync(ct);
        return Results.Ok(rows.Select(p => p.ToDto(now)));
    }

    private static async Task<IResult> Detail(string slug, AppDbContext db, CancellationToken ct)
    {
        var parking = await db.Parkings
            .Include(p => p.Status)
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Slug == slug, ct);
        return parking is null
            ? Results.NotFound(new { error = "Die parking kennen we niet." })
            : Results.Ok(parking.ToDto(DateTime.UtcNow));
    }

    private static async Task<IResult> History(string slug, Trends trends, int? hours, CancellationToken ct)
        => Results.Ok(await trends.HistoryAsync(slug, hours ?? 24, ct));

    private static async Task<IResult> Trend(string slug, Trends trends, int? days, CancellationToken ct)
    {
        var trend = await trends.ForParkingAsync(slug, days ?? 60, ct);
        return trend is null ? Results.NotFound(new { error = "Die parking kennen we niet." }) : Results.Ok(trend);
    }

    private static async Task<IResult> Stats(AppDbContext db, CancellationToken ct)
    {
        var rows = await db.Parkings.Include(p => p.Status).AsNoTracking().ToListAsync(ct);
        // Auto's en fietsen worden nooit bij elkaar opgeteld: 486 fietsplaatsen bij 7 351
        // autoplaatsen leveren een getal op dat niemand kan gebruiken.
        var cars = rows.Where(p => p.Kind != ParkingKind.Bicycle).ToList();
        var bikes = rows.Where(p => p.Kind == ParkingKind.Bicycle && p.IsPublic
                                    && p.Status is { IsPlausible: true }).ToList();
        var bikeCapacity = bikes.Sum(p => p.Status!.TotalCapacity);
        var bikeAvailable = bikes.Sum(p => p.Status!.AvailableSpaces);

        var measured = cars.Where(p => p.Status is not null).ToList();
        // De optelsom telt alleen wat geloofwaardig gemeten is. Een parking zonder bezetting zou
        // anders haar hele capaciteit als "beschikbaar" opvoeren, en een meting die zichzelf
        // tegenspreekt (meer vrij dan plaatsen) zou de stad ruimer doen lijken dan ze is.
        var live = measured.Where(p => p.Status!.IsPlausible).ToList();

        var capacity = live.Sum(p => p.Status!.TotalCapacity);
        var available = live.Sum(p => p.Status!.AvailableSpaces);

        return Results.Ok(new StatsDto(
            Parkings: cars.Count,
            WithLiveData: measured.Count,
            Open: measured.Count(p => p.Status!.IsOpen),
            TotalCapacity: capacity,
            AvailableSpaces: available,
            Occupancy: capacity > 0 ? (short)Math.Round((capacity - available) * 100.0 / capacity) : null,
            MeasuredAtUtc: live.Count == 0 ? null : live.Max(p => p.Status!.MeasuredAtUtc),
            Bicycle: new BicycleStatsDto(
                Facilities: bikes.Count,
                TotalCapacity: bikeCapacity,
                AvailableSpaces: bikeAvailable,
                Occupancy: bikeCapacity > 0
                    ? (short)Math.Round((bikeCapacity - bikeAvailable) * 100.0 / bikeCapacity)
                    : null)));
    }

    private static async Task<IResult> Meta(AppDbContext db, IOptions<GentOptions> options, CancellationToken ct)
    {
        var last = await db.Runs.AsNoTracking().OrderByDescending(r => r.StartedUtc).FirstOrDefaultAsync(ct);
        var count = await db.Measurements.CountAsync(ct);
        var o = options.Value;

        return Results.Ok(new MetaDto(
            Source: "Stad Gent — Open Data",
            SourceUrl: "https://data.stad.gent",
            Datasets: new[] { o.LiveDataset, o.CatalogueDataset }.Concat(o.BicycleDatasets).ToArray(),
            RefreshMinutes: o.RefreshMinutes,
            RetentionDays: o.RetentionDays,
            LastSyncUtc: last?.StartedUtc,
            LastSyncOk: last?.Ok ?? false,
            MeasurementCount: count));
    }

    /// <summary>
    /// Dezelfde gegevens als GeoJSON. Niet omdat het scherm het nodig heeft — dat leest
    /// <c>/api/parkings</c> — maar omdat dit de vorm is waarin een kaartprogramma (QGIS, uMap,
    /// een ander dashboard) deze data zonder uitleg kan openen. Het is open data; dan hoort ze
    /// ook weer open buiten te gaan.
    /// </summary>
    private static async Task<IResult> GeoJson(AppDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var rows = await db.Parkings.Include(p => p.Status).AsNoTracking().ToListAsync(ct);

        var features = rows.Select(p => new
        {
            type = "Feature",
            geometry = new { type = "Point", coordinates = new[] { p.Longitude, p.Latitude } },
            properties = new
            {
                slug = p.Slug,
                name = p.Name,
                kind = Mapping.KindSlug(p.Kind),
                isPublic = p.IsPublic,
                address = p.Address,
                capacity = p.Capacity,
                url = p.Url,
                available = p.Status?.AvailableSpaces,
                occupancy = p.Status is { IsPlausible: true } ? p.Status.OccupancyPct : (short?)null,
                isOpen = p.Status?.IsOpen,
                measuredAt = p.Status?.MeasuredAtUtc,
                isStale = p.Status is not null && now - p.Status.MeasuredAtUtc > Mapping.StaleAfter,
            },
        });

        return Results.Json(new { type = "FeatureCollection", features },
            new JsonSerializerOptions(JsonSerializerDefaults.Web), "application/geo+json");
    }

    /// <summary>
    /// De lage-emissiezone als GeoJSON, zodat het scherm ze als laag over de kaart kan leggen.
    /// Leeg zolang ze nooit opgehaald kon worden — dan tekent het scherm gewoon niets en blijft
    /// het vinkje zonder gevolg, in plaats van een foutmelding te tonen voor iets bijkomstigs.
    /// </summary>
    private static async Task<IResult> LowEmissionZone(
        Services.LowEmissionZone zone, CancellationToken ct)
    {
        var shapes = await zone.GetAsync(ct);
        var features = shapes.Select(g => new
        {
            type = "Feature",
            geometry = g,
            properties = new { name = "Lage-emissiezone Gent" },
        });

        return Results.Json(new { type = "FeatureCollection", features },
            new JsonSerializerOptions(JsonSerializerDefaults.Web), "application/geo+json");
    }

    private static async Task<IResult> RoutePlan(RoutePlanner planner, RoutePlanRequest request, CancellationToken ct)
    {
        if (request.StartLat is < -90 or > 90 || request.StartLon is < -180 or > 180)
            return Results.BadRequest(new { error = "Ongeldige startcoördinaten." });
        if (request.EndLat is < -90 or > 90 || request.EndLon is < -180 or > 180)
            return Results.BadRequest(new { error = "Ongeldige eindcoördinaten." });

        var route = await planner.PlanAsync(
            request.StartLat,
            request.StartLon,
            request.EndLat,
            request.EndLon,
            request.Mode,
            request.CheckLez,
            ct);
        if (route?.LezRestricted == true)
            return Results.BadRequest(new { error = route.LezWarning, code = "lez" });

        return route is null
            ? Results.BadRequest(new { error = "Routeplanning kon niet uitgevoerd worden." })
            : Results.Ok(route);
    }

    private static async Task<IResult> EzPark(EzParkPlanner planner, EzParkRequest request, CancellationToken ct)
    {
        if (request.StartLat is < -90 or > 90 || request.StartLon is < -180 or > 180)
            return Results.BadRequest(new { error = "Ongeldige startcoördinaten." });
        if (request.EndLat is < -90 or > 90 || request.EndLon is < -180 or > 180)
            return Results.BadRequest(new { error = "Ongeldige eindcoördinaten." });

        try
        {
            var result = await planner.PlanAsync(request, ct);
            return result is null
                ? Results.BadRequest(new { error = "EZ Park kon niet berekend worden." })
                : Results.Ok(result);
        }
        catch (TransitUnavailableException)
        {
            return Results.Json(new { error = "De OV-dienstregeling is tijdelijk niet beschikbaar." }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    private static async Task<IResult> TransitStops(TransitService transit, CancellationToken ct)
    {
        try
        {
            return Results.Ok(await transit.GetStopsAsync(ct));
        }
        catch (TransitUnavailableException)
        {
            return Results.Json(new { error = "De OV-dienstregeling is tijdelijk niet beschikbaar." }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    private static async Task<IResult> TransitStatus(TransitService transit, CancellationToken ct)
    {
        try
        {
            return Results.Ok(await transit.GetStatusAsync(ct));
        }
        catch (TransitUnavailableException)
        {
            return Results.Json(new { error = "De OV-dienstregeling is tijdelijk niet beschikbaar." }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    private static async Task<IResult> TransitStopRealtime(TransitService transit, string stopId, CancellationToken ct)
    {
        try
        {
            var result = await transit.GetStopRealtimeAsync(stopId, ct);
            return result is null
                ? Results.NotFound(new { error = "Die halte kennen we niet." })
                : Results.Ok(result);
        }
        catch (TransitUnavailableException)
        {
            return Results.Json(new { error = "De realtime OV-gegevens zijn tijdelijk niet beschikbaar." }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    private static async Task<IResult> TransitRoute(TransitService transit, TransitRouteRequest request, CancellationToken ct)
    {
        if (request.StartLat is < -90 or > 90 || request.StartLon is < -180 or > 180)
            return Results.BadRequest(new { error = "Ongeldige startcoördinaten." });
        if (request.EndLat is < -90 or > 90 || request.EndLon is < -180 or > 180)
            return Results.BadRequest(new { error = "Ongeldige eindcoördinaten." });

        try
        {
            var route = await transit.PlanAsync(request.StartLat, request.StartLon, request.EndLat, request.EndLon, ct);
            return route is null
                ? Results.NotFound(new { error = "Geen OV-route gevonden voor deze locaties." })
                : Results.Ok(route);
        }
        catch (TransitUnavailableException)
        {
            return Results.Json(new { error = "De OV-dienstregeling is tijdelijk niet beschikbaar." }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    // ---------- beheer, alleen vanaf het LAN ----------

    private static async Task<IResult> ManualSync(ParkingSync sync, CancellationToken ct)
    {
        var run = await sync.RunAsync("handmatig", ct);
        return Results.Ok(ToDto(run));
    }

    private static async Task<IResult> ManualBackfill(Backfill backfill, CancellationToken ct)
        => Results.Ok(new { added = await backfill.RunAsync(ct) });

    private static async Task<IResult> Runs(AppDbContext db, int? take, CancellationToken ct)
        => Results.Ok(await db.Runs.AsNoTracking()
            .OrderByDescending(r => r.StartedUtc)
            .Take(Math.Clamp(take ?? 50, 1, 500))
            .Select(r => new SyncRunDto(r.StartedUtc, r.DurationMs, r.Ok, r.Trigger,
                r.LiveCount, r.CatalogueCount, r.MeasurementsAdded, r.MeasurementsPruned, r.Message))
            .ToListAsync(ct));

    private static SyncRunDto ToDto(SyncRun r) => new(
        r.StartedUtc, r.DurationMs, r.Ok, r.Trigger,
        r.LiveCount, r.CatalogueCount, r.MeasurementsAdded, r.MeasurementsPruned, r.Message);
}
