using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Owlfin.Api;

/// <summary>
/// Proxy verso Seerr (Jellyseerr/Overseerr) per la tab "Richiedi" di JellyTok.
/// L'URL e la API key di Seerr restano solo in <see cref="Configuration.PluginConfiguration"/>:
/// il browser parla soltanto con questi endpoint e non le vede mai.
/// Servono utenti Jellyfin autenticati: il token viene verificato in <see cref="IsAuthenticatedAsync"/>.
/// </summary>
[ApiController]
[Route("Owlfin/Seerr")]
public class SeerrController : ControllerBase
{
    private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    private static readonly Regex LangRegex = new Regex("^[a-z]{2}(-[A-Za-z]{2})?$", RegexOptions.Compiled);
    private static readonly JsonSerializerOptions CamelCaseOptions = new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    // Jellyfin user id (formato "N") -> id utente Seerr; evita di rileggere l'elenco utenti a ogni richiesta.
    private static readonly Dictionary<string, int> SeerrUserCache = new Dictionary<string, int>();
    private static readonly SemaphoreSlim SeerrUserLock = new SemaphoreSlim(1, 1);

    private readonly ILogger<SeerrController> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="SeerrController"/> class.
    /// </summary>
    /// <param name="logger">Instance of the <see cref="ILogger{SeerrController}"/> interface.</param>
    public SeerrController(ILogger<SeerrController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Indica se Seerr e' configurato (URL e API key presenti).
    /// </summary>
    /// <returns>Un oggetto JSON <c>{ "enabled": true|false }</c>.</returns>
    [HttpGet("Status")]
    public async Task<ActionResult> GetStatus()
    {
        if (!await IsAuthenticatedAsync().ConfigureAwait(false))
        {
            return Unauthorized();
        }

        try
        {
            return new JsonResult(new { enabled = TryGetConfig(out _, out _) }, CamelCaseOptions);
        }
        catch (Exception ex)
        {
            return Fail("Status", ex);
        }
    }

    /// <summary>
    /// Elenco di titoli da scoprire (tendenza, film popolari o serie popolari), in forma ridotta.
    /// </summary>
    /// <param name="kind">"movie", "tv" oppure vuoto per le tendenze miste.</param>
    /// <param name="page">Pagina (20 risultati ciascuna).</param>
    /// <param name="lang">Lingua dei testi, es. "it" o "en".</param>
    /// <returns>Un oggetto JSON con pagina, totale pagine e risultati.</returns>
    [HttpGet("Discover")]
    public async Task<ActionResult> Discover([FromQuery] string? kind, [FromQuery] int page = 1, [FromQuery] string? lang = null)
    {
        if (!await IsAuthenticatedAsync().ConfigureAwait(false))
        {
            return Unauthorized();
        }

        if (!TryGetConfig(out string url, out string key))
        {
            return NotFound();
        }

        page = Math.Clamp(page, 1, 500);
        string path = kind switch
        {
            "movie" => "discover/movies",
            "tv" => "discover/tv",
            _ => "discover/trending"
        };

        try
        {
            (int code, JsonDocument? doc) = await SendAsync(HttpMethod.Get, $"{url}/api/v1/{path}?page={page}&language={SafeLang(lang)}", key, null).ConfigureAwait(false);
            using (doc)
            {
                if (code < 200 || code >= 300 || doc is null)
                {
                    return Fail("Discover", null, $"Seerr HTTP {code}");
                }

                JsonElement root = doc.RootElement;
                var results = new List<object>();

                if (root.TryGetProperty("results", out JsonElement arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement r in arr.EnumerateArray())
                    {
                        string type = Str(r, "mediaType") ?? (kind == "movie" ? "movie" : kind == "tv" ? "tv" : string.Empty);
                        if (type != "movie" && type != "tv")
                        {
                            continue;
                        }

                        int status = 0;
                        if (r.TryGetProperty("mediaInfo", out JsonElement mi) && mi.ValueKind == JsonValueKind.Object)
                        {
                            status = Int(mi, "status");
                        }

                        results.Add(new
                        {
                            id = Int(r, "id"),
                            mediaType = type,
                            title = Str(r, "title") ?? Str(r, "name") ?? string.Empty,
                            date = Str(r, "releaseDate") ?? Str(r, "firstAirDate"),
                            overview = Str(r, "overview"),
                            poster = Str(r, "posterPath"),
                            backdrop = Str(r, "backdropPath"),
                            rating = Dbl(r, "voteAverage"),
                            status
                        });
                    }
                }

                return new JsonResult(new { page, totalPages = Int(root, "totalPages"), results }, CamelCaseOptions);
            }
        }
        catch (Exception ex)
        {
            return Fail("Discover", ex);
        }
    }

    /// <summary>
    /// Chiavi YouTube dei trailer di un titolo, lette dai dettagli di Seerr.
    /// </summary>
    /// <param name="kind">"movie" o "tv".</param>
    /// <param name="id">Id TMDB.</param>
    /// <param name="lang">Lingua dei testi.</param>
    /// <returns>Un oggetto JSON <c>{ "keys": [...] }</c>.</returns>
    [HttpGet("Videos")]
    public async Task<ActionResult> Videos([FromQuery] string? kind, [FromQuery] int id, [FromQuery] string? lang = null)
    {
        if (!await IsAuthenticatedAsync().ConfigureAwait(false))
        {
            return Unauthorized();
        }

        if (!TryGetConfig(out string url, out string key))
        {
            return NotFound();
        }

        if ((kind != "movie" && kind != "tv") || id <= 0)
        {
            return BadRequest();
        }

        try
        {
            (int code, JsonDocument? doc) = await SendAsync(HttpMethod.Get, $"{url}/api/v1/{kind}/{id}?language={SafeLang(lang)}", key, null).ConfigureAwait(false);
            using (doc)
            {
                if (code < 200 || code >= 300 || doc is null)
                {
                    return Fail("Videos", null, $"Seerr HTTP {code}");
                }

                var keys = new List<(int Rank, string Key)>();
                if (doc.RootElement.TryGetProperty("relatedVideos", out JsonElement vids) && vids.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement v in vids.EnumerateArray())
                    {
                        string? site = Str(v, "site");
                        string? type = Str(v, "type");
                        string? k = Str(v, "key");
                        if (site == "YouTube" && !string.IsNullOrEmpty(k) && (type == "Trailer" || type == "Teaser"))
                        {
                            keys.Add((type == "Trailer" ? 0 : 1, k));
                        }
                    }
                }

                return new JsonResult(new { keys = keys.OrderBy(x => x.Rank).Select(x => x.Key).Distinct().ToList() }, CamelCaseOptions);
            }
        }
        catch (Exception ex)
        {
            return Fail("Videos", ex);
        }
    }

    /// <summary>
    /// Crea una richiesta in Seerr. Corpo JSON: <c>{ "mediaType": "movie"|"tv", "mediaId": 123 }</c>.
    /// Per le serie vengono richieste tutte le stagioni.
    /// </summary>
    /// <returns>Un oggetto JSON <c>{ "ok": true }</c>.</returns>
    [HttpPost("Request")]
    public async Task<ActionResult> CreateRequest()
    {
        (bool authOk, Guid jellyfinUserId, bool isAdmin) = await AuthenticateAsync().ConfigureAwait(false);
        if (!authOk)
        {
            return Unauthorized();
        }

        if (!TryGetConfig(out string url, out string key))
        {
            return NotFound();
        }

        string? kind;
        int mediaId;
        try
        {
            using JsonDocument body = await JsonDocument.ParseAsync(Request.Body).ConfigureAwait(false);
            kind = Str(body.RootElement, "mediaType");
            mediaId = Int(body.RootElement, "mediaId");
        }
        catch (Exception)
        {
            return BadRequest();
        }

        if ((kind != "movie" && kind != "tv") || mediaId <= 0)
        {
            return BadRequest();
        }

        try
        {
            // La richiesta parte a nome dell'utente Jellyfin che la fa: Seerr applica i suoi permessi,
            // quindi per un utente non admin finisce "in attesa di approvazione" (gli admin sono approvati subito).
            int seerrUserId = 0;
            if (jellyfinUserId != Guid.Empty)
            {
                try
                {
                    seerrUserId = await ResolveSeerrUserAsync(url, key, jellyfinUserId).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Owlfin Seerr: impossibile associare l'utente Jellyfin a Seerr");
                }
            }

            if (seerrUserId == 0 && !isAdmin)
            {
                // Mai creare la richiesta con l'utente della API key (admin, approvata in automatico) per un utente normale.
                return Fail("Request", null, "Utente non presente in Seerr: importalo da Seerr (Utenti > Importa utenti Jellyfin)");
            }

            var payloadMap = new Dictionary<string, object>
            {
                ["mediaType"] = kind ?? string.Empty,
                ["mediaId"] = mediaId
            };
            if (kind == "tv")
            {
                payloadMap["seasons"] = "all";
            }

            if (seerrUserId > 0)
            {
                payloadMap["userId"] = seerrUserId;
            }

            string payload = JsonSerializer.Serialize(payloadMap);
            (int code, JsonDocument? doc) = await SendAsync(HttpMethod.Post, $"{url}/api/v1/request", key, payload).ConfigureAwait(false);
            int requestStatus = doc is null ? 0 : Int(doc.RootElement, "status");
            doc?.Dispose();

            if (code >= 200 && code < 300)
            {
                // status Seerr: 1 = in attesa di approvazione, 2 = approvata
                return new JsonResult(new { ok = true, pending = requestStatus == 1 }, CamelCaseOptions);
            }

            if (code == 409)
            {
                return new JsonResult(new { ok = true, already = true }, CamelCaseOptions);
            }

            return Fail("Request", null, $"Seerr HTTP {code}");
        }
        catch (Exception ex)
        {
            return Fail("Request", ex);
        }
    }

    /// <summary>
    /// Verifica il token Jellyfin della richiesta. Non usa il nome di una policy (cambia tra le versioni di
    /// Jellyfin): prova lo schema "CustomAuthentication" e poi quello predefinito.
    /// </summary>
    private async Task<bool> IsAuthenticatedAsync()
    {
        (bool ok, _, _) = await AuthenticateAsync().ConfigureAwait(false);
        return ok;
    }

    /// <summary>
    /// Come <see cref="IsAuthenticatedAsync"/>, ma restituisce anche l'id dell'utente Jellyfin e se e' amministratore.
    /// </summary>
    private async Task<(bool Ok, Guid UserId, bool IsAdmin)> AuthenticateAsync()
    {
        foreach (string? scheme in new string?[] { "CustomAuthentication", null })
        {
            try
            {
                AuthenticateResult result = scheme is null
                    ? await HttpContext.AuthenticateAsync().ConfigureAwait(false)
                    : await HttpContext.AuthenticateAsync(scheme).ConfigureAwait(false);
                if (!result.Succeeded)
                {
                    continue;
                }

                Guid userId = Guid.Empty;
                bool isAdmin = false;
                if (result.Principal is not null)
                {
                    foreach (Claim c in result.Principal.Claims)
                    {
                        if (userId == Guid.Empty
                            && (c.Type.Contains("UserId", StringComparison.OrdinalIgnoreCase) || c.Type == ClaimTypes.NameIdentifier)
                            && Guid.TryParse(c.Value, out Guid g))
                        {
                            userId = g;
                        }

                        if (c.Type == ClaimTypes.Role && string.Equals(c.Value, "Administrator", StringComparison.OrdinalIgnoreCase))
                        {
                            isAdmin = true;
                        }
                    }
                }

                return (true, userId, isAdmin);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Owlfin Seerr: schema di autenticazione {Scheme} non disponibile", scheme ?? "(predefinito)");
            }
        }

        return (false, Guid.Empty, false);
    }

    /// <summary>
    /// Trova l'utente Seerr che corrisponde all'utente Jellyfin; se manca lo importa da Jellyfin.
    /// Restituisce 0 se non riesce.
    /// </summary>
    private async Task<int> ResolveSeerrUserAsync(string url, string key, Guid jellyfinUserId)
    {
        string want = jellyfinUserId.ToString("N");
        await SeerrUserLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (SeerrUserCache.TryGetValue(want, out int cached))
            {
                return cached;
            }

            int found = 0;
            for (int skip = 0; skip < 5000 && found == 0; skip += 100)
            {
                (int listCode, JsonDocument? listDoc) = await SendAsync(HttpMethod.Get, $"{url}/api/v1/user?take=100&skip={skip}", key, null).ConfigureAwait(false);
                using (listDoc)
                {
                    if (listCode < 200 || listCode >= 300 || listDoc is null
                        || !listDoc.RootElement.TryGetProperty("results", out JsonElement arr) || arr.ValueKind != JsonValueKind.Array)
                    {
                        break;
                    }

                    int count = 0;
                    foreach (JsonElement u in arr.EnumerateArray())
                    {
                        count++;
                        string? jf = Str(u, "jellyfinUserId");
                        if (jf is not null && string.Equals(jf.Replace("-", string.Empty), want, StringComparison.OrdinalIgnoreCase))
                        {
                            found = Int(u, "id");
                            break;
                        }
                    }

                    if (count < 100)
                    {
                        break;
                    }
                }
            }

            if (found == 0)
            {
                string body = JsonSerializer.Serialize(new { jellyfinUserIds = new[] { jellyfinUserId.ToString() } });
                (int impCode, JsonDocument? impDoc) = await SendAsync(HttpMethod.Post, $"{url}/api/v1/user/import-from-jellyfin", key, body).ConfigureAwait(false);
                using (impDoc)
                {
                    if (impCode >= 200 && impCode < 300 && impDoc is not null && impDoc.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (JsonElement u in impDoc.RootElement.EnumerateArray())
                        {
                            found = Int(u, "id");
                            if (found > 0)
                            {
                                break;
                            }
                        }
                    }
                }
            }

            if (found > 0)
            {
                SeerrUserCache[want] = found;
            }

            return found;
        }
        finally
        {
            SeerrUserLock.Release();
        }
    }

    /// <summary>
    /// Registra l'errore nel log di Jellyfin e risponde 502 con un breve messaggio leggibile dal client.
    /// </summary>
    private ActionResult Fail(string op, Exception? ex, string? message = null)
    {
        string text = message ?? (ex is null ? "errore" : $"{ex.GetType().Name}: {ex.Message}");
        if (text.Length > 160)
        {
            text = text.Substring(0, 160);
        }

        _logger.LogWarning(ex, "Owlfin Seerr {Operation} non riuscito: {Message}", op, text);
        return new JsonResult(new { error = text }, CamelCaseOptions) { StatusCode = 502 };
    }

    private static bool TryGetConfig(out string url, out string key)
    {
        Configuration.PluginConfiguration? c = Plugin.Instance?.Configuration;
        url = (c?.SeerrUrl ?? string.Empty).Trim().TrimEnd('/');
        key = (c?.SeerrApiKey ?? string.Empty).Trim();
        return url.Length > 0 && key.Length > 0;
    }

    private static string SafeLang(string? lang)
    {
        return !string.IsNullOrEmpty(lang) && LangRegex.IsMatch(lang) ? lang : "en";
    }

    private static async Task<(int Code, JsonDocument? Doc)> SendAsync(HttpMethod method, string url, string key, string? body)
    {
        using var req = new HttpRequestMessage(method, url);
        req.Headers.Add("X-Api-Key", key);
        if (body is not null)
        {
            req.Content = new StringContent(body, Encoding.UTF8, "application/json");
        }

        using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
        string text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);

        JsonDocument? doc = null;
        if (!string.IsNullOrWhiteSpace(text))
        {
            try
            {
                doc = JsonDocument.Parse(text);
            }
            catch (JsonException)
            {
                doc = null;
            }
        }

        return ((int)res.StatusCode, doc);
    }

    private static string? Str(JsonElement e, string name)
    {
        return e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out JsonElement p) && p.ValueKind == JsonValueKind.String
            ? p.GetString()
            : null;
    }

    private static int Int(JsonElement e, string name)
    {
        return e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out JsonElement p) && p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out int v)
            ? v
            : 0;
    }

    private static double Dbl(JsonElement e, string name)
    {
        return e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out JsonElement p) && p.ValueKind == JsonValueKind.Number && p.TryGetDouble(out double v)
            ? v
            : 0;
    }
}
