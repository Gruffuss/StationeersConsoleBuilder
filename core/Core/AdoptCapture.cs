using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Lua;
using SS = ScriptedScreens.ScriptableUi.ScriptedScreensScriptableUiSystem;

namespace VectorBuilder.Core
{
    public sealed record CaptureSurface(string name, int w, int h);
    public sealed record CaptureStructure(string key, string surface, string element, int order, float[] rect,
        JsonElement props, string[] problems, string[][] via);
    public sealed record CaptureData(string surface, string element, string scene, JsonElement values);
    public sealed record CaptureNative(string surface, string id, string type, int order, float[] rect,
        JsonElement style, JsonElement props, bool click, string[][] via);
    public sealed record CaptureClick(string surface, string element, string id);
    public sealed record CaptureReport(bool complete, string? error, string[] notes, CaptureSurface[] surfaces,
        CaptureStructure[] structures, CaptureData[] data, CaptureNative[] natives, CaptureClick[] clicks, int states, int untried, bool vb);

    [JsonSourceGenerationOptions(MaxDepth = int.MaxValue)]
    [JsonSerializable(typeof(CaptureReport))]
    internal sealed partial class CaptureContext : JsonSerializerContext { }

    public static class AdoptCapture
    {
        sealed record Path(string? Page, CaptureClick[] Clicks);

        public static async Task<string> RunJsonAsync(string lua, int width, int height, string host, int allowanceMs)
        {
            var notes = new List<string>();
            var surfaces = new Dictionary<string, CaptureSurface>(StringComparer.Ordinal);
            var structures = new Dictionary<string, CaptureStructure>(StringComparer.Ordinal);
            var data = new Dictionary<string, CaptureData>(StringComparer.Ordinal);
            var natives = new Dictionary<string, CaptureNative>(StringComparer.Ordinal);
            var clicks = new HashSet<CaptureClick>();
            var states = new HashSet<string>(StringComparer.Ordinal);
            var paths = new Queue<Path>();
            var timer = Stopwatch.StartNew();
            string? error = null;
            bool complete = true, builder = false, findingStates = false;
            CaptureReport Report() => new(complete, error, notes.ToArray(), surfaces.Values.ToArray(), structures.Values.ToArray(),
                data.Values.ToArray(), natives.Values.ToArray(), clicks.ToArray(), states.Count, paths.Count, builder);
            void Note(string message) { if (!notes.Contains(message)) notes.Add(message); }
            void Error(string message) { if (error == null) error = message; else if (error != message) Note(message); }
            try
            {
                var parsed = HostJson.Parse(host, out var diagnostic);
                if (diagnostic != null)
                {
                    if (parsed == HostJson.Empty) throw new ArgumentException(diagnostic);
                    Note(diagnostic);
                }
                if (width <= 0 || height <= 0) throw new ArgumentException("capture requires positive surface sizes");

                // Fresh stores and a deterministic clock on every replay; no access to the preview chip.
                double now = 0;
                ChipRunner NewChip()
                {
                    now = 0;
                    var c = new ChipRunner(500_000, 50_000, () => now, parsed);
                    c.Screens.Size = (width, height);
                    c.Screens.Beta = parsed.beta;
                    return c;
                }
                async Task Tick(ChipRunner c) { now += 0.5; await c.TickAsync(0.5); }

                (string[] Keys, CaptureClick[] Targets) Inspect(ChipRunner c, Path path)
                {
                    if (c.Error != null) Error(c.Error);
                    var keys = new List<string>();
                    var targets = new HashSet<CaptureClick>();
                    var via = path.Clicks.Select(x => new[] { x.surface, x.id }).ToArray();
                    foreach (var surface in c.Screens.SurfaceNames.ToArray())
                    {
                        var (w, h) = c.Screens.SizeOf(surface);
                        surfaces[surface] = new(surface, w, h);
                        var frame = Compositor.Compose(c, surface, 1, false);
                        foreach (var e in c.Screens.ElementsOf(surface))
                        {
                            var placed = frame.Elements.FirstOrDefault(x => x.Id == e.Id);
                            var (x, y, ew, eh) = Compositor.RectOf(e.Rect, w, h);
                            float[] rect = placed == null ? [x, y, ew, eh] : [placed.X, placed.Y, placed.W, placed.H];
                            if (!rect.All(float.IsFinite)) { Note($"{surface}/{e.Id}: its rect is not finite"); continue; }
                            if (string.Equals(e.Type, "vector", StringComparison.OrdinalIgnoreCase))
                            {
                                if (e.Props.ContainsKey("data"))
                                {
                                    var values = Pairs(VectorHost.ToValue(e.Props["data"]).Map ?? [], Note, surface + "/" + e.Id);
                                    var scene = e.Props.GetValueOrDefault("scene") as string ?? e.Id;
                                    var sample = new CaptureData(surface, e.Id, scene, values);
                                    data[Identity(surface, e.Id, scene, values.GetRawText())] = sample;
                                    keys.Add(Identity("data", surface, e.Id, scene));
                                }
                                if (!e.Props.ContainsKey("src") && !e.Props.ContainsKey("root")) continue;
                                var props = Pairs(e.UiProps, Note, surface + "/" + e.Id);
                                var shape = e.Props.TryGetValue("src", out var src) ? Text(src, Note, surface + "/" + e.Id).GetRawText()
                                    : Pairs(e.UiProps.Where(p => p.Key is not ("data" or "nodes" or "ease" or "snap" or "scene" or "visible" or "z_index")).ToArray(), Note, surface + "/" + e.Id).GetRawText();
                                var key = Identity(surface, e.Id, shape);
                                var live = c.Vectors.SceneOf(surface, e.Id);
                                var problems = live?.Scene.Problems.ToArray() ?? ["the scene could not be read"];
                                structures.TryAdd(key, new(key, surface, e.Id, e.Order, rect, props, problems, via));
                                keys.Add(key);
                                if (live != null && placed != null)
                                    foreach (var hit in live.Stats.Hits)
                                    {
                                        clicks.Add(new(surface, e.Id, hit.Id));
                                        // shortcut: xy clicks sample the centre only, use pointer replay for coordinate-dependent branches.
                                        if (hit.Xy) Note("coordinate clicks were sampled at the centre only");
                                        targets.Add(new(surface, e.Id, hit.Xy ? hit.Id + "@0.500,0.500" : hit.Id));
                                    }
                            }
                            else
                            {
                                var style = Text(e.Style ?? new(), Note, surface + "/" + e.Id + "/style");
                                var props = Text(e.Props, Note, surface + "/" + e.Id + "/props");
                                var clickable = e.Handlers.ContainsKey("click");
                                var key = Identity(surface, e.Id, e.Type, string.Join(",", rect.Select(n => n.ToString("R", CultureInfo.InvariantCulture))), style.GetRawText(), props.GetRawText(), clickable.ToString());
                                natives.TryAdd(key, new(surface, e.Id, e.Type, e.Order, rect, style, props, clickable, via));
                                keys.Add(key);
                                if (clickable && Compositor.Visible(e.Props))
                                {
                                    var target = new CaptureClick(surface, e.Id, "");
                                    targets.Add(target); clicks.Add(target);
                                }
                            }
                        }
                    }
                    return (keys.Order(StringComparer.Ordinal).ToArray(), targets.ToArray());
                }
                bool Queue(ChipRunner c, Path path)
                {
                    var snapshot = Inspect(c, path);
                    if (c.State == ChipState.Halted || !states.Add(Identity(snapshot.Keys))) return false;
                    foreach (var target in snapshot.Targets) paths.Enqueue(path with { Clicks = [.. path.Clicks, target] });
                    return true;
                }
                async Task Boot(ChipRunner c, Path path)
                {
                    await c.LoadAsync(lua);
                    Inspect(c, new(path.Page, []));
                    for (var i = 0; i < 2 && c.State != ChipState.Halted; i++)
                    { await Tick(c); Inspect(c, new(path.Page, [])); }
                    if (path.Page != null && c.State != ChipState.Halted)
                    {
                        c.Screens.QueueVisit(path.Page);
                        for (var i = 0; i < 2 && c.State != ChipState.Halted; i++)
                        { await Tick(c); Inspect(c, new(path.Page, [])); }
                    }
                }

                var start = new Path(null, []);
                var chip = NewChip();
                await Boot(chip, start);
                Queue(chip, start);
                if (chip.Lua.Environment["VB"].TryRead<LuaTable>(out var vb) && vb["LIB"].Type != LuaValueType.Nil)
                {
                    builder = true;
                    if (vb["cfg"].TryRead<LuaTable>(out var cfg) && cfg["pages"].TryRead<LuaTable>(out var pages))
                        foreach (var entry in pages)
                            if (entry.Value.TryRead<LuaTable>(out var page) && page["id"].TryRead<string>(out var id))
                            {
                                var path = new Path(id, []);
                                chip.Screens.QueueVisit(id);
                                for (var i = 0; i < 2 && chip.State != ChipState.Halted; i++)
                                { await Tick(chip); Inspect(chip, path); }
                                Queue(chip, path);
                            }
                }
                while (paths.Count > 0)
                {
                    if (timer.ElapsedMilliseconds >= allowanceMs)
                    {
                        complete = false;
                        Note("not every click was tried here");
                        if (findingStates) Note("the click crawl was still finding new states when the allowance was spent");
                        break;
                    }
                    var path = paths.Dequeue();
                    chip = NewChip();
                    await Boot(chip, path);
                    var prefix = new Path(path.Page, []);
                    foreach (var click in path.Clicks)
                    {
                        if (chip.State == ChipState.Halted) break;
                        chip.Screens.Enqueue(click.surface, click.element, "click", click.id);
                        await Tick(chip);
                        prefix = prefix with { Clicks = [.. prefix.Clicks, click] };
                        Inspect(chip, prefix);
                    }
                    findingStates = Queue(chip, path);
                }
            }
            catch (Exception e) { complete = false; Error(e is OutOfMemoryException ? "capture incomplete: runtime memory exhausted" : e.Message); }
            return JsonSerializer.Serialize(Report(), CaptureContext.Default.CaptureReport);
        }

        static string Identity(params string[] parts) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            string.Concat(parts.Select(p => p.Length + ":" + p))))).ToLowerInvariant();

        static JsonElement Pairs(SS.UiProp[] props, Action<string> note, string path) => Text(props, note, path);

        // UiValue tags are the existing props fixture wire format; raw native maps keep their ordinary JSON shape.
        static JsonElement Text(object? value, Action<string> note, string path)
        {
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { MaxDepth = int.MaxValue }))
            {
                var todo = new Stack<(object? Value, string? Name)>();
                var endMap = new object();
                var endList = new object();
                todo.Push((value, null));
                while (todo.TryPop(out var item))
                {
                    if (item.Name != null) writer.WritePropertyName(item.Name);
                    var v = item.Value;
                    if (ReferenceEquals(v, endMap)) { writer.WriteEndObject(); continue; }
                    if (ReferenceEquals(v, endList)) { writer.WriteEndArray(); continue; }
                    if (v is SS.UiValue ui)
                        v = ui.Type switch {
                            SS.UiValueType.Number => (object)ui.Number,
                            SS.UiValueType.String => ui.String,
                            SS.UiValueType.Bool => new Dictionary<string, object> { ["b"] = ui.Bool },
                            SS.UiValueType.Array => new Dictionary<string, object> { ["a"] = ui.Array!.Cast<object>().ToArray() },
                            SS.UiValueType.Map => new Dictionary<string, object> { ["m"] = ui.Map! },
                            _ => null
                        };
                    switch (v)
                    {
                        case SS.UiProp[] pairs:
                            writer.WriteStartArray(); todo.Push((endList, null));
                            foreach (var p in pairs.Reverse())
                                if (p.Key is "__proto__" or "constructor" or "prototype") note(path + ": dropped key " + p.Key);
                                else todo.Push((new object[] {p.Key, p.Value}, null));
                            break;
                        case null: writer.WriteNullValue(); break;
                        case string s: writer.WriteStringValue(s); break;
                        case bool b: writer.WriteBooleanValue(b); break;
                        case float f when float.IsFinite(f): writer.WriteNumberValue(f); break;
                        case double d when double.IsFinite(d): writer.WriteNumberValue(d); break;
                        case float or double: writer.WriteNullValue(); note(path + ": non-finite number replaced with null"); break;
                        case Dictionary<string, object> map:
                            writer.WriteStartObject(); todo.Push((endMap, null));
                            foreach (var p in map.Reverse())
                                if (p.Key is "__proto__" or "constructor" or "prototype") note(path + ": dropped key " + p.Key);
                                else todo.Push((p.Value, p.Key));
                            break;
                        case IEnumerable<object> list:
                            writer.WriteStartArray(); todo.Push((endList, null));
                            foreach (var x in list.Reverse()) todo.Push((x, null));
                            break;
                        default: writer.WriteNullValue(); note(path + ": unsupported captured value"); break;
                    }
                }
            }
            using var doc = JsonDocument.Parse(stream.ToArray(), new JsonDocumentOptions { MaxDepth = int.MaxValue });
            return doc.RootElement.Clone();
        }
    }
}
