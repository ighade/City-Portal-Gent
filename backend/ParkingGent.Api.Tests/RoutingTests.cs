using System.Net.Http.Json;

namespace ParkingGent.Api.Tests;

/// <summary>POST /api/route/plan: validatie, OpenRouteService-antwoorden, LEZ en cache.</summary>
public class RoutePlanTests : IClassFixture<RoutingFactory>
{
    private static int counter;
    private readonly RoutingFactory factory;
    private readonly HttpClient client;

    public RoutePlanTests(RoutingFactory factory)
    {
        this.factory = factory;
        client = factory.NewClient();
        factory.Ors.Responder = _ => RoutingFactory.OrsRoute();
    }

    /// <summary>Elke test een eigen start, want RoutePlanner bewaart antwoorden statisch per coördinaat.</summary>
    private static (double Lat, double Lon) UniquePoint()
    {
        var n = Interlocked.Increment(ref counter);
        return (51.1000 + n * 0.0001, 3.8000 + n * 0.0001);
    }

    private Task<HttpResponseMessage> Plan(double sLat, double sLon, double eLat, double eLon, string? mode = "car", bool checkLez = false)
        => client.PostAsJsonAsync("/api/route/plan", new { startLat = sLat, startLon = sLon, endLat = eLat, endLon = eLon, mode, checkLez });

    [Fact]
    public async Task Plans_a_car_route_and_calls_ors_with_lon_lat_order()
    {
        var (lat, lon) = UniquePoint();

        var response = await Plan(lat, lon, lat + 0.01, lon + 0.01);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Equal("car", body.GetProperty("mode").GetString());
        Assert.Equal(1.2, body.GetProperty("distanceKm").GetDouble(), 3);
        Assert.Equal(5, body.GetProperty("durationMinutes").GetDouble(), 3);
        Assert.Equal(2, body.GetProperty("coordinates").GetArrayLength());
        Assert.False(body.GetProperty("lezRestricted").GetBoolean());

        var url = Uri.UnescapeDataString(factory.Ors.Urls.Last(u => u.Contains("driving-car")));
        Assert.Contains($"api_key={RoutingFactory.OrsKey}", url);
        Assert.Contains($"start={lon.ToString(System.Globalization.CultureInfo.InvariantCulture)},{lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}", url);
    }

    [Theory]
    [InlineData("foot-walking", "foot-walking")]
    [InlineData("cycling-regular", "cycling-regular")]
    [InlineData("FOOT-WALKING", "foot-walking")]
    [InlineData("vliegtuig", "car")]  // onbekend: gewoon de auto
    [InlineData(null, "car")]
    [InlineData("", "car")]
    public async Task Maps_the_mode_to_a_routing_profile(string? mode, string expected)
    {
        var (lat, lon) = UniquePoint();

        var response = await Plan(lat, lon, lat + 0.01, lon + 0.01, mode);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(expected, (await response.JsonAsync()).GetProperty("mode").GetString());
        var profile = expected == "car" ? "driving-car" : expected;
        Assert.Contains(factory.Ors.Urls, u => u.Contains($"/v2/directions/{profile}?") && u.Contains($"{lon.ToString(System.Globalization.CultureInfo.InvariantCulture)}"));
    }

    [Fact]
    public async Task Reuses_a_cached_route_for_identical_coordinates()
    {
        var (lat, lon) = UniquePoint();

        await Plan(lat, lon, lat + 0.01, lon + 0.01);
        await Plan(lat, lon, lat + 0.01, lon + 0.01);

        var key = Uri.EscapeDataString($"{lon.ToString(System.Globalization.CultureInfo.InvariantCulture)},{lat.ToString(System.Globalization.CultureInfo.InvariantCulture)}");
        Assert.Single(factory.Ors.Urls.Where(u => u.Contains("start=" + key)));
    }

    [Theory]
    [InlineData(90.0001, 3.7, 51.0, 3.7, "start")]
    [InlineData(-90.0001, 3.7, 51.0, 3.7, "start")]
    [InlineData(51.0, 180.0001, 51.0, 3.7, "start")]
    [InlineData(51.0, -180.0001, 51.0, 3.7, "start")]
    [InlineData(51.0, 3.7, 90.0001, 3.7, "eind")]
    [InlineData(51.0, 3.7, -90.0001, 3.7, "eind")]
    [InlineData(51.0, 3.7, 51.0, 180.0001, "eind")]
    [InlineData(51.0, 3.7, 51.0, -180.0001, "eind")]
    [InlineData(1000, 1000, 51.0, 3.7, "start")]
    public async Task Rejects_out_of_range_coordinates_before_calling_ors(
        double sLat, double sLon, double eLat, double eLon, string which)
    {
        var before = factory.Ors.Requests.Count;

        var response = await Plan(sLat, sLon, eLat, eLon);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(which, (await response.JsonAsync()).GetProperty("error").GetString(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(before, factory.Ors.Requests.Count);
    }

    [Theory]
    [InlineData(90, 180, -90, -180)]
    [InlineData(-90, -180, 90, 180)]
    public async Task Accepts_coordinates_exactly_on_the_boundary(double sLat, double sLon, double eLat, double eLon)
    {
        factory.Ors.Responder = _ => StubHandler.Respond(HttpStatusCode.Forbidden);

        var response = await Plan(sLat, sLon, eLat, eLon);

        // Geldig voor de validatie; de routeplanner zelf (nep-ORS: 403) faalt, en dat is een andere fout.
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Routeplanning kon niet uitgevoerd worden.", (await response.JsonAsync()).GetProperty("error").GetString());
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    public async Task Returns_400_when_ors_refuses(HttpStatusCode orsStatus)
    {
        var (lat, lon) = UniquePoint();
        factory.Ors.Responder = _ => StubHandler.Respond(orsStatus);

        var response = await Plan(lat, lon, lat + 0.01, lon + 0.01);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Routeplanning kon niet uitgevoerd worden.", (await response.JsonAsync()).GetProperty("error").GetString());
    }

    [Theory]
    [InlineData("{\"features\":[]}")]
    [InlineData("not json")]
    [InlineData("{\"features\":[{\"geometry\":{}}]}")]
    public async Task Returns_400_when_ors_answers_with_nothing_usable(string orsBody)
    {
        var (lat, lon) = UniquePoint();
        factory.Ors.Responder = _ => StubHandler.Respond(HttpStatusCode.OK, orsBody);

        var response = await Plan(lat, lon, lat + 0.01, lon + 0.01);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Refuses_a_car_route_into_the_lez_when_asked_to_check()
    {
        var (lat, lon) = UniquePoint();

        var response = await Plan(lat, lon, 51.04, 3.71, checkLez: true);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Equal("lez", body.GetProperty("code").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("error").GetString()));
    }

    [Fact]
    public async Task Refuses_a_car_route_starting_in_the_lez_when_asked_to_check()
    {
        var (lat, lon) = UniquePoint();

        var response = await Plan(51.04, 3.71, lat, lon, checkLez: true);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("lez", (await response.JsonAsync()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Allows_a_route_inside_the_lez_when_not_asked_to_check()
    {
        var (lat, lon) = UniquePoint();

        var response = await Plan(lat, lon, 51.04, 3.71, checkLez: false);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Allows_a_route_outside_the_lez_when_asked_to_check()
    {
        var (lat, lon) = UniquePoint();

        var response = await Plan(lat, lon, lat + 0.02, lon + 0.02, checkLez: true);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Treats_a_point_just_outside_the_lez_border_as_outside()
    {
        var (lat, lon) = UniquePoint();

        var response = await Plan(lat, lon, 51.0400, 3.7201, checkLez: true); // net oostelijk van de rand 3,72

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("{ not json")]
    [InlineData("[]")]
    [InlineData("{\"startLat\":\"abc\",\"startLon\":1,\"endLat\":1,\"endLon\":1}")]
    public async Task Rejects_malformed_bodies(string json)
    {
        var response = await client.PostAsync("/api/route/plan", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_a_request_without_a_body()
    {
        var response = await client.PostAsync("/api/route/plan", null);

        Assert.True(response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.UnsupportedMediaType, response.StatusCode.ToString());
    }

    [Fact]
    public async Task Rejects_a_non_json_content_type()
    {
        var response = await client.PostAsync("/api/route/plan", new StringContent("startLat=1", System.Text.Encoding.UTF8, "text/plain"));

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    [Fact]
    public async Task Does_not_allow_GET()
    {
        var response = await client.GetAsync("/api/route/plan");

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }
}

public class RoutePlanWithoutKeyTests(NoOrsKeyFactory factory) : IClassFixture<NoOrsKeyFactory>
{
    [Fact]
    public async Task Plan_returns_400_when_no_api_key_is_configured()
    {
        var response = await factory.NewClient().PostAsJsonAsync("/api/route/plan",
            new { startLat = 51.0, startLon = 3.7, endLat = 51.1, endLon = 3.8 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.Ors.Requests);
    }

    [Fact]
    public async Task EzPark_has_no_options_without_an_api_key()
    {
        var response = await factory.NewClient().PostAsJsonAsync("/api/route/ezpark",
            new { startLat = 51.0, startLon = 3.7, endLat = 51.1, endLon = 3.8 });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Empty(body.GetProperty("options").EnumerateArray());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("warning").GetString()));
    }
}

/// <summary>POST /api/route/ezpark: welke parkings meedoen en hoe de aanvraag begrensd wordt.</summary>
public class EzParkTests : IClassFixture<RoutingFactory>
{
    private static int counter;
    private readonly RoutingFactory factory;
    private readonly HttpClient client;

    public EzParkTests(RoutingFactory factory)
    {
        this.factory = factory;
        client = factory.NewClient();
        factory.Ors.Responder = _ => RoutingFactory.OrsRoute();
    }

    private static double NextStartLat() => 51.2000 + Interlocked.Increment(ref counter) * 0.0001;

    private Task<HttpResponseMessage> EzPark(object body) => client.PostAsJsonAsync("/api/route/ezpark", body);

    private static string[] Slugs(JsonElement body) =>
        body.GetProperty("options").EnumerateArray().Select(o => o.GetProperty("slug").GetString()!).Order().ToArray();

    [Fact]
    public async Task Suggests_only_open_public_car_parkings_outside_the_lez()
    {
        var response = await EzPark(new { startLat = NextStartLat(), startLon = 3.9, endLat = 51.05, endLon = 3.73 });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        // Dicht, vol, verouderd, personeel, fiets en LEZ vallen af; een parking zonder meting blijft.
        Assert.Equal(["ez-no-status", "ez-outside-open"], Slugs(body));
        Assert.False(body.TryGetProperty("warning", out _));

        var option = body.GetProperty("options").EnumerateArray().First();
        Assert.Equal(5, option.GetProperty("parkMinutes").GetInt32());
        Assert.Equal(5, option.GetProperty("driveMinutes").GetDouble(), 3);
        var variants = option.GetProperty("variants").EnumerateArray().ToArray();
        Assert.Contains(variants, v => v.GetProperty("type").GetString() == "walk");
        Assert.Equal(new[] { "drive", "park", "walk" }, variants[0].GetProperty("legs").EnumerateArray().Select(l => l.GetProperty("mode").GetString()).ToArray());
    }

    [Fact]
    public async Task Includes_lez_parkings_when_avoidLez_is_off()
    {
        var response = await EzPark(new { startLat = NextStartLat(), startLon = 3.9, endLat = 51.05, endLon = 3.73, avoidLez = false });

        Assert.Equal(["ez-inside-lez", "ez-no-status", "ez-outside-open"], Slugs(await response.JsonAsync()));
    }

    [Fact]
    public async Task Reports_when_routes_cannot_be_computed()
    {
        factory.Ors.Responder = _ => StubHandler.Respond(HttpStatusCode.Forbidden);

        var response = await EzPark(new { startLat = NextStartLat(), startLon = 3.9, endLat = 51.05, endLon = 3.73 });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Empty(body.GetProperty("options").EnumerateArray());
        Assert.Equal("De routes konden niet berekend worden.", body.GetProperty("warning").GetString());
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-30, 0)]          // negatief: meteen vertrekken
    [InlineData(60, 60)]
    [InlineData(100000, 720)]     // te ver: vastgezet op twaalf uur
    public async Task Clamps_the_departure_delay(int departInMinutes, int expectedMinutes)
    {
        var response = await EzPark(new { startLat = NextStartLat(), startLon = 3.9, endLat = 51.05, endLon = 3.73, departInMinutes });

        var departure = (await response.JsonAsync()).GetProperty("departureAt").GetDateTime();
        var expected = DateTime.Now.AddMinutes(expectedMinutes);
        Assert.InRange((departure - expected).TotalMinutes, -2, 2);
    }

    [Theory]
    [InlineData(91, 3.7, 51.0, 3.7, "start")]
    [InlineData(51.0, -181, 51.0, 3.7, "start")]
    [InlineData(51.0, 3.7, -91, 3.7, "eind")]
    [InlineData(51.0, 3.7, 51.0, 181, "eind")]
    public async Task Rejects_out_of_range_coordinates(double sLat, double sLon, double eLat, double eLon, string which)
    {
        var response = await EzPark(new { startLat = sLat, startLon = sLon, endLat = eLat, endLon = eLon });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(which, (await response.JsonAsync()).GetProperty("error").GetString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Rejects_malformed_json()
    {
        var response = await client.PostAsync("/api/route/ezpark", new StringContent("{", System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}

/// <summary>Zonder open parkings in de databank: een nette lege uitkomst.</summary>
public class EzParkWithoutParkingsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Says_no_open_parkings_were_found()
    {
        var response = await factory.NewClient().PostAsJsonAsync("/api/route/ezpark",
            new { startLat = 51.0, startLon = 3.7, endLat = 51.1, endLon = 3.8, avoidLez = false });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Empty(body.GetProperty("options").EnumerateArray());
        Assert.Equal("Geen open parkings met vrije plaatsen gevonden.", body.GetProperty("warning").GetString());
    }
}

/// <summary>/api/transit/stops en /api/transit/route, met en zonder geïmporteerde dienstregeling.</summary>
public class TransitWithoutImportTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient client = factory.NewClient();

    [Fact]
    public async Task Stops_returns_503_when_the_schedule_was_never_imported()
    {
        var response = await client.GetAsync("/api/transit/stops");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.False(string.IsNullOrEmpty((await response.JsonAsync()).GetProperty("error").GetString()));
    }

    [Fact]
    public async Task Route_returns_503_when_the_schedule_was_never_imported()
    {
        var response = await client.PostAsJsonAsync("/api/transit/route",
            new { startLat = 51.05, startLon = 3.72, endLat = 51.04, endLon = 3.71 });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Theory]
    [InlineData(91, 3.7, 51.0, 3.7, "start")]
    [InlineData(51.0, 181, 51.0, 3.7, "start")]
    [InlineData(51.0, 3.7, -91, 3.7, "eind")]
    [InlineData(51.0, 3.7, 51.0, -181, "eind")]
    public async Task Route_validates_coordinates_before_looking_at_the_schedule(
        double sLat, double sLon, double eLat, double eLon, string which)
    {
        var response = await client.PostAsJsonAsync("/api/transit/route",
            new { startLat = sLat, startLon = sLon, endLat = eLat, endLon = eLon });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(which, (await response.JsonAsync()).GetProperty("error").GetString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Route_rejects_malformed_json()
    {
        var response = await client.PostAsync("/api/transit/route", new StringContent("{", System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}

public class TransitWithStopsTests(TransitStopsFactory factory) : IClassFixture<TransitStopsFactory>
{
    private readonly HttpClient client = factory.NewClient();

    [Fact]
    public async Task Stops_are_listed_alphabetically_with_their_lines()
    {
        var response = await client.GetAsync("/api/transit/stops");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var stops = (await response.JsonAsync()).EnumerateArray().ToArray();
        Assert.Equal(["Centrum", "Zuid"], stops.Select(s => s.GetProperty("name").GetString()).ToArray());
        Assert.Equal(["Tram 1"], stops[0].GetProperty("lines").EnumerateArray().Select(l => l.GetString()).ToArray());
        Assert.Empty(stops[1].GetProperty("lines").EnumerateArray());
    }

    [Fact]
    public async Task Route_returns_404_when_no_connection_links_the_stops()
    {
        var response = await client.PostAsJsonAsync("/api/transit/route",
            new { startLat = 51.0500, startLon = 3.7200, endLat = 51.0300, endLon = 3.7000 });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Route_returns_404_when_the_destination_is_far_from_every_stop()
    {
        var response = await client.PostAsJsonAsync("/api/transit/route",
            new { startLat = 51.0500, startLon = 3.7200, endLat = 51.1300, endLon = 3.8900 });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
