using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParkingGent.Api.Data.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261023122000_ManualParkingRates")]
public partial class ManualParkingRates : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<bool>(
            name: "IsManual",
            table: "Parkings",
            type: "boolean",
            nullable: false,
            defaultValue: false);

        migrationBuilder.CreateIndex(
            name: "IX_Parkings_IsManual",
            table: "Parkings",
            column: "IsManual");

        migrationBuilder.CreateTable(
            name: "ManualParkingRates",
            columns: table => new
            {
                ParkingId = table.Column<int>(type: "integer", nullable: false),
                WeekdayHourlyEur = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
                WeekdayStart = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                WeekdayEnd = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                DaytimeMaximumEur = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                DaytimeStart = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                DaytimeEnd = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                NighttimeMaximumEur = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                NighttimeStart = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                NighttimeEnd = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                DailyMaximumEur = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: true),
                WeekendHourlyEur = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ManualParkingRates", x => x.ParkingId);
                table.ForeignKey(
                    name: "FK_ManualParkingRates_Parkings_ParkingId",
                    column: x => x.ParkingId,
                    principalTable: "Parkings",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "ManualParkingRates");
        migrationBuilder.DropIndex(name: "IX_Parkings_IsManual", table: "Parkings");
        migrationBuilder.DropColumn(name: "IsManual", table: "Parkings");
    }
}
