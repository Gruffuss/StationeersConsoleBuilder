using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using VectorBuilder.Core;

/// <summary>The runtime library (web/src/codegen/runtime.lua) under the fake host: each check loads the library, a small VB.cfg
/// and VB.boot(), then ticks, clicks, visits, and reads the chip's Lua state, its stores and its elements.</summary>
static class RuntimeTests
{
    static void Icons(Action<bool, string> check)
    {
        var icons = File.ReadAllText(Path.Combine(Fixtures.Root, "..", "src", "catalog", "icons.json"));
        var host = Host("", ", \"icons\": " + icons);
        var c = Chip(Cfg(), host);
        check(Eval(c, "type(ss.ui.icons)") == "table", "icons: the fake host installs the catalogue tables");
        string Native(string name, string bind = "") => $$"""
            { uid = "ico", type = "icon", x = 10, y = 10, w = 20, h = 20, props = { icon_type = "gas", name = "{{name}}" }, style = {} {{bind}} }
            """;
        foreach (var (name, want) in new[] { ("Oxygen", "gas:Oxygen"), ("CO2", "gas:CarbonDioxide"), ("Unknown", "Unknown"), ("gas:Oxygen", "gas:Oxygen") })
        {
            c = Chip(Cfg(pages: Page("p1", "main", natives: Native(name))), host);
            check((string)El(c, "main", "ico").Props["name"] == want && (string)El(c, "main", "ico").Props["icon_type"] == "gas", $"icons: {name} resolves to {want}");
        }
        c = Chip(Cfg(pages: Page("p1", "main", natives: Native("GasOxygen").Replace("icon_type = \"gas\"", "icon_type = \"prefab\""))), host);
        check((string)El(c, "main", "ico").Props["icon_type"] == "gas" && (string)El(c, "main", "ico").Props["name"] == "gas:Oxygen", "icons: a prefab gas entry sends its resolved gas type");
        c = Chip(Cfg(pages: Page("p1", "main", natives: Native("Unknown").Replace("icon_type = \"gas\"", "icon_type = \"prefab\""))), host);
        check((string)El(c, "main", "ico").Props["icon_type"] == "prefab" && (string)El(c, "main", "ico").Props["name"] == "Unknown", "icons: raw unknown prefab names retain the widget type");
        foreach (var absent in new[] { "ss.ui.icons = nil", "ss.ui.icons = false", "ss.ui.icons = { gas = false }" })
        {
            c = Chip(Cfg(pages: Page("p1", "main", natives: Native("Oxygen"))), host, absent);
            check((string)El(c, "main", "ico").Props["name"] == "Oxygen", $"icons: raw fallback with {absent}");
        }
        c = Chip(Cfg(pages: Page("p1", "main", natives: Native(""))), host);
        check((double)El(c, "main", "ico").Rect!["x"] == -10000, "icons: an empty name stays parked");
        c = Chip(Cfg(pages: Page("p1", "main", natives: Native("", ", bind = { name = function() return X.item end }"))), host, "X.item = 'Oxygen'");
        check((string)El(c, "main", "ico").Props["name"] == "gas:Oxygen", "icons: bound names resolve at boot");
        var upserts = El(c, "main", "ico").Upserts;
        Ticks(c, 2);
        check(El(c, "main", "ico").Upserts == upserts, "icons: a resolved bound name does not re-declare while unchanged");
        c.LoadAsync("X.item = 'CO2'").Wait();
        Ticks(c);
        check((string)El(c, "main", "ico").Props["name"] == "gas:CarbonDioxide", "icons: changed bound names resolve again");
        c.LoadAsync("X.item = ''").Wait();
        Ticks(c);
        check((double)El(c, "main", "ico").Rect!["x"] == -10000, "icons: a bound name parks when cleared");
    }
    static readonly string Lib = File.ReadAllText(Path.Combine(Fixtures.Root, "..", "src", "codegen", "runtime.lua"));
    const string Enums = """
        "enums": { "LogicType": { "Pressure": 1, "Temperature": 2, "On": 3, "Setting": 4, "Activate": 5, "PrefabHash": 6, "ReferenceId": 7, "NameHash": 8 },
                   "LogicSlotType": { "Quantity": 1 }, "LogicBatchMethod": { "Average": 0, "Sum": 1, "Minimum": 2, "Maximum": 3, "Count": 4 } }
        """;
    static string F(double v) => v.ToString(CultureInfo.InvariantCulture);
    static int Key(string s) => FakeStationeersLua.Hash(s);

    static HostJson Host(string devices, string extra = "")
    {
        var h = HostJson.Parse("{" + Enums + ", \"devices\": [" + devices + "]" + extra + "}", out var error);
        return error == null ? h : throw new InvalidOperationException(error);
    }
    // Pressure R (a constant), Temperature R, On RW, Setting RW, Activate W, the identity types R; slot 0 exposes Quantity.
    static string Dev(long id, string name, double p = 0, int prefab = 100, string extra = "") => $$"""
        { "ref": {{id}}, "prefab": {{prefab}}, "prefabName": "P{{prefab}}", "name": "{{name}}",
          "logic": { "1": "R", "2": "R", "3": "RW", "4": "RW", "5": "W", "6": "R", "7": "R", "8": "R" }, "slots": 1, "slotLogic": { "1": [0] },
          "values": { "1": { "kind": "const", "v": {{F(p)}} } } {{extra}} }
        """;
    static string Mem(params (int At, double V)[] cells)
    {
        var m = new double[512];
        foreach (var (at, v) in cells)
            m[at] = v;
        return ", \"memory\": [" + string.Join(",", m.Select(F)) + "]";
    }

    static string Role(string id, string prefabs = "{ 100 }", string? label = null, bool all = false, string more = "") =>
        $$"""{ id = "{{id}}", name = "{{id}}", prefabs = {{prefabs}}, label = {{(label == null ? "nil" : "\"" + label + "\"")}}, all = {{(all ? "true" : "false")}}, key = {{Key("r:" + id)}}{{more}} }""";
    static string State(string name, string type, string init, string more = "") =>
        $$"""{ name = "{{name}}", type = "{{type}}", init = {{init}}, save = true, key = {{Key("s:" + name)}}{{more}} }""";
    static string Page(string id, string surface, string data = "", string snap = "", string nils = "", string natives = "") =>
        $$"""{ id = "{{id}}", surface = "{{surface}}", bg = { bg = "#000000" }, src = "SCENE w=100 h=100\n", snap = { {{snap}} }, samples = {}, nils = { {{nils}} }, data = function(o) {{data}} end, natives = { {{natives}} }, empty = false, w = 100, h = 100, dw = 100, dh = 100, fit = "contain" }""";
    const string Devices = """
        { id = "vb_devices", surface = "vb_devices", bg = { bg = "#000000" }, src = "SCENE w=100 h=100\n", rows = 2,
          keys = { n = "vbdev_n", name = "vbdev_name", v = "vbdev_v", st = "vbdev_st", pg = "vbdev_pg", msg = "vbdev_msg" },
          ids = { row = "vbdev_r", save = "vbsave_hit", scan = "vbscan_hit", back = "vbback_hit", prev = "vbprev_hit", next = "vbnext_hit" },
          snap = { vbdev_n = true, vbdev_name = true, vbdev_v = true, vbdev_st = true, vbdev_pg = true, vbdev_msg = true }, samples = {},
          nils = { vbdev_name = { "" }, vbdev_v = { "" }, vbdev_st = { 0 } }, natives = {}, empty = false, w = 100, h = 100, dw = 100, dh = 100, fit = "contain" }
        """;
    static string Cfg(string roles = "", string reads = "", string state = "", string acts = "", string rules = "", string? pages = null, string devices = "nil") => $$"""
        VB.cfg = { lib = 1, floor = 11118, start = 1, logKeep = 3, memLow = 256, magic = {{Key("vectorbuilder-mirror-1")}},
          roles = { {{roles}} }, reads = { {{reads}} }, state = { {{state}} }, acts = { {{acts}} }, rules = { {{rules}} },
          pages = { {{pages ?? Page("p1", "main")}} }, devices = {{devices}} }
        """;

    static readonly List<ChipRunner> Made = new();   // every chip below: none may lose a write to the flush rule (checked last)
    static ChipRunner Chip(string cfg, HostJson host, string custom = "", int tickBudget = 50_000)
    {
        var c = new ChipRunner(host: host, tickBudget: tickBudget);
        Made.Add(c);
        c.LoadAsync(Lib + "\n" + cfg + "\n" + custom + "\nVB.boot()\nfunction tick(dt) VB.tick(dt) end\n").Wait();
        return c;
    }
    static string Eval(ChipRunner c, string expr)
    {
        c.LoadAsync("print(" + expr + ")").Wait();
        return c.State == ChipState.Running ? c.Output.Last() : "halted: " + c.Error;
    }
    static void Ticks(ChipRunner c, int n = 1)
    {
        for (var i = 0; i < n; i++)
            c.TickAsync().Wait();
    }
    static void Click(ChipRunner c, string value, string surface = "main", string element = "scene") => c.Screens.Enqueue(surface, element, "click", value);
    static void Set(ChipRunner c, long id, int lt, double v) =>
        c.Stationeers.Sim(new SimJson(new() { [id.ToString(CultureInfo.InvariantCulture)] = new() { [lt.ToString(CultureInfo.InvariantCulture)] = new SourceJson("const", v) } }));
    static ElementRecord El(ChipRunner c, string surface, string id) => c.Screens.ElementsOf(surface).Single(e => e.Id == id);
    static Dictionary<string, object>? DataOf(ChipRunner c, string surface, string id = "data") => El(c, surface, id).Props.GetValueOrDefault("data") as Dictionary<string, object>;

    public static void Run(Action<bool, string> check)
    {
        Icons(check);
        RepeaterValues(check);
        var quiet = Chip(Cfg(pages: Page("p1", "main", "o.v = X.v o.raw = X.raw o.history = { VB.n } o.counter = VB.n o.text = tostring(VB.n)")
            .Replace("samples = {}", "samples = {}, eased = { v = 0.005, raw = 0 }")), Host(""), "X.v = 0.5 X.raw = 100");
        var easeCount = El(quiet, "main", "ease").Upserts;
        quiet.LoadAsync("X.v = 0.5001 X.raw = 100.0000001").Wait();
        Ticks(quiet);
        check(El(quiet, "main", "ease").Upserts == easeCount && DataOf(quiet, "main")!.ContainsKey("history")
              && DataOf(quiet, "main")!.ContainsKey("counter") && DataOf(quiet, "main")!.ContainsKey("text"),
              "runtime: subpixel motion and equal float32 raw geometry do not ease; history, counters and text snap");
        quiet.LoadAsync("X.v = 0.51 X.raw = 100.001").Wait();
        Ticks(quiet);
        check(El(quiet, "main", "ease").Upserts == easeCount + 1 && (double)DataOf(quiet, "main", "ease")!["v"] == 0.51,
              "runtime: cumulative drift compares with the last sent value and visible raw motion still eases");
        quiet.LoadAsync("X.v = 'text' X.raw = { 1, 2 }").Wait();
        Ticks(quiet);
        check(DataOf(quiet, "main")?.GetValueOrDefault("v") as string == "text" && DataOf(quiet, "main")?.GetValueOrDefault("raw") is List<object>,
              "runtime: a geometry binding that becomes text or an array switches to snap");
        var bars = Chip(Cfg(pages: Page("p1", "main", "o.levels = { X.v, 0.3 }")
            .Replace("samples = {}", "samples = {}, eased = { levels = 0.005 }, arrays = { levels = true }")), Host(""), "X.v = 0.5");
        check(DataOf(bars, "main", "ease")?.ContainsKey("levels") == true,
              "runtime: arrays of moving Bar levels keep their eased carrier");
        var barCount = El(bars, "main", "ease").Upserts;
        bars.LoadAsync("X.v = 0.5001").Wait(); Ticks(bars);
        check(El(bars, "main", "ease").Upserts == barCount, "runtime: subpixel Bar-array changes are suppressed");
        bars.LoadAsync("X.v = 0.51").Wait(); Ticks(bars);
        check(El(bars, "main", "ease").Upserts == barCount + 1, "runtime: visible Bar-array drift still eases");
        var only = Chip(Cfg(roles: Role("sensor"), devices: Devices), Host(Dev(13628, "Gas Sensor")));
        only.Screens.QueueVisit("vb_devices"); Ticks(only);
        Click(only, "vbdev_r:0", "vb_devices"); Ticks(only);
        check(Eval(only, "VB.rk.sensor.pick, R.sensor.refs[1]") == "false\t13628",
              "runtime: the only auto-resolved candidate cycles to explicit auto on the first tap");
        Click(only, "vbsave_hit", "vb_devices"); Ticks(only);
        check(only.Stationeers.Persist.GetValueOrDefault("vb:r:sensor") == "",
              "runtime: SAVE of the only candidate's explicit auto stores no identity");
        Click(only, "vbdev_r:0", "vb_devices"); Ticks(only);
        check(Eval(only, "VB.rk.sensor.pick") == "false",
              "runtime: SAVE resets the transient pick, so cycling starts from the auto-resolved device again");
        Click(only, "vbdev_r:0", "vb_devices"); Ticks(only);
        Click(only, "vbsave_hit", "vb_devices"); Ticks(only);
        check(only.Stationeers.Persist.GetValueOrDefault("vb:r:sensor") == "13628|Gas Sensor",
              "runtime: two taps without SAVE between explicitly pick the only candidate and SAVE stores its identity");
        CoreLows(check);
        var two = Host(Dev(11, "N2 tank", 50) + "," + Dev(12, "O2 tank", 80));
        const string ReadP = """{ id = "p", role = 1, lt = "Pressure" }""";

        var offline = Chip(Cfg(roles: Role("tank"), devices: Devices), Host("", """, "persist":{"vb:r:tank":"11|N2 tank"}"""));
        Click(offline, "vbsave_hit", "vb_devices");
        Ticks(offline);
        check(offline.Stationeers.Persist.GetValueOrDefault("vb:r:tank") == "11|N2 tank"
              && Eval(offline, "VB.rk.tank.saved.ref") == "11" && offline.Stationeers.Memory[507] == 11,
              "runtime: SAVE preserves an offline role's saved pick in persist and the mirror");
        var autoCfg = Cfg(roles: Role("tank"), devices: Devices);
        var unlabelledPair = Dev(11, "") + "," + Dev(12, "");
        var automaticPick = Chip(autoCfg, Host(unlabelledPair, """, "persist":{"vb:r:tank":"11|"}"""
            + Mem((511, Key("vectorbuilder-mirror-1")), (510, 1), (509, Key("r:tank")), (508, 1), (507, 11), (506, 0))));
        automaticPick.Screens.QueueVisit("vb_devices"); Ticks(automaticPick);
        Click(automaticPick, "vbdev_r:0", "vb_devices"); Ticks(automaticPick);
        Click(automaticPick, "vbdev_r:0", "vb_devices"); Ticks(automaticPick);
        check(Eval(automaticPick, "VB.rk.tank.pick, R.tank.n") == "false\t0",
              "runtime: cycling two unlabelled candidates reaches unresolved auto");
        Click(automaticPick, "vbsave_hit", "vb_devices"); Ticks(automaticPick);
        check(automaticPick.Stationeers.Persist.GetValueOrDefault("vb:r:tank") == ""
              && Eval(automaticPick, "VB.rk.tank.saved == nil") == "true" && automaticPick.Stationeers.Memory[510] == 0,
              "runtime: SAVE of explicit auto clears the saved choice in persist and the mirror");
        foreach (var store in new[] { "persist", "mirror" })
        {
            var rebootAuto = Chip(autoCfg, Host(unlabelledPair) with {
                persist = store == "persist" ? new(automaticPick.Stationeers.Persist) : null,
                memory = store == "mirror" ? (double[])automaticPick.Stationeers.Memory.Clone() : null });
            check(Eval(rebootAuto, "R.tank.n, VB.rk.tank.saved == nil") == "0\ttrue" && rebootAuto.Screens.ActiveSurface == "vb_devices",
                  $"runtime: auto stays unresolved after a {store} reboot");
        }
        var labelledAuto = Chip(Cfg(roles: Role("tank", label: "B"), devices: Devices),
            Host(Dev(11, "A") + "," + Dev(12, "B"), """, "persist":{"vb:r:tank":"11|A"}"""));
        labelledAuto.Screens.QueueVisit("vb_devices"); Ticks(labelledAuto);
        Click(labelledAuto, "vbdev_r:0", "vb_devices"); Ticks(labelledAuto);
        Click(labelledAuto, "vbdev_r:0", "vb_devices"); Ticks(labelledAuto);
        check(Eval(labelledAuto, "VB.rk.tank.pick, R.tank.refs[1]") == "false\t12",
              "runtime: explicit auto can still resolve the role's default label");
        Click(labelledAuto, "vbsave_hit", "vb_devices"); Ticks(labelledAuto);
        check(labelledAuto.Stationeers.Persist.GetValueOrDefault("vb:r:tank") == "" && labelledAuto.Stationeers.Memory[510] == 0,
              "runtime: resolved auto saves no identity either");
        var full = Chip(Cfg(state: State("n", "number", "1"), devices: Devices).Replace("memLow = 256", "memLow = 509"), Host(""));
        full.Screens.QueueVisit("vb_devices");
        Ticks(full);
        Click(full, "vbsave_hit", "vb_devices");
        Ticks(full);
        check(Eval(full, "VB.mirrorFull, VB.devMsg()") == "true\tchip memory full: mirror not saved"
              && !full.Stationeers.MemoryChanged && (string)DataOf(full, "vb_devices")!["vbdev_msg"] == "chip memory full: mirror not saved",
              "runtime: a full mirror skips memory writes and reports it on the Devices page");
        full.LoadAsync("VB.cfg.memLow = 256").Wait();
        Click(full, "vbsave_hit", "vb_devices");
        Ticks(full);
        check(Eval(full, "VB.mirrorFull, VB.devMsg()") == "false\tsaved" && full.Stationeers.MemoryChanged,
              "runtime: a later successful mirror clears the full-memory warning");

        // Fix-round regressions: real chips under the default budgets; the paired larger-budget run measures complete scans.
        ScanBudgets(check);
        const string Row = "(function() local o = {} VB.devData(o) return o.vbdev_name[1], o.vbdev_st[1] end)()";
        foreach (var target in new[] { ", pin = 0", ", pin = 3", ", ref = 99" })
        {
            foreach (var optional in new[] { false, true })
            {
                var missing = Chip(Cfg(roles: Role("gen", "{}", more: target + (optional ? ", optional = true" : "")), devices: Devices), Host(""));
                var actual = Eval(missing, "R.gen.n, R.gen.ok, VB.unbound(), " + Row);
                var expected = optional ? "0\tfalse\t1\tgen: not present\t1" : "0\tfalse\t1\tgen: not found\t3";
                check(actual == expected, $"runtime: missing {target} optional={optional} row agrees with resolution ({actual})");
            }
        }
        foreach (var target in new[] { ", pin = 3", ", ref = 99" })
        {
            var present = Chip(Cfg(roles: Role("gen", "{}", more: target), devices: Devices), Host(Dev(99, "G", extra: ", \"pin\": 3")));
            var actual = Eval(present, "R.gen.n, R.gen.ok, VB.unbound(), " + Row);
            check(actual == (target.Contains("pin") ? "1\ttrue\t0\tgen: d3\t1" : "1\ttrue\t0\tgen: G\t1"),
                  $"runtime: present {target} keeps its target and ok row, naming the device, never its reference id ({actual})");
        }
        foreach (var label in new string?[] { null, "Only" })
        {
            var repeated = Chip(Cfg(roles: Role("tank", "{ 100, 100 }", label), reads: ReadP), Host(Dev(11, "Only", 5)));
            var actual = Eval(repeated, "R.tank.n, R.tank.ok, P.p, R.tank.refs[1], R.tank.names[1]");
            check(actual == "1\ttrue\t5\t11\tOnly", $"runtime: repeated prefab preserves a unique one candidate label={label ?? "auto"} ({actual})");
        }
        var repeatedAll = Chip(Cfg(roles: Role("all", "{ 100, 200, 100, 200 }", all: true), reads: """
            { id = "s", role = 1, lt = "Pressure", agg = "sum" }, { id = "l", role = 1, lt = "Pressure", agg = "list" }
            """), Host(Dev(11, "B", 10) + "," + Dev(12, "A", 30, prefab: 200)));
        var repeatedValues = Eval(repeatedAll, "R.all.n, P.s, #P.l, P.l[1], P.l[2], table.concat(R.all.refs, ','), table.concat(R.all.names, ',')");
        check(repeatedValues == "2\t40\t2\t30\t10\t12,11\tA,B", $"runtime: repeated prefabs never duplicate all-role reads or published devices ({repeatedValues})");

        // A host may return fresh tables or mutate an existing list: all identity fields invalidate cached order/membership.
        var changing = Chip(Cfg(roles: Role("all", "{ 200, 100 }", all: true) + "," + Role("one", "{ 100 }", label: "A"), devices: Devices), Host(""), """
            X.devices = { { ref_id = 13, prefab_hash = 100, display_name = 'A', name_hash = 1 },
                          { ref_id = 11, prefab_hash = 200, display_name = 'B', name_hash = 2 },
                          { ref_id = 12, prefab_hash = 100, display_name = 'A', name_hash = 1 } }
            ic.device.list = function() return X.devices end
            """);
        Ticks(changing);
        check(Eval(changing, "table.concat(R.all.refs, ','), table.concat(R.all.names, ','), R.one.n") == "12,13,11\tA,A,B\t0",
              "runtime: rescan preserves name then numeric ref order across prefabs and shared-label ambiguity");
        changing.LoadAsync("X.devices[1].display_name = 'Z' X.devices[1].prefab_hash = 300 VB.rescan = true").Wait();
        Ticks(changing);
        check(Eval(changing, "table.concat(R.all.refs, ','), table.concat(R.all.names, ','), R.one.refs[1]") == "12,11\tA,B\t12",
              "runtime: a rename and prefab change update order, membership and one-role resolution");
        changing.LoadAsync("X.devices[3].ref_id = 14 X.devices[3].name_hash = 3 table.remove(X.devices, 2) VB.rescan = true").Wait();
        Ticks(changing);
        check(Eval(changing, "table.concat(R.all.refs, ','), R.one.refs[1]") == "14\t14",
              "runtime: removal, ref and name-hash changes cannot leave stale published devices");
        changing.LoadAsync("X.devices = {} VB.rescan = true").Wait();
        Ticks(changing);
        check(Eval(changing, "R.all.n, R.one.n, VB.unbound()") == "0\t0\t2",
              "runtime: an empty network clears both role kinds");

        var hashChange = Chip(Cfg(roles: Role("one")), Host(""), """
            X.devices = { { ref_id = 11, prefab_hash = 100, display_name = '', name_hash = 1 },
                          { ref_id = 12, prefab_hash = 100, display_name = '', name_hash = 2 } }
            ic.device.list = function() return X.devices end
            """);
        hashChange.LoadAsync("VB.rk.one.saved = { ref = 99, nh = 2 } VB.scan()").Wait();
        check(Eval(hashChange, "R.one.refs[1]") == "12", "runtime: the mirror's unique name hash resolves from cached candidates");
        hashChange.LoadAsync("X.devices[2].name_hash = 1 VB.rescan = true").Wait();
        Ticks(hashChange);
        check(Eval(hashChange, "R.one.n") == "0", "runtime: a name-hash-only change invalidates the mirror's old match");
        hashChange.LoadAsync("ic.device.list = function() error('network unavailable') end VB.rescan = true").Wait();
        Ticks(hashChange);
        hashChange.LoadAsync("ic.device.list = function() return X.devices end X.devices[1].name_hash = 2 VB.rescan = true").Wait();
        Ticks(hashChange);
        check(Eval(hashChange, "R.one.refs[1]") == "11", "runtime: list recovery resolves fresh candidates after a failed scan");

        // a restored state is not evidence that an unresolved required role has a usable pick.
        var unlabelled = Dev(11, "", 5) + "," + Dev(12, "", 9);
        var savedStateCfg = Cfg(roles: Role("tank"), state: State("on", "bool", "false"), devices: Devices);
        foreach (var store in new[] { "persist", "mirror" })
        {
            var stateOnly = store == "persist" ? """, "persist": { "vb:s:on": "1" }"""
                : Mem((511, Key("vectorbuilder-mirror-1")), (510, 1), (509, Key("s:on")), (508, 2), (507, 1));
            var unresolved = Chip(savedStateCfg, Host(unlabelled, stateOnly));
            var restored = Eval(unresolved, "S.on, R.tank.n, page.id");
            check(unresolved.Screens.ActiveSurface == "vb_devices" && restored == "true\t0\tvb_devices"
                  && !unresolved.Stationeers.PersistChanged && !unresolved.Stationeers.MemoryChanged,
                  $"runtime: saved state in {store} never suppresses the Devices page for an unresolved required role ({unresolved.Screens.ActiveSurface}, {restored})");

            var withPick = store == "persist" ? """, "persist": { "vb:s:on": "1", "vb:r:tank": "11|" }"""
                : Mem((511, Key("vectorbuilder-mirror-1")), (510, 2), (509, Key("s:on")), (508, 2), (507, 1),
                      (506, Key("r:tank")), (505, 1), (504, 11), (503, 0));
            var resolved = Chip(savedStateCfg, Host(unlabelled, withPick));
            restored = Eval(resolved, "S.on, R.tank.refs[1], page.id");
            check(resolved.Screens.ActiveSurface == "main" && restored == "true\t11\tp1"
                  && !resolved.Stationeers.PersistChanged && !resolved.Stationeers.MemoryChanged,
                  $"runtime: a saved pick in {store} that still resolves boots on the start page ({resolved.Screens.ActiveSurface}, {restored})");
        }
        var otherPick = Chip(Cfg(roles: Role("tank") + "," + Role("pump", "{ 200 }"), devices: Devices),
            Host(unlabelled + "," + Dev(13, "Pump", prefab: 200), """, "persist": { "vb:r:pump": "13|Pump" }"""));
        check(otherPick.Screens.ActiveSurface == "vb_devices" && Eval(otherPick, "R.tank.n, R.pump.refs[1]") == "0\t13",
              "runtime: another role's saved pick cannot suppress an unresolved required role");
        foreach (var label in new string?[] { null, "Tank" })
        {
            var automatic = Chip(Cfg(roles: Role("tank", label: label), state: State("on", "bool", "false"), devices: Devices),
                Host(Dev(11, "Tank") + (label == null ? "" : "," + Dev(12, "Other")), """, "persist": { "vb:s:on": "1" }"""));
            check(automatic.Screens.ActiveSurface == "main" && Eval(automatic, "R.tank.refs[1], S.on") == "11\ttrue",
                  $"runtime: a role resolved by {(label == null ? "its only candidate" : "its label")} still boots on the start page");
        }

        // Role resolution
        var c = Chip(Cfg(roles: Role("tank", label: "O2 tank"), reads: ReadP), two);
        check(Eval(c, "R.tank.n, VB.rk.tank.devs[1], P.p, T.p") == "1\t12\t80\t1", $"runtime: a one role picks the candidate with its label {c.Error}");
        c = Chip(Cfg(roles: Role("tank"), reads: ReadP), Host(Dev(11, "Only", 5)));
        check(Eval(c, "R.tank.n, P.p") == "1\t5", "runtime: a one role with a single candidate picks it");
        c = Chip(Cfg(roles: Role("tank"), reads: ReadP), two);
        check(Eval(c, "R.tank.n, R.tank.ok, P.p, T.p") == "0\tfalse\tnil\t0", "runtime: several unlabelled candidates leave a one role unresolved, never picked at random");
        c = Chip(Cfg(roles: Role("tank", label: "O2 tank"), reads: ReadP), Host(Dev(11, "N2 tank", 50) + "," + Dev(12, "O2 tank", 80), """, "persist": { "vb:r:tank": "11|N2 tank" }"""));
        check(Eval(c, "VB.rk.tank.devs[1], P.p") == "11\t50", "runtime: the saved choice in persist wins over the label");
        c = Chip(Cfg(roles: Role("tank", label: "O2 tank"), reads: ReadP),
                 Host(Dev(11, "N2 tank", 50) + "," + Dev(12, "O2 tank", 80), Mem((511, Key("vectorbuilder-mirror-1")), (510, 1), (509, Key("r:tank")), (508, 1), (507, 11), (506, 0))));
        check(Eval(c, "VB.rk.tank.devs[1]") == "11", "runtime: with persist wiped (a re-export), the chip-memory mirror restores the choice, keyed by entry");
        c = Chip(Cfg(roles: Role("gen", "{}", more: ", pin = 2") + "," + Role("fix", "{}", more: ", ref = 12"),
                     reads: """{ id = "g", role = 1, lt = "Pressure" }, { id = "f", role = 2, lt = "Pressure" }"""),
                 Host(Dev(11, "X", 7, extra: ", \"pin\": 2") + "," + Dev(12, "Y", 9)));
        check(Eval(c, "R.gen.n, P.g, R.fix.n, P.f, rd('gen', 'Pressure'), rd('fix', 1), rds('gen', 0, 'Quantity')") == "1\t7\t1\t9\t7\t9\t0",
              "runtime: a pin role reads through ic.read, a ref role through ic.read_id; rd and rds take names or numbers");
        check(Eval(c, "R.gen.refs[1], R.gen.names[1], R.fix.refs[1], R.fix.names[1]") == "11\tX\t12\tY",
              "runtime: pin and fixed-ref roles publish resolved ReferenceIds and Labeller names");

        // Distinct roles (two doors of one airlock): no device serves two of them; roles not marked distinct keep the sole-candidate fallback.
        const string Distinct = ", distinct = true";
        const string Rows = "(function() local o = {} VB.devData(o) return table.concat(o.vbdev_name, '|'), table.concat(o.vbdev_st, '|') end)()";
        var lone = Host(Dev(11, "Airlock", 5));
        c = Chip(Cfg(roles: Role("a") + "," + Role("b")), lone);
        check(Eval(c, "R.a.n, R.b.n") == "1\t1", "runtime: two roles not marked distinct both take a sole candidate (unchanged)");
        c = Chip(Cfg(roles: Role("a", more: Distinct) + "," + Role("b", more: Distinct), devices: Devices), lone);
        check(Eval(c, "R.a.n, R.b.n, " + Rows) == "0\t0\ta: auto: 1 found, tap to pick|b: auto: 1 found, tap to pick\t2|2" && c.Screens.ActiveSurface == "vb_devices",
              $"runtime: two distinct roles that could only fall back to one device take neither; their rows say a device is there to pick ({Eval(c, Rows)})");
        c = Chip(Cfg(roles: Role("a", label: "A", more: Distinct) + "," + Role("b", label: "B", more: Distinct)), Host(Dev(11, "B", 5)));
        check(Eval(c, "R.a.n, R.b.refs[1]") == "0\t11", "runtime: a distinct role's fallback never takes the device another distinct role holds by its label");
        c = Chip(Cfg(roles: Role("a", more: Distinct) + "," + Role("b", "{ 100 }", "Outer", more: Distinct) + "," + Role("c", "{ 200 }")),
                 Host(Dev(11, "Outer", 5) + "," + Dev(12, "Pump", 1, prefab: 200)));
        check(Eval(c, "R.a.n, R.b.refs[1], R.c.refs[1]") == "0\t11\t12", "runtime: an earlier distinct role does not keep by fallback what a later one holds by label; other roles resolve as before");
        c = Chip(Cfg(roles: Role("a", label: "A", more: Distinct) + "," + Role("b", more: Distinct), devices: Devices), Host(Dev(11, "A", 5) + "," + Dev(12, "Z", 9)));
        Click(c, "vbdev_r:1", "vb_devices");
        Ticks(c);
        var firstPick = Eval(c, "R.a.refs[1], R.b.refs[1]");
        Click(c, "vbdev_r:1", "vb_devices");
        Ticks(c);
        var thenAuto = Eval(c, "R.b.n, VB.rk.b.pick");
        check(firstPick == "11\t12" && thenAuto == "0\tfalse", $"runtime: cycling a distinct role skips the device another distinct role holds ({firstPick}; {thenAuto})");

        // Aggregates and transforms
        var pair = Host(Dev(11, "A", 10) + "," + Dev(12, "B", 30));
        c = Chip(Cfg(roles: Role("all", all: true), reads: """
            { id = "s", role = 1, lt = "Pressure", agg = "sum" }, { id = "a", role = 1, lt = "Pressure" }, { id = "lo", role = 1, lt = "Pressure", agg = "min" },
            { id = "hi", role = 1, lt = "Pressure", agg = "max" }, { id = "l", role = 1, lt = "Pressure", agg = "list", th = { warnAbove = 20 } }
            """), pair);
        check(Eval(c, "P.s, P.a, P.lo, P.hi, #P.l, P.l[1], P.l[2], T.l[1], T.l[2]") == "40\t20\t10\t30\t2\t10\t30\t1\t2", "runtime: an all role sums, averages, takes min and max, and lists per device (states per item)");
        c = Chip(Cfg(roles: Role("t"), reads: """
            { id = "c", role = 1, lt = "Pressure", unit = "K>C" }, { id = "so", role = 1, lt = "Pressure", scale = 2, offset = 1 },
            { id = "cl", role = 1, lt = "Pressure", clamp = { 0, 5 } }, { id = "d", role = 1, lt = "Pressure", derived = function(x) return x / 3 end }
            """), Host(Dev(11, "T", 300)));
        check(Eval(c, "string.format('%.2f', P.c), P.so, P.cl, P.d") == "26.85\t601\t5\t100", "runtime: unit, scale and offset, clamp, derived");
        c = Chip(Cfg(roles: Role("t"), reads: """{ id = "sm", role = 1, lt = "Pressure", smooth = 1 }"""), Host(Dev(11, "T", 0)));
        Set(c, 11, 1, 100);
        Ticks(c);
        check(Eval(c, "string.format('%.2f', P.sm)") == "39.35", "runtime: smoothing is exponential with its time constant (1 - e^-0.5 of the step after one tick)");

        c = Chip(Cfg(roles: Role("t"), reads: """{ id = "h", role = 1, lt = "Pressure", th = { warnAbove = 50, critAbove = 80, hyst = 5, log = "O2" } }"""), Host(Dev(11, "T", 0)));
        var states = new List<string>();
        foreach (var v in new[] { 60.0, 85, 78, 74, 46, 44 })
        {
            Set(c, 11, 1, v);
            Ticks(c);
            states.Add(Eval(c, "T.h"));
        }
        check(string.Join(",", states) == "2,3,3,2,2,1" && Eval(c, "L.m[1], L.k[1], #L.m") == "O2 ok\t1\t3",
              $"runtime: thresholds with hysteresis both ways; each change logs '<log> <state>', the ring keeps logKeep entries ({string.Join(",", states)})");

        c = Chip(Cfg(roles: Role("t"), reads: """{ id = "h", role = 1, lt = "Pressure", hist = { n = 3, every = 2 } }"""), Host(Dev(11, "T", 0)));
        foreach (var v in new[] { 1.0, 2, 3, 4, 5, 6, 7, 8 })
        {
            Set(c, 11, 1, v);
            Ticks(c);
        }
        check(Eval(c, "#H.h, H.h[1], H.h[3]") == "3\t4\t8", "runtime: history keeps the last n values, one per `every` ticks, oldest first");

        // Rules
        c = Chip(Cfg(roles: Role("t"), rules: """{ role = 1, lt = "On", f = function() return 1 end }"""), Host(Dev(11, "T")));
        Ticks(c);
        var w1 = c.Stationeers.TakeWrites();
        Ticks(c);
        check(w1.Length == 1 && w1[0] == new DeviceWrite(11, 3, -1, 1, true) && c.Stationeers.TakeWrites().Length == 0,
              "runtime: a rule writes when the read-back differs, then holds (latched); boot runs no rule");
        c = Chip(Cfg(roles: Role("t"), acts: """["go"] = { press = false, list = { { steps = { { op = "command", c = "go" } } } } }""",
                     rules: """{ role = 1, lt = "Activate", f = function() return C.go and 1 or nil end, pulse = true }"""), Host(Dev(11, "T")),
                 "function U.after_reads() X.seen = C.go end");
        Click(c, "go");
        Ticks(c);
        var seen = Eval(c, "X.seen");
        var pulse = c.Stationeers.TakeWrites().Length;
        Ticks(c);
        var after = c.Stationeers.TakeWrites().Length;
        Click(c, "go");
        Ticks(c);
        check(seen == "true" && Eval(c, "C.go") == "nil" && pulse == 1 && after == 0 && c.Stationeers.TakeWrites().Length == 1,
              "runtime: a command lasts one tick; a pulse rule writes once per command, on its value's edge");
        c = Chip(Cfg(roles: Role("t"), rules: """{ role = 1, lt = "On", f = function() return nil end }"""), Host(Dev(11, "T")));
        Ticks(c, 3);
        check(c.Stationeers.TakeWrites().Length == 0, "runtime: a nil value holds: no write");
        c = Chip(Cfg(roles: Role("t"), state: State("x", "number", "1"), rules: """{ role = 1, lt = "On", f = function() return S.x end, skip = true }"""), Host(Dev(11, "T")));
        Ticks(c, 2);
        var none = c.Stationeers.TakeWrites().Length;
        c.LoadAsync("S.x = 0").Wait();
        Ticks(c);
        check(none == 0 && c.Stationeers.TakeWrites().Length == 0, "runtime: skipBoot takes the first value as a baseline (0 equals the read-back, so still no write)");
        c.LoadAsync("S.x = 5").Wait();
        Ticks(c);
        check(c.Stationeers.TakeWrites().Select(x => x.value).SequenceEqual(new[] { 5.0 }), "runtime: skipBoot writes once the value changes");
        c = Chip(Cfg(roles: Role("t"), rules: """{ role = 1, lt = "On", f = function() return 1 end }"""), Host(""));
        Ticks(c, 2);
        check(c.State == ChipState.Running && c.Stationeers.TakeWrites().Length == 0, "runtime: an unresolved role skips its rules");
        c = Chip(Cfg(roles: Role("t"), rules: """{ role = 1, lt = "On", f = function() return 1 end }, { role = 1, lt = "Setting", f = function() return 2 end }"""), Host(Dev(11, "T")));
        Ticks(c);
        check(c.Stationeers.TakeWrites().Select(x => x.lt).SequenceEqual(new[] { 3, 4 }), "runtime: rules run in list order");

        // Actions and state
        var acts = """
            ["tg"] = { press = false, list = { { steps = { { op = "toggle", s = "on" } } } } },
            ["inc"] = { press = true, list = { { steps = { { op = "step", s = "n", by = 5, min = function() return 0 end, max = function() return S.hi end } } } } },
            ["cy"] = { press = false, list = { { steps = { { op = "cycle", s = "m" } } } } },
            ["guard"] = { press = false, list = { { when = function() return false end, steps = { { op = "toggle", s = "on" } } } } },
            ["set"] = { press = false, list = { { steps = { { op = "set", s = "n", f = function() return "7" end }, { op = "set", s = "on", f = function() return 0 end },
                                                       { op = "set", s = "m", f = function() return 1.7 end }, { op = "set", s = "room", f = function() return 5 end } } } } },
            ["rep_r"] = { press = false, list = { { steps = { { op = "call", fn = "f" } } } } },
            ["pad"] = { press = false, list = { { steps = { { op = "call", fn = "f" }, { op = "log", f = function() return "pad" end, level = 2 } } } } }
            """;
        var states5 = State("on", "bool", "false") + "," + State("n", "number", "0", ", min = 0, max = 100") + "," + State("m", "enum", "0", ", n = 3")
            + "," + State("room", "string", "\"Lab\"", ", bytes = 30") + "," + State("hi", "number", "12", "");
        c = Chip(Cfg(state: states5, acts: acts), Host(""), "function U.f(e) X.id, X.i, X.x, X.y = e.id, e.i, e.x, e.y end");
        foreach (var v in new[] { "tg", "down:inc", "inc", "down:inc", "down:inc", "cy", "cy", "cy", "guard" })
            Click(c, v);
        Ticks(c, 2);
        check(Eval(c, "S.on, S.n, S.m") == "true\t12\t0", "runtime: toggle; a press act runs on down: only and steps within bounds evaluated now; cycle wraps; a false guard skips");
        Click(c, "set");
        Click(c, "rep_r:2");
        Ticks(c);
        check(Eval(c, "S.n, S.on, S.m, S.room, X.id, X.i") == "7\tfalse\t1\t5\trep_r\t2", "runtime: set coerces to the state's type; a repeat click carries its index in E.i");
        Click(c, "down:pad@0.250,0.750");
        Click(c, "pad@0.250,0.750");
        Ticks(c);
        check(Eval(c, "X.x, X.y, L.m[1], L.k[1], #L.m") == "0.25\t0.75\tpad\t2\t1", "runtime: an xy click carries E.x and E.y; another kind than down on a plain act is ignored; log steps");
        check(c.Stationeers.Persist.ContainsKey("vb:s:n") && c.Stationeers.Persist["vb:s:on"] == "0" && c.Stationeers.Persist["vb:t:room"] == "5"
              && c.Stationeers.Memory[511] == Key("vectorbuilder-mirror-1"), "runtime: an action that changes a saved state writes persist and the chip-memory mirror");

        var restart = Chip(Cfg(state: states5), Host("", Mem(c.Stationeers.Memory.Select((v, i) => (i, v)).Where(x => x.i >= 256).ToArray())));
        check(Eval(restart, "S.n, S.on, S.m, S.room") == "7\tfalse\t1\t5" && !restart.Stationeers.PersistChanged && !restart.Stationeers.MemoryChanged,
              "runtime: a re-export (persist wiped) restores every saved state from the mirror, and boot writes neither store");

        c = Chip(Cfg(state: State("big", "string", "\"\"", ", bytes = 30"), acts: """["b"] = { press = false, list = { { steps = { { op = "set", s = "big", f = function() return string.rep("x", 9000) end } } } } }"""), Host(""));
        Click(c, "b");
        Ticks(c);
        check(Eval(c, "VB.saveFailed, L.m[1]") == "true\tsave failed", "runtime: a persist write whose read-back differs (over 8192 bytes) sets saveFailed and logs it");

        // Pages: lazy build, two data elements, only changed names
        var pages = Page("p1", "main", "o.a = 1 o.b = S.n o.f = S.on", snap: "a = true, f = true") + "," + Page("p2", "page2", "o.v = S.n", snap: "v = true");
        c = Chip(Cfg(state: State("n", "number", "0") + "," + State("on", "bool", "true"), acts: """["inc"] = { press = false, list = { { steps = { { op = "step", s = "n", by = 1, min = function() return 0 end, max = function() return 9 end } } } } }""", pages: pages), Host(""));
        var snapped = DataOf(c, "main")!;
        var eased = DataOf(c, "main", "ease")!;
        check(c.Screens.ActiveSurface == "main" && c.Screens.ElementsOf("page2").Count == 0 && (double)snapped["a"] == 1 && (double)snapped["f"] == 1
              && (double)eased["b"] == 0 && !El(c, "main", "ease").Props.ContainsKey("snap") && (double)El(c, "main", "data").Props["snap"] == 1,
              "runtime: the start page is built at load, the others are not; snapped names ride `data` (snap = 1), the rest `ease` (never snap); booleans go as 0/1");
        var upserts = El(c, "main", "data").Upserts;
        Ticks(c);
        check(El(c, "main", "data").Upserts == upserts && El(c, "main", "ease").Upserts == 1, "runtime: a tick with equal values sends nothing");
        Click(c, "inc");
        Ticks(c);
        check(DataOf(c, "main", "ease")!.Keys.SequenceEqual(new[] { "b" }) && (double)DataOf(c, "main", "ease")!["b"] == 1 && El(c, "main", "data").Upserts == upserts,
              "runtime: a changed name is sent alone, on its own element");
        c.Screens.QueueVisit("p2");
        Ticks(c);
        check(c.Screens.ActiveSurface == "page2" && El(c, "page2", "data").Upserts == 1 && El(c, "page2", "scene").Upserts == 1 && (double)DataOf(c, "page2")!["v"] == 1
              && Eval(c, "page.id") == "p2", "runtime: a first visit builds the page in that tick, its declaration carrying the data: one upsert per element, never declared and patched together");

        c = Chip(Cfg(pages: Page("p1", "main", "o.s = nil o.t = nil o.l = {} o.raw = nil", nils: """s = 0, t = "--", l = { 0 }""", snap: "s = true, t = true, l = true")), Host(""));
        var nils = DataOf(c, "main")!;
        check((double)nils["s"] == 0 && (string)nils["t"] == "--" && nils["l"] is List<object> { Count: 1 } l && (double)l[0] == 0 && !nils.ContainsKey("raw"),
              "runtime: a nil sends its kind's default, an empty list its list default, a raw name nothing (ruling P7)");

        c = Chip(Cfg(), Host(""));
        c.LoadAsync("log('a') log('a') log('b') log('c') log('d')").Wait();
        check(Eval(c, "#L.m, L.m[1], L.m[3]") == "3\td\tb", "runtime: the log ring keeps logKeep entries, newest first; a repeat updates the time only");

        // The Devices page
        var three = Host(Dev(11, "O2 tank", 50) + "," + Dev(12, "N2 tank", 80) + "," + Dev(13, "Pump", 1, prefab: 200));
        c = Chip(Cfg(roles: Role("tank") + "," + Role("pump", "{ 200 }") + "," + Role("vents", "{ 100 }", all: true), reads: ReadP, devices: Devices), three);
        check(c.Screens.ActiveSurface == "vb_devices", "runtime: with nothing ever saved and a one role unresolved, the Devices page opens first");
        var dev = DataOf(c, "vb_devices")!;
        check((double)dev["vbdev_n"] == 2 && dev["vbdev_st"] is List<object> st && (double)st[0] == 2 && (double)st[1] == 1 && (string)dev["vbdev_pg"] == "1/2",
              "runtime: a row per role, paged; ambiguous is warn, resolved ok");
        Click(c, "vbdev_r:0", "vb_devices");
        Ticks(c);
        check(Eval(c, "VB.rk.tank.devs[1], VB.devMsg()") == "12\tunsaved", "runtime: tapping a one row picks the first candidate in name order (N2 before O2) and marks the page unsaved");
        Click(c, "vbdev_r:0", "vb_devices");
        Click(c, "vbsave_hit", "vb_devices");
        Ticks(c);
        check(c.Stationeers.Persist.GetValueOrDefault("vb:r:tank") == "11|O2 tank" && c.Stationeers.Memory[511] == Key("vectorbuilder-mirror-1")
              && Eval(c, "VB.devMsg()") == "saved", "runtime: the next tap takes the next candidate; SAVE writes persist and the mirror, read back");
        Click(c, "vbnext_hit", "vb_devices");
        Ticks(c);
        var page2 = DataOf(c, "vb_devices")!;
        Click(c, "vbback_hit", "vb_devices");
        Ticks(c);
        check((string)page2["vbdev_pg"] == "2/2" && page2["vbdev_name"] is List<object> names && ((string)names[0]).StartsWith("vents: 2 found")
              && c.Screens.ActiveSurface == "main", "runtime: the rows page; an all row shows its count; BACK returns to the page it came from");
        var reboot = Chip(Cfg(roles: Role("tank") + "," + Role("pump", "{ 200 }"), devices: Devices),
                          Host(Dev(11, "O2 tank", 50) + "," + Dev(12, "N2 tank", 80) + "," + Dev(13, "Pump", 1, prefab: 200), Mem(c.Stationeers.Memory.Select((v, i) => (i, v)).Where(x => x.i >= 256).ToArray())));
        check(reboot.Screens.ActiveSurface == "main" && Eval(reboot, "VB.rk.tank.devs[1]") == "11", "runtime: after a save, a re-export boots on the start page with the saved pick (from the mirror)");

        // Regression checks for saved identities, unreadable stores and lazy page builds.
        const string Row1 = "(function() local o = {} VB.devData(o) return o.vbdev_name[1], o.vbdev_st[1] end)()";
        c = Chip(Cfg(roles: Role("tank", label: "Tank"), reads: ReadP), Host(Dev(11, "Tank", 5) + "," + Dev(12, "Tank", 9)));
        check(Eval(c, "R.tank.n") == "0", "runtime: a label two candidates share picks neither (ruling P21)");
        c = Chip(Cfg(roles: Role("tank"), reads: ReadP), Host(Dev(21, "", 5) + "," + Dev(22, "", 9), """, "persist": { "vb:r:tank": "11|" }"""));
        check(Eval(c, "R.tank.n") == "0", "runtime: a saved pick with no label never matches the first unlabelled device after a rebuild (ruling P21)");
        c = Chip(Cfg(roles: Role("tank"), reads: ReadP),
                 Host(Dev(21, "", 5) + "," + Dev(22, "", 9), Mem((511, Key("vectorbuilder-mirror-1")), (510, 1), (509, Key("r:tank")), (508, 1), (507, 11), (506, 0))));
        check(Eval(c, "R.tank.n") == "0", "runtime: a mirrored name hash of 0 matches nothing (ruling P21)");
        c = Chip(Cfg(roles: Role("tank"), reads: ReadP, devices: Devices), Host(Dev(11, "Tank", 5) + "," + Dev(12, "Tank", 9)));
        Click(c, "vbdev_r:0", "vb_devices");
        Ticks(c);
        check(Eval(c, Row1) == "tank: Tank (2 share this label)\t2", $"runtime: a pick whose label another candidate shares is warn, saying so without a reference id ({Eval(c, Row1)})");
        c = Chip(Cfg(roles: Role("tank"), reads: ReadP, devices: Devices), Host(Dev(13628, "Gas Sensor", 5) + "," + Dev(12, "", 9)));
        Click(c, "vbdev_r:0", "vb_devices");
        Ticks(c);
        check(Eval(c, Row1) == "tank: Gas Sensor\t2", $"runtime: a pick's row names the device and never shows its reference id ({Eval(c, Row1)})");

        c = Chip(Cfg(roles: Role("stacker", "{ 300 }", more: ", optional = true") + "," + Role("tank", label: "O2 tank"), reads: ReadP, devices: Devices), two);
        check(c.Screens.ActiveSurface == "main" && Eval(c, "VB.unbound(), " + Row1) == "1\tstacker: not present\t1",
              "runtime: an optional role with no device neither opens the Devices page first nor is crit; VB.unbound() counts it (ruling P24)");

        const string NoList = "ic.device.list = function() return {} end";
        c = Chip(Cfg(roles: Role("tank", label: "O2 tank"), reads: ReadP), two, NoList);
        var foundByName = Eval(c, "R.tank.n, P.p");
        c = Chip(Cfg(roles: Role("tank", "{ 200 }", label: "O2 tank"), reads: ReadP), two, NoList);
        check(foundByName == "1\t80" && Eval(c, "R.tank.n") == "0", "runtime: a labelled role the list does not show is found by ic.find, when its prefab is the role's (spec 6.1)");

        c = Chip(Cfg(roles: Role("all", all: true)), pair);
        check(Eval(c, "#R.all.names, R.all.names[1], R.all.names[2], R.all.refs[2]") == "2\tA\tB\t12", "runtime: a role publishes its devices' Labeller names and refs in order");

        c = Chip(Cfg(roles: Role("t"), reads: """{ id = "p", role = 1, lt = "Pressure", valid = { 0, 1e9 }, clamp = { 0, 100 }, th = { warnAbove = 50 } }"""), Host(Dev(11, "T", -1)));
        check(Eval(c, "P.p, T.p") == "nil\t0", "runtime: a raw value outside the valid range is no reading, before clamp (ruling P25)");

        c = Chip(Cfg(roles: Role("t"), acts: """["go"] = { press = false, list = { { steps = { { op = "command", c = "go" } } } } }""",
                     rules: """{ role = 1, lt = "On", f = function() return C.go and 1 or nil end, pulse = true }"""), Host(Dev(11, "T")));
        c.LoadAsync("ic.write_id(11, ic.enums.LogicType.On, 1)").Wait();
        c.Stationeers.TakeWrites();
        Click(c, "go");
        Ticks(c);
        check(c.Stationeers.TakeWrites().Length == 1, "runtime: a pulse rule on a readable type writes once per command though the read-back already equals (a forced write, ruling P6)");

        var both = Page("p1", "main") + "," + Page("p2", "page2");
        c = Chip(Cfg(state: State("n", "number", "0"), pages: both, acts: """
            ["back"] = { press = false, list = { { steps = { { op = "set", s = "n", f = function() return 1 end } } } } },
            ["p2/back"] = { press = false, list = { { steps = { { op = "set", s = "n", f = function() return 2 end } } } } }
            """), Host(""));
        Click(c, "back");
        Ticks(c);
        var onFirst = Eval(c, "S.n");
        c.Screens.QueueVisit("p2");
        Ticks(c);
        Click(c, "back", "page2");
        Ticks(c);
        check(onFirst == "1" && Eval(c, "S.n") == "2", "runtime: a page-scoped act wins on its page; the unscoped one acts elsewhere (ruling P18)");

        c = Chip(Cfg(pages: both), Host(""));
        c.Screens.QueueVisit("p2");
        c.Screens.QueueSrc("page2", "SCENE w=100 h=100\nR x=0 y=0 w=5 h=5\n");
        Ticks(c);
        check((string)El(c, "page2", "scene").Props["src"] == "SCENE w=100 h=100\nR x=0 y=0 w=5 h=5\n", "runtime: a patch queued before a page's first visit is the text it builds from (ruling P19)");

        var late = new ChipRunner(host: Host(""));
        Made.Add(late);
        late.Screens.NotReady = true;
        late.LoadAsync(Lib + "\n" + Cfg() + "\nVB.boot()\nfunction tick(dt) VB.tick(dt) end\n").Wait();
        var unbuilt = late.State == ChipState.Running && !late.Screens.SurfaceNames.SelectMany(s => late.Screens.ElementsOf(s)).Any();
        late.Screens.NotReady = false;
        Ticks(late);
        check(unbuilt && late.Screens.ElementsOf("main").Any(e => e.Id == "scene") && late.Screens.ActiveSurface == "main",
              "runtime: a host not ready at load leaves the start page unbuilt and the chip running; the first tick builds it (probe P2)");

        var room = State("room", "string", "\"\"", ", bytes = 30");
        c = Chip(Cfg(state: room, acts: """["r"] = { press = false, list = { { steps = { { op = "set", s = "room", f = function() return "Zażółć ț€" end } } } } }"""), Host(""));
        Click(c, "r");
        Ticks(c);
        var unicode = Chip(Cfg(state: room), Host("", Mem(c.Stationeers.Memory.Select((v, i) => (i, v)).Where(x => x.i >= 256).ToArray())));
        check(Eval(unicode, "S.room") == "Zażółć ț€", $"runtime: a string state with UTF-16 units of 256 and more restores from the mirror ({Eval(unicode, "S.room")})");

        var inc = """["inc"] = { press = false, list = { { steps = { { op = "set", s = "n", f = function() return 7 end } } } } }""";
        c = Chip(Cfg(state: State("n", "number", "0"), acts: inc), Host("", """, "persist": { "vb:s:n": "3" }"""), "ic.persist.get = function() error('unreadable') end");
        Click(c, "inc");
        Ticks(c);
        check(Eval(c, "S.n, VB.noSave, VB.devMsg()") == "7\ttrue\tstore unreadable: saving off" && c.Stationeers.Persist["vb:s:n"] == "3" && !c.Stationeers.MemoryChanged,
              "runtime: a persist store that raises at boot turns saving off for the session, so nothing chosen is overwritten (ruling P22)");
        c = Chip(Cfg(state: State("n", "number", "0"), acts: inc), Host(""), "ic.mem_read = function() error('unreadable') end");
        Click(c, "inc");
        Ticks(c);
        check(c.Stationeers.Persist.GetValueOrDefault("vb:s:n") == "7" && !c.Stationeers.MemoryChanged && Eval(c, "VB.noMemory") == "true",
              "runtime: chip memory that raises at boot turns the mirror off; persist still saves (ruling P22)");

        // Uncovered paths in the reference library: the same contracts apply to list reads and fallback APIs.
        c = Chip(Cfg(roles: Role("all", all: true), reads: """{ id = "l", role = 1, lt = "Pressure", agg = "list", smooth = 1, th = { warnAbove = 20, log = "Tanks" } }"""),
                 Host(Dev(11, "A", 0) + "," + Dev(12, "B", 0)));
        Set(c, 11, 1, 100);
        Ticks(c);
        check(Eval(c, "string.format('%.2f', P.l[1]), P.l[2], T.l[1], L.m[1]") == "39.35\t0\t2\tTanks warn",
              "runtime: list reads smooth each device and log threshold changes");
        Set(c, 11, 1, 0);
        Ticks(c);
        check(Eval(c, "string.format('%.2f', P.l[1])") == "23.87", "runtime: list smoothing keeps each device's previous value");

        const string WithoutList = "ic.device.list = nil ic.device_list = nil device_list = nil";
        c = Chip(Cfg(roles: Role("tank", "{ 200 }", label: "O2 tank"), reads: ReadP), two, WithoutList);
        check(Eval(c, "R.tank.n, P.p") == "0\tnil", "runtime: find fallback rejects the wrong prefab without a list API");
        c = Chip(Cfg(roles: Role("tank", label: "Tank"), reads: ReadP), Host(Dev(11, "Tank", 5) + "," + Dev(12, "Tank", 9)), WithoutList);
        check(Eval(c, "R.tank.n") == "0", "runtime: find_all fallback leaves a shared label ambiguous");
        c = Chip(Cfg(roles: Role("all", all: true, label: "Tank")), Host(Dev(12, "Tank", 9) + "," + Dev(11, "Tank", 5) + "," + Dev(13, "Tank", 7, prefab: 200)), WithoutList);
        check(Eval(c, "R.all.n, R.all.refs[1], R.all.refs[2], R.all.names[1]") == "2\t11\t12\tTank",
              "runtime: find_all fallback filters prefabs, sorts refs and publishes names");
        foreach (var hide in new[] { "ic.device.list = nil", "ic.device.list = nil ic.device_list = nil", WithoutList + " ic.find_all = nil" })
        {
            c = Chip(Cfg(roles: Role("tank", label: "O2 tank"), reads: ReadP), two, hide);
            check(Eval(c, "R.tank.n, P.p") == "1\t80", "runtime: feature detection supports device_list and find spellings: " + hide);
        }
        c = Chip(Cfg(roles: Role("tank"), reads: ReadP),
                 Host(Dev(21, "Moved", 5) + "," + Dev(22, "Other", 9), Mem((511, Key("vectorbuilder-mirror-1")), (510, 1), (509, Key("r:tank")), (508, 1), (507, 11), (506, Key("Moved")))));
        check(Eval(c, "R.tank.refs[1], P.p") == "21\t5", "runtime: a unique mirrored name hash restores a changed ref");

        c = Chip(Cfg(state: State("n", "number", "0"), acts: inc),
                 Host("", Mem((511, Key("vectorbuilder-mirror-1")), (510, 1), (509, Key("s:n")), (508, 2), (507, 3))),
                 "local read = ic.mem_read ic.mem_read = function(at) if at == 507 then error('unreadable') end return read(at) end");
        Click(c, "inc");
        Ticks(c);
        check(Eval(c, "VB.noMemory") == "true" && !c.Stationeers.MemoryChanged,
              "runtime: a memory read that raises anywhere at boot disables mirror writes");
        c = Chip(Cfg(state: room), Host("", Mem((511, Key("vectorbuilder-mirror-1")), (510, 1), (509, Key("s:room")), (508, 3), (507, 1000))),
                 "local read = ic.mem_read ic.mem_read = function(at) if at < 256 then error('custom memory read') end return read(at) end");
        check(Eval(c, "S.room, VB.noMemory") == "\tnil", "runtime: a malformed mirror string never reads custom memory below memLow");

        var native = """
            { uid = "ti", type = "textinput", x = 10, y = 20, w = 30, h = 40, font = 12, props = { value = "" }, style = {}, bind = { value = function() return S.room end } },
            { uid = "ico", type = "icon", x = 10, y = 10, w = 20, h = 20, props = {}, style = {}, bind = { name = function() return X.item end } }
            """;
        c = Chip(Cfg(state: room, pages: Page("p1", "main", natives: native), acts: """["ti"] = { native = true, list = { { steps = { { op = "set", s = "room", f = function() return E.v end } } } } }"""), Host(""));
        var parked = (double)El(c, "main", "ico").Rect!["x"] == -10000;
        c.Screens.Enqueue("main", "ti", "change", "Lab");
        c.LoadAsync("X.item = 'O2'").Wait();
        Ticks(c);
        check(parked && Eval(c, "S.room, E.id, E.v") == "Lab\tti\tLab" && (string)El(c, "main", "ti").Props["value"] == "Lab"
              && (double)El(c, "main", "ico").Rect!["x"] > 0 && El(c, "main", "ti").Upserts == 2,
              "runtime: native changes update state and bound props; a missing icon parks until its name appears");
        check(Math.Abs((double)El(c, "main", "ti").Rect!["w"] - 144) < 1e-6 && Math.Abs((double)El(c, "main", "ti").Style!["font_size"] - 57.6) < 1e-6,
              "runtime: native boxes and font sizes follow the scene's contain fit");

        c = Chip(Cfg(roles: Role("tank"), reads: ReadP, state: State("n", "number", "0"), pages: Page("p1", "main", "o.v = S.n", snap: "v = true")), Host(Dev(11, "Only", 5)),
                 """
                 X.order = '' function U.init() X.order = X.order .. 'i' end
                 function U.before_reads(dt) X.order = X.order .. 'b' end
                 function U.after_reads(p, s, dt) X.order = X.order .. 'a' S.n = P.p end
                 function U.before_render(p, s, data) X.order = X.order .. 'r' data.v = data.v + 1 end
                 """);
        Ticks(c);
        check(Eval(c, "X.order") == "ibar" && (double)DataOf(c, "main")!["v"] == 6,
              "runtime: hooks run in contract order and before_render can change the page data");
        check(Eval(c, "persist.set('k', 'v'), persist.get('k')") == "true\tv" && c.Stationeers.Persist.GetValueOrDefault("u:k") == "v",
              "runtime: custom persistence uses verified u: keys");
        Ticks(c, 18);
        check(Eval(c, "VB.scanned") == "0", "runtime: resolved roles do not rescan before 20 ticks");
        Ticks(c);
        check(Eval(c, "VB.scanned") == "20", "runtime: resolved roles rescan at tick 20");
        c = Chip(Cfg(roles: Role("tank")), Host(""));
        Ticks(c, 4);
        check(Eval(c, "VB.scanned") == "4", "runtime: unresolved required one roles rescan at tick 4");
        c = Chip(Cfg(roles: Role("tank", more: ", optional = true")), Host(""));
        Ticks(c, 4);
        check(Eval(c, "VB.scanned") == "0", "runtime: optional unresolved roles retain the normal scan interval");

        c = Chip(Cfg(roles: Role("tank"), reads: """{ id = "p", role = 1, lt = "NotAType" }"""), two);
        check(Eval(c, "P.p, T.p, VB.devMsg()") == "nil\t0\tunknown type NotAType in read p", "runtime: unknown enum names report a boot problem and read nil");
        c = Chip(Cfg(state: room, acts: """["r"] = { press = false, list = { { steps = { { op = "set", s = "room", f = function() return "A😀B" end } } } } }"""), Host(""));
        Click(c, "r");
        Ticks(c);
        unicode = Chip(Cfg(state: room), Host("", Mem(c.Stationeers.Memory.Select((v, i) => (i, v)).Where(x => x.i >= 256).ToArray())));
        check(Eval(unicode, "S.room") == "A😀B", "runtime: surrogate pairs survive UTF-16 mirror packing across chunks");
        c = Chip(Cfg(state: room), Host("", Mem((511, Key("vectorbuilder-mirror-1")), (510, 1), (509, 0), (508, 2), (507, 3))),
                 "local read = ic.mem_read ic.mem_read = function(at) if at == 509 then return 0/0 end return read(at) end");
        check(Eval(c, "S.room") == "", "runtime: a non-finite mirror key is ignored without halting");
        check(Made.All(m => m.State == ChipState.Running), "runtime: every test chip remains running");
        check(Made.SelectMany(m => m.Screens.SurfaceNames.SelectMany(s => m.Screens.ElementsOf(s))).All(e => Depth(e.Props) <= 3),
              "runtime: every props table sent to ss.ui is at most three levels deep");
        check(Made.All(m => m.Screens.LostWrites.Count == 0),
              $"runtime: no chip above lost a write to the flush rule ({string.Join("; ", Made.SelectMany(m => m.Screens.LostWrites).Take(5))})");
    }

    static void RepeaterValues(Action<bool, string> check)
    {
        const string spec = ", repeaters = { { n = 'rows', v = 'values', hasv = 'present', ready = 'ready', max = 4 } }";
        var page = Page("p1", "main", "o.rows = X.rows o.values = X.values", snap: "rows = true, values = true, present = true, ready = true",
            nils: "values = { '' }, present = { 0 }").Replace("empty = false", "empty = false" + spec);
        var c = Chip(Cfg(pages: page), Host(""), "X.rows = 4 X.values = { '42', '', '0' }");
        string Flags() => Eval(c, "VB.cfg.pages[1].sent.present and table.concat(VB.cfg.pages[1].sent.present, ',') or 'missing'");
        check(Flags() == "1,0,1,0", "repeater: bound string rows flag empty and missing values as absent");
        check(Eval(c, "VB.cfg.pages[1].sent.ready") == "1", "repeater: flags and their readiness signal arrive together");
        c.LoadAsync("X.values = { 0, 12 }").Wait(); Ticks(c);
        check(Flags() == "1,1,1,1", "repeater: numeric rows retain a value column for zero and out-of-range numeric slots");
        c.LoadAsync("X.values = { false, true }").Wait(); Ticks(c);
        check(Flags() == "1,1,1,1", "repeater: boolean rows become numeric zero and one, both present");
        c.LoadAsync("X.values = nil").Wait(); Ticks(c);
        check(Flags() == "0,0,0,0", "repeater: a bound value removed on a later tick clears every row flag");
        c.LoadAsync("X.rows = 2.5 X.values = { '', '0', 'x' }").Wait(); Ticks(c);
        check(Flags() == "0,1,1", "repeater: fractional counts flag exactly the rows i less than n draws");
        c.LoadAsync("X.rows = 100000000 X.values = { 0 }").Wait(); Ticks(c);
        check(Flags() == "1,1,1,1", "repeater: flags stop at the authored repeat count");
        c = Chip(Cfg(roles: Role("tank") + "," + Role("pump", "{ 200 }"), reads: """{ id = "p", role = 1, lt = "Pressure" }""", devices: Devices
            .Replace("empty = false", "empty = false, repeaters = { { n = 'vbdev_n', v = 'vbdev_v', hasv = 'vbdev_hasv', ready = 'vbdev_ready', max = 2 } }")
            .Replace("vbdev_st = true", "vbdev_st = true, vbdev_hasv = true, vbdev_ready = true")), Host(Dev(11, "Tank", 0) + "," + Dev(12, "Pump", 1, prefab: 200)));
        c.LoadAsync("VB.go('vb_devices')").Wait(); Ticks(c);
        check(Eval(c, "VB.cfg.devices.sent.vbdev_hasv and table.concat(VB.cfg.devices.sent.vbdev_hasv, ',') or 'missing'") == "1,0",
              "repeater: Devices rows flag a zero reading as present and a role with no reading as absent");
    }

    static void CoreLows(Action<bool, string> check)
    {
        var host = Host(Dev(11, "A", 10) + "," + Dev(12, "B", 90));
        var c = Chip(Cfg(roles: Role("all", all: true)), host);
        c.LoadAsync("wr('all', 'On', true) wr('all', 'On', true)").Wait();
        var writes = c.Stationeers.TakeWrites();
        check(c.State == ChipState.Running && writes.Length == 2 && writes.All(w => w.lt == 3 && w.value == 1 && w.stored),
              "runtime lows: wr converts booleans and writes each differing device only once");
        c.LoadAsync("wrf('all', 'On', true) wrf('all', 'On', true)").Wait();
        writes = c.Stationeers.TakeWrites();
        check(c.State == ChipState.Running && writes.Length == 4 && writes.All(w => w.value == 1),
              "runtime lows: wrf forces every device even when read-back already matches");
        c = Chip(Cfg(roles: Role("all", all: true) + "," + Role("one", label: "A"), reads: """
            { id = "list", role = 1, lt = "Pressure", agg = "list", th = { critAbove = 80 } },
            { id = "one", role = 2, lt = "Pressure", th = { critBelow = 20 } }
            """), host);
        check(Eval(c, "alarms(1), alarms(3), alarms(0)") == "1\t2\t0", "runtime lows: alarms counts scalar and list states");
        c = Chip(Cfg(roles: Role("one"), reads: """{ id = "low", role = 1, lt = "Pressure", th = { warnBelow = 50, critBelow = 20, hyst = 5 } }"""), Host(Dev(11, "A", 100)));
        var grades = new List<string>();
        foreach (var v in new[] { 40.0, 15, 22, 26, 54, 56 }) { Set(c, 11, 1, v); Ticks(c); grades.Add(Eval(c, "T.low")); }
        check(string.Join(",", grades) == "2,3,3,2,2,1", "runtime lows: below thresholds hold until hysteresis clears each edge");
        foreach (var (unit, input, expected) in new[] { ("K>F", 273.15, "32.000000"), ("kPa>MPa", 2000.0, "2.000000"),
                     ("kPa>atm", 101.325, "1.000000"), ("W>kW", 2000.0, "2.000000"), ("W>MW", 2000000.0, "2.000000"),
                     ("J>kJ", 2000.0, "2.000000"), ("J>MJ", 2000000.0, "2.000000"), ("ratio>%", 0.25, "25.000000") })
        {
            c = Chip(Cfg(roles: Role("one"), reads: $$"""{ id = "u", role = 1, lt = "Pressure", unit = "{{unit}}" }"""), Host(Dev(11, "A", input)));
            check(Eval(c, "string.format('%.6f', P.u)") == expected, $"runtime lows: unit preset {unit}");
        }
        c = Chip(Cfg(pages: Page("p1", "main") + "," + Page("p2", "second"), acts: """["go"] = { press = false, list = { { steps = { { op = "page", page = "p2" } } } } }"""), Host(""));
        Click(c, "go"); Ticks(c);
        check(c.State == ChipState.Running && c.Screens.ActiveSurface == "second" && Eval(c, "page.id") == "p2",
              "runtime lows: a page action builds and visits its target");
        c = Chip(Cfg(roles: Role("a", all: true) + "," + Role("b", all: true) + "," + Role("c", all: true), devices: Devices), host);
        c.Screens.QueueVisit("vb_devices"); Ticks(c);
        Click(c, "vbnext_hit", "vb_devices"); Ticks(c);
        Click(c, "vbprev_hit", "vb_devices"); Ticks(c);
        var first = Eval(c, "VB.devPage");
        Click(c, "vbprev_hit", "vb_devices"); Ticks(c);
        check(first == "0" && Eval(c, "VB.devPage") == "0" && (string)DataOf(c, "vb_devices")!["vbdev_pg"] == "1/2",
              "runtime lows: PREV returns to the first Devices page and stops there");
        // Pause after event dispatch so the regular Devices-page scan cannot mask a broken RESCAN button.
        c.LoadAsync("function tick() VB.events() end").Wait();
        Click(c, "vbscan_hit", "vb_devices"); Ticks(c);
        var forced = Eval(c, "VB.rescan");
        c.LoadAsync("function tick(dt) VB.tick(dt) end").Wait(); Ticks(c);
        check(forced == "true" && Eval(c, "VB.scanned == VB.n, VB.rescan") == "true\tfalse",
              "runtime lows: RESCAN requests a scan and the next tick consumes it");
    }

    static void ScanBudgets(Action<bool, string> check)
    {
        // P9 measured 2026-10-11: a pushed chip halts at 50,000; the documented init default remains editable.
        var measuredLoad = new ChipRunner(initBudget: 50_000);
        measuredLoad.LoadAsync("for i=1,60000 do end").Wait();
        var defaultLoad = new ChipRunner();
        defaultLoad.LoadAsync("for i=1,60000 do end").Wait();
        check(measuredLoad.State == ChipState.Halted && measuredLoad.LastInstructions == 50_000
              && measuredLoad.Error == "Instruction limit exceeded: script used more than 50,000 instructions in a single tick."
              && defaultLoad.State == ChipState.Running && new BudgetsJson().load == 500_000,
              "runtime: an edited 50000 load budget reproduces the measured error; the documented init default remains 500000");
        var scenarios = new[] {
            (Name: "all-300", N: 300, Prefabs: 1, Roles: Role("all", all: true), Reads: "{ id = 'l', role = 1, lt = 'Pressure', agg = 'list' }", Devices: "nil", Ticks: 20),
            (Name: "all-renamed-300", N: 300, Prefabs: 1, Roles: Role("all", all: true), Reads: "{ id = 'l', role = 1, lt = 'Pressure', agg = 'list' }", Devices: "nil", Ticks: 20),
            (Name: "one-100", N: 100, Prefabs: 1, Roles: Role("one", label: "D1"), Reads: "", Devices: "nil", Ticks: 20),
            (Name: "one-200", N: 200, Prefabs: 1, Roles: Role("one", label: "D1"), Reads: "", Devices: "nil", Ticks: 20),
            (Name: "one-300", N: 300, Prefabs: 1, Roles: Role("one", label: "D1"), Reads: "", Devices: "nil", Ticks: 20),
            (Name: "one-500", N: 500, Prefabs: 1, Roles: Role("one", label: "D1"), Reads: "", Devices: "nil", Ticks: 20),
            (Name: "devices-two-300", N: 300, Prefabs: 1, Roles: Role("one") + "," + Role("two"), Reads: "", Devices: Devices, Ticks: 1),
            (Name: "mixed-300-40-8", N: 300, Prefabs: 40,
                Roles: string.Join(",", Enumerable.Range(0, 8).Select(i => Role("r" + i, "{ " + (100 + i) + " }", label: "D" + (i + 1)))), Reads: "", Devices: "nil", Ticks: 20),
        };
        foreach (var s in scenarios)
        {
            var host = Host(string.Join(",", Enumerable.Range(1, s.N).Select(i => Dev(i + 10, "D" + i, i, prefab: 100 + (i - 1) % s.Prefabs))));
            var cfg = Cfg(roles: s.Roles, reads: s.Reads, devices: s.Devices);
            var custom = s.Name == "all-renamed-300" ? """
                local list = ic.device.list
                ic.device.list = function()
                  local devices = list()
                  if VB.n >= 20 then for _, d in ipairs(devices) do d.display_name = 'new ' .. d.display_name end end
                  return devices
                end
                """ : "";
            var metered = Chip(cfg, host, custom, tickBudget: 2_000_000);
            Ticks(metered, s.Ticks);
            var instructions = metered.LastInstructions;
            var normal = Chip(cfg, host, custom);
            Ticks(normal, s.Ticks);
            check(normal.State == ChipState.Running && metered.State == ChipState.Running && instructions < 50_000,
                  $"runtime: {s.Name} scan tick {s.Ticks} fits default 500000/50000 budgets (complete={instructions}, default={normal.LastInstructions}, error={normal.Error})");
        }
    }

    static int Depth(object value) => value switch
    {
        Dictionary<string, object> map => 1 + map.Values.Select(Depth).DefaultIfEmpty(0).Max(),
        List<object> list => 1 + list.Select(Depth).DefaultIfEmpty(0).Max(),
        _ => 0
    };
}
