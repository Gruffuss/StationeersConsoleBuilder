using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using VectorBuilder.Core;

/// <summary>The fake StationeersLua host (FakeStationeersLua), one check per documented behaviour; provisional rows say so.</summary>
static class StationeersTests
{
    const string Enums = """
        "enums": { "LogicType": { "Pressure": 1, "On": 3, "Setting": 4, "Activate": 5, "PrefabHash": 6, "ReferenceId": 7, "NameHash": 8 },
                   "LogicSlotType": { "Quantity": 1, "Occupied": 2 }, "LogicBatchMethod": { "Average": 0, "Sum": 1, "Minimum": 2, "Maximum": 3, "Count": 4 } }
        """;

    static HostJson Host(string rest = "")
    {
        var host = HostJson.Parse("{" + Enums + (rest == "" ? "" : ", " + rest) + "}", out var error);
        return error == null ? host : throw new InvalidOperationException(error);
    }

    // A gas-sensor-like device: Pressure R, On RW, Activate W, the identity types R; slot 0 exposes Quantity, slots 0-1 Occupied.
    static string Dev(long id, string name, int prefab = 100, double pressure = 0, string extra = "") => $$"""
        { "ref": {{id}}, "prefab": {{prefab}}, "prefabName": "Gas{{prefab}}", "name": "{{name}}",
          "logic": { "1": "R", "3": "RW", "5": "W", "6": "R", "7": "R", "8": "R" }, "slots": 2, "slotLogic": { "1": [0], "2": [0, 1] },
          "values": { "1": { "kind": "const", "v": {{pressure.ToString(CultureInfo.InvariantCulture)}} } } {{extra}} }
        """;

    static ChipRunner Chip(string lua, HostJson host)
    {
        var chip = new ChipRunner(host: host);
        chip.LoadAsync(lua).Wait();
        return chip;
    }
    static string Out(ChipRunner c) => string.Join("|", c.Output);

    public static void Run(Action<bool, string> check)
    {
        foreach (var json in new[] { """{"devices":[null]}""", """{"enums":{"LogicType":null}}""",
                     """{"devices":[{"ref":11,"values":{"1":null},"slotValues":{"0:1":null}}]}""" })
        {
            try
            {
                var safe = Chip("print(#ic.device.list())", HostJson.Parse(json, out _));
                check(safe.State == ChipState.Running, $"stationeers: null host entries are skipped {json}");
            }
            catch (Exception e) { check(false, $"stationeers: null host entries are skipped {json}: {e.GetType().Name}"); }
        }
        foreach (var json in new[] { """{"values":{"11":null}}""", """{"values":{"11":{"1":null}}}""" })
        {
            try
            {
                var safe = Chip("", Host($$""" "devices":[{{Dev(11, "T")}}] """));
                safe.Stationeers.Sim(SimJson.Parse(json, out _)!);
                safe.LoadAsync("print(ic.read_id(11, 1))").Wait();
                check(safe.State == ChipState.Running && Out(safe) == "0", $"stationeers: null Sim entries are skipped {json}");
            }
            catch (Exception e) { check(false, $"stationeers: null Sim entries are skipped {json}: {e.GetType().Name}"); }
        }
        var badClock = HostJson.Parse("""{"clock":{"length":"Infinity","start":0.25}}""", out _);
        var clock = Chip("print(util.time_of_day(), util.days_past(), util.clock_time())", badClock);
        check(clock.State == ChipState.Running && Out(clock) == "0.25\t0\t06:00", "stationeers: a non-finite clock uses the default");
        var colliding = HostJson.Parse("{" + Enums + "," + $$"""
            "housing": {{Dev(1, "Housing", pressure: 20)}},
            "devices": [{{Dev(1, "Collision", pressure: 99)}}, null, {{Dev(11, "Tank", pressure: 30)}}],
            "persist": {"saved":"yes"}, "memory":[42], "clock":{"length":1200,"start":0.5},
            "beta":true, "budgets":{"load":250000,"tick":75000}
            """ + "}", out var collision);
        check(collision != null && collision.Contains("ref 1") && collision.Contains("skipped"),
              "stationeers: Parse reports the skipped device sharing the housing ref");
        var kept = Chip("print(#ic.device.list(), ic.read_id(1, 1), ic.read_id(11, 1), ic.persist.get('saved'), ic.mem_read(0), util.time_of_day())", colliding);
        check(kept.State == ChipState.Running && Out(kept) == "1\t20\t30\tyes\t42\t0.5"
              && colliding.devices?.Length == 2 && colliding.beta && colliding.budgets == new BudgetsJson(250000, 75000),
              "stationeers: a housing-ref collision skips only that device and keeps the host configuration");
        var literals = Chip("""print(util.clock_time("ALARM HH:MM A"))""", Host(""" "clock":{"length":1200,"start":0.75} """));
        check(literals.State == ChipState.Running && Out(literals) == "ALARM 18:00 PM", "stationeers: clock replaces only the standalone AM/PM token");
        foreach (var (json, load, tick) in new[] { ("""{"budgets":{"load":250000}}""", 250000, 50000),
                     ("""{"budgets":{"tick":75000}}""", 500000, 75000), ("""{"budgets":{}}""", 500000, 50000) })
        {
            var budgets = HostJson.Parse(json, out var error).budgets;
            check(error == null && budgets?.load == load && budgets?.tick == tick,
                  $"stationeers: missing budget members use their individual defaults {json}");
        }
        var file = Path.Combine(Fixtures.Root, "..", "src", "catalog", "devices.json");
        if (File.Exists(file))
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(file));
            var all = doc.RootElement.GetProperty("devices").EnumerateArray().Select(d => (Name: d.GetProperty("name").GetString()!, Hash: d.GetProperty("hash").GetInt32())).ToList();
            var wrong = all.Where(d => FakeStationeersLua.Hash(d.Name) != d.Hash).Select(d => d.Name).ToList();
            check(all.Count >= 576 && wrong.Count == 0, $"stationeers: hash() is the CRC-32 the catalogue states for all {all.Count} prefabs {string.Join(", ", wrong)}".TrimEnd());
        }
        else Console.WriteLine("SKIP stationeers: the catalogue CRC check needs web/src/catalog/devices.json (Task 1)");

        // A multi-line raw literal's content starts on the line after its opening quotes (CS8997 otherwise).
        var two = Host($$"""
            "housing": { "ref": 1, "prefab": 9, "prefabName": "StructureConsole", "name": "Console", "logic": { "6": "R", "7": "R", "8": "R" } },
            "devices": [ {{Dev(12, "Tank B", pressure: 30)}}, {{Dev(11, "Tank A", pressure: 10, extra: ", \"pin\": 0")}} ]
            """);

        var c = Chip("""
            print(hash("StructureGasSensor"), ic.hash("StructureGasSensor"), ic.enums.LogicType.Pressure, ic.const.BASE_UNIT_INDEX)
            local l = ic.device.list()
            print(#l, l[1].ref_id, l[2].ref_id, l[2].display_name, l[1].name_hash == hash("Tank A"), l[1].prefab_hash, ic.device_list == ic.device.list, device_list ~= nil)
            print(ic.device.info(12).slot_count, ic.device.info(99), ic.device.type_count(100))
            """, two);
        check(Out(c) == "-1252983604\t-1252983604\t1\t2147483647|2\t11\t12\tTank B\ttrue\t100\ttrue\ttrue|2\tnil\t2",
              $"stationeers P4: device.list excludes the housing and keeps devices in ref order (measured 2026-10-11); info, type_count {Out(c)}");

        var unnamed = Chip("""
            local d = ic.device.list()[1]
            print(d.display_name, d.name_hash == hash(d.display_name), ic.read_id(d.ref_id, ic.enums.LogicType.NameHash) == d.name_hash)
            print(ic.find("Gas Sensor"), ic.device.info(d.ref_id).display_name)
            """, Host($$""" "devices": [{{Dev(11, "", extra: ", \"prefabDisplayName\": \"Gas Sensor\"")}}] """));
        check(unnamed.State == ChipState.Running && Out(unnamed) == "Gas Sensor\ttrue\ttrue|11\tGas Sensor",
              $"stationeers P4: an unlabelled device uses its prefab display name and its hash (measured 2026-10-11) {Out(unnamed)}");

        c = Chip("""
            local LT = ic.enums.LogicType
            print(ic.read_id(11, LT.Pressure), ic.read_id(99, LT.Pressure), ic.read_id(12, LT.PrefabHash), ic.read_id(12, LT.ReferenceId), ic.read_id(11, LT.NameHash) == hash("Tank A"))
            print(pcall(ic.read_id, 11, LT.Activate))
            print(pcall(ic.read_id, 11, LT.Setting))
            print(ic.read(0, LT.Pressure), ic.read(1, LT.Pressure), ic.read(ic.const.BASE_UNIT_INDEX, LT.PrefabHash))
            """, two);
        check(c.State == ChipState.Running && c.Output.First() == "10\tnil\t100\t12\ttrue"
              && c.Output.ElementAt(1).StartsWith("false\t") && c.Output.ElementAt(1).Contains("cannot read logicType Activate")
              && c.Output.ElementAt(2).StartsWith("false\t") && c.Output.ElementAt(2).Contains("cannot read logicType Setting")
              && c.Output.Last() == "10\tnil\t9",
              $"stationeers P1: unreadable LogicTypes raise by name; unknown refs return nil (measured 2026-10-11) {Out(c)}");

        var api = Chip("print(ic.const.BASE_NETWORK_INDEX, ic.const.BASE_UNIT_INDEX, type(util.json), type(json))", Host());
        check(Out(api) == "-2147483648\t2147483647\ttable\tnil", $"stationeers P2: measured base indices and util.json without a global alias (2026-10-11) {Out(api)}");

        c = Chip("""
            local LT = ic.enums.LogicType
            ic.write_id(11, LT.On, 1) ic.write_id(11, LT.Activate, 1) ic.write(0, LT.On, 2)
            print(ic.read_id(11, LT.On), pcall(ic.read_id, 11, LT.Activate))
            print(pcall(ic.write_id, 11, LT.Pressure, 5))
            print(pcall(ic.write_id, 11, LT.PrefabHash, 5))
            print(ic.write_id(99, LT.On, 1))
            print(ic.read_id(11, LT.PrefabHash) == 100, ic.read_id(11, LT.Pressure) == 10)
            """, two);
        var writes = c.Stationeers.TakeWrites();
        check(c.Output.First().StartsWith("2\tfalse\t") && c.Output.First().Contains("cannot read logicType Activate")
              && c.Output.ElementAt(1).Contains("cannot write logicType Pressure")
              && c.Output.ElementAt(2).Contains("cannot write logicType PrefabHash") && c.Output.Last() == "true\ttrue"
              && writes.Length == 3 && writes[0] == new DeviceWrite(11, 3, -1, 1, true) && writes[1] == new DeviceWrite(11, 5, -1, 1, false)
              && writes[2] == new DeviceWrite(11, 3, -1, 2, true) && c.Stationeers.TakeWrites().Length == 0,
              $"stationeers P14: read-only writes raise by name without changing values (measured 2026-10-11); RW is stored, W is logged, unknown refs write nothing {Out(c)}");

        c = Chip("""
            local LST = ic.enums.LogicSlotType
            ic.write_slot_id(11, 0, LST.Quantity, 7)
            print(ic.read_slot_id(11, 0, LST.Quantity), ic.read_slot_id(11, 1, LST.Occupied), ic.read_slot(0, 0, LST.Quantity))
            print(pcall(ic.read_slot_id, 11, 1, LST.Quantity))
            """, two);
        check(c.State == ChipState.Running && Out(c) == "7\t0\t7|true\tnil",
              $"stationeers: absent slot reads also return nil through pcall {Out(c)}");
        var duplicateJson = """{"devices":[{"ref":11,"values":{"1":{"kind":"walk"}}},{"ref":11,"values":{"2":{"kind":"walk"}}}]}""";
        var duplicateHost = HostJson.Parse(duplicateJson, out var duplicateError);
        check(duplicateHost == HostJson.Empty && duplicateError != null && duplicateError.Contains("duplicate"),
              "stationeers: Parse rejects duplicate device refs before installing walk sources");
        try
        {
            var direct = Host("\"devices\":[" + Dev(11, "First") + "]");
            var first = direct.devices![0] with { values = new() { ["1"] = new SourceJson("walk") } };
            var second = first with { values = new() { ["2"] = new SourceJson("walk") } };
            var duplicateChip = Chip("", direct with { devices = [first, second] });
            duplicateChip.TickAsync().Wait();
            check(duplicateChip.State == ChipState.Running, "stationeers: duplicate refs cannot make Advance throw");
        }
        catch (Exception e) { check(false, $"stationeers: duplicate refs cannot make Advance throw ({e.GetType().Name})"); }

        c = Chip("""
            local LT, M = ic.enums.LogicType, ic.enums.LogicBatchMethod
            print(ic.batch_read(100, LT.Pressure, M.Average), ic.batch_read(100, LT.Pressure, M.Sum), ic.batch_read(100, LT.Pressure, M.Minimum), ic.batch_read(100, LT.Pressure, M.Maximum), ic.batch_read(100, LT.Pressure, M.Count))
            print(ic.batch_read_name(100, hash("Tank B"), LT.Pressure, M.Average))
            local a = ic.batch_read(5, LT.Pressure, M.Average)
            print(a ~= a, ic.batch_read(5, LT.Pressure, M.Sum), ic.batch_read(5, LT.Pressure, M.Minimum), ic.batch_read(5, LT.Pressure, M.Maximum) == -math.huge, ic.batch_read(5, LT.Pressure, M.Count))
            ic.batch_write(100, LT.On, 1)
            print(ic.read_id(11, LT.On), ic.read_id(12, LT.On))
            """, two);
        check(Out(c) == "20\t40\t10\t30\t2|30|true\t0\t0\ttrue\t0|1\t1",
              $"stationeers P3: empty batches Average nan, Sum 0, Minimum 0, Maximum -inf, Count 0 (measured 2026-10-11); batch writes reach each device {Out(c)}");

        foreach (var (method, lua, expected) in new[] {
            ("batch_write_name", """ic.batch_write_name(100, hash("Tank B"), 3, 8) print(ic.read_id(11, 3), ic.read_id(12, 3))""", "0\t8"),
            ("batch_read_slot", """ic.write_slot_id(11, 0, 1, 4) print(ic.batch_read_slot(100, 0, 1, 1), ic.batch_read_slot(100, 1, 1, 4))""", "4\t0"),
            ("batch_read_slot_name", """ic.write_slot_id(12, 0, 1, 9) print(ic.batch_read_slot_name(100, hash("Tank B"), 0, 1, 1))""", "9"),
            ("batch_write_slot", """ic.batch_write_slot(100, 0, 1, 4) print(ic.read_slot_id(11, 0, 1), ic.read_slot_id(12, 0, 1))""", "4\t4"),
            ("batch_write_slot_name", """ic.batch_write_slot_name(100, hash("Tank B"), 0, 1, 9) print(ic.read_slot_id(11, 0, 1), ic.read_slot_id(12, 0, 1))""", "0\t9") })
        {
            c = Chip(lua, two);
            check(c.State == ChipState.Running && Out(c) == expected, $"stationeers: {method} filters candidates {Out(c)}");
        }
        c = Chip("for i = 1, 250 do ic.write_id(11, 3, i) end", two);
        writes = c.Stationeers.TakeWrites();
        check(c.State == ChipState.Running && writes.Length == 250 && writes[0].value == 1 && writes[^1].value == 250,
              "stationeers: every write survives until the status drains its log");

        c = Chip("""
            print(ic.find("Tank B"), ic.find("Tank *"), ic.find("^Tank [AB]$", "regex"), ic.find("Tank", "exact"), #ic.find_all("Tank ?"), #ic.find_all("nothing"), ic.find("Tank A", 0))
            print(pcall(ic.find, "(", "regex"))
            print(ic.find_prefab)
            """, two);
        check(c.Output.First() == "12\t11\t11\tnil\t2\t0\t11" && c.Output.ElementAt(1).StartsWith("false") && c.Output.ElementAt(2) == "nil",
              $"stationeers: find and find_all by Labeller name, auto/exact/glob/regex, a number is the network index; a bad pattern raises; no find_prefab without beta {Out(c)}");
        c = Chip("""print(ic.find_prefab("Gas100"), #ic.find_all_prefab("Gas*"))""", Host($$""" "beta": true, "devices": [ {{Dev(11, "Tank A")}} ] """));
        check(Out(c) == "11\t1", $"stationeers: beta adds find_prefab and find_all_prefab {Out(c)}");

        c = Chip("""
            local p = ic.persist
            print(p.set("a", "1"), p.get("a"), p.has("a"), p.get("b"), p.set("__x", "1"), p.set(string.rep("k", 129), "1"), p.set("big", string.rep("v", 8193)))
            p.set("n", 2.5) print(p.get("n")) p.delete("a") print(p.has("a"))
            for i = 1, 4 do p.set("f" .. i, string.rep("v", 8190)) end print(p.has("f3"), p.has("f4"))
            p.clear() print(p.has("n"))
            """, Host(""" "persist": { "kept": "yes" } """));
        check(Out(c) == "true\t1\ttrue\tnil\tfalse\tfalse\tfalse|2.5|false|true\tfalse|false" && c.Stationeers.PersistChanged && c.Stationeers.Persist.Count == 0,
              $"stationeers P5: overlong keys/values and __ keys are refused without raising (measured 2026-10-11); documented total over 32768 is refused {Out(c)}");
        c = Chip("""print(ic.persist.get("kept"))""", Host(""" "persist": { "kept": "yes" } """));
        check(Out(c) == "yes" && !c.Stationeers.PersistChanged, "stationeers: persist starts from the host's; a read changes nothing");
        c = Chip("""print(ic.persist.has("bad"), ic.persist.get("kept"), ic.persist.set("new", "value"))""",
                 Host(""" "persist":{"bad":null,"kept":"yes"} """));
        check(c.State == ChipState.Running && Out(c) == "false\tyes\ttrue" && c.Stationeers.Persist.Count == 2,
              "stationeers: null persist entries are skipped and the next set succeeds");

        c = Chip("""
            ic.mem_write(0, 1.5) mem_write(511, 2^48 - 1)
            print(ic.mem_read(0), mem_read(511) == 2^48 - 1, pcall(ic.mem_read, 512), pcall(ic.mem_write, -1, 0), pcall(ic.mem_read, 1.5))
            ic.mem_clear() print(ic.mem_read(0))
            """, Host(""" "memory": [ 9 ] """));
        check(c.Output.First().StartsWith("1.5\ttrue\tfalse") && c.Output.Last() == "0" && c.Stationeers.MemoryChanged,
              $"stationeers: chip memory 0..511, both spellings, 2^48-1 round-trips; out of range raises; clear {Out(c)}");

        // A 1200 s day starting at 0.25: 06:00 at load; 600 s (1200 ticks) later 18:00, half a day on.
        c = Chip("""print(util.clock_time("HH:MM"), util.clock_time("hh:MM:ss A"), util.time_of_day(), util.days_past(), util.game_time(), time())""",
                 Host(""" "clock": { "length": 1200, "start": 0.25 } """));
        for (var k = 0; k < 1200; k++) c.TickAsync().Wait();
        c.LoadAsync("""print(util.clock_time("HH:MM"), util.days_past())""").Wait();
        check(c.Output.First() == "06:00\t06:00:00 AM\t0.25\t0\t300\t300" && c.Output.Last() == "18:00\t0",
              $"stationeers P13: HH hh MM ss and A as AM/PM (measured 2026-10-11), time of day, days past, game time {Out(c)}");

        var halted = Chip("ic.persist.set('saved', 'yes') ic.mem_write(500, 2^48 - 1) error('halt')", Host());
        var pushed = Chip("print(ic.persist.get('saved'), ic.mem_read(500) == 2^48 - 1)",
            Host() with { persist = new(halted.Stationeers.Persist), memory = (double[])halted.Stationeers.Memory.Clone() });
        check(halted.State == ChipState.Halted && pushed.State == ChipState.Running && Out(pushed) == "yes\ttrue",
              "stationeers P5c/P6: a new push keeps persist and exact chip-memory writes made before a load halt (measured 2026-10-11)");

        // Sources at known preview times: 2 ticks = 1 s.
        var sim = Host($$"""
            "devices": [ { "ref": 11, "prefab": 1, "prefabName": "S", "name": "S", "logic": { "1": "R", "3": "RW", "4": "R" },
            "values": { "1": { "kind": "sine", "mid": 10, "amp": 2, "period": 4 }, "3": { "kind": "ramp", "from": 0, "to": 10, "period": 4 },
                        "4": { "kind": "keys", "keys": [[0, 0], [2, 10]] } } },
            { "ref": 12, "prefab": 1, "prefabName": "S", "name": "W", "logic": { "1": "R" }, "values": { "1": { "kind": "walk", "v": 50, "step": 1, "min": 0, "max": 100, "seed": 3 } } } ]
            """);
        c = Chip("", sim);
        c.TickAsync().Wait();
        c.TickAsync().Wait();
        c.LoadAsync("""local LT = ic.enums.LogicType print(ic.read_id(11, LT.Pressure), ic.read_id(11, LT.On), ic.read_id(11, LT.Setting))""").Wait();
        var walked = Chip("", sim);
        walked.TickAsync().Wait();
        walked.TickAsync().Wait();
        walked.LoadAsync("""print(ic.read_id(12, ic.enums.LogicType.Pressure))""").Wait();
        c.LoadAsync("""print(ic.read_id(12, ic.enums.LogicType.Pressure))""").Wait();
        var w = double.Parse(c.Output.Last(), CultureInfo.InvariantCulture);
        check(c.Output.First() == "12\t2.5\t5" && w is >= 48 and <= 52 && w != 50 && c.Output.Last() == walked.Output.Last(),
              $"stationeers: sine, ramp and keys at their preview time; a walk steps per tick within its step, the same from the same seed {Out(c)}");

        c.Stationeers.Sim(SimJson.Parse("""{ "values": { "11": { "1": { "kind": "const", "v": 99 } } }, "clearWrites": true, "wipePersist": true }""", out _)!);
        c.LoadAsync("""print(ic.read_id(11, ic.enums.LogicType.Pressure))""").Wait();
        check(c.Output.Last() == "99", "stationeers: Sim changes a source without a reload");
        c.LoadAsync("""ic.write_id(11, ic.enums.LogicType.On, 7)""").Wait();
        c.Stationeers.Sim(new SimJson(null, clearWrites: true));
        c.LoadAsync("""print(ic.read_id(11, ic.enums.LogicType.On))""").Wait();
        check(c.State == ChipState.Running && c.Output.Last() == "2.5", "stationeers: clearWrites drops the stored values, so the source shows again");
        c.Stationeers.Persist["kept"] = "yes";
        c.Stationeers.PersistChanged = false;
        c.Stationeers.Sim(new SimJson(null, wipePersist: true));
        check(c.Stationeers.Persist.Count == 0 && c.Stationeers.PersistChanged, "stationeers: wipePersist clears a non-empty store and reports the change");

        c = Chip("""
            local json = util.json
            local s = util.json.encode({ a = 1, b = { 1, 2, "x" }, c = true })
            local t = json.decode(s)
            print(t.a, t.b[3], t.c, #t.b, pcall(util.json.encode, { f = print }))
            """, Host());
        check(c.Output.First().StartsWith("1\tx\ttrue\t3\tfalse"), $"stationeers: util.json encodes and decodes tables {Out(c)}");

        c = Chip("""
            local json = util.json
            local t = json.decode('{"left":[null,{"v":"x\\ny"}],"right":{"v":false},"last":3}')
            print(t.left[1] == nil, t.left[2].v == "x\ny", t.right.v, t.last)
            print(json.decode('null') == nil, json.decode('true'), json.decode('false'), json.decode('1.5'), json.decode('"text"'), json.encode({}))
            local mixed = json.decode(json.encode({ [1] = "first", named = { 1, 2 } }))
            print(mixed["1"], mixed.named[2])
            """, Host());
        check(Out(c) == "true\ttrue\tfalse\t3|true\ttrue\tfalse\t1.5\ttext\t{}|first\t2",
              $"stationeers: iterative JSON preserves scalars, escaped strings, null indices, mixed keys and sibling containers {Out(c)}");
        c = Chip("""
            local json = util.json
            local rejected = 0
            for _, s in ipairs({ '', ' ', '[', '{"x":', '[1,]', 'true false', '{"x":1' }) do
                local ok, err = pcall(json.decode, s)
                if not ok and string.find(err, "json.decode:", 1, true) then rejected = rejected + 1 end
            end
            print(rejected)
            """, Host());
        check(c.State == ChipState.Running && Out(c) == "7",
              $"stationeers: iterative json.decode still rejects empty, incomplete and malformed JSON through pcall {Out(c)}");

        // JSON has no depth cap of our own; test each direction independently, then round-trip.
        foreach (var depth in new[] { 70, 100_000 })
        foreach (var array in new[] { true, false })
        {
            var wrap = array ? "{ t }" : "{ child = t }";
            var open = array ? "[" : "{\"child\":";
            var close = array ? "]" : "}";
            var key = array ? "1" : "\"child\"";
            var shape = array ? "array" : "object";
            // The larger budget only covers constructing/walking the input in Lua; host calls are unmetered.
            c = new ChipRunner(initBudget: 10_000_000, host: Host());
            c.LoadAsync($$"""
                local t = 7
                for i = 1, {{depth}} do t = {{wrap}} end
                local ok, s = pcall(util.json.encode, t)
                local expected = string.rep('{{open}}', {{depth}}) .. '7' .. string.rep('{{close}}', {{depth}})
                print(ok, ok and s == expected or s)
                """).Wait();
            check(c.State == ChipState.Running && Out(c) == "true\ttrue",
                  $"stationeers: json.encode accepts a {depth}-deep {shape} {Out(c)}");

            c = new ChipRunner(initBudget: 10_000_000, host: Host());
            c.LoadAsync($$"""
                local s = string.rep('{{open}}', {{depth}}) .. '7' .. string.rep('{{close}}', {{depth}})
                local ok, t = pcall(util.json.decode, s)
                if ok then
                    local leaf = t
                    for i = 1, {{depth}} do leaf = leaf[{{key}}] end
                    print(leaf, util.json.encode(t) == s)
                else print(ok, t) end
                """).Wait();
            check(c.State == ChipState.Running && Out(c) == "7\ttrue",
                  $"stationeers: json.decode round-trips a {depth}-deep {shape} {Out(c)}");
        }

        c = Chip("""
            local a = {} a[1] = a
            local o = {} o.self = o
            local x, y = {}, {} x.child = y y.parent = x
            for _, t in ipairs({ a, o, x }) do
                local ok, err = pcall(util.json.encode, t)
                print(ok, string.find(err, "cycle", 1, true) ~= nil)
            end
            local shared = { 1, 2 }
            print(util.json.encode({ shared, shared }) == '[[1,2],[1,2]]')
            """, Host());
        check(c.State == ChipState.Running && Out(c) == "false\ttrue|false\ttrue|false\ttrue|true",
              $"stationeers: json.encode rejects direct and indirect cycles clearly, but accepts shared acyclic tables {Out(c)}");

        c = Chip("""local h = ic.host_info() print(h.name, h.ref_id, h.prefab_hash, h.type)""", two);
        check(Out(c) == "Console\t1\t9\tStructureConsole", $"stationeers: host_info describes the housing {Out(c)}");

        var bad = HostJson.Parse("{ not json", out var why);
        var typed = HostJson.Parse("""{ "devices": [ { "ref": "x" } ] }""", out var why2);
        check(bad == HostJson.Empty && why != null && typed == HostJson.Empty && why2 != null && HostJson.Parse("", out var none) == HostJson.Empty && none == null,
              "stationeers: HostJson.Parse never throws: unreadable or mistyped JSON gives the empty host and its reason");
        check(new ChipRunner().Stationeers != null && Chip("print(ic ~= nil, hash ~= nil, ic.time)", HostJson.Empty).Output.Single() == "true\ttrue\tnil",
              "stationeers: every chip has the host, even with no host JSON; there is no ic.time (spec 7)");

        // Non-finite numbers cross the host JSON as named literals (ruling P20): a chip may write NaN or 1/0 into its memory,
        // and the next load hands that memory back.
        var named = HostJson.Parse("""{ "memory": [ "NaN", "Infinity", "-Infinity", 1.5 ] }""", out var namedError);
        check(namedError == null && double.IsNaN(named.memory![0]) && double.IsPositiveInfinity(named.memory[1]) && double.IsNegativeInfinity(named.memory[2]) && named.memory[3] == 1.5,
              $"stationeers: the host JSON reads NaN and the infinities as named literals {namedError}".TrimEnd());
    }
}
