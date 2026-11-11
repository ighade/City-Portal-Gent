using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParkingGent.Api.Data.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261111170000_Museums")]
public partial class Museums : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "Museums",
            columns: table => new
            {
                Id = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                Lat = table.Column<double>(type: "double precision", nullable: false),
                Lon = table.Column<double>(type: "double precision", nullable: false),
                Hours = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                Website = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                WikidataId = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                FeaturedObjectId = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                CollectionSummary = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
            },
            constraints: table => table.PrimaryKey("PK_Museums", x => x.Id));

        // Eenmalige begindata: coördinaten uit Wikidata P625, openingstijden indicatief.
        migrationBuilder.InsertData(
            table: "Museums",
            columns: new[] { "Id", "Name", "Lat", "Lon", "Hours", "Website", "WikidataId", "FeaturedObjectId", "CollectionSummary" },
            columnTypes: new[] { "character varying(80)", "character varying(200)", "double precision", "double precision", "character varying(2000)", "character varying(500)", "character varying(20)", "character varying(20)", "character varying(2000)" },
            values: new object[,]
            {
                { "msk", "MSK", 51.037975, 3.724244, "Di–vr 9.30–17.30; za–zo 10–18; maandag gesloten. Schoolvakanties: dagelijks 10–18.", "https://www.mskgent.be/", "Q2365880", "Q21674415", "Het museum verzamelt beeldende kunst." },
                { "smak", "S.M.A.K.", 51.038169, 3.722025, "Buiten schoolvakanties: di–vr 9.30–17.30, maandag gesloten. Feestdagen en schoolvakanties: 10–18.", "https://smak.be/en/visit-smak/with-children/with-children-practical", "Q1540707", "Q22253723", "De collectie omvat hedendaagse kunst." },
                { "gum", "GUM", 51.03631, 3.72419, "Ma, di, do en vr 9.30–17.30; za–zo 10–18. Woensdag gesloten; de Plantentuin blijft open. Gesloten op 24, 25 en 31 december en 1 januari.", "https://www.gum.gent/en/contact", "Q100263681", null, null },
                { "stam", "STAM", 51.04361, 3.71722, "Woensdag gesloten. Raadpleeg de website voor de overige openingsuren.", "https://stamgent.be/", "Q980285", "Q81983760", "De collectie vertelt de geschiedenis van Gent." },
                { "industriemuseum", "Industriemuseum", 51.059391, 3.728896, "Woensdag gesloten, behalve tijdens de Gentse Feesten, krokus- en herfstvakantie en de eerste week van de kerstvakantie.", "https://www.industriemuseum.be/", "Q2245203", null, null },
                { "huis-van-alijn", "Huis van Alijn", 51.057525, 3.723354, "Laatste toegang een halfuur voor sluiting. Raadpleeg de website voor de openingsuren.", "https://huisvanalijn.be/en/opening-hours", "Q2358158", null, null }
            });
    }

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.DropTable(name: "Museums");
}
