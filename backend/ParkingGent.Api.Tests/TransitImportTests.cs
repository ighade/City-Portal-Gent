using System.IO.Compression;
using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ParkingGent.Api.Services;

namespace ParkingGent.Api.Tests;

public sealed class TransitImportTests(ApiFactory factory) : IClassFixture<ApiFactory>, IDisposable
{
    private readonly string workDirectory = Path.Combine(Path.GetTempPath(), $"transit-test-{Guid.NewGuid():N}");

    [Fact]
    public async Task Downloads_extracts_and_imports_the_feed()
    {
        await RunAsync(Feed("Centrum"));

        Assert.True(File.Exists(Path.Combine(workDirectory, "current", "delijn-gtfs.zip")));
        Assert.True(File.Exists(Path.Combine(workDirectory, "current", "delijn-gtfs", "stops.txt")));
        var (stops, connections) = await factory.WithDbAsync(async db =>
            (await db.TransitStops.AsNoTracking().ToListAsync(), await db.TransitConnections.CountAsync()));
        Assert.Contains(stops, stop => stop.Name == "Centrum");
        Assert.Equal(1, connections);
    }

    [Fact]
    public async Task A_new_successful_import_replaces_the_previous_feed()
    {
        await RunAsync(Feed("Oude halte"));
        await RunAsync(Feed("Nieuwe halte"));

        var names = await factory.WithDbAsync(db => db.TransitStops.AsNoTracking().Select(s => s.Name).ToListAsync());
        Assert.Contains("Nieuwe halte", names);
        Assert.DoesNotContain("Oude halte", names);
        Assert.Contains("Nieuwe halte", await File.ReadAllTextAsync(Path.Combine(workDirectory, "current", "delijn-gtfs", "stops.txt")));
        Assert.Single(Directory.GetDirectories(workDirectory));
    }

    [Fact]
    public async Task Failed_download_or_invalid_feed_preserves_previous_import()
    {
        await RunAsync(Feed("Bestaande halte"));
        await Assert.ThrowsAsync<HttpRequestException>(() => RunAsync([], HttpStatusCode.ServiceUnavailable));
        await Assert.ThrowsAsync<InvalidDataException>(() => RunAsync(Archive(("stops.txt", "stop_id\n"))));

        var names = await factory.WithDbAsync(db => db.TransitStops.AsNoTracking().Select(s => s.Name).ToListAsync());
        Assert.Contains("Bestaande halte", names);
        Assert.Contains("Bestaande halte", await File.ReadAllTextAsync(Path.Combine(workDirectory, "current", "delijn-gtfs", "stops.txt")));
        Assert.Single(Directory.GetDirectories(workDirectory));
    }

    [Fact]
    public async Task Rejects_archive_entries_outside_the_feed_directory()
    {
        await Assert.ThrowsAsync<IOException>(() => RunAsync(Archive(("../outside.txt", "unsafe"))));
        Assert.False(File.Exists(Path.Combine(workDirectory, "outside.txt")));
    }

    [Fact]
    public async Task Older_import_remains_available()
    {
        await RunAsync(Feed("Oude halte"));
        await factory.WithDbAsync(async db =>
            await db.TransitStops.ExecuteUpdateAsync(s => s.SetProperty(x => x.UpdatedAtUtc, DateTime.UtcNow.AddDays(-3))));
        using var scope = factory.Services.CreateScope();
        var stops = await scope.ServiceProvider.GetRequiredService<TransitService>().GetStopsAsync(CancellationToken.None);
        Assert.Contains(stops, s => s.Name == "Oude halte");
    }

    private async Task RunAsync(byte[] archive, HttpStatusCode status = HttpStatusCode.OK)
    {
        using var scope = factory.Services.CreateScope();
        using var http = new HttpClient(new ArchiveHandler(archive, status));
        var job = new TransitImportJob(
            new ClientFactory(http),
            Options.Create(new TransitImportOptions { FeedUrl = "https://example.test/feed.zip", WorkDirectory = workDirectory }),
            scope.ServiceProvider.GetRequiredService<TransitService>(),
            NullLogger<TransitImportJob>.Instance);
        await job.RunAsync(CancellationToken.None);
    }

    private static byte[] Feed(string stopName) => Archive(
        ("stops.txt", $"stop_id,stop_name,stop_lat,stop_lon\ns1,{stopName},51.05,3.72\ns2,Zuid,51.03,3.70\n"),
        ("routes.txt", "route_id,route_short_name,route_type\nr1,1,0\n"),
        ("trips.txt", "route_id,service_id,trip_id\nr1,service,t1\n"),
        ("stop_times.txt", "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,08:00:00,08:00:00,s1,1\nt1,08:10:00,08:10:00,s2,2\n"),
        ("calendar_dates.txt", $"service_id,date,exception_type\nservice,{DateTime.Today:yyyyMMdd},1\n"));

    private static byte[] Archive(params (string Name, string Content)[] files)
    {
        using var bytes = new MemoryStream();
        using (var zip = new ZipArchive(bytes, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, content) in files)
            {
                using var writer = new StreamWriter(zip.CreateEntry(name).Open(), Encoding.UTF8);
                writer.Write(content);
            }
        }
        return bytes.ToArray();
    }

    public void Dispose()
    {
        if (Directory.Exists(workDirectory)) Directory.Delete(workDirectory, recursive: true);
    }

    private sealed class ClientFactory(HttpClient client) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => client;
    }

    private sealed class ArchiveHandler(byte[] archive, HttpStatusCode status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status) { Content = new ByteArrayContent(archive) });
    }
}
