using System.Globalization;

namespace StartSite.Desktop.Controls;

public sealed class InverseBoolConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value is not true;
    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => value is not true;
}

/// <summary>true, když text není prázdný. Pro chybové a pomocné hlášky.</summary>
public sealed class HasTextConverter : IValueConverter
{
    // ConverterParameter=invert vrátí opak (true pro prázdný text)
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        !string.IsNullOrWhiteSpace(value as string) ^ (parameter as string == "invert");
    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
