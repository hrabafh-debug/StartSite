using StartSite.Desktop.Views;

namespace StartSite.Desktop;

public partial class App : Application
{
    readonly IServiceProvider services;

    // Stránku si vyžádáme až v CreateWindow, kdy už jsou načtené zdroje z App.xaml
    public App(IServiceProvider services)
    {
        InitializeComponent();
        this.services = services;
        // Motiv: podle systému, dokud si ho uživatel nepřepne
        UserAppTheme = Preferences.Get("theme", "system") switch
        {
            "light" => AppTheme.Light,
            "dark" => AppTheme.Dark,
            _ => AppTheme.Unspecified,
        };
    }

    protected override Window CreateWindow(IActivationState? activationState) =>
        new(services.GetRequiredService<MainPage>())
        {
            Title = "StartSite",
            Width = 1360,
            Height = 860,
            MinimumWidth = 760,
            MinimumHeight = 520,
        };
}
