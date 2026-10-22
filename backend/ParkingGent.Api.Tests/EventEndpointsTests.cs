using Microsoft.EntityFrameworkCore;

namespace ParkingGent.Api.Tests;

public class NoSocialKeyFactory : SeededFactory
{
    protected override void Configure(Dictionary<string, string?> settings) => settings["Socialfetch:ApiKey"] = "";
}

/// <summary>GET /api/events en /api/events/{id}, inclusief het eenmalig ophalen van de beschrijving.</summary>
public class EventEndpointsTests(SeededFactory factory) : IClassFixture<SeededFactory>
{
    private readonly HttpClient client = factory.NewClient();

    private int SocialCallsFor(string id) => factory.Social.Urls.Count(u => u.Contains($"eventId={id}"));

    [Fact]
    public async Task List_orders_dated_events_first_and_undated_last()
    {
        var response = await client.GetAsync("/api/events");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var events = (await response.JsonAsync()).EnumerateArray().ToArray();
        Assert.Equal(
            [SeededFactory.EventPast, SeededFactory.EventUpcoming, SeededFactory.EventWithDescription,
             SeededFactory.EventFailing, SeededFactory.EventEmptyDescription, SeededFactory.EventUndated],
            events.Select(e => e.GetProperty("id").GetString()).ToArray());
        Assert.Equal("Vooruit", events[1].GetProperty("place").GetString());
        Assert.True(events[0].GetProperty("isPast").GetBoolean());
        Assert.False(events[5].TryGetProperty("startsAtUtc", out _));
    }

    [Theory]
    [InlineData("bestaat-niet")]
    [InlineData("EV-UPCOMING")]
    public async Task Detail_returns_404_for_unknown_event(string id)
    {
        var response = await client.GetAsync($"/api/events/{id}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Detail_fetches_the_description_once_and_stores_it()
    {
        var first = await (await client.GetAsync($"/api/events/{SeededFactory.EventUpcoming}")).JsonAsync();
        var second = await (await client.GetAsync($"/api/events/{SeededFactory.EventUpcoming}")).JsonAsync();

        Assert.Equal("Een gezellig feest.", first.GetProperty("description").GetString());
        Assert.Equal("Een gezellig feest.", second.GetProperty("description").GetString());
        Assert.Equal("Concert", first.GetProperty("event").GetProperty("name").GetString());
        Assert.Equal(1, SocialCallsFor(SeededFactory.EventUpcoming));
        var request = factory.Social.Requests.First(r => r.RequestUri!.Query.Contains(SeededFactory.EventUpcoming));
        Assert.Equal("test-key", request.Headers.GetValues("x-api-key").Single());
    }

    [Fact]
    public async Task Detail_does_not_fetch_when_a_description_is_already_stored()
    {
        var body = await (await client.GetAsync($"/api/events/{SeededFactory.EventWithDescription}")).JsonAsync();

        Assert.Equal("Al bewaard", body.GetProperty("description").GetString());
        Assert.Equal(0, SocialCallsFor(SeededFactory.EventWithDescription));
    }

    [Fact]
    public async Task Detail_retries_on_the_next_visit_when_the_fetch_fails()
    {
        var first = await client.GetAsync($"/api/events/{SeededFactory.EventFailing}");
        var second = await client.GetAsync($"/api/events/{SeededFactory.EventFailing}");

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.False((await first.JsonAsync()).TryGetProperty("description", out _));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal(2, SocialCallsFor(SeededFactory.EventFailing));
        var fetched = await factory.WithDbAsync(db => db.Events
            .Where(e => e.Id == SeededFactory.EventFailing).Select(e => e.DescriptionFetchedAtUtc).SingleAsync());
        Assert.Null(fetched);
    }

    [Fact]
    public async Task Detail_remembers_that_an_event_has_no_description()
    {
        await client.GetAsync($"/api/events/{SeededFactory.EventEmptyDescription}");
        var body = await (await client.GetAsync($"/api/events/{SeededFactory.EventEmptyDescription}")).JsonAsync();

        Assert.False(body.TryGetProperty("description", out _));
        Assert.Equal(1, SocialCallsFor(SeededFactory.EventEmptyDescription));
    }
}

public class EventsWithoutApiKeyTests(NoSocialKeyFactory factory) : IClassFixture<NoSocialKeyFactory>
{
    [Fact]
    public async Task Detail_works_without_a_description_and_makes_no_outgoing_call()
    {
        var response = await factory.NewClient().GetAsync($"/api/events/{SeededFactory.EventUpcoming}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False((await response.JsonAsync()).TryGetProperty("description", out _));
        Assert.Empty(factory.Social.Requests);
    }
}
