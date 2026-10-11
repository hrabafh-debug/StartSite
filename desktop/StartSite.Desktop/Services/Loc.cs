// Texty aplikace v češtině a angličtině, přepínatelné za běhu.
using System.ComponentModel;
using System.Globalization;

namespace StartSite.Desktop.Services;

public sealed class Loc : INotifyPropertyChanged
{
    public static Loc Instance { get; } = new();

    public event PropertyChangedEventHandler? PropertyChanged;
    /// <summary>Po přepnutí jazyka: ViewModely si přepočítají své texty.</summary>
    public event Action? Changed;

    Loc()
    {
        var saved = Preferences.Get("lang", "");
        Lang = saved is "cs" or "en" ? saved : CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "cs" ? "cs" : "en";    }

    public string Lang { get; private set; }
    public bool IsEnglish => Lang == "en";
    public string LangCode => Lang.ToUpperInvariant();

    public string this[string key] => Texts.TryGetValue(key, out var t) ? (IsEnglish ? t.En : t.Cs) : key;

    public static string T(string key) => Instance[key];
    public static string F(string key, params object?[] args) => string.Format(Instance[key], args);

    public void Toggle() => SetLanguage(IsEnglish ? "cs" : "en");

    public void SetLanguage(string lang)
    {
        if (lang == Lang) return;
        Lang = lang;
        Preferences.Set("lang", lang);
        // Prázdný název = změnily se všechny vlastnosti včetně indexeru, MAUI pak obnoví všechny {s:T} bindingy
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(string.Empty));
        Changed?.Invoke();
    }

    static readonly Dictionary<string, (string Cs, string En)> Texts = new()
    {
        // Záhlaví
        ["Search"] = ("Hledat projekt", "Search projects"),
        ["NewProject"] = ("Nový projekt  N", "New project  N"),
        ["NewProjectTip"] = ("Nový projekt (N)", "New project (N)"),
        ["LanguageTip"] = ("Jazyk: čeština (přepnout na angličtinu)", "Language: English (switch to Czech)"),
        ["Disconnected"] = ("Spojení s backendem přerušeno, zkouším znovu.", "Lost connection to the backend, retrying."),
        ["Summary"] = ("{0}/{1} běží", "{0}/{1} running"),
        ["ThemeSystem"] = ("Motiv: podle systému", "Theme: system"),
        ["ThemeLight"] = ("Motiv: světlý", "Theme: light"),
        ["ThemeDark"] = ("Motiv: tmavý", "Theme: dark"),

        // Seznam
        ["Projects"] = ("PROJEKTY", "PROJECTS"),
        ["ResizeTip"] = ("Táhni pro změnu šířky, dvojklik vrátí výchozí", "Drag to resize, double-click to reset"),
        ["NoMatches"] = ("Nic neodpovídá hledání.", "No projects match your search."),
        ["SearchPlaceholder"] = ("Hledat název, port, složku…", "Search name, port, folder…"),
        ["FilterAll"] = ("Vše {0}", "All {0}"),
        ["FilterRunning"] = ("Běží {0}", "Running {0}"),
        ["FilterStopped"] = ("Stojí {0}", "Stopped {0}"),
        ["FilterError"] = ("Chyby {0}", "Errors {0}"),
        ["Results"] = ("{0} z {1}", "{0} of {1}"),
        ["ClearFilters"] = ("Zrušit filtry", "Clear filters"),
        ["ClearSearchTip"] = ("Vymazat hledání (Esc)", "Clear search (Esc)"),
        ["KindCustom"] = ("příkaz", "command"),

        // Stavy
        ["StatusRunning"] = ("Běží", "Running"),
        ["StatusStarting"] = ("Startuje", "Starting"),
        ["StatusError"] = ("Chyba", "Error"),
        ["StatusStopped"] = ("Zastaveno", "Stopped"),
        ["Start"] = ("Spustit", "Start"),
        ["Stop"] = ("Zastavit", "Stop"),

        // Detail
        ["ShortcutS"] = ("Zkratka S", "Shortcut S"),
        ["Restart"] = ("Restart", "Restart"),
        ["Edit"] = ("Upravit", "Edit"),
        ["DeleteTip"] = ("Smazat záznam (soubory zůstanou)", "Remove from StartSite (files stay on disk)"),
        ["DeleteConfirm"] = ("Smazat záznam", "Remove"),
        ["No"] = ("Ne", "Cancel"),
        ["PortTaken"] = ("Port {0} je obsazený. Drží ho {1} s PID {2}.", "Port {0} is in use by {1} (PID {2})."),
        ["StartOn"] = ("Spustit na {0}", "Start on {0}"),
        ["LinkRunning"] = ("Port odpovídá.", "The port is responding."),
        ["LinkStarting"] = ("Čekám, až port odpoví.", "Waiting for the port to respond."),
        ["LinkStopped"] = ("Odkaz bude aktivní, až projekt poběží.", "The link becomes active once the project is running."),
        ["Open"] = ("Otevřít", "Open"),
        ["Copy"] = ("Kopírovat", "Copy"),
        ["Copied"] = ("Zkopírováno", "Copied"),
        ["Port"] = ("Port", "Port"),
        ["Save"] = ("Uložit", "Save"),
        ["FindFree"] = ("Najít volný", "Find free"),
        ["Process"] = ("Proces", "Process"),
        ["NotRunning"] = ("Neběží", "Not running"),
        ["DockerContainer"] = ("Kontejner v Dockeru", "Docker container"),
        ["Command"] = ("Příkaz", "Command"),
        ["Folder"] = ("Složka", "Folder"),
        ["EnvVars"] = ("Proměnné prostředí", "Environment variables"),
        ["EnvOnlyPort"] = ("Jen PORT={0}", "Only PORT={0}"),
        ["PortFree"] = ("Volný.", "Free."),
        ["PortAfterRestart"] = (" Projeví se po restartu.", " Takes effect after a restart."),
        ["PortInConfig"] = (" V konfiguraci ho má {0}.", " Already assigned to {0}."),
        ["PortHeldBy"] = ("Drží ho {0} (PID {1})", "In use by {0} (PID {1})"),

        // Logy
        ["Logs"] = ("Logy", "Logs"),
        ["LogLines"] = ("{0} řádků", "{0} lines"),
        ["LogErrors"] = ("Chyby {0}", "Errors {0}"),
        ["Clear"] = ("Vymazat", "Clear"),
        ["NoLogs"] = ("Zatím žádný výstup. Spusť projekt a logy se objeví tady.", "No output yet. Start the project and its logs will appear here."),

        // Prázdný stav a chyby
        ["ZeroProjects"] = ("0 projektů", "0 projects"),
        ["AddFirst"] = ("Přidej první projekt", "Add your first project"),
        ["AddFirstHint"] = (
            "Vlož cestu ke složce nebo ji vyber. Typ se pozná podle package.json, docker-compose.yml nebo Dockerfile.",
            "Paste a folder path or pick one. The type is detected from package.json, docker-compose.yml or Dockerfile."),
        ["Continue"] = ("Pokračovat", "Continue"),
        ["ClaudeTitle"] = ("Ovládání z Claude", "Control from Claude"),
        ["ClaudeHint"] = (
            "Po registraci MCP serveru může Claude projekty přidávat, spouštět a číst jejich logy.",
            "Once the MCP server is registered, Claude can add and start projects and read their logs."),
        ["ClaudeCommand"] = ("claude mcp add startsite -- node <cesta>/mcp/index.js", "claude mcp add startsite -- node <path>/mcp/index.js"),
        ["ClaudeStep1"] = ("1. Zaregistruj StartSite v Claude Code (v terminálu):", "1. Register StartSite with Claude Code (in a terminal):"),
        ["ClaudeStep2"] = ("2. Napiš Claudovi:", "2. Ask Claude:"),
        ["ClaudeImportPrompt"] = (
            "Naimportuj do StartSite všechny projekty, na kterých se mnou pracuješ. Najdi je podle pracovních složek v záznamech relací v ~/.claude/projects, vynech složky, které už neexistují, podsložky a dočasné adresáře. U každého projektu zjisti, jak se spouští (npm, docker compose, Dockerfile, dotnet, statický web), vyber volný port a přidej ho přes nástroj add_project.",
            "Import into StartSite all the projects you work on with me. Find them from the working directories in the session logs under ~/.claude/projects, skip folders that no longer exist, subfolders and temporary directories. For each project, work out how it runs (npm, docker compose, Dockerfile, dotnet, static site), pick a free port and add it with the add_project tool."),
        ["ClaudeStep3"] = ("Projekty se tu objeví hned, jak je Claude přidá.", "Projects show up here as soon as Claude adds them."),
        ["BackendDown"] =("Backend neodpovídá", "The backend is not responding"),
        ["Retry"] = ("Zkusit znovu", "Try again"),

        // Formulář
        ["FormNew"] = ("Nový projekt", "New project"),
        ["FormEdit"] = ("Upravit projekt", "Edit project"),
        ["FormAdd"] = ("Přidat projekt", "Add project"),
        ["CloseTip"] = ("Zavřít (Esc)", "Close (Esc)"),
        ["ProjectFolder"] = ("Složka projektu", "Project folder"),
        ["PickFolder"] = ("Vybrat složku", "Choose folder"),
        ["ReadFolder"] = ("Načíst složku", "Read folder"),
        ["PathHint"] = ("Vlož cestu nebo vyber složku, typ se pozná sám.", "Paste a path or choose a folder, the type is detected automatically."),
        ["Reading"] = ("Čtu složku…", "Reading folder…"),
        ["Detected"] = ("Rozpoznáno: {0}", "Detected: {0}"),
        ["FolderMissing"] = ("Složka neexistuje", "The folder does not exist"),
        ["Name"] = ("Název", "Name"),
        ["Type"] = ("Typ", "Type"),
        ["Script"] = ("Skript", "Script"),
        ["Framework"] = ("Framework", "Framework"),
        ["FrameworkHint"] = ("Určuje, jak se předá port.", "Determines how the port is passed."),
        ["FrameworkOther"] = ("Jiný (jen PORT)", "Other (PORT only)"),
        ["CommandHint"] = (
            "Spustí se v shellu ve složce projektu. {port} se nahradí portem, env PORT je nastavené vždy.",
            "Runs in a shell in the project folder. {port} is replaced with the port, the PORT variable is always set."),
        ["Free"] = ("Volný", "Free"),
        ["FreeButInConfig"] = ("Volný, ale v konfiguraci ho má {0}", "Free, but already assigned to {0}"),
        ["ContainerPort"] = ("Port v kontejneru", "Container port"),
        ["ContainerFromCompose"] = ("Načteno z compose", "Read from the compose file"),
        ["ContainerFromExpose"] = ("Načteno z EXPOSE v Dockerfile", "Read from EXPOSE in the Dockerfile"),
        ["ContainerUnknown"] = ("Nenašel jsem ho, doplň ručně.", "Not found, please fill it in."),
        ["WebService"] = ("Služba s webem", "Web service"),
        ["WebServiceHint"] = ("Na tuhle službu se namapuje port.", "The port is mapped to this service."),
        ["Add"] = ("Přidat", "Add"),
        ["EnvHint"] = ("Volitelné. PORT se nastaví vždy.", "Optional. PORT is always set."),
        ["Remove"] = ("Odebrat", "Remove"),
        ["EnvNamePh"] = ("NAZEV", "NAME"),
        ["EnvValuePh"] = ("hodnota", "value"),
        ["Cancel"] = ("Zrušit", "Cancel"),
        ["ValPath"] = ("Zadej cestu ke složce", "Enter a folder path"),
        ["ValName"] = ("Zadej název", "Enter a name"),
        ["ValPort"] = ("Port musí být 1 až 65535", "The port must be between 1 and 65535"),
        ["ValCommand"] = ("Zadej příkaz", "Enter a command"),
        ["ValContainerPort"] = ("Zadej port uvnitř kontejneru", "Enter the port inside the container"),
        ["ValEnv"] = ("Neplatný název proměnné: {0}", "Invalid variable name: {0}"),
    };
}

/// <summary>XAML: Text="{s:T Klíč}" — text v aktuálním jazyce, mění se za běhu.</summary>
[ContentProperty(nameof(Key))]
[AcceptEmptyServiceProvider]
public sealed class TExtension : IMarkupExtension<BindingBase>
{
    public string Key { get; set; } = "";

    public BindingBase ProvideValue(IServiceProvider serviceProvider) =>
        new Binding($"[{Key}]", BindingMode.OneWay, source: Loc.Instance);

    object IMarkupExtension.ProvideValue(IServiceProvider serviceProvider) => ProvideValue(serviceProvider);
}
