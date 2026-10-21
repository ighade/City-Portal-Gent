using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParkingGent.Api.Data.Migrations;

// Handmatig geschreven, zoals TransitData.
[DbContext(typeof(AppDbContext))]
[Migration("20261021120000_Events")]
public partial class Events : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "EventPlaces",
            columns: table => new
            {
                Id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                Name = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_EventPlaces", x => x.Id));

        migrationBuilder.CreateTable(
            name: "Events",
            columns: table => new
            {
                Id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                Url = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                Name = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                CoverImageUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                CoverPhotoId = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                CoverAccessibilityCaption = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                IsOnline = table.Column<bool>(type: "boolean", nullable: false),
                IsPast = table.Column<bool>(type: "boolean", nullable: false),
                IsHappeningNow = table.Column<bool>(type: "boolean", nullable: false),
                StartsAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                DayTimeLabel = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                PlaceId = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                Kind = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                SocialSummary = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                InterestedCount = table.Column<int>(type: "integer", nullable: true),
                GoingCount = table.Column<int>(type: "integer", nullable: true),
                WentCount = table.Column<int>(type: "integer", nullable: true),
                TicketPriceLabel = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                ImportedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Events", x => x.Id);
                table.ForeignKey("FK_Events_EventPlaces_PlaceId", x => x.PlaceId, "EventPlaces", "Id", onDelete: ReferentialAction.SetNull);
            });

        migrationBuilder.CreateIndex(name: "IX_Events_PlaceId", table: "Events", column: "PlaceId");
        migrationBuilder.CreateIndex(name: "IX_Events_StartsAtUtc", table: "Events", column: "StartsAtUtc");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "Events");
        migrationBuilder.DropTable(name: "EventPlaces");
    }
}
