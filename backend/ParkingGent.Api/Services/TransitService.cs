using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

public sealed record TransitRouteRequest(double StartLat, double StartLon, double EndLat, double EndLon);

public sealed class TransitUnavailableException(string message, Exception innerException) : Exception(message, innerException);

public sealed record TransitStopDto(
    string Id,
    string Name,
    double Lat,
    double Lon,
    string[] Lines);

public sealed record TransitStatusDto(
    bool StaticLoaded,
    DateTime? StaticUpdatedAtUtc,
    DateTime? RealtimeUpdatedAtUtc,
    int StopCount,
    int ConnectionCount,
    string Source);

public sealed record TransitStopRealtimeDto(
    string StopId,
    string StopName,
    DateTime UpdatedAt,
    TransitDepartureDto[] Departures);

public sealed record TransitDepartureDto(
    string Line,
    string Mode,
    string Destination,
    DateTime ScheduledAt,
    DateTime ExpectedAt,
    int DelayMinutes);

public sealed record TransitRouteResult(
    double DistanceKm,
    double DurationMinutes,
    DateTime DepartureAt,
    DateTime ArrivalAt,
    string Summary,
    TransitLegDto[] Legs);

public sealed record TransitLegDto(
    string Mode,
    string? Line,
    string From,
    string To,
    double FromLat,
    double FromLon,
    double ToLat,
    double ToLon,
    DateTime DepartureAt,
    DateTime ArrivalAt,
    double DistanceKm,
    int DelayMinutes,
    double[][] Coordinates);

public sealed class TransitService(
    HttpClient http,
    AppDbContext db,
    IOptions<TransitOptions> options,
    ILogger<TransitService> log,
    RoutePlanner routePlanner)
{
    private readonly SemaphoreSlim loadGate = new(1, 1);
    private readonly SemaphoreSlim realtimeGate = new(1, 1);
    private readonly Dictionary<string, TransitStop> stops = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<TransitConnection>> connections = new(StringComparer.Ordinal);
    private readonly Dictionary<string, double[][]> shapes = new(StringComparer.Ordinal);
    private readonly Dictionary<(string TripId, string StopId), int> realtimeDelays = new();
    private DateTime staticUpdatedAtUtc;
    private DateTime realtimeUpdatedAtUtc;
    private bool staticLoaded;
    private int connectionCount;

    public async Task<IReadOnlyList<TransitStopDto>> GetStopsAsync(CancellationToken ct)
    {
        await EnsureStaticAsync(ct);
        return stops.Values
            .OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .Select(ToDto)
            .ToArray();
    }

    public async Task<TransitStatusDto> GetStatusAsync(CancellationToken ct)
    {
        await EnsureStaticAsync(ct);
        await RefreshRealtimeAsync(ct);
        return new TransitStatusDto(
            StaticLoaded: staticLoaded,
            StaticUpdatedAtUtc: staticUpdatedAtUtc == default ? null : staticUpdatedAtUtc,
            RealtimeUpdatedAtUtc: realtimeUpdatedAtUtc == default ? null : realtimeUpdatedAtUtc,
            StopCount: stops.Count,
            ConnectionCount: connectionCount,
            Source: options.Value.StaticFilePath);
    }

    public async Task<TransitStopRealtimeDto?> GetStopRealtimeAsync(string stopId, CancellationToken ct)
    {
        await EnsureStaticAsync(ct);
        await RefreshRealtimeAsync(ct);
        if (!stops.TryGetValue(stopId, out var stop)) return null;

        var now = DateTime.Now;
        var departures = connections.Values
            .SelectMany(x => x)
            .Where(connection => connection.FromId == stopId)
            .Select(connection =>
            {
                var delay = realtimeDelays.GetValueOrDefault((connection.TripId, connection.FromId));
                var scheduled = AtDate(connection.Departure);
                return new TransitDepartureDto(
                    Line: connection.Line,
                    Mode: connection.Mode,
                    Destination: stops.GetValueOrDefault(connection.ToId)?.Name ?? connection.ToId,
                    ScheduledAt: scheduled,
                    ExpectedAt: scheduled.AddMinutes(delay),
                    DelayMinutes: delay);
            })
            .Where(departure => departure.ExpectedAt >= now.AddMinutes(-1) && departure.ExpectedAt <= now.AddHours(2))
            .OrderBy(departure => departure.ExpectedAt)
            .Take(30)
            .ToArray();

        return new TransitStopRealtimeDto(stop.Id, stop.Name, DateTime.UtcNow, departures);
    }

    public async Task<TransitRouteResult?> PlanAsync(
        double startLat,
        double startLon,
        double endLat,
        double endLon,
        CancellationToken ct)
    {
        await EnsureStaticAsync(ct);
        await RefreshRealtimeAsync(ct);

        var originCandidates = Nearest(startLat, startLon, 6, 2_500);
        var destinationCandidates = Nearest(endLat, endLon, 50, 1_000);
        if (originCandidates.Count == 0 || destinationCandidates.Count == 0) return null;

        var now = DateTime.Now;
        var best = new Dictionary<TransitSearchState, (int Transfers, DateTime Arrival)>();
        var previous = new Dictionary<TransitSearchState, (TransitSearchState State, TransitConnection Connection)>();
        var origins = new Dictionary<TransitSearchState, (double DistanceKm, DateTime At)>();
        var queue = new PriorityQueue<TransitSearchState, (int Transfers, DateTime Arrival)>();

        foreach (var candidate in originCandidates)
        {
            var walkingSeconds = candidate.DistanceMeters / 1.35;
            var at = now.AddSeconds(walkingSeconds);
            var state = new TransitSearchState(candidate.Stop.Id, null);
            var label = (Transfers: 0, Arrival: at);
            if (best.TryGetValue(state, out var old) && old.CompareTo(label) <= 0) continue;
            best[state] = label;
            origins[state] = (candidate.DistanceMeters / 1000d, at);
            queue.Enqueue(state, label);
        }

        var destinationIds = destinationCandidates.Select(c => c.Stop.Id).ToHashSet(StringComparer.Ordinal);
        TransitSearchState? destinationState = null;
        while (queue.TryDequeue(out var state, out var label))
        {
            if (!best.TryGetValue(state, out var known) || known != label) continue;
            if (destinationIds.Contains(state.StopId))
            {
                destinationState = state;
                break;
            }

            if (!connections.TryGetValue(state.StopId, out var outgoing)) continue;
            foreach (var connection in outgoing)
            {
                var delayFrom = realtimeDelays.GetValueOrDefault((connection.TripId, connection.FromId));
                var delayTo = realtimeDelays.GetValueOrDefault((connection.TripId, connection.ToId));
                var edgeDeparture = AtDate(connection.Departure).AddMinutes(delayFrom);
                var edgeArrival = AtDate(connection.Arrival).AddMinutes(delayTo);
                if (edgeDeparture < label.Arrival || edgeArrival <= label.Arrival) continue;

                var nextState = new TransitSearchState(connection.ToId, connection.Line);
                var nextLabel = (
                    Transfers: label.Transfers
                        + (state.Line is not null && !string.Equals(state.Line, connection.Line, StringComparison.OrdinalIgnoreCase) ? 1 : 0),
                    Arrival: edgeArrival);
                if (best.TryGetValue(nextState, out var existing) && existing.CompareTo(nextLabel) <= 0) continue;
                var effective = connection with { EffectiveDeparture = edgeDeparture, EffectiveArrival = edgeArrival, DelayMinutes = delayTo };
                best[nextState] = nextLabel;
                previous[nextState] = (state, effective);
                queue.Enqueue(nextState, nextLabel);
            }
        }

        if (destinationState is null || !best.TryGetValue(destinationState, out var destinationLabel)) return null;
        var finalStop = stops[destinationState.StopId];
        var destinationCandidate = destinationCandidates.First(c => c.Stop.Id == destinationState.StopId);

        var path = new List<TransitConnection>();
        var cursor = destinationState;
        while (previous.TryGetValue(cursor, out var step))
        {
            path.Add(step.Connection);
            cursor = step.State;
        }
        path.Reverse();
        if (path.Count == 0 || !origins.TryGetValue(cursor, out var originInfo)) return null;

        var originStop = stops[cursor.StopId];
        var legs = new List<TransitLegDto>();
        if (originInfo.DistanceKm > 0.02)
        {
            legs.Add(await WalkLegAsync("Start", startLat, startLon, originStop.Name, originStop.Lat, originStop.Lon, now, originInfo.At, originInfo.DistanceKm, ct));
        }

        foreach (var group in path.GroupByConsecutive(e => e.TripId))
        {
            var first = group[0];
            var last = group[^1];
            var from = stops[first.FromId];
            var to = stops[last.ToId];
            var stopCoordinates = group
                .Select(connection => stops[connection.FromId])
                .Append(to)
                .Select(stop => new[] { stop.Lat, stop.Lon })
                .ToArray();
            var viaStops = group
                .Take(group.Count - 1)
                .Select(connection => stops[connection.ToId])
                .Select(stop => (stop.Lat, stop.Lon))
                .ToArray();
            var shapeCoordinates = shapes.TryGetValue(first.ShapeId, out var shape)
                ? ShapeBetweenStops(shape, from, to)
                : null;
            var roadRoute = shapeCoordinates is null
                ? await routePlanner.PlanAsync(from.Lat, from.Lon, to.Lat, to.Lon, "car", false, ct, viaStops)
                : null;
            var coordinates = shapeCoordinates ?? roadRoute?.Coordinates
                .Where(point => point.Length >= 2)
                .Select(point => new[] { point[1], point[0] })
                .ToArray()
                ?? stopCoordinates;
            var distance = roadRoute?.DistanceKm ?? coordinates
                .Zip(coordinates.Skip(1), (a, b) => DistanceKm(a[0], a[1], b[0], b[1]))
                .Sum();
            legs.Add(new TransitLegDto(
                Mode: first.Mode,
                Line: first.Line,
                From: from.Name,
                To: to.Name,
                FromLat: from.Lat,
                FromLon: from.Lon,
                ToLat: to.Lat,
                ToLon: to.Lon,
                DepartureAt: first.EffectiveDeparture,
                ArrivalAt: last.EffectiveArrival,
                DistanceKm: distance,
                DelayMinutes: group.Max(e => e.DelayMinutes),
                Coordinates: coordinates));
        }

        var lastTransitAt = path[^1].EffectiveArrival;
        var finalDistanceKm = destinationCandidate.DistanceMeters / 1000d;
        var finalArrival = destinationLabel.Arrival.AddSeconds(destinationCandidate.DistanceMeters / 1.35);
        if (finalDistanceKm > 0.02)
        {
            legs.Add(await WalkLegAsync(finalStop.Name, finalStop.Lat, finalStop.Lon, "Eindpunt", endLat, endLon, lastTransitAt, finalArrival, finalDistanceKm, ct));
        }

        var departure = legs.Count == 0 ? now : legs[0].DepartureAt;
        var distanceKm = legs.Sum(l => l.DistanceKm);
        return new TransitRouteResult(
            DistanceKm: distanceKm,
            DurationMinutes: Math.Max(0, (finalArrival - departure).TotalMinutes),
            DepartureAt: departure,
            ArrivalAt: finalArrival,
            Summary: $"{distanceKm:0.0} km · {Math.Round((finalArrival - departure).TotalMinutes):0} min",
            Legs: legs.ToArray());
    }

    private async Task EnsureStaticAsync(CancellationToken ct)
    {
        if (staticLoaded && DateTime.UtcNow - staticUpdatedAtUtc < TimeSpan.FromHours(options.Value.StaticRefreshHours)) return;
        await loadGate.WaitAsync(ct);
        try
        {
            if (staticLoaded && DateTime.UtcNow - staticUpdatedAtUtc < TimeSpan.FromHours(options.Value.StaticRefreshHours)) return;
            if (!staticLoaded && await LoadStaticFromDatabaseAsync(ct)
                && DateTime.UtcNow - staticUpdatedAtUtc < TimeSpan.FromHours(options.Value.StaticRefreshHours)) return;
            throw new TransitUnavailableException(
                "De OV-dienstregeling is nog niet geïmporteerd.",
                new InvalidOperationException("Run --import-transit once before starting the API."));
        }
        finally
        {
            loadGate.Release();
        }
    }

    public async Task ImportSeedAsync(CancellationToken ct)
    {
        var localPath = Path.IsPathRooted(options.Value.StaticFilePath)
            ? options.Value.StaticFilePath
            : Path.Combine(AppContext.BaseDirectory, options.Value.StaticFilePath);
        if (!Directory.Exists(localPath)) throw new DirectoryNotFoundException(localPath);
        log.LogInformation("GTFS seed wordt geladen uit {Path}.", localPath);
        Func<string, CancellationToken, IAsyncEnumerable<Dictionary<string, string>>> readRows =
            (name, token) => ReadRowsAsync(localPath, name, token);

        var newStops = new Dictionary<string, TransitStop>(StringComparer.Ordinal);
        await foreach (var row in readRows("stops.txt", ct))
        {
            if (!double.TryParse(row.GetValueOrDefault("stop_lat"), CultureInfo.InvariantCulture, out var lat)
                || !double.TryParse(row.GetValueOrDefault("stop_lon"), CultureInfo.InvariantCulture, out var lon)
                || !InsideGent(lat, lon)) continue;
            var id = row.GetValueOrDefault("stop_id");
            if (string.IsNullOrWhiteSpace(id)) continue;
            newStops[id] = new TransitStop(id, row.GetValueOrDefault("stop_name") ?? id, lat, lon);
        }

        var routes = new Dictionary<string, (string Name, string Mode)>(StringComparer.Ordinal);
        await foreach (var row in readRows("routes.txt", ct))
        {
            var id = row.GetValueOrDefault("route_id");
            if (string.IsNullOrWhiteSpace(id)) continue;
            routes[id] = (
                FirstNonEmpty(row.GetValueOrDefault("route_short_name"), row.GetValueOrDefault("route_long_name"), id),
                ModeForRouteType(row.GetValueOrDefault("route_type")));
        }

        var trips = new Dictionary<string, (string RouteId, string ServiceId, string ShapeId)>(StringComparer.Ordinal);
        await foreach (var row in readRows("trips.txt", ct))
        {
            var id = row.GetValueOrDefault("trip_id");
            var routeId = row.GetValueOrDefault("route_id");
            if (!string.IsNullOrWhiteSpace(id) && !string.IsNullOrWhiteSpace(routeId))
                trips[id] = (
                    routeId,
                    row.GetValueOrDefault("service_id") ?? string.Empty,
                    row.GetValueOrDefault("shape_id") ?? string.Empty);
        }

        var activeServices = await ActiveServicesAsync(readRows, ct);
        var grouped = new Dictionary<string, List<StopTime>>(StringComparer.Ordinal);
        await foreach (var row in readRows("stop_times.txt", ct))
        {
            var tripId = row.GetValueOrDefault("trip_id");
            var stopId = row.GetValueOrDefault("stop_id");
            if (string.IsNullOrWhiteSpace(tripId) || string.IsNullOrWhiteSpace(stopId) || !newStops.ContainsKey(stopId)) continue;
            if (!trips.TryGetValue(tripId, out var trip) || (activeServices.Count > 0 && !activeServices.Contains(trip.ServiceId))) continue;
            if (!TryTime(row.GetValueOrDefault("departure_time"), out var departure)
                || !TryTime(row.GetValueOrDefault("arrival_time"), out var arrival)) continue;
            var sequence = int.TryParse(row.GetValueOrDefault("stop_sequence"), out var parsedSequence) ? parsedSequence : 0;
            if (!grouped.TryGetValue(tripId, out var times)) grouped[tripId] = times = new List<StopTime>();
            times.Add(new StopTime(stopId, sequence, departure, arrival, trip.RouteId, trip.ServiceId, trip.ShapeId));
        }

        var shapeIds = grouped.Values.SelectMany(x => x).Select(x => x.ShapeId)
            .Where(x => !string.IsNullOrWhiteSpace(x)).ToHashSet(StringComparer.Ordinal);
        var importedShapes = new Dictionary<string, List<double[]>>(StringComparer.Ordinal);
        await foreach (var row in readRows("shapes.txt", ct))
        {
            var shapeId = row.GetValueOrDefault("shape_id");
            if (string.IsNullOrWhiteSpace(shapeId) || !shapeIds.Contains(shapeId)
                || !double.TryParse(row.GetValueOrDefault("shape_pt_lat"), CultureInfo.InvariantCulture, out var lat)
                || !double.TryParse(row.GetValueOrDefault("shape_pt_lon"), CultureInfo.InvariantCulture, out var lon)
                || !int.TryParse(row.GetValueOrDefault("shape_pt_sequence"), out var sequence)) continue;
            if (!importedShapes.TryGetValue(shapeId, out var points)) importedShapes[shapeId] = points = new List<double[]>();
            points.Add(new[] { lat, lon, (double)sequence });
        }
        var importedShapeArrays = importedShapes.ToDictionary(
            pair => pair.Key,
            pair => pair.Value.OrderBy(point => point[2]).Select(point => new[] { point[0], point[1] }).ToArray(),
            StringComparer.Ordinal);

        var newConnections = new Dictionary<string, List<TransitConnection>>(StringComparer.Ordinal);
        foreach (var (tripId, times) in grouped)
        {
            times.Sort((a, b) => a.Sequence.CompareTo(b.Sequence));
            for (var i = 0; i < times.Count - 1; i++)
            {
                var from = times[i];
                var to = times[i + 1];
                if (from.Departure >= to.Arrival) continue;
                var routeInfo = routes.GetValueOrDefault(from.RouteId, (Name: from.RouteId, Mode: "bus"));
                var connection = new TransitConnection(
                    TripId: tripId,
                    RouteId: from.RouteId,
                    ServiceId: from.ServiceId,
                    FromId: from.StopId,
                    ToId: to.StopId,
                    Line: routeInfo.Name,
                    Mode: routeInfo.Mode,
                    ShapeId: from.ShapeId,
                    Departure: from.Departure,
                    Arrival: to.Arrival,
                    EffectiveDeparture: default,
                    EffectiveArrival: default,
                    DelayMinutes: 0);
                if (!newConnections.TryGetValue(from.StopId, out var outgoing)) newConnections[from.StopId] = outgoing = new List<TransitConnection>();
                outgoing.Add(connection);
            }
        }

        foreach (var outgoing in newConnections.Values)
            outgoing.Sort((a, b) => a.Departure.CompareTo(b.Departure));

        stops.Clear();
        foreach (var (id, stop) in newStops)
        {
            var lines = newConnections.Values
                .SelectMany(x => x)
                .Where(c => c.FromId == id || c.ToId == id)
                .Select(c => c.Line)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            stops[id] = stop with { Lines = lines };
        }

        connections.Clear();
        shapes.Clear();
        foreach (var (shapeId, points) in importedShapeArrays) shapes[shapeId] = points;
        foreach (var (id, outgoing) in newConnections) connections[id] = outgoing;
        connectionCount = newConnections.Values.Sum(x => x.Count);
        staticUpdatedAtUtc = DateTime.UtcNow;
        staticLoaded = true;
        await PersistStaticAsync(newStops, routes, newConnections, importedShapeArrays, ct);
        log.LogInformation("GTFS geladen: {Stops} Gentse haltes en {Connections} verbindingen.", stops.Count, connectionCount);
    }

    private async Task<bool> LoadStaticFromDatabaseAsync(CancellationToken ct)
    {
        var storedStops = await db.TransitStops.AsNoTracking().ToListAsync(ct);
        if (storedStops.Count == 0) return false;

        var storedRoutes = await db.TransitRoutes.AsNoTracking().ToDictionaryAsync(x => x.Id, ct);
        var storedStopRoutes = await db.TransitStopRoutes.AsNoTracking().ToListAsync(ct);
        var storedConnections = await db.TransitConnections.AsNoTracking().ToListAsync(ct);
        var storedShapes = await db.TransitShapePoints.AsNoTracking().ToListAsync(ct);
        var routeIdsByStop = storedStopRoutes
            .GroupBy(link => link.StopId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Select(link => link.RouteId).ToArray(), StringComparer.Ordinal);
        stops.Clear();
        foreach (var stop in storedStops)
        {
            var lines = routeIdsByStop.GetValueOrDefault(stop.Id, [])
                .Select(routeId => storedRoutes.GetValueOrDefault(routeId)?.Name)
                .OfType<string>()
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            stops[stop.Id] = new TransitStop(stop.Id, stop.Name, stop.Latitude, stop.Longitude, lines);
        }

        shapes.Clear();
        foreach (var shape in storedShapes.GroupBy(x => x.ShapeId, StringComparer.Ordinal))
            shapes[shape.Key] = shape.OrderBy(x => x.Sequence).Select(x => new[] { x.Latitude, x.Longitude }).ToArray();

        connections.Clear();
        foreach (var connection in storedConnections)
        {
            var route = storedRoutes.GetValueOrDefault(connection.RouteId);
            if (route is null || !stops.ContainsKey(connection.FromStopId) || !stops.ContainsKey(connection.ToStopId)) continue;
            if (!connections.TryGetValue(connection.FromStopId, out var outgoing)) connections[connection.FromStopId] = outgoing = new List<TransitConnection>();
            outgoing.Add(new TransitConnection(
                connection.TripId,
                connection.RouteId,
                connection.ServiceId,
                connection.FromStopId,
                connection.ToStopId,
                route.Name,
                route.Mode,
                connection.ShapeId,
                TimeSpan.FromSeconds(connection.DepartureSeconds),
                TimeSpan.FromSeconds(connection.ArrivalSeconds),
                default,
                default,
                0));
        }
        foreach (var outgoing in connections.Values) outgoing.Sort((a, b) => a.Departure.CompareTo(b.Departure));
        connectionCount = connections.Values.Sum(x => x.Count);
        staticUpdatedAtUtc = storedStops.Max(x => x.UpdatedAtUtc);
        staticLoaded = true;
        log.LogInformation("GTFS uit database geladen: {Stops} haltes en {Connections} verbindingen.", stops.Count, connectionCount);
        return true;
    }

    private async Task PersistStaticAsync(
        Dictionary<string, TransitStop> newStops,
        Dictionary<string, (string Name, string Mode)> routes,
        Dictionary<string, List<TransitConnection>> newConnections,
        Dictionary<string, double[][]> importedShapes,
        CancellationToken ct)
    {
        var updatedAtUtc = DateTime.UtcNow;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.TransitConnections.ExecuteDeleteAsync(ct);
        await db.TransitShapePoints.ExecuteDeleteAsync(ct);
        await db.TransitStopRoutes.ExecuteDeleteAsync(ct);
        await db.TransitRoutes.ExecuteDeleteAsync(ct);
        await db.TransitStops.ExecuteDeleteAsync(ct);

        db.TransitStops.AddRange(newStops.Values.Select(stop => new TransitStopEntity
        {
            Id = stop.Id,
            Name = stop.Name,
            Latitude = stop.Lat,
            Longitude = stop.Lon,
            UpdatedAtUtc = updatedAtUtc,
        }));
        db.TransitRoutes.AddRange(routes.Select(route => new TransitRouteEntity
        {
            Id = route.Key,
            Name = route.Value.Name,
            Mode = route.Value.Mode,
            UpdatedAtUtc = updatedAtUtc,
        }));

        var links = new HashSet<(string StopId, string RouteId)>();
        var storedConnections = new List<TransitConnectionEntity>();
        foreach (var connection in newConnections.Values.SelectMany(x => x))
        {
            links.Add((connection.FromId, connection.RouteId));
            links.Add((connection.ToId, connection.RouteId));
            storedConnections.Add(new TransitConnectionEntity
            {
                TripId = connection.TripId,
                RouteId = connection.RouteId,
                FromStopId = connection.FromId,
                ToStopId = connection.ToId,
                DepartureSeconds = (int)connection.Departure.TotalSeconds,
                ArrivalSeconds = (int)connection.Arrival.TotalSeconds,
                ServiceId = connection.ServiceId,
                ShapeId = connection.ShapeId,
                UpdatedAtUtc = updatedAtUtc,
            });
        }
        db.TransitShapePoints.AddRange(importedShapes.SelectMany(shape => shape.Value.Select((point, index) => new TransitShapePointEntity
        {
            ShapeId = shape.Key,
            Sequence = index,
            Latitude = point[0],
            Longitude = point[1],
        })));
        db.TransitStopRoutes.AddRange(links.Select(link => new TransitStopRouteEntity { StopId = link.StopId, RouteId = link.RouteId }));
        db.TransitConnections.AddRange(storedConnections);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
    }

    private async Task RefreshRealtimeAsync(CancellationToken ct)
    {
        if (realtimeUpdatedAtUtc != default && DateTime.UtcNow - realtimeUpdatedAtUtc < TimeSpan.FromSeconds(options.Value.RealtimeRefreshSeconds)) return;
        await realtimeGate.WaitAsync(ct);
        try
        {
            if (realtimeUpdatedAtUtc != default && DateTime.UtcNow - realtimeUpdatedAtUtc < TimeSpan.FromSeconds(options.Value.RealtimeRefreshSeconds)) return;
            try
            {
                await using var stream = await http.GetStreamAsync(options.Value.TripUpdatesUrl, ct);
                using var buffer = new MemoryStream();
                await stream.CopyToAsync(buffer, ct);
                var feed = GtfsRealtimeParser.Parse(buffer.ToArray());
                var delays = new Dictionary<(string TripId, string StopId), int>();
                foreach (var entity in feed.Entities ?? [])
                {
                    var tripId = entity.TripUpdate?.TripId;
                    if (string.IsNullOrWhiteSpace(tripId)) continue;
                    foreach (var update in entity.TripUpdate?.StopTimeUpdates ?? [])
                    {
                        var stopId = update.StopId;
                        var delay = update.ArrivalDelay ?? update.DepartureDelay;
                        if (!string.IsNullOrWhiteSpace(stopId) && delay is not null) delays[(tripId, stopId)] = delay.Value / 60;
                    }
                }
                realtimeDelays.Clear();
                foreach (var (key, delay) in delays) realtimeDelays[key] = delay;
                realtimeUpdatedAtUtc = DateTime.UtcNow;
                log.LogInformation("GTFS realtime geladen: {Updates} halte-updates.", realtimeDelays.Count);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "GTFS realtime kon niet opgehaald worden; de dienstregeling blijft bruikbaar.");
                realtimeUpdatedAtUtc = DateTime.UtcNow;
            }
        }
        finally
        {
            realtimeGate.Release();
        }
    }

    private async Task<HashSet<string>> ActiveServicesAsync(
        Func<string, CancellationToken, IAsyncEnumerable<Dictionary<string, string>>> readRows,
        CancellationToken ct)
    {
        var active = new HashSet<string>(StringComparer.Ordinal);
        var today = DateTime.Today;
        var weekday = today.DayOfWeek switch
        {
            DayOfWeek.Monday => "monday",
            DayOfWeek.Tuesday => "tuesday",
            DayOfWeek.Wednesday => "wednesday",
            DayOfWeek.Thursday => "thursday",
            DayOfWeek.Friday => "friday",
            DayOfWeek.Saturday => "saturday",
            _ => "sunday",
        };
        await foreach (var row in readRows("calendar.txt", ct))
        {
            if (!DateOnly.TryParseExact(row.GetValueOrDefault("start_date"), "yyyyMMdd", out var start)
                || !DateOnly.TryParseExact(row.GetValueOrDefault("end_date"), "yyyyMMdd", out var end)) continue;
            if (DateOnly.FromDateTime(today) >= start && DateOnly.FromDateTime(today) <= end && row.GetValueOrDefault(weekday) == "1")
                active.Add(row.GetValueOrDefault("service_id") ?? string.Empty);
        }
        await foreach (var row in readRows("calendar_dates.txt", ct))
        {
            if (row.GetValueOrDefault("date") != today.ToString("yyyyMMdd") || string.IsNullOrWhiteSpace(row.GetValueOrDefault("service_id"))) continue;
            var id = row["service_id"];
            if (row.GetValueOrDefault("exception_type") == "1") active.Add(id);
            if (row.GetValueOrDefault("exception_type") == "2") active.Remove(id);
        }
        return active;
    }

    private static async IAsyncEnumerable<Dictionary<string, string>> ReadRowsAsync(
        string directory,
        string name,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var path = Path.Combine(directory, name);
        if (!File.Exists(path)) yield break;
        await using var stream = File.OpenRead(path);
        await foreach (var row in ReadRowsAsync(stream, ct)) yield return row;
    }

    private static async IAsyncEnumerable<Dictionary<string, string>> ReadRowsAsync(
        Stream stream,
        [EnumeratorCancellation] CancellationToken ct)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var header = ParseCsv(await reader.ReadLineAsync(ct) ?? string.Empty);
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var values = ParseCsv(line);
            var row = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < header.Count && i < values.Count; i++) row[header[i]] = values[i];
            yield return row;
        }
    }

    private static List<string> ParseCsv(string line)
    {
        var values = new List<string>();
        var value = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (ch == '"')
            {
                if (quoted && i + 1 < line.Length && line[i + 1] == '"') { value.Append('"'); i++; }
                else quoted = !quoted;
            }
            else if (ch == ',' && !quoted) { values.Add(value.ToString()); value.Clear(); }
            else value.Append(ch);
        }
        values.Add(value.ToString());
        return values;
    }

    private List<(TransitStop Stop, double DistanceMeters)> Nearest(double lat, double lon, int take, double maxMeters)
        => stops.Values
            .Select(stop => (Stop: stop, DistanceMeters: DistanceMeters(lat, lon, stop.Lat, stop.Lon)))
            .Where(x => x.DistanceMeters <= maxMeters)
            .OrderBy(x => x.DistanceMeters)
            .Take(take)
            .ToList();

    private async Task<TransitLegDto> WalkLegAsync(
        string from,
        double fromLat,
        double fromLon,
        string to,
        double toLat,
        double toLon,
        DateTime departure,
        DateTime arrival,
        double distanceKm,
        CancellationToken ct)
    {
        var route = await routePlanner.PlanAsync(fromLat, fromLon, toLat, toLon, "foot-walking", false, ct);
        var coordinates = route?.Coordinates
            .Where(point => point.Length >= 2)
            .Select(point => new[] { point[1], point[0] })
            .ToArray()
            ?? [new[] { fromLat, fromLon }, new[] { toLat, toLon }];
        return new TransitLegDto(
            "walk", null, from, to, fromLat, fromLon, toLat, toLon, departure, arrival,
            route?.DistanceKm ?? distanceKm, 0, coordinates);
    }

    private static TransitStopDto ToDto(TransitStop stop) => new(stop.Id, stop.Name, stop.Lat, stop.Lon, stop.Lines);
    private bool InsideGent(double lat, double lon) => lat >= options.Value.GentMinLatitude && lat <= options.Value.GentMaxLatitude && lon >= options.Value.GentMinLongitude && lon <= options.Value.GentMaxLongitude;
    private static string FirstNonEmpty(params string?[] values) => values.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x)) ?? string.Empty;
    private static string ModeForRouteType(string? routeType) => routeType switch
    {
        "0" => "tram",
        "1" => "tram",
        _ => "bus",
    };
    private static bool TryTime(string? text, out TimeSpan value) => TimeSpan.TryParse(text, CultureInfo.InvariantCulture, out value);
    private static DateTime AtDate(TimeSpan value) => DateTime.Today.Add(value);
    private static double DistanceKm(double lat1, double lon1, double lat2, double lon2) => DistanceMeters(lat1, lon1, lat2, lon2) / 1000d;
    private static double[][]? ShapeBetweenStops(double[][] shape, TransitStop from, TransitStop to)
    {
        if (shape.Length < 2) return null;
        var fromIndex = NearestShapePoint(shape, from.Lat, from.Lon);
        var toIndex = NearestShapePoint(shape, to.Lat, to.Lon);
        if (fromIndex == toIndex) return null;
        if (fromIndex > toIndex) (fromIndex, toIndex) = (toIndex, fromIndex);
        return shape[fromIndex..(toIndex + 1)];
    }

    private static int NearestShapePoint(double[][] shape, double lat, double lon)
        => Enumerable.Range(0, shape.Length)
            .MinBy(index => DistanceMeters(lat, lon, shape[index][0], shape[index][1]));
    private static double DistanceMeters(double lat1, double lon1, double lat2, double lon2)
    {
        const double earth = 6_371_000;
        var a1 = lat1 * Math.PI / 180;
        var a2 = lat2 * Math.PI / 180;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(a1) * Math.Cos(a2) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return earth * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private sealed record TransitStop(string Id, string Name, double Lat, double Lon, string[] Lines = null!);
    private sealed record TransitSearchState(string StopId, string? Line);
    private sealed record StopTime(string StopId, int Sequence, TimeSpan Departure, TimeSpan Arrival, string RouteId, string ServiceId, string ShapeId);
    private sealed record TransitConnection(
        string TripId, string RouteId, string ServiceId, string FromId, string ToId, string Line, string Mode, string ShapeId,
        TimeSpan Departure, TimeSpan Arrival, DateTime EffectiveDeparture, DateTime EffectiveArrival, int DelayMinutes);
}

internal static class TransitEnumerableExtensions
{
    public static List<List<T>> GroupByConsecutive<T, TKey>(this IEnumerable<T> source, Func<T, TKey> keySelector)
    {
        var result = new List<List<T>>();
        List<T>? group = null;
        TKey? previous = default;
        foreach (var item in source)
        {
            var key = keySelector(item);
            if (group is null || !EqualityComparer<TKey>.Default.Equals(previous, key))
            {
                group = new List<T>();
                result.Add(group);
            }
            group.Add(item);
            previous = key;
        }
        return result;
    }
}

internal static class GtfsRealtimeParser
{
    public static GtfsFeed Parse(byte[] bytes)
    {
        var reader = new ProtoReader(bytes);
        var feed = new GtfsFeed();
        while (reader.TryRead(out var field, out var wire))
        {
            if (field == 2 && wire == 2) feed.Entities.Add(ParseEntity(reader.ReadBytes()));
            else reader.Skip(wire);
        }
        return feed;
    }

    private static GtfsEntity ParseEntity(byte[] bytes)
    {
        var reader = new ProtoReader(bytes);
        var entity = new GtfsEntity();
        while (reader.TryRead(out var field, out var wire))
        {
            if (field == 3 && wire == 2) entity.TripUpdate = ParseTripUpdate(reader.ReadBytes());
            else reader.Skip(wire);
        }
        return entity;
    }

    private static GtfsTripUpdate ParseTripUpdate(byte[] bytes)
    {
        var reader = new ProtoReader(bytes);
        var update = new GtfsTripUpdate();
        while (reader.TryRead(out var field, out var wire))
        {
            if (field == 1 && wire == 2) update.TripId = ParseTrip(reader.ReadBytes());
            else if (field == 2 && wire == 2) update.StopTimeUpdates.Add(ParseStopTimeUpdate(reader.ReadBytes()));
            else reader.Skip(wire);
        }
        return update;
    }

    private static string? ParseTrip(byte[] bytes)
    {
        var reader = new ProtoReader(bytes);
        while (reader.TryRead(out var field, out var wire))
        {
            if (field == 1 && wire == 2) return reader.ReadString();
            reader.Skip(wire);
        }
        return null;
    }

    private static GtfsStopTimeUpdate ParseStopTimeUpdate(byte[] bytes)
    {
        var reader = new ProtoReader(bytes);
        var update = new GtfsStopTimeUpdate();
        while (reader.TryRead(out var field, out var wire))
        {
            if (field == 2 && wire == 2) update.ArrivalDelay = ParseEvent(reader.ReadBytes());
            else if (field == 3 && wire == 2) update.DepartureDelay = ParseEvent(reader.ReadBytes());
            else if (field == 4 && wire == 2) update.StopId = reader.ReadString();
            else reader.Skip(wire);
        }
        return update;
    }

    private static int? ParseEvent(byte[] bytes)
    {
        var reader = new ProtoReader(bytes);
        while (reader.TryRead(out var field, out var wire))
        {
            if (field == 2 && wire == 0) return (int)reader.ReadVarint();
            reader.Skip(wire);
        }
        return null;
    }
}

internal sealed class GtfsFeed
{
    public List<GtfsEntity> Entities { get; } = new();
}

internal sealed class GtfsEntity
{
    public GtfsTripUpdate? TripUpdate { get; set; }
}

internal sealed class GtfsTripUpdate
{
    public string? TripId { get; set; }
    public List<GtfsStopTimeUpdate> StopTimeUpdates { get; } = new();
}

internal sealed class GtfsStopTimeUpdate
{
    public string? StopId { get; set; }
    public int? ArrivalDelay { get; set; }
    public int? DepartureDelay { get; set; }
}

internal sealed class ProtoReader(byte[] bytes)
{
    private int position;

    public bool TryRead(out int field, out int wire)
    {
        if (position >= bytes.Length) { field = 0; wire = 0; return false; }
        var key = (int)ReadVarint();
        field = key >> 3;
        wire = key & 7;
        return true;
    }

    public ulong ReadVarint()
    {
        ulong result = 0;
        var shift = 0;
        while (position < bytes.Length)
        {
            var current = bytes[position++];
            result |= (ulong)(current & 0x7f) << shift;
            if ((current & 0x80) == 0) return result;
            shift += 7;
            if (shift > 63) throw new InvalidDataException("Ongeldige GTFS realtime protobuf.");
        }
        throw new EndOfStreamException();
    }

    public string ReadString() => Encoding.UTF8.GetString(ReadBytes());

    public byte[] ReadBytes()
    {
        var length = checked((int)ReadVarint());
        if (length < 0 || position + length > bytes.Length) throw new InvalidDataException("Ongeldige GTFS realtime protobuf.");
        var value = bytes.AsSpan(position, length).ToArray();
        position += length;
        return value;
    }

    public void Skip(int wire)
    {
        switch (wire)
        {
            case 0: _ = ReadVarint(); break;
            case 1: SkipBytes(8); break;
            case 2: SkipBytes(checked((int)ReadVarint())); break;
            case 5: SkipBytes(4); break;
            default: throw new InvalidDataException("Onbekend GTFS realtime protobuf-type.");
        }
    }

    private int SkipBytes(int count)
    {
        position = checked(position + count);
        if (position > bytes.Length) throw new EndOfStreamException();
        return position;
    }
}
