using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using ScriptedScreensVector;
using VectorBuilder.Core;
using SS = ScriptedScreens.ScriptableUi.ScriptedScreensScriptableUiSystem;

/// <summary>
/// Goldens for the web's src parser: the mod's own <c>SceneText.ToProps</c> of every <c>web/test/srctext/accept/*.src</c>,
/// as the <c>Pairs</c> JSON of <c>web/src/srctext/props.ts</c>. The mod reads the whole reject corpus too, each case in well
/// under its time limit; only its brace and comma cases are held to a verdict, which the mod refuses since 0.11.97.
/// Then the examples round trip: every structure element of vector examples 01-19 as the host holds it, and the oracle
/// that proves the web's printed src (<c>web/test/fixtures/examples/*.src</c>) draws what the example draws.
/// </summary>
static class FixtureTests
{
    static readonly JsonSerializerOptions Relaxed = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static void Run(Action<bool, string> check)
    {
        var srcs = Directory.GetFiles(Path.Combine(Fixtures.Root, "srctext", "accept"), "*.src").OrderBy(f => f, StringComparer.Ordinal).ToArray();
        check(srcs.Length > 0, "src accept corpus found");
        foreach (var src in srcs)
        {
            var name = Path.GetFileNameWithoutExtension(src);
            var props = SceneText.ToProps(File.ReadAllText(src), null);
            if (props == null)
            {
                check(false, $"src golden {name}: the mod rejects it ({SceneText.Rejected})");
                continue;
            }
            var json = "[\n" + string.Join(",\n", props.Select(p => Pair(p, ""))) + "\n]\n";
            var golden = Path.ChangeExtension(src, ".props.json");
            if (Fixtures.Write)
                File.WriteAllText(golden, json);
            check(File.Exists(golden) && File.ReadAllText(golden) == json, $"src golden {name} matches the mod's ToProps");
        }

        // The web's parser refuses every reject case (parse.test.ts). The mod reads each one and returns, refusing it or
        // accepting it (some it mis-reads: the web refuses those for that), so a case that hangs it fails here instead of
        // stalling the suite. Since 0.11.97 it refuses a block never closed, at the line that opened it, and a } that closes
        // nothing (it took the first whole and ended the scene at the second, in silence), and names the character an op
        // cannot start with: the web's parser refuses each of these at the same line.
        var reject = Path.Combine(Fixtures.Root, "srctext", "reject");
        var rejects = Directory.GetFiles(reject, "*.src").OrderBy(f => f, StringComparer.Ordinal).ToArray();
        var verdicts = new Dictionary<string, string?>();
        foreach (var src in rejects)
        {
            var text = File.ReadAllText(src);
            var read = Task.Run(() => SceneText.ToProps(text, null) == null ? SceneText.Rejected ?? "(no reason)" : null);
            if (read.Wait(TimeSpan.FromSeconds(5)))
            {
                verdicts[Path.GetFileNameWithoutExtension(src)] = read.Result;
                continue;
            }
            // A case that hangs keeps its thread running, and that thread shares SceneText's statics (Rejected, the unescape
            // scratch) with every later case and check, so none of their verdicts could be trusted: the run ends here.
            check(false, $"src reject: the mod reads each of the {rejects.Length} cases within 5 s ({Path.GetFileNameWithoutExtension(src)} hangs)");
            Console.WriteLine("stopped: a hung reject case would race every later check");
            Environment.Exit(1);
        }
        check(rejects.Length >= 30, $"src reject: the mod reads each of the {rejects.Length} cases within 5 s");
        foreach (var (name, says) in new[] { ("missing-close", "never closed"), ("dollar-brace", "never closed"), ("text-brace", "never closed"),
                     ("unmatched-close", "never opened"), ("op-comma", "found `,`"), ("text-comma", "found `,`") })
        {
            var line = JsonDocument.Parse(File.ReadAllText(Path.Combine(reject, name + ".expect.json"))).RootElement.GetProperty("line").GetInt32();
            var refused = verdicts.GetValueOrDefault(name);
            check(refused != null && refused.Contains(says) && refused.Contains($", line {line}:"),
                  $"src reject {name}: the mod refuses it at line {line}, as the web's parser does ({refused ?? "accepted"})");
        }

        var examples = Path.Combine(Fixtures.Root, "fixtures", "examples");
        Capture(check, examples);
        Oracle(check, examples);
        Codegen(check);
        Duct(check);
        NestedWidgets(check);
        Gauge(check);
        RepeaterNames(check);
    }

    static void RepeaterNames(Action<bool, string> check)
    {
        var file = Path.Combine(Fixtures.Root, "fixtures", "codegen", "widgets.lua");
        var lua = File.ReadAllText(file);
        var src = Regex.Match(lua, @"src = \[(==+)\[\n(.*?)\]\1\]", RegexOptions.Singleline).Groups[2].Value;
        var baseData = "rep1_n = 1, rep1_name = { 'Row name' }, rep1_v = { '42' }, rep1_st = { 1 }";
        FrameText Name(string extra) => FrameTests.Draw(FrameTests.Src(src), 480, 480, data: "{ " + baseData + extra + " }").Text.Single(t => t.Text == "Row name");
        check(Math.Abs(Name(", rep1_ready = 1, rep1_hasv = { 0 }").W - 384) < 1e-4, "repeater layout: an absent value gives the name the full width to the right padding");
        check(Math.Abs(Name(", rep1_ready = 1, rep1_hasv = { 1 }").W - 244) < 1e-4, "repeater layout: a present value keeps the original name width");
        check(Math.Abs(Name("").W - 244) < 1e-4, "repeater layout: unsent flags keep the original width");
        var noValue = FrameTests.Draw(FrameTests.Src(src), 480, 480, data: "{ " + baseData + ", rep1_ready = 1, rep1_hasv = { 0 } }");
        check(!noValue.Text.Any(t => t.Text == "42"), "repeater layout: a full-width name never overlaps the value label");
    }

    static void NestedWidgets(Action<bool, string> check)
    {
        var file = Path.Combine(Fixtures.Root, "fixtures", "codegen", "nested-widgets.lua");
        check(File.Exists(file), "nested widgets: generated fixture exists");
        if (!File.Exists(file)) return;
        var lua = File.ReadAllText(file);
        var src = Regex.Match(lua, @"src = \[(==+)\[\n(.*?)\]\1\]", RegexOptions.Singleline).Groups[2].Value;
        var frame = FrameTests.Draw(FrameTests.Src(src), 460, 460, data: "{ btn1_dis = 0 }", tag: true);
        var span = frame.Spans.Single(s => s.Node == 4);
        var shape = frame.Elements.SelectMany(e => e.Shapes ?? []).Single(s => s.First == span.First && s.X1 > s.X0 && s.Y1 > s.Y0);
        var angle = Math.PI / 6;
        var corners = new[] { (20d, 30d), (100d, 30d), (100d, 84d), (20d, 84d) }
            .Select(p => (X: 100 + Math.Cos(angle) * p.Item1 - Math.Sin(angle) * p.Item2,
                          Y: 50 + Math.Sin(angle) * p.Item1 + Math.Cos(angle) * p.Item2)).ToArray();
        var expected = new[] { corners.Min(p => p.X), corners.Min(p => p.Y), corners.Max(p => p.X), corners.Max(p => p.Y) };
        var actual = new[] { shape.X0, shape.Y0, shape.X1, shape.Y1 };
        Console.WriteLine($"MEASURE nested widget bounds: {string.Join(", ", actual)}; params: {string.Join(", ", expected)}");
        check(frame.Problems.Length == 0 && actual.Zip(expected).All(p => Math.Abs(p.First - p.Second) < 0.01),
              "nested widgets: composed bounds match the params box through G t=[100,50] r=30");
    }

    static void Gauge(Action<bool, string> check)
    {
        var fullFile = Path.Combine(Fixtures.Root, "fixtures", "widgets", "gauge-full.src");
        check(File.Exists(fullFile), "gauge-full: full-turn fixture exists");
        if (File.Exists(fullFile))
        {
            var src = File.ReadAllText(fullFile);
            var frame = FrameTests.Draw(FrameTests.Src(src), 480, 480, data: "{ gauge1_v = 50 }", tag: true);
            var span = frame.Spans.SingleOrDefault(s => s.Node == 1);
            var vertices = Enumerable.Range(span.First, span.Count).Where(i => frame.Coverage[i] > 0.99f && frame.Colours[4*i+3] > 250).ToArray();
            const float cx = 174, cy = 157.2f, radius = 132.2f;
            var actual = vertices.Length == 0 ? new float[0] : new[] {
                vertices.Min(i => frame.Positions[2*i]), vertices.Min(i => frame.Positions[2*i+1]),
                vertices.Max(i => frame.Positions[2*i]), vertices.Max(i => frame.Positions[2*i+1]) };
            var expected = new[] { cx-radius, cy-radius, cx+radius, cy+radius };
            Console.WriteLine($"MEASURE gauge-full track bounds: {string.Join(", ", actual)}; dial: {string.Join(", ", expected)}");
            var path = Regex.Match(src, @"P d=""([^""]+)""").Groups[1].Value;
            check(Regex.Matches(path, "A").Count == 4 && path.EndsWith("Z") && frame.Problems.Length == 0 && actual.Length == 4 && actual.Zip(expected).All(p => Math.Abs(p.First-p.Second) <= 1),
                  "gauge-full: track span equals the dial square within one unit");
        }
        foreach (var name in new[] { "gauge", "gauge-default" })
        {
            var file = Path.Combine(Fixtures.Root, "fixtures", "widgets", name + ".src");
            check(File.Exists(file), $"{name}: direction fixture exists");
            if (!File.Exists(file)) continue;
            var src = File.ReadAllText(file);
            foreach (var value in new[] { 0, 50, 100 })
            {
                var frame = FrameTests.Draw(FrameTests.Src(src), 480, 480, data: $"{{ gauge1_v = {value} }}", tag: true);
                check(frame.Problems.Length == 0, $"{name}: v={value} draws without problems");
                var span = frame.Spans.Single(s => s.Node == 3);
                var vertices = Enumerable.Range(span.First, span.Count).Where(i => frame.Coverage[i] > 0.99f).ToArray();
                var x0 = vertices.Min(i => frame.Positions[2*i]);
                var x1 = vertices.Max(i => frame.Positions[2*i]);
                var y0 = vertices.Min(i => frame.Positions[2*i+1]);
                var y1 = vertices.Max(i => frame.Positions[2*i+1]);
                Console.WriteLine($"MEASURE {name} v={value}: needle bounds ({x0},{y0})-({x1},{y1})");
                const float cx = 174, cy = 157.2f;
                var side = value == 0 ? x0 < cx - 40 && x1 < cx + 3
                         : value == 100 ? x1 > cx + 40 && x0 > cx - 3
                         : Math.Abs((x0+x1)/2-cx) < 1e-3f && x1-x0 < 8;
                var up = value == 50 || name == "gauge";
                check(side && (up ? y0 < cy - 40 && y1 < cy + 3 : y1 > cy + 40 && y0 > cy - 3),
                      $"{name}: v={value} needle points {(value == 50 ? "straight up" : (up ? "upper" : "lower") + (value == 0 ? " left" : " right"))}");
            }
        }
    }

    static void Duct(Action<bool, string> check)
    {
        var golden = File.ReadAllText(Path.Combine(Fixtures.Root, "fixtures", "widgets", "vanilla-plus.txt")).Replace("\r\n", "\n");
        var src = golden.Split("duct {}\n")[1].Split("\n\n")[0];
        float Edge(SurfaceFrame frame)
        {
            var span = frame.Spans.Single(s => s.Node == 2);
            return Enumerable.Range(span.First, span.Count).Where(i => frame.Coverage[i] > 0.99f)
                .Min(i => frame.Positions[2 * i]);
        }
        var start = FrameTests.Draw(FrameTests.Src(src), 480, 480, t: 0, data: "{ duct1_run = 1 }", tag: true);
        var later = FrameTests.Draw(FrameTests.Src(src), 480, 480, t: 0.25, data: "{ duct1_run = 1 }", tag: true);
        var x0 = Edge(start);
        var x1 = Edge(later);
        Console.WriteLine($"MEASURE duct: first dash left edge {x0} -> {x1}, delta {x1 - x0} at t=0.25, speed=20");
        check(start.Problems.Length == 0 && later.Problems.Length == 0 && Math.Abs(x0 - 24) < 1e-3f && Math.Abs(x1 - 29) < 1e-3f,
              "duct: first dash moves +5 units for positive speed 20 at t=0.25");
    }

    /// <summary>
    /// Every codegen fixture (web/test/fixtures/codegen/*.lua with its .host.json, written by generate.test.ts and widgets.test.ts):
    /// the host JSON hostOf wrote parses here; the script loads and runs 20 ticks with every page (the Devices page too) visited
    /// once; each visit builds the page in that tick, which then draws with no problem, every plate its src declares a hit region,
    /// the banner in its src. The natives a fixture declares are there. Load and worst-tick instructions are printed (M3 report).
    /// </summary>
    static void Codegen(Action<bool, string> check)
    {
        var dir = Path.Combine(Fixtures.Root, "fixtures", "codegen");
        var files = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.lua").OrderBy(f => f, StringComparer.Ordinal).ToArray() : [];
        check(files.Length >= 8, $"codegen fixtures found ({files.Length}; run npm test)");
        foreach (var file in files)
        {
            var name = Path.GetFileNameWithoutExtension(file);
            var host = HostJson.Parse(File.ReadAllText(Path.ChangeExtension(file, ".host.json")), out var hostError);
            check(hostError == null, $"codegen {name}: the host JSON hostOf wrote parses in the core {hostError}".TrimEnd());
            var lua = File.ReadAllText(file);
            if (name is "dashboard" or "multipage") StaticDeliveries(check, name, lua, host);
            var chip = new ChipRunner(host: host);
            chip.Screens.Size = (460, 460);
            chip.LoadAsync(lua).Wait();
            var load = chip.LastInstructions;
            check(chip.State == ChipState.Running, $"codegen {name}: loads {chip.Error}".TrimEnd());
            chip.LoadAsync("for _, p in ipairs(VB.cfg.pages) do print('PAGE ' .. p.id .. ' ' .. p.surface .. ' ' .. tostring(p.empty)) end "
                           + "if VB.cfg.devices then print('PAGE ' .. VB.cfg.devices.id .. ' ' .. VB.cfg.devices.surface .. ' false') end").Wait();
            var pages = chip.Output.Where(l => l.StartsWith("PAGE ")).Select(l => l.Split(' ')).Select(a => (Id: a[1], Surface: a[2], Empty: a[3] == "true")).ToList();
            var srcs = Regex.Matches(lua, @"src = \[(==+)\[\n(.*?)\]\1\]", RegexOptions.Singleline).Select(m => m.Groups[2].Value).ToArray();
            check(pages.Count > 0 && srcs.Length == pages.Count, $"codegen {name}: one src per page ({pages.Count} pages, {srcs.Length} srcs)");
            long worst = 0;
            var ticks = 0;
            for (var k = 0; k < pages.Count; k++, ticks++)
            {
                var (id, surface, empty) = pages[k];
                chip.Screens.QueueVisit(id);
                chip.TickAsync().Wait();
                worst = Math.Max(worst, chip.LastInstructions);
                check(chip.State == ChipState.Running && chip.Screens.ActiveSurface == surface, $"codegen {name}: visiting {id} builds and shows {surface} {chip.Error}".TrimEnd());
                if (empty || k >= srcs.Length)
                    continue;
                var frame = Compositor.Compose(chip, surface, 1f, false);
                check(frame.Problems.Length == 0, $"codegen {name} {id}: draws with no problem{string.Concat(frame.Problems.Select(p => ": " + p.Message))}");
                var controls = new VecScene();
                foreach (var e in chip.Screens.ElementsOf(surface).Where(e => e.Props.ContainsKey("data") || e.Props.ContainsKey("nodes")))
                    SceneParser.PatchNodes(e.UiProps, controls);
                check(!controls.Problems.Any(p => p.Contains("read as a plain number") || p.Contains("must be a map")),
                      $"codegen {name} {id}: literal DATA controls and map node patches");
                if (name == "widgets" && id == "p1")
                {
                    var centre = FrameTests.Sample(frame, 390.25f * 460 / 480, 390.25f * 460 / 480);
                    check(Math.Abs(centre.R - 0x12) < 0.05 && centre.A > 0.99, "codegen widgets: cog centre leaves the contrasting rectangle visible");
                }
                if (name == "page-fonts")
                {
                    var shared = "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700";
                    string[] expected = id == "p1"
                        ? [shared, "https://fonts.gstatic.com/direct.ttf", "https://blocked.example/font.otf"]
                        : id == "p2" ? [shared, "https://fonts.googleapis.com/css2?family=Roboto:wght@100..900", "https://fonts.gstatic.com/quoted\"\\link\nnext.woff2"] : [];
                    check((chip.Vectors.SceneOf(surface, "scene")?.Scene.FontLinks ?? []).SequenceEqual(expected),
                          $"codegen {name} {id}: exact ordered FONT links survive lazy Lua page creation");
                    if (expected.Length > 0)
                    {
                        chip.Vectors.HotSwap(surface, "scene", srcs[k] + "# source patch\n");
                        check((chip.Vectors.SceneOf(surface, "scene")?.Scene.FontLinks ?? []).SequenceEqual(expected),
                              $"codegen {name} {id}: source patch preserves FONT links");
                    }
                }
                var hits = chip.Vectors.SceneOf(surface, "scene")?.Stats.Hits.Select(h => Regex.Replace(h.Id, @":\d+$", "")).ToHashSet() ?? [];
                var plates = Regex.Matches(srcs[k], @"\bR id=(\w+) (?:click|press)=1").Select(m => m.Groups[1].Value).ToArray();
                check(plates.All(hits.Contains), $"codegen {name} {id}: every plate is a hit region (missing: {string.Join(", ", plates.Where(p => !hits.Contains(p)))})");
                check(srcs[k].Contains("G v==lt(ver,"), $"codegen {name} {id}: the old-mod banner is in the page's src");
            }
            for (; ticks < 20; ticks++)
            {
                chip.TickAsync().Wait();
                worst = Math.Max(worst, chip.LastInstructions);
            }
            check(chip.State == ChipState.Running, $"codegen {name}: runs 20 ticks with every page visited {chip.Error}".TrimEnd());
            check(chip.Screens.LostWrites.Count == 0, $"codegen {name}: no write lost to the flush rule at load or in any tick ({string.Join("; ", chip.Screens.LostWrites.Take(5))})");
            if (lua.Contains("type = \"icon\""))
            {
                var types = chip.Screens.SurfaceNames.SelectMany(s => chip.Screens.ElementsOf(s)).Select(e => e.Type).ToHashSet();
                check(types.Contains("icon") && types.Contains("textinput"), $"codegen {name}: the natives are declared");
            }
            if (name == "custom")
            {
                chip.LoadAsync("local o = {} VB.cfg.pages[1].data(o) print('EXPORTS ' .. tostring(o.export0) .. ' ' .. tostring(o.export1) .. ' ' .. tostring(o.export2) .. ' ' .. tostring(o.export3) .. ' ' .. tostring(o.export4))").Wait();
                check(chip.State == ChipState.Running && chip.Output.Contains("EXPORTS entry0 entry1 entry2 entry3 entry4"),
                      $"codegen custom: free-text export names load, tick and read their exact X entries {chip.Error}".TrimEnd());
            }
            if (name == "control")
            {
                chip.Screens.QueueVisit("p1");
                chip.TickAsync().Wait();
                chip.Stationeers.TakeWrites();
                chip.Screens.Enqueue("main", "scene", "click", "tg1_hit");
                chip.TickAsync().Wait();
                var writes = chip.Stationeers.TakeWrites();
                chip.LoadAsync("print('CONTROL ' .. tostring(S.tg1_on))").Wait();
                check(chip.State == ChipState.Running && chip.Output.Last() == "CONTROL true",
                      "codegen control: a click on the wired Toggle plate runs its generated action");
                var pump = host.devices!.Single(d => d.prefab == -321403609).@ref;
                check(writes.Any(w => w.@ref == pump && w.lt == host.enums!["LogicType"]["On"] && w.value == 1 && w.stored),
                      "codegen control: the generated rule writes the Toggle state to its pump");
            }
            Console.WriteLine($"MEASURE codegen {name}: load {load} instructions, worst tick {worst}");
        }

        // The position a chip error carries, which the builder's line map reads (web/src/codegen/linemap.ts).
        var bad = new ChipRunner();
        bad.LoadAsync("local x = nil\nlocal y = x + 1").Wait();
        Console.WriteLine($"MEASURE Lua error text: {bad.Error}");
        check(bad.Error != null && Regex.IsMatch(bad.Error, @"\[string ""chip""\]:2:"), $"a Lua error names its line as [string \"chip\"]:<line>:, which mapError reads ({bad.Error})");
    }

    static void StaticDeliveries(Action<bool, string> check, string name, string lua, HostJson host)
    {
        foreach (var mode in new[] { "fixture", "constant", "noise", "history" })
        {
            var measured = mode is "constant" or "noise" ? host with { devices = host.devices?.Select(d => d with {
                values = d.values?.ToDictionary(p => p.Key, p => mode == "constant" ? new SourceJson("const", 500)
                    : new SourceJson("sine", mid: 500, amp: 0.2, period: 20)) }).ToArray() } : host;
            var chip = new ChipRunner(host: measured);
            chip.Screens.Size = (460, 460);
            var script = mode == "history" ? lua.Replace("-- <<< vectorbuilder custom", """
                function U.before_render(P, S, data)
                  data.history = H.press
                  data.counter = VB.n
                  data.text = tostring(VB.n)
                end
                -- <<< vectorbuilder custom
                """) : lua;
            chip.LoadAsync(script).Wait();
            foreach (var page in new[] { "p1", "vb_devices" })
            {
                chip.Screens.QueueVisit(page);
                chip.TickAsync().Wait();
                var surface = chip.Screens.ActiveSurface;
                var before = chip.Screens.ElementsOf(surface).Sum(e => e.Upserts);
                var deliveries = new List<int>();
                var ease = chip.Screens.ElementsOf(surface).Single(e => e.Id == "ease");
                var easedBefore = ease.Upserts;
                var eased = new List<int>();
                for (var tick = 0; tick < 40; tick++)
                {
                    chip.TickAsync().Wait();
                    var after = chip.Screens.ElementsOf(surface).Sum(e => e.Upserts);
                    deliveries.Add(after - before);
                    before = after;
                    eased.Add(ease.Upserts - easedBefore);
                    easedBefore = ease.Upserts;
                }
                Console.WriteLine($"DELIVERIES {name} {page} {mode}: total {deliveries.Sum()}, eased {eased.Sum()} over 40 ticks, eased {eased.Min()}..{eased.Max()} per tick");
                check(chip.State == ChipState.Running && (mode != "constant" || deliveries.All(n => n == 0)),
                      $"codegen {name} {page}: {mode} measurement runs; constant input sends nothing {chip.Error}".TrimEnd());
                if (mode is "constant" or "noise" || page == "vb_devices" || name == "multipage")
                    check(eased.All(n => n == 0), $"codegen {name} {page}: {mode} sends no subpixel noise or nonmoving data through ease");
                if (mode == "history")
                    check(((Dictionary<string, object>?)ease.Props.GetValueOrDefault("data"))?.Keys
                          .Any(k => k is "history" or "counter" or "text") != true,
                          $"codegen {name} {page}: histories, counters and text never share a moving-geometry payload");
            }
        }
    }

    /// <summary>
    /// Each example loaded at 460x460 on a fake clock and ticked twice, 0.5 s apart. For every vector structure element:
    /// <c>NN-name.id.props.json</c>, its props as the host reads them, and <c>NN-name.id.nodes.json</c>, the parsed
    /// scene's nodes in pre-order (USE expanded) as VecOp names. Rewritten by --write-fixtures, otherwise compared.
    /// </summary>
    static void Capture(Action<bool, string> check, string dir)
    {
        var examples = Directory.GetFiles(Path.Combine(Fixtures.Root, "..", "..", "core", "vendor", "vector", "examples"), "??-*.lua")
            .OrderBy(f => f, StringComparer.Ordinal).ToArray();
        check(examples.Length == 19, $"vector examples 01-19 found ({examples.Length})");
        if (Fixtures.Write)
            Directory.CreateDirectory(dir);

        void Golden(string file, string text)
        {
            var path = Path.Combine(dir, file);
            if (Fixtures.Write)
                File.WriteAllText(path, text);
            check(File.Exists(path) && File.ReadAllText(path) == text, $"example fixture {file} matches the host");
        }

        var captured = 0;
        var problems = new List<string>();
        foreach (var lua in examples)
        {
            var name = Path.GetFileNameWithoutExtension(lua);
            double now = 0;
            var chip = new ChipRunner(clock: () => now);
            chip.Screens.Size = (460, 460);
            chip.LoadAsync(File.ReadAllText(lua)).Wait();
            for (var k = 0; k < 2; k++)
            {
                now += 0.5;
                chip.TickAsync(0.5).Wait();
            }
            check(chip.State == ChipState.Running, $"example {name} runs {chip.Error}".TrimEnd());

            foreach (var surface in chip.Screens.SurfaceNames.ToList())
                foreach (var e in chip.Screens.ElementsOf(surface))
                {
                    if (chip.Vectors.SceneOf(surface, e.Id) is not { } live)
                        continue;
                    Golden($"{name}.{e.Id}.props.json", "[\n" + string.Join(",\n", e.UiProps.Select(p => Pair(p, ""))) + "\n]\n");
                    Golden($"{name}.{e.Id}.nodes.json", "[\n" + string.Join(",\n", PreOrder(live.Scene.Root).Select(n => $"\"{n.Op}\"")) + "\n]\n");
                    problems.AddRange(live.Scene.Problems.Select(p => $"{name}.{e.Id}: {p}"));
                    if (name == "19-webfonts")
                    {
                        check(live.Scene.FontLinks.SequenceEqual(new[] { "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700" }),
                            "webfonts declares the exact Orbitron link without a headless font request");
                        check(PreOrder(live.Scene.Root).Where(n => n.Op == VecOp.Text).Select(n => n.FontFamily).SequenceEqual(new[] { "Orbitron Bold", "Orbitron", "Orbitron", null, null }),
                            "webfonts preserves the declared face names and fallback labels");
                    }
                    captured++;
                }
        }
        check(captured == 21 && Directory.Exists(dir) && Directory.GetFiles(dir, "*.props.json").Length == captured, $"no stale example fixtures: {captured} structure elements");
        // 0.11.96 and 0.11.97 report faults they used to drop in silence (0.11.97: an unreadable fmt); no example has one,
        // so none draws differently.
        check(problems.Count == 0, $"no example's scene reports a problem {string.Join("; ", problems)}".TrimEnd());
    }

    static IEnumerable<VecNode> PreOrder(List<VecNode> nodes) => nodes.SelectMany(n => PreOrder(n.Children).Prepend(n));

    /// <summary>
    /// For each props fixture and its printed src snapshot, two scenes on fresh chips (one scene id each, so neither is
    /// deactivated): one from the table props, one from <c>{ src = snapshot }</c>, no data. Both are composed at 460x460,
    /// scale 1, at t = 0 and t = 1.37, and must draw the same.
    /// </summary>
    static void Oracle(Action<bool, string> check, string dir)
    {
        var fixtures = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.props.json").OrderBy(f => f, StringComparer.Ordinal).ToArray() : [];
        var compared = 0;
        foreach (var file in fixtures)
        {
            var stem = Path.GetFileName(file)[..^".props.json".Length];
            var id = stem[(stem.IndexOf('.') + 1)..];
            var snapshot = Path.Combine(dir, stem + ".src");
            if (!File.Exists(snapshot))
            {
                check(false, $"oracle {stem}: no printed src snapshot (run npm test)");
                continue;
            }
            var props = Map(JsonDocument.Parse(File.ReadAllText(file)).RootElement);
            // Src-authored examples must also exercise real table props, including their definitions.
            if (props.TryGetValue("src", out var source) && source is string src)
            {
                using var parsed = JsonDocument.Parse("[" + string.Join(",", SceneText.ToProps(src, id)!.Select(p => Pair(p, ""))) + "]");
                props = Map(parsed.RootElement);
            }
            var table = Draw(id, props, out var tableLinks);
            var text = Draw(id, new() { ["src"] = File.ReadAllText(snapshot) }, out var textLinks);
            check(tableLinks.SequenceEqual(textLinks), $"oracle {stem}: the printed src preserves FontLinks in order");
            foreach (var t in new[] { 0.0, 1.37 })
            {
                var (a, b) = (table(t), text(t));
                if (t == 0 && a.Indices.Length > 0 && b.Indices.Length > 0)
                    compared += Math.Min(a.Elements.Length, b.Elements.Length);
                var why = Diff(a, b);
                check(why == null, $"oracle {stem} at t={t.ToString(CultureInfo.InvariantCulture)}: the printed src draws what the example draws{(why == null ? "" : ": " + why)}");
            }
        }
        check(fixtures.Length > 0 && compared >= fixtures.Length, $"oracle compared {compared} elements for {fixtures.Length} props fixtures");
    }

    static Func<double, SurfaceFrame> Draw(string id, Dictionary<string, object> props, out IReadOnlyList<string> fontLinks)
    {
        double now = 0;
        var chip = new ChipRunner(clock: () => now);
        chip.Screens.Size = (460, 460);
        chip.Screens.Declare("main", id, "vector", new() { ["unit"] = "px", ["x"] = 0d, ["y"] = 0d, ["w"] = 460d, ["h"] = 460d }, props);
        chip.Screens.Flush();
        fontLinks = chip.Vectors.SceneOf("main", id)!.Scene.FontLinks;
        return t =>
        {
            now = t;
            return Compositor.Compose(chip, "main", 1f, false);
        };
    }

    static string? Diff(SurfaceFrame a, SurfaceFrame b)
    {
        if (a.Indices.Length == 0 || b.Indices.Length == 0)
            return $"no triangles ({a.Indices.Length} vs {b.Indices.Length} indices)";
        if (!a.Indices.SequenceEqual(b.Indices))
            return $"indices differ ({a.Indices.Length} vs {b.Indices.Length})";
        if (!a.Positions.All(float.IsFinite) || !b.Positions.All(float.IsFinite))
            return "a non-finite position";
        if (Floats(a.Positions, b.Positions) is { } position)
            return "positions " + position;
        if (!a.Colours.SequenceEqual(b.Colours))
            return "colours differ";
        if (Floats(a.Coverage, b.Coverage) is { } coverage)
            return "coverage " + coverage;
        var (pa, pb) = (a.Problems.Select(p => p.Message).ToHashSet(), b.Problems.Select(p => p.Message).ToHashSet());
        if (!pa.SetEquals(pb))
            return $"problems [{string.Join(" | ", pa.Except(pb))}] vs [{string.Join(" | ", pb.Except(pa))}]";
        if (a.Text.Length != b.Text.Length)
            return $"{a.Text.Length} vs {b.Text.Length} text placements";
        // Every FrameText field: floats within 1e-3, float arrays element-wise, everything else exact.
        for (var i = 0; i < a.Text.Length; i++)
            foreach (var field in typeof(FrameText).GetProperties())
            {
                var (x, y) = (field.GetValue(a.Text[i]), field.GetValue(b.Text[i]));
                var why = (x, y) switch
                {
                    (float f, float g) => Math.Abs(f - g) <= 1e-3f ? null : $"{f} vs {g}",
                    (float[] f, float[] g) => Floats(f, g),
                    (null, null) => null,
                    (float[], null) or (null, float[]) => "set vs unset",
                    _ => Equals(x, y) ? null : $"{x} vs {y}",
                };
                if (why != null)
                    return $"text {i} (\"{a.Text[i].Text}\") {field.Name}: {why}";
            }
        return null;
    }

    // Element-wise within 1e-3; NaN never matches.
    static string? Floats(float[] a, float[] b)
    {
        if (a.Length != b.Length)
            return $"{a.Length} vs {b.Length} values";
        for (var i = 0; i < a.Length; i++)
            if (!(Math.Abs(a[i] - b[i]) <= 1e-3f))
                return $"[{i}]: {a[i]} vs {b[i]}";
        return null;
    }

    // A props fixture back as the .NET values a Lua table converts to: Pairs JSON -> Dictionary, list, double, string, bool.
    static Dictionary<string, object> Map(JsonElement pairs) => pairs.EnumerateArray().ToDictionary(p => p[0].GetString()!, p => Net(p[1]));

    static object Net(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.Number => v.GetDouble(),
        JsonValueKind.String => v.GetString()!,
        _ when v.TryGetProperty("a", out var a) => a.EnumerateArray().Select(Net).ToList(),
        _ when v.TryGetProperty("m", out var m) => Map(m),
        _ => v.GetProperty("b").GetBoolean(),
    };

    static string Pair(SS.UiProp p, string indent) => "[" + JsonSerializer.Serialize(p.Key, Relaxed) + "," + Value(p.Value, indent) + "]";

    // A list of node maps puts each node on its own line, so a golden diffs node by node.
    static string Value(SS.UiValue v, string indent) => v.Type switch
    {
        SS.UiValueType.Number => v.Number.ToString("R", CultureInfo.InvariantCulture),
        SS.UiValueType.String => JsonSerializer.Serialize(v.String, Relaxed),
        SS.UiValueType.Bool => v.Bool ? "{\"b\":true}" : "{\"b\":false}",
        SS.UiValueType.Map => "{\"m\":[" + string.Join(",", v.Map!.Select(p => Pair(p, indent))) + "]}",
        SS.UiValueType.Array when v.Array!.Length > 0 && v.Array.All(x => x.Type == SS.UiValueType.Map) =>
            "{\"a\":[\n" + string.Join(",\n", v.Array.Select(x => indent + "  " + Value(x, indent + "  "))) + "\n" + indent + "]}",
        SS.UiValueType.Array => "{\"a\":[" + string.Join(",", v.Array!.Select(x => Value(x, indent))) + "]}",
        _ => throw new InvalidOperationException($"ToProps produced a {v.Type}"),
    };
}
