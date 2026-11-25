namespace ParkingGent.Api.Domain;

/// <summary>Een directe chat of groepschat.</summary>
public class ChatConversation
{
    public Guid Id { get; set; }
    /// <summary>Null voor directe chats, niet-null voor groepschats.</summary>
    public string? GroupName { get; set; }
    /// <summary>Groepsfoto als data-URL (klein, door browser verkleind). Alleen voor groepen.</summary>
    public string? GroupImageUrl { get; set; }
    /// <summary>Wie de groep heeft aangemaakt. Voor directe chats is dit altijd null.</summary>
    public Guid? CreatedByUserId { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    
    public List<ChatMessage> Messages { get; set; } = new();
    public List<GroupMember> GroupMembers { get; set; } = new();
}

/// <summary>Lid van een groepschat.</summary>
public class GroupMember
{
    public Guid ConversationId { get; set; }
    public Guid UserId { get; set; }
    /// <summary>Wie dit lid aan de groep heeft toevoegd.</summary>
    public Guid? AddedByUserId { get; set; }
    public DateTime JoinedAtUtc { get; set; }
    
    public ChatConversation Conversation { get; set; } = null!;
}

/// <summary>Een bericht in een chat.</summary>
public class ChatMessage
{
    public Guid Id { get; set; }
    public Guid ConversationId { get; set; }
    public Guid SentByUserId { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTime SentAtUtc { get; set; }
    
    public ChatConversation Conversation { get; set; } = null!;
}

/// <summary>Een event die naar vrienden of groepen kan worden verzonden.</summary>
public class ChatEvent
{
    public Guid Id { get; set; }
    public Guid SentByUserId { get; set; }
    public string EventId { get; set; } = string.Empty;
    public Guid ConversationId { get; set; }
    public DateTime SentAtUtc { get; set; }
    
    public ChatConversation Conversation { get; set; } = null!;
}
