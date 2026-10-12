using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Lua;

namespace VectorBuilder.Core
{
    /// <summary>
    /// The slice of StationeersLua a console script uses, written from its public docs (lua/api device, logic, memory, persist,
    /// utility; lua/guide sections 4-6; the ScriptedScreens examples), never from decompiled code: ic.* over the simulated
    /// devices the page sends, hash, enums, persist with its documented limits, chip memory, a day clock, a log of writes.
    /// A behaviour no doc states is marked provisional with the in-game probe that settles it (plan W0b).
    /// </summary>
    public sealed class FakeStationeersLua
    {
        public const int MemorySize = 512, MaxKey = 128, MaxValue = 8192, MaxTotal = 32768, BaseUnitIndex = int.MaxValue, BaseNetworkIndex = int.MinValue;

        sealed class Device
        {
            public long Ref;
            public int Prefab, Slots;
            public int? Pin;
            public string PrefabName = "", Name = "";
            public readonly Dictionary<int, string> Access = new();                       // LogicType → R, W, RW
            public readonly Dictionary<int, HashSet<int>> SlotLogic = new();              // LogicSlotType → the slots exposing it
            public readonly Dictionary<(int Slot, int Type), SourceJson> Sources = new(); // slot -1: a LogicType
            public readonly Dictionary<(int Slot, int Type), double> Stored = new();      // written, read back until cleared
        }

        readonly FakeScriptedScreens screens;
        readonly List<Device> devices = new();   // P4, measured 2026-10-11: network devices in ref order, housing excluded.
        readonly Dictionary<long, Device> byRef = new();
        readonly Device? housing;
        readonly Dictionary<string, Dictionary<string, int>> enums;
        readonly Dictionary<(long Ref, int Slot, int Type), (double V, uint S)> walks = new();
        readonly double dayLength, dayStart;
        readonly bool beta;
        double t;   // preview seconds since the load

        public FakeStationeersLua(HostJson host, FakeScriptedScreens screens)
        {
            this.screens = screens;
            enums = (host.enums ?? new()).Where(p => p.Value != null).ToDictionary(p => p.Key, p => p.Value);
            beta = host.beta;
            (dayLength, dayStart) = host.clock is { length: > 0 } c ? (c.length, c.start) : (1200, 0.25);
            Persist = (host.persist ?? new()).Where(p => p.Value != null).ToDictionary(p => p.Key, p => p.Value);
            if (host.memory != null)
                Array.Copy(host.memory, Memory, Math.Min(MemorySize, host.memory.Length));
            housing = host.housing != null ? Add(host.housing) : null;
            if (housing != null) devices.Remove(housing);   // still reachable by ref, base unit and host_info
            foreach (var d in host.devices ?? [])
                if (d != null) Add(d);
            devices.Sort((a, b) => a.Ref.CompareTo(b.Ref));
        }

        public Dictionary<string, string> Persist { get; }
        readonly Dictionary<(string Key, string Kind), string> persistRefusals = new();
        public IReadOnlyCollection<string> PersistRefusals => persistRefusals.Values;
        public double[] Memory { get; } = new double[MemorySize];   // P6/P5c, measured 2026-10-11: retained across pushes, including a halted run's writes.
        public bool PersistChanged { get; set; }
        public bool MemoryChanged { get; set; }
        public List<DeviceWrite> Writes { get; } = new();
        public double Time => t;

        public DeviceWrite[] TakeWrites()
        {
            var w = Writes.ToArray();
            Writes.Clear();
            return w;
        }

        static bool Int(string s, out int n) => int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out n);
        static bool SlotKey(string k, out (int Slot, int Type) key)
        {
            key = default;
            var p = k.Split(':');
            if (p.Length == 1 && Int(p[0], out var type)) { key = (-1, type); return true; }
            if (p.Length == 2 && Int(p[0], out var slot) && Int(p[1], out type)) { key = (slot, type); return true; }
            return false;
        }

        Device Add(DeviceJson j)
        {
            if (byRef.TryGetValue(j.@ref, out var existing)) return existing;
            var d = new Device { Ref = j.@ref, Prefab = j.prefab, PrefabName = j.prefabName ?? "", Name = j.name ?? "", Pin = j.pin, Slots = Math.Max(0, j.slots) };
            // P4, measured 2026-10-11: unlabelled devices expose the prefab's display name and hash that name.
            if (d.Name.Length == 0) d.Name = j.prefabDisplayName ?? d.PrefabName;
            foreach (var (k, a) in j.logic ?? new())
                if (Int(k, out var n) && a is "R" or "W" or "RW")
                    d.Access[n] = a;
            foreach (var (k, at) in j.slotLogic ?? new())
                if (Int(k, out var n))
                    d.SlotLogic[n] = new(at ?? []);
            foreach (var (k, s) in j.values ?? new())
                if (Int(k, out var n))
                    Source(d, (-1, n), s);
            foreach (var (k, s) in j.slotValues ?? new())
                if (SlotKey(k, out var key) && key.Slot >= 0)
                    Source(d, key, s);
            if (byRef.TryAdd(d.Ref, d))
                devices.Add(d);
            return d;
        }

        void Source(Device d, (int Slot, int Type) key, SourceJson? s)
        {
            if (s == null) return;
            d.Sources[key] = s;
            walks.Remove((d.Ref, key.Slot, key.Type));
            if (s.kind == "walk")
                walks[(d.Ref, key.Slot, key.Type)] = (Math.Clamp(s.v, Math.Min(s.min, s.max), Math.Max(s.min, s.max)), Seed(s.seed, d.Ref, key.Slot, key.Type));
        }

        static uint Seed(int seed, long r, int slot, int type)
        {
            var x = unchecked((uint)seed * 2654435761u ^ (uint)r * 40503u ^ (uint)(slot + 7) * 97u ^ (uint)type * 2246822519u);
            return x == 0 ? 1u : x;
        }

        /// <summary>One tick of preview time: every source moves with it, and each random walk takes its step (a xorshift per walk).</summary>
        public void Advance(double dt)
        {
            t += dt;
            foreach (var key in walks.Keys.ToList())
            {
                var s = byRef[key.Ref].Sources[(key.Slot, key.Type)];
                var (v, x) = walks[key];
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                walks[key] = (Math.Clamp(v + s.step * (x / (double)uint.MaxValue * 2 - 1), Math.Min(s.min, s.max), Math.Max(s.min, s.max)), x);
            }
        }

        /// <summary>The Sim panel's live change: new sources (a slider's value), stored writes cleared, persist wiped.</summary>
        public void Sim(SimJson s)
        {
            foreach (var (r, types) in s.values ?? new())
                if (types != null && long.TryParse(r, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) && byRef.TryGetValue(id, out var d))
                    foreach (var (k, src) in types)
                        if (SlotKey(k, out var key))
                            Source(d, key, src);
            if (s.clearWrites)
                foreach (var d in devices)
                    d.Stored.Clear();
            if (s.wipePersist && Persist.Count > 0)
            {
                Persist.Clear();
                PersistChanged = true;
            }
        }

        /// <summary>A source's value at preview second <paramref name="time"/>; a walk's start (its steps are kept by Advance).</summary>
        public static double At(SourceJson s, double time)
        {
            var period = s.period > 0 ? s.period : 1;
            switch (s.kind)
            {
                case "sine":
                    return s.mid + s.amp * Math.Sin(2 * Math.PI * time / period);
                case "ramp":
                    return s.from + (s.to - s.from) * (s.loop ? time % period / period : Math.Min(time / period, 1));
                case "keys":
                    var k = (s.keys ?? []).Where(p => p is { Length: >= 2 }).OrderBy(p => p[0]).ToArray();
                    if (k.Length == 0)
                        return 0;
                    if (s.loop && k[^1][0] > 0)
                        time %= k[^1][0];
                    if (time <= k[0][0])
                        return k[0][1];
                    for (var i = 1; i < k.Length; i++)
                        if (time <= k[i][0])
                            return k[i][0] > k[i - 1][0] ? k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (time - k[i - 1][0]) / (k[i][0] - k[i - 1][0]) : k[i][1];
                    return k[^1][1];
                default:
                    return s.v;   // const, slider; a walk's start
            }
        }

        int Enum(string table, string name) => enums.TryGetValue(table, out var m) && m.TryGetValue(name, out var n) ? n : int.MinValue;

        double ValueOf(Device d, int slot, int type)
        {
            if (slot < 0 && type == Enum("LogicType", "PrefabHash")) return d.Prefab;
            if (slot < 0 && type == Enum("LogicType", "ReferenceId")) return d.Ref;
            if (slot < 0 && type == Enum("LogicType", "NameHash")) return Hash(d.Name);
            if (d.Stored.TryGetValue((slot, type), out var v)) return v;
            if (walks.TryGetValue((d.Ref, slot, type), out var w)) return w.V;
            return d.Sources.TryGetValue((slot, type), out var s) ? At(s, t) : 0;   // a readable type with no source reads 0
        }

        static bool Can(Device d, int slot, int type, string not) =>
            slot < 0 ? d.Access.TryGetValue(type, out var a) && a != not : d.SlotLogic.TryGetValue(type, out var at) && at.Contains(slot);

        string LogicName(int type) => enums.TryGetValue("LogicType", out var members)
            ? members.FirstOrDefault(p => p.Value == type).Key ?? type.ToString(CultureInfo.InvariantCulture)
            : type.ToString(CultureInfo.InvariantCulture);

        LuaValue Read(LuaState lua, Device? d, int slot, int type)
        {
            if (d == null)
                return LuaValue.Nil;   // an unknown ref or an empty pin (api/logic)
            if (!Can(d, slot, type, "W"))
            {
                // P1, measured 2026-10-11: an existing device's unreadable LogicType raises; unknown refs stay nil.
                if (slot < 0) throw new LuaRuntimeException(lua, $"cannot read logicType {LogicName(type)}");
                return LuaValue.Nil;   // slot reads remain unprobed
            }
            return ValueOf(d, slot, type);
        }

        void Write(LuaState lua, Device? d, int slot, int type, double v)
        {
            if (d == null)
                return;   // provisional (P14): the guide says a write "may throw if the device is missing"
            if (!Can(d, slot, type, "R"))   // P14, measured 2026-10-11: read-only LogicTypes raise without changing the value.
                throw new LuaRuntimeException(lua, slot < 0 ? $"cannot write logicType {LogicName(type)}" : $"slot type {type} is not writable on {d.Name} slot {slot}");
            // A W type is a command: logged, not stored. Slot writes are stored (provisional, unprobed: write a writable slot and read it back).
            var stored = slot >= 0 || d.Access[type] == "RW";
            if (stored)
                d.Stored[(slot, type)] = v;
            Writes.Add(new DeviceWrite(d.Ref, type, slot, v, stored));
        }

        static double Num(LuaState lua, ReadOnlySpan<LuaValue> a, int i) =>
            a.Length > i && a[i].Type == LuaValueType.Number ? a[i].Read<double>() : throw new LuaRuntimeException(lua, $"bad argument #{i + 1} (number expected)");
        static string Str(LuaState lua, ReadOnlySpan<LuaValue> a, int i) =>
            a.Length > i && a[i].Type == LuaValueType.String ? a[i].Read<string>() : throw new LuaRuntimeException(lua, $"bad argument #{i + 1} (string expected)");
        static int Int(LuaState lua, ReadOnlySpan<LuaValue> a, int i) => (int)Num(lua, a, i);
        Device? ById(double r) => byRef.TryGetValue((long)r, out var d) ? d : null;
        Device? ByPin(double port) => port == BaseUnitIndex ? housing : devices.FirstOrDefault(d => d != housing && d.Pin == (int)port);

        LuaTable Info(Device d)
        {
            var r = new LuaTable();
            r["ref_id"] = (double)d.Ref;
            r["prefab_hash"] = d.Prefab;
            r["name_hash"] = Hash(d.Name);
            r["display_name"] = d.Name;
            r["slot_count"] = d.Slots;
            return r;
        }

        LuaTable List()
        {
            var t = new LuaTable();
            var i = 1;
            foreach (var d in devices)
            {
                var r = new LuaTable();
                r["ref_id"] = (double)d.Ref;
                r["prefab_hash"] = d.Prefab;
                r["name_hash"] = Hash(d.Name);
                r["display_name"] = d.Name;
                t[i++] = r;
            }
            return t;
        }

        static LuaTable Refs(IEnumerable<Device> found)
        {
            var t = new LuaTable();
            var i = 1;
            foreach (var d in found)
                t[i++] = (double)d.Ref;
            return t;
        }

        // ic.find's modes (guide §4): auto is glob when the name holds * or ?, else exact; regex is .NET's, 50 ms at most.
        List<Device> Find(LuaState lua, ReadOnlySpan<LuaValue> a, Func<Device, string> of)
        {
            var pattern = Str(lua, a, 0);
            var mode = a.Length > 1 && a[1].Type == LuaValueType.String ? a[1].Read<string>() : "auto";   // a lone number is the network index
            if (mode == "auto")
                mode = pattern.IndexOfAny(['*', '?']) >= 0 ? "glob" : "exact";
            var match = mode switch
            {
                "exact" => (Func<string, bool>)(s => s == pattern),
                "glob" => Rx(lua, "^" + Regex.Escape(pattern).Replace(@"\*", ".*").Replace(@"\?", ".") + "$"),
                "regex" => Rx(lua, pattern),
                _ => throw new LuaRuntimeException(lua, $"unknown find mode {mode}"),
            };
            return devices.Where(d => match(of(d))).ToList();
        }

        static Func<string, bool> Rx(LuaState lua, string pattern)
        {
            Regex r;
            try { r = new Regex(pattern, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50)); }
            catch (ArgumentException e) { throw new LuaRuntimeException(lua, "bad pattern: " + e.Message); }
            return s =>
            {
                try { return r.IsMatch(s); }
                catch (RegexMatchTimeoutException) { throw new LuaRuntimeException(lua, "pattern timed out (50 ms)"); }
            };
        }

        IEnumerable<Device> Matching(double hash, double? nameHash) =>
            devices.Where(d => d.Prefab == (int)hash && (nameHash == null || Hash(d.Name) == (int)nameHash.Value));

        double Batch(LuaState lua, double method, IEnumerable<double> values)
        {
            var name = enums.TryGetValue("LogicBatchMethod", out var m) ? m.FirstOrDefault(p => p.Value == (int)method).Key : null;
            var l = values.ToList();
            // P3, measured 2026-10-11: empty Average nan, Sum 0, Minimum 0, Maximum -inf, Count 0.
            return name switch
            {
                "Sum" => l.Sum(),
                "Average" => l.Count == 0 ? double.NaN : l.Average(),
                "Minimum" => l.Count == 0 ? 0 : l.Min(),
                "Maximum" => l.Count == 0 ? double.NegativeInfinity : l.Max(),
                "Count" => l.Count,
                _ => throw new LuaRuntimeException(lua, $"unknown batch method {method}"),
            };
        }

        // The game's hash: signed CRC-32/IEEE over the UTF-8 bytes.
        static readonly uint[] Crc = Enumerable.Range(0, 256).Select(n =>
        {
            var c = (uint)n;
            for (var k = 0; k < 8; k++)
                c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            return c;
        }).ToArray();

        public static int Hash(string s)
        {
            var c = 0xFFFFFFFFu;
            foreach (var b in Encoding.UTF8.GetBytes(s))
                c = Crc[(c ^ b) & 0xFF] ^ (c >> 8);
            return unchecked((int)(c ^ 0xFFFFFFFFu));
        }

        double GameSeconds => dayStart * dayLength + t;
        double TimeOfDay => (GameSeconds % dayLength + dayLength) % dayLength / dayLength;

        // P13, measured 2026-10-11: HH, hh, MM, ss and the AM/PM token A.
        string ClockTime(string fmt)
        {
            var s = (int)Math.Floor(TimeOfDay * 86400);
            int h = s / 3600, m = s / 60 % 60, sec = s % 60;
            string Two(int n) => n.ToString("00", CultureInfo.InvariantCulture);
            return Regex.Replace(fmt, @"HH|hh|MM|ss|\bA\b", x => x.Value switch
            {
                "HH" => Two(h), "hh" => Two((h + 11) % 12 + 1), "MM" => Two(m), "ss" => Two(sec), _ => h < 12 ? "AM" : "PM",
            });
        }

        // Explicit frames keep JSON walks off the CLR stack. Only an ancestor repeated on the
        // current path is a cycle: a table shared by separate branches is valid JSON input.
        sealed class JsonWriteFrame(LuaTable table)
        {
            public readonly LuaTable Table = table;
            public readonly int Length = table.ArrayLength;
            public readonly bool Array = table.HashMapCount == 0 && table.ArrayLength > 0;
            public int Index = 1;
            public LuaTable.LuaTableEnumerator Entries = table.GetEnumerator();
        }

        static string Encode(LuaValue v)
        {
            using var ms = new MemoryStream();
            // MaxDepth otherwise defaults to 1000. The framework's integer representation is
            // the only bound here; legitimate nesting has no application-imposed depth cap.
            using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { MaxDepth = int.MaxValue }))
                Write(w, v);
            return Encoding.UTF8.GetString(ms.ToArray());
        }

        static void Write(Utf8JsonWriter w, LuaValue v)
        {
            var frames = new Stack<JsonWriteFrame>();
            var ancestors = new HashSet<LuaTable>(ReferenceEqualityComparer.Instance);
            while (true)
            {
                switch (v.Type)
                {
                    case LuaValueType.Nil: w.WriteNullValue(); break;
                    case LuaValueType.Boolean: w.WriteBooleanValue(v.Read<bool>()); break;
                    case LuaValueType.Number: w.WriteNumberValue(v.Read<double>()); break;
                    case LuaValueType.String: w.WriteStringValue(v.Read<string>()); break;
                    case LuaValueType.Table:
                        var table = v.Read<LuaTable>();
                        if (!ancestors.Add(table))
                            throw new InvalidOperationException("table contains a cycle");
                        var frame = new JsonWriteFrame(table);
                        frames.Push(frame);
                        if (frame.Array) w.WriteStartArray(); else w.WriteStartObject();
                        break;
                    default: throw new InvalidOperationException($"a {v.Type} has no JSON form");
                }

                var next = false;
                while (frames.Count > 0)
                {
                    var frame = frames.Peek();
                    if (frame.Array && frame.Index <= frame.Length)
                    {
                        v = frame.Table[frame.Index++];
                        next = true;
                        break;
                    }
                    if (!frame.Array && frame.Entries.MoveNext())
                    {
                        var (key, value) = frame.Entries.Current;
                        w.WritePropertyName(key.ToString());
                        v = value;
                        next = true;
                        break;
                    }
                    if (frame.Array) w.WriteEndArray(); else w.WriteEndObject();
                    ancestors.Remove(frame.Table);
                    frames.Pop();
                }
                if (!next) return;
            }
        }

        sealed class JsonReadFrame(LuaTable table, bool array)
        {
            public readonly LuaTable Table = table;
            public readonly bool Array = array;
            public int Index = 1;
            public string? Property;
        }

        static LuaValue Decode(string json)
        {
            // Read tokens directly: no recursive DOM conversion or extra copy of the JSON tree.
            var reader = new Utf8JsonReader(Encoding.UTF8.GetBytes(json), new JsonReaderOptions { MaxDepth = int.MaxValue });
            var frames = new Stack<JsonReadFrame>();
            var root = LuaValue.Nil;
            var hasRoot = false;
            while (reader.Read())
            {
                if (reader.TokenType is JsonTokenType.EndObject or JsonTokenType.EndArray)
                {
                    frames.Pop();
                    continue;
                }
                if (reader.TokenType == JsonTokenType.PropertyName)
                {
                    frames.Peek().Property = reader.GetString()!;
                    continue;
                }

                LuaValue value = reader.TokenType switch
                {
                    JsonTokenType.StartObject or JsonTokenType.StartArray => new LuaTable(),
                    JsonTokenType.String => reader.GetString()!,
                    JsonTokenType.Number => reader.GetDouble(),
                    JsonTokenType.True => true,
                    JsonTokenType.False => false,
                    _ => LuaValue.Nil,
                };
                if (frames.Count == 0)
                {
                    root = value;
                    hasRoot = true;
                }
                else
                {
                    var parent = frames.Peek();
                    LuaValue key = parent.Array ? (LuaValue)parent.Index++ : parent.Property!;
                    parent.Table[key] = value;
                }
                if (reader.TokenType is JsonTokenType.StartObject or JsonTokenType.StartArray)
                    frames.Push(new JsonReadFrame(value.Read<LuaTable>(), reader.TokenType == JsonTokenType.StartArray));
            }
            if (!hasRoot)
                throw new JsonException("expected a JSON value");
            return root;
        }

        public void Install(LuaState lua)
        {
            LuaFunction F(string name, FakeScriptedScreens.Body body) => screens.Method(null, name, body);
            var ic = new LuaTable();

            var en = new LuaTable();
            foreach (var (table, members) in enums)
            {
                var m = new LuaTable();
                foreach (var (k, v) in members)
                    m[k] = v;
                en[table] = m;
            }
            ic["enums"] = en;
            var consts = new LuaTable();
            // P2, measured 2026-10-11: the Lua base indices differ from IC10's dB index.
            consts["BASE_UNIT_INDEX"] = BaseUnitIndex;
            consts["BASE_NETWORK_INDEX"] = BaseNetworkIndex;
            ic["const"] = consts;

            var hash = F("hash", (ctx, a) => ctx.Return(Hash(Str(ctx.State, a, 0))));
            ic["hash"] = hash;

            var list = F("list", (ctx, a) => ctx.Return(List()));
            var device = new LuaTable();
            device["list"] = list;
            device["info"] = F("info", (ctx, a) => ctx.Return(ById(Num(ctx.State, a, 0)) is { } d ? Info(d) : LuaValue.Nil));
            device["type_count"] = F("type_count", (ctx, a) => { var h = Int(ctx.State, a, 0); return ctx.Return(devices.Count(d => d.Prefab == h)); });
            ic["device"] = device;
            ic["device_list"] = list;   // the ScriptedScreens examples' spelling

            ic["find"] = F("find", (ctx, a) => { var m = Find(ctx.State, a, d => d.Name); return ctx.Return(m.Count > 0 ? (LuaValue)(double)m[0].Ref : LuaValue.Nil); });
            ic["find_all"] = F("find_all", (ctx, a) => ctx.Return(Refs(Find(ctx.State, a, d => d.Name))));
            if (beta)
            {
                ic["find_prefab"] = F("find_prefab", (ctx, a) => { var m = Find(ctx.State, a, d => d.PrefabName); return ctx.Return(m.Count > 0 ? (LuaValue)(double)m[0].Ref : LuaValue.Nil); });
                ic["find_all_prefab"] = F("find_all_prefab", (ctx, a) => ctx.Return(Refs(Find(ctx.State, a, d => d.PrefabName))));
            }

            ic["read"] = F("read", (ctx, a) => ctx.Return(Read(ctx.State, ByPin(Num(ctx.State, a, 0)), -1, Int(ctx.State, a, 1))));
            ic["read_id"] = F("read_id", (ctx, a) => ctx.Return(Read(ctx.State, ById(Num(ctx.State, a, 0)), -1, Int(ctx.State, a, 1))));
            ic["write"] = F("write", (ctx, a) => { Write(ctx.State, ByPin(Num(ctx.State, a, 0)), -1, Int(ctx.State, a, 1), Num(ctx.State, a, 2)); return ctx.Return(); });
            ic["write_id"] = F("write_id", (ctx, a) => { Write(ctx.State, ById(Num(ctx.State, a, 0)), -1, Int(ctx.State, a, 1), Num(ctx.State, a, 2)); return ctx.Return(); });
            ic["read_slot"] = F("read_slot", (ctx, a) => ctx.Return(Read(ctx.State, ByPin(Num(ctx.State, a, 0)), Int(ctx.State, a, 1), Int(ctx.State, a, 2))));
            ic["read_slot_id"] = F("read_slot_id", (ctx, a) => ctx.Return(Read(ctx.State, ById(Num(ctx.State, a, 0)), Int(ctx.State, a, 1), Int(ctx.State, a, 2))));
            ic["write_slot"] = F("write_slot", (ctx, a) => { Write(ctx.State, ByPin(Num(ctx.State, a, 0)), Int(ctx.State, a, 1), Int(ctx.State, a, 2), Num(ctx.State, a, 3)); return ctx.Return(); });
            ic["write_slot_id"] = F("write_slot_id", (ctx, a) => { Write(ctx.State, ById(Num(ctx.State, a, 0)), Int(ctx.State, a, 1), Int(ctx.State, a, 2), Num(ctx.State, a, 3)); return ctx.Return(); });

            // Batch calls (guide §6): (hash[, nameHash], [slot, ] type, method | value[, net]). The runtime library never uses them.
            void Batch2(string name, bool named, bool slot)
            {
                int at(int k) => k + (named ? 1 : 0) + (slot ? 1 : 0);
                ic["batch_read" + name] = F("batch_read" + name, (ctx, a) =>
                {
                    double? nh = named ? Num(ctx.State, a, 1) : null;
                    int s = slot ? Int(ctx.State, a, at(0)) : -1, type = Int(ctx.State, a, at(1));
                    var values = Matching(Num(ctx.State, a, 0), nh).Where(d => Can(d, s, type, "W")).Select(d => ValueOf(d, s, type)).ToList();
                    return ctx.Return(Batch(ctx.State, Num(ctx.State, a, at(2)), values));
                });
                ic["batch_write" + name] = F("batch_write" + name, (ctx, a) =>
                {
                    double? nh = named ? Num(ctx.State, a, 1) : null;
                    int s = slot ? Int(ctx.State, a, at(0)) : -1, type = Int(ctx.State, a, at(1));
                    var v = Num(ctx.State, a, at(2));
                    foreach (var d in Matching(Num(ctx.State, a, 0), nh).Where(d => Can(d, s, type, "R")).ToList())
                        Write(ctx.State, d, s, type, v);
                    return ctx.Return();
                });
            }
            Batch2("", false, false);
            Batch2("_name", true, false);
            Batch2("_slot", false, true);
            Batch2("_slot_name", true, true);

            var persist = new LuaTable();
            static int Bytes(string s) => Encoding.UTF8.GetByteCount(s);
            persist["set"] = F("set", (ctx, a) =>
            {
                var key = Str(ctx.State, a, 0);
                var value = a.Length > 1 && a[1].Type == LuaValueType.Number ? a[1].Read<double>().ToString("R", CultureInfo.InvariantCulture) : Str(ctx.State, a, 1);
                var others = Persist.Where(x => x.Key != key).Sum(x => Bytes(x.Key) + Bytes(x.Value));
                // P5, measured 2026-10-11: overlong keys/values and __ keys return false without raising; total limit 32768 is documented, unprobed.
                var keyBytes = Bytes(key);
                var valueBytes = Bytes(value);
                var total = others + keyBytes + valueBytes;
                var kind = key.StartsWith("__", StringComparison.Ordinal) ? "reserved"
                    : keyBytes > MaxKey ? "key" : valueBytes > MaxValue ? "value" : total > MaxTotal ? "total" : null;
                if (kind != null)
                {
                    persistRefusals[(key, kind)] = kind switch
                    {
                        "reserved" => "persist: reserved __ key refused",
                        "key" => $"persist: UTF-8 key is {keyBytes} bytes, limit {MaxKey}",
                        "value" => $"persist: UTF-8 value is {valueBytes} bytes, limit {MaxValue}",
                        _ => $"persist: UTF-8 key/value total is {total} bytes, limit {MaxTotal}"
                    };
                    return ctx.Return(false);
                }
                Persist[key] = value;
                PersistChanged = true;
                return ctx.Return(true);
            });
            persist["get"] = F("get", (ctx, a) => ctx.Return(Persist.TryGetValue(Str(ctx.State, a, 0), out var v) ? (LuaValue)v : LuaValue.Nil));
            persist["has"] = F("has", (ctx, a) => ctx.Return(Persist.ContainsKey(Str(ctx.State, a, 0))));
            persist["delete"] = F("delete", (ctx, a) => { PersistChanged |= Persist.Remove(Str(ctx.State, a, 0)); return ctx.Return(); });
            persist["clear"] = F("clear", (ctx, a) => { PersistChanged |= Persist.Count > 0; Persist.Clear(); return ctx.Return(); });
            ic["persist"] = persist;

            static int Addr(LuaState lua, ReadOnlySpan<LuaValue> a)
            {
                var x = Num(lua, a, 0);
                return x >= 0 && x < MemorySize && x == Math.Floor(x) ? (int)x : throw new LuaRuntimeException(lua, $"memory address {x} is out of range 0..{MemorySize - 1}");
            }
            var memRead = F("mem_read", (ctx, a) => ctx.Return(Memory[Addr(ctx.State, a)]));
            var memWrite = F("mem_write", (ctx, a) => { Memory[Addr(ctx.State, a)] = Num(ctx.State, a, 1); MemoryChanged = true; return ctx.Return(); });
            var memClear = F("mem_clear", (ctx, a) => { Array.Clear(Memory); MemoryChanged = true; return ctx.Return(); });
            ic["mem_read"] = memRead;
            ic["mem_write"] = memWrite;
            ic["mem_clear"] = memClear;

            ic["host_info"] = F("host_info", (ctx, a) =>
            {
                if (housing == null)
                    return ctx.Return(LuaValue.Nil);
                var r = Info(housing);
                r["name"] = housing.Name;
                r["type"] = housing.PrefabName;   // provisional: W0b P4 compares host_info with the housing's device info
                return ctx.Return(r);
            });

            var json = new LuaTable();
            json["encode"] = F("encode", (ctx, a) =>
            {
                try { return ctx.Return(Encode(a.Length > 0 ? a[0] : LuaValue.Nil)); }
                catch (Exception e) when (e is InvalidOperationException or ArgumentException) { throw new LuaRuntimeException(ctx.State, "json.encode: " + e.Message); }
            });
            json["decode"] = F("decode", (ctx, a) =>
            {
                try { return ctx.Return(Decode(Str(ctx.State, a, 0))); }
                catch (JsonException e) { throw new LuaRuntimeException(ctx.State, "json.decode: " + e.Message); }
            });
            var util = new LuaTable();
            util["clock_time"] = F("clock_time", (ctx, a) => ctx.Return(ClockTime(a.Length > 0 && a[0].Type == LuaValueType.String ? a[0].Read<string>() : "HH:MM")));
            util["game_time"] = F("game_time", (ctx, a) => ctx.Return(GameSeconds));
            util["time_of_day"] = F("time_of_day", (ctx, a) => ctx.Return(TimeOfDay));
            util["days_past"] = F("days_past", (ctx, a) => ctx.Return(Math.Floor(GameSeconds / dayLength)));
            util["json"] = json;

            var env = lua.Environment;
            env["ic"] = ic;
            env["hash"] = hash;
            env["device_list"] = list;   // the guide's global spelling
            env["mem_read"] = memRead;
            env["mem_write"] = memWrite;
            env["mem_clear"] = memClear;
            env["util"] = util;
            // P2, measured 2026-10-11: JSON is available only as util.json, with no global alias.
            env["time"] = F("time", (ctx, a) => ctx.Return(GameSeconds));
        }
    }
}
