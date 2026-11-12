using System.IO.Compression;
using Hangfire;
using Microsoft.Extensions.Options;

namespace ParkingGent.Api.Services;

public sealed class TransitImportJob(
    IHttpClientFactory clients,
    IOptions<TransitImportOptions> options,
    TransitService transit,
    ILogger<TransitImportJob> log)
{
    public const string ClientName = "TransitImport";
    private const long MaxArchiveBytes = 1024L * 1024 * 1024;
    private const long MaxExtractedBytes = 8L * 1024 * 1024 * 1024;

    [DisableConcurrentExecution(3600)]
    public async Task RunAsync(CancellationToken ct)
    {
        var root = Path.GetFullPath(options.Value.WorkDirectory);
        Directory.CreateDirectory(root);
        var staging = Path.Combine(root, $"import-{Guid.NewGuid():N}");
        Directory.CreateDirectory(staging);

        try
        {
            var archivePath = Path.Combine(staging, "delijn-gtfs.zip");
            var feedPath = Path.Combine(staging, "delijn-gtfs");
            using var downloadTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            downloadTimeout.CancelAfter(TimeSpan.FromMinutes(15));
            var downloadToken = downloadTimeout.Token;
            using var response = await clients.CreateClient(ClientName).GetAsync(
                options.Value.FeedUrl, HttpCompletionOption.ResponseHeadersRead, downloadToken);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > MaxArchiveBytes)
                throw new InvalidDataException("GTFS-archief is groter dan 1 GB.");

            await using (var input = await response.Content.ReadAsStreamAsync(downloadToken))
            await using (var output = new FileStream(archivePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
            {
                var buffer = new byte[81920];
                long total = 0;
                int read;
                while ((read = await input.ReadAsync(buffer, downloadToken)) != 0)
                {
                    total += read;
                    if (total > MaxArchiveBytes) throw new InvalidDataException("GTFS-archief is groter dan 1 GB.");
                    await output.WriteAsync(buffer.AsMemory(0, read), downloadToken);
                }
            }

            Directory.CreateDirectory(feedPath);
            using (var archive = ZipFile.OpenRead(archivePath))
            {
                long extracted = 0;
                foreach (var entry in archive.Entries)
                {
                    ct.ThrowIfCancellationRequested();
                    if (entry.Length > MaxExtractedBytes - extracted)
                        throw new InvalidDataException("Uitgepakte GTFS-feed is groter dan 8 GB.");
                    extracted += entry.Length;
                }
                archive.ExtractToDirectory(feedPath);
            }

            await transit.ImportSeedAsync(feedPath, ct);
            Publish(staging, root);
            log.LogInformation("GTFS-download en import voltooid. Feed bewaard in {Path}.", Path.Combine(root, "current"));
        }
        finally
        {
            if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
        }
    }

    private static void Publish(string staging, string root)
    {
        var current = Path.Combine(root, "current");
        var backup = Path.Combine(root, $"previous-{Guid.NewGuid():N}");
        var hasPrevious = Directory.Exists(current);
        if (hasPrevious) Directory.Move(current, backup);
        try
        {
            Directory.Move(staging, current);
        }
        catch
        {
            if (hasPrevious) Directory.Move(backup, current);
            throw;
        }
        if (hasPrevious) Directory.Delete(backup, recursive: true);
    }
}
