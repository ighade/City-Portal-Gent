using System.Net;
using System.Text;
using System.Text.Json;
using ParkingGent.Api.Services;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Tests;

public class MuseumServiceTests
{
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(respond(request));
        }
    }

    private static MuseumService Service(Handler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("https://query.wikidata.org/sparql") });

    private static Museum Featured() => new() { WikidataId = "Q2365880", FeaturedObjectId = "Q21674415" };

    [Fact]
    public async Task Featured_object_is_scoped_to_museum_and_links_to_its_image_source()
    {
        var handler = new Handler(request =>
        {
            var query = Uri.UnescapeDataString(request.RequestUri!.Query);
            Assert.Contains("wd:Q2365880", query);
            Assert.Contains("wd:Q21674415", query);
            return Json("""
                {"results":{"bindings":[{"item":{"value":"http://www.wikidata.org/entity/Q21674415"},"itemLabel":{"value":"Een werk"},"itemDescription":{"value":"Een schilderij"},"image":{"value":"http://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg"}}]}}
                """);
        });
        var result = await Service(handler).GetCollectionAsync(Featured(), CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal("Een werk", result.Title);
        Assert.Equal("Een schilderij", result.Description);
        Assert.Equal("https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg?width=400", result.ImageUrl);
        Assert.Equal("https://commons.wikimedia.org/wiki/File:Example.jpg", result.ImageSourceUrl);
        Assert.Equal("https://www.wikidata.org/wiki/Q21674415", result.ObjectUrl);
    }

    [Fact]
    public async Task Missing_or_unavailable_collection_is_not_fabricated()
    {
        var handler = new Handler(_ => Json("""{"results":{"bindings":[]}}"""));
        var service = Service(handler);
        Assert.Null(await service.GetCollectionAsync(new Museum(), CancellationToken.None));
        Assert.Equal(0, handler.Calls);
        Assert.Null(await service.GetCollectionAsync(Featured(), CancellationToken.None));
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Invalid_image_and_upstream_failure_are_errors()
    {
        var invalid = new Handler(_ => Json("""
            {"results":{"bindings":[{"item":{"value":"http://www.wikidata.org/entity/Q1"},"itemLabel":{"value":"Werk"},"image":{"value":"https://example.com/image.jpg"}}]}}
            """));
        await Assert.ThrowsAsync<JsonException>(() => Service(invalid).GetCollectionAsync(Featured(), CancellationToken.None));
        var failure = new Handler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        await Assert.ThrowsAsync<HttpRequestException>(() => Service(failure).GetCollectionAsync(Featured(), CancellationToken.None));
    }

    private static HttpResponseMessage Json(string content) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(content, Encoding.UTF8, "application/json"),
    };
}
