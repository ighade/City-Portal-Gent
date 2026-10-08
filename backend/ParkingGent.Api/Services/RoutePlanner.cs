using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace ParkingGent.Api.Services;

public sealed record RoutePlanRequest(
    double StartLat,
    double StartLon,
    double EndLat,
    double EndLon,
    string Mode = "car",
    bool CheckLez = false);

public sealed record RoutePlanResult(
    string Mode,
    double DistanceKm,
    double DurationMinutes,
    double[][] Coordinates,
    string RouteSummary,
    bool LezRestricted,
    string? LezWarning);

public sealed class RoutePlanner(
    HttpClient http,
    IOptions<RoutePlannerOptions> options,
    LowEmissionZone lez,
    ILogger<RoutePlanner> log)
{
    public async Task<RoutePlanResult?> PlanAsync(
        double startLat,
        double startLon,
        double endLat,
        double endLon,
        string mode,
        bool checkLez,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(options.Value.ApiKey))
        {
            log.LogWarning("OpenRouteService API key ontbreekt; routeplanning kan niet uitgevoerd worden.");
            return null;
        }

        var normalizedMode = string.Equals(mode, "car", StringComparison.OrdinalIgnoreCase) ? "car" : "car";
        var lezRestricted = false;
        var lezWarning = (string?)null;

        if (checkLez)
        {
            var shapes = await lez.GetAsync(ct);
            var startInLez = IsInsideLez(startLat, startLon, shapes);
            var endInLez = IsInsideLez(endLat, endLon, shapes);

            if (startInLez || endInLez)
            {
                lezRestricted = true;
                lezWarning = "Auto niet toegestaan in de LEZ. Kies een parkeerplaats buiten de zone of neem fiets, bus of trein.";
                return new RoutePlanResult(
                    Mode: normalizedMode,
                    DistanceKm: 0,
                    DurationMinutes: 0,
                    Coordinates: Array.Empty<double[]>(),
                    RouteSummary: string.Empty,
                    LezRestricted: lezRestricted,
                    LezWarning: lezWarning);
            }
        }

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
                RouteSummary: $"{distanceMeters / 1000d:0.1} km · {(durationSeconds / 60d):0} min",
                LezRestricted: lezRestricted,
                LezWarning: lezWarning);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Routeplanning via OpenRouteService mislukte van {StartLat}/{StartLon} naar {EndLat}/{EndLon}.", startLat, startLon, endLat, endLon);
            return null;
        }
    }

    private const double LezBorderToleranceMeters = 1d;

    private static bool IsInsideLez(double latitude, double longitude, IReadOnlyList<JsonElement> shapes)
    {
        foreach (var shape in shapes)
        {
            if (IsInsideGeometry(latitude, longitude, shape))
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsInsideGeometry(double latitude, double longitude, JsonElement geometry)
    {
        if (geometry.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (!geometry.TryGetProperty("type", out var typeElement))
        {
            return false;
        }

        var type = typeElement.GetString();
        if (string.Equals(type, "Polygon", StringComparison.OrdinalIgnoreCase))
        {
            return IsInsidePolygon(latitude, longitude, geometry.GetProperty("coordinates"));
        }

        if (string.Equals(type, "MultiPolygon", StringComparison.OrdinalIgnoreCase))
        {
            var coordinates = geometry.GetProperty("coordinates");
            foreach (var polygon in coordinates.EnumerateArray())
            {
                if (IsInsidePolygon(latitude, longitude, polygon))
                {
                    return true;
                }
            }

            return false;
        }

        if (string.Equals(type, "GeometryCollection", StringComparison.OrdinalIgnoreCase)
            && geometry.TryGetProperty("geometries", out var geometries))
        {
            foreach (var child in geometries.EnumerateArray())
            {
                if (IsInsideGeometry(latitude, longitude, child))
                {
                    return true;
                }
            }
        }

        return false;
    }

    private static bool IsInsidePolygon(double latitude, double longitude, JsonElement coordinates)
    {
        var rings = coordinates.EnumerateArray();
        foreach (var ring in rings)
        {
            var points = new List<(double Lon, double Lat)>();
            foreach (var point in ring.EnumerateArray())
            {
                if (point.ValueKind != JsonValueKind.Array || point.GetArrayLength() < 2) continue;
                var lon = point[0].GetDouble();
                var lat = point[1].GetDouble();
                points.Add((lon, lat));
            }

            if (points.Count <= 2) continue;

            // Een parkeerplaats in de databank ligt soms net binnen de LEZ terwijl de echte toegang
            // van de parking buiten de zone ligt. Door de grens met 1 meter te tolereren, blijven
            // die punten buiten de LEZ vallen: we willen niet dat een parkeerplaats die praktisch
            // bereikbaar is buiten de zone toch als verboden wordt behandeld omdat de geotag net
            // over de grens valt.
            if (IsPointInRing(latitude, longitude, points) && DistanceToBoundaryMeters(latitude, longitude, points) > LezBorderToleranceMeters)
            {
                return true;
            }
        }

        return false;
    }

    private static double DistanceToBoundaryMeters(double latitude, double longitude, List<(double Lon, double Lat)> points)
    {
        var smallestDistance = double.MaxValue;

        for (var i = 0; i < points.Count; i++)
        {
            var current = points[i];
            var next = points[(i + 1) % points.Count];
            var distance = DistancePointToSegmentMeters(latitude, longitude, current.Lat, current.Lon, next.Lat, next.Lon);
            if (distance < smallestDistance)
            {
                smallestDistance = distance;
            }
        }

        return smallestDistance;
    }

    private static double DistancePointToSegmentMeters(
        double latitude,
        double longitude,
        double lat1,
        double lon1,
        double lat2,
        double lon2)
    {
        var x1 = lon1 * 111_320d * Math.Cos(latitude * Math.PI / 180d);
        var y1 = lat1 * 111_320d;
        var x2 = lon2 * 111_320d * Math.Cos(latitude * Math.PI / 180d);
        var y2 = lat2 * 111_320d;
        var x = longitude * 111_320d * Math.Cos(latitude * Math.PI / 180d);
        var y = latitude * 111_320d;

        var dx = x2 - x1;
        var dy = y2 - y1;
        if (dx == 0 && dy == 0)
        {
            return Math.Sqrt((x - x1) * (x - x1) + (y - y1) * (y - y1));
        }

        var projection = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
        projection = Math.Clamp(projection, 0d, 1d);

        var closestX = x1 + projection * dx;
        var closestY = y1 + projection * dy;
        return Math.Sqrt((x - closestX) * (x - closestX) + (y - closestY) * (y - closestY));
    }

    private static bool IsPointInRing(double latitude, double longitude, List<(double Lon, double Lat)> points)
    {
        var inside = false;
        var j = points.Count - 1;
        for (var i = 0; i < points.Count; i++)
        {
            var xi = points[i].Lon; var yi = points[i].Lat;
            var xj = points[j].Lon; var yj = points[j].Lat;

            var intersects = ((yi > latitude) != (yj > latitude))
                && (longitude < (xj - xi) * (latitude - yi) / (yj - yi + double.Epsilon) + xi);

            if (intersects)
            {
                inside = !inside;
            }

            j = i;
        }

        return inside;
    }
}
