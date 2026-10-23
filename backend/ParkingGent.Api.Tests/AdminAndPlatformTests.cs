using Microsoft.EntityFrameworkCore;

namespace ParkingGent.Api.Tests;

/// <summary>Achter de proxy: de identiteitskop telt alleen met het juiste proxygeheim.</summary>
public class AdminFactory : ApiFactory
{
    public const string ProxyKey = "geheim-123";
    public const string Admin = "admin@example.be";

    protected override void Configure(Dictionary<string, string?> settings)
    {
        settings["Auth:ProxyKey"] = ProxyKey;
        settings["Auth:AdminEmails"] = "Admin@Example.be; tweede@example.be";
        settings["Auth:AdminPassword"] = "test-admin-password";
    }

    protected override void ConfigureFakes() => GentFixtures.Fill(Gent);
}

public class OpenProxyFactory : ApiFactory
{
    protected override void Configure(Dictionary<string, string?> settings) => settings["Auth:AdminEmails"] = "admin@example.be,   tweede@example.be";
}

public class NoAdminsFactory : ApiFactory
{
    protected override void Configure(Dictionary<string, string?> settings) => settings["Auth:ProxyKey"] = AdminFactory.ProxyKey;
}

public class DevelopmentFactory : ApiFactory
{
    protected override string EnvironmentName => "Development";

    protected override void Configure(Dictionary<string, string?> settings)
    {
        settings["Auth:AdminEmails"] = "dev@example.be";
    }
}

/// <summary>Wat data.stad.gent in een goede ronde teruggeeft: twee parkings uit de catalogus, één met meting.</summary>
public static class GentFixtures
{
    public static void Fill(FakeGent gent)
    {
        gent.Datasets["locaties-openbare-parkings-gent"] =
        [
            new { urid = "mob/p1", naam = "Sint-Pietersplein", parking = "P", capaciteit = 700, straatnaam = "Sint-Pietersplein", huisnr = "1", geo_point_2d = new { lat = 51.0356, lon = 3.7104 } },
            new { urid = "mob/p2", naam = "P+R Bourgoyen", parking = "P+R", capaciteit = 300, geo_point_2d = new { lat = 51.0700, lon = 3.6900 } },
        ];
        gent.Datasets["bezetting-parkeergarages-real-time"] =
        [
            new
            {
                id = "https://stad.gent/parking/sint-pietersplein", name = "Sint-Pietersplein", totalcapacity = 700,
                availablecapacity = 350, isopennow = 1, temporaryclosed = 0,
                location = new { lat = 51.0356, lon = 3.7104 }, lastupdate = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            },
        ];
    }
}

/// <summary>/api/admin/*: toegang, whoami, sync, backfill en het logboek.</summary>
public class AdminEndpointsTests(AdminFactory factory) : IClassFixture<AdminFactory>
{
    private sealed record StreetRateAdmin(string Zone, string Period, int Hours, decimal AmountEur);
    private const string AdminPassword = "test-admin-password";

    private HttpRequestMessage Request(HttpMethod method, string url, string? email = AdminFactory.Admin,
        string? key = AdminFactory.ProxyKey, string? name = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (email is not null) request.With("Remote-Email", email);
        if (key is not null) request.With("X-Proxy-Key", key);
        if (name is not null) request.With("Remote-Name", name);
        return request;
    }

    [Theory]
    [InlineData("GET", "/api/admin/whoami")]
    [InlineData("POST", "/api/admin/sync")]
    [InlineData("POST", "/api/admin/backfill")]
    [InlineData("GET", "/api/admin/runs")]
    [InlineData("GET", "/api/admin/street-tariffs")]
    [InlineData("GET", "/api/admin/parkings")]
    public async Task Anonymous_callers_get_401(string method, string url)
    {
        var response = await factory.NewClient().SendAsync(Request(new HttpMethod(method), url, email: null, key: null));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Admin_login_requires_an_allowlisted_email_and_correct_password_then_issues_a_session()
    {
        var client = factory.NewClient(handleCookies: true);
        var rejected = await client.PostAsJsonAsync("/api/admin/login", new
        {
            email = "other@example.be",
            password = AdminPassword,
        });
        Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);

        var accepted = await client.PostAsJsonAsync("/api/admin/login", new
        {
            email = AdminFactory.Admin,
            password = AdminPassword,
        });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/admin/whoami")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/admin/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/whoami")).StatusCode);
    }

    [Fact]
    public async Task Admin_login_rejects_a_wrong_password()
    {
        var response = await factory.NewClient().PostAsJsonAsync("/api/admin/login", new
        {
            email = AdminFactory.Admin,
            password = "wrong-password",
        });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("admin@example.be", null)]          // kop zonder geheim
    [InlineData("admin@example.be", "fout")]        // verkeerd geheim
    [InlineData("admin@example.be", "")]            // leeg geheim
    [InlineData("admin@example.be", "GEHEIM-123")]  // geheim is hoofdlettergevoelig
    [InlineData(null, AdminFactory.ProxyKey)]       // geheim zonder identiteit
    [InlineData("nobody@example.be", AdminFactory.ProxyKey)] // geldig geheim, maar geen beheerder
    [InlineData("   ", AdminFactory.ProxyKey)]      // lege identiteit
    public async Task Callers_without_a_valid_proxy_key_or_admin_identity_get_401(string? email, string? key)
    {
        var response = await factory.NewClient().SendAsync(Request(HttpMethod.Get, "/api/admin/whoami", email, key));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Rejected_callers_do_not_trigger_a_sync()
    {
        var before = factory.Gent.Requests.Count;

        await factory.NewClient().SendAsync(Request(HttpMethod.Post, "/api/admin/sync", key: "fout"));

        Assert.Equal(before, factory.Gent.Requests.Count);
    }

    [Theory]
    [InlineData("admin@example.be")]
    [InlineData("ADMIN@EXAMPLE.BE")]
    [InlineData("  Admin@Example.be  ")]
    [InlineData("tweede@example.be")]   // het tweede adres na de puntkomma
    public async Task Admins_are_recognised_case_insensitively(string email)
    {
        var response = await factory.NewClient().SendAsync(Request(HttpMethod.Get, "/api/admin/whoami", email));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Equal(email.Trim().ToLowerInvariant(), body.GetProperty("email").GetString());
        Assert.True(body.GetProperty("isAdmin").GetBoolean());
    }

    [Fact]
    public async Task Whoami_uses_the_name_header_or_falls_back_to_the_email()
    {
        var named = await (await factory.NewClient().SendAsync(Request(HttpMethod.Get, "/api/admin/whoami", name: " Ada "))).JsonAsync();
        var unnamed = await (await factory.NewClient().SendAsync(Request(HttpMethod.Get, "/api/admin/whoami"))).JsonAsync();

        Assert.Equal("Ada", named.GetProperty("name").GetString());
        Assert.Equal(AdminFactory.Admin, unnamed.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Sync_runs_a_round_and_logs_it()
    {
        var response = await factory.NewClient().SendAsync(Request(HttpMethod.Post, "/api/admin/sync"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var run = await response.JsonAsync();
        Assert.True(run.GetProperty("ok").GetBoolean());
        Assert.Equal("handmatig", run.GetProperty("trigger").GetString());
        Assert.Equal(2, run.GetProperty("catalogueCount").GetInt32());
        Assert.Equal(1, run.GetProperty("liveCount").GetInt32());

        // De ronde heeft de parkings in de databank gezet, ook de openbare lijst.
        var list = await (await factory.NewClient().GetAsync("/api/parkings?x=sync")).JsonAsync();
        Assert.Contains(list.EnumerateArray(), p => p.GetProperty("name").GetString() == "Sint-Pietersplein" && p.GetProperty("hasLiveData").GetBoolean());
        Assert.Contains(list.EnumerateArray(), p => p.GetProperty("name").GetString() == "P+R Bourgoyen" && !p.GetProperty("hasLiveData").GetBoolean());
    }

    [Fact]
    public async Task Sync_reports_a_failed_round_instead_of_crashing_when_the_source_is_down()
    {
        factory.Gent.Down = true;
        try
        {
            var response = await factory.NewClient().SendAsync(Request(HttpMethod.Post, "/api/admin/sync"));

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var run = await response.JsonAsync();
            Assert.False(run.GetProperty("ok").GetBoolean());
            Assert.False(string.IsNullOrEmpty(run.GetProperty("message").GetString()));
        }
        finally
        {
            factory.Gent.Down = false;
        }
    }

    [Fact]
    public async Task Backfill_reports_how_many_points_it_added()
    {
        var response = await factory.NewClient().SendAsync(Request(HttpMethod.Post, "/api/admin/backfill"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, (await response.JsonAsync()).GetProperty("added").GetInt32());
    }

    [Theory]
    [InlineData(null, true)]     // standaard 50: alles
    [InlineData(1, false)]
    [InlineData(0, false)]       // te klein: vastgezet op 1
    [InlineData(-10, false)]
    [InlineData(100000, true)]   // te groot: vastgezet op 500
    public async Task Runs_clamps_take_and_lists_newest_first(int? take, bool all)
    {
        // Zorg voor minstens twee rondes: de opstartronde en een handmatige.
        await factory.NewClient().SendAsync(Request(HttpMethod.Post, "/api/admin/sync"));
        var url = "/api/admin/runs" + (take is null ? "" : $"?take={take}");

        var response = await factory.NewClient().SendAsync(Request(HttpMethod.Get, url));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var runs = (await response.JsonAsync()).EnumerateArray().ToArray();
        if (all) Assert.True(runs.Length >= 2); else Assert.Single(runs);
        var starts = runs.Select(r => r.GetProperty("startedUtc").GetDateTime()).ToArray();
        Assert.Equal(starts.OrderByDescending(s => s), starts);
    }

    [Fact]
    public async Task Street_tariffs_can_be_updated_but_their_structure_cannot_be_changed()
    {
        var client = factory.NewClient();
        var before = await (await client.SendAsync(Request(HttpMethod.Get, "/api/admin/street-tariffs"))).JsonAsync();
        var rows = JsonSerializer.Deserialize<List<StreetRateAdmin>>(
            before.GetRawText(), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        rows[0] = rows[0] with { AmountEur = rows[0].AmountEur + 0.25m };

        using var update = Request(HttpMethod.Put, "/api/admin/street-tariffs");
        update.Content = JsonContent.Create(rows);
        var saved = await client.SendAsync(update);

        Assert.Equal(HttpStatusCode.NoContent, saved.StatusCode);
        var after = await (await client.SendAsync(Request(HttpMethod.Get, "/api/admin/street-tariffs"))).JsonAsync();
        Assert.Equal(rows[0].AmountEur, after[0].GetProperty("amountEur").GetDecimal());

        using var invalid = Request(HttpMethod.Put, "/api/admin/street-tariffs");
        invalid.Content = JsonContent.Create(rows.Take(rows.Count - 1));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(invalid)).StatusCode);
    }

    [Fact]
    public async Task Manual_parking_and_rate_are_public_and_can_be_deleted()
    {
        var client = factory.NewClient();
        var name = $"Testparking {Guid.NewGuid():N}";
        var requestBody = new
        {
            name,
            address = "Teststraat 1, Gent",
            latitude = 51.05,
            longitude = 3.72,
            rate = new
            {
                weekdayHourlyEur = 2.5m,
                weekdayStart = "07:00:00",
                weekdayEnd = "19:00:00",
                daytimeMaximumEur = 12m,
                daytimeStart = "07:00:00",
                daytimeEnd = "19:00:00",
                nighttimeMaximumEur = 7m,
                nighttimeStart = "19:00:00",
                nighttimeEnd = "07:00:00",
                dailyMaximumEur = 18m,
                weekendHourlyEur = 3m,
            },
        };
        using var create = Request(HttpMethod.Post, "/api/admin/parkings");
        create.Content = JsonContent.Create(requestBody);
        var response = await client.SendAsync(create);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.JsonAsync();
        var slug = created.GetProperty("slug").GetString()!;
        Assert.True(created.GetProperty("isManual").GetBoolean());

        var publicRows = await (await client.GetAsync("/api/parkings?manual-test=1")).JsonAsync();
        var listed = Assert.Single(publicRows.EnumerateArray(), p => p.GetProperty("slug").GetString() == slug);
        Assert.True(listed.GetProperty("isManual").GetBoolean());
        Assert.Equal(2.5m, listed.GetProperty("manualRate").GetProperty("weekdayHourlyEur").GetDecimal());
        Assert.False(listed.GetProperty("hasLiveData").GetBoolean());

        var updateRate = new
        {
            weekdayHourlyEur = 3m,
            weekdayStart = "07:00:00",
            weekdayEnd = "19:00:00",
            daytimeMaximumEur = 12m,
            daytimeStart = "07:00:00",
            daytimeEnd = "19:00:00",
            nighttimeMaximumEur = 7m,
            nighttimeStart = "19:00:00",
            nighttimeEnd = "07:00:00",
            dailyMaximumEur = 18m,
            weekendHourlyEur = 3m,
        };
        using var update = Request(HttpMethod.Put, $"/api/admin/parkings/{slug}/rate");
        update.Content = JsonContent.Create(updateRate);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(update)).StatusCode);

        using var delete = Request(HttpMethod.Delete, $"/api/admin/parkings/{slug}");
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(delete)).StatusCode);
    }

    [Fact]
    public async Task Admin_can_add_list_and_delete_a_manual_event_that_shows_publicly()
    {
        var client = factory.NewClient();
        using var create = Request(HttpMethod.Post, "/api/admin/events");
        create.Content = JsonContent.Create(new
        {
            name = "Handmatig feest",
            url = "https://example.be/feest",
            coverImageUrl = "https://example.be/feest.jpg",
            coverPhotoId = "photo-1",
            coverAccessibilityCaption = "Een feest",
            isOnline = false,
            isPast = false,
            isHappeningNow = false,
            startsAtUtc = "2030-05-01T18:00:00Z",
            dayTimeLabel = "Wo 1 mei, 20:00",
            placeName = "Vooruit",
            kind = "feest",
            socialSummary = "12 gaan",
            interestedCount = 30,
            goingCount = 12,
            wentCount = 0,
            ticketPriceLabel = "Gratis",
            description = "Een testbeschrijving.",
        });
        var response = await client.SendAsync(create);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var id = (await response.JsonAsync()).GetProperty("id").GetString()!;
        Assert.StartsWith("manual-", id);

        var detail = await (await client.GetAsync($"/api/events/{id}")).JsonAsync();
        Assert.Equal("Een testbeschrijving.", detail.GetProperty("description").GetString());
        Assert.Equal("Vooruit", detail.GetProperty("event").GetProperty("place").GetString());
        Assert.DoesNotContain(factory.Social.Urls, u => u.Contains(id));

        var list = await (await client.GetAsync("/api/events")).JsonAsync();
        Assert.Contains(list.EnumerateArray(), e => e.GetProperty("id").GetString() == id);

        using var listAdmin = Request(HttpMethod.Get, "/api/admin/events");
        var admins = await (await client.SendAsync(listAdmin)).JsonAsync();
        Assert.Contains(admins.EnumerateArray(), e => e.GetProperty("id").GetString() == id);

        using var delete = Request(HttpMethod.Delete, $"/api/admin/events/{id}");
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(delete)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/events/{id}")).StatusCode);
    }

    [Theory]
    [InlineData("", "https://example.be", "2030-05-01T18:00:00Z", false)]
    [InlineData("Naam", "javascript:alert(1)", "2030-05-01T18:00:00Z", false)]
    [InlineData("Naam", "https://example.be", "2030-05-01T18:00:00", false)]
    [InlineData("Naam", "https://example.be", "2030-05-01T18:00:00Z", true)]
    public async Task Invalid_manual_events_are_rejected(string name, string url, string startsAt, bool pastAndNow)
    {
        using var create = Request(HttpMethod.Post, "/api/admin/events");
        create.Content = JsonContent.Create(new
        {
            name, url, startsAtUtc = startsAt, isPast = pastAndNow, isHappeningNow = pastAndNow,
        });

        var response = await factory.NewClient().SendAsync(create);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Imported_events_cannot_be_deleted_through_the_admin_api()
    {
        using var delete = Request(HttpMethod.Delete, $"/api/admin/events/{SeededFactory.EventUpcoming}");

        Assert.Equal(HttpStatusCode.NotFound, (await factory.NewClient().SendAsync(delete)).StatusCode);
    }

    [Theory]
    [InlineData("POST", "/api/admin/events")]
    [InlineData("GET", "/api/admin/events")]
    [InlineData("DELETE", "/api/admin/events/manual-x")]
    public async Task Anonymous_callers_cannot_manage_events(string method, string url)
    {
        var response = await factory.NewClient().SendAsync(new HttpRequestMessage(new HttpMethod(method), url));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}

public class AdminWithoutProxyKeyTests(OpenProxyFactory factory) : IClassFixture<OpenProxyFactory>
{
    [Fact]
    public async Task Without_a_configured_proxy_key_the_identity_header_is_not_trusted()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/admin/whoami").With("Remote-Email", "tweede@example.be");

        var response = await factory.NewClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_non_admin_header_is_still_refused()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/admin/whoami").With("Remote-Email", "iemand@example.be");

        var response = await factory.NewClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task No_header_means_anonymous_outside_development()
    {
        var response = await factory.NewClient().GetAsync("/api/admin/whoami");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}

public class AdminWithoutAdminsTests(NoAdminsFactory factory) : IClassFixture<NoAdminsFactory>
{
    [Fact]
    public async Task An_empty_admin_list_means_nobody_is_admin()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/admin/whoami")
            .With("Remote-Email", "admin@example.be").With("X-Proxy-Key", AdminFactory.ProxyKey);

        var response = await factory.NewClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}

public class AdminInDevelopmentTests(DevelopmentFactory factory) : IClassFixture<DevelopmentFactory>
{
    [Fact]
    public async Task Development_mode_does_not_implicitly_authenticate_a_configured_admin_email()
    {
        var response = await factory.NewClient().GetAsync("/api/admin/whoami");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_real_header_is_still_checked_against_the_admin_allowlist()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/admin/whoami").With("Remote-Email", "iemand@example.be");

        var response = await factory.NewClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}

/// <summary>Gezondheid, bronbereikbaarheid en wat voor elk verzoek geldt.</summary>
public class PlatformTests(SeededFactory factory) : IClassFixture<SeededFactory>
{
    [Fact]
    public async Task Health_is_healthy_when_the_database_answers()
    {
        var response = await factory.NewClient().GetAsync("/api/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Health_source_is_ok_when_the_city_answers()
    {
        factory.Gent.Datasets["bezetting-parkeergarages-real-time"] = [];

        var response = await factory.NewClient().GetAsync("/api/health/source");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True((await response.JsonAsync()).GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task Health_source_is_503_when_the_city_does_not_answer()
    {
        factory.Gent.Down = true;
        try
        {
            var response = await factory.NewClient().GetAsync("/api/health/source");

            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        }
        finally
        {
            factory.Gent.Down = false;
        }
    }

    [Theory]
    [InlineData("/api/parkings")]
    [InlineData("/api/health")]
    [InlineData("/api/bestaat-niet")]
    [InlineData("/api/admin/whoami")]
    public async Task Every_api_response_forbids_content_sniffing(string url)
    {
        var response = await factory.NewClient().GetAsync(url);

        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task Paths_outside_api_are_not_given_the_header()
    {
        var response = await factory.NewClient().GetAsync("/");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.False(response.Headers.Contains("X-Content-Type-Options"));
    }

    [Theory]
    [InlineData("/api/bestaat-niet")]
    [InlineData("/api/parkings/a/b/c")]
    [InlineData("/api/friends")]
    public async Task Unknown_routes_are_404(string url)
    {
        var response = await factory.NewClient().GetAsync(url);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("POST", "/api/parkings")]
    [InlineData("DELETE", "/api/stats")]
    [InlineData("PUT", "/api/events")]
    [InlineData("GET", "/api/route/ezpark")]
    [InlineData("GET", "/api/transit/route")]
    public async Task Wrong_methods_are_405(string method, string url)
    {
        var response = await factory.NewClient().SendAsync(new HttpRequestMessage(new HttpMethod(method), url));

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }

    [Fact]
    public async Task One_visitor_that_hammers_the_api_is_limited_without_affecting_others()
    {
        var hammer = factory.NewClient();
        var ok = 0;
        var limitedAfter = -1;
        for (var i = 0; i < 200 && limitedAfter < 0; i++)
        {
            var status = (await hammer.GetAsync("/api/health")).StatusCode;
            if (status == HttpStatusCode.TooManyRequests) limitedAfter = i; else ok++;
        }

        Assert.True(limitedAfter > 0, "Er kwam nooit een 429.");
        Assert.InRange(ok, 1, 120);
        Assert.Equal(HttpStatusCode.OK, (await factory.NewClient().GetAsync("/api/health")).StatusCode);
    }
}

public class CacheFactory : ApiFactory;

/// <summary>De antwoordcache van 30 seconden: dezelfde vraag raakt de databank niet opnieuw.</summary>
public class OutputCacheTests(CacheFactory factory) : IClassFixture<CacheFactory>
{
    [Fact]
    public async Task Repeated_reads_come_from_the_cache_and_a_different_query_does_not()
    {
        var client = factory.NewClient();
        var before = await (await client.GetAsync("/api/parkings")).JsonAsync();
        Assert.Empty(before.EnumerateArray());

        await factory.WithDbAsync(async db =>
        {
            db.Parkings.Add(new ParkingGent.Api.Domain.Parking
            {
                Slug = "cached", ExternalId = "x", Name = "Cached", Latitude = 51, Longitude = 3.7,
                FirstSeenUtc = DateTime.UtcNow, LastSeenUtc = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        var cached = await (await client.GetAsync("/api/parkings")).JsonAsync();
        Assert.Empty(cached.EnumerateArray());

        // De detailpagina heeft een eigen sleutel, dus die ziet de nieuwe rij wel.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/parkings/cached")).StatusCode);
        Assert.Equal(1, await factory.WithDbAsync(db => db.Parkings.CountAsync()));
    }
}
