using StartSite.Desktop.Services;
using StartSite.Desktop.ViewModels;
using StartSite.Desktop.Views;

namespace StartSite.Desktop;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder
            .UseMauiApp<App>()
            .ConfigureFonts(fonts =>
            {
                fonts.AddFont("Geist-Regular.ttf", "GeistRegular");
                fonts.AddFont("Geist-Medium.ttf", "GeistMedium");
                fonts.AddFont("Geist-SemiBold.ttf", "GeistSemiBold");
                fonts.AddFont("GeistMono-Regular.ttf", "GeistMono");
                fonts.AddFont("GeistMono-Medium.ttf", "GeistMonoMedium");
                fonts.AddFont("Phosphor.ttf", "Phosphor");
                fonts.AddFont("Phosphor-Fill.ttf", "PhosphorFill");
            });

        builder.Services.AddSingleton<BackendHost>();
        builder.Services.AddSingleton<ApiClient>();
        builder.Services.AddSingleton<EventStream>();
        builder.Services.AddSingleton<UpdateService>();
        builder.Services.AddSingleton<MainViewModel>();
        builder.Services.AddSingleton<MainPage>();

        return builder.Build();
    }
}
