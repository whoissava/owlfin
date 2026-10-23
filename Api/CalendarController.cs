using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Owlfin.Api;

/// <summary>
/// Dati per il calendario delle uscite (calendar.js): film e serie in uscita, presenti e passate.
/// Mette insieme le uscite "richieste" (calendari di Radarr e Sonarr) e quelle globali (TMDB).
/// URL e API key di Radarr, Sonarr e TMDB restano solo in <see cref="Configuration.PluginConfiguration"/>:
/// il browser parla soltanto con questo endpoint e non le vede mai. Servono utenti Jellyfin autenticati.
/// </summary>
[ApiController]
[Route("Owlfin/Calendar")]
public class CalendarController : ControllerBase
{
    private const int MaxRangeDays = 100;

    private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
    private static readonly Regex LangRegex = new Regex("^[a-z]{2}(-[A-Za-z]{2})?$", RegexOptions.Compiled);
    private static readonly Regex RegionRegex = new Regex("^[A-Z]{2}$", RegexOptions.Compiled);
    private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    // Elenchi gia' scaricati, per non interrogare Radarr/Sonarr/TMDB a ogni apertura.
    private static readonly ConcurrentDictionary<string, CacheEntry> Cache = new ConcurrentDictionary<string, CacheEntry>();
    private static readonly ConcurrentDictionary<string, DateEntry> ReleaseDateCache = new ConcurrentDictionary<string, DateEntry>();
    private static readonly SemaphoreSlim TmdbGate = new SemaphoreSlim(6, 6);

    private static readonly Dictionary<int, string[]> Genres = new Dictionary<int, string[]>
    {
        { 28, new[] { "Azione", "Action" } },
        { 12, new[] { "Avventura", "Adventure" } },
        { 16, new[] { "Animazione", "Animation" } },
        { 35, new[] { "Commedia", "Comedy" } },
        { 80, new[] { "Crime", "Crime" } },
        { 99, new[] { "Documentario", "Documentary" } },
        { 18, new[] { "Drammatico", "Drama" } },
        { 10751, new[] { "Famiglia", "Family" } },
        { 14, new[] { "Fantasy", "Fantasy" } },
        { 36, new[] { "Storico", "History" } },
        { 27, new[] { "Horror", "Horror" } },
        { 10402, new[] { "Musica", "Music" } },
        { 9648, new[] { "Mistero", "Mystery" } },
        { 10749, new[] { "Romantico", "Romance" } },
        { 878, new[] { "Fantascienza", "Science Fiction" } },
        { 10770, new[] { "Film TV", "TV Movie" } },
        { 53, new[] { "Thriller", "Thriller" } },
        { 10752, new[] { "Guerra", "War" } },
        { 37, new[] { "Western", "Western" } },
        { 10759, new[] { "Azione e Avventura", "Action & Adventure" } },
        { 10762, new[] { "Bambini", "Kids" } },
        { 10763, new[] { "Notizie", "News" } },
        { 10764, new[] { "Reality", "Reality" } },
        { 10765, new[] { "Fantascienza e Fantasy", "Sci-Fi & Fantasy" } },
        { 10766, new[] { "Soap", "Soap" } },
        { 10767, new[] { "Talk show", "Talk" } },
        { 10768, new[] { "Guerra e Politica", "War & Politics" } }
    };

    private readonly ILogger<CalendarController> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="CalendarController"/> class.
    /// </summary>
    /// <param name="logger">Instance of the <see cref="ILogger{CalendarController}"/> interface.</param>
    public CalendarController(ILogger<CalendarController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Gets or sets l'indirizzo base delle API TMDB (modificabile solo per i test).
    /// </summary>
    public static string TmdbBaseUrl { get; set; } = "https://api.themoviedb.org/3";

    /// <summary>
    /// Dice quali fonti sono configurate (Radarr, Sonarr, TMDB).
    /// </summary>
    /// <returns>Un oggetto JSON <c>{ "radarr": true|false, "sonarr": true|false, "tmdb": true|false }</c>.</returns>
    [HttpGet("Status")]
    public async Task<ActionResult> GetStatus()
    {
        if (!await IsAuthenticatedAsync().ConfigureAwait(false))
        {
            return Unauthorized();
        }

        return new JsonResult(SourcesInfo(), JsonOptions);
    }

    /// <summary>
    /// Elenco delle uscite comprese fra due date (inclusive).
    /// </summary>
    /// <param name="start">Prima data, formato yyyy-MM-dd.</param>
    /// <param name="end">Ultima data, formato yyyy-MM-dd (al massimo 100 giorni dopo la prima).</param>
    /// <param name="source">"arr" per le sole uscite richieste (Radarr e Sonarr), "all" per anche quelle globali (TMDB).</param>
    /// <param name="lang">Lingua dei testi, es. "it" o "en".</param>
    /// <param name="region">Paese per le date di uscita in sala, es. "IT" (di norma ricavato dalla lingua).</param>
    /// <returns>Un oggetto JSON <c>{ "events": [...], "errors": [...], "sources": {...} }</c>.</returns>
    [HttpGet("Events")]
    public async Task<ActionResult> GetEvents(
        [FromQuery] string? start,
        [FromQuery] string? end,
        [FromQuery] string? source,
        [FromQuery] string? lang,
        [FromQuery] string? region)
    {
        if (!await IsAuthenticatedAsync().ConfigureAwait(false))
        {
            return Unauthorized();
        }

        if (!DateTime.TryParseExact(start, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateTime startDate)
            || !DateTime.TryParseExact(end, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out DateTime endDate)
            || endDate < startDate
            || (endDate - startDate).TotalDays > MaxRangeDays)
        {
            return BadRequest(new { error = "intervallo di date non valido" });
        }

        Configuration.PluginConfiguration? config = Plugin.Instance?.Configuration;
        if (config is null)
        {
            return NotFound();
        }

        string language = !string.IsNullOrEmpty(lang) && LangRegex.IsMatch(lang) ? lang.Substring(0, 2).ToLowerInvariant() : "en";
        string countryCode = !string.IsNullOrEmpty(region) && RegionRegex.IsMatch(region)
            ? region
            : (language == "it" ? "IT" : "US");
        bool includeGlobal = !string.Equals(source, "arr", StringComparison.OrdinalIgnoreCase);

        bool hasRadarr = !string.IsNullOrWhiteSpace(config.RadarrUrl) && !string.IsNullOrWhiteSpace(config.RadarrApiKey);
        bool hasSonarr = !string.IsNullOrWhiteSpace(config.SonarrUrl) && !string.IsNullOrWhiteSpace(config.SonarrApiKey);
        bool hasTmdb = !string.IsNullOrWhiteSpace(config.TmdbApiKey);

        var errors = new List<SourceError>();
        var radarrTask = hasRadarr
            ? RunAsync("radarr", errors, () => GetRadarrAsync(config.RadarrUrl.Trim().TrimEnd('/'), config.RadarrApiKey.Trim(), startDate, endDate))
            : Task.FromResult(new List<CalEvent>());
        var sonarrTask = hasSonarr
            ? RunAsync("sonarr", errors, () => GetSonarrAsync(config.SonarrUrl.Trim().TrimEnd('/'), config.SonarrApiKey.Trim(), startDate, endDate))
            : Task.FromResult(new List<CalEvent>());
        var tmdbTask = includeGlobal && hasTmdb
            ? RunAsync("tmdb", errors, () => GetTmdbAsync(config.TmdbApiKey.Trim(), startDate, endDate, language, countryCode))
            : Task.FromResult(new List<CalEvent>());

        await Task.WhenAll(radarrTask, sonarrTask, tmdbTask).ConfigureAwait(false);

        List<CalEvent> radarr = radarrTask.Result;
        List<CalEvent> sonarr = sonarrTask.Result;
        List<CalEvent> tmdb = tmdbTask.Result;

        // Un film gia' presente in Radarr nello stesso giorno e con lo stesso tipo di uscita non si ripete.
        var known = new HashSet<string>(
            radarr.Where(e => e.TmdbId.HasValue).Select(e => $"{e.TmdbId}|{e.Release}|{e.Date}"));
        var events = new List<CalEvent>(radarr.Count + sonarr.Count + tmdb.Count);
        events.AddRange(radarr);
        events.AddRange(sonarr);
        events.AddRange(tmdb.Where(e => !(e.TmdbId.HasValue && known.Contains($"{e.TmdbId}|{e.Release}|{e.Date}"))));

        string from = startDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string to = endDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var ordered = events
            .Where(e => string.CompareOrdinal(e.Date, from) >= 0 && string.CompareOrdinal(e.Date, to) <= 0)
            .OrderBy(e => e.Date, StringComparer.Ordinal)
            .ThenBy(e => e.Time ?? string.Empty, StringComparer.Ordinal)
            .ThenBy(e => e.Title, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        return new JsonResult(new { events = ordered, errors, sources = SourcesInfo() }, JsonOptions);
    }

    private static object SourcesInfo()
    {
        Configuration.PluginConfiguration? config = Plugin.Instance?.Configuration;
        return new
        {
            radarr = config is not null && !string.IsNullOrWhiteSpace(config.RadarrUrl) && !string.IsNullOrWhiteSpace(config.RadarrApiKey),
            sonarr = config is not null && !string.IsNullOrWhiteSpace(config.SonarrUrl) && !string.IsNullOrWhiteSpace(config.SonarrApiKey),
            tmdb = config is not null && !string.IsNullOrWhiteSpace(config.TmdbApiKey)
        };
    }

    // ------------------------------------------------------------------ Radarr

    private async Task<List<CalEvent>> GetRadarrAsync(string baseUrl, string key, DateTime start, DateTime end)
    {
        string cacheKey = $"radarr|{baseUrl}|{Ymd(start)}|{Ymd(end)}";
        return await CachedAsync(cacheKey, TimeSpan.FromMinutes(3), async () =>
        {
            string url = $"{baseUrl}/api/v3/calendar?start={Ymd(start)}&end={Ymd(end.AddDays(1))}&unmonitored=false";
            using JsonDocument doc = await GetJsonAsync(url, key).ConfigureAwait(false);
            var list = new List<CalEvent>();
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                return list;
            }

            string from = Ymd(start);
            string to = Ymd(end);
            foreach (JsonElement m in doc.RootElement.EnumerateArray())
            {
                string title = Str(m, "title") ?? string.Empty;
                if (title.Length == 0)
                {
                    continue;
                }

                int? tmdbId = IntN(m, "tmdbId");
                foreach ((string field, string release) in new[] { ("inCinemas", "cinema"), ("digitalRelease", "digital"), ("physicalRelease", "physical") })
                {
                    if (!TryUtc(Str(m, field), out DateTime when))
                    {
                        continue;
                    }

                    string date = Ymd(when);
                    if (string.CompareOrdinal(date, from) < 0 || string.CompareOrdinal(date, to) > 0)
                    {
                        continue;
                    }

                    list.Add(new CalEvent
                    {
                        Id = $"radarr-{IntN(m, "id") ?? tmdbId ?? 0}-{release}",
                        Source = "radarr",
                        Kind = "movie",
                        Release = release,
                        Title = title,
                        Date = date,
                        Poster = Image(m, "poster", "w342"),
                        Backdrop = Image(m, "fanart", "w780"),
                        Overview = Str(m, "overview"),
                        Year = IntN(m, "year"),
                        Runtime = PositiveOrNull(IntN(m, "runtime")),
                        Genres = StrList(m, "genres"),
                        Rating = RadarrRating(m),
                        TmdbId = tmdbId,
                        Monitored = Bool(m, "monitored"),
                        HasFile = Bool(m, "hasFile")
                    });
                }
            }

            return list;
        }).ConfigureAwait(false);
    }

    private static double? RadarrRating(JsonElement m)
    {
        if (m.TryGetProperty("ratings", out JsonElement ratings) && ratings.ValueKind == JsonValueKind.Object)
        {
            foreach (string provider in new[] { "tmdb", "imdb" })
            {
                if (ratings.TryGetProperty(provider, out JsonElement r) && r.ValueKind == JsonValueKind.Object
                    && r.TryGetProperty("value", out JsonElement v) && v.ValueKind == JsonValueKind.Number
                    && v.TryGetDouble(out double d) && d > 0)
                {
                    return Math.Round(d, 1);
                }
            }
        }

        return null;
    }

    // ------------------------------------------------------------------ Sonarr

    private async Task<List<CalEvent>> GetSonarrAsync(string baseUrl, string key, DateTime start, DateTime end)
    {
        string cacheKey = $"sonarr|{baseUrl}|{Ymd(start)}|{Ymd(end)}";
        return await CachedAsync(cacheKey, TimeSpan.FromMinutes(3), async () =>
        {
            string url = $"{baseUrl}/api/v3/calendar?start={Ymd(start)}&end={Ymd(end.AddDays(1))}&unmonitored=false&includeSeries=true";
            using JsonDocument doc = await GetJsonAsync(url, key).ConfigureAwait(false);
            var raw = new List<EpisodeInfo>();
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                return new List<CalEvent>();
            }

            foreach (JsonElement e in doc.RootElement.EnumerateArray())
            {
                if (!TryUtc(Str(e, "airDateUtc") ?? Str(e, "airDate"), out DateTime when))
                {
                    continue;
                }

                JsonElement series = e.TryGetProperty("series", out JsonElement s) && s.ValueKind == JsonValueKind.Object ? s : default;
                string seriesTitle = series.ValueKind == JsonValueKind.Object ? Str(series, "title") ?? string.Empty : string.Empty;
                if (seriesTitle.Length == 0)
                {
                    continue;
                }

                raw.Add(new EpisodeInfo
                {
                    SeriesKey = (series.ValueKind == JsonValueKind.Object ? IntN(series, "id") : null) ?? IntN(e, "seriesId") ?? 0,
                    Series = series,
                    SeriesTitle = seriesTitle,
                    Id = IntN(e, "id") ?? 0,
                    Season = IntN(e, "seasonNumber") ?? 0,
                    Number = IntN(e, "episodeNumber") ?? 0,
                    EpisodeTitle = Str(e, "title"),
                    Overview = Str(e, "overview"),
                    When = when,
                    HasTime = Str(e, "airDateUtc") is not null,
                    HasFile = Bool(e, "hasFile"),
                    Monitored = Bool(e, "monitored"),
                    Runtime = PositiveOrNull(IntN(e, "runtime"))
                });
            }

            var list = new List<CalEvent>();

            // Piu' puntate della stessa serie nello stesso giorno (una stagione intera) diventano un solo evento.
            foreach (var group in raw.GroupBy(x => (x.SeriesKey, Day: Ymd(x.When))))
            {
                var eps = group.OrderBy(x => x.Season).ThenBy(x => x.Number).ToList();
                EpisodeInfo first = eps[0];
                string subtitle;
                if (eps.Count == 1)
                {
                    string code = $"S{first.Season:00}E{first.Number:00}";
                    subtitle = string.IsNullOrWhiteSpace(first.EpisodeTitle) ? code : $"{code} · {first.EpisodeTitle}";
                }
                else if (eps.All(x => x.Season == first.Season))
                {
                    subtitle = $"S{first.Season:00}E{first.Number:00}–E{eps[eps.Count - 1].Number:00}";
                }
                else
                {
                    subtitle = $"{eps.Count}";
                }

                JsonElement ser = first.Series;
                bool hasSeries = ser.ValueKind == JsonValueKind.Object;
                list.Add(new CalEvent
                {
                    Id = $"sonarr-{first.SeriesKey}-{group.Key.Day}",
                    Source = "sonarr",
                    Kind = "episode",
                    Release = "episode",
                    Title = first.SeriesTitle,
                    Subtitle = subtitle,
                    Count = eps.Count,
                    Date = group.Key.Day,
                    Time = first.HasTime ? first.When.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture) : null,
                    Poster = hasSeries ? Image(ser, "poster", "w342") : null,
                    Backdrop = hasSeries ? Image(ser, "fanart", "w780") : null,
                    Overview = !string.IsNullOrWhiteSpace(first.Overview) && eps.Count == 1
                        ? first.Overview
                        : (hasSeries ? Str(ser, "overview") : first.Overview),
                    Year = hasSeries ? IntN(ser, "year") : null,
                    Runtime = first.Runtime ?? (hasSeries ? PositiveOrNull(IntN(ser, "runtime")) : null),
                    Genres = hasSeries ? StrList(ser, "genres") : null,
                    Rating = hasSeries ? SonarrRating(ser) : null,
                    Network = hasSeries ? Str(ser, "network") : null,
                    TmdbId = hasSeries ? IntN(ser, "tmdbId") : null,
                    TvdbId = hasSeries ? IntN(ser, "tvdbId") : null,
                    Monitored = eps.Any(x => x.Monitored),
                    HasFile = eps.All(x => x.HasFile)
                });
            }

            return list;
        }).ConfigureAwait(false);
    }

    private static double? SonarrRating(JsonElement series)
    {
        if (series.TryGetProperty("ratings", out JsonElement r) && r.ValueKind == JsonValueKind.Object
            && r.TryGetProperty("value", out JsonElement v) && v.ValueKind == JsonValueKind.Number
            && v.TryGetDouble(out double d) && d > 0)
        {
            return Math.Round(d, 1);
        }

        return null;
    }

    // -------------------------------------------------------------------- TMDB

    private async Task<List<CalEvent>> GetTmdbAsync(string key, DateTime start, DateTime end, string language, string region)
    {
        string cacheKey = $"tmdb|{Ymd(start)}|{Ymd(end)}|{language}|{region}";
        return await CachedAsync(cacheKey, TimeSpan.FromMinutes(30), async () =>
        {
            string tmdbLang = language == "it" ? "it-IT" : "en-US";
            int langIndex = language == "it" ? 0 : 1;
            string from = Ymd(start);
            string to = Ymd(end);
            string common = $"api_key={Uri.EscapeDataString(key)}&language={tmdbLang}&sort_by=popularity.desc&include_adult=false";

            // Film in sala (tipi 2 e 3) e in digitale (tipo 4), 2 pagine ciascuno; serie al loro debutto.
            var tasks = new List<Task<List<CalEvent>>>();
            foreach (int page in new[] { 1, 2 })
            {
                tasks.Add(TmdbMoviesAsync(common, region, "2|3", "cinema", from, to, page, key, langIndex));
                tasks.Add(TmdbMoviesAsync(common, region, "4", "digital", from, to, page, key, langIndex));
                tasks.Add(TmdbSeriesAsync(common, from, to, page, langIndex));
            }

            var settled = new List<List<CalEvent>>();
            Exception? firstError = null;
            foreach (Task<List<CalEvent>> t in tasks)
            {
                try
                {
                    settled.Add(await t.ConfigureAwait(false));
                }
                catch (Exception ex)
                {
                    firstError ??= ex;
                }
            }

            if (settled.Count == 0 && firstError is not null)
            {
                throw firstError;
            }

            // Uno stesso titolo trovato in piu' pagine non si ripete.
            return settled.SelectMany(x => x).GroupBy(x => x.Id).Select(g => g.First()).ToList();
        }).ConfigureAwait(false);
    }

    private async Task<List<CalEvent>> TmdbMoviesAsync(string common, string region, string types, string release, string from, string to, int page, string key, int langIndex)
    {
        string url = $"{TmdbBaseUrl}/discover/movie?{common}&region={region}&with_release_type={Uri.EscapeDataString(types)}"
            + $"&release_date.gte={from}&release_date.lte={to}&page={page}";
        using JsonDocument doc = await GetJsonAsync(url, null).ConfigureAwait(false);
        var list = new List<CalEvent>();
        if (!doc.RootElement.TryGetProperty("results", out JsonElement results) || results.ValueKind != JsonValueKind.Array)
        {
            return list;
        }

        var movies = results.EnumerateArray().Select(x => x.Clone()).Where(x => IntN(x, "id").HasValue).ToList();
        var dates = await Task.WhenAll(movies.Select(m => TmdbReleaseDateAsync(IntN(m, "id")!.Value, region, types, from, to, Str(m, "release_date"), key))).ConfigureAwait(false);

        for (int i = 0; i < movies.Count; i++)
        {
            JsonElement m = movies[i];
            string? date = dates[i];
            string? poster = Str(m, "poster_path");
            if (date is null || string.IsNullOrEmpty(poster))
            {
                continue;
            }

            int id = IntN(m, "id")!.Value;
            list.Add(new CalEvent
            {
                Id = $"tmdb-m{id}-{release}",
                Source = "tmdb",
                Kind = "movie",
                Release = release,
                Title = Str(m, "title") ?? Str(m, "original_title") ?? string.Empty,
                Date = date,
                Poster = "https://image.tmdb.org/t/p/w342" + poster,
                Backdrop = Str(m, "backdrop_path") is string b && b.Length > 0 ? "https://image.tmdb.org/t/p/w780" + b : null,
                Overview = Str(m, "overview"),
                Year = YearOf(Str(m, "release_date")),
                Genres = GenreNames(m, langIndex),
                Rating = VoteAverage(m),
                TmdbId = id
            });
        }

        return list;
    }

    private async Task<List<CalEvent>> TmdbSeriesAsync(string common, string from, string to, int page, int langIndex)
    {
        string url = $"{TmdbBaseUrl}/discover/tv?{common}&first_air_date.gte={from}&first_air_date.lte={to}&page={page}";
        using JsonDocument doc = await GetJsonAsync(url, null).ConfigureAwait(false);
        var list = new List<CalEvent>();
        if (!doc.RootElement.TryGetProperty("results", out JsonElement results) || results.ValueKind != JsonValueKind.Array)
        {
            return list;
        }

        foreach (JsonElement s in results.EnumerateArray())
        {
            int? id = IntN(s, "id");
            string? poster = Str(s, "poster_path");
            string? date = Str(s, "first_air_date");
            if (!id.HasValue || string.IsNullOrEmpty(poster) || !TryUtc(date, out DateTime when))
            {
                continue;
            }

            list.Add(new CalEvent
            {
                Id = $"tmdb-t{id}",
                Source = "tmdb",
                Kind = "series",
                Release = "premiere",
                Title = Str(s, "name") ?? Str(s, "original_name") ?? string.Empty,
                Date = Ymd(when),
                Poster = "https://image.tmdb.org/t/p/w342" + poster,
                Backdrop = Str(s, "backdrop_path") is string b && b.Length > 0 ? "https://image.tmdb.org/t/p/w780" + b : null,
                Overview = Str(s, "overview"),
                Year = YearOf(date),
                Genres = GenreNames(s, langIndex),
                Rating = VoteAverage(s),
                TmdbId = id
            });
        }

        return list;
    }

    /// <summary>
    /// La data di uscita nel paese richiesto: discover indica solo la data "principale" del film, quella
    /// regionale (es. in sala in Italia) si legge da release_dates. Il risultato resta in memoria 12 ore.
    /// </summary>
    private async Task<string?> TmdbReleaseDateAsync(int id, string region, string types, string from, string to, string? fallback, string key)
    {
        string cacheKey = $"{id}|{region}|{types}|{from}|{to}";
        if (ReleaseDateCache.TryGetValue(cacheKey, out DateEntry? cached) && DateTime.UtcNow - cached.At < TimeSpan.FromHours(12))
        {
            return cached.Date;
        }

        string? found = null;
        await TmdbGate.WaitAsync().ConfigureAwait(false);
        try
        {
            string url = $"{TmdbBaseUrl}/movie/{id}/release_dates?api_key={Uri.EscapeDataString(key)}";
            using JsonDocument doc = await GetJsonAsync(url, null).ConfigureAwait(false);
            var wanted = new HashSet<int>(types.Split('|').Select(x => int.Parse(x, CultureInfo.InvariantCulture)));
            if (doc.RootElement.TryGetProperty("results", out JsonElement results) && results.ValueKind == JsonValueKind.Array)
            {
                foreach (JsonElement country in results.EnumerateArray())
                {
                    if (!string.Equals(Str(country, "iso_3166_1"), region, StringComparison.OrdinalIgnoreCase)
                        || !country.TryGetProperty("release_dates", out JsonElement rds)
                        || rds.ValueKind != JsonValueKind.Array)
                    {
                        continue;
                    }

                    foreach (JsonElement rd in rds.EnumerateArray())
                    {
                        int type = IntN(rd, "type") ?? 0;
                        if (!wanted.Contains(type) || !TryUtc(Str(rd, "release_date"), out DateTime when))
                        {
                            continue;
                        }

                        string date = Ymd(when);
                        if (string.CompareOrdinal(date, from) >= 0 && string.CompareOrdinal(date, to) <= 0
                            && (found is null || string.CompareOrdinal(date, found) < 0))
                        {
                            found = date;
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            // Un titolo senza data precisa non fa fallire tutto il calendario: si usa la data principale.
            _logger.LogDebug(ex, "Owlfin Calendario: release_dates non disponibili per {Id}", id);
        }
        finally
        {
            TmdbGate.Release();
        }

        if (found is null && TryUtc(fallback, out DateTime fb))
        {
            string d = Ymd(fb);
            if (string.CompareOrdinal(d, from) >= 0 && string.CompareOrdinal(d, to) <= 0)
            {
                found = d;
            }
        }

        ReleaseDateCache[cacheKey] = new DateEntry { At = DateTime.UtcNow, Date = found };
        if (ReleaseDateCache.Count > 5000)
        {
            ReleaseDateCache.Clear();
        }

        return found;
    }

    private static List<string>? GenreNames(JsonElement e, int langIndex)
    {
        if (!e.TryGetProperty("genre_ids", out JsonElement ids) || ids.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var names = new List<string>();
        foreach (JsonElement id in ids.EnumerateArray())
        {
            if (id.ValueKind == JsonValueKind.Number && id.TryGetInt32(out int g) && Genres.TryGetValue(g, out string[]? n))
            {
                names.Add(n[langIndex]);
                if (names.Count == 3)
                {
                    break;
                }
            }
        }

        return names.Count == 0 ? null : names;
    }

    private static double? VoteAverage(JsonElement e)
    {
        return e.TryGetProperty("vote_average", out JsonElement v) && v.ValueKind == JsonValueKind.Number
            && v.TryGetDouble(out double d) && d > 0
            ? Math.Round(d, 1)
            : null;
    }

    private static int? YearOf(string? date)
    {
        return !string.IsNullOrEmpty(date) && date.Length >= 4 && int.TryParse(date.AsSpan(0, 4), NumberStyles.None, CultureInfo.InvariantCulture, out int y) && y > 1800
            ? y
            : null;
    }

    // ----------------------------------------------------------------- comuni

    private async Task<T> RunAsync<T>(string name, List<SourceError> errors, Func<Task<T>> work)
        where T : new()
    {
        try
        {
            return await work().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            string message = ex switch
            {
                HttpRequestException h when h.StatusCode.HasValue => $"HTTP {(int)h.StatusCode.Value}",
                HttpRequestException => "non raggiungibile",
                TaskCanceledException => "timeout",
                OperationCanceledException => "timeout",
                _ => "errore"
            };
            _logger.LogWarning(ex, "Owlfin Calendario: fonte {Source} non disponibile ({Message})", name, message);
            lock (errors)
            {
                errors.Add(new SourceError { Source = name, Message = message });
            }

            return new T();
        }
    }

    private static async Task<List<CalEvent>> CachedAsync(string key, TimeSpan ttl, Func<Task<List<CalEvent>>> factory)
    {
        if (Cache.TryGetValue(key, out CacheEntry? hit) && DateTime.UtcNow - hit.At < ttl)
        {
            return hit.Events;
        }

        List<CalEvent> fresh = await factory().ConfigureAwait(false);
        if (Cache.Count > 200)
        {
            Cache.Clear();
        }

        Cache[key] = new CacheEntry { At = DateTime.UtcNow, Events = fresh };
        return fresh;
    }

    private static async Task<JsonDocument> GetJsonAsync(string url, string? apiKey)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (apiKey is not null)
        {
            req.Headers.Add("X-Api-Key", apiKey);
        }

        using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
        res.EnsureSuccessStatusCode();
        string text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
        return JsonDocument.Parse(text);
    }

    private static string Ymd(DateTime d)
    {
        return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    private static bool TryUtc(string? s, out DateTime utc)
    {
        utc = default;
        return !string.IsNullOrWhiteSpace(s)
            && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out utc);
    }

    private static string? Image(JsonElement e, string coverType, string tmdbSize)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty("images", out JsonElement images) || images.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (JsonElement img in images.EnumerateArray())
        {
            if (!string.Equals(Str(img, "coverType"), coverType, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            // Solo indirizzi pubblici (TMDB, TheTVDB): quelli locali di Radarr/Sonarr richiederebbero la API key.
            string? url = Str(img, "remoteUrl");
            if (!string.IsNullOrEmpty(url) && url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            {
                return url.Replace("/t/p/original/", $"/t/p/{tmdbSize}/", StringComparison.Ordinal);
            }
        }

        return null;
    }

    private static string? Str(JsonElement e, string name)
    {
        return e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out JsonElement p) && p.ValueKind == JsonValueKind.String
            ? p.GetString()
            : null;
    }

    private static int? IntN(JsonElement e, string name)
    {
        return e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out JsonElement p) && p.ValueKind == JsonValueKind.Number && p.TryGetInt32(out int v)
            ? v
            : null;
    }

    private static int? PositiveOrNull(int? v)
    {
        return v.HasValue && v.Value > 0 ? v : null;
    }

    private static bool Bool(JsonElement e, string name)
    {
        return e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out JsonElement p) && p.ValueKind == JsonValueKind.True;
    }

    private static List<string>? StrList(JsonElement e, string name)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out JsonElement p) || p.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        List<string> list = p.EnumerateArray()
            .Where(x => x.ValueKind == JsonValueKind.String)
            .Select(x => x.GetString() ?? string.Empty)
            .Where(x => x.Length > 0)
            .Take(3)
            .ToList();
        return list.Count == 0 ? null : list;
    }

    private async Task<bool> IsAuthenticatedAsync()
    {
        foreach (string? scheme in new string?[] { "CustomAuthentication", null })
        {
            try
            {
                AuthenticateResult result = scheme is null
                    ? await HttpContext.AuthenticateAsync().ConfigureAwait(false)
                    : await HttpContext.AuthenticateAsync(scheme).ConfigureAwait(false);
                if (result.Succeeded)
                {
                    return true;
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Owlfin Calendario: schema di autenticazione {Scheme} non disponibile", scheme ?? "(predefinito)");
            }
        }

        return false;
    }

    private sealed class CacheEntry
    {
        public DateTime At { get; set; }

        public List<CalEvent> Events { get; set; } = new List<CalEvent>();
    }

    private sealed class DateEntry
    {
        public DateTime At { get; set; }

        public string? Date { get; set; }
    }

    private sealed class SourceError
    {
        public string Source { get; set; } = string.Empty;

        public string Message { get; set; } = string.Empty;
    }

    private sealed class EpisodeInfo
    {
        public int SeriesKey { get; set; }

        public JsonElement Series { get; set; }

        public string SeriesTitle { get; set; } = string.Empty;

        public int Id { get; set; }

        public int Season { get; set; }

        public int Number { get; set; }

        public string? EpisodeTitle { get; set; }

        public string? Overview { get; set; }

        public DateTime When { get; set; }

        public bool HasTime { get; set; }

        public bool HasFile { get; set; }

        public bool Monitored { get; set; }

        public int? Runtime { get; set; }
    }

    private sealed class CalEvent
    {
        public string Id { get; set; } = string.Empty;

        public string Source { get; set; } = string.Empty;

        public string Kind { get; set; } = string.Empty;

        public string Release { get; set; } = string.Empty;

        public string Title { get; set; } = string.Empty;

        public string? Subtitle { get; set; }

        public int? Count { get; set; }

        public string Date { get; set; } = string.Empty;

        public string? Time { get; set; }

        public string? Poster { get; set; }

        public string? Backdrop { get; set; }

        public string? Overview { get; set; }

        public int? Year { get; set; }

        public int? Runtime { get; set; }

        public List<string>? Genres { get; set; }

        public double? Rating { get; set; }

        public string? Network { get; set; }

        public int? TmdbId { get; set; }

        public int? TvdbId { get; set; }

        public bool Monitored { get; set; }

        public bool? HasFile { get; set; }
    }
}
