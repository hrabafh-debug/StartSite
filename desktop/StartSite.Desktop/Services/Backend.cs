// Spojení s Node backendem: jeho spuštění, HTTP API a živé události (SSE).
using System.Diagnostics;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using StartSite.Desktop.Models;

namespace StartSite.Desktop.Services;

public sealed class ApiException(ApiError body) : Exception(string.IsNullOrEmpty(body.Message) ? body.Error : body.Message)
{
    public ApiError Body { get; } = body;
}

/// <summary>Najde repo se StartSite a spustí backend, když neběží.</summary>
public sealed class BackendHost
{
    public int Port { get; } = int.TryParse(Environment.GetEnvironmentVariable("STARTSITE_PORT"), out var p) ? p : 4500;
    public string BaseUrl => $"http://127.0.0.1:{Port}";
    public string? RepoRoot { get; } = FindRepoRoot();

    static string? FindRepoRoot()
    {
        var fromEnv = Environment.GetEnvironmentVariable("STARTSITE_ROOT");
        if (!string.IsNullOrEmpty(fromEnv) && File.Exists(Path.Combine(fromEnv, "server", "dist", "index.js"))) return fromEnv;
        // Aplikace leží v <repo>/desktop/..., stačí jít nahoru
        // Instalace: backend leží ve složce backend vedle StartSite.exe
        var bundled = Path.Combine(AppContext.BaseDirectory, "backend");
        if (File.Exists(Path.Combine(bundled, "server", "dist", "index.js"))) return bundled;
        // Vývoj: aplikace leží v <repo>/desktop/..., stačí jít nahoru
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "server", "dist", "index.js"))) return dir.FullName;
        }
        return null;
    }

    /// <summary>Přibalený node.exe v instalaci, jinak node z PATH.</summary>
    public string NodeExe => RepoRoot != null && File.Exists(Path.Combine(RepoRoot, "node", "node.exe"))
        ? Path.Combine(RepoRoot, "node", "node.exe")
        : "node";

    /// <summary>Stejná logika jako server/src/config.ts: instalace má data mimo složku aplikace.</summary>
    public string? DataDir => Environment.GetEnvironmentVariable("STARTSITE_DATA") is { Length: > 0 } env
        ? env
        : RepoRoot == null ? null
        : File.Exists(Path.Combine(RepoRoot, ".installed"))
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StartSiteData")
            : Path.Combine(RepoRoot, "data");

    public async Task<bool> IsUpAsync()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            var text = await http.GetStringAsync($"{BaseUrl}/api/health");
            return text.Contains("startsite");
        }
        catch
        {
            return false;
        }
    }

    public async Task EnsureRunningAsync()
    {
        if (await IsUpAsync()) return;
        if (RepoRoot == null)
            throw new InvalidOperationException("Nenašel jsem sestavený backend (server/dist/index.js). V repu spusť npm install a npm run build, případně nastav STARTSITE_ROOT.");

        var entry = Path.Combine(RepoRoot, "server", "dist", "index.js");
        var log = Path.Combine(DataDir!, "server.log");
        Directory.CreateDirectory(Path.GetDirectoryName(log)!);
        // Přes cmd s přesměrováním do souboru: backend pak nezávisí na rourách aplikace a přežije její zavření
        var psi = new ProcessStartInfo("cmd.exe", $"/d /c \"\"{NodeExe}\" \"{entry}\" >> \"{log}\" 2>&1\"")
        {
            WorkingDirectory = RepoRoot,
            CreateNoWindow = true,
            UseShellExecute = false,
        };
        psi.Environment["STARTSITE_PORT"] = Port.ToString();
        Process.Start(psi);

        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < deadline)
        {
            await Task.Delay(300);
            if (await IsUpAsync()) return;
        }
        throw new InvalidOperationException($"Backend se nespustil. Podívej se do {log}");
    }
}

public sealed class ApiClient(BackendHost host)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    readonly HttpClient http = new() { BaseAddress = new Uri(host.BaseUrl), Timeout = TimeSpan.FromMinutes(6) };

    static string Enc(string s) => Uri.EscapeDataString(s);

    async Task<T> Send<T>(HttpMethod method, string path, object? body = null)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body != null) req.Content = JsonContent.Create(body, body.GetType(), options: Json);
        using var res = await http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            ApiError? err = null;
            try { err = JsonSerializer.Deserialize<ApiError>(text, Json); } catch { }
            throw new ApiException(err ?? new ApiError { Error = "http", Message = $"HTTP {(int)res.StatusCode}" });
        }
        return JsonSerializer.Deserialize<T>(text, Json)!;
    }

    public Task<List<ProjectDto>> ListAsync() => Send<List<ProjectDto>>(HttpMethod.Get, "/api/projects");
    public Task<ProjectDto> AddAsync(ProjectInput input) => Send<ProjectDto>(HttpMethod.Post, "/api/projects", input);
    public Task<ProjectDto> UpdateAsync(string id, ProjectInput input) => Send<ProjectDto>(HttpMethod.Patch, $"/api/projects/{Enc(id)}", input);
    public Task<JsonElement> RemoveAsync(string id) => Send<JsonElement>(HttpMethod.Delete, $"/api/projects/{Enc(id)}");
    public Task<ProjectDto> StartAsync(string id, int? port = null) =>
        Send<ProjectDto>(HttpMethod.Post, $"/api/projects/{Enc(id)}/start", port.HasValue ? new { port } : new { });
    public Task<ProjectDto> StopAsync(string id) => Send<ProjectDto>(HttpMethod.Post, $"/api/projects/{Enc(id)}/stop", new { });
    public Task<ProjectDto> RestartAsync(string id) => Send<ProjectDto>(HttpMethod.Post, $"/api/projects/{Enc(id)}/restart", new { });
    public Task<LogsResponse> LogsAsync(string id) => Send<LogsResponse>(HttpMethod.Get, $"/api/projects/{Enc(id)}/logs?limit=2000");
    public Task<JsonElement> ClearLogsAsync(string id) => Send<JsonElement>(HttpMethod.Delete, $"/api/projects/{Enc(id)}/logs");
    public Task<DetectResult> DetectAsync(string path) => Send<DetectResult>(HttpMethod.Post, "/api/detect", new { path });
    public Task<PortCheck> CheckPortAsync(int port) => Send<PortCheck>(HttpMethod.Get, $"/api/ports/{port}");
    public async Task<int> FreePortAsync(int? start = null, string? exclude = null)
    {
        var q = new List<string>();
        if (start.HasValue) q.Add($"start={start}");
        if (exclude != null) q.Add($"exclude={Enc(exclude)}");
        return (await Send<FreePort>(HttpMethod.Get, $"/api/ports/free?{string.Join('&', q)}")).Port;
    }
}

/// <summary>Čte /api/events a znovu se připojuje po výpadku.</summary>
public sealed class EventStream(BackendHost host)
{
    public event Action<ServerEvent>? Received;
    /// <summary>true = připojeno, false = spojení spadlo</summary>
    public event Action<bool>? ConnectionChanged;

    CancellationTokenSource? cts;

    public void Start()
    {
        cts = new CancellationTokenSource();
        _ = Task.Run(() => Loop(cts.Token));
    }

    public void Stop() => cts?.Cancel();

    async Task Loop(CancellationToken ct)
    {
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var res = await http.GetAsync($"{host.BaseUrl}/api/events", HttpCompletionOption.ResponseHeadersRead, ct);
                res.EnsureSuccessStatusCode();
                ConnectionChanged?.Invoke(true);
                using var stream = await res.Content.ReadAsStreamAsync(ct);
                using var reader = new StreamReader(stream, Encoding.UTF8);
                while (!ct.IsCancellationRequested)
                {
                    var line = await reader.ReadLineAsync(ct);
                    if (line == null) break;
                    if (!line.StartsWith("data: ")) continue;
                    var ev = JsonSerializer.Deserialize<ServerEvent>(line.AsSpan(6), ApiClient.Json);
                    if (ev != null) Received?.Invoke(ev);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                // spojení spadlo, zkusíme znovu
            }
            ConnectionChanged?.Invoke(false);
            await Task.Delay(2000, ct).ContinueWith(_ => { });
        }
    }
}
