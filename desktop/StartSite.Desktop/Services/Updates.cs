// Aktualizace přes Velopack z GitHub Releases repozitáře StartSite.
using System.Diagnostics;
using System.Text.Json;
using Velopack;
using Velopack.Sources;

namespace StartSite.Desktop.Services;

public sealed class UpdateService(BackendHost host, ApiClient api)
{
    public const string RepoUrl = "https://github.com/hrabafh-debug/StartSite";

    readonly UpdateManager manager = new(new GithubSource(RepoUrl, null, false));
    UpdateInfo? pending;

    /// <summary>Aktualizace dávají smysl jen v nainstalované verzi, ne při vývoji z repa.</summary>
    public bool IsInstalled => manager.IsInstalled;

    public string CurrentVersion => manager.CurrentVersion?.ToString() ?? AppInfo.Current.VersionString;

    /// <summary>Vrátí číslo nové verze, nebo null, když je aplikace aktuální.</summary>
    public async Task<string?> CheckAsync()
    {
        if (!IsInstalled) return null;
        pending = await manager.CheckForUpdatesAsync();
        return pending?.TargetFullRelease.Version.ToString();
    }

    /// <summary>Stáhne aktualizaci, uvolní soubory aplikace a restartuje do nové verze.</summary>
    public async Task ApplyAsync(Action<int> progress)
    {
        if (pending == null) return;
        await manager.DownloadUpdatesAsync(pending, progress);
        await ReleaseAppFilesAsync();
        manager.ApplyUpdatesAndRestart(pending);
    }

    /// <summary>
    /// Backend a statické weby běží z přibaleného node.exe ve složce aplikace a drží její soubory.
    /// Ostatní projekty běží ze svých složek, ty nová verze po startu převezme.
    /// </summary>
    async Task ReleaseAppFilesAsync()
    {
        try
        {
            foreach (var p in await api.ListAsync())
            {
                if (p.Kind == "static" && p.Runtime.Status is "running" or "starting") await api.StopAsync(p.Id);
            }
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var health = JsonDocument.Parse(await http.GetStringAsync($"{host.BaseUrl}/api/health"));
            if (health.RootElement.TryGetProperty("pid", out var pid))
            {
                using var backend = Process.GetProcessById(pid.GetInt32());
                backend.Kill(entireProcessTree: false);
                await backend.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            }
        }
        catch
        {
            // Backend neběží nebo už skončil, soubory jsou volné
        }
    }
}
