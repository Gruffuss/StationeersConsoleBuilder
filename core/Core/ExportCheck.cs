using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Lua;
using ScriptedScreensVector;

namespace VectorBuilder.Core
{
    public sealed record ExportPage(string id, string surface, string src, bool empty, int w, int h);
    public sealed record ExportIssue(string level, string message, string? page = null, int? node = null, string? key = null);
    public sealed record ExportReport(bool complete, ExportIssue[] issues, long loadInstructions, long worstTickInstructions, int ticks, string[] visited);

    public static class ExportCheck
    {
        public static async Task<string> RunJsonAsync(string lua, string host, string pages)
        {
            ExportReport report;
            try
            {
                ExportPage[]? manifest;
                try { manifest = JsonSerializer.Deserialize(pages, ExportContext.Default.ExportPageArray); }
                catch (Exception e) when (e is JsonException or ArgumentException or NotSupportedException)
                { return Serialize(Failure(true, "arguments: the page manifest could not be read: " + e.Message)); }
                var parsed = HostJson.Parse(host, out var diagnostic);
                if (diagnostic != null && parsed == HostJson.Empty)
                    return Serialize(Failure(true, "host: " + diagnostic));
                report = await RunAsync(lua, parsed, manifest!);
                if (diagnostic != null)
                    report = report with { issues = [new("warning", "host: " + diagnostic), .. report.issues] };
            }
            catch (Exception e) { report = Failure(false, ResourceReason(e)); }
            return Serialize(report);
        }

        static string Serialize(ExportReport report) => JsonSerializer.Serialize(report, ExportContext.Default.ExportReport);
        static ExportReport Failure(bool complete, string reason) => new(complete, [new(complete ? "error" : "info", reason)], 0, 0, 0, []);
        static string ResourceReason(Exception e) => e is OutOfMemoryException
            ? "checking incomplete: runtime memory exhausted" : "checking incomplete: " + e.Message;

        internal static IEnumerable<ExportIssue> MeshDrops(ChipRunner chip, string surface, string? page)
        {
            foreach (var record in chip.Screens.ElementsOf(surface))
                if (chip.Vectors.SceneOf(surface, record.Id) is { Builder.Dropped: not null } live)
                    yield return new("warning", $"{record.Id}: DROPPED: {live.Builder.Dropped} -- everything in it is missing from the console", page);
        }

        public static async Task<ExportReport> RunAsync(string lua, HostJson host, ExportPage[] pages)
        {
            var issues = new List<ExportIssue>();
            var seen = new HashSet<(string level, string? page, string message)>();
            var visited = new List<string>();
            var attempted = new HashSet<string>(StringComparer.Ordinal);
            string? haltedOpening = null;  // the page whose opening tick halted the chip: its visit never finished
            long load = 0, worst = 0;
            int ticks = 0;
            double now = 0;
            void Add(string level, string message, string? page = null, string phase = "")
            {
                if (seen.Add((level, page, message))) issues.Add(new(level, phase + message, page));
            }
            ExportReport Report(bool complete) => new(complete, issues.ToArray(), load, worst, ticks, visited.ToArray());
            try
            {
                if (lua == null || host == null || pages == null)
                    return Failure(true, "arguments: Lua, host and page manifest are required");
                var ids = new HashSet<string>(StringComparer.Ordinal);
                var surfaces = new HashSet<string>(StringComparer.Ordinal);
                foreach (var p in pages)
                    if (p == null || string.IsNullOrWhiteSpace(p.id) || string.IsNullOrWhiteSpace(p.surface) || p.src == null
                        || p.w <= 0 || p.h <= 0 || !ids.Add(p.id) || !surfaces.Add(p.surface))
                        return Failure(true, "arguments: pages require unique IDs/surfaces, source text and positive pixel sizes");

                foreach (var p in pages)
                {
                    if (p.empty) continue;
                    // ToProps leaves its last rejection untouched for blank text.
                    var props = string.IsNullOrWhiteSpace(p.src) ? null : SceneText.ToProps(p.src, p.id);
                    var scene = props == null ? null : SceneParser.Parse(props);
                    if (scene == null)
                        Add("error", props == null && !string.IsNullOrWhiteSpace(p.src) ? SceneText.Rejected ?? "the scene text could not be read" : "the scene could not be read", p.id, $"page {p.id}: ");
                    else foreach (var message in scene.Problems) Add("warning", message, p.id, $"page {p.id}: ");
                }

                try { LuaState.Create().Load(lua.AsSpan(), "chip"); }
                catch (Exception e) when (e is LuaParseException or LuaCompileException)
                {
                    Add("error", e.Message, phase: "compile: ");
                    return Report(true);
                }

                static int Budget(int? b, int fallback) => b is int v ? Math.Clamp(v / 1000 * 1000, 1000, 10_000_000) : fallback;
                var chip = new ChipRunner(Budget(host.budgets?.load, 500_000), Budget(host.budgets?.tick, 50_000), () => now,
                    host with { persist = null, memory = null });
                chip.Screens.Beta = host.beta;
                chip.Screens.Size = pages.Length == 0 ? (460, 460) : (pages[0].w, pages[0].h);
                foreach (var p in pages) chip.Screens.Sizes[p.surface] = (p.w, p.h);
                var bySurface = pages.ToDictionary(p => p.surface, StringComparer.Ordinal);

                void Inspect(string phase)
                {
                    foreach (var surface in chip.Screens.SurfaceNames.ToArray())
                    {
                        var page = bySurface.GetValueOrDefault(surface)?.id;
                        var frame = Compositor.Compose(chip, surface, 1f, false);
                        foreach (var problem in frame.Problems) Add("warning", problem.Message, page, phase);
                        foreach (var drop in MeshDrops(chip, surface, page)) Add(drop.level, drop.message, drop.page, phase);
                    }
                    foreach (var refusal in chip.Stationeers.PersistRefusals) Add("warning", refusal, phase: phase);
                    foreach (var lost in chip.Screens.LostWrites) Add("warning", "lost write: " + lost, phase: phase);
                }

                await chip.LoadAsync(lua);
                load = chip.LastInstructions;
                if (chip.Error != null) Add("error", chip.Error, phase: "load: ");
                Inspect("load: ");

                async Task Tick(ExportPage? opening = null)
                {
                    if (opening != null) { attempted.Add(opening.id); chip.Screens.QueueVisit(opening.id); }
                    now += 0.5;
                    ticks++;
                    var phase = $"tick {ticks}" + (opening == null ? "" : $" (opening page {opening.id})") + ": ";
                    await chip.TickAsync(0.5);
                    worst = Math.Max(worst, chip.LastInstructions);
                    if (chip.Error != null) Add("error", chip.Error, opening?.id, phase);
                    if (opening != null && chip.State == ChipState.Halted) haltedOpening = opening.id;
                    Inspect(phase);
                    if (opening != null && chip.Screens.ActiveSurface == opening.surface
                        && (opening.empty || chip.Screens.ElementsOf(opening.surface).Any(e => chip.Vectors.SceneOf(opening.surface, e.Id) != null)))
                        visited.Add(opening.id);
                }

                foreach (var p in pages)
                {
                    if (chip.State == ChipState.Halted) break;
                    await Tick(p);
                    if (chip.State == ChipState.Running) await Tick();
                }
                while (ticks < 20 && chip.State == ChipState.Running) await Tick();
                foreach (var p in pages)
                    if (!visited.Contains(p.id))
                    {
                        if (chip.State == ChipState.Halted && !attempted.Contains(p.id))
                            Add("info", "not reached because of the halt; this page was not checked at runtime", p.id, $"page {p.id}: ");
                        else if (chip.State == ChipState.Halted && p.id == haltedOpening)
                            Add("info", "not visited: the halt stopped its opening; this page was not checked at runtime", p.id, $"page {p.id}: ");
                        else if (!p.empty) Add("error", "expected vector page never built/available after its visit", p.id, $"page {p.id}: ");
                    }
                Add("info", $"Sampled {ticks} ticks at dt=0.5 ({now.ToString("0.###", CultureInfo.InvariantCulture)} seconds) with cold persist/memory and supplied simulated values; no actual physics or all-future-path guarantee.");
                Add("info", "No-click sample: click handlers, TMP/font layout and page-font downloads/Fonts API delivery were not checked; the mod caps scene problems at 16 distinct messages per scene.");
                Add("info", "Starvation was sampled at each page's own px size (scale 1); in-game detail can change with player distance.");
                return Report(true);
            }
            catch (Exception e) { Add("info", ResourceReason(e)); return Report(false); }
        }
    }

    [JsonSerializable(typeof(ExportPage[]))]
    [JsonSerializable(typeof(ExportReport))]
    internal sealed partial class ExportContext : JsonSerializerContext { }
}
