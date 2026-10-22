using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ParkingGent.Api.Data;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

public sealed record MeDto(Guid Id, string Username, string Email, string? Avatar, bool ShareLocation, bool ShowFriendsOnMap);

public sealed record FriendDto(
    Guid Id, string Username, string? Avatar, double? Lat, double? Lon,
    DateTime? LocationAtUtc, int? LocationAgeSeconds, bool Online, List<string> EventIds);

public sealed record FriendEventDto(
    string Id, string Name, string? CoverImageUrl, string? DayTimeLabel, DateTime? StartsAtUtc,
    string? Place, List<Guid> FriendIds);

public sealed record PendingDto(Guid Id, string Username, string? Avatar);

public sealed record OverviewDto(
    List<FriendDto> Friends, List<FriendEventDto> Events, List<PendingDto> Incoming, List<PendingDto> Outgoing);

/// <summary>Een mislukte-aanmeldingenteller per gebruikersnaam: vijf missers, dan vijf minuten stilte.</summary>
public sealed class LoginThrottle
{
    private const int MaxFailures = 5;
    private static readonly TimeSpan Lockout = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, (int Count, DateTime Until)> _state = new();

    public bool IsLocked(string key) =>
        _state.TryGetValue(key, out var s) && s.Count >= MaxFailures && s.Until > DateTime.UtcNow;

    public void Fail(string key) => _state.AddOrUpdate(
        key,
        _ => (1, DateTime.UtcNow + Lockout),
        (_, s) => s.Until <= DateTime.UtcNow ? (1, DateTime.UtcNow + Lockout) : (s.Count + 1, DateTime.UtcNow + Lockout));

    public void Reset(string key) => _state.TryRemove(key, out _);
}

/// <summary>
/// De vriendenservice: accounts, aanmeldsessies, vriendschappen, locaties en interesses.
/// Alles hier draait op de eigen tabellen (Friend*) en raakt de parkeerdata niet.
/// </summary>
public sealed partial class Friends(AppDbContext db, LoginThrottle throttle)
{
    public const string CookieName = "pg_friends";
    public static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(30);
    /// <summary>Een locatie die ouder is dan dit geldt als "niet meer verbonden".</summary>
    public static readonly TimeSpan OnlineWindow = TimeSpan.FromMinutes(2);

    [GeneratedRegex(@"^[A-Za-z0-9_.-]{3,30}$")]
    private static partial Regex UsernameRx();

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailRx();

    [GeneratedRegex(@"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$")]
    private static partial Regex AvatarRx();

    public static MeDto ToMe(FriendUser u) => new(u.Id, u.Username, u.Email, u.AvatarDataUrl, u.ShareLocation, u.ShowFriendsOnMap);

    // ---------- accounts ----------

    public async Task<(FriendUser? User, string? Error)> RegisterAsync(
        string? username, string? email, string? password, string? avatar, CancellationToken ct)
    {
        username = username?.Trim() ?? "";
        email = email?.Trim().ToLowerInvariant() ?? "";
        if (!UsernameRx().IsMatch(username)) return (null, "Kies een gebruikersnaam van 3 tot 30 tekens (letters, cijfers, . _ -).");
        if (email.Length > 200 || !EmailRx().IsMatch(email)) return (null, "Dat e-mailadres klopt niet.");
        if (password is null || password.Length < 8 || password.Length > 200) return (null, "Een wachtwoord heeft minstens 8 tekens nodig.");
        var avatarError = ValidateAvatar(avatar);
        if (avatarError is not null) return (null, avatarError);

        var lowered = username.ToLowerInvariant();
        var taken = await db.FriendUsers.AnyAsync(u => u.Username.ToLower() == lowered || u.Email == email, ct);
        if (taken) return (null, "Die gebruikersnaam of dat e-mailadres is al in gebruik.");

        var user = new FriendUser
        {
            Id = Guid.NewGuid(),
            Username = username,
            Email = email,
            PasswordHash = HashPassword(password),
            AvatarDataUrl = string.IsNullOrEmpty(avatar) ? null : avatar,
            CreatedAtUtc = DateTime.UtcNow,
        };
        db.FriendUsers.Add(user);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return (null, "Die gebruikersnaam of dat e-mailadres is al in gebruik.");
        }
        return (user, null);
    }

    /// <summary>Aanmelden met gebruikersnaam of e-mailadres. Elke mislukking geeft hetzelfde antwoord.</summary>
    public async Task<(FriendUser? User, string? Error)> LoginAsync(string? identifier, string? password, CancellationToken ct)
    {
        var key = (identifier ?? "").Trim().ToLowerInvariant();
        if (key.Length == 0 || key.Length > 200 || string.IsNullOrEmpty(password) || password.Length > 200)
            return (null, "Gebruikersnaam of wachtwoord klopt niet.");
        if (throttle.IsLocked(key)) return (null, "Te veel pogingen. Probeer het over enkele minuten opnieuw.");

        var user = await db.FriendUsers.FirstOrDefaultAsync(u => u.Username.ToLower() == key || u.Email == key, ct);
        if (user is null || !VerifyPassword(password, user.PasswordHash))
        {
            throttle.Fail(key);
            return (null, "Gebruikersnaam of wachtwoord klopt niet.");
        }
        throttle.Reset(key);
        return (user, null);
    }

    public async Task<string> CreateSessionAsync(Guid userId, CancellationToken ct)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        db.FriendSessions.Add(new FriendSession
        {
            TokenHash = Sha256(token),
            UserId = userId,
            ExpiresAtUtc = DateTime.UtcNow + SessionLifetime,
        });
        // Verlopen sessies opruimen kost hier niets extra en voorkomt een groeiende tabel.
        await db.FriendSessions.Where(s => s.ExpiresAtUtc < DateTime.UtcNow).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct);
        return token;
    }

    public async Task<FriendUser?> ResolveAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token) || token.Length != 64) return null;
        var hash = Sha256(token);
        var now = DateTime.UtcNow;
        return await db.FriendSessions
            .Where(s => s.TokenHash == hash && s.ExpiresAtUtc > now)
            .Join(db.FriendUsers, s => s.UserId, u => u.Id, (_, u) => u)
            .FirstOrDefaultAsync(ct);
    }

    public async Task LogoutAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token)) return;
        var hash = Sha256(token);
        await db.FriendSessions.Where(s => s.TokenHash == hash).ExecuteDeleteAsync(ct);
    }

    public async Task<string?> UpdateSettingsAsync(
        FriendUser user, bool? shareLocation, bool? showFriendsOnMap, string? avatar, bool avatarProvided, CancellationToken ct)
    {
        if (avatarProvided)
        {
            var error = ValidateAvatar(avatar);
            if (error is not null) return error;
            user.AvatarDataUrl = string.IsNullOrEmpty(avatar) ? null : avatar;
        }
        if (shareLocation is { } share)
        {
            user.ShareLocation = share;
            if (!share)
            {
                user.Latitude = null;
                user.Longitude = null;
                user.LocationAtUtc = null;
            }
        }
        if (showFriendsOnMap is { } show) user.ShowFriendsOnMap = show;
        db.FriendUsers.Update(user);
        await db.SaveChangesAsync(ct);
        return null;
    }

    public async Task<bool> SetLocationAsync(FriendUser user, double lat, double lon, CancellationToken ct)
    {
        if (!user.ShareLocation || lat is < -90 or > 90 || lon is < -180 or > 180
            || double.IsNaN(lat) || double.IsNaN(lon)) return false;
        user.Latitude = lat;
        user.Longitude = lon;
        user.LocationAtUtc = DateTime.UtcNow;
        db.FriendUsers.Update(user);
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ---------- vrienden ----------

    public async Task<string?> RequestAsync(FriendUser me, string? username, CancellationToken ct)
    {
        var name = (username ?? "").Trim().ToLowerInvariant();
        var other = await db.FriendUsers.FirstOrDefaultAsync(u => u.Username.ToLower() == name, ct);
        if (other is null) return "Die gebruiker bestaat niet.";
        if (other.Id == me.Id) return "Je kunt jezelf niet toevoegen.";

        var existing = await db.FriendLinks.FirstOrDefaultAsync(l =>
            (l.RequesterId == me.Id && l.AddresseeId == other.Id) ||
            (l.RequesterId == other.Id && l.AddresseeId == me.Id), ct);
        if (existing is not null)
        {
            if (existing.Accepted) return "Jullie zijn al vrienden.";
            // Wie een verzoek terugstuurt naar iemand die jou al toevoegde, bevestigt het.
            if (existing.AddresseeId == me.Id) existing.Accepted = true;
            else return "Je verzoek staat al open.";
        }
        else
        {
            db.FriendLinks.Add(new FriendLink { RequesterId = me.Id, AddresseeId = other.Id, CreatedAtUtc = DateTime.UtcNow });
        }
        await db.SaveChangesAsync(ct);
        return null;
    }

    public async Task<bool> AcceptAsync(FriendUser me, Guid requesterId, CancellationToken ct)
    {
        var link = await db.FriendLinks.FirstOrDefaultAsync(l => l.RequesterId == requesterId && l.AddresseeId == me.Id, ct);
        if (link is null) return false;
        link.Accepted = true;
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>Weigert een verzoek, trekt een eigen verzoek in, of beëindigt een vriendschap.</summary>
    public async Task RemoveAsync(FriendUser me, Guid otherId, CancellationToken ct)
        => await db.FriendLinks
            .Where(l => (l.RequesterId == me.Id && l.AddresseeId == otherId) ||
                        (l.RequesterId == otherId && l.AddresseeId == me.Id))
            .ExecuteDeleteAsync(ct);

    public async Task<bool> AddInterestAsync(FriendUser me, string eventId, CancellationToken ct)
    {
        if (!await db.Events.AnyAsync(e => e.Id == eventId, ct)) return false;
        if (!await db.FriendInterests.AnyAsync(i => i.UserId == me.Id && i.EventId == eventId, ct))
        {
            db.FriendInterests.Add(new FriendInterest { UserId = me.Id, EventId = eventId, CreatedAtUtc = DateTime.UtcNow });
            await db.SaveChangesAsync(ct);
        }
        return true;
    }

    public Task RemoveInterestAsync(FriendUser me, string eventId, CancellationToken ct)
        => db.FriendInterests.Where(i => i.UserId == me.Id && i.EventId == eventId).ExecuteDeleteAsync(ct);

    public async Task<List<string>> MyInterestsAsync(FriendUser me, CancellationToken ct)
        => await db.FriendInterests.Where(i => i.UserId == me.Id).Select(i => i.EventId).ToListAsync(ct);

    public async Task<OverviewDto> OverviewAsync(FriendUser me, CancellationToken ct)
    {
        var links = await db.FriendLinks
            .Where(l => l.RequesterId == me.Id || l.AddresseeId == me.Id)
            .AsNoTracking().ToListAsync(ct);

        var friendIds = links.Where(l => l.Accepted)
            .Select(l => l.RequesterId == me.Id ? l.AddresseeId : l.RequesterId).ToList();
        var incomingIds = links.Where(l => !l.Accepted && l.AddresseeId == me.Id).Select(l => l.RequesterId).ToList();
        var outgoingIds = links.Where(l => !l.Accepted && l.RequesterId == me.Id).Select(l => l.AddresseeId).ToList();

        var users = await db.FriendUsers
            .Where(u => friendIds.Contains(u.Id) || incomingIds.Contains(u.Id) || outgoingIds.Contains(u.Id))
            .AsNoTracking().ToListAsync(ct);
        var byId = users.ToDictionary(u => u.Id);

        var interests = await db.FriendInterests
            .Where(i => friendIds.Contains(i.UserId)).AsNoTracking().ToListAsync(ct);

        var eventIds = interests.Select(i => i.EventId).Distinct().ToList();
        var events = await db.Events
            .Include(e => e.Place)
            .Where(e => eventIds.Contains(e.Id) && !e.IsPast)
            .AsNoTracking().ToListAsync(ct);
        var liveEventIds = events.Select(e => e.Id).ToHashSet();

        var now = DateTime.UtcNow;
        var friends = friendIds.Where(byId.ContainsKey).Select(id =>
        {
            var u = byId[id];
            var hasLocation = u.ShareLocation && u.Latitude is not null && u.Longitude is not null && u.LocationAtUtc is not null;
            var age = hasLocation ? (int?)Math.Max(0, (int)(now - u.LocationAtUtc!.Value).TotalSeconds) : null;
            return new FriendDto(
                u.Id, u.Username, u.AvatarDataUrl,
                hasLocation ? u.Latitude : null, hasLocation ? u.Longitude : null,
                hasLocation ? u.LocationAtUtc : null, age,
                age is { } a && a <= OnlineWindow.TotalSeconds,
                interests.Where(i => i.UserId == id && liveEventIds.Contains(i.EventId)).Select(i => i.EventId).ToList());
        }).OrderBy(f => f.Username, StringComparer.OrdinalIgnoreCase).ToList();

        var eventDtos = events
            .OrderBy(e => e.StartsAtUtc ?? DateTime.MaxValue)
            .Select(e => new FriendEventDto(
                e.Id, e.Name, e.CoverImageUrl, e.DayTimeLabel, e.StartsAtUtc, e.Place?.Name,
                interests.Where(i => i.EventId == e.Id).Select(i => i.UserId).ToList()))
            .ToList();

        PendingDto Pending(Guid id) => new(id, byId[id].Username, byId[id].AvatarDataUrl);
        return new OverviewDto(
            friends, eventDtos,
            incomingIds.Where(byId.ContainsKey).Select(Pending).ToList(),
            outgoingIds.Where(byId.ContainsKey).Select(Pending).ToList());
    }

    // ---------- hulpfuncties ----------

    private static string? ValidateAvatar(string? avatar)
    {
        if (string.IsNullOrEmpty(avatar)) return null;
        if (avatar.Length > 100_000 || !AvatarRx().IsMatch(avatar)) return "Die profielfoto is ongeldig of te groot.";
        return null;
    }

    private static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private const int Iterations = 210_000;

    private static string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"v1.{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    private static bool VerifyPassword(string password, string stored)
    {
        var parts = stored.Split('.');
        if (parts.Length != 4 || parts[0] != "v1" || !int.TryParse(parts[1], out var iterations)) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
