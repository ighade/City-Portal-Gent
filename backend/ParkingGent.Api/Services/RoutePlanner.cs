using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace ParkingGent.Api.Services;

public sealed record RoutePlanRequest(
    double StartLat,
    double StartLon,
    double EndLat,
    double EndLon,
    string Mode = "car");

public sealed record RoutePlanResult(
    string Mode,
    double DistanceKm,
    double DurationMinutes,
    double[][] Coordinates,
    string RouteSummary);

public sealed class RoutePlanner(
    HttpClient http,
    IOptions<RoutePlannerOptions> options,
    ILogger<RoutePlanner> log)
{
    public async Task<RoutePlanResult?> PlanAsync(
        double startLat,
        double startLon,
        double endLat,
        double endLon,
        string mode,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(options.Value.ApiKey))
        {
            log.LogWarning("OpenRouteService API key ontbreekt; routeplanning kan niet uitgevoerd worden.");
            return null;
        }

        var normalizedMode = string.Equals(mode, "car", StringComparison.OrdinalIgnoreCase) ? "car" : "car";

        // OpenRouteService expects coordinates as lon,lat, not lat,lon.
        var start = Uri.EscapeDataString($"{startLon.ToString(CultureInfo.InvariantCulture)},{startLat.ToString(CultureInfo.InvariantCulture)}");
        var end = Uri.EscapeDataString($"{endLon.ToString(CultureInfo.InvariantCulture)},{endLat.ToString(CultureInfo.InvariantCulture)}");
        var baseUrl = options.Value.BaseUrl.TrimEnd('/');
        var requestUrl = $"{baseUrl}/v2/directions/driving-car?api_key={Uri.EscapeDataString(options.Value.ApiKey)}&start={start}&end={end}";

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);
            request.Headers.Accept.Clear();
            request.Headers.Accept.ParseAdd("application/geo+json");
            using var response = await http.SendAsync(request, ct);

            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(ct);
                log.LogWarning("OpenRouteService gaf {Status} terug voor route {Start} → {End}: {Body}", response.StatusCode, start, end, body);
                return null;
            }

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var features = document.RootElement.GetProperty("features");
            if (features.GetArrayLength() == 0)
            {
                return null;
            }

            var first = features[0];
            var geometry = first.GetProperty("geometry");
            var routeCoords = geometry.GetProperty("coordinates");
            var points = new List<double[]>();

            foreach (var pair in routeCoords.EnumerateArray())
            {
                if (pair.ValueKind != JsonValueKind.Array || pair.GetArrayLength() < 2) continue;
                points.Add(new[] { pair[0].GetDouble(), pair[1].GetDouble() });
            }

            var summary = first.GetProperty("properties").GetProperty("summary");
            var distanceMeters = summary.GetProperty("distance").GetDouble();
            var durationSeconds = summary.GetProperty("duration").GetDouble();

            return new RoutePlanResult(
                Mode: normalizedMode,
                DistanceKm: distanceMeters / 1000d,
                DurationMinutes: durationSeconds / 60d,
                Coordinates: points.ToArray(),
                RouteSummary: $"{distanceMeters / 1000d:0.1} km · {(durationSeconds / 60d):0} min");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Routeplanning via OpenRouteService mislukte van {StartLat}/{StartLon} naar {EndLat}/{EndLon}.", startLat, startLon, endLat, endLon);
            return null;
        }
    }
}
