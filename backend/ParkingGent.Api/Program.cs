using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;
using ParkingGent.Api.Endpoints;
using ParkingGent.Api.Services;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, configuration) => configuration
    .ReadFrom.Configuration(context.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console());

builder.Services.Configure<GentOptions>(builder.Configuration.GetSection(GentOptions.SectionName));
builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection(AuthOptions.SectionName));
builder.Services.Configure<RoutePlannerOptions>(builder.Configuration.GetSection(RoutePlannerOptions.SectionName));

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? "Host=parkinggent-postgres;Database=parkinggent;Username=parkinggent;Password=parkinggent";
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(connectionString));

// De veerkrachtlaag van .NET rond data.stad.gent: opnieuw proberen met oplopende wachttijd, een
// stroomonderbreker als de dienst plat ligt, en een tijdslimiet. Zonder dit zou één trage nacht
// bij de stad hier een ophaalronde van minuten opleveren.
builder.Services.AddHttpClient<GentOpenData>((sp, c) =>
    {
        var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<GentOptions>>().Value;
        c.BaseAddress = new Uri(options.BaseUrl.TrimEnd('/') + "/");
        c.Timeout = TimeSpan.FromSeconds(30);
        // De stad vraagt in haar voorwaarden om herkenbaar verkeer. Het contactadres komt uit de
        // omgeving (Gent:ContactUrl), zodat wie deze code overneemt niet ongemerkt het adres van
        // iemand anders meestuurt.
        var contact = options.ContactUrl;
        c.DefaultRequestHeaders.UserAgent.ParseAdd(
            string.IsNullOrWhiteSpace(contact) ? "ParkingGent/2.0" : $"ParkingGent/2.0 (+{contact.Trim()})");
        c.DefaultRequestHeaders.Accept.ParseAdd("application/json");
    })
    .AddStandardResilienceHandler();

builder.Services.AddHttpClient<RoutePlanner>((sp, c) =>
    {
        var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<RoutePlannerOptions>>().Value;
        c.BaseAddress = new Uri(options.BaseUrl.TrimEnd('/') + "/");
        c.Timeout = TimeSpan.FromSeconds(30);
        c.DefaultRequestHeaders.Accept.Clear();
        c.DefaultRequestHeaders.Accept.ParseAdd("application/geo+json");
    })
    .AddStandardResilienceHandler();

builder.Services.AddSingleton<BicycleLocations>();
builder.Services.AddSingleton<LowEmissionZone>();
builder.Services.AddScoped<CallerResolver>();
builder.Services.AddScoped<ParkingSync>();
builder.Services.AddScoped<Backfill>();
builder.Services.AddScoped<Trends>();
builder.Services.AddHostedService<ParkingSyncService>();

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// Deze API staat openbaar op het internet, anders dan de rest van het huis. Daarom een strakkere
// begrenzing dan bij de toepassingen achter Authelia, en per IP in plaats van in het algemeen:
// één bezoeker die blijft hameren mag de kaart niet voor iedereen stilleggen.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "onbekend",
            _ => new FixedWindowRateLimiterOptions
            {
                Window = TimeSpan.FromSeconds(10),
                PermitLimit = 60,
                QueueLimit = 0,
            }));
});

// Antwoordcache. De gegevens veranderen om de vijf minuten; een bezoeker hoeft de databank dus
// niet voor elke muisbeweging te raken. "lang" is voor de trendgrafiek, die over maanden rekent.
builder.Services.AddOutputCache(o =>
{
    o.AddPolicy("kort", p => p.Expire(TimeSpan.FromSeconds(30)).SetVaryByQuery("hours", "days"));
    o.AddPolicy("lang", p => p.Expire(TimeSpan.FromMinutes(30)).SetVaryByQuery("days"));
});

builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDbContext>("databank");

// nginx staat ervoor, en Caddy daar weer voor. Zonder dit is het bezoekers-IP dat van de
// containerbrug, en dan deelt iedereen dezelfde emmer van de snelheidsbegrenzer.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 256 * 1024);

var app = builder.Build();

app.UseForwardedHeaders();
app.UseSerilogRequestLogging();
app.UseRateLimiter();
app.UseOutputCache();

// Wie er aan de lijn hangt: één keer per verzoek, vóór de eindpunten. Een lege beller is de
// normale toestand — lezen mag iedereen.
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Items["caller"] = context.RequestServices.GetRequiredService<CallerResolver>().Resolve(context);
        context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    }
    await next();
});

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();

    // Eén ronde bij het opstarten, zodat het scherm meteen iets toont, en daarna eenmalig de
    // reeksen van de stad erbij zodat de trendgrafieken niet leeg beginnen. Beide mogen falen:
    // de achtergrondtaak probeert het over vijf minuten opnieuw.
    try
    {
        await scope.ServiceProvider.GetRequiredService<ParkingSync>().RunAsync("opstart", CancellationToken.None);
        if (scope.ServiceProvider
            .GetRequiredService<Microsoft.Extensions.Options.IOptions<GentOptions>>().Value.BackfillOnStartup)
        {
            await scope.ServiceProvider.GetRequiredService<Backfill>().RunAsync(CancellationToken.None);
        }
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "De eerste ophaalronde mislukte; de achtergrondtaak neemt het over.");
    }
}

// Leeft de container? Dit mag nooit op de stad wachten — docker leest het elke tien seconden.
app.MapHealthChecks("/api/health");

// Is de bron bereikbaar? Apart, want dit praat met data.stad.gent en duurt dus soms.
app.MapGet("/api/health/source", async (GentOpenData gent, CancellationToken ct) =>
{
    var ok = await gent.PingAsync(ct);
    return ok ? Results.Ok(new { ok = true }) : Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
});

app.MapApi();

app.Run();
