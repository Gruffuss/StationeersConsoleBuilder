using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Lua;
using VectorBuilder.Core;

static class TemplateTests
{
    sealed record TemplatePage(string id, string surface, string src, bool empty, int w, int h);
    static readonly string[] Ids = ["overview", "atmos-tanks", "power", "airlock", "solar", "blank", "needle-gauge", "power-wall-3x2", "power-wall-2x3", "hydro-farm"];
    static readonly string[] Themes = ["neutral", "vanilla-plus"];
    static LuaTable Table(ChipRunner c, string name) => c.Lua.Environment[name].Read<LuaTable>();
    static double Number(ChipRunner c, string table, string name) => Table(c, table)[name].Read<double>();
    static string Page(ChipRunner c) => Table(c, "page")["id"].Read<string>();
    static SurfaceFrame Frame(ChipRunner c) => Compositor.Compose(c, "main", 1, true);
    static void Tick(ChipRunner c) => c.TickAsync(0.5).GetAwaiter().GetResult();
    static void Click(ChipRunner c, string id, string surface = "main") { c.Screens.Enqueue(surface, "scene", "click", id); Tick(c); }
    static void Set(ChipRunner c, HostJson host, int device, string type, double value) =>
        c.Stationeers.Sim(new SimJson(new() { [device.ToString(CultureInfo.InvariantCulture)] = new() {
            [host.enums!["LogicType"][type].ToString(CultureInfo.InvariantCulture)] = new SourceJson("const", value) } }));
    static bool Paint(SurfaceFrame f, byte r, byte g, byte b) => Enumerable.Range(0, f.Colours.Length / 4)
        .Any(i => f.Colours[i * 4] == r && f.Colours[i * 4 + 1] == g && f.Colours[i * 4 + 2] == b && f.Colours[i * 4 + 3] == 255);

    public static void Run(Action<bool, string> check)
    {
        var dir = Path.Combine(Fixtures.Root, "fixtures", "codegen");
        var files = Directory.GetFiles(dir, "template-*.lua");
        var expected = Ids.SelectMany(id => Themes.Select(theme => $"template-{id}-{theme}")).Order().ToArray();
        check(files.Select(Path.GetFileNameWithoutExtension).Order().SequenceEqual(expected), "templates: exactly twenty starter/theme fixture pairs");
        var rendered = 0;
        foreach (var id in Ids) foreach (var theme in Themes)
        {
            var stem = Path.Combine(dir, $"template-{id}-{theme}");
            if (!File.Exists(stem + ".lua")) continue; // Missing fixtures already fail the exact matrix assertion.
            var pages = JsonSerializer.Deserialize<TemplatePage[]>(File.ReadAllText(stem + ".pages.json"))!;
            var host = HostJson.Parse(File.ReadAllText(stem + ".host.json"), out var error);
            check(error == null && pages.Length == (id == "blank" ? 1 : id == "hydro-farm" ? 4 : 2), $"templates {id}/{theme}: host and explicit pages");
            double now = 0;
            var chip = new ChipRunner(clock: () => now, host: host);
            chip.Screens.Size = (pages[0].w, pages[0].h);
            foreach (var pg in pages) chip.Screens.Sizes[pg.surface] = (pg.w, pg.h);
            chip.LoadAsync(File.ReadAllText(stem + ".lua")).GetAwaiter().GetResult();
            check(chip.State == ChipState.Running, $"templates {id}/{theme}: loads once {chip.Error}");
            foreach (var pg in pages)
            {
                chip.Screens.QueueVisit(pg.id); now += 0.5; Tick(chip); now += 0.5; Tick(chip);
                var frame = Compositor.Compose(chip, pg.surface, 1, true);
                check(chip.State == ChipState.Running && frame.Problems.Length == 0, $"templates {id}/{theme}/{pg.id}: renders with no diagnostics {chip.Error}");
                if (pg.id == "p1")
                {
                    if (id != "blank") check(frame.Text.Length > 0 && frame.Elements.Any(e => e.Id == "scene" && e.VertexCount > 0), $"templates {id}/{theme}: first page draws");
                    check(theme == "neutral" ? frame.Text.All(t => t.Font is null or "" or "Liberation Sans") : id == "blank" || frame.Text.Any(t => t.Font?.StartsWith("Barlow") == true), $"templates {id}/{theme}: selected-theme text faces");
                    check((string)chip.Screens.ElementsOf("main").Single(e => e.Id == "bg").Style!["bg"] == (theme == "neutral" ? "#2B2B2B" : "#3A3A43"), $"templates {id}/{theme}: selected-theme background");
                    if (id != "blank") check(theme == "neutral" ? Paint(frame, 26, 26, 26) : Paint(frame, 255, 119, 45), $"templates {id}/{theme}: selected-theme header paint");
                }
            }
            rendered++;
            chip.Screens.QueueVisit("p1"); Tick(chip); Tick(chip);
            var labels = Frame(chip).Text.Select(t => t.Text).ToArray();
            void Near(string table, string key, double want) => check(Math.Abs(Number(chip, table, key) - want) < 1e-6, $"templates {id}/{theme}: {table}.{key} = {want}");
            if (id == "overview")
            {
                Near("P", "frac", 0.5);
                check(new[] { "50", "OK", "22.0" }.All(labels.Contains), $"templates overview/{theme}: weighted battery percent, status and Celsius labels");
            }
            if (id == "atmos-tanks")
            {
                Near("P", "press", 5000); Near("P", "frac", 0.5); Near("P", "temp", 20);
                var history = Table(chip, "H")["press"].Read<LuaTable>();
                check(history[1].Read<double>() == 5000 && labels.Contains("20.0"), $"templates atmos-tanks/{theme}: pressure history and Celsius displayed");
            }
            if (id == "solar")
            {
                Near("P", "output", 3000); Near("P", "frac", 0.6); Near("P", "cap", 5000);
                check(labels.Contains("3000") && labels.Contains("5000.0"), $"templates solar/{theme}: raw output and capacity labels");
            }
            if (id == "power")
            {
                chip.Stationeers.TakeWrites(); Tick(chip);
                check(chip.Stationeers.TakeWrites().Length == 0, $"templates power/{theme}: Auto holds at 0.5");
                void Charge(double a, double b) { Set(chip, host, 2, "Charge", a); Set(chip, host, 3, "Charge", b); Tick(chip); }
                Charge(90, 60);
                check(chip.Stationeers.TakeWrites().Any(w => w.@ref == 4 && w.lt == host.enums!["LogicType"]["On"] && w.value == 1), $"templates power/{theme}: Auto On below 0.1");
                Charge(300, 300);
                check(chip.Stationeers.TakeWrites().Length == 0, $"templates power/{theme}: Auto holds between edges");
                Charge(600, 600);
                check(chip.Stationeers.TakeWrites().Any(w => w.@ref == 4 && w.value == 0), $"templates power/{theme}: Auto Off above 0.25");
                Click(chip, "og1_o1");
                check(chip.Stationeers.TakeWrites().Any(w => w.@ref == 4 && w.value == 1) && Frame(chip).Text.Any(t => t.Text == "Generators: on"), $"templates power/{theme}: On override and visible log");
                Click(chip, "og1_o2");
                check(chip.Stationeers.TakeWrites().Any(w => w.@ref == 4 && w.value == 0), $"templates power/{theme}: Off override");
                Click(chip, "og1_o0"); Near("S", "og1_sel", 0);
            }
            if (id == "airlock")
            {
                check(labels.Contains("101.3"), $"templates airlock/{theme}: room pressure displayed");
                Airlock(check, stem, theme, pages);
            }
            if (id == "needle-gauge")
            {
                foreach (var (pressure, x, y) in new[] { (50.0, 240.0, 120.0), (0.0, 110.0, 250.0), (100.0, 370.0, 250.0), (150.0, 370.0, 250.0) })
                {
                    Set(chip, host, 2, "Pressure", pressure); Tick(chip);
                    var frame = Frame(chip);
                    var span = frame.Spans.Single(s => s.Node == 5 && frame.Elements[s.Element].Id == "scene");
                    var positions = Enumerable.Range(span.First, span.Count).Select(i => (x: frame.Positions[i * 2], y: frame.Positions[i * 2 + 1])).ToArray();
                    var minX = positions.Min(p => p.x); var maxX = positions.Max(p => p.x);
                    var minY = positions.Min(p => p.y); var maxY = positions.Max(p => p.y);
                    var endX = pressure == 0 ? minX : pressure >= 100 ? maxX : (minX + maxX) / 2;
                    var endY = pressure == 50 ? minY : (minY + maxY) / 2;
                    const double scale = 460.0 / 480, tolerance = 4.0 / 2 * scale + 2;
                    check(span.Count > 0 && Math.Abs(endX - x * scale) <= tolerance && Math.Abs(endY - y * scale) <= tolerance, $"templates needle-gauge/{theme}: Pressure {pressure} needle endpoint ({x},{y})");
                    check(frame.Problems.Length == 0 && frame.Text.Any(t => t.Text == pressure.ToString("F0", CultureInfo.InvariantCulture)), $"templates needle-gauge/{theme}: Pressure {pressure} displayed without diagnostics");
                }
                Set(chip, host, 2, "Pressure", -1); Tick(chip);
                var hidden = Frame(chip);
                check(!hidden.Spans.Any(s => s.Node == 5 && hidden.Elements[s.Element].Id == "scene" && s.Count > 0) && hidden.Text.Any(t => t.Text == "--"), $"templates needle-gauge/{theme}: missing reading hides needle and displays --");
            }
            if (id.StartsWith("power-wall")) PowerWall(check, chip, host, id, theme);
            if (id == "hydro-farm") HydroFarm(check, chip, host, theme);
            if (id == "hydro-farm")
            {
                chip.Screens.QueueVisit("p3"); Tick(chip);
                Click(chip, "btn27_hit", "page3");
                check(Page(chip) == "vb_devices", $"templates {id}/{theme}: Devices button on Settings opens generated page");
            }
            else if (id != "blank")
            {
                Click(chip, id == "airlock" ? "btn4_hit" : id.StartsWith("power-wall") ? "btn2_hit" : "btn1_hit");
                check(Page(chip) == "vb_devices", $"templates {id}/{theme}: Devices button opens generated page");
            }
            check(chip.State == ChipState.Running && chip.Screens.LostWrites.Count == 0, $"templates {id}/{theme}: runs without lost writes");
        }
        check(rendered == expected.Length, $"templates: rendered {rendered}/{expected.Length} starter/theme cases");
    }

    static bool Wrote(HostJson host, DeviceWrite[] ws, int r, string type, double v) => ws.Any(w => w.@ref == r && w.lt == host.enums!["LogicType"][type] && w.value == v);
    static string Text(ChipRunner c, string name) => Table(c, "X")[name] is { Type: LuaValueType.String } v ? v.Read<string>() : "";

    // The Power wall starters (docs/templates-power-farm.md), with the simulated network: batteries 2 and 3, the generator 4,
    // solar panels 5 and 6 (both tracked), the daylight sensor 7 and the GeneratorsVent 8.
    static void PowerWall(Action<bool, string> check, ChipRunner chip, HostJson host, string id, string theme)
    {
        var labels = Frame(chip).Text.Select(t => t.Text).ToArray();
        check(new[] { "50", "6.3 MJ", "12.6 MJ", "Discharging", "Generator 1" }.All(labels.Contains), $"templates {id}/{theme}: storage, generator and status labels ({string.Join("|", labels.Take(40))})");
        check(Text(chip, "netKw") == "\u22126.5" && Text(chip, "timeLeft") == "16.0 min", $"templates {id}/{theme}: net with a true minus and time left in minutes ({Text(chip, "netKw")} / {Text(chip, "timeLeft")})");
        // Logic Extended's numbered types, simulated: TimeOfDay 0.3 of a 1200 s day, the dual panel's damage 0.2.
        check(Text(chip, "sunAngle") == "72°" && Text(chip, "sunset") == "4.0 min" && Text(chip, "alertMsg") == "1 dual panel damaged"
              && Table(chip, "X")["solarEff"].Read<LuaTable>()[1].Read<string>() == "97",
              $"templates {id}/{theme}: the sun, efficiency and damage from Logic Extended's numbered types ({Text(chip, "sunAngle")}, {Text(chip, "sunset")}, {Text(chip, "alertMsg")})");
        chip.Stationeers.TakeWrites(); Tick(chip);
        check(chip.Stationeers.TakeWrites().Length == 0, $"templates {id}/{theme}: Auto holds at 0.5 and tracking matches the sensor");
        Set(chip, host, 2, "Charge", 100000); Set(chip, host, 3, "Charge", 100000); Tick(chip);
        var ws = chip.Stationeers.TakeWrites();
        check(Wrote(host, ws, 4, "On", 1) && Wrote(host, ws, 8, "On", 1), $"templates {id}/{theme}: Auto runs the generator and its vent below 0.1");
        Click(chip, "og1_o2");
        ws = chip.Stationeers.TakeWrites();
        check(Wrote(host, ws, 4, "On", 0) && Wrote(host, ws, 8, "On", 0), $"templates {id}/{theme}: Off stops the generator and its vent");
        Click(chip, "btn1_hit");
        ws = chip.Stationeers.TakeWrites();
        labels = Frame(chip).Text.Select(t => t.Text).ToArray();
        check(Wrote(host, ws, 5, "Vertical", 90) && Wrote(host, ws, 6, "Vertical", 90) && labels.Contains("RESUME TRACKING") && Number(chip, "X", "nwarn") == 2,
              $"templates {id}/{theme}: Park lays the tracked panels flat and counts its alert beside the damage one");
        Click(chip, "og1_o0"); Click(chip, "btn1_hit");
    }

    // The Hydro farm starter, with the simulated network: the Larre dock 2, the export bin 3, grow lights 4 and 5.
    static void HydroFarm(Action<bool, string> check, ChipRunner chip, HostJson host, string theme)
    {
        var ws = chip.Stationeers.TakeWrites();
        check(Wrote(host, ws, 2, "Setting", 2), $"templates hydro-farm/{theme}: the harvester sends the Larre to the first pot");
        var fade = Table(chip, "X")["potFade"].Read<LuaTable>();
        check(fade[1].Read<double>() == 0.65 && fade[90].Read<double>() == 0.65, $"templates hydro-farm/{theme}: pots not visited this pass are faded to 35 %");
        check(Text(chip, "phase") == "Day" && Text(chip, "plantName") == "Potato" && Text(chip, "pot") == "1 of 90", $"templates hydro-farm/{theme}: light day, plant and pot ({Text(chip, "phase")}, {Text(chip, "plantName")}, {Text(chip, "pot")})");
        Tick(chip);
        check(!chip.Stationeers.TakeWrites().Any(w => w.@ref == 4 || w.@ref == 5 || w.@ref == 3), $"templates hydro-farm/{theme}: lit lights and an open empty bin are left as they are");
        Click(chip, "og1_o2");
        ws = chip.Stationeers.TakeWrites();
        check(Wrote(host, ws, 4, "On", 0) && Wrote(host, ws, 5, "On", 0), $"templates hydro-farm/{theme}: Lights Off turns the grow lights off");
        Click(chip, "og1_o0");
        Click(chip, "btn1_hit");
        check(Text(chip, "phase") == "Night", $"templates hydro-farm/{theme}: Skip to night ends the light phase");
        ws = chip.Stationeers.TakeWrites();
        check(Wrote(host, ws, 4, "On", 0), $"templates hydro-farm/{theme}: Auto follows the night");
        Click(chip, "btn3_hit");
        check(Page(chip) == "p2", $"templates hydro-farm/{theme}: the plant tile opens the picker");
        Click(chip, "btn12_hit", "page2");
        check(Page(chip) == "p1" && Number(chip, "S", "plant") == 5 && Text(chip, "plantName") == "Corn", $"templates hydro-farm/{theme}: picking Corn returns to the main page");
        Click(chip, "btn5_hit");
        check(Table(chip, "S")["paused"].Read<bool>(), $"templates hydro-farm/{theme}: Pause");
        Click(chip, "btn5_hit");
        Click(chip, "btn2_hit");
        check(Page(chip) == "p3", $"templates hydro-farm/{theme}: Settings opens");
        Click(chip, "btn26_hit", "page3");
        check(Page(chip) == "p1", $"templates hydro-farm/{theme}: Back returns from Settings");
    }

    // The Airlock starter's door handling, on the generated export with simulated doors (inner ref 2, outer ref 3). The fake host
    // stores a write and reads it straight back; a door's travel is simulated by its Idle source and by writing what it reads.
    const int Inner = 2, Outer = 3;
    static void Airlock(Action<bool, string> check, string stem, string theme, TemplatePage[] pages)
    {
        var text = File.ReadAllText(stem + ".host.json");
        var lt = JsonNode.Parse(text)!["enums"]!["LogicType"]!.AsObject().ToDictionary(p => p.Key, p => (int)p.Value!);
        string name(int n) => lt.First(p => p.Value == n).Key;
        // A fresh chip on the fixture's network, each door's values replaced (null removes the door from the network).
        ChipRunner Boot(Dictionary<string, double>? inner, Dictionary<string, double>? outer, string? innerLabel = null, string? outerLabel = null)
        {
            var node = JsonNode.Parse(text)!;
            var devices = node["devices"]!.AsArray();
            foreach (var (r, values) in new[] { (Inner, inner), (Outer, outer) })
            {
                var d = devices.Single(x => (int)x!["ref"]! == r)!;
                if (values == null) { devices.Remove(d); continue; }
                foreach (var (k, v) in values) d["values"]![lt[k].ToString(CultureInfo.InvariantCulture)] = new JsonObject { ["kind"] = "const", ["v"] = v };
                if ((r == Inner ? innerLabel : outerLabel) is { } label) d["name"] = label;
            }
            var host = HostJson.Parse(node.ToJsonString(), out var error);
            check(error == null, $"templates airlock/{theme}: edited host parses {error}");
            var chip = new ChipRunner(host: host);
            chip.Screens.Size = (pages[0].w, pages[0].h);
            foreach (var pg in pages) chip.Screens.Sizes[pg.surface] = (pg.w, pg.h);
            chip.LoadAsync(File.ReadAllText(stem + ".lua")).GetAwaiter().GetResult();
            check(chip.State == ChipState.Running, $"templates airlock/{theme}: edited network loads {chip.Error}");
            return chip;
        }
        Dictionary<string, double> Door(double open, double setting = double.NaN, double mode = 1, double lockv = 0, double idle = 1) =>
            new() { ["Open"] = open, ["Setting"] = double.IsNaN(setting) ? open : setting, ["Mode"] = mode, ["Lock"] = lockv, ["Idle"] = idle, ["On"] = 1 };
        void Poke(ChipRunner c, int r, string type, double v) { c.LoadAsync($"ic.write_id({r}, ic.enums.LogicType.{type}, {v.ToString(CultureInfo.InvariantCulture)})").GetAwaiter().GetResult(); c.Stationeers.TakeWrites(); }
        void Idle(ChipRunner c, int r, double v) => c.Stationeers.Sim(new SimJson(new() { [r.ToString(CultureInfo.InvariantCulture)] = new() { [lt["Idle"].ToString(CultureInfo.InvariantCulture)] = new SourceJson("const", v) } }));
        bool Wrote(DeviceWrite[] ws, int r, string type, double v) => ws.Any(w => w.@ref == r && w.lt == lt[type] && w.value == v);
        string Show(DeviceWrite[] ws) => string.Join(" ", ws.Select(w => $"{w.@ref}.{name(w.lt)}={w.value}"));
        double Want(ChipRunner c) => Table(c, "S")["want"] is { Type: LuaValueType.Number } v ? v.Read<double>() : double.NaN;
        void Main(ChipRunner c) { c.Screens.QueueVisit("p1"); Tick(c); }

        // 1, 3, 4: the first tick puts both doors in Logic mode and unlocks them; boot moves neither door, and a door's
        // Setting is adopted from its Open (a mismatch left by anything else is not a request).
        var c = Boot(Door(0, setting: 1, mode: 0, lockv: 1), Door(0, mode: 0, lockv: 1));
        Tick(c);
        var ws = c.Stationeers.TakeWrites();
        check(Wrote(ws, Inner, "Mode", 1) && Wrote(ws, Outer, "Mode", 1), $"templates airlock/{theme}: Logic mode written to both doors ({Show(ws)})");
        check(Wrote(ws, Inner, "Lock", 0) && Wrote(ws, Outer, "Lock", 0), $"templates airlock/{theme}: Lock 0 written to both doors ({Show(ws)})");
        check(Wrote(ws, Inner, "Setting", 0) && !ws.Any(w => w.lt == lt["Open"]) && Want(c) == 0,
              $"templates airlock/{theme}: boot adopts each door's Setting from its Open and asks for nothing ({Show(ws)})");
        c = Boot(Door(1), Door(0));
        Tick(c); Tick(c);
        ws = c.Stationeers.TakeWrites();
        check(!ws.Any(w => w.lt == lt["Open"] || w.lt == lt["Setting"]) && Want(c) == 1, $"templates airlock/{theme}: an open door stays open at boot with no saved state ({Show(ws)})");
        c = Boot(Door(1), Door(1));
        Tick(c);
        ws = c.Stationeers.TakeWrites();
        check(Wrote(ws, Inner, "Open", 0) && !Wrote(ws, Outer, "Open", 0) && Want(c) == 2, $"templates airlock/{theme}: both doors found open, the inner one is shut ({Show(ws)})");

        // 2, 5: the opposite door is commanded shut (Open and Setting together); the selected one opens only once the other reads shut
        // and settled, and the travel time since its command has passed. A mismatch while a door moves is not a request.
        c = Boot(Door(0), Door(1));
        Tick(c); c.Stationeers.TakeWrites();
        Click(c, "btn1_hit");
        ws = c.Stationeers.TakeWrites();
        check(Wrote(ws, Outer, "Open", 0) && Wrote(ws, Outer, "Setting", 0) && !Wrote(ws, Inner, "Open", 1), $"templates airlock/{theme}: the far door is commanded shut through Open and Setting ({Show(ws)})");
        Idle(c, Outer, 0);
        Poke(c, Outer, "Setting", 1);   // what a press on a moving door would leave
        Tick(c);
        ws = c.Stationeers.TakeWrites();
        check(!Wrote(ws, Inner, "Open", 1) && Want(c) == 1, $"templates airlock/{theme}: nothing opens while the far door moves, and its mismatch is no request ({Show(ws)})");
        Tick(c);
        check(!Wrote(c.Stationeers.TakeWrites(), Inner, "Open", 1), $"templates airlock/{theme}: still moving at 1.0 s");
        Idle(c, Outer, 1);
        Tick(c);
        ws = c.Stationeers.TakeWrites();
        check(Wrote(ws, Inner, "Open", 1) && Wrote(ws, Inner, "Setting", 1), $"templates airlock/{theme}: the door opens, Open and Setting, once the far one is shut, settled and 1.5 s on ({Show(ws)})");
        c = Boot(Door(0), Door(1));
        Tick(c); c.Stationeers.TakeWrites();
        Click(c, "btn1_hit"); c.Stationeers.TakeWrites();
        Tick(c); Tick(c);
        var early = c.Stationeers.TakeWrites();
        Tick(c);
        ws = c.Stationeers.TakeWrites();
        check(!Wrote(early, Inner, "Open", 1) && Wrote(ws, Inner, "Open", 1), $"templates airlock/{theme}: a door that shuts at once still waits the travel time ({Show(early)} / {Show(ws)})");
        Click(c, "btn3_hit");
        ws = c.Stationeers.TakeWrites();
        check(Wrote(ws, Inner, "Open", 0) && Wrote(ws, Inner, "Setting", 0) && Want(c) == 0, $"templates airlock/{theme}: Close both ({Show(ws)})");

        // A door's own button: Setting differing from Open on a settled door is a request.
        c = Boot(Door(0), Door(0));
        Tick(c); c.Stationeers.TakeWrites();
        Poke(c, Outer, "Setting", 1);
        Tick(c);
        ws = c.Stationeers.TakeWrites();
        check(Want(c) == 2 && Wrote(ws, Outer, "Open", 1) && !Wrote(ws, Outer, "Setting", 0), $"templates airlock/{theme}: a press on a shut door opens it ({Show(ws)})");
        Poke(c, Outer, "Setting", 0);
        Tick(c);
        ws = c.Stationeers.TakeWrites();
        check(Want(c) == 0 && Wrote(ws, Outer, "Open", 0), $"templates airlock/{theme}: a press on the open door shuts it ({Show(ws)})");

        // 6: with the opposite door unbound, the door it guards still opens: a second airlock that carries neither label leaves
        // the outer role with two candidates and no device; then with the inner door the only airlock on the network.
        c = Boot(Door(0), Door(0), outerLabel: "Spare");
        Main(c); c.Stationeers.TakeWrites();
        Click(c, "btn1_hit");
        ws = c.Stationeers.TakeWrites();
        check(Table(c, "R")["outer"].Read<LuaTable>()["n"].Read<double>() == 0 && Wrote(ws, Inner, "Open", 1), $"templates airlock/{theme}: the inner door opens with the outer role unresolved ({Show(ws)})");
        c = Boot(Door(0), null);
        Main(c); c.Stationeers.TakeWrites();
        Click(c, "btn1_hit");
        ws = c.Stationeers.TakeWrites();
        check(Wrote(ws, Inner, "Open", 1), $"templates airlock/{theme}: the inner door opens with the outer door unbound ({Show(ws)})");

        // 7: one airlock on the network serves one door role, never both.
        c = Boot(Door(0), null);
        var roles = Table(c, "R");
        check(roles["inner"].Read<LuaTable>()["n"].Read<double>() == 1 && roles["outer"].Read<LuaTable>()["n"].Read<double>() == 0,
              $"templates airlock/{theme}: the lone labelled airlock is the inner door only");
        c = Boot(Door(0), null, innerLabel: "");
        roles = Table(c, "R");
        check(roles["inner"].Read<LuaTable>()["n"].Read<double>() == 0 && roles["outer"].Read<LuaTable>()["n"].Read<double>() == 0,
              $"templates airlock/{theme}: a lone unlabelled airlock is bound to neither door role");
        check(c.State == ChipState.Running && c.Screens.LostWrites.Count == 0, $"templates airlock/{theme}: door checks run without lost writes");
    }
}
