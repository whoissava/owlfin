using System.Reflection;
using System.Text.RegularExpressions;
using Jellyfin.Plugin.Owlfin.Model;

namespace Jellyfin.Plugin.Owlfin.Helpers;

/// <summary>
/// Callback methods invoked by the File Transformation plugin to patch served files.
/// </summary>
public static class TransformationPatches
{
    /// <summary>
    /// Inserts each enabled script (categories.js and/or studio.js), inlined
    /// verbatim, just before &lt;/body&gt;. Each is independently toggled via
    /// <see cref="Configuration.PluginConfiguration"/>.
    /// </summary>
    /// <param name="payload">The current contents of index.html.</param>
    /// <returns>The patched contents.</returns>
    public static string IndexHtml(PatchRequestPayload payload)
    {
        string contents = payload.Contents ?? string.Empty;

        if (Plugin.Instance is null)
        {
            return contents;
        }

        Configuration.PluginConfiguration config = Plugin.Instance.Configuration;
        string scripts = string.Empty;

        if (config.CategoriesEnabled)
        {
            scripts += BuildScriptElement("Owlfin-Categories", "Web.categories.js");
        }

        if (config.StudiosEnabled)
        {
            scripts += BuildScriptElement("Owlfin-Studio", "Web.studio.js");
        }

        if (config.SonarrEnabled)
        {
            scripts += BuildScriptElement("Owlfin-Sonarr", "Web.nextepisode.js");
        }

        if (config.GenresEnabled)
        {
            scripts += BuildScriptElement("Owlfin-Genres", "Web.genres.js");
        }

        if (config.ChatEnabled)
        {
            scripts += BuildScriptElement("Owlfin-Chat", "Web.chat.js");
        }

        if (string.IsNullOrEmpty(scripts))
        {
            return contents;
        }

        return Regex.Replace(contents, "(</body>)", $"{scripts}$1");
    }

    private static string BuildScriptElement(string marker, string embeddedResourceSuffix)
    {
        string script = ReadEmbeddedScript(embeddedResourceSuffix);
        if (string.IsNullOrEmpty(script))
        {
            return string.Empty;
        }

        return $"<script plugin=\"{marker}\" defer=\"defer\">{script}</script>";
    }

    private static string ReadEmbeddedScript(string embeddedResourceSuffix)
    {
        string resourceName = $"{typeof(Plugin).Namespace}.{embeddedResourceSuffix}";
        using System.IO.Stream? stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            return string.Empty;
        }

        using var reader = new System.IO.StreamReader(stream);
        return reader.ReadToEnd();
    }
}
