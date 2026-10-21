using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace ParkingGent.Api.Services;

/// <summary>Haalt de beschrijving van één evenement op bij Social Fetch (1 credit per oproep).</summary>
public sealed class EventDescriptions(HttpClient http, IOptions<SocialfetchOptions> options, ILogger<EventDescriptions> log)
{
    /// <summary>De tekst, een lege string als het evenement er geen heeft, of null als de oproep mislukte.</summary>
    public async Task<string?> FetchAsync(string eventId, CancellationToken ct)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ApiKey)) return null;

        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get, $"{o.BaseUrl.TrimEnd('/')}/v1/facebook/events/details?eventId={Uri.EscapeDataString(eventId)}");
            request.Headers.Add("x-api-key", o.ApiKey);
            using var response = await http.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadFromJsonAsync<Envelope>(ct);
            return body?.Data?.Event?.Description?.Trim() ?? "";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            log.LogWarning(ex, "Beschrijving van evenement {EventId} ophalen mislukt", eventId);
            return null;
        }
    }

    private sealed record Envelope([property: JsonPropertyName("data")] Payload? Data);
    private sealed record Payload([property: JsonPropertyName("event")] Detail? Event);
    private sealed record Detail([property: JsonPropertyName("description")] string? Description);
}
