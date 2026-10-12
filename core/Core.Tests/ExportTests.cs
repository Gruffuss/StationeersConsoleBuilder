using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using VectorBuilder.Core;

static class ExportTests
{
    static ExportReport Run(string lua, ExportPage[]? pages = null, HostJson? host = null) =>
        ExportCheck.RunAsync(lua, host ?? HostJson.Empty, pages ?? []).GetAwaiter().GetResult();
    static ExportReport Json(string lua, string host, string pages) => JsonSerializer.Deserialize<ExportReport>(
        ExportCheck.RunJsonAsync(lua, host, pages).GetAwaiter().GetResult())!;
    static bool Error(ExportReport r, string prefix) => r.complete && r.issues.Any(i => i.level == "error" && i.message.StartsWith(prefix));
    static ExportPage Page(string src, string id = "p1", string surface = "main", bool empty = false) => new(id, surface, src, empty, 460, 460);
    static string Draw(string src, string surface = "main") => $$"""
        local ui = ss.ui.surface('{{surface}}')
        ss.ui.activate('{{surface}}')
        local s = ui:element({id='scene',type='vector',rect={unit='frac',x=0,y=0,w=1,h=1},props={scene='s', {{FrameTests.Src(src)}} } })
        ui:commit()
        """;

    public static void Run(Action<bool, string> check)
    {
        var plain = "SCENE w=480 h=480\nR w=40 h=40 f=#FFFFFF";
        var missing = "SCENE w=480 h=480\nR w=$missing h=40 f=#FFFFFF\nR x=40 w=40 h=40 f=@unknown";
        var bad = Run("local x = ", [Page(plain)]);
        check(Error(bad, "compile: ") && bad.ticks == 0 && bad.loadInstructions == 0, "export: compile errors never run");
        check(Error(Run("local x = 1\nlocal y = "), "compile: ") && Run("local x = 1\nlocal y = ").issues.Any(i => Regex.IsMatch(i.message, "\\[string \"chip\"\\]:2:")),
            "export: real compiler preserves the custom chunk line for mapError");
        var customArtifact = File.ReadAllText(Path.Combine(Fixtures.Root, "fixtures", "codegen", "custom.lua"))
            .Replace("-- >>> vectorbuilder custom (kept verbatim)", "-- >>> vectorbuilder custom (kept verbatim)\nlocal broken = )");
        string? compilerMessage = null;
        try { Lua.LuaState.Create().Load(customArtifact.AsSpan(), "chip"); }
        catch (Exception e) when (e is Lua.LuaParseException or Lua.LuaCompileException) { compilerMessage = e.Message; }
        var customError = Run(customArtifact);
        check(compilerMessage != null && customError.ticks == 0 && customError.issues.Single(i => i.level == "error").message == "compile: " + compilerMessage,
            "export: real generated custom-block compiler error follows its phase unchanged");
        foreach (var source in new[] { "return 1 // 2", "return 1 & 2", "return 1 << 2", "return '\\u{41}'" })
        {
            var r = Run(source);
            check(r.ticks == 0 && Error(r, "compile: "), "export: compiler refuses newer Lua syntax " + source);
        }
        string Locals(int n) => "local " + string.Join(",", Enumerable.Range(1, n).Select(i => "v" + i));
        check(Error(Run(Locals(201)), "compile: "), "export: 201 active locals refused");
        check(!Run(Locals(200)).issues.Any(i => i.level == "error"), "export: 200 active locals accepted");
        check(!Run("do " + Locals(150) + " end do " + Locals(150) + " end").issues.Any(i => i.level == "error"), "export: separate local scopes are not added together");
        var load = Run("while true do end", host: HostJson.Empty with { budgets = new(1501, 2999) });
        check(Error(load, "load: Instruction limit exceeded") && load.ticks == 0 && load.loadInstructions == 1000, "export: load phase and clamped load budget");
        var tick = Run("function tick(dt) while true do end end", host: HostJson.Empty with { budgets = new(500_000, 2999) });
        check(Error(tick, "tick 1: Instruction limit exceeded") && tick.ticks == 1 && tick.worstTickInstructions == 2000, "export: tick budget halts, naming its phase");
        check(Error(Run("function tick(dt) while true do end end", [Page(plain, "page with spaces !")]), "tick 1 (opening page page with spaces !): Instruction limit exceeded"),
            "export: a failed visit names its explicit page ID");
        var malformed = Run("error('load stopped')", [Page("SCENE\nG {", "broken"), Page("SCENE\nDEFS { FONT }", "later", "other")]);
        check(Error(malformed, "page broken: ") && malformed.issues.Any(i => i.page == "later" && i.level == "warning"), "export: all supplied sources parsed even after a load halt");
        var warning = Run(Draw(missing), [Page(missing, "page with spaces & punctuation !")]);
        check(warning.complete && !warning.issues.Any(i => i.level == "error") && warning.issues.Any(i => i.level == "warning" && i.message.Contains("unresolved data name $missing"))
            && warning.issues.Any(i => i.message.Contains("unknown")) && warning.issues.All(i => i.node == null && i.key == null), "export: missing names and unknown gradients warn without fabricated selection targets");
        check(warning.issues.Where(i => i.level == "warning").Select(i => (i.level, i.page, i.message)).Distinct().Count() == warning.issues.Count(i => i.level == "warning"), "export: render warnings deduplicate across ticks");
        var custom = Run(Draw(missing, "custom"));
        check(custom.issues.Any(i => i.level == "warning" && i.page == null && i.message.Contains("$missing")), "export: custom surfaces are inspected with no invented page");
        var transient = Run(Draw(missing) + "\nfunction tick(dt) s:set_props({" + FrameTests.Src(plain) + "}) ui:commit() end", [Page(plain)]);
        check(transient.issues.Any(i => i.message.Contains("$missing")), "export: load-only problem survives later clean frames");
        var font = "SCENE w=480 h=480\nDEFS { FONT src=\"https://example.invalid/face.ttf\" }";
        var retained = Run(Draw(font) + "\nui:element({id='native',type='label',props={text='Hi'}}) ui:commit()", [Page(font)]);
        check(retained.complete && !retained.issues.Any(i => i.level == "error") && retained.visited.SequenceEqual(["p1"]), "export: native-only page with direct FONT retains its nonempty vector source");
        var badFont = "SCENE\nDEFS { FONT }";
        check(Run(Draw(badFont), [Page(badFont)]).issues.Any(i => i.level == "warning" && i.message.Contains("FONT")), "export: accepted FONT faults are mod warnings");
        var noGeometry = Run(Draw("SCENE w=480 h=480"), [Page("SCENE w=480 h=480")]);
        check(!noGeometry.issues.Any(i => i.level != "info"), "export: drew-nothing marker adds no invented problem");
        var droppedChip = FrameTests.Chip(Draw(plain), 460, 460);
        droppedChip.Vectors.SceneOf("main", "scene")!.Builder.Dropped = "mesh 2 (60001 vertices, past the 60000 one mesh holds)";
        var dropped = ExportCheck.MeshDrops(droppedChip, "main", "p1").Single();
        check(dropped.level == "warning" && dropped.page == "p1" && dropped.node == null && dropped.key == null
            && dropped.message.Contains("DROPPED: mesh 2 (60001 vertices, past the 60000 one mesh holds)")
            && dropped.message.Contains("everything in it is missing from the console"),
            "export: mesh-drop warning carries the mod's missing-console meaning");
        var neverBuilt = Run("return", [Page(plain)]);
        check(Error(neverBuilt, "page p1: ") && neverBuilt.visited.Length == 0, "export: unbuilt nonempty expected page is an error, not a visit");
        var native = Run("ss.ui.surface('main'):element({id='native',type='label',props={text='Hi'}}) ss.ui.activate('main')", [Page("ignored malformed {", empty: true)]);
        check(!native.issues.Any(i => i.level == "error") && native.visited.SequenceEqual(["p1"]), "export: native-only and Blank pages need no vector scene");
        var sizes = Run("local s = ss.ui.surface('main'):size() assert(s.w==123 and s.h==456) local t=ss.ui.surface('wide'):size() assert(t.w==700 and t.h==200)",
            [new("p1", "main", "", true, 123, 456), new("p2", "wide", "", true, 700, 200)]);
        check(!sizes.issues.Any(i => i.message.StartsWith("load: ")), "export: first page size and distinct surface sizes are set before load");
        var coldHost = HostJson.Empty with { persist = new() { ["secret"] = "old" }, memory = [42], beta = true };
        var cold = Run("assert(ic.persist.get('secret')==nil and ic.mem_read(0)==0) assert(ss.ui.surface('main').remove~=nil)", host: coldHost);
        check(!cold.issues.Any(i => i.level == "error") && coldHost.persist!["secret"] == "old" && coldHost.memory![0] == 42, "export: cold stores and host beta without mutating caller stores");
        var deterministic = Run("local n=0 function tick(dt) n=n+1 assert(dt==0.5 and os.clock()==n*0.5) end");
        check(deterministic.complete && deterministic.ticks == 20 && !deterministic.issues.Any(i => i.level == "error") && deterministic.issues.Any(i => i.message.Contains("10 seconds")), "export: deterministic ten-second sample is disclosed");
        check(deterministic.issues.Any(i => i.message.Contains("16") && i.message.Contains("TMP") && i.message.Contains("click") && i.message.Contains("Fonts"))
            && deterministic.issues.Any(i => i.message.Contains("px")), "export: disclose no-click, font/TMP, problem cap and page-pixel starvation limits");
        Visits(check, plain);
        Persist(check);
        Boundary(check, plain);
        Corpus(check);
        var wasm = File.ReadAllText(Path.Combine(Fixtures.Root, "..", "..", "core", "Wasm", "Exports.cs"));
        check(Regex.IsMatch(wasm, @"\[JSExport\]\s*public static Task<string> CheckExport\(string lua, string host, string pages\) => ExportCheck.RunJsonAsync\(lua, host, pages\);"),
            "export: Wasm CheckExport is exactly the stateless delegate");
    }

    static void Visits(Action<bool, string> check, string plain)
    {
        var pages = Enumerable.Range(1, 25).Select(i => Page(plain, "p" + i, "s" + i)).ToArray();
        var lua = $$"""
            local n, last, renders = 0, nil, 0
            VB = {}
            function VB.go(id)
              if last then assert(renders==2, 'next visit before render') end
              last=id; renders=0
              local k=tonumber(string.sub(id,2))
              local ui=ss.ui.surface('s'..k)
              ss.ui.activate('s'..k)
              ui:element({id='scene',type='vector',rect={unit='frac',w=1,h=1},props={ {{FrameTests.Src(plain)}} } })
              ui:commit()
            end
            function tick(dt)
              n=n+1; renders=renders+1
              assert(os.clock()==n*0.5)
            end
            """;
        var r = Run(lua, pages);
        check(r.complete && r.ticks == 50 && r.visited.SequenceEqual(pages.Select(p => p.id)) && !r.issues.Any(i => i.level == "error"), "export: 25 visits each build then render before next visit, 50 ticks without a page cap");
        check(r.issues.Any(i => i.message.Contains("25 seconds")), "export: extra page visits disclose actual sample duration");
        foreach (var phase in new[] { "load", "tick" })
        {
            var halted = Run(phase == "load" ? "error('stopped')" : lua.Replace("n=n+1; renders=renders+1", "n=n+1; renders=renders+1 if n==3 then error('stopped') end"), pages);
            var notReached = halted.issues.Where(i => i.message.Contains("not reached because of the halt")).ToArray();
            var expected = phase == "load" ? pages : pages.Skip(2);
            check(halted.complete && halted.issues.Count(i => i.level == "error") == 1
                && notReached.All(i => i.level == "info") && notReached.Select(i => i.page).SequenceEqual(expected.Select(p => p.id))
                && !halted.issues.Any(i => i.message.Contains("never built")),
                $"export: {phase} halt reports unreached pages without invented visit errors");
        }
        var firstHalts = Run(lua.Replace("last=id; renders=0", "last=id; renders=0 if id=='p1' then error('stopped') end"), pages.Take(2).ToArray());
        var halt = firstHalts.issues.Where(i => i.level == "error").ToArray();
        var unvisited = firstHalts.issues.Where(i => i.level == "info" && i.page != null && i.message.Contains("halt")).ToArray();
        check(firstHalts.complete && halt.Length == 1 && halt[0].page == "p1" && halt[0].message.Contains("stopped")
            && unvisited.Select(i => i.page).SequenceEqual(["p1", "p2"]) && firstHalts.visited.Length == 0
            && !firstHalts.issues.Any(i => i.message.Contains("never built")),
            "export: a halt while opening the first page reports the halt once and both pages as not visited");
        var hidden = Run(lua.Replace(FrameTests.Src(plain), "src = k==25 and [==[SCENE\nR w=$hidden h=40]==] or [==[" + plain + "]==]"), pages);
        check(hidden.issues.Any(i => i.level == "warning" && i.page == "p25" && i.message.Contains("$hidden")), "export: hidden-later render problem captured on its visit");
    }

    static void Persist(Action<bool, string> check)
    {
        foreach (var (expression, reason) in new[] {
            ("string.rep('é',64)", "key"), ("'key'", "value"), ("'__reserved'", "reserved") })
        {
            var lua = reason == "key" ? $"assert(ic.persist.set({expression},'ok')) assert(not ic.persist.set({expression}..'x','SECRET'))"
                : reason == "value" ? "assert(ic.persist.set('key',string.rep('é',4096))) assert(not ic.persist.set('key',string.rep('é',4096)..'x'))"
                : "assert(not ic.persist.set('__reserved','SECRET'))";
            var r = Run(lua + " function tick(dt) pcall(function() ic.persist.set('__reserved','SECRET') end) end");
            check(!r.issues.Any(i => i.level == "error") && r.issues.Any(i => i.level == "warning" && i.message.Contains(reason)) && r.issues.All(i => !i.message.Contains("SECRET")),
                "export: UTF-8 persist " + reason + " refusal remains false and warns without value contents");
        }
        var total = Run("for i=1,3 do assert(ic.persist.set(tostring(i),string.rep('é',4096))) end assert(ic.persist.set('4',string.rep('é',4094))) assert(not ic.persist.set('4',string.rep('é',4094)..'x'))");
        check(!total.issues.Any(i => i.level == "error") && total.issues.Any(i => i.level == "warning" && i.message.Contains("32769") && i.message.Contains("32768")), "export: UTF-8 persist total 32768 accepted, 32769 refused");
        var chip = new ChipRunner();
        chip.LoadAsync("assert(ic.persist.set('ok','kept')) assert(not ic.persist.set('__r','SECRET')) assert(not ic.persist.set('__r','SECRET'))").GetAwaiter().GetResult();
        check(chip.State == ChipState.Running && chip.Stationeers.Persist.Count == 1 && chip.Stationeers.Persist["ok"] == "kept" && chip.Stationeers.PersistRefusals.Count == 1,
            "export: fake host keeps existing mutation/return behavior and distinct refusal reasons outside checker");
        var growing = new ChipRunner();
        growing.LoadAsync("for n=8193,8293 do assert(not ic.persist.set('a', string.rep('x',n))) end assert(not ic.persist.set('b',string.rep('x',8293))) assert(not ic.persist.set('a',string.rep('x',8300))) assert(not ic.persist.set('__r','x'))").GetAwaiter().GetResult();
        check(growing.State == ChipState.Running && growing.Stationeers.PersistRefusals.Count == 3
            && growing.Stationeers.PersistRefusals.Count(r => r.Contains("8300")) == 1
            && growing.Stationeers.PersistRefusals.Count(r => r.Contains("8293")) == 1
            && growing.Stationeers.PersistRefusals.Count(r => r.Contains("reserved")) == 1
            && !growing.Stationeers.PersistRefusals.Any(r => r.Contains("8193")),
            "export: growing refusals retain only the latest value per key and kind");
        growing.LoadAsync("assert(not ic.persist.set('a',string.rep('y',8400)))").GetAwaiter().GetResult();
        check(growing.Stationeers.PersistRefusals.Count == 3 && growing.Stationeers.PersistRefusals.Any(r => r.Contains("8400"))
            && !growing.Stationeers.PersistRefusals.Any(r => r.Contains("8300")),
            "export: refusal replacement stays bounded across preview loads");
        var lost = Run("local ui=ss.ui.surface('main') local d=ui:element({id='d',type='vector',props={scene='s',data={v=1}}}) d:set_props({data={v=2}})");
        check(lost.issues.Any(i => i.level == "warning" && i.message.Contains("lost", StringComparison.OrdinalIgnoreCase)), "export: LostWrites is a warning distinct from invalid Lua");
    }

    static void Boundary(Action<bool, string> check, string plain)
    {
        var collision = "{\"housing\":{\"ref\":1,\"prefab\":1},\"devices\":[{\"ref\":1,\"prefab\":2}]}";
        var r = Json("assert(#ic.device.list()==0)", collision, "[]");
        check(r.complete && !r.issues.Any(i => i.level == "error") && r.issues.Any(i => i.level == "warning" && i.message.Contains("housing ref")), "export: housing-ref collision warns and skips the device");
        foreach (var host in new[] { "{", "{\"devices\":[{\"ref\":2},{\"ref\":2}]}" })
            check(Error(Json("return", host, "[]"), "host: "), "export: malformed/duplicate-ref host rejected " + host);
        check(Json("return", "", "[]").complete && Json("return", "", "[]").ticks == 20, "export: blank host is valid cold input");
        foreach (var pages in new[] { "{", "null", "[null]", "[{\"id\":\"p\",\"surface\":\"s\"}]", "[{\"id\":\"p\",\"surface\":\"s\",\"src\":\"\",\"empty\":true,\"w\":0,\"h\":10}]" })
            check(Error(Json("return", "", pages), "arguments: "), "export: invalid manifest rejected " + pages);
        foreach (var pages in new[] { new[] { Page(plain), Page(plain, "p1", "other") }, new[] { Page(plain), Page(plain, "other", "main") } })
        {
            check(Error(Run("return", pages), "arguments: "), "export: duplicate page/surface rejected by direct caller");
            check(Error(Json("return", "", JsonSerializer.Serialize(pages)), "arguments: "), "export: duplicate page/surface rejected by JSON caller");
        }
        check(Error(Run((string)null!), "arguments: ") && Error(ExportCheck.RunAsync("return", null!, []).GetAwaiter().GetResult(), "arguments: "), "export: null direct arguments are known errors");
    }

    static void Corpus(Action<bool, string> check)
    {
        foreach (var file in Directory.GetFiles(Path.Combine(Fixtures.Root, "fixtures", "codegen"), "*.lua"))
        {
            var lua = File.ReadAllText(file);
            // Read the explicit generated declarations, without running a second diagnostic chunk.
            var pages = Regex.Matches(lua, "\\{ id = \"([^\"]+)\", surface = \"([^\"]+)\".*?src = \\[(==+)\\[\\n(.*?)\\]\\3\\].*?empty = (true|false), w = (\\d+), h = (\\d+)", RegexOptions.Singleline)
                .Select(m => new ExportPage(m.Groups[1].Value, m.Groups[2].Value, m.Groups[4].Value, m.Groups[5].Value == "true", int.Parse(m.Groups[6].Value), int.Parse(m.Groups[7].Value))).ToArray();
            var host = HostJson.Parse(File.ReadAllText(Path.ChangeExtension(file, ".host.json")), out _);
            var timer = Stopwatch.StartNew();
            var r = Run(lua, pages, host);
            timer.Stop();
            check(pages.Length > 0 && r.complete && !r.issues.Any(i => i.level == "error") && r.ticks == Math.Max(20, pages.Length * 2) && r.visited.Length == pages.Length,
                $"export: codegen {Path.GetFileNameWithoutExtension(file)} exact artifact visits every page including Devices ({string.Join("; ", r.issues.Where(i => i.level == "error").Select(i => i.message))})");
            Console.WriteLine($"MEASURE export {Path.GetFileNameWithoutExtension(file)}: {Encoding.UTF8.GetByteCount(lua)} source bytes, {pages.Length} pages, {r.ticks} ticks, {timer.Elapsed.TotalMilliseconds:F2} ms, load {r.loadInstructions}, worst tick {r.worstTickInstructions}");
        }
    }
}
