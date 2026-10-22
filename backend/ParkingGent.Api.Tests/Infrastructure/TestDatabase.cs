using Npgsql;
using Testcontainers.PostgreSql;

namespace ParkingGent.Api.Tests.Infrastructure;

/// <summary>
/// Eén Postgres voor alle tests, met per factory een eigen, lege database erin.
/// Zet <c>TEST_POSTGRES</c> (een gewone connection string) om een bestaande server te gebruiken;
/// anders start Testcontainers zelf een wegwerp-container (Docker moet dan draaien).
/// </summary>
public static class TestDatabase
{
    private static readonly Lazy<Task<string>> Server = new(StartAsync);

    private static async Task<string> StartAsync()
    {
        var external = Environment.GetEnvironmentVariable("TEST_POSTGRES");
        if (!string.IsNullOrWhiteSpace(external)) return external;

        var container = new PostgreSqlBuilder("postgres:16-alpine").Build();
        await container.StartAsync();
        return container.GetConnectionString();
    }

    public static async Task<string> NewConnectionStringAsync()
    {
        var server = new NpgsqlConnectionStringBuilder(await Server.Value) { Pooling = false };
        var name = "pg_" + Guid.NewGuid().ToString("N");

        // De app voert al SQL uit vóór de migraties, dus de lege database moet bestaan.
        await using (var admin = new NpgsqlConnection(server.ConnectionString))
        {
            await admin.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", admin);
            await create.ExecuteNonQueryAsync();
        }

        server.Database = name;

        // Op een lege database bestaat de EF-geschiedenistabel nog niet, terwijl de opstart-SQL
        // (bedoeld voor bestaande databases) er al in schrijft.
        await using (var db = new NpgsqlConnection(server.ConnectionString))
        {
            await db.OpenAsync();
            await using var history = new NpgsqlCommand(
                "CREATE TABLE \"__EFMigrationsHistory\" (\"MigrationId\" varchar(150) PRIMARY KEY, \"ProductVersion\" varchar(32) NOT NULL)", db);
            await history.ExecuteNonQueryAsync();
        }

        return server.ConnectionString;
    }
}
