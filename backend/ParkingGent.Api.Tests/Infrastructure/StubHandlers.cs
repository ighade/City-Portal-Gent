using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;

namespace ParkingGent.Api.Tests.Infrastructure;

/// <summary>Een nep-server voor uitgaand HTTP-verkeer: onthoudt elke aanvraag en antwoordt met wat de test wil.</summary>
public class StubHandler : HttpMessageHandler
{
    public ConcurrentQueue<HttpRequestMessage> Requests { get; } = new();
    public Func<HttpRequestMessage, HttpResponseMessage> Responder { get; set; } = _ => Respond(HttpStatusCode.NotFound);

    public IEnumerable<string> Urls => Requests.Select(r => r.RequestUri!.ToString());

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Enqueue(request);
        return Task.FromResult(Responder(request));
    }

    public static HttpResponseMessage Respond(HttpStatusCode status, object? body = null) => new(status)
    {
        Content = new StringContent(
            body is null ? "" : body as string ?? JsonSerializer.Serialize(body),
            Encoding.UTF8, "application/json"),
    };
}

/// <summary>
/// De Explore-API van data.stad.gent. Elke dataset is een lijst records; een dataset die niet in de
/// lijst staat antwoordt 404 (nooit 5xx: de veerkrachtlaag zou dan wachtend opnieuw proberen).
/// </summary>
public sealed class FakeGent : StubHandler
{
    public Dictionary<string, object[]> Datasets { get; } = new();

    /// <summary>Als dit aan staat, antwoordt elke aanvraag 404, ook de gezondheidscontrole.</summary>
    public bool Down { get; set; }

    public FakeGent()
    {
        Responder = request =>
        {
            if (Down) return Respond(HttpStatusCode.NotFound);
            var uri = request.RequestUri!;
            var path = uri.AbsolutePath;

            if (path.EndsWith("/catalog/datasets", StringComparison.Ordinal))
                return Respond(HttpStatusCode.OK, new { total_count = 0, results = Array.Empty<object>() });

            const string marker = "/catalog/datasets/";
            var start = path.IndexOf(marker, StringComparison.Ordinal);
            if (start < 0 || !path.EndsWith("/records", StringComparison.Ordinal)) return Respond(HttpStatusCode.NotFound);

            var dataset = path[(start + marker.Length)..^"/records".Length];
            if (!Datasets.TryGetValue(dataset, out var records)) return Respond(HttpStatusCode.NotFound);

            var offset = int.TryParse(System.Web.HttpUtility.ParseQueryString(uri.Query)["offset"], out var o) ? o : 0;
            return Respond(HttpStatusCode.OK, new
            {
                total_count = records.Length,
                results = offset == 0 ? records : Array.Empty<object>(),
            });
        };
    }
}

/// <summary>Geeft de handler door zonder hem te sluiten: de HttpClientFactory ruimt handlers zelf op.</summary>
public sealed class ForwardingHandler(HttpMessageHandler inner) : DelegatingHandler(inner)
{
    protected override void Dispose(bool disposing)
    {
        // De gedeelde stub blijft leven voor de hele test.
    }
}
