using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Owlfin.Api;

/// <summary>
/// Proxies read-only questions to Sonarr -- "what episodes are still to air for this
/// series?" -- so <c>Web/nextepisode.js</c> never needs the Sonarr URL or API key itself.
/// The key lives only in <see cref="Configuration.PluginConfiguration"/>, read and used
/// here, server-side.
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
    /// Returns every not-yet-aired episode (season, episode number, title, air date) for
    /// the Sonarr series matching the given TVDB id, sorted by air date ascending, or 404
    /// if not configured/not found. If <paramref name="tvdbId"/> is 0 (Jellyfin has no
    /// TVDB id for this item -- common for very new releases), falls back to a
    /// case-insensitive title match via <paramref name="title"/>.
    /// </summary>
    /// <param name="tvdbId">The TheTVDB id of the series (matches Jellyfin's own ProviderIds.Tvdb), or 0 if unknown.</param>
    /// <param name="title">Fallback series title, used only when <paramref name="tvdbId"/> is 0.</param>
    /// <returns>A JSON object <c>{ "episodes": [{ "season": 3, "episode": 5, "title": "...", "airDate": "..." }, ...] }</c>.</returns>
    [HttpGet("Episodes/{tvdbId}")]
    public async Task<ActionResult> GetUpcomingEpisodes(int tvdbId, [FromQuery] string? title)
    {
        Configuration.PluginConfiguration? config = Plugin.Instance?.Configuration;
        if (config is null
            || !config.SonarrEnabled
            || string.IsNullOrWhiteSpace(config.SonarrUrl)
            || string.IsNullOrWhiteSpace(config.SonarrApiKey))
        {
            return NotFound();
        }

        string sonarrUrl = config.SonarrUrl.TrimEnd('/');
        string apiKey = config.SonarrApiKey;

        List<JsonElement> series;
        try
        {
            series = await GetSeriesAsync(sonarrUrl, apiKey).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return StatusCode(502);
        }

        JsonElement? match = FindSeries(series, tvdbId, title);
        if (match is null || !match.Value.TryGetProperty("id", out JsonElement idProp) || idProp.ValueKind != JsonValueKind.Number)
        {
            return NotFound();
        }

        List<JsonElement> episodes;
        try
        {
            episodes = await GetEpisodesAsync(sonarrUrl, apiKey, idProp.GetInt32()).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return StatusCode(502);
        }

        DateTime nowUtc = DateTime.UtcNow;

        var upcoming = episodes
            .Select(e => new
            {
                Element = e,
                AirDateUtc = e.TryGetProperty("airDateUtc", out JsonElement adProp)
                    && adProp.ValueKind == JsonValueKind.String
                    && DateTime.TryParse(
                        adProp.GetString(),
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                        out DateTime parsed)
                        ? (DateTime?)parsed
                        : null
            })
            .Where(x => x.AirDateUtc is not null && x.AirDateUtc.Value >= nowUtc)
            .OrderBy(x => x.AirDateUtc)
            .Select(x => new
            {
                season = x.Element.TryGetProperty("seasonNumber", out JsonElement snProp) ? snProp.GetInt32() : 0,
                episode = x.Element.TryGetProperty("episodeNumber", out JsonElement enProp) ? enProp.GetInt32() : 0,
                title = x.Element.TryGetProperty("title", out JsonElement tProp) && tProp.ValueKind == JsonValueKind.String
                    ? tProp.GetString()
                    : null,
                airDate = x.AirDateUtc!.Value.ToString("o", CultureInfo.InvariantCulture)
            })
            .ToList();

        return new JsonResult(new { episodes = upcoming });
    }

    private static JsonElement? FindSeries(List<JsonElement> series, int tvdbId, string? title)
    {
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

        return match.ValueKind == JsonValueKind.Undefined ? null : match;
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

    private static async Task<List<JsonElement>> GetEpisodesAsync(string sonarrUrl, string apiKey, int seriesId)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{sonarrUrl}/api/v3/episode?seriesId={seriesId}");
        request.Headers.Add("X-Api-Key", apiKey);

        using HttpResponseMessage response = await HttpClient.SendAsync(request).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        await using System.IO.Stream stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
        using JsonDocument doc = await JsonDocument.ParseAsync(stream).ConfigureAwait(false);

        return doc.RootElement.EnumerateArray().Select(x => x.Clone()).ToList();
    }
}
