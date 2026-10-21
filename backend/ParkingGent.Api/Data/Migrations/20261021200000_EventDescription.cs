using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParkingGent.Api.Data.Migrations;

// Handmatig geschreven, zoals TransitRouteColor.
[DbContext(typeof(AppDbContext))]
[Migration("20261021200000_EventDescription")]
public partial class EventDescription : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(name: "Description", table: "Events", type: "text", nullable: true);
        migrationBuilder.AddColumn<DateTime>(name: "DescriptionFetchedAtUtc", table: "Events", type: "timestamp with time zone", nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "Description", table: "Events");
        migrationBuilder.DropColumn(name: "DescriptionFetchedAtUtc", table: "Events");
    }
}
