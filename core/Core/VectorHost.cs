// Ported from scripted-screens-vector v0.11.118 VectorElementPatch.cs (MIT) lines 63-357 and 465-604; keep in step with the pin.
using System;
using System.Collections.Generic;
using System.Linq;
using ScriptedScreensVector;
using SS = ScriptedScreens.ScriptableUi.ScriptedScreensScriptableUiSystem;

namespace VectorBuilder.Core
{
    /// <summary>
    /// The vector mod's pairing, as its ApplyElementInternal postfix does it: elements of type <c>vector</c>, classified
    /// as data (<c>data</c>/<c>nodes</c>) or structure (<c>root</c>/<c>src</c>), paired by <c>surface/scene</c>.
    /// The fake host calls <see cref="Upsert"/> at each flush, once per element changed since the last one
    /// (<see cref="FakeScriptedScreens.Flush"/>).
    /// </summary>
    public sealed class VectorHost
    {
        const string ElementType = "vector";

        readonly Func<double> clock;

        // Every structure element's own scene, by (surface, element id); created on its first structure upsert.
        readonly Dictionary<(string Surface, string Id), (LiveScene Live, ElementRecord Record)> elements = new();

        /// <summary>Structure scenes by "surface/sceneId", so data elements can find them. Last writer wins.</summary>
        readonly Dictionary<string, LiveScene> scenes = new(StringComparer.Ordinal);

        /// <summary>Data that arrived before its structure: either order must work.</summary>
        readonly Dictionary<string, EvalContext> pending = new(StringComparer.Ordinal);

        /// <summary>Nodes patches whose structure has not arrived wait (0.11.82), merged per node id and prop (0.11.90).</summary>
        readonly Dictionary<string, (SS.UiProp[] Props, SS.UiProp[] Last)> pendingPatches = new(StringComparer.Ordinal);

        internal VectorHost(Func<double> clock) => this.clock = clock;

        float Now() => (float)clock();

        internal LiveScene? SceneOf(string surface, string elementId) =>
            elements.TryGetValue((surface, elementId), out var e) ? e.Live : null;

        /// <summary>True when the element's scene is the one registered under its key; in game an older host is deactivated.</summary>
        internal bool IsActive(string surface, string elementId) =>
            SceneOf(surface, elementId) is { } live && scenes.TryGetValue(live.Key, out var registered) && registered == live;

        internal void Upsert(string surface, ElementRecord element)
        {
            try
            {
                if (!string.Equals(element.Type, ElementType, StringComparison.OrdinalIgnoreCase))
                    return;

                var props = element.UiProps;
                var sceneId = ReadString(props, "scene") ?? element.Id;
                var key = surface + "/" + sceneId;

                if (HasProp(props, "data") || HasProp(props, "nodes"))
                {
                    ApplyData(key, props);
                    return;
                }

                if (HasProp(props, "root") || HasProp(props, "src"))
                    ApplyStructure(surface, key, element, props, keepClock: false);
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                ScriptedScreensVectorPlugin.Log?.LogError($"vector element failed: {ex}");
            }
        }

        /// <summary>A surface's clear: its hosts are gone, so data for their keys waits for the next structure.</summary>
        internal void Clear(string surface)
        {
            foreach (var id in elements.Keys.Where(k => k.Surface == surface).ToList())
            {
                var live = elements[id].Live;
                elements.Remove(id);
                if (scenes.TryGetValue(live.Key, out var registered) && registered == live)
                    scenes.Remove(live.Key);
            }
        }

        /// <summary>
        /// A beta ui:remove(id) or handle:remove(): that element's host is gone, as a clear does for each of a surface's, so data
        /// for its key waits for the next structure. Not ported: the vendored mod has no remove hook (it never prunes its scenes;
        /// data whose graphic's host has left the surface waits, which is what <see cref="Clear"/> models), and no doc says what a
        /// beta remove does to that host. Provisional until probe P17 (a beta remove of a vector element, then data for its scene
        /// and a re-declaration, captured).
        /// </summary>
        internal void Remove(string surface, string elementId)
        {
            if (elements.Remove((surface, elementId), out var e) && scenes.TryGetValue(e.Live.Key, out var registered) && registered == e.Live)
                scenes.Remove(e.Live.Key);
        }

        /// <summary>
        /// The editor's hot-swap (M1 ruling 8): merges <paramref name="src"/> into the structure element's props and
        /// re-parses it like a structure upsert, keeping its clock and data: another <c>src</c> installs a new scene (node
        /// patches are lost), and the same <c>src</c> is nothing to do, as in game since 0.11.74. No chip sends it.
        /// False, changing nothing, when the element has no live scene.
        /// </summary>
        public bool HotSwap(string surface, string elementId, string src)
        {
            if (!elements.TryGetValue((surface, elementId), out var e))
                return false;

            e.Record.Write("src", src);
            ApplyStructure(surface, e.Live.Key, e.Record, e.Record.UiProps, keepClock: true);
            return true;
        }

        void ApplyStructure(string surface, string key, ElementRecord element, SS.UiProp[] props, bool keepClock)
        {
            // `src` is the text form. It is converted to the same props the table form
            // arrives as and parsed by the same code, so the two cannot diverge.
            var source = ReadString(props, "src");

            // The same text again is nothing to do (0.11.74): identical text is identical geometry, so the scene standing is
            // this one, and its clock and node patches stay. Only the text form; a table form re-installs on every upsert.
            if (!string.IsNullOrEmpty(source) && elements.TryGetValue((surface, element.Id), out var standing)
                && string.Equals(standing.Live.StructureText, source, StringComparison.Ordinal))
                return;

            // A blank src means the table form beside it; anything else goes to the parser, and null back is a refusal
            // (0.11.96). A refused src is reported even where a root beside it draws, which used to hide it.
            var parsed = string.IsNullOrWhiteSpace(source)
                ? props
                : SceneText.ToProps(source!, ReadString(props, "scene"));
            var refused = parsed == null ? SceneText.Rejected ?? "the scene text could not be read" : null;

            var scene = SceneParser.Parse(parsed ?? props);

            // A scene that will not parse must SAY so: it draws the magenta border any other scene problem does.
            if (scene == null)
            {
                scene = new VecScene { Id = ReadString(props, "scene") ?? "?" };
                scene.Problem(refused ?? "the scene could not be read");
            }
            else if (refused != null)
            {
                scene.Problem($"src: {refused}");
            }

            var now = Now();
            if (!elements.TryGetValue((surface, element.Id), out var e))
                e = (new LiveScene(element.Id), element);
            elements[(surface, element.Id)] = (e.Live, element);

            var live = e.Live;
            live.SetScene(scene, now, keepClock);
            live.StructureText = source;

            // Last writer wins; the scene it replaced is deactivated (IsActive). Snapshot/ContinueClockFrom, which carry
            // data and clock to a different graphic with equal text (a capture rebuild), are not ported.
            live.Key = key;
            scenes[key] = live;

            // The patch first, then the data: the order they would have arrived in (0.11.82).
            if (pendingPatches.Remove(key, out var patch))
                SceneParser.PatchNodes(patch.Props, live.Scene);
            if (pending.Remove(key, out var waiting))
                live.ApplyData(waiting, now);
        }

        void ApplyData(string key, SS.UiProp[] props)
        {
            var context = new EvalContext();
            SceneParser.ReadData(props, context);

            if (scenes.TryGetValue(key, out var live))
            {
                // A geometry patch is applied to the live scene, first; it is not evaluator data.
                SceneParser.PatchNodes(props, live.Scene);
                if (HasProp(props, "data"))
                    live.ApplyData(context, Now());
            }
            else
            {
                // No structure yet: the payload's data waits, and so does its nodes patch (0.11.82; it used to be dropped).
                // Merged, not assigned (0.11.90): an overwrite dropped the earlier of two patches queued before the structure.
                // The first is cloned, unlike the mod's: ElementRecord.UiProps is overwritten in place.
                if (HasProp(props, "nodes") || HasProp(props, "keep") || HasProp(props, "snap") || HasProp(props, "ease"))
                {
                    var copy = (SS.UiProp[])props.Clone(); // ElementRecord reuses its props array.
                    if (!pendingPatches.TryGetValue(key, out var queued))
                        pendingPatches[key] = (copy, copy);
                    else if (!UiProps.Equal(queued.Last, props))
                        pendingPatches[key] = (MergeProps(queued.Props, copy), copy);
                }
                if (HasProp(props, "data"))
                {
                    if (pending.TryGetValue(key, out var waiting))
                        waiting.MergeFrom(context);   // as the mod merges waiting payloads: a later one without keep = 1 replaces
                    else
                        pending[key] = context;
                }
            }
        }

        /// <summary>Two prop sets as one, later winning per key, except `nodes`, which merges per node id (0.11.90).</summary>
        static SS.UiProp[] MergeProps(SS.UiProp[] earlier, SS.UiProp[] later)
        {
            if (earlier == null || earlier.Length == 0)
                return later;
            if (later == null || later.Length == 0)
                return earlier;

            var byKey = new Dictionary<string, SS.UiProp>(earlier.Length + later.Length, StringComparer.OrdinalIgnoreCase);
            foreach (var prop in earlier)
            {
                if (!string.IsNullOrEmpty(prop.Key))
                    byKey[prop.Key] = prop;
            }
            foreach (var prop in later)
            {
                if (string.IsNullOrEmpty(prop.Key))
                    continue;
                if (string.Equals(prop.Key, "nodes", StringComparison.OrdinalIgnoreCase) && byKey.TryGetValue(prop.Key, out var queued))
                {
                    byKey[prop.Key] = new SS.UiProp { Key = prop.Key, Value = MergeNodePatches(queued.Value, prop.Value) };
                    continue;
                }
                byKey[prop.Key] = prop;
            }
            var merged = new SS.UiProp[byKey.Count];
            byKey.Values.CopyTo(merged, 0);
            return merged;
        }

        /// <summary>Two `nodes` patches as one: per node id, then per property within a node, as if they arrived in turn.</summary>
        static SS.UiValue MergeNodePatches(SS.UiValue earlier, SS.UiValue later)
        {
            var earlierMap = SceneParser.NamedMap(earlier);
            var laterMap = SceneParser.NamedMap(later);
            if (earlierMap == null)
                return later;
            if (laterMap == null)
                return earlier;

            var byId = new Dictionary<string, SS.UiProp>(earlierMap.Length + laterMap.Length, StringComparer.Ordinal);
            foreach (var node in earlierMap)
            {
                if (!string.IsNullOrEmpty(node.Key))
                    byId[node.Key] = node;
            }
            foreach (var node in laterMap)
            {
                if (string.IsNullOrEmpty(node.Key))
                    continue;
                if (byId.TryGetValue(node.Key, out var before)
                    && before.Value.Type == SS.UiValueType.Map && before.Value.Map != null
                    && node.Value.Type == SS.UiValueType.Map && node.Value.Map != null)
                {
                    byId[node.Key] = new SS.UiProp
                    {
                        Key = node.Key,
                        Value = new SS.UiValue { Type = SS.UiValueType.Map, Map = MergeProps(before.Value.Map, node.Value.Map) },
                    };
                    continue;
                }
                byId[node.Key] = node;
            }
            var merged = new SS.UiProp[byId.Count];
            byId.Values.CopyTo(merged, 0);
            return new SS.UiValue { Type = SS.UiValueType.Map, Map = merged };
        }

        static bool HasProp(SS.UiProp[] props, string key) => Find(props, key) != null;

        static string? ReadString(SS.UiProp[] props, string key)
        {
            var value = Find(props, key);
            return value?.Type switch
            {
                SS.UiValueType.String => value.Value.String,
                SS.UiValueType.Number => value.Value.Number.ToString("0.#####", System.Globalization.CultureInfo.InvariantCulture),
                _ => null,
            };
        }

        static SS.UiValue? Find(SS.UiProp[] props, string key)
        {
            foreach (var prop in props)
            {
                if (string.Equals(prop.Key, key, StringComparison.OrdinalIgnoreCase))
                    return prop.Value;
            }

            return null;
        }

        /// <summary>An element's .NET props as the UiProps ScriptedScreens hands the mod.</summary>
        internal static SS.UiProp[] Props(IEnumerable<KeyValuePair<string, object>> map) =>
            map.Select(p => new SS.UiProp { Key = p.Key, Value = ToValue(p.Value) }).ToArray();

        internal static SS.UiValue ToValue(object value) => value switch
        {
            string s => new SS.UiValue { Type = SS.UiValueType.String, String = s },
            double or float or int or long => new SS.UiValue { Type = SS.UiValueType.Number, Number = Convert.ToSingle(value) },
            bool b => new SS.UiValue { Type = SS.UiValueType.Bool, Bool = b },
            IEnumerable<KeyValuePair<string, object>> map => new SS.UiValue { Type = SS.UiValueType.Map, Map = Props(map) },
            IEnumerable<object> list => new SS.UiValue { Type = SS.UiValueType.Array, Array = list.Select(ToValue).ToArray() },
            _ => default,
        };
    }
}
