using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ParkingGent.Api.Data.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261124232137_AddChatEntities")]
public partial class AddChatEntities : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "ChatConversations",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                GroupName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                GroupImageUrl = table.Column<string>(type: "text", nullable: true),
                CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ChatConversations", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "ChatMessages",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                SentByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                Content = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                SentAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ChatMessages", x => x.Id);
                table.ForeignKey(
                    name: "FK_ChatMessages_ChatConversations_ConversationId",
                    column: x => x.ConversationId,
                    principalTable: "ChatConversations",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "ChatEvents",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                SentByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                EventId = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                SentAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ChatEvents", x => x.Id);
                table.ForeignKey(
                    name: "FK_ChatEvents_ChatConversations_ConversationId",
                    column: x => x.ConversationId,
                    principalTable: "ChatConversations",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateTable(
            name: "GroupMembers",
            columns: table => new
            {
                ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                UserId = table.Column<Guid>(type: "uuid", nullable: false),
                AddedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                JoinedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_GroupMembers", x => new { x.ConversationId, x.UserId });
                table.ForeignKey(
                    name: "FK_GroupMembers_ChatConversations_ConversationId",
                    column: x => x.ConversationId,
                    principalTable: "ChatConversations",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_ChatConversations_CreatedAtUtc",
            table: "ChatConversations",
            column: "CreatedAtUtc");

        migrationBuilder.CreateIndex(
            name: "IX_ChatMessages_ConversationId_SentAtUtc",
            table: "ChatMessages",
            columns: new[] { "ConversationId", "SentAtUtc" });

        migrationBuilder.CreateIndex(
            name: "IX_ChatEvents_ConversationId_SentAtUtc",
            table: "ChatEvents",
            columns: new[] { "ConversationId", "SentAtUtc" });

        migrationBuilder.CreateIndex(
            name: "IX_GroupMembers_UserId",
            table: "GroupMembers",
            column: "UserId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "ChatEvents");
        migrationBuilder.DropTable(name: "ChatMessages");
        migrationBuilder.DropTable(name: "GroupMembers");
        migrationBuilder.DropTable(name: "ChatConversations");
    }
}
