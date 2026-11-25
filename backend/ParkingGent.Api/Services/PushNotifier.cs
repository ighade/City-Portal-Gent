using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;

namespace ParkingGent.Api.Services;

/// <summary>
/// Verstuurt meldingen naar de app via de pushdienst van Expo. Een melding is een extraatje: het versturen
/// gebeurt los van de aanvraag en een fout daarbij mag het versturen van een bericht nooit in de weg zitten.
/// </summary>
public sealed class PushNotifier(HttpClient http, IServiceScopeFactory scopes, ILogger<PushNotifier> log)
{
    private const string Endpoint = "https://exp.host/--/api/v2/push/send";
    private const int BatchSize = 100;

    public static bool IsValidToken(string? token) =>
        token is { Length: > 0 and <= 200 }
        && (token.StartsWith("ExponentPushToken[", StringComparison.Ordinal) || token.StartsWith("ExpoPushToken[", StringComparison.Ordinal))
        && token.EndsWith(']');

    /// <summary>Zet de melding klaar en keert meteen terug.</summary>
    public void Send(IReadOnlyCollection<string> tokens, string title, string body, object data)
    {
        if (tokens.Count == 0) return;
        var list = tokens.ToList();
        _ = Task.Run(() => SendAsync(list, title, body, data));
    }

    private async Task SendAsync(List<string> tokens, string title, string body, object data)
    {
        try
        {
            var dead = new List<string>();
            foreach (var batch in tokens.Chunk(BatchSize))
            {
                var messages = batch.Select(t => new
                {
                    to = t,
                    title,
                    body,
                    data,
                    sound = "default",
                    channelId = "chat",
                    priority = "high",
                });
                using var res = await http.PostAsJsonAsync(Endpoint, messages);
                if (!res.IsSuccessStatusCode)
                {
                    log.LogWarning("Expo-pushdienst gaf {Status}.", (int)res.StatusCode);
                    continue;
                }

                // De antwoorden komen in dezelfde volgorde als de berichten.
                using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync());
                if (!doc.RootElement.TryGetProperty("data", out var results) || results.ValueKind != JsonValueKind.Array) continue;
                var i = 0;
                foreach (var r in results.EnumerateArray())
                {
                    if (i < batch.Length
                        && r.TryGetProperty("details", out var d)
                        && d.TryGetProperty("error", out var e)
                        && e.GetString() == "DeviceNotRegistered")
                        dead.Add(batch[i]);
                    i++;
                }
            }

            if (dead.Count > 0)
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.PushTokens.Where(t => dead.Contains(t.Token)).ExecuteDeleteAsync();
            }
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "De melding kon niet verstuurd worden.");
        }
    }
}
