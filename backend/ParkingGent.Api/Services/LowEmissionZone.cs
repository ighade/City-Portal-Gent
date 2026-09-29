using System.Text.Json;

namespace ParkingGent.Api.Services;

/// <summary>
/// Houdt de lage-emissiezone bij de hand.
/// <para>
/// De zone is achtergrond bij de kaart, geen meting: ze verandert hooguit eens in de zoveel jaar.
/// Ze wordt daarom pas opgehaald als iemand ze vraagt, en daarna een dag lang hergebruikt.
/// </para>
/// <para>
/// <b>De laatst gelukte versie blijft staan.</b> Valt data.stad.gent weg, dan blijft de zone
/// gewoon getekend worden met wat we al hadden, in plaats van uit de kaart te verdwijnen — voor
/// een grens die jaren hetzelfde blijft is oude informatie beter dan geen.
/// </para>
/// </summary>
public sealed class LowEmissionZone(IServiceScopeFactory scopes, ILogger<LowEmissionZone> log)
{
    private static readonly TimeSpan MaxAge = TimeSpan.FromHours(24);

    // Eén tegelijk: honderd bezoekers na een herstart horen niet honderd oproepen te veroorzaken.
    private readonly SemaphoreSlim gate = new(1, 1);

    private List<JsonElement>? shapes;
    private DateTime fetchedUtc = DateTime.MinValue;

    /// <summary>De vlakken van de zone, of leeg als ze nooit opgehaald konden worden.</summary>
    public async Task<IReadOnlyList<JsonElement>> GetAsync(CancellationToken ct)
    {
        if (shapes is not null && DateTime.UtcNow - fetchedUtc < MaxAge) return shapes;

        await gate.WaitAsync(ct);
        try
        {
            // Terwijl we wachtten kan een ander verzoek het al gedaan hebben.
            if (shapes is not null && DateTime.UtcNow - fetchedUtc < MaxAge) return shapes;

            using var scope = scopes.CreateScope();
            var gent = scope.ServiceProvider.GetRequiredService<GentOpenData>();
            var fresh = await gent.GetLowEmissionZoneAsync(ct);

            if (fresh.Count == 0)
            {
                log.LogWarning("De lage-emissiezone kwam leeg terug; de vorige versie blijft staan.");
                return shapes ?? new List<JsonElement>();
            }

            shapes = fresh;
            fetchedUtc = DateTime.UtcNow;
            log.LogInformation("Lage-emissiezone opgehaald: {Aantal} vlakken.", fresh.Count);
            return shapes;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "De lage-emissiezone kon niet opgehaald worden; de vorige versie blijft staan.");
            return shapes ?? new List<JsonElement>();
        }
        finally
        {
            gate.Release();
        }
    }
}
