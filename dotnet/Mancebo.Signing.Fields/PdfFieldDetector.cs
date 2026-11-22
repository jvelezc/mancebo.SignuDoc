using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Annotations;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Tokens;

namespace Mancebo.Signing.Fields;

/// <summary>A proposed editable field in normalized, top-left page coordinates.</summary>
public sealed record FieldSuggestion(int Page, string Type, string Label, double X, double Y,
    double Width, double Height, bool Required, string Source);

/// <summary>Field suggestions and the number of pages inspected.</summary>
public sealed record FieldDetection(int Pages, int ScannedPages, bool Truncated, IReadOnlyList<FieldSuggestion> Fields);

public static partial class PdfFieldDetector
{
    public const int MaximumPdfBytes = 20 * 1024 * 1024;
    private const int MaximumPages = 100;
    private const int MaximumFields = 200;

    public static FieldDetection Detect(Stream pdf, CancellationToken ct = default)
    {
        using var document = PdfDocument.Open(pdf);
        var pageCount = document.NumberOfPages;
        var inspected = Math.Min(MaximumPages, pageCount);
        var fields = new List<FieldSuggestion>();
        var capped = false;
        for (var number = 1; number <= inspected; number++)
        {
            ct.ThrowIfCancellationRequested();
            var page = document.GetPage(number);
            foreach (var annotation in page.ExperimentalAccess.GetAnnotations())
            {
                if (annotation.Type != AnnotationType.Widget ||
                    (annotation.Flags & (AnnotationFlags.Hidden | AnnotationFlags.Invisible | AnnotationFlags.NoView)) != 0)
                    continue;
                var widget = annotation.AnnotationDictionary;
                var chain = GetFieldChain(document, widget);
                var flags = (FieldProperty(chain, "Ff") as NumericToken)?.Int ?? 0;
                if ((flags & 1) != 0)
                    continue;
                var label = ReadText(FieldProperty(chain, "TU")) ?? ReadText(FieldProperty(chain, "T")) ?? "";
                var type = (FieldProperty(chain, "FT") as NameToken)?.Data;
                var kind = type switch
                {
                    "Sig" when FieldProperty(chain, "V") is null or NullToken => "signature",
                    "Tx" => Identify(label) ?? "text",
                    "Btn" when (flags & ((1 << 15) | (1 << 16))) == 0 => "checkbox",
                    _ => null,
                };
                if (kind is not null && widget.TryGet(NameToken.Rect, out var rect) &&
                    rect is ArrayToken array && array.Data.Count == 4 && array.Data.All(value => value is NumericToken))
                {
                    var coordinates = array.Data.Cast<NumericToken>().Select(value => value.Double).ToArray();
                    Add(FromWidget(page, new PdfRectangle(coordinates[0], coordinates[1], coordinates[2], coordinates[3]),
                        kind, label, (flags & 2) != 0));
                }
            }

            if (page.Rotation.Value == 0)
                SuggestTextFields(page, Add);

            void Add(FieldSuggestion? suggestion)
            {
                if (suggestion is null || fields.Any(field => Overlaps(field, suggestion)))
                    return;
                if (fields.Count == MaximumFields)
                    capped = true;
                else
                    fields.Add(suggestion);
            }
        }
        return new(pageCount, inspected, capped || pageCount > inspected, fields);
    }

    private static IReadOnlyList<DictionaryToken> GetFieldChain(PdfDocument document, DictionaryToken widget)
    {
        var chain = new List<DictionaryToken> { widget };
        var current = widget;
        for (var depth = 0; depth < 12 && current.TryGet(NameToken.Parent, out var parent); depth++)
        {
            if (parent is IndirectReferenceToken reference)
                parent = document.Structure.GetObject(reference.Data)?.Data;
            if (parent is not DictionaryToken dictionary || chain.Contains(dictionary))
                break;
            chain.Add(dictionary);
            current = dictionary;
        }
        return chain;
    }

    private static IToken? FieldProperty(IReadOnlyList<DictionaryToken> chain, string property)
    {
        var key = NameToken.Create(property);
        foreach (var item in chain)
            if (item.TryGet(key, out var value))
                return value;
        return null;
    }

    private static string? ReadText(IToken? token) => token switch
    {
        StringToken literal => literal.Data,
        HexToken hex => hex.Data,
        _ => null,
    };

    private static FieldSuggestion? FromWidget(Page page, PdfRectangle rectangle, string type, string label, bool required)
    {
        var crop = page.CropBox.Bounds;
        var points = new[] { rectangle.BottomLeft, rectangle.BottomRight, rectangle.TopLeft, rectangle.TopRight }
            .Select(point =>
            {
                var x = (point.X - crop.BottomLeft.X) / crop.Width;
                var y = (point.Y - crop.BottomLeft.Y) / crop.Height;
                return page.Rotation.Value switch
                {
                    90 => (X: y, Y: x),
                    180 => (X: 1 - x, Y: y),
                    270 => (X: 1 - y, Y: 1 - x),
                    _ => (X: x, Y: 1 - y),
                };
            }).ToArray();
        return MakeField(page.Number, type, label, points.Min(p => p.X), points.Min(p => p.Y),
            points.Max(p => p.X), points.Max(p => p.Y), required, "pdf_form");
    }

    private static void SuggestTextFields(Page page, Action<FieldSuggestion?> add)
    {
        var words = page.GetWords().Take(10_000).ToArray();
        for (var i = 0; i < words.Length; i++)
        {
            var label = words[i];
            var kind = Identify(label.Text);
            if (kind is null)
                continue;
            var bounds = label.BoundingBox;
            var next = i + 1 < words.Length ? words[i + 1] : null;
            if (next is null || !BlankLine().IsMatch(next.Text))
                continue;
            var line = next.BoundingBox;
            var horizontalGap = line.Left - bounds.Right;
            if (horizontalGap < -1 || horizontalGap > 48 || Math.Abs(line.Top - bounds.Bottom) > Math.Max(12, bounds.Height))
                continue;
            add(MakeField(page.Number, kind, label.Text, line.Left / page.Width,
                1 - Math.Max(bounds.Top, line.Top + 10) / page.Height,
                line.Right / page.Width, 1 - Math.Min(bounds.Bottom, line.Bottom - 2) / page.Height,
                true, "text_label"));
        }
    }

    private static string? Identify(string label) => LabelWords().Replace(label, " ").Trim().ToLowerInvariant() switch
    {
        "signature" or "sign here" or "signature of signer" => "signature",
        "initials" => "initials",
        "date" or "date signed" or "signing date" => "date",
        "name" or "full name" or "printed name" => "name",
        _ => null,
    };

    private static FieldSuggestion? MakeField(int page, string type, string label, double left, double top,
        double right, double bottom, bool required, string source)
    {
        if (!(double.IsFinite(left) && double.IsFinite(top) && double.IsFinite(right) && double.IsFinite(bottom)))
            return null;
        left = Math.Clamp(left, 0, 1);
        top = Math.Clamp(top, 0, 1);
        right = Math.Clamp(right, 0, 1);
        bottom = Math.Clamp(bottom, 0, 1);
        if (right - left < 0.005 || bottom - top < 0.005)
            return null;
        var clean = new string(label.Where(c => !char.IsControl(c)).Take(80).ToArray()).Trim();
        return new(page, type, clean.Length == 0 ? type : clean, left, top, right - left, bottom - top, required, source);
    }

    private static bool Overlaps(FieldSuggestion first, FieldSuggestion second)
    {
        if (first.Page != second.Page)
            return false;
        var sharedWidth = Math.Min(first.X + first.Width, second.X + second.Width) - Math.Max(first.X, second.X);
        var sharedHeight = Math.Min(first.Y + first.Height, second.Y + second.Height) - Math.Max(first.Y, second.Y);
        return sharedWidth > 0 && sharedHeight > 0 &&
            sharedWidth * sharedHeight >= 0.65 * Math.Min(first.Width * first.Height, second.Width * second.Height);
    }

    [GeneratedRegex("[^A-Za-z]+", RegexOptions.CultureInvariant)]
    private static partial Regex LabelWords();

    [GeneratedRegex("^_{3,}$", RegexOptions.CultureInvariant)]
    private static partial Regex BlankLine();
}
