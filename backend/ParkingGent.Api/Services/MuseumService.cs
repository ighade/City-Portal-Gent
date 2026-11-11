using System.Text.Json;
using ParkingGent.Api.Domain;

namespace ParkingGent.Api.Services;

public record MuseumCollection(string Title, string? Description, string ImageUrl, string ObjectUrl, string ImageSourceUrl);

public sealed class MuseumService(HttpClient http)
{
    public async Task<MuseumCollection?> GetCollectionAsync(Museum museum, CancellationToken ct)
    {
        // Een gecontroleerd object voorkomt dat bijvoorbeeld een bedrijf met een foto uit een
        // museumarchief zelf als collectieobject wordt voorgesteld.
        if (museum.FeaturedObjectId is null || museum.WikidataId is null) return null;
        var query = $$"""
            SELECT ?item ?itemLabel ?itemDescription ?image WHERE {
              VALUES ?item { wd:{{museum.FeaturedObjectId}} }
              ?item wdt:P195 wd:{{museum.WikidataId}}; wdt:P18 ?image.
              SERVICE wikibase:label { bd:serviceParam wikibase:language "nl,en". }
            } LIMIT 1
            """;
        using var response = await http.GetAsync("?query=" + Uri.EscapeDataString(query) + "&format=json", ct);
        response.EnsureSuccessStatusCode();
        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var bindings = doc.RootElement.GetProperty("results").GetProperty("bindings");
        if (bindings.GetArrayLength() == 0) return null;

        var row = bindings[0];
        var title = row.GetProperty("itemLabel").GetProperty("value").GetString();
        var image = row.GetProperty("image").GetProperty("value").GetString();
        var item = row.GetProperty("item").GetProperty("value").GetString();
        if (string.IsNullOrWhiteSpace(title) || image is null || item is null ||
            !image.StartsWith("http://commons.wikimedia.org/wiki/Special:FilePath/", StringComparison.Ordinal) ||
            !item.StartsWith("http://www.wikidata.org/entity/Q", StringComparison.Ordinal))
            throw new JsonException("Ongeldige collectiegegevens van Wikidata.");

        var file = image["http://commons.wikimedia.org/wiki/Special:FilePath/".Length..];
        var description = row.TryGetProperty("itemDescription", out var desc) ? desc.GetProperty("value").GetString() : null;
        return new MuseumCollection(title, description,
            "https://commons.wikimedia.org/wiki/Special:FilePath/" + file + "?width=400",
            "https://www.wikidata.org/wiki/" + item["http://www.wikidata.org/entity/".Length..],
            "https://commons.wikimedia.org/wiki/File:" + file);
    }
}
