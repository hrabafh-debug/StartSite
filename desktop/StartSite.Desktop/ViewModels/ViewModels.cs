using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StartSite.Desktop.Models;
using StartSite.Desktop.Services;

namespace StartSite.Desktop.ViewModels;

/// <summary>Znaky z fontu Phosphor.</summary>
public static class Icons
{
    public const string Play = "";
    public const string Stop = "";
    public const string Desktop = "";
    public const string Sun = "";
    public const string Moon = "";
    public const string Copy = "";
    public const string Check = "";
}

static class Theme
{
    public static bool IsDark => Application.Current?.RequestedTheme == AppTheme.Dark;
    public static Color LogText => IsDark ? Color.FromArgb("#D4D4D8") : Color.FromArgb("#27272A");
    public static Color LogSystem => Color.FromArgb("#71717A");
    public static Color LogError => IsDark ? Color.FromArgb("#FCA5A5") : Color.FromArgb("#991B1B");
}

public sealed class LogItem
{
    public LogItem(LogLineDto dto)
    {
        Dto = dto;
        Time = DateTimeOffset.FromUnixTimeMilliseconds(dto.Ts).ToLocalTime().ToString("HH:mm:ss");
        Rebuild();
    }

    public LogLineDto Dto { get; }
    public long Seq => Dto.Seq;
    public string Time { get; }
    public bool IsError => Dto.Error;
    public bool IsSystem => Dto.Stream == "system";
    public FormattedString Formatted { get; private set; } = new();

    /// <summary>Po změně motivu se barvy textu přepočítají.</summary>
    public void Rebuild()
    {
        var baseColor = IsError ? Theme.LogError : IsSystem ? Theme.LogSystem : Theme.LogText;
        Formatted = Ansi.ToFormatted(Dto.Text, baseColor, Theme.IsDark, "GeistMono", 12);
    }
}

public sealed record EnvEntry(string Key, string Value);

public partial class ProjectItem : ObservableObject
{
    public const int MaxLogLines = 2000;

    ProjectDto dto;

    public ProjectItem(ProjectDto dto) => this.dto = dto;

    public void Update(ProjectDto next)
    {
        dto = next;
        // Prázdný název vlastnosti obnoví všechny bindingy
        OnPropertyChanged(string.Empty);
    }

    /// <summary>Po přepnutí jazyka.</summary>
    public void RefreshTexts() => OnPropertyChanged(string.Empty);

    public ProjectDto Dto => dto;
    public string Id => dto.Id;
    public string Name => dto.Name;
    public string Kind => dto.Kind;
    public string KindLabel => dto.Kind switch { "npm" => "npm", "compose" => "compose", "dockerfile" => "docker", "dotnet" => ".net", "static" => Loc.T("KindStatic"), _ => Loc.T("KindCustom") };
    public string Path => dto.Path;
    public int Port => dto.Port;
    public string PortLabel => $":{dto.Port}";
    public string Url => dto.Url;
    public string Status => dto.Runtime.Status;
    public string StatusLabel => Status switch { "running" => Loc.T("StatusRunning"), "starting" => Loc.T("StatusStarting"), "error" => Loc.T("StatusError"), _ => Loc.T("StatusStopped") };
    public bool IsRunning => Status == "running";
    public bool IsStarting => Status == "starting";
    public bool IsActive => IsRunning || IsStarting;
    public bool IsErrorState => Status == "error";
    public string ToggleIcon => IsActive ? Icons.Stop : Icons.Play;
    public string ToggleText => IsActive ? Loc.T("Stop") : Loc.T("Start");
    public string Subtitle => IsErrorState && !string.IsNullOrEmpty(dto.Runtime.Error) ? dto.Runtime.Error! : dto.Path;
    public string ResolvedCommand => dto.ResolvedCommand;
    public string ProcessText => dto.Runtime.Pid is int pid ? $"PID {pid}" : Kind is not ("compose" or "dockerfile") ? Loc.T("NotRunning") : Loc.T("DockerContainer");
    public List<EnvEntry> EnvEntries => dto.Env.Select(kv => new EnvEntry(kv.Key, kv.Value)).ToList();
    public bool HasEnv => dto.Env.Count > 0;
    public string EnvEmptyText => Loc.F("EnvOnlyPort", dto.Port);
    public string LinkHint => IsRunning ? Loc.T("LinkRunning") : IsStarting ? Loc.T("LinkStarting") : Loc.T("LinkStopped");

    // Chyby: stav z backendu nebo selhaná akce v aplikaci
    [ObservableProperty, NotifyPropertyChangedFor(nameof(ErrorMessage), nameof(ShowError))]
    private string? actionError;

    public bool ShowError => IsErrorState || !string.IsNullOrEmpty(ActionError);
    public string ErrorMessage => dto.Runtime.PortOwner is { } o
        ? Loc.F("PortTaken", dto.Port, o.Name, o.Pid)
        : ActionError ?? dto.Runtime.Error ?? "";
    public bool HasSuggestion => dto.Runtime.SuggestedPort.HasValue;
    public int? SuggestedPort => dto.Runtime.SuggestedPort;
    public string SuggestionText => Loc.F("StartOn", dto.Runtime.SuggestedPort);

    [ObservableProperty]
    private bool busy;

    /// <summary>Názvy projektů, které se spustí předem. Skládá MainViewModel, protože zná ostatní projekty.</summary>
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasDepends))]
    private string dependsText = "";
    public bool HasDepends => DependsText.Length > 0;

    // Logy
    public ObservableCollection<LogItem> Logs { get; } = new();
    public bool LogsLoaded { get; set; }

    [ObservableProperty, NotifyPropertyChangedFor(nameof(LogCountText), nameof(HasNoLogs))]
    private int logCount;

    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasErrors), nameof(ErrorCountText))]
    private int errorCount;

    public string LogCountText => Loc.F("LogLines", LogCount);
    public bool HasNoLogs => LogCount == 0;
    public bool HasErrors => ErrorCount > 0;
    public string ErrorCountText => Loc.F("LogErrors", ErrorCount);

    public void SetLogs(IEnumerable<LogLineDto> lines)
    {
        Logs.Clear();
        foreach (var l in lines) Logs.Add(new LogItem(l));
        RecountLogs();
    }

    public void AppendLogs(IEnumerable<LogLineDto> lines)
    {
        var lastSeq = Logs.Count > 0 ? Logs[^1].Seq : 0;
        foreach (var l in lines)
        {
            if (l.Seq <= lastSeq) continue;
            Logs.Add(new LogItem(l));
            lastSeq = l.Seq;
        }
        while (Logs.Count > MaxLogLines) Logs.RemoveAt(0);
        RecountLogs();
    }

    public void RecountLogs()
    {
        LogCount = Logs.Count;
        ErrorCount = Logs.Count(l => l.IsError);
    }
}

public partial class MainViewModel : ObservableObject
{
    readonly BackendHost host;
    readonly ApiClient api;
    readonly EventStream events;
    readonly List<ProjectItem> all = new();
    readonly ConcurrentQueue<(string Id, LogLineDto Line)> logQueue = new();
    CancellationTokenSource? portCheckCts;
    bool subscribed;

    public MainViewModel(BackendHost host, ApiClient api, EventStream events)
    {
        this.host = host;
        this.api = api;
        this.events = events;
        Form = new ProjectFormViewModel(api, OnSaved, () => all);
        UpdateThemeIcon();
        Loc.Instance.Changed += OnLanguageChanged;
    }

    [RelayCommand]
    void ToggleLanguage() => Loc.Instance.Toggle();

    /// <summary>Texty skládané v kódu se po přepnutí jazyka musí přepočítat.</summary>
    void OnLanguageChanged()
    {
        foreach (var p in all) p.RefreshTexts();
        ApplyFilter();
        UpdateThemeIcon();
        CopyText = Loc.T("Copy");
        PortHint = null;
        Form.RefreshTexts();
    }

    public ProjectFormViewModel Form { get; }
    public ObservableCollection<ProjectItem> Projects { get; } = new();

    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasSelection))]
    private ProjectItem? selected;
    public bool HasSelection => Selected != null;

    [ObservableProperty] private string search = "";
    [ObservableProperty, NotifyPropertyChangedFor(nameof(ShowEmpty), nameof(ShowMain))] private bool isLoading = true;
    [ObservableProperty, NotifyPropertyChangedFor(nameof(ShowEmpty), nameof(ShowMain), nameof(HasLoadError))] private string? loadError;
    [ObservableProperty] private bool connected = true;
    [ObservableProperty] private string summary = "";
    [ObservableProperty, NotifyPropertyChangedFor(nameof(ShowEmpty), nameof(ShowMain))] private bool hasProjects;
    [ObservableProperty] private bool noMatches;
    [ObservableProperty] private string themeIcon = Icons.Desktop;
    [ObservableProperty] private string themeTooltip = "";
    [ObservableProperty] private bool confirmDelete;
    [ObservableProperty] private string copyIcon = Icons.Copy;
    [ObservableProperty] private string copyText = Loc.T("Copy");
    [ObservableProperty] private string emptyPath = "";

    // Editor portu v detailu
    [ObservableProperty] private string portText = "";
    [ObservableProperty] private bool portDirty;
    [ObservableProperty] private string? portHint;
    [ObservableProperty] private bool portHintIsError;
    [ObservableProperty] private bool savingPort;

    public bool HasLoadError => !string.IsNullOrEmpty(LoadError);
    public bool ShowEmpty => !IsLoading && !HasLoadError && !HasProjects;
    public bool ShowMain => IsLoading || (!HasLoadError && HasProjects);

    public async Task InitAsync()
    {
        IsLoading = true;
        LoadError = null;
        try
        {
            await host.EnsureRunningAsync();
            if (!subscribed)
            {
                subscribed = true;
                events.Received += ev => MainThread.BeginInvokeOnMainThread(() => OnEvent(ev));
                events.ConnectionChanged += up => MainThread.BeginInvokeOnMainThread(() =>
                {
                    var wasDown = !Connected;
                    Connected = up;
                    if (up && wasDown) _ = ReloadAsync(true);
                    // Backend spadl nebo ho někdo ukončil: zkusíme ho spustit znovu
                    if (!up) _ = RestartBackendAsync();
                });
                events.Start();
                // Logy chodí po dávkách, ať rychlý výstup nezahltí UI
                var timer = Application.Current!.Dispatcher.CreateTimer();
                timer.Interval = TimeSpan.FromMilliseconds(120);
                timer.Tick += (_, _) => FlushLogs();
                timer.Start();
            }
            await ReloadAsync(false);
        }
        catch (Exception ex)
        {
            LoadError = ex.Message;
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    Task Retry() => InitAsync();

    bool restartingBackend;

    async Task RestartBackendAsync()
    {
        if (restartingBackend) return;
        restartingBackend = true;
        try
        {
            await host.EnsureRunningAsync();
        }
        catch
        {
            // další pokus při příštím výpadku spojení
        }
        finally
        {
            restartingBackend = false;
        }
    }

    async Task ReloadAsync(bool resetLogs)
    {
        var list = await api.ListAsync();
        foreach (var dto in list) Upsert(dto);
        foreach (var gone in all.Where(p => list.All(d => d.Id != p.Id)).ToList()) Remove(gone.Id);
        if (resetLogs)
        {
            foreach (var p in all) p.LogsLoaded = false;
            if (Selected != null) await LoadLogsAsync(Selected);
        }
        if (Selected == null)
        {
            var saved = Preferences.Get("selected", "");
            Selected = Projects.FirstOrDefault(p => p.Id == saved) ?? Projects.FirstOrDefault();
        }
    }

    void Upsert(ProjectDto dto)
    {
        var item = all.FirstOrDefault(p => p.Id == dto.Id);
        if (item == null)
        {
            item = new ProjectItem(dto);
            all.Add(item);
        }
        else
        {
            item.Update(dto);
        }
        ApplyFilter();
        if (item == Selected) SyncPortEditor();
    }

    void Remove(string id)
    {
        var item = all.FirstOrDefault(p => p.Id == id);
        if (item == null) return;
        all.Remove(item);
        ApplyFilter();
        if (Selected == item) Selected = Projects.FirstOrDefault();
    }

    void OnEvent(ServerEvent ev)
    {
        switch (ev.Type)
        {
            case "project" when ev.Project != null:
                Upsert(ev.Project);
                break;
            case "removed" when ev.Id != null:
                Remove(ev.Id);
                break;
            case "log" when ev.Id != null && ev.Line != null:
                logQueue.Enqueue((ev.Id, ev.Line));
                break;
            case "logs-cleared" when ev.Id != null:
                var p = all.FirstOrDefault(x => x.Id == ev.Id);
                if (p != null)
                {
                    p.Logs.Clear();
                    p.RecountLogs();
                }
                break;
        }
    }

    void FlushLogs()
    {
        if (logQueue.IsEmpty) return;
        var batch = new List<(string Id, LogLineDto Line)>();
        while (logQueue.TryDequeue(out var x)) batch.Add(x);
        foreach (var group in batch.GroupBy(b => b.Id))
        {
            var item = all.FirstOrDefault(p => p.Id == group.Key);
            if (item is { LogsLoaded: true }) item.AppendLogs(group.Select(g => g.Line));
        }
    }

    // ---------- hledání a filtr stavu ----------

    /// <summary>all | running | stopped | error</summary>
    [ObservableProperty] private string statusFilter = "all";
    [ObservableProperty] private string filterAllText = "";
    [ObservableProperty] private string filterRunningText = "";
    [ObservableProperty] private string filterStoppedText = "";
    [ObservableProperty] private string filterErrorText = "";
    [ObservableProperty] private string resultText = "";
    public bool HasSearch => !string.IsNullOrWhiteSpace(Search) || StatusFilter != "all";

    /// <summary>Malá písmena bez diakritiky: "Dolní" i "dolni" se najdou stejně.</summary>
    static string Fold(string s)
    {
        var d = s.Normalize(System.Text.NormalizationForm.FormD);
        var sb = new System.Text.StringBuilder(d.Length);
        foreach (var c in d)
            if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark) sb.Append(char.ToLowerInvariant(c));
        return sb.ToString();
    }

    static bool MatchesStatus(ProjectItem p, string filter) => filter switch
    {
        "running" => p.IsActive,
        "stopped" => p.Status == "stopped",
        "error" => p.IsErrorState,
        _ => true,
    };

    /// <summary>Všechna slova dotazu musí sedět na název, ID, složku, port, typ nebo stav.</summary>
    static bool MatchesQuery(ProjectItem p, string[] tokens)
    {
        if (tokens.Length == 0) return true;
        var haystack = Fold($"{p.Name} {p.Id} {p.Path} {p.Port} :{p.Port} {p.Kind} {p.KindLabel} {p.StatusLabel}");
        return tokens.All(haystack.Contains);
    }

    [RelayCommand]
    void SetStatusFilter(string filter) => StatusFilter = StatusFilter == filter && filter != "all" ? "all" : filter;

    [RelayCommand]
    void ClearSearch()
    {
        Search = "";
        StatusFilter = "all";
    }

    /// <summary>Enter v hledání: vybere první výsledek.</summary>
    [RelayCommand]
    void SelectFirstMatch()
    {
        if (Projects.Count > 0) Selected = Projects[0];
    }

    partial void OnStatusFilterChanged(string value) => ApplyFilter();

    void ApplyFilter()
    {
        var tokens = Fold(Search).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var filtered = all.Where(p => MatchesStatus(p, StatusFilter) && MatchesQuery(p, tokens)).ToList();

        FilterAllText = Loc.F("FilterAll", all.Count);
        FilterRunningText = Loc.F("FilterRunning", all.Count(p => p.IsActive));
        FilterStoppedText = Loc.F("FilterStopped", all.Count(p => p.Status == "stopped"));
        FilterErrorText = Loc.F("FilterError", all.Count(p => p.IsErrorState));
        ResultText = HasSearch ? Loc.F("Results", filtered.Count, all.Count) : "";
        foreach (var p in all)
        {
            p.DependsText = string.Join(", ", (p.Dto.DependsOn ?? []).Select(id => all.FirstOrDefault(o => o.Id == id)?.Name ?? id));
        }
        OnPropertyChanged(nameof(HasSearch));
        // Kolekci upravujeme po položkách, aby seznam neztratil výběr
        for (var i = Projects.Count - 1; i >= 0; i--)
            if (!filtered.Contains(Projects[i])) Projects.RemoveAt(i);
        for (var i = 0; i < filtered.Count; i++)
        {
            var idx = Projects.IndexOf(filtered[i]);
            if (idx == -1) Projects.Insert(i, filtered[i]);
            else if (idx != i) Projects.Move(idx, i);
        }
        HasProjects = all.Count > 0;
        NoMatches = all.Count > 0 && filtered.Count == 0;
        var running = all.Count(p => p.IsRunning);
        Summary = all.Count > 0 ? Loc.F("Summary", running, all.Count) : "";
    }

    partial void OnSearchChanged(string value) => ApplyFilter();

    partial void OnSelectedChanged(ProjectItem? value)
    {
        ConfirmDelete = false;
        if (value == null) return;
        Preferences.Set("selected", value.Id);
        SyncPortEditor(force: true);
        if (!value.LogsLoaded) _ = LoadLogsAsync(value);
    }

    async Task LoadLogsAsync(ProjectItem item)
    {
        item.LogsLoaded = true;
        try
        {
            var res = await api.LogsAsync(item.Id);
            var pending = item.Logs.Select(l => l.Dto).ToList();
            item.SetLogs(res.Lines);
            item.AppendLogs(pending);
        }
        catch
        {
            item.LogsLoaded = false;
        }
    }

    // ---------- akce ----------

    async Task RunAsync(ProjectItem item, string action, int? port = null)
    {
        if (item.Busy) return;
        item.Busy = true;
        item.ActionError = null;
        try
        {
            var dto = action switch
            {
                "start" => await api.StartAsync(item.Id, port),
                "stop" => await api.StopAsync(item.Id),
                _ => await api.RestartAsync(item.Id),
            };
            Upsert(dto);
        }
        catch (ApiException ex) when (ex.Body.Error == "port_in_use")
        {
            // Backend zapsal vlastníka portu do stavu projektu, přijde přes SSE
        }
        catch (Exception ex)
        {
            item.ActionError = ex.Message;
        }
        finally
        {
            item.Busy = false;
        }
    }

    [RelayCommand]
    Task Toggle(ProjectItem? item)
    {
        item ??= Selected;
        if (item == null) return Task.CompletedTask;
        return RunAsync(item, item.IsActive ? "stop" : "start");
    }

    [RelayCommand]
    Task Restart() => Selected == null ? Task.CompletedTask : RunAsync(Selected, "restart");

    [RelayCommand]
    Task StartOnSuggested() =>
        Selected?.SuggestedPort is int port ? RunAsync(Selected, "start", port) : Task.CompletedTask;

    [RelayCommand]
    async Task Delete()
    {
        if (Selected == null) return;
        if (!ConfirmDelete)
        {
            ConfirmDelete = true;
            return;
        }
        var item = Selected;
        try
        {
            await api.RemoveAsync(item.Id);
            Remove(item.Id);
        }
        catch (Exception ex)
        {
            item.ActionError = ex.Message;
        }
        ConfirmDelete = false;
    }

    [RelayCommand]
    void CancelDelete() => ConfirmDelete = false;

    [RelayCommand]
    async Task OpenUrl()
    {
        if (Selected is { IsRunning: true }) await Launcher.Default.OpenAsync(new Uri(Selected.Url));
    }

    [RelayCommand]
    async Task CopyUrl()
    {
        if (Selected == null) return;
        await Clipboard.Default.SetTextAsync(Selected.Url);
        CopyIcon = Icons.Check;
        CopyText = Loc.T("Copied");
        await Task.Delay(1400);
        CopyIcon = Icons.Copy;
        CopyText = Loc.T("Copy");
    }

    [RelayCommand]
    async Task ClearLogs()
    {
        if (Selected != null) await api.ClearLogsAsync(Selected.Id);
    }

    [RelayCommand]
    void NewProject() => Form.OpenNew(null);

    [RelayCommand]
    void AddFromEmpty() => Form.OpenNew(EmptyPath.Trim());

    [RelayCommand]
    void Edit()
    {
        if (Selected != null) Form.OpenEdit(Selected.Dto);
    }

    void OnSaved(ProjectDto dto)
    {
        Upsert(dto);
        Selected = all.FirstOrDefault(p => p.Id == dto.Id);
    }

    public void SelectRelative(int delta)
    {
        if (Projects.Count == 0) return;
        var i = Selected == null ? -1 : Projects.IndexOf(Selected);
        Selected = Projects[Math.Clamp(i + delta, 0, Projects.Count - 1)];
    }

    // ---------- motiv ----------

    [RelayCommand]
    void ToggleTheme()
    {
        var next = Preferences.Get("theme", "system") switch { "system" => "light", "light" => "dark", _ => "system" };
        Preferences.Set("theme", next);
        Application.Current!.UserAppTheme = next switch { "light" => AppTheme.Light, "dark" => AppTheme.Dark, _ => AppTheme.Unspecified };
        UpdateThemeIcon();
    }

    /// <summary>Barvy logů jsou zapečené ve FormattedString, po změně motivu se přepočítají.</summary>
    public void RebuildLogColors()
    {
        foreach (var p in all)
        {
            if (p.Logs.Count == 0) continue;
            var items = p.Logs.ToList();
            foreach (var l in items) l.Rebuild();
            p.Logs.Clear();
            foreach (var l in items) p.Logs.Add(l);
        }
    }

    void UpdateThemeIcon()
    {
        var theme = Preferences.Get("theme", "system");
        ThemeIcon = theme switch { "light" => Icons.Sun, "dark" => Icons.Moon, _ => Icons.Desktop };
        ThemeTooltip = theme switch { "light" => Loc.T("ThemeLight"), "dark" => Loc.T("ThemeDark"), _ => Loc.T("ThemeSystem") };
    }

    // ---------- port v detailu ----------

    void SyncPortEditor(bool force = false)
    {
        if (Selected == null) return;
        if (force || !PortDirty) PortText = Selected.Port.ToString();
    }

    partial void OnPortTextChanged(string value)
    {
        PortHint = null;
        PortHintIsError = false;
        if (Selected == null) return;
        var valid = int.TryParse(value, out var port) && port is > 0 and < 65536;
        PortDirty = valid && port != Selected.Port;
        if (!PortDirty) return;
        portCheckCts?.Cancel();
        portCheckCts = new CancellationTokenSource();
        var token = portCheckCts.Token;
        var active = Selected.IsActive;
        _ = Task.Run(async () =>
        {
            await Task.Delay(250, token);
            var check = await api.CheckPortAsync(port);
            if (token.IsCancellationRequested) return;
            MainThread.BeginInvokeOnMainThread(() =>
            {
                PortHintIsError = !check.Free;
                PortHint = check.Free
                    ? Loc.T("PortFree") + (active ? Loc.T("PortAfterRestart") : "") + (check.Project != null ? Loc.F("PortInConfig", check.Project) : "")
                    : Loc.F("PortHeldBy", check.Owner?.Name, check.Owner?.Pid);
            });
        }, token);
    }

    [RelayCommand]
    async Task SavePort()
    {
        if (Selected == null || !PortDirty || !int.TryParse(PortText, out var port)) return;
        SavingPort = true;
        try
        {
            var dto = await api.UpdateAsync(Selected.Id, new ProjectInput { Port = port });
            PortDirty = false;
            Upsert(dto);
            PortHint = null;
        }
        catch (Exception ex)
        {
            PortHintIsError = true;
            PortHint = ex.Message;
        }
        finally
        {
            SavingPort = false;
        }
    }

    [RelayCommand]
    async Task FindFreePort()
    {
        if (Selected == null) return;
        try
        {
            PortText = (await api.FreePortAsync(Selected.Port + 1, Selected.Id)).ToString();
        }
        catch (Exception ex)
        {
            PortHintIsError = true;
            PortHint = ex.Message;
        }
    }
}

public sealed record KindOption(string Key, string Label, string Hint);

public partial class DependencyOption(string id, string name) : ObservableObject
{
    public string Id { get; } = id;
    public string Name { get; } = name;
    [ObservableProperty] private bool isSelected;
}

public partial class EnvRow : ObservableObject
{
    [ObservableProperty] private string key = "";
    [ObservableProperty] private string value = "";
}

public partial class ProjectFormViewModel : ObservableObject
{
    readonly ApiClient api;
    readonly Action<ProjectDto> onSaved;
    string? editId;
    /// <summary>Nový projekt (ne úprava): ukáže návod na import přes Claude.</summary>
    [ObservableProperty] private bool isNew = true;
    int? originalPort;
    bool nameTouched;
    bool settingName;
    DetectResult? detected;
    CancellationTokenSource? portCheckCts;

    readonly Func<IEnumerable<ProjectItem>> projects;

    public ProjectFormViewModel(ApiClient api, Action<ProjectDto> onSaved, Func<IEnumerable<ProjectItem>> projects)
    {
        this.api = api;
        this.onSaved = onSaved;
        this.projects = projects;
    }

    /// <summary>Ostatní projekty, které jde zapnout před tímhle (např. API před webem).</summary>
    public ObservableCollection<DependencyOption> DependencyOptions { get; } = new();
    public bool HasDependencyOptions => DependencyOptions.Count > 0;

    [ObservableProperty] private bool autoInstall = true;
    [ObservableProperty] private string projectFile = "";

    void FillDependencies(string? selfId, IEnumerable<string>? selected)
    {
        DependencyOptions.Clear();
        var chosen = selected?.ToHashSet() ?? [];
        foreach (var p in projects().Where(p => p.Id != selfId).OrderBy(p => p.Name))
            DependencyOptions.Add(new DependencyOption(p.Id, p.Name) { IsSelected = chosen.Contains(p.Id) });
        OnPropertyChanged(nameof(HasDependencyOptions));
    }

    public List<KindOption> KindOptions { get; } =
    [
        new("npm", "npm", "package.json"),
        new("compose", "compose", "docker compose"),
        new("dockerfile", "docker", "Dockerfile"),
        new("custom", "command", "custom command"),
    ];

    public List<string> FrameworkLabels => ["Vite", "Astro", "SvelteKit", "Next.js", Loc.T("FrameworkOther")];
    static readonly string[] FrameworkKeys = ["vite", "astro", "sveltekit", "next", "other"];

    public ObservableCollection<string> Scripts { get; } = new();
    public ObservableCollection<string> Services { get; } = new();
    public ObservableCollection<EnvRow> EnvRows { get; } = new();

    [ObservableProperty] private bool isOpen;
    [ObservableProperty] private string title = Loc.T("FormNew");
    [ObservableProperty] private string saveText = Loc.T("FormAdd");
    [ObservableProperty] private string path = "";
    [ObservableProperty] private string name = "";
    [ObservableProperty, NotifyPropertyChangedFor(nameof(IsNpm), nameof(IsCustom), nameof(IsDocker), nameof(IsDotnet), nameof(IsStatic), nameof(IsComposeMulti), nameof(ContainerPortHint))]
    private string kind = "npm";
    [ObservableProperty, NotifyPropertyChangedFor(nameof(ScriptPreview))] private string? script;
    [ObservableProperty] private int frameworkIndex = 4;
    [ObservableProperty] private string command = "";
    [ObservableProperty] private string port = "";
    [ObservableProperty] private string containerPort = "";
    [ObservableProperty] private string? service;
    [ObservableProperty] private string pathHint = "";
    [ObservableProperty] private bool detecting;
    [ObservableProperty] private bool saving;
    [ObservableProperty] private string? portHint;
    [ObservableProperty] private bool portHintIsError;

    [ObservableProperty] private string? pathError;
    [ObservableProperty] private string? nameError;
    [ObservableProperty] private string? portError;
    [ObservableProperty] private string? commandError;
    [ObservableProperty] private string? scriptError;
    [ObservableProperty] private string? containerPortError;
    [ObservableProperty] private string? envError;
    [ObservableProperty] private string? formError;

    public bool IsNpm => Kind == "npm";
    public bool IsDotnet => Kind == "dotnet";
    public bool IsStatic => Kind == "static";
    public bool IsCustom => Kind == "custom";
    public bool IsDocker => Kind is "compose" or "dockerfile";
    public bool IsComposeMulti => Kind == "compose" && Services.Count > 1;
    public bool HasScripts => Scripts.Count > 0;
    public string ScriptPreview => Script != null && detected != null && detected.Scripts.TryGetValue(Script, out var cmd) ? $"{Script}: {cmd}" : "";
    public string ContainerPortHint => detected?.ContainerPort != null
        ? (Kind == "compose" ? Loc.T("ContainerFromCompose") : Loc.T("ContainerFromExpose"))
        : Loc.T("ContainerUnknown");

    /// <summary>Po přepnutí jazyka.</summary>
    public void RefreshTexts()
    {
        Title = Loc.T(editId == null ? "FormNew" : "FormEdit");
        SaveText = Loc.T(editId == null ? "FormAdd" : "Save");
        PathHint = detected is { Exists: true } d ? DetectedHint(d) : Loc.T("PathHint");
        // Picker při výměně seznamu ztratí výběr, vrátíme ho
        var framework = FrameworkIndex;
        OnPropertyChanged(nameof(FrameworkLabels));
        FrameworkIndex = framework;
        OnPropertyChanged(nameof(ContainerPortHint));
        PortHint = null;
    }

    static string DetectedHint(DetectResult d)
    {
        var kindLabel = d.Kind switch { "custom" => Loc.T("KindCustom"), "dockerfile" => "docker", _ => d.Kind };
        return Loc.F("Detected", kindLabel) + (d.Framework is { } fw && fw != "other" ? $", {fw}" : "");
    }

    void Reset()
    {
        PathError = NameError = PortError = CommandError = ScriptError = ContainerPortError = EnvError = FormError = null;
        PortHint = null;
        detected = null;
        Scripts.Clear();
        Services.Clear();
        EnvRows.Clear();
        OnPropertyChanged(nameof(HasScripts));
        OnPropertyChanged(nameof(IsComposeMulti));
    }

    public void OpenNew(string? initialPath)
    {
        Reset();
        editId = null;
        IsNew = true;
        originalPort = null;
        nameTouched = false;
        Title = Loc.T("FormNew");
        SaveText = Loc.T("FormAdd");
        SetName("");
        Kind = "npm";
        Script = null;
        FrameworkIndex = 4;
        Command = "";
        Port = "";
        ContainerPort = "";
        Service = null;
        Path = initialPath ?? "";
        AutoInstall = true;
        ProjectFile = "";
        FillDependencies(null, null);
        PathHint = Loc.T("PathHint");
        IsOpen = true;
        if (!string.IsNullOrWhiteSpace(Path)) _ = DetectAsync(true);
    }

    public void OpenEdit(ProjectDto p)
    {
        Reset();
        editId = p.Id;
        IsNew = false;
        originalPort = p.Port;
        nameTouched = true;
        Title = Loc.T("FormEdit");
        SaveText = Loc.T("Save");
        SetName(p.Name);
        Path = p.Path;
        Kind = p.Kind;
        Command = p.Command ?? "";
        Port = p.Port.ToString();
        ContainerPort = p.ContainerPort?.ToString() ?? "";
        FrameworkIndex = Math.Max(0, Array.IndexOf(FrameworkKeys, p.Framework ?? "other"));
        AutoInstall = p.AutoInstall != false;
        ProjectFile = p.ProjectFile ?? "";
        FillDependencies(p.Id, p.DependsOn);
        foreach (var kv in p.Env) EnvRows.Add(new EnvRow { Key = kv.Key, Value = kv.Value });
        IsOpen = true;
        _ = LoadForEditAsync(p);
    }

    async Task LoadForEditAsync(ProjectDto p)
    {
        await DetectAsync(false);
        Script = p.Script;
        Service = p.Service;
    }

    void SetName(string value)
    {
        settingName = true;
        Name = value;
        settingName = false;
    }

    partial void OnNameChanged(string value)
    {
        if (!settingName) nameTouched = true;
    }

    [RelayCommand]
    void Close() => IsOpen = false;

    [RelayCommand]
    void SelectKind(string key) => Kind = key;

    [RelayCommand]
    Task DetectPath() => DetectAsync(true);

    async Task DetectAsync(bool applyDefaults)
    {
        if (string.IsNullOrWhiteSpace(Path)) return;
        Detecting = true;
        PathError = null;
        PathHint = Loc.T("Reading");
        try
        {
            var d = await api.DetectAsync(Path.Trim());
            detected = d;
            if (!d.Exists)
            {
                PathError = Loc.T("FolderMissing");
                PathHint = "";
                return;
            }
            Scripts.Clear();
            foreach (var s in d.Scripts.Keys) Scripts.Add(s);
            Services.Clear();
            foreach (var s in d.Services) Services.Add(s.Name);
            OnPropertyChanged(nameof(HasScripts));
            OnPropertyChanged(nameof(IsComposeMulti));
            OnPropertyChanged(nameof(ContainerPortHint));
            OnPropertyChanged(nameof(ScriptPreview));
            PathHint = DetectedHint(d);
            if (!applyDefaults) return;
            Path = d.Path;
            Kind = d.Kind;
            if (!nameTouched) SetName(d.Name);
            Script = d.DefaultScript;
            FrameworkIndex = Math.Max(0, Array.IndexOf(FrameworkKeys, d.Framework ?? "other"));
            Service = d.Service;
            ContainerPort = d.ContainerPort?.ToString() ?? "";
            ProjectFile = d.ProjectFile ?? "";
            if (!string.IsNullOrEmpty(d.Command)) Command = d.Command;
            if (string.IsNullOrEmpty(Port)) Port = (await api.FreePortAsync()).ToString();
        }
        catch (Exception ex)
        {
            PathError = ex.Message;
            PathHint = "";
        }
        finally
        {
            Detecting = false;
        }
    }

    [RelayCommand]
    async Task PickFolder()
    {
#if WINDOWS
        var picker = new Windows.Storage.Pickers.FolderPicker();
        picker.FileTypeFilter.Add("*");
        var window = Application.Current?.Windows.FirstOrDefault()?.Handler?.PlatformView as MauiWinUIWindow;
        if (window == null) return;
        WinRT.Interop.InitializeWithWindow.Initialize(picker, window.WindowHandle);
        var folder = await picker.PickSingleFolderAsync();
        if (folder == null) return;
        Path = folder.Path;
        await DetectAsync(true);
#else
        await Task.CompletedTask;
#endif
    }

    partial void OnPortChanged(string value)
    {
        PortHint = null;
        PortHintIsError = false;
        if (!int.TryParse(value, out var p) || p is < 1 or > 65535 || p == originalPort) return;
        portCheckCts?.Cancel();
        portCheckCts = new CancellationTokenSource();
        var token = portCheckCts.Token;
        _ = Task.Run(async () =>
        {
            await Task.Delay(250, token);
            var check = await api.CheckPortAsync(p);
            if (token.IsCancellationRequested) return;
            MainThread.BeginInvokeOnMainThread(() =>
            {
                PortHintIsError = !check.Free;
                PortHint = check.Free
                    ? (check.Project != null ? Loc.F("FreeButInConfig", check.Project) : Loc.T("Free"))
                    : Loc.F("PortHeldBy", check.Owner?.Name, check.Owner?.Pid);
            });
        }, token);
    }

    [RelayCommand]
    async Task FindFree()
    {
        int? start = int.TryParse(Port, out var p) ? p + 1 : null;
        Port = (await api.FreePortAsync(start, editId)).ToString();
    }

    [RelayCommand]
    void AddEnv() => EnvRows.Add(new EnvRow());

    [RelayCommand]
    void RemoveEnv(EnvRow row) => EnvRows.Remove(row);

    [RelayCommand]
    async Task Save()
    {
        PathError = NameError = PortError = CommandError = ScriptError = ContainerPortError = EnvError = FormError = null;
        var ok = true;
        if (string.IsNullOrWhiteSpace(Path)) { PathError = Loc.T("ValPath"); ok = false; }
        if (string.IsNullOrWhiteSpace(Name)) { NameError = Loc.T("ValName"); ok = false; }
        if (!int.TryParse(Port, out var port) || port is < 1 or > 65535) { PortError = Loc.T("ValPort"); ok = false; }
        if (IsCustom && string.IsNullOrWhiteSpace(Command)) { CommandError = Loc.T("ValCommand"); ok = false; }
        int? cport = int.TryParse(ContainerPort, out var cp) ? cp : null;
        if (IsDocker && cport == null) { ContainerPortError = Loc.T("ValContainerPort"); ok = false; }
        var env = new Dictionary<string, string>();
        foreach (var row in EnvRows)
        {
            var key = row.Key.Trim();
            if (key.Length == 0) continue;
            if (!System.Text.RegularExpressions.Regex.IsMatch(key, "^[A-Za-z_][A-Za-z0-9_]*$")) { EnvError = Loc.F("ValEnv", key); ok = false; }
            env[key] = row.Value;
        }
        if (!ok) return;

        var input = new ProjectInput
        {
            Path = Path.Trim(),
            Name = Name.Trim(),
            Kind = Kind,
            Port = port,
            Env = env,
            Script = IsNpm ? Script : null,
            Framework = IsNpm ? FrameworkKeys[Math.Clamp(FrameworkIndex, 0, FrameworkKeys.Length - 1)] : null,
            Command = IsCustom ? Command.Trim() : null,
            ContainerPort = IsDocker ? cport : null,
            Service = Kind == "compose" ? Service : null,
            ProjectFile = IsDotnet && !string.IsNullOrWhiteSpace(ProjectFile) ? ProjectFile.Trim() : null,
            AutoInstall = IsNpm ? AutoInstall : null,
            DependsOn = DependencyOptions.Where(o => o.IsSelected).Select(o => o.Id).ToList(),
        };
        Saving = true;
        try
        {
            var dto = editId == null ? await api.AddAsync(input) : await api.UpdateAsync(editId, input);
            IsOpen = false;
            onSaved(dto);
        }
        catch (ApiException ex)
        {
            var code = ex.Body.Error;
            if (code.StartsWith("path") || code is "compose_missing" or "dockerfile_missing") PathError = ex.Message;
            else if (code.StartsWith("name")) NameError = ex.Message;
            else if (code == "invalid_port") PortError = ex.Message;
            else if (code.StartsWith("command")) CommandError = ex.Message;
            else if (code.StartsWith("script")) ScriptError = ex.Message;
            else if (code == "invalid_env") EnvError = ex.Message;
            else FormError = ex.Message;
        }
        catch (Exception ex)
        {
            FormError = ex.Message;
        }
        finally
        {
            Saving = false;
        }
    }
}
