using StartSite.Desktop.Services;

namespace StartSite.Desktop.Views;

public partial class ClaudeImportCard : ContentView
{
    public ClaudeImportCard()
    {
        InitializeComponent();
        McpCommandLabel.Text = McpCommand();
    }

    /// <summary>Registrační příkaz se skutečnou cestou k repu, ať ho jde rovnou vložit do terminálu.</summary>
    static string McpCommand()
    {
        var root = IPlatformApplication.Current?.Services.GetService<BackendHost>()?.RepoRoot;
        var entry = root != null ? Path.Combine(root, "mcp", "index.js").Replace('\\', '/') : "<StartSite>/mcp/index.js";
        return $"claude mcp add startsite -- node \"{entry}\"";
    }

    async void OnCopyMcp(object? sender, EventArgs e) => await CopyAsync(CopyMcpButton, McpCommandLabel.Text ?? "");

    async void OnCopyPrompt(object? sender, EventArgs e) => await CopyAsync(CopyPromptButton, Loc.T("ClaudeImportPrompt"));

    static async Task CopyAsync(Button button, string text)
    {
        await Clipboard.Default.SetTextAsync(text);
        // Krátké potvrzení na tlačítku, pak zpět na binding s překladem
        button.Text = Loc.T("Copied");
        await Task.Delay(1400);
        button.SetBinding(Button.TextProperty, new Binding("[Copy]", source: Loc.Instance));
    }
}
