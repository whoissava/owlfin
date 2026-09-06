using System.Reflection;
using System.Runtime.Loader;
using Jellyfin.Plugin.Owlfin.Helpers;
using MediaBrowser.Model.Tasks;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace Jellyfin.Plugin.Owlfin.Services;

/// <summary>
/// Runs once at server startup. Finds the (separately installed) File Transformation
/// plugin among the loaded assemblies and, via reflection, registers our index.html
/// patch with it -- this is the documented way to depend on that plugin, since
/// Jellyfin loads each plugin into its own assembly load context so a normal project
/// reference isn't possible. See:
/// https://github.com/IAmParadox27/jellyfin-plugin-file-transformation.
/// </summary>
public class StartupTask : IScheduledTask
{
    private readonly ILogger<StartupTask> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="StartupTask"/> class.
    /// </summary>
    /// <param name="logger">Instance of the <see cref="ILogger{StartupTask}"/> interface.</param>
    public StartupTask(ILogger<StartupTask> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public string Name => "Categories Browser Startup";

    /// <inheritdoc />
    public string Key => "Jellyfin.Plugin.Owlfin.Startup";

    /// <inheritdoc />
    public string Description => "Registers the Categories Browser index.html patch with File Transformation.";

    /// <inheritdoc />
    public string Category => "Startup Services";

    /// <inheritdoc />
    public Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken)
    {
        JObject payload = new JObject
        {
            { "id", "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b" },
            { "fileNamePattern", "index.html" },
            { "callbackAssembly", GetType().Assembly.FullName },
            { "callbackClass", typeof(TransformationPatches).FullName },
            { "callbackMethod", nameof(TransformationPatches.IndexHtml) }
        };

        Assembly? fileTransformationAssembly = AssemblyLoadContext.All
            .SelectMany(x => x.Assemblies)
            .FirstOrDefault(x => x.FullName?.Contains(".FileTransformation") ?? false);

        if (fileTransformationAssembly is null)
        {
            _logger.LogWarning(
                "File Transformation plugin not found -- Categories Browser cannot inject its script. " +
                "Install it and restart Jellyfin.");
            return Task.CompletedTask;
        }

        Type? pluginInterfaceType = fileTransformationAssembly.GetType("Jellyfin.Plugin.FileTransformation.PluginInterface");
        if (pluginInterfaceType is null)
        {
            _logger.LogWarning("Found File Transformation assembly but could not resolve its PluginInterface type.");
            return Task.CompletedTask;
        }

        pluginInterfaceType.GetMethod("RegisterTransformation")?.Invoke(null, new object?[] { payload });
        _logger.LogInformation("Categories Browser registered its index.html patch with File Transformation.");

        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        yield return new TaskTriggerInfo
        {
            Type = TaskTriggerInfoType.StartupTrigger
        };
    }
}
