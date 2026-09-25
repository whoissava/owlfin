using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Owlfin.Api;

/// <summary>
/// Proxies TMDB's daily trending endpoint (movies + TV combined, top 10),
/// cross-referenced against the local Jellyfin library so the client can show
/// which trending titles are already available and deep-link straight to
/// them. The TMDB key lives only in <see cref="Configuration.PluginConfiguration"/>,
/// read and used here, server-side. Results are cached for an hour.
/// </summary>
[ApiController]
[Route("Owlfin/Trending")]
public class TrendingController : ControllerBase
{
    private static readonly HttpClient HttpClient = new HttpClient();
    private static readonly TimeSpan CacheDuration = TimeSpan.FromHours(1);
    private static readonly JsonSerializerOptions CamelCaseOptions = new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly ILibraryManager _libraryManager;

    private static List<TrendingResult>? _cachedRaw;
    private static DateTime _cacheTimeUtc = DateTime.MinValue;

    /// <summary>
    /// Initializes a new instance of the <see cref="TrendingController"/> class.
    /// </summary>
    /// <param name="libraryManager">Instance of the <see cref="ILibraryManager"/> interface.</param>
    public TrendingController(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    private class TrendingResult
    {
        public int Id { get; set; }

        public string MediaType { get; set; } = string.Empty;

        public string Title { get; set; } = string.Empty;

        public string? PosterPath { get; set; }

        public string? BackdropPath { get; set; }

        public string Overview { get; set; } = string.Empty;

        public double VoteAverage { get; set; }
    }

    /// <summary>
    /// Returns today's top 10 trending movies/TV shows from TMDB, each
    /// annotated with whether it exists in the local library. 404 if not
    /// configured.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult> GetTrending()
    {
        Configuration.PluginConfiguration? config = Plugin.Instance?.Configuration;
        if (config is null || !config.TrendingEnabled || string.IsNullOrWhiteSpace(config.TmdbApiKey))
        {
            return NotFound();
        }

        List<TrendingResult> raw;
        try
        {
            raw = await GetTrendingFromTmdbAsync(config.TmdbApiKey).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return StatusCode(502);
        }

        var items = raw.Select(r =>
        {
            (bool available, Guid? localId) = FindLocalMatch(r.Id, r.MediaType);
            return (object)new
            {
                id = r.Id,
                mediaType = r.MediaType,
                title = r.Title,
                posterPath = r.PosterPath,
                backdropPath = r.BackdropPath,
                overview = r.Overview,
                voteAverage = r.VoteAverage,
                available,
                localItemId = available ? localId?.ToString("N") : null
            };
        }).ToList();

        return new JsonResult(new { items }, CamelCaseOptions);
    }

    private async Task<List<TrendingResult>> GetTrendingFromTmdbAsync(string apiKey)
    {
        if (_cachedRaw is not null && DateTime.UtcNow - _cacheTimeUtc < CacheDuration)
        {
            return _cachedRaw;
        }

        string url = $"https://api.themoviedb.org/3/trending/all/day?api_key={apiKey}&language=it-IT";
        using HttpResponseMessage response = await HttpClient.GetAsync(url).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        await using System.IO.Stream stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
        using JsonDocument doc = await JsonDocument.ParseAsync(stream).ConfigureAwait(false);

        List<TrendingResult> results = doc.RootElement.GetProperty("results")
            .EnumerateArray()
            .Where(e => e.TryGetProperty("media_type", out JsonElement mt)
                && (mt.GetString() == "movie" || mt.GetString() == "tv"))
            .Take(10)
            .Select(e => new TrendingResult
            {
                Id = e.GetProperty("id").GetInt32(),
                MediaType = e.GetProperty("media_type").GetString() ?? string.Empty,
                Title = e.TryGetProperty("title", out JsonElement t) && t.ValueKind == JsonValueKind.String
                    ? t.GetString() ?? "-"
                    : (e.TryGetProperty("name", out JsonElement n) && n.ValueKind == JsonValueKind.String ? n.GetString() ?? "-" : "-"),
                PosterPath = e.TryGetProperty("poster_path", out JsonElement p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null,
                BackdropPath = e.TryGetProperty("backdrop_path", out JsonElement b) && b.ValueKind == JsonValueKind.String ? b.GetString() : null,
                Overview = e.TryGetProperty("overview", out JsonElement ov) && ov.ValueKind == JsonValueKind.String ? ov.GetString() ?? string.Empty : string.Empty,
                VoteAverage = e.TryGetProperty("vote_average", out JsonElement va) && va.ValueKind == JsonValueKind.Number ? va.GetDouble() : 0
            })
            .ToList();

        _cachedRaw = results;
        _cacheTimeUtc = DateTime.UtcNow;
        return results;
    }

    private (bool Available, Guid? LocalId) FindLocalMatch(int tmdbId, string mediaType)
    {
        try
        {
            var query = new InternalItemsQuery
            {
                IncludeItemTypes = mediaType == "tv"
                    ? new[] { BaseItemKind.Series }
                    : new[] { BaseItemKind.Movie },
                HasAnyProviderId = new Dictionary<string, string> { ["Tmdb"] = tmdbId.ToString() }
            };

            BaseItem? match = _libraryManager.GetItemList(query).FirstOrDefault();
            return match is null ? (false, null) : (true, match.Id);
        }
        catch (Exception)
        {
            // Se la query fallisce per qualsiasi motivo, meglio mostrare
            // l'item come "non disponibile" che rompere l'intero banner.
            return (false, null);
        }
    }
}
