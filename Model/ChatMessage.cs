using System;

namespace Jellyfin.Plugin.Owlfin.Model;

/// <summary>
/// A single message in the general chat between users.
/// </summary>
public class ChatMessage
{
    /// <summary>
    /// Gets or sets the message id.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Gets or sets the id of the Jellyfin user who sent the message.
    /// </summary>
    public Guid UserId { get; set; }

    /// <summary>
    /// Gets or sets the display name of the sender, resolved server-side
    /// via <see cref="MediaBrowser.Controller.Library.IUserManager"/> so the
    /// client never has to be trusted for it.
    /// </summary>
    public string Username { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the message text.
    /// </summary>
    public string Text { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the UTC timestamp the message was received.
    /// </summary>
    public DateTime TimestampUtc { get; set; }
}
