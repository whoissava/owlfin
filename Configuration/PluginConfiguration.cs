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
        SonarrEnabled = false;
        SonarrUrl = string.Empty;
        SonarrApiKey = string.Empty;
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
}
