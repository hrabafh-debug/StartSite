using Microsoft.Maui.Controls.Shapes;

namespace StartSite.Desktop.Controls;

/// <summary>Stavová tečka. Běžící projekt jemně pulzuje, startující bliká.</summary>
public sealed class StatusDot : Grid
{
    public static readonly BindableProperty StatusProperty = BindableProperty.Create(
        nameof(Status), typeof(string), typeof(StatusDot), "stopped", propertyChanged: (b, _, _) => ((StatusDot)b).Apply());

    public string Status
    {
        get => (string)GetValue(StatusProperty);
        set => SetValue(StatusProperty, value);
    }

    readonly Ellipse halo = new() { WidthRequest = 8, HeightRequest = 8, Opacity = 0 };
    readonly Ellipse dot = new() { WidthRequest = 8, HeightRequest = 8 };

    public StatusDot()
    {
        WidthRequest = 20;
        HeightRequest = 20;
        VerticalOptions = LayoutOptions.Center;
        Children.Add(halo);
        Children.Add(dot);
        Apply();
    }

    void Apply()
    {
        this.AbortAnimation("pulse");
        dot.Opacity = 1;
        halo.Opacity = 0;
        halo.Scale = 1;
        var color = Status switch
        {
            "running" => Color.FromArgb("#10B981"),
            "starting" => Color.FromArgb("#F59E0B"),
            "error" => Color.FromArgb("#EF4444"),
            _ => Color.FromArgb("#A1A1AA"),
        };
        dot.Fill = halo.Fill = new SolidColorBrush(color);

        if (Status == "running")
        {
            new Animation(v =>
            {
                halo.Scale = 1 + 1.4 * v;
                halo.Opacity = 0.5 * (1 - v);
            }, 0, 1, Easing.CubicOut).Commit(this, "pulse", 16, 2200, repeat: () => Status == "running");
        }
        else if (Status == "starting")
        {
            new Animation(v => dot.Opacity = 0.35 + 0.65 * Math.Abs(1 - 2 * v))
                .Commit(this, "pulse", 16, 1400, repeat: () => Status == "starting");
        }
    }
}
