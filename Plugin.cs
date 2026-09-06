using System;
using System.Collections.Generic;
using Jellyfin.Plugin.Owlfin.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Owlfin;

/// <summary>
/// Adds a horizontal, tap-to-filter genre bar to the Jellyfin web client's home
/// screen. The actual index.html patch is registered with the (separately
/// installed) File Transformation plugin at startup -- see
/// <see cref="Services.StartupTask"/> and <see cref="Helpers.TransformationPatches"/>.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface.</param>
    /// <param name="xmlSerializer">Instance of the <see cref="IXmlSerializer"/> interface.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    /// <summary>
    /// Gets the current plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "Owlfin";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("b13839a6-5916-4f75-aed9-331901b8e3e6");

    /// <inheritdoc />
    public override string Description => "Barra dei generi, righe per studio e prossimo episodio (Sonarr), attivabili singolarmente.";

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        return
        [
            new PluginPageInfo
            {
                Name = Name,
                EmbeddedResourcePath = $"{GetType().Namespace}.Configuration.configPage.html"
            }
        ];
    }
}
