using System;
using Jellyfin.Plugin.Owlfin.Helpers;
using Jellyfin.Plugin.Owlfin.Model;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Owlfin.Api;

/// <summary>
/// General chat between users of this server. The client sends its own
/// userId with each call (same trust model already used by
/// <c>Web/genres.js</c> and <c>Web/nextepisode.js</c> elsewhere in this
/// plugin -- there is no separate authorization check here beyond that),
/// and the server resolves the display name via <see cref="IUserManager"/>
/// so a client can never claim to be someone else's username.
/// </summary>
[ApiController]
[Route("Owlfin/Chat")]
public class ChatController : ControllerBase
{
    private const int MaxMessageLength = 1000;

    private readonly IUserManager _userManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="ChatController"/> class.
    /// </summary>
    /// <param name="userManager">Instance of the <see cref="IUserManager"/> interface.</param>
    public ChatController(IUserManager userManager)
    {
        _userManager = userManager;
    }

    /// <summary>
    /// Request body for <see cref="PostMessage"/>.
    /// </summary>
    public class PostChatMessageRequest
    {
        /// <summary>
        /// Gets or sets the id of the sending user.
        /// </summary>
        public Guid UserId { get; set; }

        /// <summary>
        /// Gets or sets the message text.
        /// </summary>
        public string Text { get; set; } = string.Empty;
    }

    /// <summary>
    /// Returns chat messages, either the full history or (with
    /// <paramref name="since"/>) only messages newer than that timestamp,
    /// for polling.
    /// </summary>
    [HttpGet("Messages")]
    public ActionResult GetMessages([FromQuery] DateTime? since)
    {
        System.Collections.Generic.List<ChatMessage> messages = since.HasValue
            ? ChatStorage.GetMessagesSince(since.Value)
            : ChatStorage.GetAll();

        return new JsonResult(new { messages });
    }

    /// <summary>
    /// Appends a new chat message.
    /// </summary>
    [HttpPost("Messages")]
    public ActionResult PostMessage([FromBody] PostChatMessageRequest request)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Text))
        {
            return BadRequest();
        }

        string text = request.Text.Trim();
        if (text.Length > MaxMessageLength)
        {
            text = text[..MaxMessageLength];
        }

        var user = _userManager.GetUserById(request.UserId);
        string username = user?.Username ?? "Utente";

        ChatMessage saved = ChatStorage.Append(request.UserId, username, text);
        return new JsonResult(saved);
    }
}
