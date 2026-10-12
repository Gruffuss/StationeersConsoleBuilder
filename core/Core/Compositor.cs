using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Serialization;
using ScriptedScreensVector;
using UnityEngine;

namespace VectorBuilder.Core
{
    public readonly record struct FrameSpan(int Element, int Node, int First, int Count);  // Node = pre-order parse index, -1 if unknown

    public sealed record FrameShape(int First, float X0, float Y0, float X1, float Y1);
    public sealed record FrameElement(string Id, string Scene, float X, float Y, float W, float H, int FirstVertex, int VertexCount,
        FrameShape[]? Shapes = null /* shape bounds in surface px, for browser-measured text overlap */);

    public sealed record FrameText(int Element, int Node /* -1 if unknown */, string Text, float X, float Y, float W, float H, float Size,
        float[] Colour /* r,g,b,a 0..1 */, int Align, [property: JsonPropertyName("valign")] int VAlign, string? Font, bool Bold, float CharSpacing, int Fit,
        float MinSize, float Rotation /* game: degrees CCW */, bool Wrap, float LineHeight,
        float[]? Clip /* x,y,w,h surface px */, float[]? Shadow /* dx,dy,blur,r,g,b,a */, float OutlineWidth, float[]? OutlineColour,
        bool Kern, float[]? ExtraShadows /* 7 numbers a shadow, as Shadow */, float[]? InsetShadow /* as Shadow */,
        float[]? ClipPolygon /* x,y surface px; null when Clip is the whole clip */, float[]? Shear /* m00,m01,m10,m11, the label's space, y up */,
        int Cover /* the mod's box-based cut: every triangle from there on is drawn after the label */,
        int After = -1 /* earliest eligible shape vertex under ztext, element end otherwise; -1 for native labels */);

    public sealed record FrameProblem(int Element, string Message);
    public sealed record FrameImage(int Element, string Src, int First, int Count);

    public sealed record SurfaceFrame(float[] Positions /* x,y surface px, y down */, byte[] Colours /* rgba straight */,
        float[] Coverage, int[] Indices, FrameSpan[] Spans, FrameElement[] Elements, FrameText[] Text, FrameProblem[] Problems)
    {
        public float[] Edges { get; init; } = new float[Positions.Length / 2];
        public float[] StoredColours { get; init; } = new float[Positions.Length * 2];
        public float[] Uv { get; init; } = new float[Positions.Length];
        public FrameImage[] Images { get; init; } = [];
        public string[] Pending { get; init; } = [];
    }

    /// <summary>
    /// One surface as ScriptedScreens composes it: every vector structure element that draws, in z order, each emitted by
    /// the mod's tessellator into its own rect from its live scene and placed on the surface (px, origin top-left, y down),
    /// and ScriptedScreens' own panels (a quad) and labels (one FrameText), which have no scene.
    /// The surface clips; an element does not clip its own overflow, so nothing is clipped here.
    /// </summary>
    public static class Compositor
    {
        public static SurfaceFrame Compose(ChipRunner chip, string surface, float pixelsPerUnit, bool tagNodes)
        {
            var (width, height) = chip.Screens.SizeOf(surface);
            var now = (float)chip.Now;
            var positions = new List<float>();
            var colours = new List<byte>();
            var coverage = new List<float>();
            var indices = new List<int>();
            var spans = new List<FrameSpan>();
            var elements = new List<FrameElement>();
            var text = new List<FrameText>();
            var problems = new List<FrameProblem>();
            var uv = new List<float>();
            var edges = new List<float>();
            var stored = new List<float>();
            var images = new List<FrameImage>();
            var pending = new List<string>();
            var waiting = new HashSet<string>(StringComparer.Ordinal);

            // ReorderSurfaceElementsByZIndex: z_index ascending, ties in creation order. An element no flush has delivered,
            // a hidden one, one without area, and the older host of a shared scene id (deactivated in game) do not draw.
            // ponytail: only panel and label are drawn; the other ScriptedScreens types when a widget uses one
            var drawn = chip.Screens.ElementsOf(surface)
                .Where(e => e.Flushed && Visible(e.Props) && (Native(e.Type) || chip.Vectors.IsActive(surface, e.Id)))
                .Select(e => (Record: e, Rect: RectOf(e.Rect, width, height)))
                .Where(e => e.Rect.W > 0 && e.Rect.H > 0)
                .OrderBy(e => ZIndex(e.Record.Props)).ThenBy(e => e.Record.Order);

            foreach (var (record, (ex, ey, ew, eh)) in drawn)
            {
                var element = elements.Count;
                var first = positions.Count / 2;
                // A native has no tessellator to drop a bad vertex: a rect that is not finite (0/0, math.huge, or an x + w past
                // float's range) draws nothing and says so, so every frame position stays finite, as for a vector element.
                if (Native(record.Type) && !(float.IsFinite(ex) && float.IsFinite(ey) && float.IsFinite(ex + ew) && float.IsFinite(ey + eh)))
                {
                    elements.Add(new FrameElement(record.Id, "", ex, ey, ew, eh, first, 0));
                    problems.Add(new FrameProblem(element, $"{record.Type} not drawn: its rect is not finite"));
                    continue;
                }
                if (Is(record.Type, "panel"))
                {
                    elements.Add(new FrameElement(record.Id, "", ex, ey, ew, eh, first, 4));
                    Panel(record, ex, ey, ew, eh, positions, colours, coverage, indices);
                    uv.AddRange(new float[8]);
                    edges.AddRange(new float[4]);
                    stored.AddRange(new float[16]);
                    continue;
                }
                if (Is(record.Type, "label"))
                {
                    elements.Add(new FrameElement(record.Id, "", ex, ey, ew, eh, first, 0));
                    var (align, valign) = LabelAlign(record.Style?.GetValueOrDefault("align") as string);
                    var tc = StyleColour(record, "color", White);
                    text.Add(new FrameText(element, -1,
                        record.Props.GetValueOrDefault("text") switch { string s => s, double d => d.ToString(CultureInfo.InvariantCulture), _ => "" },
                        ex, ey, ew, eh, record.Style?.GetValueOrDefault("font_size") is double size ? (float)size : 16f,
                        [tc.r / 255f, tc.g / 255f, tc.b / 255f, tc.a / 255f], align, valign, null, false, 0f, 0, 0f, 0f, true, 0f,
                        null, null, 0f, null, true, null, null, null, null, first));  // every later element is drawn over it
                    continue;
                }

                var live = chip.Vectors.SceneOf(surface, record.Id)!;
                var builder = live.Builder;
                var scene = live.Key[(surface.Length + 1)..];  // the key is "surface/scene"

                live.Prepare(now);
                builder.Tint = null;  // MeshBuilder.Clear keeps it; Emit restores it while unwinding since 0.11.85, so this is a belt
                Tessellator.CoverageInUv = true;
                Tessellator.PixelEdgesAvailable = true;
                Tessellator.BakeFades = true;
                Tessellator.TagNodes = tagNodes;
                try
                {
                    Tessellator.Emit(builder, live.Scene, live.Context, new Rect(0f, 0f, ew, eh), pixelsPerUnit, true, live.Stats, new Rect(-ex, ey + eh - height, width, height), pixelEdges: VectorConfig.PixelEdges && !live.Scene.DebugNoPixelEdges);
                }
                catch (Exception error) when (error is not OutOfMemoryException)
                {
                    // One element's failure is its own problem, never the frame's. Emit resets the repeat state (0.11.81) and restores the tint (0.11.85) itself; the missing names are still ours to clear.
                    live.Context.Missing.Clear();  // Emit clears it only when it returns, so the next frame would report these
                    elements.Add(new FrameElement(record.Id, scene, ex, ey, ew, eh, first, 0));
                    foreach (var message in live.Scene.Problems)
                        problems.Add(new FrameProblem(element, message));
                    problems.Add(new FrameProblem(element, $"the scene could not be drawn: {error.GetType().Name}: {error.Message}"));
                    continue;
                }
                finally
                {
                    Tessellator.CoverageInUv = false;
                    Tessellator.BakeFades = false;
                    Tessellator.TagNodes = false;
                }

                // The builder is y up with its origin at the rect's min corner; the frame is surface px, y down.
                // Colours stay straight and unmultiplied: the shader multiplies alpha by coverage (uv1.x).
                var built = MeshAccess.PositionsOf(builder);
                var tints = MeshAccess.ColoursOf(builder);
                var uv1 = MeshAccess.CoverageOf(builder);
                var uv0 = MeshAccess.UvOf(builder);
                var uv2 = MeshAccess.StoredColoursOf(builder);
                var xy = new float[built.Count * 2];
                for (var v = 0; v < built.Count; v++)
                {
                    xy[v * 2] = ex + built[v].x;
                    xy[v * 2 + 1] = ey + (eh - built[v].y);
                    Color32 c = tints[v];
                    colours.Add(c.r);
                    colours.Add(c.g);
                    colours.Add(c.b);
                    colours.Add(c.a);
                    coverage.Add(uv1[v].x);
                    edges.Add(uv1[v].y);
                    stored.AddRange([uv2[v].x, uv2[v].y, uv2[v].z, uv2[v].w]);
                    uv.Add(uv0[v].x);
                    uv.Add(uv0[v].y);
                }
                var triangles = new List<int>(MeshAccess.IndicesOf(builder));
                var dropped = Sanitise(xy, triangles);
                // Read ranges after sanitising: a dropped triangle must not shift an image onto the next shape.
                var indexAt = 0;
                foreach (var p in live.Stats.Images.OrderBy(p => p.ShapeIndex))
                {
                    if (p.ShapeIndex < 0)
                    {
                        if (waiting.Add(p.Src)) pending.Add(p.Src);
                        continue;
                    }
                    var start = builder.ShapeStart(p.ShapeIndex);
                    var end = builder.ShapeStart(p.ShapeIndex + 1);
                    while (indexAt < triangles.Count && triangles[indexAt] < start) indexAt += 3;
                    var from = indexAt;
                    while (indexAt < triangles.Count && triangles[indexAt] < end) indexAt += 3;
                    if (indexAt > from) images.Add(new FrameImage(element, p.Src, indices.Count + from, indexAt - from));
                }
                positions.AddRange(xy);
                foreach (var i in triangles)
                    indices.Add(first + i);
                var shapes = live.Scene.TextInOrder ? Enumerable.Range(0, builder.ShapeCount).Select(k =>
                {
                    var b = builder.ShapeBounds(k);
                    return new FrameShape(first + builder.ShapeStart(k), ex + b.xMin, ey + eh - b.yMax, ex + b.xMax, ey + eh - b.yMin);
                }).ToArray() : null;
                elements.Add(new FrameElement(record.Id, scene, ex, ey, ew, eh, first, built.Count, shapes));

                // What vector_stats counts as problems: the scene's, unresolved data names, and a starved build.
                foreach (var message in live.Scene.Problems)
                    problems.Add(new FrameProblem(element, message));
                foreach (var name in live.Stats.Missing)
                    problems.Add(new FrameProblem(element, $"unresolved data name ${name}"));
                if (live.Stats.Starved != null)
                    problems.Add(new FrameProblem(element, $"too large at this size: {live.Stats.Starved} was dropped"));
                if (dropped > 0)
                    problems.Add(new FrameProblem(element, "non-finite vertex dropped"));

                // NodeSpans is post-order and valid only until the next Emit, so it is read now. Without TagNodes it may
                // be a stale list from an earlier tagged Emit, so it is not read at all.
                var order = new Dictionary<VecNode, int>(ReferenceEqualityComparer.Instance);
                var labels = new List<Tessellator.NodeSpan>();
                if (tagNodes)
                {
                    Number(live.Scene.Root, order);
                    foreach (var s in Tessellator.NodeSpans)
                    {
                        spans.Add(new FrameSpan(element, order.GetValueOrDefault(s.Node, -1), first + s.First, s.Count));
                        if (s.Node.Op == VecOp.Text)
                            labels.Add(s);
                    }
                }

                // Placements carry no node at the pin, only the shape index they were collected at. A T emits no vertices,
                // so its span starts where the builder stood then: ShapeStart(k), which for k == ShapeCount is the last cut,
                // not the final vertex count (a problem's magenta marker comes after it and is no shape). Placements and T
                // spans pair up in list order by that vertex; an unpaired placement has no node. Misses: a skipped T inside a
                // run of T's, and a T inside a refining masked group, whose span the mod discards (0.11.73), so it gets node -1.
                // Under ztext the mod's own cut (TextOrder.Assign) puts a label under the first later shape whose bounds overlap
                // its box: every vertex from that shape's start on is drawn over it. Any other label is drawn after its element.
                if (live.Scene.TextInOrder)
                    TextOrder.Assign(live.Stats.Text, builder);
                foreach (var p in live.Stats.Text)
                {
                    var at = builder.ShapeStart(p.ShapeIndex);
                    var k = labels.FindIndex(s => s.First == at);
                    var node = k < 0 ? -1 : order.GetValueOrDefault(labels[k].Node, -1);
                    if (k >= 0)
                        labels.RemoveAt(k);
                    var r = p.Rect;
                    // The enclosing groups' tint, which the game applies per glyph vertex. The mod has already filtered the
                    // shadow colours (since before 0.11.83) and the outline colour (since 0.11.88) when placing the text, so only the label colour gets it here.
                    var tint = p.Tint;
                    var centre = new Vector3(r.x + r.width / 2, r.y + r.height / 2, 0f);  // canvas space, as the mask reads it
                    var colour = tint?.Apply(p.Colour, centre) ?? p.Colour;  // ponytail: the mask's alpha at the label's centre, not per glyph
                    static float[] Shadow7(VecShadow s) => [s.Dx, s.Dy, s.Blur, s.Colour.r, s.Colour.g, s.Colour.b, s.Colour.a];
                    text.Add(new FrameText(element, node, p.Text, ex + r.x, ey + (eh - r.yMax), r.width, r.height, p.Size,
                        [colour.r, colour.g, colour.b, colour.a], p.Align, p.VAlign, p.Font, p.Bold, p.CharSpacing, p.Fit,
                        p.MinSize, p.Rotation, p.Wrap, p.LineHeight,
                        p.ClipRect is { } clip ? [ex + clip.x, ey + (eh - clip.yMax), clip.width, clip.height] : null,
                        p.Shadow is { } sh ? Shadow7(sh) : null,
                        p.OutlineWidth,
                        p.OutlineWidth > 0 ? [p.OutlineColour.r, p.OutlineColour.g, p.OutlineColour.b, p.OutlineColour.a] : null,
                        p.Kern,
                        p.ExtraShadows is { Length: > 0 } extra ? extra.SelectMany(s => Shadow7(s)).ToArray() : null,
                        p.InsetShadow is { } inset ? Shadow7(inset) : null,
                        p.ClipPolygon?.SelectMany(v => new[] { ex + v.x, ey + (eh - v.y) }).ToArray(),
                        p.Shear is { } m ? [m.x, m.y, m.z, m.w] : null,
                        first + (live.Scene.TextInOrder && p.SliceDepth >= 0 ? p.CutVertex : built.Count),
                        first + (live.Scene.TextInOrder ? builder.ShapeStart(p.ShapeIndex) : built.Count)));
                }
            }

            return new SurfaceFrame(positions.ToArray(), colours.ToArray(), coverage.ToArray(), indices.ToArray(),
                spans.ToArray(), elements.ToArray(), text.ToArray(), problems.ToArray())
                { Uv = uv.ToArray(), Edges = edges.ToArray(), StoredColours = stored.ToArray(), Images = images.ToArray(), Pending = pending.ToArray() };
        }

        static bool Native(string type) => Is(type, "panel") || Is(type, "label");

        static readonly Color32 White = new(255, 255, 255, 255);

        static Color32 StyleColour(ElementRecord e, string key, Color32 fallback) =>
            e.Style?.GetValueOrDefault(key) is string s && ManagedColour.TryParse(s, out var c) ? (Color32)c : fallback;

        // ScriptedScreens' panel (format catalogue, host.element_types): style.bg, rgba(0.1, 0.1, 0.1, 0.8) by default; a
        // gradient runs from bg to style.gradient, top to bottom or (gradient_dir = horizontal) left to right. A quad, no feather.
        // ponytail: diagonal, radial and array gradients draw bg flat; add them when a theme or a widget uses one.
        static readonly Color32 PanelDefault = new(26, 26, 26, 204);

        static void Panel(ElementRecord e, float x, float y, float w, float h, List<float> positions, List<byte> colours,
            List<float> coverage, List<int> indices)
        {
            var first = positions.Count / 2;
            var from = StyleColour(e, "bg", PanelDefault);
            var dir = e.Style?.GetValueOrDefault("gradient_dir") as string;
            var to = Is(dir, "diagonal") || Is(dir, "radial") ? from : StyleColour(e, "gradient", from);  // an array is no string: flat too
            var horizontal = Is(dir, "horizontal");
            // top-left, top-right, bottom-right, bottom-left
            foreach (var (vx, vy, end) in new[] { (x, y, false), (x + w, y, horizontal), (x + w, y + h, true), (x, y + h, !horizontal) })
            {
                positions.Add(vx);
                positions.Add(vy);
                var c = end ? to : from;
                colours.AddRange([c.r, c.g, c.b, c.a]);
                coverage.Add(1f);
            }
            indices.AddRange([first, first + 1, first + 2, first, first + 2, first + 3]);
        }

        // ScriptedScreens' label: props.text (TMP rich text), style.font_size (16), style.color (white), style.align: left, center,
        // right (vertically middle), or top_ / bottom_ with one of the three. ponytail: the game font's drop shadow, which a label
        // always has, is not drawn: its offset and colour are not recorded. TMP wraps by default.
        static (int Align, int VAlign) LabelAlign(string? a)
        {
            var word = a?.ToLowerInvariant() ?? "left";
            var v = word.StartsWith("top_") ? 0 : word.StartsWith("bottom_") ? 2 : 1;
            var h = word.EndsWith("center") ? 1 : word.EndsWith("right") ? 2 : 0;
            return (h, v);
        }

        /// <summary>Zeroes every non-finite position and drops every triangle that uses one; returns how many it dropped.</summary>
        internal static int Sanitise(float[] xy, List<int> indices)
        {
            bool[]? bad = null;
            for (var v = 0; v < xy.Length / 2; v++)
            {
                if (float.IsFinite(xy[v * 2]) && float.IsFinite(xy[v * 2 + 1]))
                    continue;
                (bad ??= new bool[xy.Length / 2])[v] = true;
                xy[v * 2] = xy[v * 2 + 1] = 0f;
            }
            if (bad == null)
                return 0;

            var kept = 0;
            for (var t = 0; t + 2 < indices.Count; t += 3)
            {
                if (bad[indices[t]] || bad[indices[t + 1]] || bad[indices[t + 2]])
                    continue;
                indices[kept++] = indices[t];
                indices[kept++] = indices[t + 1];
                indices[kept++] = indices[t + 2];
            }
            var dropped = (indices.Count - kept) / 3;
            indices.RemoveRange(kept, indices.Count - kept);
            return dropped;
        }

        /// <summary>
        /// An element's rect in surface px (ScriptedScreens' ParseRect and ApplyRect). Only the named x, y, w, h and unit are
        /// read: "px"/"pixels" is px; "%"/"percent"/"percentage" is fractions x0.01; any other unit, or none, is fractions;
        /// units match in any case. A string field is trimmed; one ending in "%" is that fraction x0.01 and makes the whole
        /// rect fractions. Origin top-left, y down.
        /// </summary>
        internal static (float X, float Y, float W, float H) RectOf(Dictionary<string, object>? rect, int width, int height)
        {
            if (rect == null)
                return default;
            var unit = rect.GetValueOrDefault("unit") as string;
            var scale = Is(unit, "%") || Is(unit, "percent") || Is(unit, "percentage") ? 0.01f : 1f;
            var fractions = !Is(unit, "px") && !Is(unit, "pixels");
            float Field(string key)
            {
                switch (rect.GetValueOrDefault(key))
                {
                    case double d:
                        return (float)d * scale;
                    case string s when s.Trim().EndsWith('%'):
                        fractions = true;
                        return Parse(s.Trim()[..^1]) * 0.01f;
                    case string s:
                        return Parse(s) * scale;
                    default:
                        return 0f;
                }
            }
            static float Parse(string s) => float.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : 0f;

            var (x, y, w, h) = (Field("x"), Field("y"), Field("w"), Field("h"));
            return fractions ? (x * width, y * height, w * width, h * height) : (x, y, w, h);
        }

        static bool Is(string? a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

        /// <summary>The `visible` prop: false, 0, "0" or "false" in any case hides the element.</summary>
        internal static bool Visible(Dictionary<string, object> props) => props.GetValueOrDefault("visible") switch
        {
            false or 0d => false,
            string s => !Is(s, "false") && s != "0",
            _ => true,
        };

        /// <summary>The first `z_index` or `zIndex` prop, in any case: a number truncated, or an int string; else 0.</summary>
        internal static int ZIndex(Dictionary<string, object> props)
        {
            foreach (var (key, value) in props)
            {
                if (Is(key, "z_index") || Is(key, "zIndex"))
                    return value switch
                    {
                        double d => (int)d,
                        string s when int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var z) => z,
                        _ => 0,
                    };
            }
            return 0;
        }

        /// <summary>Parse order: a node before its children, USE-expanded children included. An explicit stack: since 0.11.85 a
        /// USE chain builds a tree as deep as the chain.</summary>
        static void Number(List<VecNode> roots, Dictionary<VecNode, int> order)
        {
            var pending = new Stack<VecNode>();
            for (var i = roots.Count - 1; i >= 0; i--)
                pending.Push(roots[i]);
            while (pending.Count > 0)
            {
                var node = pending.Pop();
                order[node] = order.Count;
                for (var i = node.Children.Count - 1; i >= 0; i--)
                    pending.Push(node.Children[i]);
            }
        }
    }
}
