using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParkingGent.Api.Data.Migrations;

// Handmatig geschreven, zoals TransitData; bedragen komen van de infografiek "Parkeertarieven op straat".
[DbContext(typeof(AppDbContext))]
[Migration("20261014100000_StreetParkingTariffs")]
public partial class StreetParkingTariffs : Migration
{
    private static readonly (string Zone, string Period, int Hours, decimal Amount)[] Seed =
    [
        ("rood", "dag", 1, 4.6m), ("rood", "dag", 2, 9.2m), ("rood", "dag", 3, 13.8m),
        ("oranje", "dag", 1, 2.2m), ("oranje", "dag", 2, 4.4m), ("oranje", "dag", 3, 6.6m), ("oranje", "dag", 4, 8.8m), ("oranje", "dag", 5, 11m),
        ("geel", "dag", 1, 2.2m), ("geel", "dag", 2, 4.4m), ("geel", "dag", 3, 6.6m), ("geel", "dag", 4, 8.8m), ("geel", "dag", 5, 11m),
        ("groen", "dag", 1, 1.2m), ("groen", "dag", 2, 2.4m), ("groen", "dag", 3, 3.6m), ("groen", "dag", 4, 4.2m), ("groen", "dag", 5, 4.2m), ("groen", "dag", 0, 4.2m),
        ("rood", "avond", 1, 2.2m), ("rood", "avond", 2, 4.4m), ("rood", "avond", 3, 6.6m), ("rood", "avond", 4, 8.8m),
        ("oranje", "avond", 1, 1.8m), ("oranje", "avond", 2, 3.6m), ("oranje", "avond", 3, 5.4m), ("oranje", "avond", 4, 7.2m),
        ("geel", "avond", 1, 0m), ("geel", "avond", 2, 0m), ("geel", "avond", 3, 0m), ("geel", "avond", 4, 0m),
        ("groen", "avond", 1, 0m), ("groen", "avond", 2, 0m), ("groen", "avond", 3, 0m), ("groen", "avond", 4, 0m),
    ];

    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "StreetParkingTariffs",
            columns: table => new
            {
                Id = table.Column<long>(type: "bigint", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                Zone = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                Period = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                Hours = table.Column<int>(type: "integer", nullable: false),
                AmountEur = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_StreetParkingTariffs", x => x.Id));

        migrationBuilder.CreateIndex(
            name: "IX_StreetParkingTariffs_Zone_Period_Hours",
            table: "StreetParkingTariffs",
            columns: new[] { "Zone", "Period", "Hours" },
            unique: true);

        var values = new object[Seed.Length, 4];
        for (var i = 0; i < Seed.Length; i++)
        {
            values[i, 0] = Seed[i].Zone;
            values[i, 1] = Seed[i].Period;
            values[i, 2] = Seed[i].Hours;
            values[i, 3] = Seed[i].Amount;
        }

        migrationBuilder.InsertData(
            table: "StreetParkingTariffs",
            columns: new[] { "Zone", "Period", "Hours", "AmountEur" },
            columnTypes: new[] { "character varying(20)", "character varying(10)", "integer", "numeric(8,2)" },
            values: values);
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "StreetParkingTariffs");
}
