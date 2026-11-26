namespace ParkingGent.Api.Services;

/// <summary>
/// "Voorbij" en "nu bezig" worden bij het importeren bewaard en blijven daarna ongewijzigd staan. Een
/// evenement dat bij de import nog bezig was, zou dus eeuwig "nu bezig" blijven. Er is geen einduur
/// bekend; daarom geldt een evenement dat langer dan <see cref="Grace"/> geleden begon als voorbij.
/// </summary>
public static class EventLiveState
{
    /// <summary>Ruim genoeg voor een festival over een weekend.</summary>
    public static readonly TimeSpan Grace = TimeSpan.FromHours(48);

    public static bool IsStale(DateTime? startsAtUtc, DateTime now) =>
        startsAtUtc is { } start && start < now - Grace;

    public static EventDto Normalize(this EventDto e, DateTime now) =>
        IsStale(e.StartsAtUtc, now) ? e with { IsPast = true, IsHappeningNow = false } : e;
}
