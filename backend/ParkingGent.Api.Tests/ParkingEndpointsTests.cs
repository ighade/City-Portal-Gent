namespace ParkingGent.Api.Tests;

/// <summary>GET /api/parkings, /api/parkings/{slug}, /history en /trend.</summary>
public class ParkingEndpointsTests(SeededFactory factory) : IClassFixture<SeededFactory>
{
    private readonly HttpClient client = factory.NewClient();

    [Fact]
    public async Task List_returns_all_parkings_ordered_by_kind_then_name()
    {
        var response = await client.GetAsync("/api/parkings");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var slugs = (await response.JsonAsync()).EnumerateArray().Select(p => p.GetProperty("slug").GetString()).ToArray();
        Assert.Equal(
            ["t-garage-a", "t-garage-b", "t-garage-c", "t-garage-d", "t-pr-e", "t-bike-f", "t-bike-g", "t-bike-h"],
            slugs);
    }

    [Fact]
    public async Task List_maps_status_staleness_and_hides_implausible_occupancy()
    {
        var all = (await (await client.GetAsync("/api/parkings")).JsonAsync()).EnumerateArray()
            .ToDictionary(p => p.GetProperty("slug").GetString()!);

        var fresh = all["t-garage-a"].GetProperty("status");
        Assert.Equal(100, fresh.GetProperty("available").GetInt32());
        Assert.Equal(80, fresh.GetProperty("occupancy").GetInt32());
        Assert.False(fresh.GetProperty("isStale").GetBoolean());

        Assert.True(all["t-garage-b"].GetProperty("status").GetProperty("isStale").GetBoolean());

        // Een meting die zichzelf tegenspreekt toont geen percentage, wel het aantal vrije plaatsen.
        var implausible = all["t-garage-c"].GetProperty("status");
        Assert.False(implausible.TryGetProperty("occupancy", out _));
        Assert.Equal(150, implausible.GetProperty("available").GetInt32());

        Assert.False(all["t-pr-e"].TryGetProperty("status", out _));
        Assert.Equal("park-and-ride", all["t-pr-e"].GetProperty("kind").GetString());
        Assert.Equal("bicycle", all["t-bike-f"].GetProperty("kind").GetString());
        Assert.False(all["t-bike-g"].GetProperty("isPublic").GetBoolean());
    }

    [Fact]
    public async Task Detail_returns_one_parking()
    {
        var response = await client.GetAsync("/api/parkings/t-garage-a");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Equal("Garage A", body.GetProperty("name").GetString());
        Assert.Equal(500, body.GetProperty("capacity").GetInt32());
        Assert.True(body.GetProperty("hasLiveData").GetBoolean());
    }

    [Theory]
    [InlineData("bestaat-niet")]
    [InlineData("t-garage-a%20")]
    [InlineData("%27%3B%20DROP%20TABLE%20%22Parkings%22%3B--")]
    public async Task Detail_returns_404_with_error_for_unknown_slug(string slug)
    {
        var response = await client.GetAsync($"/api/parkings/{slug}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.False(string.IsNullOrEmpty((await response.JsonAsync()).GetProperty("error").GetString()));
    }

    [Theory]
    [InlineData(null, 4)]       // standaard 24 uur: de meting van 30 uur geleden valt erbuiten
    [InlineData(1, 4)]
    [InlineData(0, 4)]          // te klein: vastgezet op 1 uur
    [InlineData(-5, 4)]
    [InlineData(48, 5)]
    [InlineData(100000, 8)]     // te groot: vastgezet op 14 dagen, de meting van 200 dagen geleden telt niet mee
    public async Task History_clamps_hours_and_returns_points_in_time_order(int? hours, int expected)
    {
        var url = "/api/parkings/t-garage-a/history" + (hours is null ? "" : $"?hours={hours}");

        var response = await client.GetAsync(url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var points = (await response.JsonAsync()).EnumerateArray().ToArray();
        Assert.Equal(expected, points.Length);
        var times = points.Select(p => p.GetProperty("atUtc").GetDateTime()).ToArray();
        Assert.Equal(times.OrderBy(t => t), times);
    }

    [Fact]
    public async Task History_of_unknown_slug_is_an_empty_list()
    {
        var response = await client.GetAsync("/api/parkings/bestaat-niet/history");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await response.JsonAsync()).EnumerateArray());
    }

    [Fact]
    public async Task History_with_non_numeric_hours_is_a_bad_request()
    {
        var response = await client.GetAsync("/api/parkings/t-garage-a/history?hours=abc");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Trend_averages_measurements_per_weekday_and_hour()
    {
        var response = await client.GetAsync("/api/parkings/t-garage-a/trend");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Equal(60, body.GetProperty("days").GetInt32());
        Assert.Equal("Garage A", body.GetProperty("name").GetString());

        var local = BrusselsTime(SeededFactory.TrendHourUtc);
        var weekday = ((int)local.DayOfWeek + 6) % 7; // maandag = 0
        var cell = body.GetProperty("cells").EnumerateArray()
            .Single(c => c.GetProperty("weekday").GetInt32() == weekday && c.GetProperty("hour").GetInt32() == local.Hour);
        Assert.Equal(3, cell.GetProperty("samples").GetInt32());
        Assert.Equal(40, cell.GetProperty("occupancy").GetInt32());
    }

    [Theory]
    [InlineData(0, 7, false)]      // te klein: 7 dagen, dus de meting van 10 dagen geleden telt niet
    [InlineData(-3, 7, false)]
    [InlineData(30, 30, true)]
    [InlineData(1000, 120, true)]  // te groot: 120 dagen
    public async Task Trend_clamps_days(int days, int expectedDays, bool includesTenDayOldCell)
    {
        var response = await client.GetAsync($"/api/parkings/t-garage-a/trend?days={days}");

        var body = await response.JsonAsync();
        Assert.Equal(expectedDays, body.GetProperty("days").GetInt32());
        var local = BrusselsTime(SeededFactory.TrendHourUtc);
        var weekday = ((int)local.DayOfWeek + 6) % 7;
        var found = body.GetProperty("cells").EnumerateArray()
            .Any(c => c.GetProperty("weekday").GetInt32() == weekday && c.GetProperty("hour").GetInt32() == local.Hour
                      && c.GetProperty("samples").GetInt32() == 3);
        Assert.Equal(includesTenDayOldCell, found);
    }

    [Fact]
    public async Task Trend_ignores_cells_with_fewer_than_three_samples()
    {
        // Garage A heeft maar één meting van 30 uur geleden in zijn eigen uur: geen vakje.
        var body = await (await client.GetAsync("/api/parkings/t-garage-a/trend?days=7")).JsonAsync();

        Assert.All(body.GetProperty("cells").EnumerateArray(), c => Assert.True(c.GetProperty("samples").GetInt32() >= 3));
    }

    [Fact]
    public async Task Trend_for_parking_without_measurements_has_no_cells()
    {
        var response = await client.GetAsync("/api/parkings/t-garage-b/trend");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await response.JsonAsync()).GetProperty("cells").EnumerateArray());
    }

    [Fact]
    public async Task Trend_returns_404_for_unknown_slug()
    {
        var response = await client.GetAsync("/api/parkings/bestaat-niet/trend");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private static DateTime BrusselsTime(DateTime utc)
    {
        // Dezelfde terugval als de API: zonder tijdzonedatabank rekent ze in UTC.
        try { return TimeZoneInfo.ConvertTimeFromUtc(utc.AddMinutes(5), TimeZoneInfo.FindSystemTimeZoneById("Europe/Brussels")); }
        catch (TimeZoneNotFoundException) { return utc.AddMinutes(5); }
    }
}
