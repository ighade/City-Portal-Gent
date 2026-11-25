using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

public sealed record ChatMessageDto(Guid Id, Guid ConversationId, Guid SentByUserId, string SenderUsername, string Content, DateTime SentAtUtc);
public sealed record DirectChatFriendDto(string Username, string? Avatar);
public sealed record ChatConversationDto(Guid Id, string? GroupName, string? GroupImageUrl, Guid? CreatedByUserId, DateTime CreatedAtUtc, List<ChatMessageDto> RecentMessages, List<Guid>? GroupMembers, DirectChatFriendDto? DirectChatFriend = null);
public sealed record CreateGroupRequest(string? GroupName, string? GroupImageUrl, List<Guid>? InitialMemberIds);
public sealed record SendMessageRequest(string? Content);
public sealed record AddGroupMemberRequest(string? Username);

/// <summary>
/// Chat service: direktne berichten tussen vrienden en groepschats.
/// Groepen kunnen alleen door hun maker worden verwijderd, maar iedereen kan leden toevoegen.
/// </summary>
public sealed partial class Chat(AppDbContext db, PushNotifier push)
{
    /// <summary>Krijgt of maakt een directe chat tussen twee vrienden.</summary>
    public async Task<Guid> GetOrCreateDirectConversationAsync(Guid userId1, Guid userId2, CancellationToken ct)
    {
        // Zoek bestaande directe chat (zonder GroupName)
        var existing = await db.ChatConversations
            .Where(c => c.GroupName == null && c.GroupMembers.Count == 2 &&
                   c.GroupMembers.Any(m => m.UserId == userId1) &&
                   c.GroupMembers.Any(m => m.UserId == userId2))
            .Select(c => c.Id)
            .FirstOrDefaultAsync(ct);

        if (existing != Guid.Empty) return existing;

        // Maak nieuwe directe chat
        var conv = new ChatConversation
        {
            Id = Guid.NewGuid(),
            GroupName = null,
            CreatedAtUtc = DateTime.UtcNow,
        };
        db.ChatConversations.Add(conv);

        db.GroupMembers.Add(new GroupMember { ConversationId = conv.Id, UserId = userId1, JoinedAtUtc = DateTime.UtcNow });
        db.GroupMembers.Add(new GroupMember { ConversationId = conv.Id, UserId = userId2, JoinedAtUtc = DateTime.UtcNow });

        await db.SaveChangesAsync(ct);
        return conv.Id;
    }

    /// <summary>Maakt een nieuwe groepschat.</summary>
    public async Task<Guid> CreateGroupAsync(FriendUser creator, string? groupName, string? groupImageUrl, List<Guid>? initialMemberIds, CancellationToken ct)
    {
        var name = (groupName ?? "").Trim();
        if (name.Length == 0 || name.Length > 200) return Guid.Empty;

        // Valideer groepsfoto
        var imageError = ValidateGroupImage(groupImageUrl);
        if (imageError is not null) return Guid.Empty;

        var conv = new ChatConversation
        {
            Id = Guid.NewGuid(),
            GroupName = name,
            GroupImageUrl = string.IsNullOrEmpty(groupImageUrl) ? null : groupImageUrl,
            CreatedByUserId = creator.Id,
            CreatedAtUtc = DateTime.UtcNow,
        };
        db.ChatConversations.Add(conv);

        // Voeg maker toe
        db.GroupMembers.Add(new GroupMember { ConversationId = conv.Id, UserId = creator.Id, JoinedAtUtc = DateTime.UtcNow });

        // Voeg initiële leden toe
        if (initialMemberIds?.Count > 0)
        {
            var validMemberIds = await db.FriendUsers
                .Where(u => initialMemberIds.Contains(u.Id) && u.Id != creator.Id)
                .Select(u => u.Id)
                .ToListAsync(ct);

            foreach (var memberId in validMemberIds)
            {
                db.GroupMembers.Add(new GroupMember
                {
                    ConversationId = conv.Id,
                    UserId = memberId,
                    AddedByUserId = creator.Id,
                    JoinedAtUtc = DateTime.UtcNow,
                });
            }
        }

        await db.SaveChangesAsync(ct);
        return conv.Id;
    }

    /// <summary>Voegt een lid toe aan een groep.</summary>
    public async Task<bool> AddGroupMemberAsync(FriendUser adder, Guid conversationId, string username, CancellationToken ct)
    {
        var conv = await db.ChatConversations.FirstOrDefaultAsync(c => c.Id == conversationId, ct);
        if (conv?.GroupName == null) return false;

        // Check of adder lid is van de groep
        var isMember = await db.GroupMembers.AnyAsync(m => m.ConversationId == conversationId && m.UserId == adder.Id, ct);
        if (!isMember) return false;

        // Vind de nieuwe lid
        var newMember = await db.FriendUsers.FirstOrDefaultAsync(u => u.Username.ToLower() == username.ToLower(), ct);
        if (newMember is null) return false;

        // Check of hij niet al lid is
        var alreadyMember = await db.GroupMembers.AnyAsync(m => m.ConversationId == conversationId && m.UserId == newMember.Id, ct);
        if (alreadyMember) return false;

        db.GroupMembers.Add(new GroupMember
        {
            ConversationId = conversationId,
            UserId = newMember.Id,
            AddedByUserId = adder.Id,
            JoinedAtUtc = DateTime.UtcNow,
        });

        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>Verwijdert een lid uit een groep (alleen de maker mag dit).</summary>
    public async Task<bool> RemoveGroupMemberAsync(FriendUser requester, Guid conversationId, Guid memberId, CancellationToken ct)
    {
        var conv = await db.ChatConversations.FirstOrDefaultAsync(c => c.Id == conversationId, ct);
        if (conv?.GroupName == null || conv.CreatedByUserId != requester.Id) return false;

        return await db.GroupMembers
            .Where(m => m.ConversationId == conversationId && m.UserId == memberId)
            .ExecuteDeleteAsync(ct) > 0;
    }

    /// <summary>Verwijdert een groep (alleen de maker mag dit).</summary>
    public async Task<bool> DeleteGroupAsync(FriendUser requester, Guid conversationId, CancellationToken ct)
    {
        var conv = await db.ChatConversations.FirstOrDefaultAsync(c => c.Id == conversationId, ct);
        if (conv?.GroupName == null || conv.CreatedByUserId != requester.Id) return false;

        db.ChatConversations.Remove(conv);
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>Verstuurt een bericht in een chat.</summary>
    public async Task<bool> SendMessageAsync(FriendUser sender, Guid conversationId, string content, CancellationToken ct)
    {
        var msg = (content ?? "").Trim();
        if (msg.Length == 0 || msg.Length > 2000) return false;

        // Check of sender lid is van de conversatie
        var isMember = await db.GroupMembers.AnyAsync(m => m.ConversationId == conversationId && m.UserId == sender.Id, ct);
        if (!isMember) return false;

        db.ChatMessages.Add(new ChatMessage
        {
            Id = Guid.NewGuid(),
            ConversationId = conversationId,
            SentByUserId = sender.Id,
            Content = msg,
            SentAtUtc = DateTime.UtcNow,
        });

        await db.SaveChangesAsync(ct);
        await NotifyMembersAsync(sender, conversationId, msg, ct);
        return true;
    }

    /// <summary>Meldt een nieuw bericht aan de andere leden van het gesprek, op elk toestel dat een pushtoken doorgaf.</summary>
    private async Task NotifyMembersAsync(FriendUser sender, Guid conversationId, string content, CancellationToken ct)
    {
        try
        {
            var tokens = await db.PushTokens
                .Where(t => t.UserId != sender.Id
                    && db.GroupMembers.Any(m => m.ConversationId == conversationId && m.UserId == t.UserId))
                .Select(t => t.Token)
                .ToListAsync(ct);
            if (tokens.Count == 0) return;

            var groupName = await db.ChatConversations
                .Where(c => c.Id == conversationId)
                .Select(c => c.GroupName)
                .FirstOrDefaultAsync(ct);
            var text = content.Length > 140 ? content[..140] + "…" : content;
            push.Send(
                tokens,
                groupName ?? sender.Username,
                groupName is null ? text : $"{sender.Username}: {text}",
                new { conversationId });
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            // Het bericht is al opgeslagen; een mislukte melding mag dat niet ongedaan maken.
        }
    }

    /// <summary>Haalt recente berichten op voor een chat (max 50).</summary>
    /// <summary>Haalt recente berichten op voor een chat (max 50).</summary>
    public async Task<ChatConversationDto?> GetConversationAsync(FriendUser requester, Guid conversationId, CancellationToken ct)
    {
        var conv = await db.ChatConversations
            .Include(c => c.Messages.OrderByDescending(m => m.SentAtUtc).Take(50))
            .Include(c => c.GroupMembers)
            .FirstOrDefaultAsync(c => c.Id == conversationId, ct);

        if (conv is null) return null;

        // Check of requester lid is
        var isMember = conv.GroupMembers.Any(m => m.UserId == requester.Id);
        if (!isMember) return null;

        var userIds = conv.Messages.Select(m => m.SentByUserId).Distinct().ToList();
        var users = await db.FriendUsers
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        var messages = conv.Messages.OrderBy(m => m.SentAtUtc).Select(m => new ChatMessageDto(
            m.Id, m.ConversationId, m.SentByUserId,
            users.TryGetValue(m.SentByUserId, out var u) ? u.Username : "Onbekend",
            m.Content, m.SentAtUtc)).ToList();

        // For direct chats, get the other member's info
        DirectChatFriendDto? directChatFriend = null;
        if (conv.GroupName == null && conv.GroupMembers.Count == 2)
        {
            var otherMemberId = conv.GroupMembers.FirstOrDefault(m => m.UserId != requester.Id)?.UserId;
            if (otherMemberId != null)
            {
                var otherMember = await db.FriendUsers.FirstOrDefaultAsync(u => u.Id == otherMemberId, ct);
                if (otherMember != null)
                {
                    directChatFriend = new DirectChatFriendDto(otherMember.Username, otherMember.AvatarDataUrl);
                }
            }
        }

        return new ChatConversationDto(
            conv.Id, conv.GroupName, conv.GroupImageUrl, conv.CreatedByUserId, conv.CreatedAtUtc,
            messages,
            conv.GroupMembers.Select(m => m.UserId).ToList(),
            directChatFriend);
    }

    /// <summary>Haalt alle conversaties op voor een gebruiker.</summary>
    public async Task<List<ChatConversationDto>> GetConversationsAsync(FriendUser user, CancellationToken ct)
    {
        var convIds = await db.GroupMembers
            .Where(m => m.UserId == user.Id)
            .Select(m => m.ConversationId)
            .ToListAsync(ct);

        var convs = await db.ChatConversations
            .Where(c => convIds.Contains(c.Id))
            .Include(c => c.Messages.OrderByDescending(m => m.SentAtUtc).Take(50))
            .Include(c => c.GroupMembers)
            .OrderByDescending(c => c.Messages.Max(m => m.SentAtUtc))
            .ToListAsync(ct);

        var allUserIds = convs.SelectMany(c => c.Messages.Select(m => m.SentByUserId)).Distinct().ToList();
        var users = await db.FriendUsers
            .Where(u => allUserIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        // Also get all members from direct chats to show friend info
        var allMemberIds = convs.Where(c => c.GroupName == null).SelectMany(c => c.GroupMembers.Select(m => m.UserId)).Distinct().ToList();
        var allMembers = await db.FriendUsers
            .Where(u => allMemberIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, ct);

        return convs.Select(conv =>
        {
            var messages = conv.Messages.OrderBy(m => m.SentAtUtc).Select(m => new ChatMessageDto(
                m.Id, m.ConversationId, m.SentByUserId,
                users.TryGetValue(m.SentByUserId, out var u) ? u.Username : "Onbekend",
                m.Content, m.SentAtUtc)).ToList();

            // For direct chats, get the other member's info
            DirectChatFriendDto? directChatFriend = null;
            if (conv.GroupName == null && conv.GroupMembers.Count == 2)
            {
                var otherMemberId = conv.GroupMembers.FirstOrDefault(m => m.UserId != user.Id)?.UserId;
                if (otherMemberId != null && allMembers.TryGetValue(otherMemberId.Value, out var friend))
                {
                    directChatFriend = new DirectChatFriendDto(friend.Username, friend.AvatarDataUrl);
                }
            }

            return new ChatConversationDto(
                conv.Id, conv.GroupName, conv.GroupImageUrl, conv.CreatedByUserId, conv.CreatedAtUtc,
                messages,
                conv.GroupMembers.Select(m => m.UserId).ToList(),
                directChatFriend);
        }).ToList();
    }

    /// <summary>Verstuurt een event naar een chat.</summary>
    public async Task<bool> SendEventAsync(FriendUser sender, Guid conversationId, string eventId, CancellationToken ct)
    {
        // Check of event bestaat
        if (!await db.Events.AnyAsync(e => e.Id == eventId, ct)) return false;

        // Check of sender lid is
        var isMember = await db.GroupMembers.AnyAsync(m => m.ConversationId == conversationId && m.UserId == sender.Id, ct);
        if (!isMember) return false;

        db.ChatEvents.Add(new ChatEvent
        {
            Id = Guid.NewGuid(),
            SentByUserId = sender.Id,
            EventId = eventId,
            ConversationId = conversationId,
            SentAtUtc = DateTime.UtcNow,
        });

        await db.SaveChangesAsync(ct);
        return true;
    }

    private static string? ValidateGroupImage(string? image)
    {
        if (string.IsNullOrEmpty(image)) return null;
        if (image.Length > 150000) return "Groepsfoto is te groot.";
        // Simpel check voor data-URL format
        if (!image.StartsWith("data:image/")) return "Groepsfoto moet een geldige afbeelding zijn.";
        return null;
    }
}
