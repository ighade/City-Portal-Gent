using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParkingGent.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class Fietsenstallingen : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsPublic",
                table: "Parkings",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsPublic",
                table: "Parkings");
        }
    }
}
