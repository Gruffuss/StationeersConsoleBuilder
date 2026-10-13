using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using ScriptedScreensVector;
using UnityEngine;
using VectorBuilder.Core;

Fixtures.Write = args.Contains("--write-fixtures");
var failures = new List<string>();
void Check(bool ok, string name) { if (!ok) failures.Add(name); Console.WriteLine((ok ? "PASS " : "FAIL ") + name); }

Check(ManagedColour.TryParse("#5FD9A8", out var c1) && Math.Abs(c1.g - 0xD9 / 255f) < 1e-6 && c1.a == 1f, "colour #RRGGBB");
Check(ManagedColour.TryParse("#5FD9A800", out var c2) && c2.a == 0f, "colour #RRGGBBAA");
Check(ManagedColour.TryParse("#f00", out var c3) && c3.r == 1f && c3.g == 0f, "colour #RGB");
Check(ManagedColour.TryParse("#f008", out var c4) && Math.Abs(c4.a - 0x88 / 255f) < 1e-6, "colour #RGBA");
Check(ManagedColour.TryParse("DarkBlue", out var c5) && c5.b == 139 / 255f && c5.r == 0f, "colour name, any case (the game's darkblue is #00008B)");
Check(ManagedColour.TryParse("Transparent", out var c7) && c7.a == 0f, "transparent is a Unity name, alpha 0");
Check(!ManagedColour.TryParse("rgba(1,2,3,0.5)", out _) && !ManagedColour.TryParse("gray", out _), "rgba() and non-Unity names are text, not colours");
Check(!ManagedColour.TryParse("#12345", out _) && !ManagedColour.TryParse("#12345 ", out _) && !ManagedColour.TryParse("#gg0000", out _)
      && !ManagedColour.TryParse("ff0000", out _) && !ManagedColour.TryParse("", out _) && !ManagedColour.TryParse(null!, out _), "malformed colours are rejected");

// the game's UnityPlayer.dll holds exactly one colour-name table: these 23 names, in this order, with these RGBA values
foreach (var (name, rgba) in new[] {
    ("red", "FF0000FF"), ("cyan", "00FFFFFF"), ("blue", "0000FFFF"), ("darkblue", "00008BFF"), ("lightblue", "ADD8E6FF"),
    ("purple", "800080FF"), ("yellow", "FFFF00FF"), ("lime", "00FF00FF"), ("fuchsia", "FF00FFFF"), ("white", "FFFFFFFF"),
    ("silver", "C0C0C0FF"), ("grey", "808080FF"), ("black", "000000FF"), ("orange", "FFA500FF"), ("brown", "A52A2AFF"),
    ("maroon", "800000FF"), ("green", "008000FF"), ("olive", "808000FF"), ("navy", "000080FF"), ("teal", "008080FF"),
    ("aqua", "00FFFFFF"), ("magenta", "FF00FFFF"), ("transparent", "00000000") })
    Check(ManagedColour.TryParse(name, out var c) && ColorUtility.ToHtmlStringRGBA(c) == rgba, $"UnityPlayer name {name} = #{rgba}");

// measured on a console (2026-10-04); null = Unity rejects it. `none` is the mod's own special case, not Unity's
foreach (var (s, want) in new (string, string?)[] {
    ("#FFFFFF", "FFFFFFFF"), ("#ffffff", "FFFFFFFF"), ("#FFFFFFFF", "FFFFFFFF"), ("#FFF", "FFFFFFFF"), ("#FFFF", "FFFFFFFF"),
    ("red", "FF0000FF"), ("Red", "FF0000FF"), ("RED", "FF0000FF"), ("grey", "808080FF"), ("white", "FFFFFFFF"), ("#FFFFFF00", "FFFFFF00"),
    ("FFFFFF", null), ("#FFFFF", null), ("#GGGGGG", null), ("gray", null), ("rgba(255,0,0,1)", null), ("hsl(0,100%,50%)", null),
    (" #FFFFFF ", null), ("none", null) })
    Check(ManagedColour.TryParse(s, out var c) ? ColorUtility.ToHtmlStringRGBA(c) == want : want == null, $"console \"{s}\" -> {want ?? "rejected"}");

// the vector sources call ColorUtility; it must reach the managed parser and never throw
Check(ColorUtility.TryParseHtmlString("#5FD9A8", out var c6) && c6 == c1 && ColorUtility.ToHtmlStringRGBA(c6) == "5FD9A8FF", "ColorUtility is managed");

// `ver` reads the assembly version Expression is compiled into. Major 0: the SDK default
// 1.0.0.0 (nothing stamped) would pass >= on its own. Revisit if vector reaches 1.0.
var asm = typeof(ManagedColour).Assembly.GetName().Version!;
Check(asm >= new Version(0, 11, 64) && asm.Major == 0, $"core assembly version {asm} is a vector version >= 0.11.64");
var ver = Expression.Parse("ver", -1f).Evaluate(new EvalContext());
Check(ver == asm.Major * 1000000 + asm.Minor * 1000 + asm.Build && ver is >= 11064 and < 1000000, $"scene variable ver = {ver}");
Check(asm == new Version(0, 11, 118, 0) && ver == 11118, $"the core is built from the pin v0.11.118 (ver {ver}), not another vector tree");

var hello = "SCENE w=100 h=100\nR x=10 y=10 w=80 h=30 rx=4 f=#2E8B6E\nC cx=50 cy=70 rx=10 ry=10 f=#F59E0B";
var mesh = FrameTests.Draw(FrameTests.Src(hello), 400, 400, tag: true);
Check(mesh.Problems.Length == 0, "hello parses with no problems");
Check(mesh.Indices.Length > 0 && mesh.Indices.Length % 3 == 0, "hello emits triangles");
Check(mesh.Spans.Length >= 2, "node spans recorded for R and C");
// surface px, y down: R (scene y 10..40) lands at 40..160 px of 400, C (scene y 60..80) at 240..320
float Y(SurfaceFrame m, int node, Func<IEnumerable<float>, float> pick)
{
    var k = Array.FindIndex(m.Spans, s => s.Node == node);
    return pick(Enumerable.Range(m.Spans[k].First, m.Spans[k].Count).Select(v => m.Positions[v * 2 + 1]));
}
Check(Y(mesh, 0, Enumerable.Min) is > 35f and < 41f && Y(mesh, 0, Enumerable.Max) is > 159f and < 165f
      && Y(mesh, 1, Enumerable.Min) is > 235f and < 241f && Y(mesh, 1, Enumerable.Max) is > 319f and < 325f, "positions are surface px, y down");

var bad = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nR x=0 y=0 w=10 h=10 f=@nope"), 100, 100);
Check(bad.Problems.Length > 0, "unknown gradient id is reported");

var anim = FrameTests.Src("SCENE w=100 h=100\nR x==10+40*t y=10 w=10 h=10 f=#FFFFFF");
var a0 = FrameTests.Draw(anim, 100, 100, t: 0);
var a1 = FrameTests.Draw(anim, 100, 100, t: 1);
Check(a1.Positions[0] > a0.Positions[0], "t moves the shape");

// A scene that draws nothing gets the mod's magenta "drew nothing" marker (Tessellator.EmitCore), so
// "hidden" is read from the banner group's own span (node 0), not from the whole mesh.
int Span(SurfaceFrame m, int node, out int first)
{
    var k = Array.FindIndex(m.Spans, s => s.Node == node);
    first = k < 0 ? -1 : m.Spans[k].First;
    return k < 0 ? -1 : m.Spans[k].Count;
}
var verMesh = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nG v==lt(ver,11064) { R x=0 y=0 w=10 h=10 f=#FF0000 }"), 100, 100, tag: true);
var verNewer = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nG v==lt(ver,99999) { R x=0 y=0 w=10 h=10 f=#FF0000 }"), 100, 100, tag: true);
Check(Span(verMesh, 0, out _) == 0 && Span(verNewer, 0, out _) > 0, "ver reads the pinned 0.11.64+ (banner hidden; shown for a newer minimum)");
var groupCount = Span(verNewer, 0, out var groupFirst);
var childCount = Span(verNewer, 1, out var childFirst);
Check(childCount > 0 && groupFirst <= childFirst && groupFirst + groupCount >= childFirst + childCount, "span ids are parse order; a group's span encloses its child's");

// in game a group whose `o` reads only `t` is faded by its renderer; a headless frame has none, so `o` must be in the colours
var faded = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nG o==0.5+0*t { R x=0 y=0 w=100 h=100 f=#FFFFFF }"), 100, 100);
Check(faded.Colours.Where((_, i) => i % 4 == 3).Max() is > 120 and < 136, "a time-faded group's opacity is baked into its colours");

// data goes through the mod's own payload path, which trims a colour since 0.11.66; Unity's parser alone would reject this
var dataSrc = FrameTests.Src("SCENE w=100 h=100\nR x=0 y=0 w=100 h=100 f=$c");
var trimmed = FrameTests.Draw(dataSrc, 100, 100, data: "{ c = ' #FFFFFF ' }");
var unparsed = FrameTests.Draw(dataSrc, 100, 100, data: "{ c = '#nothex' }");
Check(trimmed.Problems.Length == 0 && trimmed.Colours[0] == 255 && trimmed.Colours[1] == 255 && trimmed.Colours[2] == 255
      && unparsed.Colours[1] == 0 && unparsed.Problems.Length > 0, "data \" #FFFFFF \" fills white; a non-colour fills magenta and is reported");

var ok = new ChipRunner();
await ok.LoadAsync(@"
local ui = ss.ui.surface('main'); ss.ui.activate('main')
ui:clear()
ui:element({ id='s', type='vector', rect={unit='px',x=0,y=0,w=480,h=480},
             props={ scene='g', src='SCENE w=100 h=100\nR x=0 y=0 w=$v h=10 f=#FFFFFF' } })
local d = ui:element({ id='d', type='vector', rect={unit='px',x=-4,y=-4,w=1,h=1}, props={ scene='g', data={ v=10 } } })
ui:commit()
function tick(dt) d:set_props({ data = { v = 20 } }) ui:commit() end");
Check(ok.State == ChipState.Running && ok.Screens.ElementsOf("main").Any(e => e.Id == "s"), "load records the structure element");
await ok.TickAsync();
var dataProps = (Dictionary<string, object>)ok.Screens.ElementsOf("main").Single(e => e.Id == "d").Props["data"];
Check((double)dataProps["v"] == 20.0, "tick's set_props replaces data");

var loop = new ChipRunner(initBudget: 500_000, tickBudget: 50_000);
await loop.LoadAsync("function tick(dt) while true do end end");
await loop.TickAsync();
Check(loop.State == ChipState.Halted && loop.Error == "Instruction limit exceeded: script used more than 50,000 instructions in a single tick.", "runaway tick halts on the 50k budget");

// a caught budget error would leave Lua-CSharp's count hook switched off, and the chip unmetered
var caught = new ChipRunner();
await caught.LoadAsync("function tick(dt) pcall(function() while true do end end) end");
await caught.TickAsync();
Check(caught.State == ChipState.Halted && caught.Error == "Instruction limit exceeded: script used more than 50,000 instructions in a single tick.", "pcall cannot catch the budget");

// `for i=1,n do end` as a chunk runs n+6 Lua-CSharp instructions (measured: 994 never reaches the 1000-instruction hook, 995 does)
var fits = new ChipRunner(initBudget: 5000);
await fits.LoadAsync("for i=1,4994 do end");
var over = new ChipRunner(initBudget: 5000);
await over.LoadAsync("for i=1,4995 do end");
Check(fits.State == ChipState.Running && fits.LastInstructions == 4000 && over.State == ChipState.Halted
      && over.Error == "Instruction limit exceeded: script used more than 5,000 instructions in a single tick.", "the budget is exact: 5000 instructions run, 5001 halt");

// sandbox parity with chips: nothing that clears the meter, reaches files or kills the host
var box = new ChipRunner();
await box.LoadAsync("assert(debug == nil, 'debug') assert(os.exit == nil, 'os.exit') assert(require == nil and package == nil, 'require')"
                    + " assert(os.execute == nil and os.remove == nil and os.rename == nil and os.tmpname == nil and os.getenv == nil, 'os')"
                    + " local t = os.time() + os.clock() + os.difftime(2, 1) .. os.date()");
Check(box.State == ChipState.Running, $"no debug, os.exit or require; os.time/clock/date/difftime still callable {box.Error}".TrimEnd());

// coroutine threads start with no hook of their own: the chip meters every thread it makes (CoroutineTests)
var co = new ChipRunner();
var coRun = Task.Run(() => co.LoadAsync("coroutine.wrap(function() while true do end end)()"));
Check(await Task.WhenAny(coRun, Task.Delay(10_000)) == coRun && co.State == ChipState.Halted && co.Error != null, "a coroutine that runs away halts on the budget instead of hanging");

var err = new ChipRunner();
await err.LoadAsync("local x = nil + 1");
Check(err.State == ChipState.Halted && err.Error != null, "a Lua error halts the chip");

var five2 = new ChipRunner();
await five2.LoadAsync("x = 7 // 2");
Check(five2.State == ChipState.Halted, "Lua 5.4 floor division is rejected like on a chip");

// the table form (example 01's `root`) is parsed by the same code as the text form, so both draw the same mesh
var asTable = FrameTests.Draw("w = 100, h = 100, root = { { op = 'R', x = 10, y = 10, w = 80, h = 30, rx = 4, f = '#2E8B6E' } }", 400, 400);
var asText = FrameTests.Draw(FrameTests.Src("SCENE w=100 h=100\nR x=10 y=10 w=80 h=30 rx=4 f=#2E8B6E"), 400, 400);
Check(asTable.Problems.Length == 0 && asTable.Indices.Length > 0 && asTable.Positions.SequenceEqual(asText.Positions)
      && asTable.Colours.SequenceEqual(asText.Colours) && asTable.Indices.SequenceEqual(asText.Indices), "the table form draws what the text form draws");

// print reaches the page through Output, not the console
var printer = new ChipRunner();
await printer.LoadAsync("print('a', 1, nil)");
var flood = new ChipRunner();
await flood.LoadAsync("for i = 1, 60 do print(i) end print(string.rep('x', 600) .. '\\nend')");
var floodLines = flood.Output.ToArray();
Check(printer.Output.SequenceEqual(new[] { "a\t1\tnil" }) && floodLines.Length == 50 && floodLines[0] == "13" && floodLines[^3] == "60"
      && floodLines[^2].Length == 500 && floodLines[^1] == "end", "print keeps the last 50 lines, each cut at 500 chars");

// os.clock: Lua-CSharp's default reads the process CPU time, which browser-wasm does not have; it counts from the chip's start
var clock = new ChipRunner();
await clock.LoadAsync("local a = os.clock() for i = 1, 1e5 do end assert(a >= 0 and a < 0.1 and os.clock() > a, 'clock ' .. a)");
Check(clock.State == ChipState.Running, $"os.clock counts seconds from the chip's start {clock.Error}".TrimEnd());

// out of memory is the host's failure, not the script's: it reaches the caller (the page restarts the runtime) instead of halting the chip
var starved = new ChipRunner();
starved.Lua.Environment["alloc"] = new Lua.LuaFunction("alloc", (_, _) => throw new OutOfMemoryException());
var oom = await Task.Run(async () => { try { await starved.LoadAsync("alloc()"); return null; } catch (Exception e) { return e; } });
Check(oom is OutOfMemoryException && starved.State == ChipState.Running, "out of memory propagates instead of halting the chip");
// ... and so does one thrown by host code under pcall or xpcall, which would otherwise return it as a Lua error
foreach (var guard in new[] { "pcall(alloc)", "xpcall(alloc, print)" })
{
    var guarded = new ChipRunner();
    guarded.Lua.Environment["alloc"] = guarded.Screens.Method(null, "alloc", (_, _) => throw new OutOfMemoryException());
    var guardedOom = await Task.Run(async () => { try { await guarded.LoadAsync(guard); return null; } catch (Exception e) { return e; } });
    Check(guardedOom is OutOfMemoryException, $"out of memory in host code propagates through {guard}");
}

RepinTests.Run(Check);
PageBackgroundTests.Run(Check);
EmptyPageTests.Run(Check);
RepinTables.Run(Check);
HostTests.Run(Check);
StationeersTests.Run(Check);
EventTests.Run(Check);
ProbeTests.Run(Check);
RuntimeTests.Run(Check);
LiveTests.Run(Check);
FrameTests.Run(Check);
PictureTests.Run(Check);
FixtureTests.Run(Check);
SchemaTests.Run(Check);
CoroutineTests.Run(Check);
PointerTests.Run(Check);
FontMetadataTests.Run(Check);
ExportTests.Run(Check);
TemplateTests.Run(Check);
M4Tests.Run(Check);
AdoptTests.Run(Check);

Console.WriteLine(failures.Count == 0 ? "ALL PASS" : $"{failures.Count} FAILED");
return failures.Count == 0 ? 0 : 1;

/// <summary>Test fixtures for the web side: <c>--write-fixtures</c> rewrites them, otherwise they are checked.</summary>
static class Fixtures
{
    public static bool Write;

    /// <summary>The repo's <c>web/test/</c>, found by walking up from the test binary to the folder that holds <c>core/</c>.</summary>
    public static string Root
    {
        get
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (!Directory.Exists(Path.Combine(dir.FullName, "core", "Core.Tests")))
                dir = dir.Parent ?? throw new DirectoryNotFoundException("no repo above " + AppContext.BaseDirectory);
            return Path.Combine(dir.FullName, "web", "test");
        }
    }
}
