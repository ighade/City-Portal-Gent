namespace ParkingGent.Api.Domain;

/// <summary>Een account van de vriendenservice. Los van de beheer-identiteit: dit zijn gewone bezoekers.</summary>
public class FriendUser
{
    public Guid Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    /// <summary>Profielfoto als data-URL (klein, door de browser verkleind).</summary>
    public string? AvatarDataUrl { get; set; }
    /// <summary>Alleen wie dit aanzet deelt zijn locatie met vrienden.</summary>
    public bool ShareLocation { get; set; }
    /// <summary>Toon de locaties van vrienden op de routekaart.</summary>
    public bool ShowFriendsOnMap { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    /// <summary>Het laatste moment waarop de locatie doorgegeven werd; daaruit volgt "x minuten geleden".</summary>
    public DateTime? LocationAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; }
}

/// <summary>Een vriendschapsverzoek; pas na het aanvaarden is het een vriendschap (in beide richtingen).</summary>
public class FriendLink
{
    public Guid RequesterId { get; set; }
    public Guid AddresseeId { get; set; }
    public bool Accepted { get; set; }
    public DateTime CreatedAtUtc { get; set; }
}

public class FriendInterest
{
    public Guid UserId { get; set; }
    public string EventId { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
}

/// <summary>Een aanmeldsessie. Alleen de hash van het token staat in de databank.</summary>
public class FriendSession
{
    public string TokenHash { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
}
