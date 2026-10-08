using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Parking> Parkings => Set<Parking>();
    public DbSet<ParkingStatus> Statuses => Set<ParkingStatus>();
    public DbSet<Measurement> Measurements => Set<Measurement>();
    public DbSet<SyncRun> Runs => Set<SyncRun>();
    public DbSet<TransitStopEntity> TransitStops => Set<TransitStopEntity>();
    public DbSet<TransitRouteEntity> TransitRoutes => Set<TransitRouteEntity>();
    public DbSet<TransitStopRouteEntity> TransitStopRoutes => Set<TransitStopRouteEntity>();
    public DbSet<TransitConnectionEntity> TransitConnections => Set<TransitConnectionEntity>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Parking>(e =>
        {
            e.HasIndex(p => p.Slug).IsUnique();
            e.HasIndex(p => p.ExternalId).IsUnique();
            e.Property(p => p.Slug).HasMaxLength(80);
            e.Property(p => p.ExternalId).HasMaxLength(300);
            e.Property(p => p.Name).HasMaxLength(200);
            e.Property(p => p.Address).HasMaxLength(300);
            e.Property(p => p.Url).HasMaxLength(500);
            e.Property(p => p.Operator).HasMaxLength(200);
            e.Property(p => p.OpeningHours).HasMaxLength(200);
            e.HasIndex(p => p.Kind);
        });

        b.Entity<ParkingStatus>(e =>
        {
            // Eén stand per parking: de parkeer-id ís de sleutel.
            e.HasKey(s => s.ParkingId);
            e.HasOne(s => s.Parking).WithOne(p => p.Status)
                .HasForeignKey<ParkingStatus>(s => s.ParkingId).OnDelete(DeleteBehavior.Cascade);
            e.Property(s => s.SourceTrend).HasMaxLength(40);
        });

        b.Entity<Measurement>(e =>
        {
            e.HasOne(m => m.Parking).WithMany(p => p.Measurements)
                .HasForeignKey(m => m.ParkingId).OnDelete(DeleteBehavior.Cascade);
            // Twee ophaalrondes binnen hetzelfde meetinterval van de stad leveren dezelfde meting;
            // die hoort er één keer te staan. Deze index maakt het ook de goedkoopste vraag die de
            // grafieken stellen: "alles van deze parking, nieuwste eerst".
            e.HasIndex(m => new { m.ParkingId, m.MeasuredAtUtc }).IsUnique();
            // Voor het opruimen van oude metingen over alle parkings heen.
            e.HasIndex(m => m.MeasuredAtUtc);
        });

        b.Entity<SyncRun>(e =>
        {
            e.HasIndex(r => r.StartedUtc);
            e.Property(r => r.Trigger).HasMaxLength(20);
            e.Property(r => r.Message).HasMaxLength(1000);
        });

        b.Entity<TransitStopEntity>(e =>
        {
            e.HasKey(s => s.Id);
            e.Property(s => s.Id).HasMaxLength(120);
            e.Property(s => s.Name).HasMaxLength(250);
            e.HasIndex(s => s.Name);
        });

        b.Entity<TransitRouteEntity>(e =>
        {
            e.HasKey(r => r.Id);
            e.Property(r => r.Id).HasMaxLength(120);
            e.Property(r => r.Name).HasMaxLength(250);
            e.Property(r => r.Mode).HasMaxLength(20);
        });

        b.Entity<TransitStopRouteEntity>(e =>
        {
            e.HasKey(x => new { x.StopId, x.RouteId });
            e.HasOne(x => x.Stop).WithMany(x => x.Routes).HasForeignKey(x => x.StopId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Route).WithMany(x => x.Stops).HasForeignKey(x => x.RouteId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<TransitConnectionEntity>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.TripId).HasMaxLength(160);
            e.Property(x => x.RouteId).HasMaxLength(120);
            e.Property(x => x.FromStopId).HasMaxLength(120);
            e.Property(x => x.ToStopId).HasMaxLength(120);
            e.Property(x => x.ServiceId).HasMaxLength(120);
            e.HasIndex(x => new { x.FromStopId, x.DepartureSeconds });
            e.HasIndex(x => new { x.RouteId, x.TripId });
        });
    }
}
