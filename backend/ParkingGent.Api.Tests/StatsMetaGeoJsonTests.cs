namespace ParkingGent.Api.Tests;

/// <summary>GET /api/stats, /meta, /geojson en /lez op de vaste testdata.</summary>
public class StatsMetaGeoJsonTests(SeededFactory factory) : IClassFixture<SeededFactory>
{
    private readonly HttpClient client = factory.NewClient();

    [Fact]
    public async Task Stats_counts_only_plausible_car_measurements_and_keeps_bicycles_apart()
    {
        var response = await client.GetAsync("/api/stats");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var s = await response.JsonAsync();
        Assert.Equal(5, s.GetProperty("parkings").GetInt32());        // A, B, C, D, P+R E
        Assert.Equal(4, s.GetProperty("withLiveData").GetInt32());    // E heeft geen meting
        Assert.Equal(3, s.GetProperty("open").GetInt32());            // D is gesloten
        Assert.Equal(800, s.GetProperty("totalCapacity").GetInt32()); // 500 + 100 + 200; C is onmogelijk
        Assert.Equal(150, s.GetProperty("availableSpaces").GetInt32());
        Assert.Equal(81, s.GetProperty("occupancy").GetInt32());      // (800 - 150) / 800
        Assert.True(s.TryGetProperty("measuredAtUtc", out _));

        var bike = s.GetProperty("bicycle");
        Assert.Equal(1, bike.GetProperty("facilities").GetInt32());   // alleen F: G is personeel, H onmogelijk
        Assert.Equal(100, bike.GetProperty("totalCapacity").GetInt32());
        Assert.Equal(20, bike.GetProperty("availableSpaces").GetInt32());
        Assert.Equal(80, bike.GetProperty("occupancy").GetInt32());
    }

    [Fact]
    public async Task Meta_reports_sources_and_the_latest_sync()
    {
        var response = await client.GetAsync("/api/meta");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var m = await response.JsonAsync();
        Assert.Equal("https://data.stad.gent", m.GetProperty("sourceUrl").GetString());
        Assert.Equal(4, m.GetProperty("datasets").GetArrayLength());
        Assert.Equal(5, m.GetProperty("refreshMinutes").GetInt32());
        Assert.True(m.GetProperty("lastSyncOk").GetBoolean());
        Assert.Equal(9, m.GetProperty("measurementCount").GetInt32());
    }

    [Fact]
    public async Task GeoJson_is_a_feature_collection_with_lon_lat_order()
    {
        var response = await client.GetAsync("/api/geojson");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/geo+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.JsonAsync();
        Assert.Equal("FeatureCollection", body.GetProperty("type").GetString());
        var features = body.GetProperty("features").EnumerateArray().ToArray();
        Assert.Equal(8, features.Length);

        var a = features.Single(f => f.GetProperty("properties").GetProperty("slug").GetString() == "t-garage-a");
        var coordinates = a.GetProperty("geometry").GetProperty("coordinates");
        Assert.Equal(3.72, coordinates[0].GetDouble());   // lengte eerst
        Assert.Equal(51.05, coordinates[1].GetDouble());
        Assert.Equal(80, a.GetProperty("properties").GetProperty("occupancy").GetInt32());

        var implausible = features.Single(f => f.GetProperty("properties").GetProperty("slug").GetString() == "t-garage-c");
        Assert.False(implausible.GetProperty("properties").TryGetProperty("occupancy", out var occupancy) && occupancy.ValueKind != JsonValueKind.Null);
    }

    [Fact]
    public async Task Lez_is_an_empty_collection_when_the_source_has_no_zone()
    {
        var response = await client.GetAsync("/api/lez");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/geo+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Empty((await response.JsonAsync()).GetProperty("features").EnumerateArray());
    }
}

/// <summary>Zonder data: elk eindpunt moet netjes leeg antwoorden, niet crashen of delen door nul.</summary>
public class EmptyDatabaseTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient client = factory.NewClient();

    [Fact]
    public async Task Parkings_is_an_empty_array()
    {
        var response = await client.GetAsync("/api/parkings");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await response.JsonAsync()).EnumerateArray());
    }

    [Fact]
    public async Task Stats_has_zero_totals_and_no_occupancy()
    {
        var s = await (await client.GetAsync("/api/stats")).JsonAsync();

        Assert.Equal(0, s.GetProperty("parkings").GetInt32());
        Assert.Equal(0, s.GetProperty("totalCapacity").GetInt32());
        Assert.False(s.TryGetProperty("occupancy", out _));
        Assert.False(s.TryGetProperty("measuredAtUtc", out _));
        Assert.False(s.GetProperty("bicycle").TryGetProperty("occupancy", out _));
    }

    [Fact]
    public async Task Meta_counts_no_measurements()
    {
        var m = await (await client.GetAsync("/api/meta")).JsonAsync();

        Assert.Equal(0, m.GetProperty("measurementCount").GetInt32());
    }

    [Fact]
    public async Task GeoJson_has_no_features()
    {
        var body = await (await client.GetAsync("/api/geojson")).JsonAsync();

        Assert.Empty(body.GetProperty("features").EnumerateArray());
    }

    [Fact]
    public async Task Events_is_an_empty_array()
    {
        var response = await client.GetAsync("/api/events");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await response.JsonAsync()).EnumerateArray());
    }
}
