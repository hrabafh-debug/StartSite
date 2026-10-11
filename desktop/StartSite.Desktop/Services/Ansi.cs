// Převod ANSI barev z výstupu procesů na barevný text pro Label.FormattedText.
using System.Text;
using System.Text.RegularExpressions;

namespace StartSite.Desktop.Services;

public static partial class Ansi
{
    [GeneratedRegex(@"\u001b\[([0-9;?]*)([ -/]*[@-~])|\u001b\][^\u0007]*\u0007")]
    private static partial Regex Escape();

    public static string Strip(string text) => Escape().Replace(text, "");

    // Barvy čitelné ve světlém i tmavém režimu (stejné odstíny jako ve webovém UI)
    static readonly string[] Light = ["#71717A", "#DC2626", "#047857", "#B45309", "#0369A1", "#BE185D", "#0E7490", "#3F3F46"];
    static readonly string[] Dark = ["#71717A", "#F87171", "#34D399", "#FCD34D", "#38BDF8", "#F472B6", "#22D3EE", "#E4E4E7"];
    static readonly string[] LightBright = ["#A1A1AA", "#DC2626", "#059669", "#D97706", "#0284C7", "#DB2777", "#0891B2", "#18181B"];
    static readonly string[] DarkBright = ["#52525B", "#F87171", "#6EE7B7", "#FDE68A", "#7DD3FC", "#F9A8D4", "#67E8F9", "#FAFAFA"];

    public static FormattedString ToFormatted(string text, Color baseColor, bool dark, string fontFamily, double fontSize)
    {
        var result = new FormattedString();
        Color? fg = null;
        var bold = false;
        var buffer = new StringBuilder();

        void Flush()
        {
            if (buffer.Length == 0) return;
            result.Spans.Add(new Span
            {
                Text = buffer.ToString(),
                TextColor = fg ?? baseColor,
                FontFamily = bold ? "GeistMonoMedium" : fontFamily,
                FontSize = fontSize,
            });
            buffer.Clear();
        }

        var last = 0;
        foreach (Match m in Escape().Matches(text))
        {
            buffer.Append(text, last, m.Index - last);
            last = m.Index + m.Length;
            // Zajímají nás jen SGR sekvence (barva, tučně), ostatní zahodíme
            if (!m.Groups[2].Success || m.Groups[2].Value != "m") continue;
            Flush();
            int[] codes = m.Groups[1].Value.Length == 0
                ? [0]
                : m.Groups[1].Value.Split(';').Select(c => int.TryParse(c, out var n) ? n : 0).ToArray();
            for (var i = 0; i < codes.Length; i++)
            {
                var c = codes[i];
                if (c == 0) { fg = null; bold = false; }
                else if (c == 1) bold = true;
                else if (c == 22) bold = false;
                else if (c == 39) fg = null;
                else if (c is >= 30 and <= 37) fg = Color.FromArgb((dark ? Dark : Light)[c - 30]);
                else if (c is >= 90 and <= 97) fg = Color.FromArgb((dark ? DarkBright : LightBright)[c - 90]);
                else if (c == 38 && i + 2 < codes.Length && codes[i + 1] == 5) i += 2; // 256 barev: ignorujeme
                else if (c == 38 && i + 4 < codes.Length && codes[i + 1] == 2) i += 4; // truecolor: ignorujeme
            }
        }
        buffer.Append(text, last, text.Length - last);
        Flush();
        if (result.Spans.Count == 0) result.Spans.Add(new Span { Text = " ", FontFamily = fontFamily, FontSize = fontSize });
        return result;
    }
}
