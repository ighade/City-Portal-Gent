namespace ParkingGent.Api.Domain;

/// <summary>Een beheeractie: wie deed wat, en waarop.</summary>
public class AuditLog
{
    public long Id { get; set; }
    public DateTime AtUtc { get; set; }
    public string Actor { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string Target { get; set; } = string.Empty;
}
