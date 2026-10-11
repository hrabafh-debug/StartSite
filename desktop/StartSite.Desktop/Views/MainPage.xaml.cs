using System.ComponentModel;
using StartSite.Desktop.ViewModels;

namespace StartSite.Desktop.Views;

public partial class MainPage : ContentPage
{
    readonly MainViewModel vm;
    bool started;
    bool keysHooked;

    /// <summary>Vlastní záhlaví okna ve stylu aplikace (logo, hledání, akce u tlačítek okna).</summary>
    public TitleBar AppTitleBar { get; }

    public MainPage(MainViewModel vm)
    {
        InitializeComponent();
        BindingContext = this.vm = vm;
        AppTitleBar = BuildTitleBar(vm);
        ApplyListWidth(Preferences.Get("listWidth", DefaultListWidth));
        Splitter.HandlerChanged += (_, _) => HookSplitter();
        vm.Form.PropertyChanged += OnFormChanged;
        if (Application.Current != null)
            Application.Current.RequestedThemeChanged += (_, _) => vm.RebuildLogColors();
        // Nativní okno existuje až po načtení stránky
        Loaded += async (_, _) =>
        {
            HookKeys();
            // WinUI dá fokus prvnímu poli (hledání) a zkratky by se psaly do něj
            await Task.Delay(300);
            SearchEntry.Unfocus();
        };
    }

    // ---------- šířka seznamu projektů ----------

    const double DefaultListWidth = 380;
    const double MinListWidth = 260;
    const double MaxListWidth = 720;
    double ListWidth => MainGrid.ColumnDefinitions[0].Width.Value;

    void ApplyListWidth(double width)
    {
        // Detail musí mít aspoň 360 px, i když je okno úzké
        var max = Width > 0 ? Math.Min(MaxListWidth, Width - 360) : MaxListWidth;
        MainGrid.ColumnDefinitions[0].Width = new GridLength(Math.Clamp(width, MinListWidth, Math.Max(MinListWidth, max)));
    }

    void HighlightSplitter(bool on)
    {
        SplitterLine.WidthRequest = on ? 2 : 1;
        if (on) SplitterLine.SetAppThemeColor(BoxView.ColorProperty, Color.FromArgb("#A1A1AA"), Color.FromArgb("#52525B"));
        else SplitterLine.SetAppThemeColor(BoxView.ColorProperty, Color.FromArgb("#E4E4E7"), Color.FromArgb("#27272A"));
    }

#if WINDOWS
    bool splitterHooked;
    bool dragging;
    double dragStartX;
    double dragStartWidth;
#endif

    /// <summary>
    /// Tažení úchytu přes nativní WinUI ukazatel. MAUI PanGestureRecognizer s myší na Windows
    /// nespolehlivě startuje a bez zachycení ukazatele by se tažení utrhlo, jakmile myš opustí úchyt.
    /// </summary>
    void HookSplitter()
    {
#if WINDOWS
        if (splitterHooked || Splitter.Handler?.PlatformView is not Microsoft.UI.Xaml.UIElement element) return;
        splitterHooked = true;

        // Kurzor ↔: WinUI ho nastavuje jen přes chráněnou vlastnost
        typeof(Microsoft.UI.Xaml.UIElement)
            .GetProperty("ProtectedCursor", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
            ?.SetValue(element, Microsoft.UI.Input.InputSystemCursor.Create(Microsoft.UI.Input.InputSystemCursorShape.SizeWestEast));

        void EndDrag()
        {
            if (!dragging) return;
            dragging = false;
            Preferences.Set("listWidth", ListWidth);
            HighlightSplitter(false);
        }

        element.PointerEntered += (_, _) => HighlightSplitter(true);
        element.PointerExited += (_, _) =>
        {
            if (!dragging) HighlightSplitter(false);
        };
        element.PointerPressed += (_, e) =>
        {
            dragging = true;
            // Pozice vůči oknu v DIP, stejné jednotky jako šířka sloupce
            dragStartX = e.GetCurrentPoint(null).Position.X;
            dragStartWidth = ListWidth;
            element.CapturePointer(e.Pointer);
            HighlightSplitter(true);
            e.Handled = true;
        };
        element.PointerMoved += (_, e) =>
        {
            if (!dragging) return;
            ApplyListWidth(dragStartWidth + e.GetCurrentPoint(null).Position.X - dragStartX);
            e.Handled = true;
        };
        element.PointerReleased += (_, e) =>
        {
            element.ReleasePointerCapture(e.Pointer);
            EndDrag();
            e.Handled = true;
        };
        element.PointerCaptureLost += (_, _) => EndDrag();
        element.DoubleTapped += (_, e) =>
        {
            ApplyListWidth(DefaultListWidth);
            Preferences.Set("listWidth", ListWidth);
            e.Handled = true;
        };
#endif
    }

    TitleBar BuildTitleBar(MainViewModel model)
    {
        // Díly jsou v XAML kvůli stylům a bindingům, tady je jen přesuneme do záhlaví
        HeaderParts.Children.Clear();
        var bar = new TitleBar
        {
            HeightRequest = 48,
            BindingContext = model,
            LeadingContent = HeaderLeading,
            Content = HeaderSearch,
            TrailingContent = HeaderTrailing,
        };
        bar.SetAppThemeColor(TitleBar.BackgroundColorProperty, Color.FromArgb("#FAFAFA"), Color.FromArgb("#09090B"));
        bar.SetAppThemeColor(TitleBar.ForegroundColorProperty, Color.FromArgb("#18181B"), Color.FromArgb("#F4F4F5"));
        return bar;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        HookKeys();
        if (started) return;
        started = true;
        await vm.InitAsync();
    }

    // Formulář vyjede zprava
    async void OnFormChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(ProjectFormViewModel.IsOpen) || !vm.Form.IsOpen) return;
        FormPanel.TranslationX = 24;
        FormPanel.Opacity = 0;
        await Task.WhenAll(
            FormPanel.TranslateToAsync(0, 0, 220, Easing.CubicOut),
            FormPanel.FadeToAsync(1, 180, Easing.CubicOut));
        if (string.IsNullOrEmpty(vm.Form.Path)) PathEntry.Focus();
    }

    // ---------- klávesové zkratky ----------

    void HookKeys()
    {
#if WINDOWS
        if (keysHooked) return;
        if (Window?.Handler?.PlatformView is not Microsoft.UI.Xaml.Window native || native.Content is not Microsoft.UI.Xaml.UIElement root) return;
        keysHooked = true;
        root.AddHandler(Microsoft.UI.Xaml.UIElement.KeyDownEvent, new Microsoft.UI.Xaml.Input.KeyEventHandler(OnKeyDown), true);
        // Akcelerátory fungují v celém okně, i když nic nemá fokus
        root.KeyboardAcceleratorPlacementMode = Microsoft.UI.Xaml.Input.KeyboardAcceleratorPlacementMode.Hidden;
        AddShortcut(root, Windows.System.VirtualKey.N, () => vm.NewProjectCommand.Execute(null));
        AddShortcut(root, Windows.System.VirtualKey.S, () =>
        {
            if (vm.Selected is { Busy: false }) vm.ToggleCommand.Execute(vm.Selected);
        });
        // "/": US klávesnice, numerická klávesnice a česká Shift+ú
        AddShortcut(root, (Windows.System.VirtualKey)191, () => SearchEntry.Focus());
        AddShortcut(root, Windows.System.VirtualKey.Divide, () => SearchEntry.Focus());
        AddShortcut(root, (Windows.System.VirtualKey)219, () => SearchEntry.Focus(), Windows.System.VirtualKeyModifiers.Shift);
#endif
    }

#if WINDOWS
    bool TextInputFocused()
    {
        if (Window?.Handler?.PlatformView is not Microsoft.UI.Xaml.Window native) return false;
        var focused = Microsoft.UI.Xaml.Input.FocusManager.GetFocusedElement(native.Content.XamlRoot);
        return focused is Microsoft.UI.Xaml.Controls.TextBox or Microsoft.UI.Xaml.Controls.ComboBox;
    }

    void OnKeyDown(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Escape)
        {
            if (vm.Form.IsOpen) vm.Form.CloseCommand.Execute(null);
            else if (SearchEntry.IsFocused)
            {
                vm.Search = "";
                SearchEntry.Unfocus();
            }
            return;
        }
        if (vm.Form.IsOpen || TextInputFocused()) return;
        if (e.Key == Windows.System.VirtualKey.Down) { vm.SelectRelative(1); e.Handled = true; }
        else if (e.Key == Windows.System.VirtualKey.Up) { vm.SelectRelative(-1); e.Handled = true; }
    }

    void AddShortcut(Microsoft.UI.Xaml.UIElement root, Windows.System.VirtualKey key, Action action,
        Windows.System.VirtualKeyModifiers modifiers = Windows.System.VirtualKeyModifiers.None)
    {
        var accelerator = new Microsoft.UI.Xaml.Input.KeyboardAccelerator { Key = key, Modifiers = modifiers };
        accelerator.Invoked += (_, args) =>
        {
            // Při psaní do pole nebo v otevřeném formuláři necháme znak projít
            if (vm.Form.IsOpen || TextInputFocused())
            {
                args.Handled = false;
                return;
            }
            args.Handled = true;
            action();
        };
        root.KeyboardAccelerators.Add(accelerator);
    }
#endif
}
