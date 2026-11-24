using ParkingGent.Api.Domain;
using ParkingGent.Api.Services;

namespace ParkingGent.Api.Endpoints;

public sealed record RegisterRequest(string? Username, string? Email, string? Password, string? Avatar);
public sealed record LoginRequest(string? Identifier, string? Password);
public sealed record SettingsRequest(bool? ShareLocation, bool? ShowFriendsOnMap, string? Avatar, bool? ClearAvatar);
public sealed record LocationRequest(double Lat, double Lon);
public sealed record FriendRequestBody(string? Username);
public sealed record CreateGroupRequest(string? GroupName, string? GroupImageUrl, List<Guid>? InitialMemberIds);
public sealed record SendMessageRequest(string? Content);
public sealed record AddGroupMemberRequest(string? Username);
public sealed record EventShareRequest(string? EventId);

/// <summary>
/// Eindpunten van de vriendenservice onder <c>/api/friends</c>. Anders dan de rest van de API is
/// hier alles persoonlijk: behalve registreren en aanmelden vraagt elk eindpunt een geldige sessie.
/// </summary>
public static class FriendsApi
{
    public static void MapFriendsApi(this WebApplication app)
    {
        var g = app.MapGroup("/api/friends");

        g.MapPost("/register", Register);
        g.MapPost("/login", Login);
        g.MapPost("/logout", Logout);

        g.MapGet("/me", Authed(async (FriendUser me, Friends f, CancellationToken ct) =>
            Results.Ok(new { user = Friends.ToMe(me), interests = await f.MyInterestsAsync(me, ct) })));
        g.MapPut("/me", Authed<SettingsRequest>(Settings));
        g.MapPost("/location", Authed(async (FriendUser me, Friends f, LocationRequest body, CancellationToken ct) =>
            await f.SetLocationAsync(me, body.Lat, body.Lon, ct) ? Results.NoContent() : Results.BadRequest(new { error = "Locatie delen staat uit of de locatie is ongeldig." })));
        g.MapGet("/overview", Authed(async (FriendUser me, Friends f, CancellationToken ct) =>
            Results.Ok(await f.OverviewAsync(me, ct))));

        g.MapPost("/requests", Authed(async (FriendUser me, Friends f, FriendRequestBody body, CancellationToken ct) =>
        {
            var error = await f.RequestAsync(me, body.Username, ct);
            return error is null ? Results.NoContent() : Results.BadRequest(new { error });
        }));
        g.MapPost("/requests/{id:guid}/accept", AuthedRoute("id", async (me, f, raw, ct) =>
            Guid.TryParse(raw, out var id) && await f.AcceptAsync(me, id, ct) ? Results.NoContent() : Results.NotFound(new { error = "Dat verzoek bestaat niet." })));
        g.MapDelete("/{id:guid}", AuthedRoute("id", async (me, f, raw, ct) =>
        {
            if (Guid.TryParse(raw, out var id)) await f.RemoveAsync(me, id, ct);
            return Results.NoContent();
        }));

        g.MapPut("/interests/{eventId}", AuthedRoute("eventId", async (me, f, eventId, ct) =>
            await f.AddInterestAsync(me, eventId, ct) ? Results.NoContent() : Results.NotFound(new { error = "Dat evenement kennen we niet." })));
        g.MapDelete("/interests/{eventId}", AuthedRoute("eventId", async (me, f, eventId, ct) =>
        {
            await f.RemoveInterestAsync(me, eventId, ct);
            return Results.NoContent();
        }));

        // Chat endpoints
        g.MapGet("/chats", AuthedChat(async (FriendUser me, Chat c, CancellationToken ct) =>
            Results.Ok(await c.GetConversationsAsync(me, ct))));
        
        g.MapGet("/chats/{conversationId:guid}", AuthedChat(async (FriendUser me, Chat c, Guid conversationId, CancellationToken ct) =>
        {
            var conv = await c.GetConversationAsync(me, conversationId, ct);
            return conv is not null
                ? Results.Ok(conv)
                : Results.NotFound(new { error = "Dat gesprek bestaat niet of je bent er geen lid van." });
        }));
        
        g.MapPost("/chats/direct/{friendId:guid}", AuthedChat(async (FriendUser me, Chat c, Guid friendId, CancellationToken ct) =>
            Results.Ok(new { conversationId = await c.GetOrCreateDirectConversationAsync(me.Id, friendId, ct) })));
        
        g.MapPost("/chats/group", AuthedChat<CreateGroupRequest>(CreateGroupChat));
        
        g.MapPost("/chats/{conversationId:guid}/messages", AuthedChat<SendMessageRequest>(SendChatMessage));
        
        g.MapPost("/chats/{conversationId:guid}/members", AuthedChat<AddGroupMemberRequest>(AddChatMember));
        
        g.MapDelete("/chats/{conversationId:guid}/members/{memberId:guid}", 
            AuthedChat(async (FriendUser me, Chat c, Guid conversationId, Guid memberId, CancellationToken ct) =>
                await c.RemoveGroupMemberAsync(me, conversationId, memberId, ct)
                    ? Results.NoContent()
                    : Results.BadRequest(new { error = "Kan lid niet verwijderen." })));
        
        g.MapDelete("/chats/{conversationId:guid}", AuthedChat(async (FriendUser me, Chat c, Guid conversationId, CancellationToken ct) =>
            await c.DeleteGroupAsync(me, conversationId, ct)
                ? Results.NoContent()
                : Results.BadRequest(new { error = "Kan groep niet verwijderen." })));
        
        g.MapPost("/chats/{conversationId:guid}/events", AuthedChat<EventShareRequest>(ShareChatEvent));
    }

    /// <summary>Verpakt een eindpunt zodat het alleen met een geldige sessie draait; anders 401.</summary>
    private static Delegate Authed<T1>(Func<FriendUser, Friends, T1, CancellationToken, Task<IResult>> inner)
        => async (HttpContext ctx, Friends f, T1 a, CancellationToken ct) =>
        {
            var me = await f.ResolveAsync(ctx.Request.Cookies[Friends.CookieName], ct);
            return me is null ? Unauthorized() : await inner(me, f, a, ct);
        };

    private static Delegate Authed<T1>(Func<FriendUser, Chat, T1, CancellationToken, Task<IResult>> inner)
        => async (HttpContext ctx, Chat c, T1 a, CancellationToken ct) =>
        {
            var f = ctx.RequestServices.GetRequiredService<Friends>();
            var me = await f.ResolveAsync(ctx.Request.Cookies[Friends.CookieName], ct);
            return me is null ? Unauthorized() : await inner(me, c, a, ct);
        };

    private static Delegate Authed(Func<FriendUser, Chat, CancellationToken, Task<IResult>> inner)
        => async (HttpContext ctx, Chat c, CancellationToken ct) =>
        {
            var f = ctx.RequestServices.GetRequiredService<Friends>();
            var me = await f.ResolveAsync(ctx.Request.Cookies[Friends.CookieName], ct);
            return me is null ? Unauthorized() : await inner(me, c, ct);
        };

    private static Delegate Authed(Func<FriendUser, Chat, Guid, Guid, CancellationToken, Task<IResult>> inner)
        => async (HttpContext ctx, Chat c, Guid a, Guid b, CancellationToken ct) =>
        {
            var f = ctx.RequestServices.GetRequiredService<Friends>();
            var me = await f.ResolveAsync(ctx.Request.Cookies[Friends.CookieName], ct);
            return me is null ? Unauthorized() : await inner(me, c, a, b, ct);
        };

    private static Delegate Authed<T1>(Func<FriendUser, Chat, Guid, T1, CancellationToken, Task<IResult>> inner)
        => async (HttpContext ctx, Chat c, Guid id, T1 a, CancellationToken ct) =>
        {
            var f = ctx.RequestServices.GetRequiredService<Friends>();
            var me = await f.ResolveAsync(ctx.Request.Cookies[Friends.CookieName], ct);
            return me is null ? Unauthorized() : await inner(me, c, id, a, ct);
        };

    /// <summary>Zoals <c>Authed</c>, met één routewaarde als tekst (een lambda kent zijn parameternaam niet voor de binding).</summary>
    private static Delegate AuthedRoute(string name, Func<FriendUser, Friends, string, CancellationToken, Task<IResult>> inner)
        => async (HttpContext ctx, Friends f, CancellationToken ct) =>
        {
            var me = await f.ResolveAsync(ctx.Request.Cookies[Friends.CookieName], ct);
            return me is null ? Unauthorized() : await inner(me, f, ctx.Request.RouteValues[name]?.ToString() ?? "", ct);
        };

    private static Delegate Authed(Func<FriendUser, Friends, CancellationToken, Task<IResult>> inner)
        => async (HttpContext ctx, Friends f, CancellationToken ct) =>
        {
            var me = await f.ResolveAsync(ctx.Request.Cookies[Friends.CookieName], ct);
            return me is null ? Unauthorized() : await inner(me, f, ct);
        };

    private static Delegate Authed<T1, T2>(Func<FriendUser, Friends, T1, T2, CancellationToken, Task<IResult>> inner)
        => async (HttpContext ctx, Friends f, T1 a, T2 b, CancellationToken ct) =>
        {
            var me = await f.ResolveAsync(ctx.Request.Cookies[Friends.CookieName], ct);
            return me is null ? Unauthorized() : await inner(me, f, a, b, ct);
        };

    private static IResult Unauthorized() => Results.Json(new { error = "Meld je eerst aan." }, statusCode: StatusCodes.Status401Unauthorized);

    private static void SetCookie(HttpContext ctx, string token) =>
        ctx.Response.Cookies.Append(Friends.CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = ctx.Request.IsHttps,
            Expires = DateTimeOffset.UtcNow + Friends.SessionLifetime,
            Path = "/",
        });

    private static async Task<IResult> Register(HttpContext ctx, Friends f, RegisterRequest body, CancellationToken ct)
    {
        var (user, error) = await f.RegisterAsync(body.Username, body.Email, body.Password, body.Avatar, ct);
        if (user is null) return Results.BadRequest(new { error });
        SetCookie(ctx, await f.CreateSessionAsync(user.Id, ct));
        return Results.Ok(new { user = Friends.ToMe(user), interests = Array.Empty<string>() });
    }

    private static async Task<IResult> Login(HttpContext ctx, Friends f, LoginRequest body, CancellationToken ct)
    {
        var (user, error) = await f.LoginAsync(body.Identifier, body.Password, ct);
        if (user is null) return Results.Json(new { error }, statusCode: StatusCodes.Status401Unauthorized);
        SetCookie(ctx, await f.CreateSessionAsync(user.Id, ct));
        return Results.Ok(new { user = Friends.ToMe(user), interests = await f.MyInterestsAsync(user, ct) });
    }

    private static async Task<IResult> Logout(HttpContext ctx, Friends f, CancellationToken ct)
    {
        await f.LogoutAsync(ctx.Request.Cookies[Friends.CookieName], ct);
        ctx.Response.Cookies.Delete(Friends.CookieName, new CookieOptions { Path = "/" });
        return Results.NoContent();
    }

    private static async Task<IResult> Settings(FriendUser me, Friends f, SettingsRequest body, CancellationToken ct)
    {
        var avatarProvided = body.Avatar is not null || body.ClearAvatar == true;
        var error = await f.UpdateSettingsAsync(me, body.ShareLocation, body.ShowFriendsOnMap, body.Avatar, avatarProvided, ct);
        return error is null ? Results.Ok(Friends.ToMe(me)) : Results.BadRequest(new { error });
    }

    private static async Task<IResult> CreateGroupChat(FriendUser me, Chat c, CreateGroupRequest body, CancellationToken ct)
    {
        var groupId = await c.CreateGroupAsync(me, body.GroupName, body.GroupImageUrl, body.InitialMemberIds, ct);
        return groupId == Guid.Empty
            ? Results.BadRequest(new { error = "Groepsnaam is verplicht en moet tussen 1 en 200 tekens zijn." })
            : Results.Ok(new { conversationId = groupId });
    }

    private static async Task<IResult> SendChatMessage(FriendUser me, Chat c, Guid conversationId, SendMessageRequest body, CancellationToken ct)
    {
        return await c.SendMessageAsync(me, conversationId, body.Content ?? "", ct)
            ? Results.NoContent()
            : Results.BadRequest(new { error = "Bericht moet tussen 1 en 2000 tekens zijn." });
    }

    private static async Task<IResult> AddChatMember(FriendUser me, Chat c, Guid conversationId, AddGroupMemberRequest body, CancellationToken ct)
    {
        return await c.AddGroupMemberAsync(me, conversationId, body.Username ?? "", ct)
            ? Results.NoContent()
            : Results.BadRequest(new { error = "Kan deze gebruiker niet toevoegen aan de groep." });
    }

    private static async Task<IResult> ShareChatEvent(FriendUser me, Chat c, Guid conversationId, EventShareRequest body, CancellationToken ct)
    {
        return await c.SendEventAsync(me, conversationId, body.EventId ?? "", ct)
            ? Results.NoContent()
            : Results.BadRequest(new { error = "Kan dit evenement niet delen." });
    }
