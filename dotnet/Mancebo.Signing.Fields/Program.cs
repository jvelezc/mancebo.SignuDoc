using System.Security.Cryptography;
using System.Text;
using Mancebo.Signing.Fields;
using UglyToad.PdfPig.Core;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = PdfFieldDetector.MaximumPdfBytes);
builder.Services.AddProblemDetails();

var configuredToken = builder.Configuration["SIGNING_FIELD_SERVICE_TOKEN"];
if (string.IsNullOrWhiteSpace(configuredToken) || configuredToken.Length < 32)
    throw new InvalidOperationException("SIGNING_FIELD_SERVICE_TOKEN must contain at least 32 characters.");
var tokenHash = SHA256.HashData(Encoding.UTF8.GetBytes("Bearer " + configuredToken));
var scans = new SemaphoreSlim(2);
var app = builder.Build();
app.UseExceptionHandler();
app.MapGet("/healthz", () => Results.Ok(new { status = "ready" }));
app.MapPost("/v1/field-suggestions", async (HttpRequest request, ILoggerFactory logs, CancellationToken ct) =>
{
    if (!CryptographicOperations.FixedTimeEquals(
        SHA256.HashData(Encoding.UTF8.GetBytes(request.Headers.Authorization.ToString())), tokenHash))
        return Results.Unauthorized();
    if (!string.Equals(request.ContentType, "application/pdf", StringComparison.OrdinalIgnoreCase))
        return Results.Problem(statusCode: 415, title: "A PDF body is required.");
    if (request.ContentLength is > PdfFieldDetector.MaximumPdfBytes)
        return Results.Problem(statusCode: 413, title: "The PDF exceeds the supported size.");
    if (!scans.Wait(0))
        return Results.Problem(statusCode: 429, title: "Field detection is busy.");
    try
    {
        using var body = new MemoryStream();
        await request.Body.CopyToAsync(body, ct);
        if (body.GetBuffer().AsSpan(0, (int)Math.Min(body.Length, 1024)).IndexOf("%PDF-"u8) < 0)
            return Results.Problem(statusCode: 422, title: "The PDF could not be read.");
        body.Position = 0;
        return Results.Ok(PdfFieldDetector.Detect(body, ct));
    }
    catch (Exception ex) when (ex is PdfDocumentFormatException or InvalidDataException or NotSupportedException)
    {
        logs.CreateLogger("SigningFields").LogInformation(
            "PDF field detection could not read the input ({ReasonType}).", ex.GetType().Name);
        return Results.Problem(statusCode: 422, title: "The PDF could not be read.");
    }
    finally
    {
        scans.Release();
    }
})
.WithName("DetectSigningFields")
.WithSummary("Suggest fields in a PDF without editing the document")
.Produces<FieldDetection>()
.ProducesProblem(413)
.ProducesProblem(415)
.ProducesProblem(422)
.ProducesProblem(429);
app.Run();
