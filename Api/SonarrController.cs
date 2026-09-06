using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Owlfin.Api;

/// <summary>
/// Proxies a single read-only question to Sonarr -- "when does this series next air?" --
/// so <c>Web/nextepisode.js</c> never needs the Sonarr URL or API key itself. The key
/// lives only in <see cref="Configuration.PluginConfiguration"/>, read and used here,
/// server-side.
/// </summary>
[ApiController]
[Route("Owlfin/Sonarr")]
public class SonarrController : ControllerBase
{
    private static readonly HttpClient HttpClient = new HttpClient();
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(10);

    private static List<JsonElement>? _cachedSeries;
    private static DateTime _cacheTimeUtc = DateTime.MinValue;

    /// <summary>
    /// Returns the next-airing date (if any) for the Sonarr series matching the given
    /// TVDB id, or 404 if not configured/not found. If <paramref name="tvdbId"/> is 0
    /// (Jellyfin has no TVDB id for this item -- common for very new releases), falls
    /// back to a case-insensitive title match via <paramref name="title"/>.
    /// </summary>
    /// <param name="tvdbId">The TheTVDB id of the series (matches Jellyfin's own ProviderIds.Tvdb), or 0 if unknown.</param>
    /// <param name="title">Fallback series title, used only when <paramref name="tvdbId"/> is 0.</param>
    /// <returns>A JSON object <c>{ "nextAiring": "..." }</c> (or null).</returns>
    [HttpGet("NextEpisode/{tvdbId}")]
    public async Task<ActionResult> GetNextEpisode(int tvdbId, [FromQuery] string? title)
    {
        Configuration.PluginConfiguration? config = Plugin.Instance?.Configuration;
        if (config is null
            || !config.SonarrEnabled
            || string.IsNullOrWhiteSpace(config.SonarrUrl)
            || string.IsNullOrWhiteSpace(config.SonarrApiKey))
        {
            return NotFound();
        }

        List<JsonElement> series;
        try
        {
            series = await GetSeriesAsync(config.SonarrUrl.TrimEnd('/'), config.SonarrApiKey).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return StatusCode(502);
        }

        JsonElement match = default;

        if (tvdbId > 0)
        {
            match = series.FirstOrDefault(s =>
                s.TryGetProperty("tvdbId", out JsonElement idProp)
                && idProp.ValueKind == JsonValueKind.Number
                && idProp.GetInt32() == tvdbId);
        }

        if (match.ValueKind == JsonValueKind.Undefined && !string.IsNullOrWhiteSpace(title))
        {
            match = series.FirstOrDefault(s =>
                s.TryGetProperty("title", out JsonElement titleProp)
                && titleProp.ValueKind == JsonValueKind.String
                && string.Equals(titleProp.GetString(), title, StringComparison.OrdinalIgnoreCase));
        }

        if (match.ValueKind == JsonValueKind.Undefined)
        {
            return NotFound();
        }

        string? nextAiring = match.TryGetProperty("nextAiring", out JsonElement naProp)
            && naProp.ValueKind == JsonValueKind.String
                ? naProp.GetString()
                : null;

        return new JsonResult(new { nextAiring });
    }

    private static async Task<List<JsonElement>> GetSeriesAsync(string sonarrUrl, string apiKey)
    {
        if (_cachedSeries is not null && DateTime.UtcNow - _cacheTimeUtc < CacheDuration)
        {
            return _cachedSeries;
        }

        using var request = new HttpRequestMessage(HttpMethod.Get, $"{sonarrUrl}/api/v3/series");
        request.Headers.Add("X-Api-Key", apiKey);

        using HttpResponseMessage response = await HttpClient.SendAsync(request).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        await using System.IO.Stream stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
        using JsonDocument doc = await JsonDocument.ParseAsync(stream).ConfigureAwait(false);

        _cachedSeries = doc.RootElement.EnumerateArray().Select(x => x.Clone()).ToList();
        _cacheTimeUtc = DateTime.UtcNow;

        return _cachedSeries;
    }
}
