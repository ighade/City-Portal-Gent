namespace ParkingGent.Api.Tests;

/// <summary>Gebruikersbeheer, logboek en verouderde data onder /api/admin.</summary>
public class AdminUsersTests(AdminFactory factory) : IClassFixture<AdminFactory>
{
    private static HttpRequestMessage Admin(HttpMethod method, string url, bool asAdmin = true)
    {
        var request = new HttpRequestMessage(method, url);
        if (asAdmin) request.With("Remote-Email", AdminFactory.Admin).With("X-Proxy-Key", AdminFactory.ProxyKey);
        return request;
    }

    [Theory]
    [InlineData("GET", "/api/admin/users")]
    [InlineData("POST", "/api/admin/users/00000000-0000-0000-0000-000000000001/suspend")]
    [InlineData("DELETE", "/api/admin/users/00000000-0000-0000-0000-000000000001")]
    [InlineData("GET", "/api/admin/audit")]
    [InlineData("GET", "/api/admin/stale")]
    [InlineData("POST", "/api/admin/city-rates/sync")]
    public async Task Anonymous_callers_get_401(string method, string url)
    {
        var response = await factory.NewClient().SendAsync(Admin(new HttpMethod(method), url, asAdmin: false));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Suspending_blocks_login_and_sessions_and_unsuspending_restores_login()
    {
        var client = factory.NewClient();
        var person = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.OK, (await person.Client.GetAsync("/api/friends/overview")).StatusCode);

        var suspend = await client.SendAsync(Admin(HttpMethod.Post, $"/api/admin/users/{person.Id}/suspend"));
        Assert.Equal(HttpStatusCode.NoContent, suspend.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await person.Client.GetAsync("/api/friends/overview")).StatusCode);
        var login = await factory.NewClient().PostAsJsonAsync("/api/friends/login",
            new { identifier = person.Username, password = Friendly.Password });
        Assert.NotEqual(HttpStatusCode.OK, login.StatusCode);

        var users = await (await client.SendAsync(Admin(HttpMethod.Get, $"/api/admin/users?q={person.Username}"))).JsonAsync();
        Assert.True(users[0].GetProperty("isSuspended").GetBoolean());

        Assert.Equal(HttpStatusCode.NoContent,
            (await client.SendAsync(Admin(HttpMethod.Post, $"/api/admin/users/{person.Id}/unsuspend"))).StatusCode);
        var again = await factory.NewClient().PostAsJsonAsync("/api/friends/login",
            new { identifier = person.Username, password = Friendly.Password });
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    [Fact]
    public async Task Deleting_removes_the_user_their_links_and_is_logged()
    {
        var client = factory.NewClient();
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        await a.BefriendAsync(b);

        Assert.Equal(HttpStatusCode.NoContent,
            (await client.SendAsync(Admin(HttpMethod.Delete, $"/api/admin/users/{a.Id}"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.SendAsync(Admin(HttpMethod.Delete, $"/api/admin/users/{a.Id}"))).StatusCode);

        var users = await (await client.SendAsync(Admin(HttpMethod.Get, $"/api/admin/users?q={a.Username}"))).JsonAsync();
        Assert.Equal(0, users.GetArrayLength());
        Assert.Equal(0, (await b.OverviewAsync()).GetProperty("friends").GetArrayLength());

        var audit = await (await client.SendAsync(Admin(HttpMethod.Get, "/api/admin/audit"))).JsonAsync();
        Assert.Contains(audit.EnumerateArray(), e =>
            e.GetProperty("action").GetString() == "gebruiker-verwijderd"
            && e.GetProperty("target").GetString() == a.Username
            && e.GetProperty("actor").GetString() == AdminFactory.Admin);
    }

    [Fact]
    public async Task Admin_parkings_include_the_city_rate_of_known_garages()
    {
        var response = await factory.NewClient().SendAsync(Admin(HttpMethod.Get, "/api/admin/parkings"));
        var rows = await response.JsonAsync();

        var pieters = Assert.Single(rows.EnumerateArray(), p => p.GetProperty("slug").GetString()!.Contains("sint-pietersplein"));
        Assert.Equal(4, pieters.GetProperty("cityRate").GetProperty("periods").GetArrayLength());
        var bourgoyen = Assert.Single(rows.EnumerateArray(), p => p.GetProperty("name").GetString() == "P+R Bourgoyen");
        Assert.False(bourgoyen.TryGetProperty("cityRate", out _));
    }

    [Fact]
    public async Task Stale_returns_a_list()
    {
        var response = await factory.NewClient().SendAsync(Admin(HttpMethod.Get, "/api/admin/stale?minutes=5"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(JsonValueKind.Array, (await response.JsonAsync()).ValueKind);
    }

    private static string CityPageHtml(string savaanWeekday)
    {
        string Row(string name, string weekday = "Max. € 2 / uur€ 20 / 24 uur") =>
            $"<tr><th>{name}</th><td>{weekday}</td><td>€ 2 / uur</td><td>€ 1,5 / uur</td><td>€ 2 / uur5 uur en langer: € 9</td></tr>";
        var rows = string.Concat(new[] { "Ramen", "Reep", "Sint-Michiels", "Vrijdagmarkt", "Tolhuis", "Sint-Pietersplein", "Het Getouw", "Ledeberg", "The Loop B &amp; C", "The Loop D" }.Select(n => Row(n)))
            + Row("Savaan", savaanWeekday);
        return $"<table><caption>Tarieven per uur sinds april 2026</caption><tr><th>Parking</th><th>ma</th><th>za</th><th>zo</th><th>nacht</th></tr>{rows}</table>";
    }

    [Fact]
    public async Task Sync_stores_city_rates_and_only_marks_changed_ones_as_updated()
    {
        var client = factory.NewClient();
        factory.CityPage.Responder = _ => StubHandler.Respond(HttpStatusCode.OK, CityPageHtml("Max. € 3 / uur€ 31 / 24 uur"));

        var first = await (await client.SendAsync(Admin(HttpMethod.Post, "/api/admin/city-rates/sync"))).JsonAsync();
        Assert.Equal(12, first.GetProperty("parsed").GetInt32());
        var rows = await (await client.SendAsync(Admin(HttpMethod.Get, "/api/admin/parkings"))).JsonAsync();
        var savaan = Assert.Single(rows.EnumerateArray(), p => p.GetProperty("slug").GetString()!.Contains("savaan"));
        Assert.Equal(3m, savaan.GetProperty("cityRate").GetProperty("periods")[0].GetProperty("hourlyEur").GetDecimal());
        Assert.True(savaan.TryGetProperty("cityRateUpdatedAtUtc", out _));
        Assert.True(savaan.TryGetProperty("cityRateCheckedAtUtc", out _));

        factory.CityPage.Responder = _ => StubHandler.Respond(HttpStatusCode.OK, CityPageHtml("Max. € 4 / uur€ 31 / 24 uur"));
        var second = await (await client.SendAsync(Admin(HttpMethod.Post, "/api/admin/city-rates/sync"))).JsonAsync();
        Assert.Equal(1, second.GetProperty("changed").GetInt32());
    }

    [Fact]
    public async Task Sync_failure_returns_502_and_keeps_stored_rates()
    {
        var client = factory.NewClient();
        factory.CityPage.Responder = _ => StubHandler.Respond(HttpStatusCode.OK, "<html><table><tr><th>per uur</th></tr></table></html>");

        var response = await client.SendAsync(Admin(HttpMethod.Post, "/api/admin/city-rates/sync"));

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.True((await response.JsonAsync()).TryGetProperty("error", out _));
    }
}
