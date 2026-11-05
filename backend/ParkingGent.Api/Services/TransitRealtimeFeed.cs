using System.Text.Json;
using Microsoft.Extensions.Options;

namespace ParkingGent.Api.Services;

/// <summary>Vertragingen voor één rit: per halte, plus een tijdlijn om de vertraging door te trekken naar haltes zonder eigen update.</summary>
public sealed class TripRealtime
{
    public Dictionary<string, int> DelayByStopSeconds { get; } = new(StringComparer.Ordinal);
    public HashSet<string> SkippedStops { get; } = new(StringComparer.Ordinal);
    /// <summary>(geplande tijd als epoch, vertraging in seconden), oplopend op geplande tijd.</summary>
    public List<(long ScheduledEpoch, int DelaySeconds)> Timeline { get; } = new();
}

/// <summary>Een momentopname van de De Lijn-realtimefeed voor vandaag.</summary>
public sealed class TransitRealtimeSnapshot
{
    public static readonly TransitRealtimeSnapshot Empty = new();

    public Dictionary<string, TripRealtime> Trips { get; init; } = new(StringComparer.Ordinal);
    public HashSet<string> CanceledTrips { get; init; } = new(StringComparer.Ordinal);
    public DateTime UpdatedAtUtc { get; init; }
    public bool Available { get; init; }

    public bool IsCanceled(string tripId, string stopId)
        => CanceledTrips.Contains(tripId) || (Trips.TryGetValue(tripId, out var trip) && trip.SkippedStops.Contains(stopId));

    /// <summary>Vertraging in minuten op een halte; zonder eigen update geldt de laatst bekende vertraging eerder op de rit.</summary>
    public int DelayMinutes(string tripId, string stopId, long scheduledEpoch)
    {
        if (!Trips.TryGetValue(tripId, out var trip)) return 0;
        if (trip.DelayByStopSeconds.TryGetValue(stopId, out var exact)) return ToMinutes(exact);
        var inherited = 0;
        foreach (var (at, delay) in trip.Timeline)
        {
            if (at > scheduledEpoch) break;
            inherited = delay;
        }
        return ToMinutes(inherited);
    }

    internal static int ToMinutes(int seconds) => (int)Math.Round(seconds / 60.0, MidpointRounding.AwayFromZero);
}

/// <summary>
/// De officiële De Lijn GTFS-realtime (api.delijn.be). De sleutel gaat in de header
/// Ocp-Apim-Subscription-Key. Eén gedeelde kopie met cache, want de feed is groot (~2 MB).
/// </summary>
public sealed class TransitRealtimeFeed(IHttpClientFactory httpFactory, IOptions<TransitOptions> options, ILogger<TransitRealtimeFeed> log)
{
    public const string ClientName = "delijn-realtime";

    private readonly SemaphoreSlim gate = new(1, 1);
    private TransitRealtimeSnapshot snapshot = TransitRealtimeSnapshot.Empty;
    private DateTime lastAttemptUtc;

    public bool Enabled => !string.IsNullOrWhiteSpace(options.Value.SubscriptionKey);

    public async Task<TransitRealtimeSnapshot> GetAsync(CancellationToken ct)
    {
        if (!Enabled) return TransitRealtimeSnapshot.Empty;
        if (IsFresh()) return snapshot;

        await gate.WaitAsync(ct);
        try
        {
            if (IsFresh()) return snapshot;
            lastAttemptUtc = DateTime.UtcNow;
            try
            {
                var url = $"{options.Value.DeLijnRealtimeUrl}?json=true&delay=true&canceled=true";
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                request.Headers.Add("Ocp-Apim-Subscription-Key", options.Value.SubscriptionKey);
                using var response = await httpFactory.CreateClient(ClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
                response.EnsureSuccessStatusCode();
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                snapshot = await ParseAsync(stream, DateTime.Now, ct);
                log.LogInformation(
                    "De Lijn realtime geladen: {Trips} ritten met vertraging, {Canceled} geschrapt.",
                    snapshot.Trips.Count, snapshot.CanceledTrips.Count);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "De Lijn realtime kon niet opgehaald worden; de laatste gegevens blijven staan.");
            }
            return snapshot;
        }
        finally
        {
            gate.Release();
        }
    }

    private bool IsFresh()
        => lastAttemptUtc != default && DateTime.UtcNow - lastAttemptUtc < TimeSpan.FromSeconds(Math.Max(10, options.Value.RealtimeRefreshSeconds));

    /// <summary>Leest de JSON-feed; alleen ritten van <paramref name="now"/>s datum tellen mee, want rit-ID's herhalen zich elke dag.</summary>
    internal static async Task<TransitRealtimeSnapshot> ParseAsync(Stream json, DateTime now, CancellationToken ct)
    {
        using var doc = await JsonDocument.ParseAsync(json, cancellationToken: ct);
        var today = now.ToString("yyyyMMdd");
        var trips = new Dictionary<string, TripRealtime>(StringComparer.Ordinal);
        var canceled = new HashSet<string>(StringComparer.Ordinal);

        if (doc.RootElement.TryGetProperty("entity", out var entities) && entities.ValueKind == JsonValueKind.Array)
        {
            foreach (var entity in entities.EnumerateArray())
            {
                if (!entity.TryGetProperty("tripUpdate", out var update) || !update.TryGetProperty("trip", out var trip)) continue;
                var tripId = Text(trip, "tripId");
                if (string.IsNullOrEmpty(tripId) || Text(trip, "startDate") != today) continue;

                if (IsRelationship(trip, "scheduleRelationship", 3, "CANCELED"))
                {
                    canceled.Add(tripId);
                    continue;
                }

                if (!update.TryGetProperty("stopTimeUpdate", out var stopUpdates) || stopUpdates.ValueKind != JsonValueKind.Array) continue;
                var realtime = new TripRealtime();
                foreach (var stopUpdate in stopUpdates.EnumerateArray())
                {
                    var stopId = Text(stopUpdate, "stopId");
                    if (string.IsNullOrEmpty(stopId)) continue;
                    if (IsRelationship(stopUpdate, "scheduleRelationship", 1, "SKIPPED"))
                    {
                        realtime.SkippedStops.Add(stopId);
                        continue;
                    }

                    var (delay, time) = ReadTime(stopUpdate, "departure");
                    if (delay is null) (delay, time) = ReadTime(stopUpdate, "arrival");
                    if (delay is null) continue;
                    realtime.DelayByStopSeconds[stopId] = delay.Value;
                    if (time is not null) realtime.Timeline.Add((time.Value - delay.Value, delay.Value));
                }
                if (realtime.DelayByStopSeconds.Count == 0 && realtime.SkippedStops.Count == 0) continue;
                realtime.Timeline.Sort((a, b) => a.ScheduledEpoch.CompareTo(b.ScheduledEpoch));
                trips[tripId] = realtime;
            }
        }

        return new TransitRealtimeSnapshot { Trips = trips, CanceledTrips = canceled, UpdatedAtUtc = DateTime.UtcNow, Available = true };
    }

    private static (int? Delay, long? Time) ReadTime(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Object) return (null, null);
        int? delay = value.TryGetProperty("delay", out var d) && d.TryGetInt32(out var parsedDelay) ? parsedDelay : null;
        long? time = value.TryGetProperty("time", out var t) ? AsLong(t) : null;
        return (delay, time);
    }

    private static long? AsLong(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number) return value.TryGetInt64(out var number) ? number : null;
        return long.TryParse(value.GetString(), out var parsed) ? parsed : null;
    }

    private static bool IsRelationship(JsonElement element, string name, int number, string text)
    {
        if (!element.TryGetProperty(name, out var value)) return false;
        return value.ValueKind == JsonValueKind.Number
            ? value.TryGetInt32(out var n) && n == number
            : string.Equals(value.GetString(), text, StringComparison.OrdinalIgnoreCase);
    }

    private static string? Text(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
