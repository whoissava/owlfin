namespace Jellyfin.Plugin.Owlfin.Model;

/// <summary>
/// The object the File Transformation plugin passes to a registered callback,
/// containing the current contents of the file being served.
/// </summary>
public class PatchRequestPayload
{
    /// <summary>
    /// Gets or sets the current contents of the file being requested.
    /// </summary>
    public string? Contents { get; set; }
}
