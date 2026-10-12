using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using VectorBuilder.Core;

static class AdoptTests
{
    public static void Run(Action<bool, string> check)
    {
        var dir = Path.Combine(Fixtures.Root, "fixtures", "adopt");
        string Script(string name) => File.ReadAllText(Path.Combine(dir, name + ".lua"));
        JsonElement Capture(string lua, int allowance = 10000, string host = "")
        {
            using var doc = JsonDocument.Parse(AdoptCapture.RunJsonAsync(lua, 460, 460, host, allowance).GetAwaiter().GetResult(),
                new JsonDocumentOptions { MaxDepth = int.MaxValue });
            return doc.RootElement.Clone();
        }
        void Test(string name, Action action)
        {
            try { action(); } catch (Exception e) { check(false, "adopt: " + name + ": " + e.Message); }
        }
        void Golden(string name, string text)
        {
            var path = Path.Combine(dir, name);
            if (Fixtures.Write) File.WriteAllText(path, text + "\n");
            check(File.Exists(path) && File.ReadAllText(path) == text + "\n", "adopt fixture: " + name);
        }
        JsonElement Pair(JsonElement pairs, string key) => pairs.EnumerateArray().Single(p => p[0].GetString() == key)[1];
        Test("adopted exports compile and never run retained source", () => {
            var artifacts = Path.Combine(Fixtures.Root, "..", "..", ".test-artifacts", "adopt-artifacts");
            if (M4Tests.GenerationError(artifacts, Path.GetFullPath(Path.Combine(Fixtures.Root, "..", ".."))) is { } error)
            { check(false, "adopt: " + error); return; }
            foreach (var name in new[] { "inert", "builder", "literal" })
            {
                var path = Path.Combine(artifacts, name + ".lua");
                if (!File.Exists(path)) { check(false, "adopt: missing export artifact; run web tests first"); continue; }
                var chip = new ChipRunner();
                chip.Screens.Size = (460, 460);
                chip.LoadAsync(File.ReadAllText(path)).GetAwaiter().GetResult();
                chip.TickAsync(.5).GetAwaiter().GetResult();
                check(chip.State == ChipState.Running && chip.Screens.ElementsOf("main").Count > 0,
                    "adopt: " + name + " export compiles and retained source does not run");
                var labels = Compositor.Compose(chip, "main", 1, false).Text;
                if (name == "literal")
                {
                    check(labels.Select(t => t.Text).SequenceEqual(new[] { "123456789", "$original", "{$value}", "{=2+2}" }),
                        "adopt: native label text stays literal: " + string.Join("; ", labels.Select(t => t.Text)));
                    continue;
                }
                var label = labels.Single();
                bool Near(float a, float b) => Math.Abs(a - b) < .001;
                check(label.Text == "Hello" && Near(label.X, 5) && Near(label.Y, 6) && Near(label.W, 70)
                    && Near(label.H, 30) && Near(label.Size, 16) && label.Align == 0 && label.VAlign == 1,
                    "adopt: native label maps back to its captured box and size: " + JsonSerializer.Serialize(label));
            }
        });
        Test("src scene", () => {
            var r = Capture(Script("src"));
            var s = r.GetProperty("structures")[0];
            var d = r.GetProperty("data").EnumerateArray().Single(d => Pair(d.GetProperty("values"), "value").GetDouble() == 20);
            var ns = r.GetProperty("natives");
            check(r.GetProperty("complete").GetBoolean() && r.GetProperty("error").ValueKind == JsonValueKind.Null
                && r.GetProperty("structures").GetArrayLength() == 1 && Pair(s.GetProperty("props"), "src").GetString()!.Contains("$value")
                && s.GetProperty("rect").EnumerateArray().Select(x => x.GetDouble()).SequenceEqual(new double[] {10,20,200,100})
                && Pair(d.GetProperty("values"), "value").GetDouble() == 20
                && Pair(d.GetProperty("values"), "enabled").GetProperty("b").GetBoolean()
                && Pair(d.GetProperty("values"), "list").GetProperty("a").GetArrayLength() == 2
                && ns.GetArrayLength() == 2 && ns[0].GetProperty("rect")[2].GetDouble() == 460
                && ns[1].GetProperty("rect")[0].GetDouble() == 5, "adopt: src scene");
            Golden("src.capture.json", r.GetRawText());
        });
        Test("table scene with root defaults", () => {
            var r = Capture(Script("table"));
            check(Pair(r.GetProperty("structures")[0].GetProperty("props"), "style").GetProperty("m").GetArrayLength() == 2,
                "adopt: table scene with root defaults");
            Golden("table.capture.json", r.GetRawText());
        });
        Test("clicks reach pages", () => {
            var r = Capture(Script("clicks"));
            var s = r.GetProperty("structures");
            check(r.GetProperty("complete").GetBoolean() && s.GetArrayLength() == 3 && s[0].GetProperty("via").GetArrayLength() == 0
                && s[1].GetProperty("via")[0][1].GetString() == "next" && s[2].GetProperty("via")[0][1].GetString() == "more"
                && r.GetProperty("surfaces").GetArrayLength() == 2, "adopt: clicks reach pages");
            Golden("clicks.capture.json", r.GetRawText());
        });
        Test("a builder export without its block", () => {
            var artifacts = Path.Combine(Fixtures.Root, "..", "..", ".test-artifacts", "m4-artifacts");
            if (M4Tests.GenerationError(artifacts, Path.GetFullPath(Path.Combine(Fixtures.Root, "..", ".."))) is { } error)
            { check(false, "adopt: " + error); return; }
            var r = Capture(File.ReadAllText(Path.Combine(artifacts, "template-power-off.lua")), host: File.ReadAllText(Path.Combine(artifacts, "template-power.host.json")));
            var pages = JsonDocument.Parse(File.ReadAllText(Path.Combine(artifacts, "template-power.pages.json"))).RootElement;
            check(r.GetProperty("vb").GetBoolean() && r.GetProperty("error").ValueKind == JsonValueKind.Null
                && pages.EnumerateArray().All(p => r.GetProperty("structures").EnumerateArray().Any(s =>
                    s.GetProperty("surface").GetString() == p.GetProperty("surface").GetString()
                    && Pair(s.GetProperty("props"), "src").GetString() == p.GetProperty("src").GetString()))
                && r.GetProperty("structures").EnumerateArray().All(s => Pair(s.GetProperty("props"), "src").GetString()!.Contains("# widget")),
                "adopt: a builder export without its block");
        });
        Test("a halting script", () => {
            var r = Capture(Script("halt"));
            check(r.GetProperty("error").GetString()!.Contains("capture halt") && r.GetProperty("structures").GetArrayLength() == 1,
                "adopt: a halting script");
            Golden("halt.capture.json", r.GetRawText());
        });
        Test("the allowance", () => {
            var r = Capture(Script("allowance"), 1);
            check(!r.GetProperty("complete").GetBoolean() && r.GetProperty("untried").GetInt32() > 0
                && r.GetProperty("notes").EnumerateArray().Any(n => n.GetString() == "not every click was tried here"), "adopt: the allowance");
        });
        Test("the preview chip is untouched", () => {
            var preview = new ChipRunner();
            preview.LoadAsync("ic.persist.set('saved','keep'); ic.mem_write(0,42); " + Script("table")).GetAwaiter().GetResult();
            var before = preview.Screens.ElementsOf("main")[0];
            Capture(Script("src"));
            check(ReferenceEquals(before, preview.Screens.ElementsOf("main")[0]) && preview.Stationeers.Persist["saved"] == "keep"
                && preview.Stationeers.Memory[0] == 42 && preview.State == ChipState.Running, "adopt: the preview chip is untouched");
        });
        Test("keys", () => {
            var r = Capture(Script("src"));
            string[] Keys(JsonElement e) => e.EnumerateObject().Select(p => p.Name).ToArray();
            var keys = JsonSerializer.Serialize(new { report = Keys(r), surface = Keys(r.GetProperty("surfaces")[0]),
                structure = Keys(r.GetProperty("structures")[0]), data = Keys(r.GetProperty("data")[0]),
                native = Keys(r.GetProperty("natives")[0]), click = Keys(r.GetProperty("clicks")[0]) });
            Golden("keys.json", keys);
        });
        Test("unsafe captured values", () => {
            var r = Capture("""
                local ui=ss.ui.surface('main')
                ui:element {id='scene',type='vector',rect={w=1,h=1},props={src='SCENE w=100 h=100\nR w=100 h=100 f=#fff'}}
                ui:element {id='data',type='vector',props={scene='scene',data={safe=1,bad=0/0,__proto__=4,nested={constructor=5,ok=2}}}}
                """);
            var values = r.GetProperty("data")[0].GetProperty("values");
            check(Pair(values,"bad").ValueKind == JsonValueKind.Null && !values.EnumerateArray().Any(p => p[0].GetString() == "__proto__")
                && Pair(values,"nested").GetProperty("m").EnumerateArray().All(p => p[0].GetString() != "constructor")
                && r.GetProperty("notes").GetArrayLength() >= 3, "adopt: unsafe captured values");
        });
        Test("deep captured props", () => {
            var r = Capture("""
                local t={text='deep'} for i=1,40 do t={child=t} end
                ss.ui.surface('main'):element {id='data',type='vector',props={data=t}}
                """);
            check(r.GetProperty("complete").GetBoolean() && r.GetProperty("data").GetArrayLength() == 1,
                "adopt: deep captured props");
        });
        Test("native-only click states", () => {
            var r = Capture("""
                local ui=ss.ui.surface('main')
                local e=ui:element {id='button',type='label',rect={w=1,h=1},props={text='first'}}
                local n=0
                e:on('click',function() n=n+1 e:set_props {text=n==1 and 'second' or 'third'} end)
                """);
            check(r.GetProperty("natives").EnumerateArray().Any(n => n.GetProperty("props").GetProperty("text").GetString() == "third")
                && r.GetProperty("states").GetInt32() == 3, "adopt: native-only click states");
        });
        Test("coordinate click values", () => {
            var r = Capture("""
                local ui=ss.ui.surface('main')
                local e=ui:element {id='scene',type='vector',rect={w=1,h=1},
                  props={src='SCENE w=100 h=100\nR id=point click=1 xy=1 w=100 h=100 f=#fff'}}
                e:on('click',function(id)
                  assert(id=='point@0.500,0.500','coordinate click was not tagged')
                  e:set_props {src='SCENE w=100 h=100\nR w=100 h=100 f=#f00'}
                end)
                """);
            check(r.GetProperty("error").ValueKind == JsonValueKind.Null && r.GetProperty("structures").GetArrayLength() == 2
                && r.GetProperty("structures")[1].GetProperty("via")[0][1].GetString() == "point@0.500,0.500"
                && r.GetProperty("notes").EnumerateArray().Any(n => n.GetString() == "coordinate clicks were sampled at the centre only"),
                "adopt: coordinate click values");
        });
        Test("native integers keep their digits", () => {
            var r = Capture("ss.ui.surface('main'):element {id='label',type='label',props={value=123456789},style={value=16777217}}");
            var n = r.GetProperty("natives")[0];
            check(n.GetProperty("props").GetProperty("value").GetDouble() == 123456789
                && n.GetProperty("style").GetProperty("value").GetDouble() == 16777217, "adopt: native integers keep their digits");
        });
        Test("finite doubles above the float range", () => {
            var r = Capture("ss.ui.surface('main'):element {id='label',type='label',props={value=1e100},style={value=-1e100}}");
            var n = r.GetProperty("natives")[0];
            check(n.GetProperty("props").GetProperty("value").GetDouble() == 1e100
                && n.GetProperty("style").GetProperty("value").GetDouble() == -1e100
                && r.GetProperty("notes").GetArrayLength() == 0, "adopt: finite doubles above the float range");
        });
        Test("an expanding native crawl is disclosed", () => {
            var r = Capture("""
                local ui=ss.ui.surface('main')
                local n=0
                local e=ui:element {id='counter',type='label',rect={w=1,h=1},props={text='0'}}
                e:on('click',function() n=n+1 e:set_props {text=tostring(n)} end)
                """, 100);
            const string note = "the click crawl was still finding new states when the allowance was spent";
            check(!r.GetProperty("complete").GetBoolean() && r.GetProperty("untried").GetInt32() > 0
                && r.GetProperty("states").GetInt32() > 1
                && r.GetProperty("notes").EnumerateArray().Any(n => n.GetString() == note)
                && !Capture(Script("clicks"), 0).GetProperty("notes").EnumerateArray().Any(n => n.GetString() == note),
                "adopt: an expanding native crawl is disclosed");
        });
        Test("generated artifacts require a current stamp", () => {
            var root = Path.GetFullPath(Path.Combine(Fixtures.Root, "..", ".."));
            var generated = Path.Combine(root, ".test-artifacts", "m4-artifacts");
            var scratch = Path.Combine(root, ".test-artifacts", "adopt-stamp-tests");
            Directory.CreateDirectory(scratch);
            var stamp = Path.Combine(scratch, "stamp.json");
            try
            {
                File.Delete(stamp);
                check(M4Tests.GenerationError(scratch, root)?.Contains("missing generation stamp; run web tests") == true,
                    "adopt: missing generation stamp is clear");
                File.WriteAllText(stamp, """{"inputs":{},"artifacts":{}}""");
                check(M4Tests.GenerationError(scratch, root)?.Contains("stale generation inputs; run web tests") == true,
                    "adopt: stale generation inputs are rejected");
                if (M4Tests.GenerationError(generated, root) is { } generationError)
                { check(false, "adopt: " + generationError); return; }
                File.Copy(Path.Combine(generated, "stamp.json"), stamp, true);
                check(M4Tests.GenerationError(scratch, root)?.Contains("missing or changed generated artifacts; run web tests") == true,
                    "adopt: missing or changed generated artifacts are rejected");
                File.WriteAllText(stamp, "{");
                check(M4Tests.GenerationError(scratch, root)?.Contains("run web tests") == true,
                    "adopt: malformed generation stamp is clear");
            }
            finally { File.Delete(stamp); }
        });
    }
}
