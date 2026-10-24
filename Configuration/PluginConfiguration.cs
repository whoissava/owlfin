using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Owlfin.Configuration;

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PluginConfiguration"/> class.
    /// </summary>
    public PluginConfiguration()
    {
        CategoriesEnabled = true;
        StudiosEnabled = true;
        GenresEnabled = true;
        ChatEnabled = true;
        TrendingEnabled = false;
        TmdbApiKey = string.Empty;
        SonarrEnabled = false;
        SonarrUrl = string.Empty;
        SonarrApiKey = string.Empty;
        PopupEnabled = true;
        TrendingClientEnabled = false;
        SearchGridEnabled = true;
        DiscoverEnabled = true;
        SeerrUrl = string.Empty;
        SeerrApiKey = string.Empty;
        GenresOnHome = false;
        CalendarEnabled = true;
        RadarrUrl = string.Empty;
        RadarrApiKey = string.Empty;
    }

    /// <summary>
    /// Gets or sets a value indicating whether the genre filter bar
    /// (categories.js) is injected into the web client. Restart Jellyfin
    /// after changing this.
    /// </summary>
    public bool CategoriesEnabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the studio/platform rows
    /// (studio.js) are injected into the web client. Restart Jellyfin
    /// after changing this.
    /// </summary>
    public bool StudiosEnabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the Netflix-style genre
    /// browser overlay (genres.js) is injected into the web client.
    /// Restart Jellyfin after changing this.
    /// </summary>
    public bool GenresEnabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the general chat between
    /// users (chat.js) is injected into the web client. Restart Jellyfin
    /// after changing this.
    /// </summary>
    public bool ChatEnabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the TMDB trending Top 10
    /// banner (trending.js) is injected into the web client's Home page.
    /// Requires <see cref="TmdbApiKey"/>. Restart Jellyfin after changing this.
    /// </summary>
    public bool TrendingEnabled { get; set; }

    /// <summary>
    /// Gets or sets the TMDB API key (v3 auth), used only in server-side
    /// requests from <see cref="Api.TrendingController"/> -- never sent to
    /// the browser. Get a free key at themoviedb.org.
    /// </summary>
    public string TmdbApiKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the "next episode airs on"
    /// indicator (nextepisode.js, backed by Sonarr) is injected into the
    /// web client. Restart Jellyfin after changing this.
    /// </summary>
    public bool SonarrEnabled { get; set; }

    /// <summary>
    /// Gets or sets the base URL of the user's Sonarr instance, e.g.
    /// http://localhost:8989. Called server-side only -- never sent to the
    /// browser.
    /// </summary>
    public string SonarrUrl { get; set; }

    /// <summary>
    /// Gets or sets the Sonarr API key. Used only in server-side requests
    /// from <see cref="Api.SonarrController"/> -- never sent to the browser.
    /// </summary>
    public string SonarrApiKey { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the season popup
    /// (popup10-1.js) is injected into the web client's series detail page.
    /// Restart Jellyfin after changing this.
    /// </summary>
    public bool PopupEnabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the client-side trending
    /// section (trending.js) is injected into the web client home page.
    /// Requires a valid TmdbApiKey. Restart Jellyfin after changing this.
    /// </summary>
    public bool TrendingClientEnabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the search suggestions
    /// are replaced with a random poster grid (search.js).
    /// </summary>
    public bool SearchGridEnabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the full-screen trailer
    /// feed (jellytok.js) is injected into the web client.
    /// </summary>
    public bool DiscoverEnabled { get; set; }

    /// <summary>
    /// Gets or sets the base URL of the user's Seerr instance (Jellyseerr/Overseerr),
    /// e.g. http://localhost:5055. Called server-side only.
    /// </summary>
    public string SeerrUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Seerr API key. Used only server-side by the Seerr proxy controller.
    /// </summary>
    public string SeerrApiKey { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets a value indicating whether the genres sections
    /// (genres.js) are also shown at the bottom of the home page.
    /// Restart Jellyfin after changing this.
    /// </summary>
    public bool GenresOnHome { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the release calendar
    /// (calendar.js) is injected into the web client. Restart Jellyfin
    /// after changing this.
    /// </summary>
    public bool CalendarEnabled { get; set; }

    /// <summary>
    /// Gets or sets the base URL of the user's Radarr instance, e.g.
    /// http://localhost:7878. Called server-side only.
    /// </summary>
    public string RadarrUrl { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the Radarr API key. Used only server-side by the calendar controller.
    /// </summary>
    public string RadarrApiKey { get; set; } = string.Empty;
}
