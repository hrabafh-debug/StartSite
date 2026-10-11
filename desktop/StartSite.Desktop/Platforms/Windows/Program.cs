using Microsoft.UI.Dispatching;
using Velopack;

namespace StartSite.Desktop.WinUI;

/// <summary>
/// Vlastní vstupní bod místo vygenerovaného. Velopack při instalaci, aktualizaci a odinstalaci
/// spouští aplikaci se speciálními argumenty; Run() je obslouží a proces ukončí dřív, než naskočí UI.
/// </summary>
public static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        VelopackApp.Build().Run();

        WinRT.ComWrappersSupport.InitializeComWrappers();
        Microsoft.UI.Xaml.Application.Start(callbackParams =>
        {
            var context = new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread());
            SynchronizationContext.SetSynchronizationContext(context);
            _ = new App();
        });
    }
}
