namespace ParkingGent.Api.Services;

public sealed class TransitWarmupService(
    IServiceScopeFactory scopes,
    ILogger<TransitWarmupService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var transit = scope.ServiceProvider.GetRequiredService<TransitService>();
            var stops = await transit.GetStopsAsync(stoppingToken);
            log.LogInformation("OV-warmup klaar: {Stops} Gentse haltes beschikbaar.", stops.Count);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "OV-warmup kon de GTFS-feed niet laden; de volgende OV-aanvraag probeert opnieuw.");
        }
    }
}
