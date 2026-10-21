using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParkingGent.Api.Data.Migrations;

// Handmatig geschreven, zoals TransitData. De kleuren komen pas na een nieuwe --import-transit.
[DbContext(typeof(AppDbContext))]
[Migration("20261021150000_TransitRouteColor")]
public partial class TransitRouteColor : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) =>
        migrationBuilder.AddColumn<string>(name: "Color", table: "TransitRoutes", type: "character varying(6)", maxLength: 6, nullable: true);

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropColumn(name: "Color", table: "TransitRoutes");
}
