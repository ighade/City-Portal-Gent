using System.Text.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.OutputCaching;
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
/// vrij op te vragen. Wijzigingen aan de parkeerdata en tarieven hangen onder <c>/api/admin</c>
/// en vragen een identiteit, en die komt alleen binnen via de LAN-ingang <c>:8105</c>
/// (zie <c>caddy/Caddyfile</c>).
/// </para>
/// </summary>
public static class Api
{
    public static void MapApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");

        // Openbaar, en met een antwoordcache: de stad vernieuwt om de vijf minuten, dus honderd
        // bezoekers in diezelfde minuut hoeven de databank niet honderd keer te bevragen.
        api.MapGet("/parkings", Parkings).CacheOutput("parkings");
        api.MapGet("/parkings/{slug}", Detail).CacheOutput("parkings");
        api.MapGet("/parkings/{slug}/history", History).CacheOutput("kort");
        api.MapGet("/parkings/{slug}/trend", Trend).CacheOutput("lang");
        api.MapGet("/stats", Stats).CacheOutput("kort");
        api.MapGet("/meta", Meta).CacheOutput("kort");
        api.MapGet("/geojson", GeoJson).CacheOutput("kort");
        // De lage-emissiezone verandert hooguit eens in de zoveel jaar; die mag lang blijven staan.
        api.MapGet("/lez", LowEmissionZone).CacheOutput("lang");
        api.MapGet("/events", Events).CacheOutput("events");
        // Zonder uitvoercache: de eerste aanvraag haalt de beschrijving op (1 credit) en bewaart ze.
        api.MapGet("/events/{id}", EventDetail);
        api.MapGet("/transit/stops", TransitStops).CacheOutput("lang");
        api.MapPost("/transit/route", TransitRoute);
        api.MapPost("/route/plan", RoutePlan);
        api.MapPost("/route/ezpark", EzPark);
        api.MapGet("/geo/suggest", GeoProxy("Suggestion", 10));
        api.MapGet("/geo/locate", GeoProxy("Location", 5));
        api.MapPost("/admin/login", AdminLogin);

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
        admin.MapPost("/logout", (Delegate)AdminLogout);
        admin.MapPost("/sync", ManualSync);
        admin.MapPost("/backfill", ManualBackfill);
        admin.MapGet("/runs", Runs);
        admin.MapGet("/street-tariffs", StreetTariffs);
        admin.MapPut("/street-tariffs", UpdateStreetTariffs);
        admin.MapGet("/parkings", AdminParkings);
        admin.MapPost("/parkings", AddManualParking);
        admin.MapPut("/parkings/{slug}/rate", UpdateParkingRate);
        admin.MapDelete("/parkings/{slug}/rate", DeleteParkingRate);
        admin.MapDelete("/parkings/{slug}", DeleteManualParking);
        admin.MapGet("/events", AdminEvents);
        admin.MapPost("/events", AddManualEvent);
        admin.MapDelete("/events/{id}", DeleteManualEvent);
    }

    // ---------- openbaar ----------

    private static async Task<IResult> Parkings(AppDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var rows = await db.Parkings
            .Include(p => p.Status)
            .Include(p => p.ManualRate)
            .AsNoTracking()
            .OrderBy(p => p.Kind).ThenBy(p => p.Name)
            .ToListAsync(ct);
        return Results.Ok(rows.Select(p => p.ToDto(now)));
    }

    private static async Task<IResult> Detail(string slug, AppDbContext db, CancellationToken ct)
    {
        var parking = await db.Parkings
            .Include(p => p.Status)
            .Include(p => p.ManualRate)
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

    /// <summary>
    /// Adreszoeker van Vlaanderen via de server: een toestel of emulator zonder (werkende) DNS naar het
    /// internet kan dan nog steeds adressen zoeken, want het bereikt alleen deze API.
    /// </summary>
    private static Delegate GeoProxy(string kind, int count) =>
        async (IHttpClientFactory factory, string? q, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(q) || q.Length > 200)
                return Results.BadRequest(new { error = "Geef een zoekterm op." });
            try
            {
                using var http = factory.CreateClient();
                http.Timeout = TimeSpan.FromSeconds(8);
                using var res = await http.GetAsync(
                    $"https://geo.api.vlaanderen.be/geolocation/v4/{kind}?c={count}&q={Uri.EscapeDataString(q)}", ct);
                if (!res.IsSuccessStatusCode) return Results.StatusCode(StatusCodes.Status502BadGateway);
                return Results.Content(await res.Content.ReadAsStringAsync(ct), "application/json");
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                return Results.StatusCode(StatusCodes.Status502BadGateway);
            }
        };

    private static async Task<IResult> RoutePlan(RoutePlanner planner, StreetParkingZones streetZones, AppDbContext db, RoutePlanRequest request, CancellationToken ct)
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
            : Results.Ok(await WithDestinationParking(route, streetZones, db, request, ct));
    }

    private static async Task<RoutePlanResult> WithDestinationParking(
        RoutePlanResult route, StreetParkingZones streetZones, AppDbContext db, RoutePlanRequest request, CancellationToken ct)
    {
        if (!string.Equals(route.Mode, "car", StringComparison.OrdinalIgnoreCase)) return route;

        var arrival = StreetParkingZones.LocalTime(DateTime.UtcNow.AddMinutes(route.DurationMinutes));
        var parking = await streetZones.FindAsync(request.EndLat, request.EndLon, arrival, ct);

        // Een eindpunt dat een parking is (binnen ~100 m): toon haar garagetarief.
        const double box = 0.001;
        var garage = (await db.Parkings.AsNoTracking()
            .Include(p => p.ManualRate)
            .Where(p => p.Kind != ParkingKind.Bicycle
                && Math.Abs(p.Latitude - request.EndLat) < box && Math.Abs(p.Longitude - request.EndLon) < box)
            .ToListAsync(ct))
            .OrderBy(p => Math.Abs(p.Latitude - request.EndLat) + Math.Abs(p.Longitude - request.EndLon))
            .Select(p => (p.Name, p.ManualRate, Rate: ParkingRates.For(p.Slug, arrival)))
        .FirstOrDefault(x => x.Rate is not null || x.ManualRate is not null);

        return route with
        {
        DestinationParking = parking,
        DestinationGarage = garage.Rate is null && garage.ManualRate is null
            ? null
            : new DestinationGarage(garage.Name, garage.Rate, garage.ManualRate?.ToDto()),
        };
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

    private static async Task<IResult> Events(AppDbContext db, CancellationToken ct)
    {
        var rows = await db.Events.AsNoTracking()
            .OrderBy(e => e.StartsAtUtc == null).ThenBy(e => e.StartsAtUtc)
            .Select(e => new EventDto(
                e.Id, e.Url, e.Name, e.CoverImageUrl, e.CoverAccessibilityCaption, e.IsOnline, e.IsPast,
                e.IsHappeningNow, e.StartsAtUtc, e.DayTimeLabel, e.Place == null ? null : e.Place.Name,
                e.Kind, e.SocialSummary, e.InterestedCount, e.GoingCount, e.WentCount, e.TicketPriceLabel))
            .ToListAsync(ct);
        return Results.Ok(rows);
    }

    private static async Task<IResult> EventDetail(string id, AppDbContext db, EventDescriptions descriptions, CancellationToken ct)
    {
        var e = await db.Events.Include(x => x.Place).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (e is null) return Results.NotFound();

        if (e.DescriptionFetchedAtUtc is null)
        {
            var text = await descriptions.FetchAsync(e.Id, ct);
            // Mislukt de oproep, dan blijft het veld leeg en proberen we het bij een volgend bezoek opnieuw.
            if (text is not null)
            {
                e.Description = text.Length == 0 ? null : text;
                e.DescriptionFetchedAtUtc = DateTime.UtcNow;
                await db.SaveChangesAsync(ct);
            }
        }

        var dto = new EventDto(
            e.Id, e.Url, e.Name, e.CoverImageUrl, e.CoverAccessibilityCaption, e.IsOnline, e.IsPast,
            e.IsHappeningNow, e.StartsAtUtc, e.DayTimeLabel, e.Place?.Name,
            e.Kind, e.SocialSummary, e.InterestedCount, e.GoingCount, e.WentCount, e.TicketPriceLabel);
        return Results.Ok(new EventDetailDto(dto, e.Description));
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

    // ---------- beheer ----------

    private static async Task<IResult> AdminLogin(
        HttpContext ctx,
        AdminLoginRequest request,
        IOptions<AuthOptions> options,
        LoginThrottle throttle)
    {
        var auth = options.Value;
        var email = request.Email?.Trim().ToLowerInvariant() ?? string.Empty;
        var password = request.Password ?? string.Empty;
        var key = $"admin:{ctx.Connection.RemoteIpAddress}:{email[..Math.Min(email.Length, 200)]}";

        if (throttle.IsLocked(key))
            return Results.Json(new { error = "Te veel mislukte pogingen. Probeer het over enkele minuten opnieuw." },
                statusCode: StatusCodes.Status429TooManyRequests);
        if (string.IsNullOrEmpty(auth.AdminPassword))
            return Results.Json(new { error = "Admin-aanmelding is niet ingesteld op de server." },
                statusCode: StatusCodes.Status503ServiceUnavailable);

        var expected = Encoding.UTF8.GetBytes(auth.AdminPassword);
        var offered = Encoding.UTF8.GetBytes(password);
        var passwordMatches = password.Length <= 200 && CryptographicOperations.FixedTimeEquals(expected, offered);
        var emailAllowed = email.Length <= 200 && auth.Admins().Contains(email, StringComparer.Ordinal);
        if (!passwordMatches || !emailAllowed)
        {
            throttle.Fail(key);
            return Results.Json(new { error = "E-mailadres of wachtwoord klopt niet." },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        throttle.Reset(key);
        var identity = new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, email),
                new Claim(ClaimTypes.Email, email),
                new Claim(ClaimTypes.Name, email),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme);
        await ctx.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties { IsPersistent = true, AllowRefresh = false });
        return Results.Ok(new { email, name = email, isAdmin = true });
    }

    private static async Task<IResult> AdminLogout(HttpContext ctx)
    {
        await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Results.NoContent();
    }

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

    private static async Task<IResult> StreetTariffs(AppDbContext db, CancellationToken ct)
        => Results.Ok(await db.StreetParkingTariffs.AsNoTracking()
            .OrderBy(t => t.Zone).ThenBy(t => t.Period).ThenBy(t => t.Hours)
            .Select(t => new StreetTariffAdminDto(t.Zone, t.Period, t.Hours, t.AmountEur))
            .ToListAsync(ct));

    private static async Task<IResult> UpdateStreetTariffs(
        StreetTariffAdminDto[] request, AppDbContext db, StreetParkingZones zones, CancellationToken ct)
    {
        var rows = await db.StreetParkingTariffs.ToListAsync(ct);
        if (request.Length != rows.Count
            || request.Any(t => string.IsNullOrWhiteSpace(t.Zone)
                || string.IsNullOrWhiteSpace(t.Period)
                || t.Hours < 0 || t.Hours > 24
                || t.AmountEur is < 0 or > 9999.99m)
            || request.Select(t => (t.Zone, t.Period, t.Hours)).Distinct().Count() != request.Length)
            return Results.BadRequest(new { error = "De tarieven bevatten ongeldige of dubbele rijen." });

        var updates = request.ToDictionary(t => (t.Zone, t.Period, t.Hours));
        if (rows.Any(r => !updates.ContainsKey((r.Zone, r.Period, r.Hours))))
            return Results.BadRequest(new { error = "De tariefstructuur mag hier niet worden gewijzigd." });

        foreach (var row in rows)
            row.AmountEur = updates[(row.Zone, row.Period, row.Hours)].AmountEur;
        await db.SaveChangesAsync(ct);
        await zones.ReplaceTariffsAsync(rows, ct);
        return Results.NoContent();
    }

    private static async Task<IResult> AdminParkings(AppDbContext db, CancellationToken ct)
    {
        var rows = await db.Parkings
            .Include(p => p.ManualRate)
            .AsNoTracking()
            .Where(p => p.Kind != ParkingKind.Bicycle)
            .OrderBy(p => p.Name)
            .ToListAsync(ct);
        return Results.Ok(rows.Select(p => new AdminParkingDto(
            p.Slug, p.Name, p.Address, p.Latitude, p.Longitude, p.IsManual,
            p.ManualRate?.ToDto())));
    }

    private static async Task<IResult> AddManualParking(
        ManualParkingRequest request, AppDbContext db, IOutputCacheStore cache, CancellationToken ct)
    {
        var invalid = ValidateManualParking(request.Name, request.Address, request.Latitude, request.Longitude, request.Rate);
        if (invalid is not null) return Results.BadRequest(new { error = invalid });

        var baseSlug = Slug(request.Name);
        var slug = baseSlug;
        for (var suffix = 2; await db.Parkings.AnyAsync(p => p.Slug == slug, ct); suffix++)
            slug = $"{baseSlug[..Math.Min(baseSlug.Length, 80 - suffix.ToString().Length - 1)]}-{suffix}";

        var now = DateTime.UtcNow;
        var parking = new Parking
        {
            Slug = slug,
            ExternalId = $"manual:{slug}",
            Name = request.Name.Trim(),
            Kind = ParkingKind.Garage,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            Address = request.Address.Trim(),
            Capacity = 0,
            HasLiveData = false,
            IsPublic = true,
            IsManual = true,
            FirstSeenUtc = now,
            LastSeenUtc = now,
            ManualRate = ToEntity(request.Rate),
        };
        db.Parkings.Add(parking);
        await db.SaveChangesAsync(ct);
        await cache.EvictByTagAsync("parking-details", ct);
        return Results.Created($"/api/parkings/{slug}", new AdminParkingDto(
            parking.Slug, parking.Name, parking.Address, parking.Latitude, parking.Longitude, parking.IsManual,
            parking.ManualRate.ToDto()));
    }

    private static async Task<IResult> UpdateParkingRate(
        string slug, ManualParkingRateRequest request, AppDbContext db, IOutputCacheStore cache, CancellationToken ct)
    {
        var invalid = ValidateManualRate(request);
        if (invalid is not null) return Results.BadRequest(new { error = invalid });

        var parking = await db.Parkings.Include(p => p.ManualRate).FirstOrDefaultAsync(p => p.Slug == slug, ct);
        if (parking is null || parking.Kind == ParkingKind.Bicycle)
            return Results.NotFound(new { error = "Deze parking is niet gevonden." });

        if (parking.ManualRate is null)
            parking.ManualRate = ToEntity(request);
        else
            CopyRate(request, parking.ManualRate);
        await db.SaveChangesAsync(ct);
        await cache.EvictByTagAsync("parking-details", ct);
        return Results.Ok(parking.ManualRate.ToDto());
    }

    private static async Task<IResult> DeleteParkingRate(
        string slug, AppDbContext db, IOutputCacheStore cache, CancellationToken ct)
    {
        var parking = await db.Parkings.Include(p => p.ManualRate).FirstOrDefaultAsync(p => p.Slug == slug, ct);
        if (parking?.ManualRate is null) return Results.NotFound();
        db.ManualParkingRates.Remove(parking.ManualRate);
        await db.SaveChangesAsync(ct);
        await cache.EvictByTagAsync("parking-details", ct);
        return Results.NoContent();
    }

    private static async Task<IResult> DeleteManualParking(
        string slug, AppDbContext db, IOutputCacheStore cache, CancellationToken ct)
    {
        var parking = await db.Parkings.FirstOrDefaultAsync(p => p.Slug == slug, ct);
        if (parking is null || !parking.IsManual) return Results.NotFound();
        db.Parkings.Remove(parking);
        await db.SaveChangesAsync(ct);
        await cache.EvictByTagAsync("parking-details", ct);
        return Results.NoContent();
    }

    private static string? ValidateManualParking(
        string name, string address, double latitude, double longitude, ManualParkingRateRequest rate)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 200)
            return "Geef een naam van maximaal 200 tekens op.";
        if (string.IsNullOrWhiteSpace(address) || address.Trim().Length > 300)
            return "Geef een adres van maximaal 300 tekens op.";
        if (latitude is < 50 or > 52 || longitude is < 2 or > 5)
            return "De locatie moet in de omgeving van Gent liggen.";
        return ValidateManualRate(rate);
    }

    private const string ManualEventPrefix = "manual-";

    private static async Task<IResult> AdminEvents(AppDbContext db, CancellationToken ct)
        => Results.Ok(await db.Events.AsNoTracking()
            .Where(e => e.Id.StartsWith(ManualEventPrefix))
            .OrderByDescending(e => e.ImportedAtUtc)
            .Select(e => new AdminEventDto(e.Id, e.Name, e.StartsAtUtc, e.Place == null ? null : e.Place.Name))
            .ToListAsync(ct));

    private static async Task<IResult> AddManualEvent(
        ManualEventRequest request, AppDbContext db, IOutputCacheStore cache, CancellationToken ct)
    {
        var invalid = ValidateManualEvent(request);
        if (invalid is not null) return Results.BadRequest(new { error = invalid });

        var now = DateTime.UtcNow;
        string? placeId = null;
        var placeName = Clean(request.PlaceName);
        if (placeName is not null)
        {
            var lowered = placeName.ToLower();
            var place = await db.EventPlaces.FirstOrDefaultAsync(p => p.Name.ToLower() == lowered, ct);
            if (place is null)
            {
                place = new EventPlaceEntity { Id = $"{ManualEventPrefix}{Guid.NewGuid():N}", Name = placeName };
                db.EventPlaces.Add(place);
            }
            placeId = place.Id;
        }

        var entity = new EventEntity
        {
            Id = $"{ManualEventPrefix}{Guid.NewGuid():N}",
            Url = Clean(request.Url) ?? string.Empty,
            Name = request.Name.Trim(),
            CoverImageUrl = Clean(request.CoverImageUrl),
            CoverPhotoId = Clean(request.CoverPhotoId),
            CoverAccessibilityCaption = Clean(request.CoverAccessibilityCaption),
            IsOnline = request.IsOnline,
            IsPast = request.IsPast,
            IsHappeningNow = request.IsHappeningNow,
            StartsAtUtc = request.StartsAtUtc?.ToUniversalTime(),
            DayTimeLabel = Clean(request.DayTimeLabel),
            PlaceId = placeId,
            Kind = Clean(request.Kind),
            SocialSummary = Clean(request.SocialSummary),
            InterestedCount = request.InterestedCount,
            GoingCount = request.GoingCount,
            WentCount = request.WentCount,
            TicketPriceLabel = Clean(request.TicketPriceLabel),
            Description = Clean(request.Description),
            // Er is niets bij Social Fetch om op te halen: de beschrijving is hier al definitief.
            DescriptionFetchedAtUtc = now,
            ImportedAtUtc = now,
        };
        db.Events.Add(entity);
        await db.SaveChangesAsync(ct);
        await cache.EvictByTagAsync("events", ct);
        return Results.Created($"/api/events/{entity.Id}",
            new AdminEventDto(entity.Id, entity.Name, entity.StartsAtUtc, placeName));
    }

    private static async Task<IResult> DeleteManualEvent(
        string id, AppDbContext db, IOutputCacheStore cache, CancellationToken ct)
    {
        var entity = id.StartsWith(ManualEventPrefix, StringComparison.Ordinal)
            ? await db.Events.FirstOrDefaultAsync(e => e.Id == id, ct)
            : null;
        if (entity is null)
            return Results.NotFound(new { error = "Alleen handmatig toegevoegde evenementen kunnen worden verwijderd." });

        db.RemoveRange(await db.Set<FriendInterest>().Where(i => i.EventId == id).ToListAsync(ct));
        db.Events.Remove(entity);
        await db.SaveChangesAsync(ct);

        var placeId = entity.PlaceId;
        if (placeId is not null && placeId.StartsWith(ManualEventPrefix, StringComparison.Ordinal)
            && !await db.Events.AnyAsync(e => e.PlaceId == placeId, ct))
        {
            await db.EventPlaces.Where(p => p.Id == placeId).ExecuteDeleteAsync(ct);
        }
        await cache.EvictByTagAsync("events", ct);
        return Results.NoContent();
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static bool TooLong(string? value, int max) => value is not null && value.Trim().Length > max;

    private static bool IsHttpUrl(string? value, int max)
    {
        var url = Clean(value);
        return url is null
            || url.Length <= max && Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https";
    }

    private static string? ValidateManualEvent(ManualEventRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name)) return "Geef het evenement een naam.";
        if (TooLong(r.Name, 500)) return "De naam mag maximaal 500 tekens bevatten.";
        if (!IsHttpUrl(r.Url, 500)) return "De link moet een geldig http(s)-adres van maximaal 500 tekens zijn.";
        if (!IsHttpUrl(r.CoverImageUrl, 2000)) return "De afbeeldingslink moet een geldig http(s)-adres van maximaal 2000 tekens zijn.";
        if (TooLong(r.CoverPhotoId, 60)) return "De foto-id mag maximaal 60 tekens bevatten.";
        if (TooLong(r.CoverAccessibilityCaption, 1000)) return "De afbeeldingsbeschrijving mag maximaal 1000 tekens bevatten.";
        if (TooLong(r.DayTimeLabel, 100)) return "Het tijdslabel mag maximaal 100 tekens bevatten.";
        if (TooLong(r.PlaceName, 500)) return "De locatie mag maximaal 500 tekens bevatten.";
        if (TooLong(r.Kind, 30)) return "Het soort mag maximaal 30 tekens bevatten.";
        if (TooLong(r.SocialSummary, 200)) return "De sociale samenvatting mag maximaal 200 tekens bevatten.";
        if (TooLong(r.TicketPriceLabel, 100)) return "Het prijslabel mag maximaal 100 tekens bevatten.";
        if (TooLong(r.Description, 20000)) return "De beschrijving mag maximaal 20.000 tekens bevatten.";
        if (r.IsPast && r.IsHappeningNow) return "Een evenement kan niet tegelijk voorbij zijn en nu bezig zijn.";
        if (r.StartsAtUtc is { } start
            && (start.Kind == DateTimeKind.Unspecified || start.Year is < 2000 or > 2100))
            return "Geef een geldige startdatum met tijdzone tussen 2000 en 2100.";
        if (r.InterestedCount is < 0 or > 100_000_000 || r.GoingCount is < 0 or > 100_000_000
            || r.WentCount is < 0 or > 100_000_000)
            return "Aantallen moeten tussen 0 en 100.000.000 liggen.";
        return null;
    }

    private static string? ValidateManualRate(ManualParkingRateRequest rate)
    {
        static bool InvalidAmount(decimal? value) => value is < 0 or > 9999.99m;
        if (InvalidAmount(rate.WeekdayHourlyEur) || InvalidAmount(rate.WeekendHourlyEur)
            || InvalidAmount(rate.DaytimeMaximumEur) || InvalidAmount(rate.NighttimeMaximumEur)
            || InvalidAmount(rate.DailyMaximumEur))
            return "Bedragen moeten tussen € 0 en € 9.999,99 liggen.";
        if (rate.DaytimeMaximumEur is not null && (rate.DaytimeStart is null || rate.DaytimeEnd is null)
            || rate.NighttimeMaximumEur is not null && (rate.NighttimeStart is null || rate.NighttimeEnd is null))
            return "Vul voor elk maximum ook begin- en einduur in.";
        return null;
    }

    private static ManualParkingRate ToEntity(ManualParkingRateRequest r) => new()
    {
        WeekdayHourlyEur = r.WeekdayHourlyEur,
        WeekdayStart = r.WeekdayStart,
        WeekdayEnd = r.WeekdayEnd,
        DaytimeMaximumEur = r.DaytimeMaximumEur,
        DaytimeStart = r.DaytimeStart,
        DaytimeEnd = r.DaytimeEnd,
        NighttimeMaximumEur = r.NighttimeMaximumEur,
        NighttimeStart = r.NighttimeStart,
        NighttimeEnd = r.NighttimeEnd,
        DailyMaximumEur = r.DailyMaximumEur,
        WeekendHourlyEur = r.WeekendHourlyEur,
    };

    private static void CopyRate(ManualParkingRateRequest r, ManualParkingRate target)
    {
        target.WeekdayHourlyEur = r.WeekdayHourlyEur;
        target.WeekdayStart = r.WeekdayStart;
        target.WeekdayEnd = r.WeekdayEnd;
        target.DaytimeMaximumEur = r.DaytimeMaximumEur;
        target.DaytimeStart = r.DaytimeStart;
        target.DaytimeEnd = r.DaytimeEnd;
        target.NighttimeMaximumEur = r.NighttimeMaximumEur;
        target.NighttimeStart = r.NighttimeStart;
        target.NighttimeEnd = r.NighttimeEnd;
        target.DailyMaximumEur = r.DailyMaximumEur;
        target.WeekendHourlyEur = r.WeekendHourlyEur;
    }

    private static string Slug(string name)
    {
        var result = System.Text.RegularExpressions.Regex.Replace(
            name.Normalize(System.Text.NormalizationForm.FormD)
                .Where(c => char.IsAsciiLetterOrDigit(c) || char.IsWhiteSpace(c) || c == '-')
                .Select(char.ToLowerInvariant).Aggregate("", (a, c) => a + c),
            @"[\s-]+", "-").Trim('-');
        return string.IsNullOrWhiteSpace(result) ? $"handmatig-{Guid.NewGuid():N}"[..18] : result[..Math.Min(75, result.Length)];
    }

    private static SyncRunDto ToDto(SyncRun r) => new(
        r.StartedUtc, r.DurationMs, r.Ok, r.Trigger,
        r.LiveCount, r.CatalogueCount, r.MeasurementsAdded, r.MeasurementsPruned, r.Message);

    public sealed record StreetTariffAdminDto(string Zone, string Period, int Hours, decimal AmountEur);
    public sealed record AdminParkingDto(
        string Slug, string Name, string? Address, double Latitude, double Longitude, bool IsManual,
        ManualParkingRateDto? Rate);
    public sealed record ManualParkingRequest(
        string Name, string Address, double Latitude, double Longitude, ManualParkingRateRequest Rate);
    public sealed record ManualParkingRateRequest(
        decimal WeekdayHourlyEur,
        TimeOnly WeekdayStart,
        TimeOnly WeekdayEnd,
        decimal? DaytimeMaximumEur,
        TimeOnly? DaytimeStart,
        TimeOnly? DaytimeEnd,
        decimal? NighttimeMaximumEur,
        TimeOnly? NighttimeStart,
        TimeOnly? NighttimeEnd,
        decimal? DailyMaximumEur,
        decimal WeekendHourlyEur);
    public sealed record AdminEventDto(string Id, string Name, DateTime? StartsAtUtc, string? Place);
    public sealed record ManualEventRequest(
        string Name,
        string? Url,
        string? CoverImageUrl,
        string? CoverPhotoId,
        string? CoverAccessibilityCaption,
        bool IsOnline,
        bool IsPast,
        bool IsHappeningNow,
        DateTime? StartsAtUtc,
        string? DayTimeLabel,
        string? PlaceName,
        string? Kind,
        string? SocialSummary,
        int? InterestedCount,
        int? GoingCount,
        int? WentCount,
        string? TicketPriceLabel,
        string? Description);
    public sealed record AdminLoginRequest(string? Email, string? Password);
}
