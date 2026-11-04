namespace ParkingGent.Api.Domain;

/// <summary>Het stadstarief van één parking, zoals het laatst van de tariefpagina van Stad Gent is gelezen.</summary>
public class CityParkingRate
{
    /// <summary>Een stuk van de slug van de parking, bv. "savaan".</summary>
    public string Key { get; set; } = string.Empty;
    /// <summary>De naam zoals op de tariefpagina.</summary>
    public string Name { get; set; } = string.Empty;
    /// <summary>De vier tijdvensters als JSON.</summary>
    public string PeriodsJson { get; set; } = string.Empty;
    /// <summary>Het laatste moment waarop de waarden veranderden.</summary>
    public DateTime UpdatedAtUtc { get; set; }
    /// <summary>Het laatste moment waarop de pagina gelezen en gelijk of anders bevonden is.</summary>
    public DateTime CheckedAtUtc { get; set; }
}
