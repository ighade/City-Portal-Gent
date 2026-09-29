using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Parking> Parkings => Set<Parking>();
    public DbSet<ParkingStatus> Statuses => Set<ParkingStatus>();
    public DbSet<Measurement> Measurements => Set<Measurement>();
    public DbSet<SyncRun> Runs => Set<SyncRun>();

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
    }
}
