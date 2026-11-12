using Hangfire;
using Hangfire.Storage;
using Microsoft.Extensions.DependencyInjection;
using ParkingGent.Api.Services;

namespace ParkingGent.Api.Tests;

public sealed class TransitImportScheduleTests(TransitScheduleFactory factory) : IClassFixture<TransitScheduleFactory>
{
    [Fact]
    public void Registers_brussels_schedule_and_only_enqueues_once()
    {
        var storage = factory.Services.GetRequiredService<JobStorage>();
        using var connection = storage.GetConnection();
        var job = Assert.Single(connection.GetRecurringJobs(), j => j.Id == TransitImportSchedule.JobId);
        Assert.Equal("0 18 * * *", job.Cron);
        Assert.Equal("Europe/Brussels", job.TimeZoneId);
        Assert.Equal(1, storage.GetMonitoringApi().EnqueuedCount("default"));

        TransitImportSchedule.Register(factory.Services, new TransitImportOptions());

        Assert.Equal(1, storage.GetMonitoringApi().EnqueuedCount("default"));
        Assert.Single(connection.GetRecurringJobs(), j => j.Id == TransitImportSchedule.JobId);
    }
}

public sealed class TransitScheduleFactory : ApiFactory
{
    protected override void Configure(Dictionary<string, string?> settings) =>
        settings["TransitImport:Enabled"] = "true";
}
