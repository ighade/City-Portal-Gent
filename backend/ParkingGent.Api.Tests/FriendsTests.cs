namespace ParkingGent.Api.Tests;

public class FriendsFactory : SeededFactory;

internal static class Friendly
{
    private static int counter;
    public const string Password = "wachtwoord123";
    public const string Png = "data:image/png;base64,iVBORw0KGgo=";

    public static string Unique(string prefix = "u") => $"{prefix}{Interlocked.Increment(ref counter)}_{Guid.NewGuid():N}"[..20];

    public static async Task<Person> RegisterAsync(this ApiFactory factory, string? username = null)
    {
        username ??= Unique();
        var client = factory.NewClient();
        var response = await client.PostAsJsonAsync("/api/friends/register",
            new { username, email = $"{username}@example.be", password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var token = TokenFrom(response)!;
        client.DefaultRequestHeaders.Add("Cookie", $"pg_friends={token}");
        var user = (await response.JsonAsync()).GetProperty("user");
        return new Person(client, username, user.GetProperty("id").GetGuid(), token);
    }

    public static string? TokenFrom(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.Select(v => v.Split(';')[0]).FirstOrDefault(v => v.StartsWith("pg_friends="))?["pg_friends=".Length..]
            : null;
}

internal record Person(HttpClient Client, string Username, Guid Id, string Token)
{
    public Task<HttpResponseMessage> PostAsync(string url, object? body = null) => Client.PostAsJsonAsync(url, body ?? new { });
    public async Task<JsonElement> OverviewAsync() => await (await Client.GetAsync("/api/friends/overview")).JsonAsync();
    public Task<HttpResponseMessage> RequestAsync(Person other) => PostAsync("/api/friends/requests", new { username = other.Username });
    public Task<HttpResponseMessage> AcceptAsync(Guid requestId) => PostAsync($"/api/friends/requests/{requestId}/accept");

    public async Task BefriendAsync(Person other)
    {
        Assert.Equal(HttpStatusCode.NoContent, (await RequestAsync(other)).StatusCode);
        var incoming = (await other.OverviewAsync()).GetProperty("incoming")[0].GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NoContent, (await other.AcceptAsync(incoming)).StatusCode);
    }
}

public class FriendsAuthTests(FriendsFactory factory) : IClassFixture<FriendsFactory>
{
    private Task<HttpResponseMessage> Register(object body) => factory.NewClient().PostAsJsonAsync("/api/friends/register", body);

    private static object Valid(string? username = null, string? email = null, string? password = null, string? avatar = null)
    {
        var u = username ?? Friendly.Unique();
        return new { username = u, email = email ?? $"{u}@example.be", password = password ?? Friendly.Password, avatar };
    }

    [Fact]
    public async Task Register_creates_an_account_and_signs_in_with_a_secure_cookie()
    {
        var name = Friendly.Unique();
        var response = await Register(new { username = name, email = $"  {name.ToUpperInvariant()}@Example.BE ", password = Friendly.Password, avatar = Friendly.Png });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Equal(name, body.GetProperty("user").GetProperty("username").GetString());
        Assert.Equal($"{name}@example.be", body.GetProperty("user").GetProperty("email").GetString());
        Assert.Equal(Friendly.Png, body.GetProperty("user").GetProperty("avatar").GetString());
        Assert.Empty(body.GetProperty("interests").EnumerateArray());

        var cookie = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("pg_friends="));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(64, Friendly.TokenFrom(response)!.Length);
    }

    [Theory]
    [InlineData("ab")]                                  // te kort
    [InlineData("abcdefghijklmnopqrstuvwxyzabcde")]     // 31 tekens
    [InlineData("met spatie")]
    [InlineData("emoji😀x")]
    [InlineData("a@b.c")]
    [InlineData("")]
    [InlineData(null)]
    public async Task Register_rejects_bad_usernames(string? username)
    {
        var response = await Register(new { username, email = $"{Friendly.Unique()}@example.be", password = Friendly.Password });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.False(string.IsNullOrEmpty((await response.JsonAsync()).GetProperty("error").GetString()));
    }

    [Theory]
    [InlineData(3)]
    [InlineData(30)]
    public async Task Register_accepts_boundary_username_lengths(int length)
    {
        var name = Guid.NewGuid().ToString("N")[..length].PadRight(length, 'x');
        var response = await Register(new { username = name, email = $"{Guid.NewGuid():N}@example.be", password = Friendly.Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("geen-apenstaart")]
    [InlineData("a@b")]
    [InlineData("a@b.")]
    [InlineData("@b.be")]
    [InlineData("a b@c.be")]
    [InlineData("")]
    [InlineData(null)]
    public async Task Register_rejects_bad_emails(string? email)
    {
        var response = await Register(new { username = Friendly.Unique(), email, password = Friendly.Password });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_rejects_an_email_longer_than_200_characters()
    {
        var response = await Register(new { username = Friendly.Unique(), email = new string('a', 196) + "@x.be", password = Friendly.Password });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData(7)]
    [InlineData(201)]
    [InlineData(0)]
    public async Task Register_rejects_passwords_outside_8_to_200(int length)
    {
        var response = await Register(Valid(password: new string('p', length)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData(8)]
    [InlineData(200)]
    public async Task Register_accepts_password_boundaries(int length)
    {
        var response = await Register(Valid(password: new string('p', length)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("niet-een-afbeelding")]
    [InlineData("data:text/html;base64,PGI+")]
    [InlineData("data:image/gif;base64,R0lGOD==")]
    [InlineData("data:image/png;base64,###")]
    [InlineData("javascript:alert(1)")]
    public async Task Register_rejects_invalid_avatars(string avatar)
    {
        var response = await Register(Valid(avatar: avatar));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("profielfoto", (await response.JsonAsync()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Register_rejects_an_avatar_above_100k_characters()
    {
        var response = await Register(Valid(avatar: "data:image/png;base64," + new string('A', 100_001)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("jpeg")]
    [InlineData("webp")]
    public async Task Register_accepts_jpeg_and_webp_avatars(string type)
    {
        var response = await Register(Valid(avatar: $"data:image/{type};base64,AAAA"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Register_rejects_duplicate_usernames_and_emails()
    {
        var name = Friendly.Unique();
        Assert.Equal(HttpStatusCode.OK, (await Register(Valid(name))).StatusCode);

        var sameNameOtherCase = await Register(Valid(name.ToUpperInvariant(), email: $"x{name}@example.be"));
        var sameEmail = await Register(Valid(Friendly.Unique(), email: $"{name}@EXAMPLE.be"));

        Assert.Equal(HttpStatusCode.BadRequest, sameNameOtherCase.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, sameEmail.StatusCode);
    }

    [Fact]
    public async Task Register_with_an_empty_or_malformed_body_is_a_client_error()
    {
        var client = factory.NewClient();

        var empty = await client.PostAsync("/api/friends/register", new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        var broken = await client.PostAsync("/api/friends/register", new StringContent("{nope", System.Text.Encoding.UTF8, "application/json"));
        var wrongType = await client.PostAsync("/api/friends/register", new StringContent("x", System.Text.Encoding.UTF8, "text/plain"));

        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, broken.StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, wrongType.StatusCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Login_works_with_username_or_email(bool byEmail)
    {
        var name = Friendly.Unique();
        await factory.RegisterAsync(name);

        var response = await factory.NewClient().PostAsJsonAsync("/api/friends/login",
            new { identifier = byEmail ? $"{name.ToUpperInvariant()}@example.be" : name, password = Friendly.Password });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(64, Friendly.TokenFrom(response)!.Length);
        Assert.Equal(name, (await response.JsonAsync()).GetProperty("user").GetProperty("username").GetString());
    }

    [Theory]
    [InlineData("wrong", true)]
    [InlineData("", true)]
    [InlineData(null, true)]
    [InlineData("wachtwoord123", false)] // bestaande wachtwoord, onbekende gebruiker
    public async Task Login_fails_with_401_for_wrong_credentials(string? password, bool knownUser)
    {
        var name = Friendly.Unique();
        await factory.RegisterAsync(name);

        var response = await factory.NewClient().PostAsJsonAsync("/api/friends/login",
            new { identifier = knownUser ? name : "bestaat-niet-" + name, password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Null(Friendly.TokenFrom(response));
    }

    [Fact]
    public async Task Login_with_an_empty_identifier_is_refused()
    {
        var response = await factory.NewClient().PostAsJsonAsync("/api/friends/login", new { identifier = "", password = Friendly.Password });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Five_failed_logins_lock_the_identifier_even_for_the_right_password()
    {
        var name = Friendly.Unique();
        await factory.RegisterAsync(name);
        var client = factory.NewClient();

        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/api/friends/login", new { identifier = name, password = "fout" })).StatusCode);
        var locked = await client.PostAsJsonAsync("/api/friends/login", new { identifier = name, password = Friendly.Password });
        var other = await factory.RegisterAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, locked.StatusCode);
        Assert.Contains("Te veel", (await locked.JsonAsync()).GetProperty("error").GetString());
        Assert.NotNull(other); // een andere gebruiker blijft gewoon werken
    }

    [Fact]
    public async Task Four_failures_do_not_lock_and_a_success_resets_the_count()
    {
        var name = Friendly.Unique();
        await factory.RegisterAsync(name);
        var client = factory.NewClient();

        for (var i = 0; i < 4; i++) await client.PostAsJsonAsync("/api/friends/login", new { identifier = name, password = "fout" });
        var ok = await client.PostAsJsonAsync("/api/friends/login", new { identifier = name, password = Friendly.Password });
        for (var i = 0; i < 4; i++) await client.PostAsJsonAsync("/api/friends/login", new { identifier = name, password = "fout" });
        var stillOk = await client.PostAsJsonAsync("/api/friends/login", new { identifier = name, password = Friendly.Password });

        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(HttpStatusCode.OK, stillOk.StatusCode);
    }

    [Fact]
    public async Task Logout_ends_the_session_and_is_safe_to_repeat()
    {
        var person = await factory.RegisterAsync();

        var first = await person.Client.PostAsync("/api/friends/logout", null);
        var second = await person.Client.PostAsync("/api/friends/logout", null);
        var me = await person.Client.GetAsync("/api/friends/me");
        var anonymous = await factory.NewClient().PostAsync("/api/friends/logout", null);

        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, second.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [Fact]
    public async Task A_second_login_does_not_end_the_first_session()
    {
        var person = await factory.RegisterAsync();
        var login = await factory.NewClient().PostAsJsonAsync("/api/friends/login", new { identifier = person.Username, password = Friendly.Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await person.Client.GetAsync("/api/friends/me")).StatusCode);
    }

    public static IEnumerable<object[]> Protected() =>
    [
        ["GET", "/api/friends/me"],
        ["PUT", "/api/friends/me"],
        ["POST", "/api/friends/location"],
        ["GET", "/api/friends/overview"],
        ["POST", "/api/friends/requests"],
        ["POST", "/api/friends/requests/" + "11111111-1111-1111-1111-111111111111" + "/accept"],
        ["DELETE", "/api/friends/11111111-1111-1111-1111-111111111111"],
        ["PUT", "/api/friends/interests/ev-upcoming"],
        ["DELETE", "/api/friends/interests/ev-upcoming"],
    ];

    [Theory]
    [MemberData(nameof(Protected))]
    public async Task Protected_routes_need_a_valid_session(string method, string url)
    {
        foreach (var cookie in new string?[] { null, "pg_friends=", "pg_friends=korte", "pg_friends=" + new string('0', 64), "pg_friends=" + new string('z', 65) })
        {
            var request = new HttpRequestMessage(new HttpMethod(method), url);
            if (method is "PUT" or "POST") request.Content = JsonContent.Create(new { username = "x", lat = 51, lon = 3 });
            if (cookie is not null) request.With("Cookie", cookie);

            var response = await factory.NewClient().SendAsync(request);

            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal("Meld je eerst aan.", (await response.JsonAsync()).GetProperty("error").GetString());
        }
    }

    [Fact]
    public async Task Me_returns_the_profile_with_default_settings()
    {
        var person = await factory.RegisterAsync();

        var me = await (await person.Client.GetAsync("/api/friends/me")).JsonAsync();

        Assert.Equal(person.Username, me.GetProperty("user").GetProperty("username").GetString());
        Assert.False(me.GetProperty("user").GetProperty("shareLocation").GetBoolean());
        Assert.Equal(person.Id, me.GetProperty("user").GetProperty("id").GetGuid());
    }
}

public class FriendsSettingsTests(FriendsFactory factory) : IClassFixture<FriendsFactory>
{
    private static Task<HttpResponseMessage> Put(Person p, object body) => p.Client.PutAsJsonAsync("/api/friends/me", body);

    [Fact]
    public async Task Settings_update_the_flags_independently()
    {
        var p = await factory.RegisterAsync();

        var shared = await (await Put(p, new { shareLocation = true })).JsonAsync();
        var hidden = await (await Put(p, new { showFriendsOnMap = false })).JsonAsync();
        var untouched = await (await Put(p, new { })).JsonAsync();

        Assert.True(shared.GetProperty("shareLocation").GetBoolean());
        Assert.True(hidden.GetProperty("shareLocation").GetBoolean());
        Assert.False(hidden.GetProperty("showFriendsOnMap").GetBoolean());
        Assert.True(untouched.GetProperty("shareLocation").GetBoolean());
        Assert.False(untouched.GetProperty("showFriendsOnMap").GetBoolean());
    }

    [Fact]
    public async Task Avatar_can_be_set_replaced_and_cleared()
    {
        var p = await factory.RegisterAsync();

        var set = await (await Put(p, new { avatar = Friendly.Png })).JsonAsync();
        var kept = await (await Put(p, new { shareLocation = true })).JsonAsync();
        var cleared = await (await Put(p, new { clearAvatar = true })).JsonAsync();

        Assert.Equal(Friendly.Png, set.GetProperty("avatar").GetString());
        Assert.Equal(Friendly.Png, kept.GetProperty("avatar").GetString());
        Assert.False(cleared.TryGetProperty("avatar", out var a) && a.ValueKind == JsonValueKind.String);
    }

    [Theory]
    [InlineData("geen-afbeelding")]
    [InlineData("data:image/svg+xml;base64,AAAA")]
    public async Task A_bad_avatar_is_refused_and_leaves_the_profile_unchanged(string avatar)
    {
        var p = await factory.RegisterAsync();

        var response = await Put(p, new { avatar, shareLocation = true });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var me = await (await p.Client.GetAsync("/api/friends/me")).JsonAsync();
        Assert.False(me.GetProperty("user").GetProperty("shareLocation").GetBoolean());
    }

    [Theory]
    [InlineData(51.05, 3.72, HttpStatusCode.NoContent)]
    [InlineData(90, 180, HttpStatusCode.NoContent)]
    [InlineData(-90, -180, HttpStatusCode.NoContent)]
    [InlineData(90.0001, 3, HttpStatusCode.BadRequest)]
    [InlineData(-90.0001, 3, HttpStatusCode.BadRequest)]
    [InlineData(51, 180.0001, HttpStatusCode.BadRequest)]
    [InlineData(51, -180.0001, HttpStatusCode.BadRequest)]
    public async Task Location_is_validated_against_world_coordinates(double lat, double lon, HttpStatusCode expected)
    {
        var p = await factory.RegisterAsync();
        await Put(p, new { shareLocation = true });

        var response = await p.PostAsync("/api/friends/location", new { lat, lon });

        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task Location_is_refused_while_sharing_is_off()
    {
        var p = await factory.RegisterAsync();

        var response = await p.PostAsync("/api/friends/location", new { lat = 51.05, lon = 3.72 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Location_with_a_missing_or_malformed_body_is_a_client_error()
    {
        var p = await factory.RegisterAsync();
        await Put(p, new { shareLocation = true });

        var text = await p.Client.PostAsync("/api/friends/location", new StringContent("{\"lat\":\"abc\"}", System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, text.StatusCode);
    }

    [Fact]
    public async Task Location_is_only_visible_to_friends_while_sharing_and_disappears_when_switched_off()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        await a.BefriendAsync(b);
        await Put(a, new { shareLocation = true });
        await a.PostAsync("/api/friends/location", new { lat = 51.05, lon = 3.72 });

        var visible = (await b.OverviewAsync()).GetProperty("friends").EnumerateArray().Single(f => f.GetProperty("id").GetGuid() == a.Id);
        Assert.Equal(51.05, visible.GetProperty("lat").GetDouble(), 5);
        Assert.Equal(3.72, visible.GetProperty("lon").GetDouble(), 5);
        Assert.True(visible.GetProperty("online").GetBoolean());
        Assert.InRange(visible.GetProperty("locationAgeSeconds").GetInt32(), 0, 60);

        await Put(a, new { shareLocation = false });
        var hidden = (await b.OverviewAsync()).GetProperty("friends").EnumerateArray().Single(f => f.GetProperty("id").GetGuid() == a.Id);
        Assert.False(hidden.TryGetProperty("lat", out _));
        Assert.False(hidden.GetProperty("online").GetBoolean());
    }

    [Fact]
    public async Task A_location_older_than_two_minutes_is_not_online()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        await a.BefriendAsync(b);
        await Put(a, new { shareLocation = true });
        await a.PostAsync("/api/friends/location", new { lat = 51.05, lon = 3.72 });
        await factory.WithDbAsync(async db =>
        {
            var user = await db.FriendUsers.FindAsync(a.Id);
            user!.LocationAtUtc = DateTime.UtcNow.AddMinutes(-5);
            await db.SaveChangesAsync();
        });

        var friend = (await b.OverviewAsync()).GetProperty("friends").EnumerateArray().Single();

        Assert.False(friend.GetProperty("online").GetBoolean());
    }
}

public class FriendsSocialTests(FriendsFactory factory) : IClassFixture<FriendsFactory>
{
    private static async Task<HttpResponseMessage> Request(Person from, string username) =>
        await from.PostAsync("/api/friends/requests", new { username });

    private static async Task<string> Error(HttpResponseMessage r) => (await r.JsonAsync()).GetProperty("error").GetString()!;

    [Fact]
    public async Task A_request_shows_up_as_outgoing_for_the_sender_and_incoming_for_the_receiver()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();

        Assert.Equal(HttpStatusCode.NoContent, (await a.RequestAsync(b)).StatusCode);

        var sent = await a.OverviewAsync();
        var received = await b.OverviewAsync();
        Assert.Equal(b.Username, sent.GetProperty("outgoing")[0].GetProperty("username").GetString());
        Assert.Equal(a.Username, received.GetProperty("incoming")[0].GetProperty("username").GetString());
        Assert.Empty(sent.GetProperty("friends").EnumerateArray());
    }

    [Fact]
    public async Task Requests_are_found_regardless_of_username_case_and_padding()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();

        var response = await Request(a, $"  {b.Username.ToUpperInvariant()} ");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Request_edge_cases_are_refused_with_a_message()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();

        var self = await Request(a, a.Username);
        var unknown = await Request(a, "bestaat-niet-" + a.Username);
        var empty = await Request(a, "");
        await a.RequestAsync(b);
        var repeated = await Request(a, b.Username);

        Assert.Equal(HttpStatusCode.BadRequest, self.StatusCode);
        Assert.Equal("Je kunt jezelf niet toevoegen.", await Error(self));
        Assert.Equal("Die gebruiker bestaat niet.", await Error(unknown));
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal("Je verzoek staat al open.", await Error(repeated));
    }

    [Fact]
    public async Task A_request_to_someone_who_already_asked_you_makes_you_friends_at_once()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        await a.RequestAsync(b);

        Assert.Equal(HttpStatusCode.NoContent, (await b.RequestAsync(a)).StatusCode);

        foreach (var (me, other) in new[] { (a, b), (b, a) })
        {
            var overview = await me.OverviewAsync();
            Assert.Equal(other.Id, overview.GetProperty("friends").EnumerateArray().Single().GetProperty("id").GetGuid());
            Assert.Empty(overview.GetProperty("incoming").EnumerateArray());
            Assert.Empty(overview.GetProperty("outgoing").EnumerateArray());
        }
    }

    [Fact]
    public async Task Existing_friends_cannot_be_requested_again()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        await a.BefriendAsync(b);

        var again = await a.RequestAsync(b);
        var reverse = await b.RequestAsync(a);

        Assert.Equal("Jullie zijn al vrienden.", await Error(again));
        Assert.Equal(HttpStatusCode.BadRequest, reverse.StatusCode);
    }

    [Fact]
    public async Task Only_the_receiver_can_accept_and_unknown_ids_are_404()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        var c = await factory.RegisterAsync();
        await a.RequestAsync(b);
        var id = (await b.OverviewAsync()).GetProperty("incoming")[0].GetProperty("id").GetGuid();

        Assert.Equal(HttpStatusCode.NotFound, (await a.AcceptAsync(id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.AcceptAsync(id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.AcceptAsync(Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await b.AcceptAsync(id)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await b.AcceptAsync(id)).StatusCode); // al vrienden: niets te doen
    }

    [Fact]
    public async Task Accept_with_a_malformed_id_does_not_match_a_route()
    {
        var a = await factory.RegisterAsync();

        var response = await a.PostAsync("/api/friends/requests/geen-guid/accept");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Removing_a_friend_works_for_both_sides_and_is_idempotent()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        await a.BefriendAsync(b);

        var removed = await a.Client.DeleteAsync($"/api/friends/{b.Id}");
        var again = await a.Client.DeleteAsync($"/api/friends/{b.Id}");
        var unknown = await a.Client.DeleteAsync($"/api/friends/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, unknown.StatusCode);
        Assert.Empty((await a.OverviewAsync()).GetProperty("friends").EnumerateArray());
        Assert.Empty((await b.OverviewAsync()).GetProperty("friends").EnumerateArray());
    }

    [Fact]
    public async Task Removing_a_pending_request_cancels_it_and_a_stranger_cannot_remove_it()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        var c = await factory.RegisterAsync();
        await a.RequestAsync(b);
        var id = (await b.OverviewAsync()).GetProperty("incoming")[0].GetProperty("id").GetGuid();

        await c.Client.DeleteAsync($"/api/friends/{id}");
        Assert.Single((await b.OverviewAsync()).GetProperty("incoming").EnumerateArray());

        await b.Client.DeleteAsync($"/api/friends/{id}");
        Assert.Empty((await b.OverviewAsync()).GetProperty("incoming").EnumerateArray());
    }

    [Fact]
    public async Task Friends_are_sorted_by_username_ignoring_case()
    {
        var me = await factory.RegisterAsync();
        var tag = Guid.NewGuid().ToString("N")[..6];
        var names = new[] { $"b{tag}", $"A{tag}", $"c{tag}" };
        foreach (var n in names) await me.BefriendAsync(await factory.RegisterAsync(n));

        var listed = (await me.OverviewAsync()).GetProperty("friends").EnumerateArray().Select(f => f.GetProperty("username").GetString()).ToArray();

        Assert.Equal(new[] { $"A{tag}", $"b{tag}", $"c{tag}" }, listed);
    }

    [Fact]
    public async Task Interest_requires_an_existing_event_and_is_idempotent()
    {
        var p = await factory.RegisterAsync();

        var unknown = await p.Client.PutAsync("/api/friends/interests/bestaat-niet", null);
        var first = await p.Client.PutAsync("/api/friends/interests/ev-upcoming", null);
        var second = await p.Client.PutAsync("/api/friends/interests/ev-upcoming", null);

        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, second.StatusCode);
        var me = await (await p.Client.GetAsync("/api/friends/me")).JsonAsync();
        Assert.Equal(new[] { "ev-upcoming" }, me.GetProperty("interests").EnumerateArray().Select(i => i.GetString()).ToArray());
    }

    [Fact]
    public async Task Interest_can_be_removed_and_removing_a_missing_one_is_fine()
    {
        var p = await factory.RegisterAsync();
        await p.Client.PutAsync("/api/friends/interests/ev-upcoming", null);

        var first = await p.Client.DeleteAsync("/api/friends/interests/ev-upcoming");
        var second = await p.Client.DeleteAsync("/api/friends/interests/ev-upcoming");
        var never = await p.Client.DeleteAsync("/api/friends/interests/bestaat-niet");

        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, second.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, never.StatusCode);
        var me = await (await p.Client.GetAsync("/api/friends/me")).JsonAsync();
        Assert.Empty(me.GetProperty("interests").EnumerateArray());
    }

    [Fact]
    public async Task Overview_groups_friends_by_upcoming_event_and_ignores_past_events_and_strangers()
    {
        var a = await factory.RegisterAsync();
        var b = await factory.RegisterAsync();
        var stranger = await factory.RegisterAsync();
        await a.BefriendAsync(b);
        await b.Client.PutAsync("/api/friends/interests/ev-upcoming", null);
        await b.Client.PutAsync("/api/friends/interests/ev-past", null);
        await stranger.Client.PutAsync("/api/friends/interests/ev-undated", null);

        var overview = await a.OverviewAsync();

        var events = overview.GetProperty("events").EnumerateArray().ToArray();
        Assert.Contains(events, e => e.GetProperty("id").GetString() == "ev-upcoming" && e.GetProperty("friendIds").EnumerateArray().Single().GetGuid() == b.Id);
        Assert.DoesNotContain(events, e => e.GetProperty("id").GetString() == "ev-past");
        Assert.DoesNotContain(events, e => e.GetProperty("id").GetString() == "ev-undated");
    }
}
