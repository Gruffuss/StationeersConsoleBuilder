using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Lua;
using SS = ScriptedScreens.ScriptableUi.ScriptedScreensScriptableUiSystem;

namespace VectorBuilder.Core
{
    /// <summary>One element as the script declared it, and as set_props has merged it since.</summary>
    public sealed class ElementRecord
    {
        public string Id = "";
        public string Type = "";
        public Dictionary<string, object>? Rect;      // the def's raw `rect` table
        public Dictionary<string, object>? Style;     // the def's `style` table (a native element's look: panel, label)
        public Dictionary<string, object> Props = new();  // Lua tables converted to .NET: double, string, bool, List<object>, Dictionary<string, object>
        public int Order;                              // creation order; a re-declared element keeps its own
        internal bool Flushed;                         // an upsert of it has reached the host
        public Dictionary<string, LuaFunction> Handlers = new();   // "click" (on_click), "change" (on_change), or a handle's on(event, fn)
        internal int Upserts;                                      // upserts the host has received (tests count them per flush)

        // Props as the UiProps the vector mod reads, one slot per top-level key, converted when that key is written
        // (Replace, Write), so an upsert hands the host this array instead of re-converting every value. Write props
        // through these two only. `Values` counts the values Props holds, for the store's per-element cap.
        readonly List<SS.UiProp> uiProps = new();
        SS.UiProp[]? flushedProps;
        internal SS.UiProp[] UiProps
        {
            get
            {
                if (flushedProps == null)
                {
                    PropsWork += uiProps.Count;
                    flushedProps = uiProps.ToArray();
                }
                return flushedProps;
            }
        }
        internal int Values { get; private set; }
        internal long PropsWork { get; private set; }  // top-level property conversions and copies, for complexity checks
        readonly Dictionary<string, (int Slot, int Values)> slots = new();

        internal int ValuesOf(string key) => slots.TryGetValue(key, out var s) ? s.Values : 0;

        internal void Replace(Dictionary<string, object> props)
        {
            (Props, Values) = (props, 0);
            uiProps.Clear();
            uiProps.EnsureCapacity(props.Count);
            flushedProps = null;
            PropsWork += props.Count;
            slots.Clear();
            var slot = 0;
            foreach (var (key, value) in props)
            {
                var values = CountOf(value);
                slots[key] = (slot, values);
                uiProps.Add(new SS.UiProp { Key = key, Value = VectorHost.ToValue(value) });
                slot++;
                Values += values;
            }
        }

        internal void Write(string key, object value)
        {
            PropsWork++;
            var values = CountOf(value);
            var prop = new SS.UiProp { Key = key, Value = VectorHost.ToValue(value) };
            if (slots.TryGetValue(key, out var s))
            {
                uiProps[s.Slot] = prop;
                if (flushedProps != null) flushedProps[s.Slot] = prop;  // the mod keeps no reference to this array
                Values += values - s.Values;
            }
            else
            {
                s.Slot = uiProps.Count;
                if (uiProps.Count == uiProps.Capacity) PropsWork += uiProps.Count;
                uiProps.Add(prop);
                flushedProps = null;
                Values += values;
            }
            slots[key] = (s.Slot, values);
            Props[key] = value;
        }

        internal static int CountOf(object value) => value switch
        {
            string => 1,
            IEnumerable<KeyValuePair<string, object>> map => 1 + map.Sum(p => CountOf(p.Value)),
            IEnumerable<object> list => 1 + list.Sum(CountOf),
            _ => 1,
        };
    }

    /// <summary>
    /// The slice of ScriptedScreens' <c>ss.ui</c> a vector console script needs, written from the public
    /// API docs: surfaces, elements and their props, and handles whose <c>set_props</c> merges top-level keys.
    /// The store changes at once; the vector host sees the upserts in batches (<see cref="Flush"/>).
    /// </summary>
    public sealed class FakeScriptedScreens
    {
        readonly Dictionary<string, Dictionary<string, ElementRecord>> store = new();  // surface -> element id -> record
        readonly Dictionary<string, LuaTable> surfaceTables = new();
        readonly VectorHost host;
        int created;

        internal FakeScriptedScreens(VectorHost host) => this.host = host;

        public string ActiveSurface { get; private set; } = "";

        /// <summary>Beta ScriptedScreens: adds ui:remove(id) and handle:remove(). Set before the script runs.</summary>
        public bool Beta { get; set; }

        /// <summary>Each surface's virtual resolution (set_resolution). Rects do not follow it (ruling P14: no doc says how; probe P12).</summary>
        public Dictionary<string, (int w, int h)> Resolutions { get; } = new();

        // The UI events for the next tick (spec 7: at most 8 a tick, in arrival order) and the builder's page visits.
        readonly Queue<(string Surface, string Id, string Event, string Value, string Player)> events = new();
        readonly Queue<string> visits = new();

        /// <summary>A UI event for the next tick: the element's handler for <paramref name="event"/> ("click", "change") gets (value, player).</summary>
        public void Enqueue(string surface, string elementId, string @event, string value, string player = "preview") =>
            events.Enqueue((surface, elementId, @event, value, player));

        /// <summary>A page the builder visits (edit-mode page selection, M4's every-page check): VB.go(id) runs first in the next tick.</summary>
        public void QueueVisit(string pageId) => visits.Enqueue(pageId);

        /// <summary>A patch for a scene the chip has not built yet (ruling P19): VB.setSrc(surface, src) runs first in the next tick.</summary>
        public void QueueSrc(string surface, string src) => srcs.Enqueue((surface, src));
        readonly Queue<(string Surface, string Src)> srcs = new();

        /// <summary>Test only: each write the flush rule loses (a table prop written twice before a flush or dropped by a re-declaration
        /// before one, an id declared twice in one execution), the first <see cref="MaxLostWrites"/> of them: the core runs in the
        /// worker, where a chip that loses a write every tick would otherwise grow the list for the whole session.</summary>
        // Kept here so runtime and exported-fixture tests can detect table writes lost inside one merged upsert.
        public List<string> LostWrites { get; } = new();

        internal const int MaxLostWrites = 100;

        void Lost(string line)
        {
            if (LostWrites.Count < MaxLostWrites)
                LostWrites.Add(line);
        }

        /// <summary>Test-only late-host fault injection. P2, measured 2026-10-11: the default surface is available at load; a late host was not observed.</summary>
        public bool NotReady { get; set; }

        public int PendingEvents => events.Count;

        internal List<string> TakeVisits()
        {
            var v = visits.ToList();
            visits.Clear();
            return v;
        }

        internal List<(string Surface, string Src)> TakeSrcs()
        {
            var v = srcs.ToList();
            srcs.Clear();
            return v;
        }

        /// <summary>Up to <paramref name="max"/> events, oldest first, each with the handler its element holds now. One whose element
        /// or handler is gone is dropped and still counts against the 8 (provisional: P10).</summary>
        internal List<(LuaFunction Fn, string Value, string Player)> TakeEvents(int max)
        {
            var due = new List<(LuaFunction, string, string)>();
            for (var n = 0; n < max && events.Count > 0; n++)
            {
                var (surface, id, ev, value, player) = events.Dequeue();
                if (store.TryGetValue(surface, out var elements) && elements.TryGetValue(id, out var e) && e.Handlers.TryGetValue(ev, out var fn))
                    due.Add((fn, value, player));
            }
            return due;
        }

        public (int w, int h) Size { get; set; } = (480, 480);  // what ui:size() returns for a surface not in Sizes

        /// <summary>Each surface's own size (a page's shape), by surface name.</summary>
        public Dictionary<string, (int w, int h)> Sizes { get; } = new();

        /// <summary>What ui:size() answers on <paramref name="surface"/>, and what its fraction rects are fractions of.</summary>
        public (int w, int h) SizeOf(string surface) => Sizes.TryGetValue(surface, out var s) ? s : Size;

        /// <summary>
        /// Replaces <see cref="Sizes"/> with the JSON map `{ "&lt;surface&gt;": [w, h] }` (the page's per-surface sizes). Input from
        /// outside: an entry whose value is not two whole numbers in int range is skipped on its own; a size is clamped to
        /// 1..8192; text that is not JSON, or a root that is not an object, leaves every surface at <see cref="Size"/>.
        /// </summary>
        public void SetSizes(string? json)
        {
            Sizes.Clear();
            JsonDocument doc;
            try { doc = JsonDocument.Parse(json ?? ""); }
            catch (JsonException) { return; }
            using (doc)
            {
                if (doc.RootElement.ValueKind != JsonValueKind.Object)
                    return;
                foreach (var p in doc.RootElement.EnumerateObject())
                    if (p.Value.ValueKind == JsonValueKind.Array && p.Value.GetArrayLength() == 2
                        && p.Value[0].ValueKind == JsonValueKind.Number && p.Value[1].ValueKind == JsonValueKind.Number  // TryGetInt32 throws on any other kind
                        && p.Value[0].TryGetInt32(out var w) && p.Value[1].TryGetInt32(out var h))
                        Sizes[p.Name] = (Math.Clamp(w, 1, 8192), Math.Clamp(h, 1, 8192));
            }
        }

        /// <summary>Every surface that has been declared, by the script or by <see cref="Declare"/>.</summary>
        public IEnumerable<string> SurfaceNames => store.Keys;

        public IReadOnlyList<ElementRecord> ElementsOf(string surface) =>
            store.TryGetValue(surface, out var elements) ? elements.Values.OrderBy(e => e.Order).ToList() : [];

        Dictionary<string, ElementRecord> Elements(string surface) =>
            store.TryGetValue(surface, out var elements) ? elements : store[surface] = new();

        /// <summary>The body of element{}: stores the element (replacing its def, keeping its order); the next flush tells the host.</summary>
        internal ElementRecord Declare(string surface, string id, string type, Dictionary<string, object>? rect, Dictionary<string, object> props,
            Dictionary<string, object>? style = null)
        {
            if (!declared.Add((surface, id)))
                Lost($"{surface}/{id}: declared twice before a flush");
            // The re-declaration replaces the element whole: a table prop written since the last flush that it does not carry is
            // gone (one it carries is a second write, which Written counts).
            if (tablesWritten.TryGetValue((surface, id), out var before))
                foreach (var key in TableProps)
                    if (before.Contains(key) && !props.ContainsKey(key))
                    {
                        Lost($"{surface}/{id}: {key} written then replaced by a re-declaration");
                        before.Remove(key);
                    }
            Written(surface, id, props.Keys);
            var elements = Elements(surface);
            if (!elements.TryGetValue(id, out var e))
                elements[id] = e = new ElementRecord { Id = id, Order = created++ };
            (e.Type, e.Rect, e.Style) = (type, rect, style);
            // Measured (upstream 890d135): a re-declaration replaces the whole def, so two element{} of one id in a batch
            // deliver only the second's props, not a per-prop union; one that omits `scene` pairs by its own id instead.
            e.Replace(props);
            Touch(surface, id);
            return e;
        }

        // ScriptedScreens' flush, measured in game (0.11.89, 0.11.91; upstream REFERENCE.md 890d135): the writes to one element
        // between two flushes reach the mod as ONE upsert of the element's merged state. set_props merges ordinary props (a prop
        // set earlier, the declaration's included, and not named again survives; the last writer of each wins); a table-valued
        // prop (`data`, `nodes`, `ease`) is one prop, replaced whole, so keep = 1 cannot save an earlier table; a re-declaration
        // replaces the element whole (Declare). A flush is ui:commit() or the end of any chip execution: the load and each tick
        // (ChipRunner). So declaring at load and patching in a tick keeps the declaration's data, while two writes of one table
        // prop in one execution lose the first unless a commit runs between them, which keeps both (measured, upstream 374651f).
        // The store itself changes at once, as ScriptedScreens' model does.
        readonly List<(string Surface, string Id)> dirty = new();
        readonly HashSet<(string Surface, string Id)> isDirty = new();
        readonly List<string> cleared = new();
        readonly List<(string Surface, string Id)> removed = new();  // beta removes, told to the host with the batch

        void Touch(string surface, string id)
        {
            if (isDirty.Add((surface, id)))
                dirty.Add((surface, id));
        }

        // The lost-write counter (LostWrites): the ids declared since the last flush, and per element the table props written
        // since. Two writes of one table prop merge into one upsert, so the host cannot see the first one go.
        static readonly string[] TableProps = ["data", "nodes", "ease"];
        readonly HashSet<(string Surface, string Id)> declared = new();
        readonly Dictionary<(string Surface, string Id), HashSet<string>> tablesWritten = new();

        void Written(string surface, string id, IEnumerable<string> keys)
        {
            foreach (var key in keys)
                if (TableProps.Contains(key))
                {
                    if (!tablesWritten.TryGetValue((surface, id), out var written))
                        tablesWritten[(surface, id)] = written = new();
                    if (!written.Add(key))
                        Lost($"{surface}/{id}: {key} written twice before a flush");
                }
        }

        /// <summary>Hands the host the batch: this batch's clears and removes, then one upsert per element changed, in first-change order.</summary>
        internal void Flush()
        {
            // Taken first, so a throw or a re-entry cannot deliver an element twice or leave the batch half pending.
            var clears = cleared.ToList();
            var removes = removed.ToList();
            var batch = dirty.ToList();
            cleared.Clear();
            removed.Clear();
            dirty.Clear();
            isDirty.Clear();
            declared.Clear();
            tablesWritten.Clear();
            foreach (var surface in clears)
                host.Clear(surface);
            foreach (var (surface, id) in removes)
                host.Remove(surface, id);
            foreach (var (surface, id) in batch)
                if (store.TryGetValue(surface, out var elements) && elements.TryGetValue(id, out var e))
                {
                    host.Upsert(surface, e);
                    e.Upserts++;
                    e.Flushed = true;
                }
        }

        internal delegate int Body(LuaFunctionExecutionContext ctx, ReadOnlySpan<LuaValue> args);

        // ss/api/surface: a surface or an activate with no name is "main" (docs/m1.md).
        static string NameOf(ReadOnlySpan<LuaValue> a) => a.Length > 0 && a[0].Type == LuaValueType.String ? a[0].Read<string>() : "main";

        internal void Install(LuaState lua, Dictionary<string, Dictionary<string, string>>? icons)
        {
            var ui = new LuaTable();
            if (icons != null)
            {
                var tables = new LuaTable();
                foreach (var (kind, entries) in icons)
                {
                    if (entries == null) continue;
                    var members = new LuaTable();
                    foreach (var (key, value) in entries)
                        if (value != null) members[key] = value;
                    tables[kind] = members;
                }
                ui["icons"] = tables;
            }
            ui["surface"] = Method(null, "surface", (ctx, a) => NotReady
                ? throw new LuaRuntimeException(ctx.State, "host not ready")
                : ctx.Return(Surface(NameOf(a))));
            ui["activate"] = Method(null, "activate", (ctx, a) => { ActiveSurface = NameOf(a); return ctx.Return(); });
            var ss = new LuaTable();
            ss["ui"] = ui;
            lua.Environment["ss"] = ss;
        }

        LuaTable Surface(string name)
        {
            if (surfaceTables.TryGetValue(name, out var t))
                return t;
            var elements = Elements(name);
            t = surfaceTables[name] = new LuaTable();
            t["clear"] = Method(t, "clear", (ctx, a) =>
            {
                elements.Clear();
                dirty.RemoveAll(d => d.Surface == name);
                isDirty.RemoveWhere(d => d.Surface == name);
                declared.RemoveWhere(d => d.Surface == name);
                foreach (var key in tablesWritten.Keys.Where(k => k.Surface == name).ToList())
                    tablesWritten.Remove(key);
                if (!cleared.Contains(name))
                    cleared.Add(name);
                return ctx.Return();
            });
            // Cross-surface commit scope is provisional, unprobed: compare two surfaces before end-of-execution flush.
            t["commit"] = Method(t, "commit", (ctx, a) => { Flush(); return ctx.Return(); });
            t["set_resolution"] = Method(t, "set_resolution", (ctx, a) =>
            {
                var w = a.Length > 0 && a[0].Type == LuaValueType.Number ? (int)a[0].Read<double>() : 0;
                var h = a.Length > 1 && a[1].Type == LuaValueType.Number ? (int)a[1].Read<double>() : 0;
                if (w <= 0 || h <= 0)
                    Resolutions.Remove(name);   // (0, 0) reverts to the physical size
                else
                    Resolutions[name] = (w, h);
                // P12, measured 2026-10-11: applies immediately and returns the setter function.
                return ctx.Return(t["set_resolution"]);
            });
            t["get_resolution"] = Method(t, "get_resolution", (ctx, a) =>
            {
                var (w, h) = Resolutions.TryGetValue(name, out var r) ? r : SizeOf(name);
                var size = new LuaTable();
                size["w"] = w;
                size["h"] = h;
                return ctx.Return(size);
            });
            t["size"] = Method(t, "size", (ctx, a) =>
            {
                // P12, measured 2026-10-11: size follows the virtual resolution, resetting to physical at (0, 0).
                var (w, h) = Resolutions.TryGetValue(name, out var r) ? r : SizeOf(name);
                var size = new LuaTable();
                size["w"] = w;
                size["h"] = h;
                return ctx.Return(size);
            });
            t["element"] = Method(t, "element", (ctx, a) =>
            {
                var def = a[0].Read<LuaTable>();
                var id = def["id"].Type == LuaValueType.String && def["id"].Read<string>() is { Length: > 0 } s
                    ? s : throw new LuaRuntimeException(ctx.State, "an element needs a non-empty id");
                var props = def["props"].TryRead<LuaTable>(out var table) ? ToMap(ctx.State, table) : new();
                CheckSize(ctx.State, props.Count, 0);  // its values are within the conversion's own budget, the same MaxValues
                // ss/api/element: the def's on_click and on_change are the element's handlers; a re-declaration replaces them.
                var handlers = new Dictionary<string, LuaFunction>();
                if (def["on_click"].TryRead<LuaFunction>(out var click))
                    handlers["click"] = click;
                if (def["on_change"].TryRead<LuaFunction>(out var change))
                    handlers["change"] = change;
                var e = Declare(name, id, def["type"].TryRead<string>(out var type) ? type : "",
                        def["rect"].TryRead<LuaTable>(out var rect) ? ToMap(ctx.State, rect) : null, props,
                        def["style"].TryRead<LuaTable>(out var style) ? ToMap(ctx.State, style) : null);
                e.Handlers = handlers;
                return ctx.Return(Handle(name, elements, id));
            });
            // An unknown id raises, as in game (docs/m1.md).
            t["get"] = Method(t, "get", (ctx, a) =>
            {
                var id = a[0].Read<string>();
                return elements.ContainsKey(id) ? ctx.Return(Handle(name, elements, id))
                    : throw new LuaRuntimeException(ctx.State, $"no element \"{id}\" on surface {name}");
            });
            if (Beta)
                t["remove"] = Method(t, "remove", (ctx, a) => { Remove(name, elements, a[0].Read<string>()); return ctx.Return(); });
            return t;
        }

        // Beta: an element removed by ui:remove(id) or handle:remove() leaves the store and the pending batch at once, and the
        // host at the next flush (before its upserts, so an id declared again after the remove is a new element there).
        // Provisional: no doc says what a beta remove does to the vector mod's host, and the vendored mod has no remove hook;
        // probe P17 (a beta remove of a vector element, then data for its scene and a re-declaration, captured) settles it.
        void Remove(string surface, Dictionary<string, ElementRecord> elements, string id)
        {
            if (elements.Remove(id))
                removed.Add((surface, id));
            dirty.Remove((surface, id));
            isDirty.Remove((surface, id));
            declared.Remove((surface, id));
            tablesWritten.Remove((surface, id));
        }

        LuaTable Handle(string surface, Dictionary<string, ElementRecord> elements, string id)
        {
            var h = new LuaTable();
            // In game set_props merges top-level keys, so `data` is replaced wholesale, and the next flush upserts the whole
            // element. A handle whose element was cleared changes nothing.
            h["set_props"] = Method(h, "set_props", (ctx, a) =>
            {
                if (elements.TryGetValue(id, out var e))
                {
                    var patch = ToMap(ctx.State, a[0].Read<LuaTable>());
                    CheckSize(ctx.State, e.Props.Count + patch.Keys.Count(k => !e.Props.ContainsKey(k)),
                              e.Values + patch.Sum(p => ElementRecord.CountOf(p.Value) - e.ValuesOf(p.Key)));
                    Written(surface, id, patch.Keys);
                    foreach (var (key, value) in patch)
                        e.Write(key, value);
                    Touch(surface, id);
                }
                return ctx.Return();
            });
            // A native element's look, merged per key as set_props merges props.
            h["set_style"] = Method(h, "set_style", (ctx, a) =>
            {
                if (elements.TryGetValue(id, out var e))
                {
                    e.Style ??= new();
                    foreach (var (key, value) in ToMap(ctx.State, a[0].Read<LuaTable>()))
                        e.Style[key] = value;
                    Touch(surface, id);
                }
                return ctx.Return();
            });
            // on(event, fn) sets the element's handler for that event ("click", "change"), replacing any; off(event) removes it.
            h["on"] = Method(h, "on", (ctx, a) =>
            {
                if (elements.TryGetValue(id, out var e) && a.Length > 1 && a[0].Type == LuaValueType.String && a[1].TryRead<LuaFunction>(out var fn))
                    e.Handlers[a[0].Read<string>()] = fn;
                return ctx.Return();
            });
            h["off"] = Method(h, "off", (ctx, a) =>
            {
                if (elements.TryGetValue(id, out var e) && a.Length > 0 && a[0].Type == LuaValueType.String)
                    e.Handlers.Remove(a[0].Read<string>());
                return ctx.Return();
            });
            if (Beta)
                h["remove"] = Method(h, "remove", (ctx, a) => { Remove(surface, elements, id); return ctx.Return(); });
            return h;
        }

        // Set by the chip: host code that runs out of memory ends the run where pcall cannot catch it (ChipRunner.Run).
        internal Action? OutOfMemory;

        // Works for both ui:f() and ui.f(): a first argument that is the object itself is dropped.
        internal LuaFunction Method(LuaTable? self, string name, Body body) => new(name, (ctx, _) =>
        {
            var args = ctx.Arguments;
            if (self != null && args.Length > 0 && args[0].TryRead<LuaTable>(out var first) && first == self)
                args = args[1..];
            try
            {
                return new ValueTask<int>(body(ctx, args));
            }
            catch (OutOfMemoryException)
            {
                OutOfMemory?.Invoke();
                throw;
            }
        });

        const int MaxDepth = 64, MaxValues = 100_000, MaxKeys = 4096;

        // An element holds at most MaxKeys top-level props and MaxValues values across them, checked before the store
        // changes. Every upsert hands the host the whole element, so one that only grew made each set_props cost more.
        static void CheckSize(LuaState lua, int keys, int values)
        {
            if (keys > MaxKeys)
                throw new LuaRuntimeException(lua, $"element props too large (over {MaxKeys} keys)");
            if (values > MaxValues)
                throw new LuaRuntimeException(lua, $"element props too large (over {MaxValues} values)");
        }

        // `path` holds the tables from the root down to this one, so its size is the depth. A table already on it is a
        // cycle (`t.me = t`), which would recurse until the stack overflows and ends the runtime: both are Lua errors
        // instead, catchable by pcall like any other. A table reached twice by separate paths is shared, not cyclic, and
        // converts once per path, so `values` counts every value converted: 30 levels of `{ l = a, r = a }` would
        // otherwise expand to 2^31 values and run the heap out, in a host-side walk the Lua budget does not meter.
        static Dictionary<string, object> ToMap(LuaState lua, LuaTable table)
        {
            var values = 0;
            return ToMap(lua, table, new(), ref values);
        }

        static Dictionary<string, object> ToMap(LuaState lua, LuaTable table, HashSet<LuaTable> path, ref int values)
        {
            Enter(lua, table, path);
            var map = new Dictionary<string, object>();
            foreach (var (key, value) in table)
                if (ToNet(lua, value, path, ref values) is { } v)
                    map[key.ToString()] = v;
            path.Remove(table);
            return map;
        }

        static List<object> ToList(LuaState lua, LuaTable table, HashSet<LuaTable> path, ref int values)
        {
            Enter(lua, table, path);
            var list = new List<object>();
            foreach (var (_, value) in table)
                list.Add(ToNet(lua, value, path, ref values)!);
            path.Remove(table);
            return list;
        }

        static void Enter(LuaState lua, LuaTable table, HashSet<LuaTable> path)
        {
            if (!path.Add(table))
                throw new LuaRuntimeException(lua, "props table is cyclic");
            if (path.Count > MaxDepth)
                throw new LuaRuntimeException(lua, $"props table is nested too deep (over {MaxDepth})");
        }

        // A table holding exactly 1..n is a list; any other table is a map with string keys. Functions are not data.
        static object? ToNet(LuaState lua, LuaValue value, HashSet<LuaTable> path, ref int values)
        {
            if (++values > MaxValues)
                throw new LuaRuntimeException(lua, $"props table is too large (over {MaxValues} values)");
            return value.Type switch
            {
                LuaValueType.Number => value.Read<double>(),
                LuaValueType.String => value.Read<string>(),
                LuaValueType.Boolean => value.Read<bool>(),
                LuaValueType.Table when value.Read<LuaTable>() is var t && t.HashMapCount == 0 && t.ArrayLength > 0 && t.ArrayLength == t.Count()
                    => ToList(lua, t, path, ref values),
                LuaValueType.Table => ToMap(lua, value.Read<LuaTable>(), path, ref values),
                _ => null,
            };
        }
    }
}
