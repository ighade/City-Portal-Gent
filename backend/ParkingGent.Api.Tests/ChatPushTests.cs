using System.Collections.Concurrent;

namespace ParkingGent.Api.Tests;

public class ChatPushTests(FriendsFactory factory) : IClassFixture<FriendsFactory>
{
    private const string Token = "ExponentPushToken[abcdefghijklmnopqrstuv]";

    private static string NewToken() => $"ExponentPushToken[{Guid.NewGuid():N}]";

    private static async Task<Guid> DirectChat(Person from, Person to)
    {
        var response = await from.PostAsync($"/api/friends/chats/direct/{to.Id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.JsonAsync()).GetProperty("conversationId").GetGuid();
    }

    private static Task<HttpResponseMessage> Register(Person p, string token) =>
        p.Client.PutAsJsonAsync("/api/friends/push-token", new { token });

    private ConcurrentQueue<string> CapturePushes()
    {
        var bodies = new ConcurrentQueue<string>();
        factory.Push.AsyncResponder = async (request, _) =>
        {
            bodies.Enqueue(await request.Content!.ReadAsStringAsync());
            return StubHandler.Respond(HttpStatusCode.OK, new { data = new[] { new { status = "ok" } } });
        };
        return bodies;
    }

    private static async Task<string?> Next(ConcurrentQueue<string> bodies)
    {
        for (var i = 0; i < 50; i++)
        {
            if (bodies.TryDequeue(out var body)) return body;
            await Task.Delay(100);
        }
        return null;
    }

    [Fact]
    public async Task Only_a_signed_in_user_can_register_a_well_formed_push_token()
    {
        var a = await factory.RegisterAsync();

        var anonymous = await factory.NewClient().PutAsJsonAsync("/api/friends/push-token", new { token = Token });
        var malformed = await Register(a, "geen-token");
        var valid = await Register(a, Token);

        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, valid.StatusCode);
    }

    [Fact]
    public async Task A_message_notifies_the_other_member_but_not_the_sender()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        await a.BefriendAsync(b);
        var tokenA = NewToken();
        var tokenB = NewToken();
        await Register(a, tokenA);
        await Register(b, tokenB);
        var chat = await DirectChat(a, b);
        var bodies = CapturePushes();

        var sent = await a.PostAsync($"/api/friends/chats/{chat}/messages", new { content = "Zin om iets te drinken?" });

        Assert.Equal(HttpStatusCode.NoContent, sent.StatusCode);
        var push = await Next(bodies);
        Assert.NotNull(push);
        Assert.Contains(tokenB, push);
        Assert.DoesNotContain(tokenA, push);
        Assert.Contains(a.Username, push);
        Assert.Contains("Zin om iets te drinken?", push);
        Assert.Contains(chat.ToString(), push);
    }

    [Fact]
    public async Task A_removed_token_no_longer_gets_notifications()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        await a.BefriendAsync(b);
        var tokenB = NewToken();
        await Register(b, tokenB);
        await b.PostAsync("/api/friends/push-token/remove", new { token = tokenB });
        var chat = await DirectChat(a, b);
        var bodies = CapturePushes();

        await a.PostAsync($"/api/friends/chats/{chat}/messages", new { content = "Hallo" });

        Assert.Null(await Next(bodies));
    }
}
