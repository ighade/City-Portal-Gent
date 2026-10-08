using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParkingGent.Api.Data.Migrations;

[Migration("20261007150000_TransitData")]
public partial class TransitData : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "TransitRoutes",
            columns: table => new
            {
                Id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                Name = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                Mode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_TransitRoutes", x => x.Id));

        migrationBuilder.CreateTable(
            name: "TransitStops",
            columns: table => new
            {
                Id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                Name = table.Column<string>(type: "character varying(250)", maxLength: 250, nullable: false),
                Latitude = table.Column<double>(type: "double precision", nullable: false),
                Longitude = table.Column<double>(type: "double precision", nullable: false),
                UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_TransitStops", x => x.Id));

        migrationBuilder.CreateTable(
            name: "TransitConnections",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                TripId = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                RouteId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                FromStopId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                ToStopId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                DepartureSeconds = table.Column<int>(type: "integer", nullable: false),
                ArrivalSeconds = table.Column<int>(type: "integer", nullable: false),
                ServiceId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_TransitConnections", x => x.Id));

        migrationBuilder.CreateTable(
            name: "TransitStopRoutes",
            columns: table => new
            {
                StopId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                RouteId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_TransitStopRoutes", x => new { x.StopId, x.RouteId });
                table.ForeignKey("FK_TransitStopRoutes_TransitRoutes_RouteId", x => x.RouteId, "TransitRoutes", "Id", onDelete: ReferentialAction.Cascade);
                table.ForeignKey("FK_TransitStopRoutes_TransitStops_StopId", x => x.StopId, "TransitStops", "Id", onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(name: "IX_TransitConnections_FromStopId_DepartureSeconds", table: "TransitConnections", columns: new[] { "FromStopId", "DepartureSeconds" });
        migrationBuilder.CreateIndex(name: "IX_TransitConnections_RouteId_TripId", table: "TransitConnections", columns: new[] { "RouteId", "TripId" });
        migrationBuilder.CreateIndex(name: "IX_TransitRoutes_Name", table: "TransitRoutes", column: "Name");
        migrationBuilder.CreateIndex(name: "IX_TransitStopRoutes_RouteId", table: "TransitStopRoutes", column: "RouteId");
        migrationBuilder.CreateIndex(name: "IX_TransitStops_Name", table: "TransitStops", column: "Name");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "TransitConnections");
        migrationBuilder.DropTable(name: "TransitStopRoutes");
        migrationBuilder.DropTable(name: "TransitRoutes");
        migrationBuilder.DropTable(name: "TransitStops");
    }
}
