using System.Text.Json.Serialization;

namespace ParkingGent.Api.Domain;

public sealed class Museum
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    [JsonRequired]
    public double Lat { get; set; }
    [JsonRequired]
    public double Lon { get; set; }
    public string Hours { get; set; } = "";
    public string Website { get; set; } = "";
    public string? WikidataId { get; set; }
    public string? FeaturedObjectId { get; set; }
    public string? CollectionSummary { get; set; }
}
