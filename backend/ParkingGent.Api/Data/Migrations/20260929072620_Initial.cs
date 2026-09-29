using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ParkingGent.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Parkings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Slug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    Latitude = table.Column<double>(type: "double precision", nullable: false),
                    Longitude = table.Column<double>(type: "double precision", nullable: false),
                    Address = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    Capacity = table.Column<int>(type: "integer", nullable: false),
                    Url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Operator = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    OpeningHours = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    InLowEmissionZone = table.Column<bool>(type: "boolean", nullable: true),
                    IsFree = table.Column<bool>(type: "boolean", nullable: true),
                    HasLiveData = table.Column<bool>(type: "boolean", nullable: false),
                    FirstSeenUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Parkings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Runs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    StartedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DurationMs = table.Column<int>(type: "integer", nullable: false),
                    Ok = table.Column<bool>(type: "boolean", nullable: false),
                    Trigger = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    LiveCount = table.Column<int>(type: "integer", nullable: false),
                    CatalogueCount = table.Column<int>(type: "integer", nullable: false),
                    MeasurementsAdded = table.Column<int>(type: "integer", nullable: false),
                    MeasurementsPruned = table.Column<int>(type: "integer", nullable: false),
                    Message = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Runs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Measurements",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ParkingId = table.Column<int>(type: "integer", nullable: false),
                    MeasuredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AvailableSpaces = table.Column<int>(type: "integer", nullable: false),
                    TotalCapacity = table.Column<int>(type: "integer", nullable: false),
                    OccupancyPct = table.Column<short>(type: "smallint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Measurements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Measurements_Parkings_ParkingId",
                        column: x => x.ParkingId,
                        principalTable: "Parkings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Statuses",
                columns: table => new
                {
                    ParkingId = table.Column<int>(type: "integer", nullable: false),
                    AvailableSpaces = table.Column<int>(type: "integer", nullable: false),
                    TotalCapacity = table.Column<int>(type: "integer", nullable: false),
                    OccupancyPct = table.Column<short>(type: "smallint", nullable: false),
                    IsPlausible = table.Column<bool>(type: "boolean", nullable: false),
                    IsOpen = table.Column<bool>(type: "boolean", nullable: false),
                    TemporarilyClosed = table.Column<bool>(type: "boolean", nullable: false),
                    SourceTrend = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    MeasuredAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    FetchedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Statuses", x => x.ParkingId);
                    table.ForeignKey(
                        name: "FK_Statuses_Parkings_ParkingId",
                        column: x => x.ParkingId,
                        principalTable: "Parkings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Measurements_MeasuredAtUtc",
                table: "Measurements",
                column: "MeasuredAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_Measurements_ParkingId_MeasuredAtUtc",
                table: "Measurements",
                columns: new[] { "ParkingId", "MeasuredAtUtc" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Parkings_ExternalId",
                table: "Parkings",
                column: "ExternalId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Parkings_Kind",
                table: "Parkings",
                column: "Kind");

            migrationBuilder.CreateIndex(
                name: "IX_Parkings_Slug",
                table: "Parkings",
                column: "Slug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Runs_StartedUtc",
                table: "Runs",
                column: "StartedUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Measurements");

            migrationBuilder.DropTable(
                name: "Runs");

            migrationBuilder.DropTable(
                name: "Statuses");

            migrationBuilder.DropTable(
                name: "Parkings");
        }
    }
}
