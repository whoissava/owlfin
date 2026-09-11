using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Jellyfin.Plugin.Owlfin.Model;

namespace Jellyfin.Plugin.Owlfin.Helpers;

/// <summary>
/// Append-only, unlimited chat history. Stored as newline-delimited JSON
/// (one message per line) in the plugin's own data folder, so appending
/// never requires rewriting the whole file. The in-memory list is loaded
/// once and kept as the source of truth for reads; writes go to memory
/// and disk together under a lock.
/// </summary>
public static class ChatStorage
{
    private static readonly object Lock = new();
    private static List<ChatMessage>? _cache;

    private static string FilePath =>
        Path.Combine(Plugin.Instance!.DataFolderPath, "chat.jsonl");

    /// <summary>
    /// Returns every message, oldest first.
    /// </summary>
    public static List<ChatMessage> GetAll()
    {
        lock (Lock)
        {
            EnsureLoaded();
            return _cache!.OrderBy(m => m.TimestampUtc).ToList();
        }
    }

    /// <summary>
    /// Returns messages strictly after the given UTC timestamp, oldest first.
    /// Used for polling.
    /// </summary>
    public static List<ChatMessage> GetMessagesSince(DateTime sinceUtc)
    {
        lock (Lock)
        {
            EnsureLoaded();
            return _cache!.Where(m => m.TimestampUtc > sinceUtc).OrderBy(m => m.TimestampUtc).ToList();
        }
    }

    /// <summary>
    /// Appends a new message and persists it immediately.
    /// </summary>
    public static ChatMessage Append(Guid userId, string username, string text)
    {
        var message = new ChatMessage
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Username = username,
            Text = text,
            TimestampUtc = DateTime.UtcNow
        };

        lock (Lock)
        {
            EnsureLoaded();
            _cache!.Add(message);

            string? dir = Path.GetDirectoryName(FilePath);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            File.AppendAllText(FilePath, JsonSerializer.Serialize(message) + Environment.NewLine);
        }

        return message;
    }

    private static void EnsureLoaded()
    {
        if (_cache is not null)
        {
            return;
        }

        _cache = new List<ChatMessage>();
        if (!File.Exists(FilePath))
        {
            return;
        }

        foreach (string line in File.ReadAllLines(FilePath))
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                ChatMessage? msg = JsonSerializer.Deserialize<ChatMessage>(line);
                if (msg is not null)
                {
                    _cache.Add(msg);
                }
            }
            catch (JsonException)
            {
                // Riga corrotta (es. scrittura interrotta a metà) - la saltiamo,
                // non blocchiamo la lettura di tutto il resto dello storico.
            }
        }
    }
}
