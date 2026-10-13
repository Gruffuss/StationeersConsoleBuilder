using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using VectorBuilder.Core;

static class M4Tests
{
    public static string? GenerationError(string dir, string root)
    {
        try
        {
            var stampFile = Path.Combine(dir, "stamp.json");
            if (!File.Exists(stampFile)) return "missing generation stamp; run web tests before C# tests";
            var stamp = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(File.ReadAllText(stampFile));
            string Hash(string file) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant();
            var inputs = new[] { "web/src", "templates" }.SelectMany(p => Directory.GetFiles(Path.Combine(root, p), "*", SearchOption.AllDirectories))
                .Append(Path.Combine(root, "web/package.json")).Append(Path.Combine(root, "web/package-lock.json"))
                .ToDictionary(p => Path.GetRelativePath(root, p).Replace('\\', '/'), Hash);
            bool Matches(Dictionary<string, string> expected, Dictionary<string, string>? actual) =>
                actual != null && expected.Count == actual.Count && expected.All(p => actual.TryGetValue(p.Key, out var hash) && hash == p.Value);
            if (!Matches(inputs, stamp?.GetValueOrDefault("inputs"))) return "stale generation inputs; run web tests before C# tests";
            var artifacts = Directory.GetFiles(dir).Where(p => p.EndsWith(".lua") || p.EndsWith(".host.json") || p.EndsWith(".pages.json"))
                .ToDictionary(p => Path.GetFileName(p), Hash);
            if (!Matches(artifacts, stamp?.GetValueOrDefault("artifacts"))) return "missing or changed generated artifacts; run web tests before C# tests";
            return null;
        }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
        { return "generation stamp could not be checked; run web tests before C# tests"; }
    }

    public static void Run(Action<bool, string> check)
    {
        var dir = Path.GetFullPath(Path.Combine(Fixtures.Root, "..", "..", ".test-artifacts", "m4-artifacts"));
        var root = Path.GetFullPath(Path.Combine(Fixtures.Root, "..", ".."));
        if (GenerationError(dir, root) is { } generationError) { check(false, "M4: " + generationError); return; }
        check(true, "M4: generation stamp matches current inputs and exact artifact bytes");
        var files = Directory.Exists(dir) ? Directory.GetFiles(dir, "template-*.lua") : [];
        check(files.Length == 20, "M4: exactly twenty just-generated embedded on/off template artifacts (run web tests first)");
        foreach (var file in files.Append(Path.Combine(dir, "font-native-on.lua")))
        {
            if (!File.Exists(file)) { check(false, "M4: generated FONT/native-only artifact exists"); continue; }
            var stem = file.EndsWith("-on.lua") ? file[..^7] : file[..^8];
            var host = HostJson.Parse(File.ReadAllText(stem + ".host.json"), out var error);
            var pages = JsonSerializer.Deserialize<ExportPage[]>(File.ReadAllText(stem + ".pages.json"))!;
            var lua = File.ReadAllText(file);
            var report = ExportCheck.RunAsync(lua, host, pages).GetAwaiter().GetResult();
            check(error == null && report.complete && !report.issues.Any(i => i.level == "error"), $"M4 {Path.GetFileName(file)}: exact artifact compiles/runs without blocking errors");
            check(report.visited.SequenceEqual(pages.Select(p => p.id)) && report.ticks == Math.Max(20, 2 * pages.Length), $"M4 {Path.GetFileName(file)}: every explicit page visited and baseline ticks");
            check(lua.Contains("builder 0.4.0 · UTC 2026-10-12T00:00:00.000Z") && !lua.Contains('\r') && lua.Contains("floor = 11118"), $"M4 {Path.GetFileName(file)}: fixed UTC builder metadata, LF and floor");
            Console.WriteLine($"MEASURE M4 {Path.GetFileName(file)}: {Encoding.UTF8.GetByteCount(lua)} source bytes, {pages.Length} pages, {report.ticks} ticks, load {report.loadInstructions}, worst tick {report.worstTickInstructions}");
        }
    }
}
