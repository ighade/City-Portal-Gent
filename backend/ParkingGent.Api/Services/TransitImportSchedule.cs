using Hangfire;
using Hangfire.Storage;

namespace ParkingGent.Api.Services;

public static class TransitImportSchedule
{
    public const string JobId = "delijn-gtfs-import";

    public static void Register(IServiceProvider services, TransitImportOptions options)
    {
        var storage = services.GetRequiredService<JobStorage>();
        using var connection = storage.GetConnection();
        using var registrationLock = connection.AcquireDistributedLock("delijn-gtfs-registration", TimeSpan.FromSeconds(30));
        var firstRegistration = connection.GetRecurringJobs().All(job => job.Id != JobId);
        services.GetRequiredService<IRecurringJobManager>().AddOrUpdate<TransitImportJob>(
            JobId, job => job.RunAsync(CancellationToken.None), options.Cron,
            new RecurringJobOptions { TimeZone = TimeZoneInfo.FindSystemTimeZoneById(options.TimeZone) });
        if (firstRegistration)
            services.GetRequiredService<IBackgroundJobClient>().Enqueue<TransitImportJob>(job => job.RunAsync(CancellationToken.None));
    }
}
