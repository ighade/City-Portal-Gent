using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace ParkingGent.Api.Services;

/// <summary>Wie er aan de lijn hangt. Voor een gewone bezoeker: niemand, en dat is genoeg om te lezen.</summary>
public sealed record Caller(string Email, string Name, bool IsAdmin);

/// <summary>
/// Dezelfde regels als in LvCRM (bouwsteen 21) en AlgemeneTaken: de identiteitskop telt alleen
/// samen met het proxygeheim; zonder geheim of zonder kop is het verzoek anoniem.
/// <para>
/// Het verschil met die twee: hier is anoniem de normale toestand. Deze API is openbaar te
/// lezen, en een identiteit is alleen nodig voor de drie beheerknoppen. Buiten het huis komt er
/// geen identiteit binnen, want alleen het <c>:8105</c>-blok in het Caddyfile zet de koppen.
/// </para>
/// </summary>
public sealed class CallerResolver(IOptions<AuthOptions> auth, IHostEnvironment env)
{
    public Caller Resolve(HttpContext context)
    {
        var a = auth.Value;
        string? email = null;

        if (ProxyKeyMatches(context))
        {
            email = context.Request.Headers[a.HeaderName].FirstOrDefault();
        }
        if (string.IsNullOrWhiteSpace(email) && env.IsDevelopment())
        {
            email = a.DevEmail;
        }
        if (string.IsNullOrWhiteSpace(email))
        {
            return new Caller(string.Empty, string.Empty, false);
        }

        email = email.Trim().ToLowerInvariant();
        var name = context.Request.Headers[a.NameHeader].FirstOrDefault();
        var isAdmin = a.Admins().Contains(email, StringComparer.Ordinal);

        return new Caller(email, string.IsNullOrWhiteSpace(name) ? email : name.Trim(), isAdmin);
    }

    private bool ProxyKeyMatches(HttpContext context)
    {
        var key = auth.Value.ProxyKey;
        // Geen geheim ingesteld = niet in gebruik (ontwikkelen, of een opzet zonder Caddy ervoor).
        if (string.IsNullOrEmpty(key)) return true;
        var offered = context.Request.Headers[auth.Value.ProxyKeyHeader].FirstOrDefault() ?? string.Empty;
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(offered), Encoding.UTF8.GetBytes(key));
    }
}
