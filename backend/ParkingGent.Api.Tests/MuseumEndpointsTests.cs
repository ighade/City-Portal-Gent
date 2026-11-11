namespace ParkingGent.Api.Tests;

public class MuseumEndpointsTests(AdminFactory factory) : IClassFixture<AdminFactory>
{
    private static HttpRequestMessage Admin(HttpMethod method, string url, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.With("Remote-Email", AdminFactory.Admin).With("X-Proxy-Key", AdminFactory.ProxyKey);
        if (body is not null) request.Content = JsonContent.Create(body);
        return request;
    }

    [Fact]
    public async Task Migration_and_admin_crud_update_public_map_and_invalidate_cache()
    {
        var client = factory.NewClient();
        var initial = await (await client.GetAsync("/api/museums")).JsonAsync();
        Assert.Contains(initial.EnumerateArray(), m => m.GetProperty("id").GetString() == "msk");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/admin/museums")).StatusCode);
        var museum = new { id = "test-museum", name = "Testmuseum", lat = 51.05, lon = 3.72, hours = "Dagelijks", website = "https://example.org", wikidataId = "Q123", featuredObjectId = (string?)null, collectionSummary = "Testcollectie" };
        Assert.Equal(HttpStatusCode.Created, (await client.SendAsync(Admin(HttpMethod.Post, "/api/admin/museums", museum))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/museums/test-museum")).StatusCode);
        var afterCreate = await (await client.GetAsync("/api/museums")).JsonAsync();
        Assert.Contains(afterCreate.EnumerateArray(), m => m.GetProperty("id").GetString() == "test-museum");
        Assert.Equal(HttpStatusCode.Conflict, (await client.SendAsync(Admin(HttpMethod.Post, "/api/admin/museums", museum))).StatusCode);

        var updated = new { museum.id, name = "Gewijzigd", museum.lat, museum.lon, museum.hours, museum.website, museum.wikidataId, museum.featuredObjectId, museum.collectionSummary };
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Admin(HttpMethod.Put, "/api/admin/museums/test-museum", updated))).StatusCode);
        var afterUpdate = await (await client.GetAsync("/api/museums")).JsonAsync();
        Assert.Contains(afterUpdate.EnumerateArray(), m => m.GetProperty("id").GetString() == "test-museum" && m.GetProperty("name").GetString() == "Gewijzigd");
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/museums/test-museum/collection")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(Admin(HttpMethod.Delete, "/api/admin/museums/test-museum"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/museums/test-museum/collection")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/museums/test-museum")).StatusCode);
        var afterDelete = await (await client.GetAsync("/api/museums")).JsonAsync();
        Assert.DoesNotContain(afterDelete.EnumerateArray(), m => m.GetProperty("id").GetString() == "test-museum");
    }

    [Fact]
    public async Task Invalid_input_is_rejected()
    {
        var client = factory.NewClient();
        var invalid = new { id = "bad-id", name = "Test", lat = 51.0, lon = 3.7, hours = "Open", website = "javascript:alert(1)", wikidataId = "Q1 } UNION { ?x ?y ?z", featuredObjectId = "Q1" };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(Admin(HttpMethod.Post, "/api/admin/museums", invalid))).StatusCode);
        var missingCoordinates = new { id = "bad-id", name = "Test", hours = "Open", website = "https://example.org" };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(Admin(HttpMethod.Post, "/api/admin/museums", missingCoordinates))).StatusCode);
        var injection = new { id = "bad-id", name = "Test", lat = 51.0, lon = 3.7, hours = "Open", website = "https://example.org", wikidataId = "Q1 } UNION { ?x ?y ?z", featuredObjectId = "Q1" };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(Admin(HttpMethod.Post, "/api/admin/museums", injection))).StatusCode);
        var noMuseumId = new { id = "bad-id", name = "Test", lat = 51.0, lon = 3.7, hours = "Open", website = "https://example.org", featuredObjectId = "Q1" };
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(Admin(HttpMethod.Post, "/api/admin/museums", noMuseumId))).StatusCode);
    }
}
