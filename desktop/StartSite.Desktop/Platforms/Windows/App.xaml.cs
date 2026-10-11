using Microsoft.UI.Xaml;

// To learn more about WinUI, the WinUI project structure,
// and more about our project templates, see: http://aka.ms/winui-project-info.

namespace StartSite.Desktop.WinUI;

/// <summary>
/// Provides application-specific behavior to supplement the default Application class.
/// </summary>
public partial class App : MauiWinUIApplication
{
	/// <summary>
	/// Initializes the singleton application object.  This is the first line of authored code
	/// executed, and as such is the logical equivalent of main() or WinMain().
	/// </summary>
	static System.Threading.Mutex? singleInstance;

	public App()
	{
		// Jen jedna instance: druhé spuštění přenese do popředí okno, které už běží
		singleInstance = new System.Threading.Mutex(true, "StartSite.Desktop.SingleInstance", out var created);
		if (!created)
		{
			FocusExistingWindow();
			Environment.Exit(0);
		}
		this.InitializeComponent();
		// Neošetřené výjimky zapisujeme do %LOCALAPPDATA%\StartSite\crash.log
		UnhandledException += (_, e) => LogCrash(e.Exception);
		AppDomain.CurrentDomain.UnhandledException += (_, e) => LogCrash(e.ExceptionObject as Exception);
		TaskScheduler.UnobservedTaskException += (_, e) => LogCrash(e.Exception);
	}

	[System.Runtime.InteropServices.DllImport("user32.dll")]
	static extern bool SetForegroundWindow(IntPtr hWnd);

	[System.Runtime.InteropServices.DllImport("user32.dll")]
	static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

	static void FocusExistingWindow()
	{
		var current = System.Diagnostics.Process.GetCurrentProcess();
		foreach (var p in System.Diagnostics.Process.GetProcessesByName(current.ProcessName))
		{
			if (p.Id == current.Id || p.MainWindowHandle == IntPtr.Zero) continue;
			ShowWindow(p.MainWindowHandle, 9); // SW_RESTORE
			SetForegroundWindow(p.MainWindowHandle);
			break;
		}
	}

	static void LogCrash(Exception? ex)
	{
		try
		{
			var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StartSite");
			Directory.CreateDirectory(dir);
			File.AppendAllText(Path.Combine(dir, "crash.log"), $"{DateTime.Now:O}\n{ex}\n\n");
		}
		catch
		{
			// zápis logu nesmí shodit aplikaci podruhé
		}
	}

	protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();
}

