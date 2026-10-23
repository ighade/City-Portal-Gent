using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using ParkingGent.Api.Data;
using ParkingGent.Api.Services;
using Xunit;

namespace ParkingGent.Api.Tests.Infrastructure;

/// <summary>
/// De hele API, in-process, op een eigen lege Postgres-database. Alles dat buiten het huis ligt
/// (data.stad.gent, OpenRouteService, Social Fetch, De Lijn) is vervangen door een nep-handler,
/// en de achtergrondtaken staan uit zodat er niets op de achtergrond aan de data zit.
/// Afgeleide klassen passen config, nep-data en startgegevens aan.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private static int ipCounter;
    private string connectionString = "";

    public FakeGent Gent { get; } = new();
    public StubHandler Ors { get; } = new();
    public StubHandler Social { get; } = new();
    public StubHandler Transit { get; } = new();

    protected virtual string EnvironmentName => "Testing";

    /// <summary>Afgeleide klassen vullen hier configuratie aan of overschrijven ze.</summary>
    protected virtual void Configure(Dictionary<string, string?> settings) { }

    protected virtual void ConfigureFakes() { }

    protected virtual Task SeedAsync(AppDbContext db) => Task.CompletedTask;

    public async Task InitializeAsync()
    {
        connectionString = await TestDatabase.NewConnectionStringAsync();
        ConfigureFakes();
        _ = Services;
        await WithDbAsync(SeedAsync);
    }

    Task IAsyncLifetime.DisposeAsync() => Task.CompletedTask;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(EnvironmentName);

        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = connectionString,
            ["Gent:BaseUrl"] = "http://gent.test/api/explore/v2.1",
            ["Gent:BackfillOnStartup"] = "false",
            ["Auth:ProxyKey"] = "",
            ["Auth:AdminEmails"] = "",
            ["Auth:AdminPassword"] = "",
            ["RoutePlanner:BaseUrl"] = "http://ors.test/openrouteservice",
            ["RoutePlanner:ApiKey"] = "",
            ["Socialfetch:BaseUrl"] = "http://social.test",
            ["Socialfetch:ApiKey"] = "test-key",
            ["Transit:TripUpdatesUrl"] = "http://transit.test/trip-update",
            ["Transit:AlertsUrl"] = "http://transit.test/alert",
        };
        Configure(settings);
        foreach (var (key, value) in settings) builder.UseSetting(key, value);

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IHostedService>();
            services.AddHttpClient<GentOpenData>().ConfigurePrimaryHttpMessageHandler(() => new ForwardingHandler(Gent));
            services.AddHttpClient<RoutePlanner>().ConfigurePrimaryHttpMessageHandler(() => new ForwardingHandler(Ors));
            services.AddHttpClient<EventDescriptions>().ConfigurePrimaryHttpMessageHandler(() => new ForwardingHandler(Social));
            services.AddHttpClient<TransitService>().ConfigurePrimaryHttpMessageHandler(() => new ForwardingHandler(Transit));
        });
    }

    /// <summary>Een client met een eigen IP, zodat de snelheidsbegrenzer tests niet door elkaar haalt.</summary>
    public HttpClient NewClient(bool handleCookies = false)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = handleCookies, AllowAutoRedirect = false });
        var n = Interlocked.Increment(ref ipCounter);
        client.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.{(n >> 16) & 255}.{(n >> 8) & 255}.{n & 255}");
        return client;
    }

    public async Task WithDbAsync(Func<AppDbContext, Task> action)
    {
        using var scope = Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    public async Task<T> WithDbAsync<T>(Func<AppDbContext, Task<T>> action)
    {
        using var scope = Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }
}

public static class HttpExtensions
{
    public static async Task<JsonElement> JsonAsync(this HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    public static HttpRequestMessage With(this HttpRequestMessage request, string header, string value)
    {
        request.Headers.TryAddWithoutValidation(header, value);
        return request;
    }
}
