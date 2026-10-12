using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using ScriptedScreensVector;
using UnityEngine;
using VectorBuilder.Core;

// The surface compositor and the VBF3 frame: element rects, z order, visibility, spans, text placements, problems.
static class FrameTests
{
    /// <summary>A scene text as a Lua props entry; the long string keeps its newlines.</summary>
    public static string Src(string src) => "src = [==[" + src + "]==]";

    /// <summary>A chip on a w x h surface that has run <paramref name="lua"/>, with `ui` = surface "main" in scope.</summary>
    public static ChipRunner Chip(string lua, int w, int h, Func<double>? clock = null)
    {
        var chip = new ChipRunner(clock: clock);
        chip.Screens.Size = (w, h);
        chip.LoadAsync("local ui = ss.ui.surface('main')\n" + lua).Wait();
        if (chip.State != ChipState.Running)
            throw new InvalidOperationException("test chip halted: " + chip.Error);
        return chip;
    }

    /// <summary>
    /// One structure element `s` with <paramref name="props"/> (a Lua table body), filling the surface unless a
    /// <paramref name="rect"/> is given, composed at <paramref name="t"/> seconds after its structure arrived.
    /// <paramref name="data"/> (a Lua table) goes to it through a data element.
    /// </summary>
    public static SurfaceFrame Draw(string props, int w, int h, double t = 0, string? data = null, bool tag = false, string? rect = null)
    {
        double now = 0;
        var chip = Chip(
            "ui:element({ id = 's', type = 'vector', rect = " + (rect ?? $"{{ unit = 'px', x = 0, y = 0, w = {w}, h = {h} }}")
            + ", props = { " + props + " } })\n"
            + (data == null ? "" : "ui:element({ id = 'd', type = 'vector', props = { scene = 's', data = " + data + " } })"),
            w, h, () => now);
        now = t;
        return Compositor.Compose(chip, "main", 1, tag);
    }

    static IEnumerable<float> Xs(SurfaceFrame f) => f.Positions.Where((_, i) => i % 2 == 0);

    static void RepinGeometry(Action<bool, string> check)
    {
        var triangle = new SurfaceFrame([0, 0, 10, 0, 0, 10], [255, 0, 0, 128, 255, 0, 0, 128, 255, 0, 0, 128],
            [0.5f, 0.5f, 0.5f], [0, 1, 2], [], [], [], []);
        var known = Sample(triangle, 2, 2);
        check(Math.Abs(known.R - 255) < 1e-6 && Math.Abs(known.A - 128 / 510.0) < 1e-6 && Sample(triangle, 9, 9).A == 0,
              "repin geometry: sampler multiplies coverage and alpha and rejects points outside the triangle");
        // Keep the fallback regressions beside default-path support and sampled-coverage twins.
        SurfaceFrame At(string node, float scale = 1) => Draw(Src("SCENE w=400 h=400 fit=stretch nopixeledges=1\n" + node), (int)(400 * scale), (int)(400 * scale), tag: true);
        SurfaceFrame PixelAt(string node, float scale = 1) => Draw(Src("SCENE w=400 h=400 fit=stretch\n" + node), (int)(400 * scale), (int)(400 * scale), tag: true);
        var rounded = At("R x=100 y=100 w=200 h=200 rx=9.5 f=#1D1D23 sh=[0,8,24,0,#000,inset]");
        var centre = Sample(rounded, 200.25f, 200.25f);
        var edge = Sample(rounded, 200.25f, 110.25f);
        check(centre.R > 28.5 && edge.R < 24, "repin geometry: rounded inset with blur wider than radius returns to the panel base");
        Console.WriteLine($"MEASURE headless rounded inset: edge R={edge.R:F2} A={edge.A:F3}; centre R={centre.R:F2} A={centre.A:F3} (undithered, unquantized linear blend)");

        var roundedPixel = PixelAt("R x=100 y=100 w=200 h=200 rx=9.5 f=#1D1D23 sh=[0,8,24,0,#000,inset]");
        check(Sample(roundedPixel, 200.25f, 200.25f).R > 28.5 && Sample(roundedPixel, 200.25f, 110.25f).R < 24
            && roundedPixel.Edges.Any(e => e != 0), "repin default: rounded inset keeps the base and uses pixel edges");
        foreach (var scale in new[] { 0.24f, 0.48f, 1.22f, 3f })
        {
            var rect = PixelAt("R x=100 y=100 w=200 h=200 rx=9.5 f=#fff", scale);
            var x = 100 * scale;
            check(Math.Abs(Xs(rect).Min() - (x - 2.6f)) < .02
                && Math.Abs(Sample(rect, x - .65f, 200 * scale).A - .5) < .02
                && Sample(rect, x - 1.4f, 200 * scale).A == 0,
                $"repin default: rounded rect support and 1.3 px coverage at {scale} px/unit");
            var hole = PixelAt("P d=\"M100 100 L300 100 L300 300 L100 300 Z M150 150 L150 250 L250 250 L250 150 Z\" f=#fff", scale);
            var inside = 150 * scale;
            check(Math.Abs(Sample(hole, inside + .65f, 200 * scale).A - .5) < .02
                && Sample(hole, inside + 1.4f, 200 * scale).A == 0
                && Sample(hole, inside - 1.4f, 200 * scale).A > .99,
                $"repin default: hole ring feathers inward by 1.3 px at {scale} px/unit");
        }

        foreach (var scale in new[] { 0.24f, 0.48f, 1.22f, 3f })
        foreach (var shape in new[] { "R x=100 y=100 w=200 h=200 rx=10", "C cx=200 cy=200 rx=100", "P d=\"M100 100 L300 100 L300 300 L100 300 Z\"" })
        {
            var baseline = At(shape + " f=none s=#fff sw=0 so=0 sh=[0,0,6,0,#000]", scale);
            foreach (var sw in new[] { 0, 6, 20 })
            {
                var outset = At(shape + $" f=none s=#fff sw={sw} so=0 sh=[0,0,6,0,#000]", scale);
                var inset = At(shape + $" f=none s=#fff sw={sw} so=0 sh=[0,0,6,0,#000,inset]", scale);
                var outside = Sample(outset, 200.25f * scale, (100 - sw / 2f - 1) * scale);
                var inside = Sample(inset, 200.25f * scale, (100 + sw / 2f + 1) * scale);
                check(Math.Abs(Xs(baseline).Min() - Xs(outset).Min() - sw / 2f * scale) < 0.15 && outside.A > 0.1 && inside.A > 0.1,
                      $"repin geometry: {shape[0]} sw={sw} scale={scale} outset/inset cast from the outer/inner stroke edge");
                Console.WriteLine($"MEASURE headless shadow {shape[0]} sw={sw} scale={scale}: extent X={Xs(outset).Min():F2}..{Xs(outset).Max():F2}px; A outside={outside.A:F3}, inside={inside.A:F3}");
                var expressed = At(shape + $" f=none s=#fff sw=={sw}+0*t so=0 sh=[0,0,6,0,#000]", scale);
                check(expressed.Positions.SequenceEqual(outset.Positions), $"repin geometry: {shape[0]} expression stroke width scale={scale} uses the same shadow spread");
            }
        }
        var scaled = At("G s=[2,2] { R x=50 y=50 w=100 h=100 rx=5 f=none s=#fff sw=10 so=0 sh=[0,0,3,0,#000] }");
        var equivalent = At("R x=100 y=100 w=200 h=200 rx=10 f=none s=#fff sw=20 so=0 sh=[0,0,6,0,#000]");
        check(scaled.Positions.Length > 0 && Math.Abs(Xs(scaled).Min() - Xs(equivalent).Min()) < 0.1,
              "repin geometry: scaled stroke/shadow extent matches equivalent scene units");

        foreach (var scale in new[] { 0.24f, 0.48f, 1.22f, 3f })
        {
            var hair = At("L p=[100,200,300,200] s=#5A5A69 sw=1", scale);
            var ys = hair.Positions.Where((_, i) => i % 2 == 1).ToArray();
            var width = ys.Max() - ys.Min();
            var pixel = Sample(hair, (float)Math.Floor(200 * scale) + 0.5f, (float)Math.Floor(200 * scale) + 0.5f);
            check(Math.Abs(width - (scale + 2 * Math.Min(1.3f, scale))) < 0.02
                  && hair.Colours.Where((_, i) => i % 4 == 3).Contains((byte)0) && hair.Colours.Where((_, i) => i % 4 == 3).Contains((byte)255),
                  $"repin geometry: hairline at {scale} px/unit keeps feather min(auto,width)");
            var pixelHair = PixelAt("L p=[100,200,300,200] s=#5A5A69 sw=1", scale);
            var py = pixelHair.Positions.Where((_, i) => i % 2 == 1).ToArray();
            check(Math.Abs(py.Max() - py.Min() - (scale + 5.2f)) < .02
                && Math.Abs(Sample(pixelHair, 200 * scale, 200 * scale + scale / 2 + Math.Min(1.3f, scale) / 2).A - .5) < .02,
                $"repin default: hairline support and pixel ramp at {scale} px/unit");
            Console.WriteLine($"MEASURE headless hairline scale={scale}: support={width:F3}px, nearest pixel R={pixel.R:F2} A={pixel.A:F3} (undithered, unquantized linear blend)");
        }

        // These are the geometry emitted by panel.ts and paint.ts well with Vanilla+ defaults, no shadow compensation.
        foreach (var (name, node, x, y) in new[] {
            ("Panel well", "R x=24.5 y=24.5 w=439 h=299 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[0,2,6,0,#0000008C,inset]", 200f, 28f),
            ("Bar horizontal", "R x=24.5 y=24.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1", 200f, 28f),
            ("Bar vertical", "R x=24.5 y=24.5 w=29 h=299 rx=3.5 f=#111116 s=#5A5A69 sw=1", 28f, 200f),
            ("Bar celled", "RP n=4 { R x==24.5+i*101 y=24.5 w=96 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1 }", 60f, 28f) })
        {
            var frame = Draw(Src("SCENE w=500 h=400 fit=stretch\n" + node), 500, 400);
            var sample = Sample(frame, x + 0.25f, y + 0.25f);
            check(frame.Problems.Length == 0 && sample.A > 0.99, $"repin geometry: Vanilla+ {name} geometry remains opaque without compensation");
            Console.WriteLine($"MEASURE headless Vanilla+ {name}: R={sample.R:F2} A={sample.A:F3} at {x + 0.25f},{y + 0.25f}");
        }

        Draw(Src("SCENE w=400 h=400 noeval=1\nR w=10 h=10"), 400, 400);
        var clipped = SceneParser.Parse(SceneText.ToProps("SCENE w=100 h=100\nDEFS { CP id=box { R w=80 h=60 } }\nG clip=box { R w=100 h=100 }", "s")!)!;
        check(clipped.Clips["box"].Max(p => p.x) == 80 && clipped.Clips["box"].Max(p => p.y) == 60,
              "repin geometry: noeval does not leak into the next scene's clip");
        foreach (var node in new[] { "R x=100 y=100 w=200 h=200 f=@radial", "G blur=6 { R x=100 y=100 w=200 h=200 f=#fff }" })
        {
            const string Defs = "DEFS { GR id=radial units=bbox cx=0.5 cy=0.5 r=0.5 stops=[[0,#fff],[1,#000]] }\n";
            var filled = At(Defs + node);
            var ablated = Draw(Src("SCENE w=400 h=400 nofill=1\n" + Defs + node), 400, 400);
            check(filled.Problems.Length == 0 && ablated.Problems.Length == 0
                  && Sample(filled, 200.25f, 200.25f).A > 0.9 && Sample(ablated, 200.25f, 200.25f).A == 0,
                  "repin geometry: nofill removes radial and blurred fill interiors (reference disagreement)");
            Console.WriteLine($"MEASURE headless nofill: centre alpha {Sample(filled, 200.25f, 200.25f).A:F3} -> {Sample(ablated, 200.25f, 200.25f).A:F3}; {node}");
        }
        var budget = At("RP n=50000 { RP n=21 { R w=1 h=1 v=0 } }");
        check(budget.Problems.Any(p => p.Message.Contains("too large to draw here")), "repin geometry: repeat work budget is reported even without vertices");
        var samples = At("LS n=3000000000 x==i y=200 s=#fff");
        check(samples.Problems.Any(p => p.Message.Contains("too large to draw here")), "repin geometry: excessive sample work reports its budget");
        var ring0 = At("C cx=200 cy=200 rx=50 f=#fff fea==1+t");
        var ring1 = Draw(Src("SCENE w=400 h=400\nC cx=200 cy=200 rx=50 f=#fff fea==1+t"), 400, 400, t: 1);
        check(ring0.Problems.Length == 0 && ring1.Problems.Length == 0 && !ring0.Positions.SequenceEqual(ring1.Positions),
              "repin geometry: animated ring feather still changes geometry");

        var ls = Chip("ui:element{ id='s',type='vector',rect={unit='px',w=240,h=240},props={" + Src(
            "SCENE w=240 h=240\nRP n=3 { LS id=ln n=4 click=1 press=1 x==20+i*40 y==30+i1*60 sw==4+4*i+4*i1+4*hover+4*down s=\"=mix(#000,#fff,n/4)\" }") + "},on_click=function(v) print(v) end}", 240, 240);
        Compositor.Compose(ls, "main", 1, false);
        var live = ls.Vectors.SceneOf("main", "s")!;
        check(live.Stats.Hits.Select(h => h.Id).SequenceEqual(new[] { "ln:0", "ln:1", "ln:2" })
              && live.Stats.Hits.Select(h => h.Rect.height).SequenceEqual(new[] { 4f, 8f, 12f }),
              "repin geometry: LS paint binds sample i=0/n=4 and preserves enclosing i1 and clickable ids");
        var pointer = new PointerInput(ls);
        pointer.Apply("main", 80, 90, "move");
        pointer.Apply("main", 80, 90, "down");
        var pressed = Compositor.Compose(ls, "main", 1, false);
        check(live.Stats.Hits.Select(h => h.Rect.height).SequenceEqual(new[] { 4f, 16f, 12f })
              && pressed.Colours.Chunk(4).Any(c => c[0] == 255 && c[1] == 255 && c[2] == 255),
              "repin geometry: repeated LS hover/down changes only the pressed instance and sample-count paint stays white");
        pointer.Apply("main", 80, 90, "up");
        ls.TickAsync().Wait();
        check(ls.Output.Contains("ln:1"), "repin geometry: repeated LS pointer click keeps its enclosing instance identity");
    }

    // Samples frame triangles in draw order; no dither or RGBA8 target rounding, so these are geometry checks, not captures.
    internal static (double R, double A) Sample(SurfaceFrame f, float x, float y)
    {
        double red = 0, alpha = 0;
        static double Linear(double c) => c <= 0.04045 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);
        for (var k = 0; k < f.Indices.Length; k += 3)
        {
            var a = f.Indices[k]; var b = f.Indices[k + 1]; var c = f.Indices[k + 2];
            var ax = f.Positions[2 * a]; var ay = f.Positions[2 * a + 1];
            var bx = f.Positions[2 * b]; var by = f.Positions[2 * b + 1];
            var cx = f.Positions[2 * c]; var cy = f.Positions[2 * c + 1];
            var area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
            if (Math.Abs(area) < 1e-8) continue;
            var u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / area;
            var v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / area;
            var w = 1 - u - v;
            if (u < 0 || v < 0 || w < 0) continue;
            // A shared edge belongs to one triangle, as in the GPU's top-left fill rule (positions are y down).
            bool TopLeft(float x0, float y0, float x1, float y1) => area > 0
                ? y1 < y0 || y1 == y0 && x1 > x0 : y1 > y0 || y1 == y0 && x1 < x0;
            if (u == 0 && !TopLeft(bx, by, cx, cy) || v == 0 && !TopLeft(cx, cy, ax, ay) || w == 0 && !TopLeft(ax, ay, bx, by)) continue;
            var coverage = u * f.Coverage[a] + v * f.Coverage[b] + w * f.Coverage[c];
            var ea = f.Edges[a]; var eb = f.Edges[b]; var ec = f.Edges[c];
            var dx = ((ea - ec) * (by - cy) + (eb - ec) * (cy - ay)) / area;
            var dy = ((ea - ec) * (cx - bx) + (eb - ec) * (ax - cx)) / area;
            coverage = EdgeRamp.Coverage((float)(u * ea + v * eb + w * ec), (float)Math.Sqrt(dx * dx + dy * dy),
                (float)coverage, 1.3f, (float)(1 - u * f.Uv[2 * a] - v * f.Uv[2 * b] - w * f.Uv[2 * c]));
            var opacity = (u * f.Colours[4 * a + 3] + v * f.Colours[4 * b + 3] + w * f.Colours[4 * c + 3]) / 255 * coverage;
            var marker = u * f.StoredColours[4 * a + 3] + v * f.StoredColours[4 * b + 3] + w * f.StoredColours[4 * c + 3];
            var colour = marker > .5 ? Linear(u * f.StoredColours[4 * a] + v * f.StoredColours[4 * b] + w * f.StoredColours[4 * c])
                : u * Linear(f.Colours[4 * a] / 255.0) + v * Linear(f.Colours[4 * b] / 255.0) + w * Linear(f.Colours[4 * c] / 255.0);
            red = colour * opacity + red * (1 - opacity);
            alpha = opacity + alpha * (1 - opacity);
        }
        if (alpha > 0) red /= alpha;
        return (255 * (red <= 0.0031308 ? red * 12.92 : 1.055 * Math.Pow(red, 1 / 2.4) - 0.055), alpha);
    }

    public static void Run(Action<bool, string> check)
    {
        RepinGeometry(check);
        // Example 01 as the game runs it: a panel backdrop, then one vector element at px 12..468.
        var example = new ChipRunner();
        example.Screens.Size = (480, 480);
        example.LoadAsync(File.ReadAllText(Path.Combine(Fixtures.Root, "..", "..", "core", "vendor", "vector", "examples", "01-hello.lua"))).Wait();
        var hello = Compositor.Compose(example, "main", 1, true);
        check(example.State == ChipState.Running && hello.Elements.Select(e => e.Id).SequenceEqual(["bg", "hello"]),
              "frame: example 01 composes its bg panel, then hello");
        var mine = hello.Elements.Single(e => e.Id == "hello");
        var helloXy = hello.Positions.Skip(2 * mine.FirstVertex).Take(2 * mine.VertexCount).ToArray();
        check(helloXy.Length > 0 && helloXy.All(p => p is >= 10f and <= 470f),
              "frame: example 01 lies within its rect 12..468, plus 2 px of feather");
        check(hello.Problems.Length == 0 && hello.Spans.Length > 0, "frame: example 01 has no problems, and has spans");

        // Native ScriptedScreens elements: a panel is a quad, a label one FrameText; neither has a scene.
        SurfaceFrame Native(string lua) => Compositor.Compose(Chip(lua + "\nui:commit()", 480, 480), "main", 1, false);
        IEnumerable<byte[]> ColoursOf(SurfaceFrame f) => f.Colours.Chunk(4);
        var panel = Native("ui:element({ id = 'p', type = 'panel', rect = { unit = 'px', x = 0, y = 0, w = 10, h = 10 } })");
        check(panel.Positions.Length == 8 && panel.Colours.Length == 16 && panel.Coverage.Length == 4 && panel.Indices.Length == 6
              && ColoursOf(panel).All(c => c.SequenceEqual(new byte[] { 26, 26, 26, 204 })) && panel.Coverage.All(c => c == 1f)
              && panel.Elements is [{ Scene: "", VertexCount: 4 }],
              "native: a panel is a quad in rgba(0.1, 0.1, 0.1, 0.8) by default, with no scene");
        bool Graded(SurfaceFrame f, Func<float, float, bool> start) => f.Positions.Length == 8 && f.Colours.Length == 16 && f.Coverage.Length == 4
            && ColoursOf(f).Select((c, v) => c.SequenceEqual(start(f.Positions[2 * v], f.Positions[2 * v + 1])
                ? new byte[] { 0x10, 0x20, 0x30, 255 } : new byte[] { 0x40, 0x50, 0x60, 255 })).All(b => b);
        const string GradedPanel = "ui:element({ id = 'p', type = 'panel', rect = { unit = 'px', x = 0, y = 0, w = 10, h = 10 }, style = { bg = '#102030', gradient = '#405060'";
        check(Graded(Native(GradedPanel + " } })"), (_, y) => y == 0f), "native: a panel's gradient runs from bg at the top to gradient at the bottom");
        check(Graded(Native(GradedPanel + ", gradient_dir = 'horizontal' } })"), (x, _) => x == 0f),
              "native: gradient_dir = horizontal runs it from the left to the right");
        check(Graded(Native(GradedPanel + ", gradient_dir = 'Diagonal' } })"), (_, _) => true) && Graded(Native(GradedPanel + ", gradient_dir = 'radial' } })"), (_, _) => true),
              "native: a diagonal or radial gradient draws bg flat (not modelled)");
        // The panel is declared first, so only its z_index puts it after the vector.
        var zNative = Native($$"""
            ui:element({ id = 'p', type = 'panel', rect = { unit = 'px', x = 0, y = 0, w = 10, h = 10 }, props = { z_index = 1 } })
            ui:element({ id = 'v', type = 'vector', rect = { unit = 'px', x = 0, y = 0, w = 100, h = 100 }, props = { z_index = 0, {{Src("SCENE w=100 h=100\nR x=0 y=0 w=100 h=100 f=#FFFFFF")}} } })
            """);
        check(zNative.Elements is [{ Id: "v", VertexCount: > 0 } zv, { Id: "p", VertexCount: 4 } zp] && zp.FirstVertex == zv.FirstVertex + zv.VertexCount
              && zNative.Indices[^6..].All(i => i >= zp.FirstVertex),
              "native: a panel declared first but at a higher z_index draws after (over) the vector below it");
        var natives = Native("""
            ui:element({ id = 'p', type = 'panel', rect = { unit = 'px', x = 0, y = 0, w = 10, h = 10 } })
            ui:element({ id = 't', type = 'label', rect = { unit = 'px', x = 0, y = 8, w = 460, h = 24 }, props = { text = 'one scene' },
                         style = { font_size = 14, color = '#5A7085', align = 'center' } })
            ui:element({ id = 'r', type = 'label', rect = { unit = 'px', x = 0, y = 0, w = 10, h = 10 }, props = { text = 5 }, style = { align = 'top_right' } })
            """);
        var (lt, lr) = (natives.Text.ElementAtOrDefault(0), natives.Text.ElementAtOrDefault(1));
        check(natives.Elements is [_, { Id: "t", Scene: "", VertexCount: 0 }, _] && natives.Text.Length == 2
              && lt is { Text: "one scene", X: 0f, Y: 8f, W: 460f, H: 24f, Size: 14f, Align: 1, VAlign: 1, Node: -1, Element: 1, Wrap: true, Kern: true }
              && lt.Colour.SequenceEqual([0x5A / 255f, 0x70 / 255f, 0x85 / 255f, 1f]),
              "native: a label is one FrameText with its text, rect, size, colour and alignment, and no node");
        check(lr is { Text: "5", Size: 16f, Align: 2, VAlign: 0, Element: 2 } && lr.Colour.SequenceEqual([1f, 1f, 1f, 1f]),
              "native: a label's numeric text is a string; align top_right is right and top; size 16 and white by default");
        var quiet = Chip("", 480, 480);
        quiet.Screens.Declare("main", "q", "panel", new() { ["unit"] = "px", ["x"] = 0d, ["y"] = 0d, ["w"] = 10d, ["h"] = 10d }, new());
        var notDrawn = Native("""
            ui:element({ id = 'h', type = 'panel', rect = { unit = 'px', x = 0, y = 0, w = 10, h = 10 }, props = { visible = false } })
            ui:element({ id = 'b', type = 'button', rect = { unit = 'px', x = 0, y = 0, w = 10, h = 10 }, props = { text = 'b' } })
            """);
        check(Compositor.Compose(quiet, "main", 1, false).Elements.Length == 0 && notDrawn.Elements.Length == 0 && notDrawn.Text.Length == 0,
              "native: a panel not yet flushed, a hidden panel and a button are not drawn");
        // A rect that is not finite, or whose x + w overflows float, draws nothing and says so; a sound panel beside it still draws.
        foreach (var rect in new[] { "x = 0/0, y = 0, w = 10, h = 10", "x = 0, y = 0, w = 1/0, h = 10", "x = 3e38, y = 0, w = 3e38, h = 10" })
        {
            var bad = Native($$"""
                ui:element({ id = 'p', type = 'panel', rect = { unit = 'px', {{rect}} } })
                ui:element({ id = 't', type = 'label', rect = { unit = 'px', {{rect}} }, props = { text = 'a' } })
                ui:element({ id = 'ok', type = 'panel', rect = { unit = 'px', x = 0, y = 0, w = 10, h = 10 } })
                """);
            check(bad.Positions.Length == 8 && bad.Positions.All(float.IsFinite) && bad.Text.Length == 0
                  && bad.Elements is [{ Id: "p", VertexCount: 0 }, { Id: "t" }, { Id: "ok", FirstVertex: 0, VertexCount: 4 }]
                  && bad.Problems is [{ Element: 0, Message: "panel not drawn: its rect is not finite" }, { Element: 1, Message: "label not drawn: its rect is not finite" }]
                  && Writes(bad),
                  $"native: a panel and a label at {rect} draw nothing and say so, and the frame still writes");
        }

        // These checks measure rect placement independently of the automatic band.
        const string Full = "SCENE w=100 h=100\nR x=0 y=0 w=100 h=100 f=#FFFFFF fea=0";
        var fractions = Draw(Src(Full), 200, 100, rect: "{ x = 0.5, y = 0, w = 0.5, h = 1 }");
        check(fractions.Positions.Length > 0 && Xs(fractions).All(x => x >= 98f), "frame: a rect without a unit is in fractions of the surface");
        var percent = Draw(Src(Full), 200, 100, rect: "{ x = '50%', y = 0, w = 0.5, h = 1 }");
        var forced = Draw(Src(Full), 200, 100, rect: "{ unit = 'px', x = '50%', y = 0, w = 0.5, h = 1 }");
        check(percent.Positions.Length > 0 && Xs(percent).All(x => x >= 98f) && forced.Positions.SequenceEqual(percent.Positions),
              "frame: a \"50%\" field makes the whole rect fractions, even under unit px");
        var padded = Draw(Src(Full), 200, 100, rect: "{ x = ' 50 % ', y = 0, w = 0.5, h = 1 }");
        check(padded.Positions.SequenceEqual(percent.Positions), "frame: a rect string is trimmed around its % and its number");

        var sized = new ChipRunner();
        sized.Screens.Size = (460, 460);
        sized.Screens.Sizes["wide"] = (1036, 460);
        sized.LoadAsync("""
            local a, b = ss.ui.surface("wide"):size(), ss.ui.surface("main"):size()
            print(a.w .. " " .. a.h .. " " .. b.w .. " " .. b.h)
            ss.ui.surface("wide"):element({ id = "s", type = "vector", rect = { x = 0, y = 0, w = 1, h = 1 }, props = { src = "SCENE w=10 h=10\nR x=0 y=0 w=10 h=10" } })
            ss.ui.surface("wide"):commit()
            """).Wait();
        var wide = Compositor.Compose(sized, "wide", 1f, false);
        check(sized.Output.Last() == "1036 460 460 460" && wide.Elements.Single().W == 1036f,
              "surfaces: ui:size() and fraction rects use each surface's own size");

        // SetSizes (Exports.Load's map) takes outside input: a bad entry is skipped on its own, a bad map sets nothing.
        foreach (var (json, want) in new (string?, string)[]
        {
            ("""{"a":[1036,460],"b":[480,1080]}""", "a=1036x460 b=480x1080"),
            ("""{"a":[0,-5],"b":[9000,2147483647]}""", "a=1x1 b=8192x8192"),
            ("""{"s":["x",1],"n":[null,1],"o":[{},1],"t":[true,1],"f":[1.5,2],"e":[1e10,2],"short":[1],"long":[1,2,3],"x":5,"good":[300,200]}""", "good=300x200"),
            ("[[1,2]]", ""), ("null", ""), ("5", ""), ("\"a\"", ""), ("{", ""), ("not json", ""), ("", ""), (null, ""),
        })
        {
            var screens = new ChipRunner().Screens;
            screens.Sizes["old"] = (1, 1);   // replaced, not added to
            screens.SetSizes(json);
            var got = string.Join(" ", screens.Sizes.OrderBy(s => s.Key, StringComparer.Ordinal).Select(s => $"{s.Key}={s.Value.w}x{s.Value.h}"));
            check(got == want, $"surfaces: SetSizes({json ?? "null"}) sets {(want == "" ? "nothing" : want)} (got \"{got}\")");
        }

        // Every unit lands on the same right half; units match in any case. Within 0.01 px: x0.01 is not exact in float.
        bool Same(float[] a, float[] b) => a.Length == b.Length && a.Zip(b).All(p => Math.Abs(p.First - p.Second) < 0.01f);
        foreach (var (unit, x, w) in new[] { ("%", 50, 50), ("percent", 50, 50), ("Percent", 50, 50), ("pixels", 100, 100), ("PX", 100, 100) })
        {
            var united = Draw(Src(Full), 200, 100, rect: $"{{ unit = '{unit}', x = {x}, y = 0, w = {w}, h = 100 }}");  // h: 100 % or 100 px
            check(united.Positions.Length > 0 && Xs(united).All(px => px >= 98f) && Same(united.Positions, fractions.Positions),
                  $"frame: unit '{unit}' places the rect as the game does");
        }

        var full = "{ unit = 'px', x = 0, y = 0, w = 100, h = 100 }";
        var z = Compositor.Compose(Chip($$"""
            ui:element({ id = 'A', type = 'vector', rect = {{full}}, props = { z_index = 1, {{Src(Full)}} } })
            ui:element({ id = 'B', type = 'vector', rect = {{full}}, props = { {{Src(Full)}} } })
            """, 100, 100), "main", 1, true);
        check(z.Elements.Select(e => e.Id).SequenceEqual(["B", "A"]), "frame: z_index orders elements before creation order does");
        // The key matches in any case and the first match wins: set_props appends ZINDEX after Z_Index, so 1 still stands.
        var zKeys = Chip($$"""
            a = ui:element({ id = 'A', type = 'vector', rect = {{full}}, props = { Z_Index = 1, {{Src(Full)}} } })
            ui:element({ id = 'B', type = 'vector', rect = {{full}}, props = { {{Src(Full)}} } })
            """, 100, 100);
        var zMixed = Compositor.Compose(zKeys, "main", 1, false);
        zKeys.LoadAsync("a:set_props({ ZINDEX = -5 })").Wait();
        var zFirst = Compositor.Compose(zKeys, "main", 1, false);
        check(zMixed.Elements.Select(e => e.Id).SequenceEqual(["B", "A"]) && zFirst.Elements.Select(e => e.Id).SequenceEqual(["B", "A"]),
              "frame: z_index and zIndex match in any case, and the first one wins");
        var second = z.Elements[1];
        check(second.FirstVertex > 0 && z.Indices.Max() >= second.FirstVertex && z.Spans.Any(s => s.Element == 1)
              && z.Spans.Where(s => s.Element == 1).All(s => s.First >= second.FirstVertex && s.First + s.Count <= second.FirstVertex + second.VertexCount),
              "frame: a later element's indices and spans are offset to its own vertices");

        var shared = Compositor.Compose(Chip($$"""
            ui:element({ id = 's1', type = 'vector', rect = {{full}}, props = { scene = 'k', {{Src(Full)}} } })
            ui:element({ id = 's2', type = 'vector', rect = {{full}}, props = { scene = 'k', {{Src(Full)}} } })
            """, 100, 100), "main", 1, false);
        check(shared.Elements.Select(e => e.Id).SequenceEqual(["s2"]), "frame: of two structures with one scene id, only the active (last) one draws");

        // One element's throw is its own problem: the others still draw, and the tint of the group it died in does not
        // leak into its next frame. The throw is injected: a null child, which Emit dereferences inside the inverting group.
        var throws = Chip($$"""
            ui:element({ id = 'bad', type = 'vector', rect = {{full}}, props = { {{Src("SCENE w=100 h=100\nG inv=1 { R x=0 y=0 w=10 h=10 f=#FFFFFF }\nR x=50 y=50 w=10 h=10 f=#FFFFFF")}} } })
            ui:element({ id = 'good', type = 'vector', rect = {{full}}, props = { {{Src(Full)}} } })
            """, 100, 100);
        var root = throws.Vectors.SceneOf("main", "bad")!.Scene.Root;
        root[0].Children.Add(null!);
        SurfaceFrame? Compose(ChipRunner chip) { try { return Compositor.Compose(chip, "main", 1, false); } catch (Exception) { return null; } }
        var failed = Compose(throws);
        root.RemoveAt(0);
        var healed = Compose(throws);
        check(failed is { Elements: [{ Id: "bad", VertexCount: 0 }, { Id: "good", VertexCount: > 0 }], Problems: [{ Element: 0 } problem] }
              && problem.Message.StartsWith("the scene could not be drawn: ") && healed != null
              && healed.Colours.Take(healed.Elements[0].VertexCount * 4).Chunk(4).Where(c => c[3] > 128).All(c => c[0] == 255 && c[1] == 255 && c[2] == 255),
              "frame: an element whose emit throws reports it, the others still draw, and its group's tint does not leak");

        // A throw inside an RP leaves its repeat pushed (the mod pushes and pops without a finally). The context outlives
        // the scene, so a later scene would read i and n from the dead repeat: x = (i + n) * 10 must stay 0, not 30.
        var repeat = Chip("ui:element({ id = 'r', type = 'vector', rect = " + full + ", props = { "
                          + Src("SCENE w=100 h=100\nRP n=3 { R x==i*10 y=0 w=5 h=5 f=#FFF }") + " } })", 100, 100);
        var repeated = repeat.Vectors.SceneOf("main", "r")!;
        repeated.Scene.Root[0].Children.Add(null!);
        var died = Compose(repeat);
        repeat.Vectors.HotSwap("main", "r", "SCENE w=100 h=100\nR x==(i+n)*10 y=0 w=5 h=5 f=#FFF");
        var after = Compose(repeat);
        check(died is { Problems: [{ Message: var diedOf }] } && diedOf.StartsWith("the scene could not be drawn: ") && repeated.Context.RepeatDepth == 0
              && after is { Problems: [] } && after.Positions.Length > 0 && Xs(after).All(x => x < 10f),
              "frame: a throw inside an RP leaves no repeat behind for later frames");

        // A throw still reports the scene's own problems, and the data names read before it do not reach a later frame
        // (the mod clears its missing names only when Emit returns).
        var missing = Chip("ui:element({ id = 'm', type = 'vector', rect = " + full + ", props = { "
                           + Src("SCENE w=100 h=100\nR x==$nope y=0 w=5 h=5 zz=1\nG { R x=0 y=0 w=5 h=5 }") + " } })", 100, 100);
        var dying = missing.Vectors.SceneOf("main", "m")!;
        var own = dying.Scene.Problems.ToArray();
        dying.Scene.Root[1].Children.Add(null!);
        var threw = Compose(missing);
        missing.Vectors.HotSwap("main", "m", "SCENE w=100 h=100\nR x=0 y=0 w=5 h=5 f=#FFF");
        var next = Compose(missing);
        var said = threw?.Problems.Select(p => p.Message).ToArray() ?? [];
        check(own.Length > 0 && said.Length == own.Length + 1 && said[..^1].SequenceEqual(own) && said[^1].StartsWith("the scene could not be drawn: ")
              && next is { Problems: [] },
              "frame: an element whose emit throws still reports its scene's problems, and leaves no missing names behind");

        // A throw in a concave clip's second piece leaves the mod's piece flag set, which hides every later label.
        // Set here as that throw would leave it; Compose must clear it before each Emit.
        MeshAccess.RepeatPiece(null) = true;
        var labelled = Draw(Src("SCENE w=100 h=100\nT x=0 y=0 w=50 h=10 text=A"), 100, 100);
        check(labelled.Text.Length == 1 && !MeshAccess.RepeatPiece(null), "frame: a piece flag left set by a throw does not hide later labels");
        MeshAccess.RepeatPiece(null) = false;

        // The widgets' hit plate (M2b rule E3): an unpainted R with an id and click=1 records one region and draws nothing.
        var plate = Chip("ui:element({ id = 'v', type = 'vector', rect = " + full + ", props = { "
                         + Src("R id=r click=1 x=0 y=0 w=10 h=10") + " } })\nui:commit()", 100, 100);
        var plated = Compositor.Compose(plate, "main", 1, false);
        check(plate.Vectors.SceneOf("main", "v")?.Stats.Hits is [{ Id: "r" }] && plated.Indices.Length == 0,
              "hit: an unpainted R with an id is a hit plate");

        // The widgets' holder (M2b final wave): a scene whose content all hides (an Alert at state 0) draws the mod's
        // empty-scene marker, unless an unpainted R with no id stands outside what hides; that R draws nothing itself.
        var held = Draw(Src("SCENE w=100 h=100\nR x=0 y=0 w=10 h=10\nG v=0 {\nR x=0 y=0 w=5 h=5 f=#FFFFFF\n}"), 100, 100);
        var bare = Draw(Src("SCENE w=100 h=100\nG v=0 {\nR x=0 y=0 w=5 h=5 f=#FFFFFF\n}"), 100, 100);
        check(held.Indices.Length == 0 && bare.Indices.Length > 0, "frame: an unpainted R keeps a scene whose content hides from the empty-scene marker");

        // A shadow's rings keep their colour's own alpha and carry their fade in coverage (CoverageInUv), unmultiplied.
        var shadow = Draw(Src("SCENE w=100 h=100\nR x=30 y=30 w=40 h=40 f=#FFFFFF sh=[[0,4,8,0,#000000]]"), 100, 100);
        check(shadow.Coverage.Where((c, v) => c < 0.5f && shadow.Colours[v * 4 + 3] == 255).Any(), "frame: coverage rides beside the colour, not in it");

        var hidden = Compositor.Compose(Chip(string.Join("\n",
            new[] { ("v1", "false"), ("v2", "0"), ("v3", "'false'"), ("v4", "'0'"), ("v5", "true"), ("v6", "'False'"), ("v7", "'FALSE'") }.Select(v =>
                $$"""ui:element({ id = '{{v.Item1}}', type = 'vector', rect = {{full}}, props = { visible = {{v.Item2}}, {{Src(Full)}} } })""")),
            100, 100), "main", 1, false);
        check(hidden.Elements.Select(e => e.Id).SequenceEqual(["v5"]),
              "frame: visible = false, 0, \"0\" or \"false\" in any case leaves the element out");

        var nested = Draw(Src("SCENE w=100 h=100\nG {\nR x=0 y=0 w=10 h=10 f=#FFF\n}\nR x=20 y=0 w=10 h=10 f=#FFF"), 100, 100, tag: true);
        var group = nested.Spans.FirstOrDefault(s => s.Node == 0);
        var inner = nested.Spans.FirstOrDefault(s => s.Node == 1);
        check(nested.Spans.Any(s => s.Node == 2) && inner.Count > 0 && group.First <= inner.First
              && inner.First + inner.Count <= group.First + group.Count, "frame: span nodes are pre-order parse indices; a group's span holds its child's");

        var twice = Chip("ui:element({ id = 's', type = 'vector', rect = " + full + ", props = { " + Src(Full) + " } })", 100, 100);
        var tagged = Compositor.Compose(twice, "main", 1, true);
        var untagged = Compositor.Compose(twice, "main", 1, false);
        check(tagged.Spans.Length > 0 && untagged.Spans.Length == 0, "frame: an untagged frame after a tagged one has no spans");

        var text = Draw(Src("SCENE w=100 h=100\nT x=10 y=20 w=50 h=10 text=HELLO size=8 f=#FF0000\nR x=0 y=50 w=10 h=10 f=#FFF\n"
                            + "T x=10 y=70 w=50 h=10 text=WORLD size=8 f=#FF0000"), 100, 100, tag: true);
        bool Near(float a, float b) => Math.Abs(a - b) < 0.01f;
        check(text.Text.Length == 2 && text.Text[0] is { Text: "HELLO", Node: 0 } t0 && Near(t0.X, 10) && Near(t0.Y, 20) && Near(t0.W, 50)
              && Near(t0.H, 10) && t0.Colour[0] == 1f, "frame: a T becomes a FrameText in surface px, y down, with its node");
        check(text.Text.Length == 2 && text.Text[1] is { Text: "WORLD", Node: 2 } t1 && Near(t1.Y, 70), "frame: a T after an R maps to its own node");
        // A scene with problems ends with the magenta marker, which is not a shape: the last T still pairs by ShapeStart.
        var flagged = Draw(Src("SCENE w=100 h=100\nR x=0 y=50 w=10 h=10 f=@nope\nT x=10 y=70 w=50 h=10 text=WORLD size=8 f=#FF0000"), 100, 100, tag: true);
        check(flagged.Problems.Length > 0 && flagged.Text is [{ Node: 1 }], "frame: the last T of a scene with problems keeps its node");

        // Where the game draws a label among the triangles (the preview's cover pass reads it): its Cover is the first frame
        // vertex drawn over it. Under ztext (the default) a label goes under the first later shape whose bounds overlap its
        // box (the mod's TextOrder); any other label goes after its element's geometry, under every later element.
        int StartOf(SurfaceFrame f, int node) => f.Spans.First(s => s.Node == node).First;
        int EndOf(SurfaceFrame f, int element) => f.Elements[element].FirstVertex + f.Elements[element].VertexCount;
        const string Corner = "R x=90 y=90 w=10 h=10 f=#FFFFFF\n", Label = "T x=10 y=10 w=50 h=20 text=A\n", Sheet = "R x=0 y=0 w=100 h=100 f=#FFFFFF\n";
        var under = Draw(Src("SCENE w=100 h=100\n" + Corner + Label + Sheet), 100, 100, tag: true);
        check(under.Text is [{ Cover: var uc }] && uc == StartOf(under, 2) && uc > 0 && uc < EndOf(under, 0),
              "ztext: a shape drawn after a label is drawn over it: the label's cover is that shape's first vertex");
        var above = Draw(Src("SCENE w=100 h=100\n" + Corner + Sheet + Label), 100, 100, tag: true);
        check(above.Text is [{ Cover: var ac }] && ac == EndOf(above, 0), "ztext: a shape drawn before a label is not drawn over it");
        var flat = Draw(Src("SCENE w=100 h=100 ztext=0\n" + Corner + Label + Sheet), 100, 100, tag: true);
        check(flat.Text is [{ Cover: var fc }] && fc == EndOf(flat, 0), "ztext=0: a label is drawn over its own element's shapes");
        var inkOnly = Draw(Src("SCENE w=480 h=480\nT y=60 h=60 text=\"j Ǻ\" size=120\nR y=140 w=100 h=80 f=#FFF"), 480, 480);
        var inkJson = JsonDocument.Parse(Decode(FrameWriter.Write(inkOnly)).Json).RootElement;
        check(inkJson.GetProperty("text")[0].TryGetProperty("after", out var inkAfter) && inkAfter.GetInt32() == 0
              && inkJson.GetProperty("elements")[0].TryGetProperty("shapes", out var inkShapes) && inkShapes.GetArrayLength() > 0
              && inkShapes[0].GetProperty("first").GetInt32() == 0 && inkShapes[0].GetProperty("y0").GetSingle() > 120,
              "ink covers: the frame carries later shape bounds and text insertion vertices without tagging nodes");
        var apart = Draw(Src("SCENE w=100 h=100\n" + Label + Corner), 100, 100, tag: true);
        check(apart.Text is [{ Cover: var pc }] && pc == EndOf(apart, 0), "ztext: a later shape whose bounds miss the label is not drawn over it");
        var leading = Draw(Src("SCENE w=100 h=100\n" + Label + Sheet), 100, 100, tag: true);
        check(leading.Text is [{ Cover: var lc }] && lc == StartOf(leading, 1) && lc == 0 && EndOf(leading, 0) > 0,
              "ztext: a label declared before the very first shape goes under it (the mod's leading empty slice): its cover is the element's first vertex");
        var stacked = Compositor.Compose(Chip($$"""
            ui:element({ id = 'A', type = 'vector', rect = {{full}}, props = { {{Src("SCENE w=100 h=100\n" + Label)}} } })
            ui:element({ id = 'B', type = 'vector', rect = {{full}}, props = { {{Src("SCENE w=100 h=100 ztext=0\n" + Sheet)}} } })
            ui:element({ id = 't', type = 'label', rect = {{full}}, props = { text = 'n' } })
            ui:element({ id = 'p', type = 'panel', rect = {{full}} })
            """, 100, 100), "main", 1, false);
        check(stacked.Elements is [{ Id: "A" }, { Id: "B" } b, { Id: "t" } nt, { Id: "p" } np] && stacked.Text is [{ Cover: var sa }, { Cover: var sn }]
              && sa == b.FirstVertex && sn == nt.FirstVertex && sn == np.FirstVertex && np.VertexCount == 4,
              "ztext: every later element is drawn over a label, a native label's too (UGUI draws a later sibling over an earlier one)");
        // The web's label texts (web/test/fixtures/labels.json, which paint.test.ts pins to literal() and plainTextProblem()):
        // [text, what literal() writes for it]. Printed by the mod, each must read as its text.
        var labels = JsonSerializer.Deserialize<string[][]>(File.ReadAllText(Path.Combine(Fixtures.Root, "fixtures", "labels.json")))!;
        var printed = Draw(Src("SCENE w=100 h=200\n" + string.Concat(labels.Select((l, k) => $"T x=0 y={k * 10} w=100 h=10 text=\"{l[1]}\" size=8\n"))), 100, 200);
        var printedText = printed.Text.Select(x => x.Text).ToArray();
        check(labels.Length > 8 && printedText.SequenceEqual(labels.Select(l => l[0]))
              && printed.Problems.Length == 2 && printed.Problems.All(p => p.Message.Contains("opens a placeholder")),
              $"frame: label templates print as written; two unclosed placeholders are reported (printed: {string.Join(" | ", printedText)})");

        // What a label carries beyond M1: every shadow, kerning, the enclosing groups' tint, the shear and the clip outline.
        bool Is(float[]? a, params float[] b) => a != null && a.Length == b.Length && a.Zip(b).All(p => Math.Abs(p.First - p.Second) < 0.001f);
        var shadows = Draw(Src("SCENE w=100 h=100\nT x=10 y=20 w=50 h=10 text=A sh=[[0,1,2,0,\"#000\"],[0,2,3,0,\"#F00\"],[1,1,1,0,\"#0F0\",inset]]"), 100, 100);
        check(shadows.Text is [var ts] && Is(ts.Shadow, 0, 1, 2, 0, 0, 0, 1) && Is(ts.ExtraShadows, 0, 2, 3, 1, 0, 0, 1) && Is(ts.InsetShadow, 1, 1, 1, 0, 1, 0, 1),
              "frame: a T carries its first shadow, its later outset shadows and its inset shadow");
        var kerned = Draw(Src("SCENE w=100 h=100\nT x=0 y=0 w=50 h=10 text=A\nT x=0 y=20 w=50 h=10 text=B kern=0"), 100, 100);
        check(kerned.Text is [{ Kern: true }, { Kern: false }], "frame: kern=0 turns a T's kerning off; it is on by default");
        var dimmed = Draw(Src("SCENE w=100 h=100\nG bri=0 {\n    T x=0 y=0 w=50 h=10 text=A f=#FFFFFF\n}"), 100, 100);
        check(dimmed.Text is [var td] && Is(td.Colour, 0, 0, 0, 1), "frame: an enclosing group's filters reach the label colour");
        var inverted = Draw(Src("SCENE w=100 h=100\nG inv=1 {\n    T x=0 y=0 w=50 h=10 text=A ow=1 oc=#000000 sh=[[0,1,2,0,\"#000\"],[0,2,3,0,\"#000\"],[1,1,1,0,\"#000\",inset]]\n}"), 100, 100);
        check(inverted.Text is [var ti] && Is(ti.OutlineColour, 1, 1, 1, 1) && Is(ti.Shadow, 0, 1, 2, 1, 1, 1, 1) && Is(ti.ExtraShadows, 0, 2, 3, 1, 1, 1, 1)
              && Is(ti.InsetShadow, 1, 1, 1, 1, 1, 1, 1),
              "frame: a group's filters reach the outline, and every shadow once (the mod filters those when it places the label)");
        // inv is its own inverse, so it cannot tell twice from none: bri=0.5 gives 1 for none, 0.5 once, 0.25 twice.
        var halved = Draw(Src("SCENE w=100 h=100\nG bri=0.5 {\n    T x=0 y=0 w=50 h=10 text=A f=#FFFFFF ow=1 oc=#FFFFFF\n}"), 100, 100);
        check(halved.Text is [var th] && Is(th.OutlineColour, 0.5f, 0.5f, 0.5f, 1) && Is(th.Colour, 0.5f, 0.5f, 0.5f, 1),
              "frame: a group's filter reaches a label's outline exactly once, as it does the label colour (0.11.88)");
        var sheared = Draw(Src("SCENE w=100 h=100\nG m=[1,0,0.5,1,0,0] {\n    T x=0 y=0 w=50 h=10 text=A\n}"), 100, 100);
        check(sheared.Text is [{ Shear: [_, var k01, var k10, _] }] && Math.Abs(Math.Max(Math.Abs(k01), Math.Abs(k10)) - 0.5f) < 0.001f,
              "frame: a T under a skewing matrix carries the shear");
        var round = Draw(Src("SCENE w=100 h=100\nDEFS {\n    CP id=o {\n        C cx=50 cy=50 rx=30 ry=30\n    }\n}\nG clip=o {\n    T x=30 y=45 w=40 h=10 text=A\n}"), 100, 100);
        check(round.Text is [{ Clip: [var cx, var cy, var cw, var ch], ClipPolygon: { Length: >= 16 } outline }] && outline.Length % 2 == 0
              && outline.Chunk(2).All(p => p[0] >= cx - 0.01f && p[0] <= cx + cw + 0.01f && p[1] >= cy - 0.01f && p[1] <= cy + ch + 0.01f),
              "frame: a T under a clip that is not a box carries the clip's outline, in surface px inside its clip box");
        var placed = Draw(Src("SCENE w=100 h=100\nDEFS {\n    CP id=k {\n        R x=0 y=0 w=50 h=50\n    }\n}\nG clip=k {\n    T x=10 y=20 w=30 h=10 text=A size=8\n}"),
                          300, 200, rect: "{ unit = 'px', x = 100, y = 50, w = 100, h = 100 }");
        check(placed.Text is [{ ClipPolygon: null } tp] && Near(tp.X, 110) && Near(tp.Y, 70) && Is(tp.Clip, 100, 50, 50, 50),
              "frame: a label and its box clip are placed from the element's origin");
        // An off-centre circle in an offset element: a missing y flip or origin would move the outline off its clip box.
        var ringed = Draw(Src("SCENE w=100 h=100\nDEFS {\n    CP id=o {\n        C cx=50 cy=20 rx=15 ry=15\n    }\n}\nG clip=o {\n    T x=40 y=15 w=20 h=10 text=A\n}"),
                          300, 200, rect: "{ unit = 'px', x = 100, y = 50, w = 100, h = 100 }");
        var ring = ringed.Text is [{ ClipPolygon: { Length: >= 16 } rp }] ? rp : [];
        float[] ringXs = [.. ring.Where((_, i) => i % 2 == 0)], ringYs = [.. ring.Where((_, i) => i % 2 == 1)];
        check(ringed.Text is [{ Clip: [var ox, var oy, var ow, var oh] }] && ring.Length >= 16
              && Math.Abs(ox - 135) < 0.5f && Math.Abs(oy - 55) < 0.5f && Math.Abs(ow - 30) < 0.5f && Math.Abs(oh - 30) < 0.5f
              && Near(ringXs.Min(), ox) && Near(ringXs.Max(), ox + ow) && Near(ringYs.Min(), oy) && Near(ringYs.Max(), oy + oh),
              "frame: a clip outline is placed from the element's origin, y down, spanning exactly its clip box");

        // The pin builds a tree as deep as a USE chain; numbering it must not recurse. 20,000 symbols, each using the next.
        var chainText = "SCENE w=100 h=100\nDEFS {\n"
            + string.Concat(Enumerable.Range(0, 20_000).Select(k => $"SYM id=s{k} {{\nUSE ref=s{k + 1}\n}}\n"))
            + "SYM id=s20000 {\nR x=0 y=0 w=10 h=10 f=#FFF\n}\n}\nUSE ref=s0";
        var chained = Draw(Src(chainText), 100, 100, tag: true);
        check(chained.Problems.Length == 0 && chained.Spans.Max(s => s.Node) == 20_001,
              "frame: a 20,000-deep USE chain draws, and its R is node 20,001 (the pin has no depth limit)");

        // 0.11.86: the src reader has no nesting limit (upstream measured 5,000 levels of blocks and of arrays).
        var levels = 5000;
        var deepText = "SCENE w=100 h=100\n" + string.Concat(Enumerable.Repeat("G {\n", levels)) + "R x=0 y=0 w=10 h=10 f=#FFF\n"
            + string.Concat(Enumerable.Repeat("}\n", levels));
        var deepArray = "SCENE w=100 h=100\nL p=" + new string('[', levels) + "0" + new string(']', levels);
        var deepDrawn = Draw(Src(deepText), 100, 100, tag: true);
        check(deepDrawn.Problems.Length == 0 && deepDrawn.Spans.Max(s => s.Node) == levels
              && ScriptedScreensVector.SceneText.ToProps(deepArray, "a") != null,
              "frame: the pin's src reader takes 5,000 nested blocks and an array 5,000 deep (0.11.86)");

        // 0.11.95: a deep number inside a colour expression (mix's blend factor, if's condition) recursed and overflowed the
        // stack at about 8,125 levels, which ends the process (here the preview's wasm worker). 12,000 levels of prefix `-`:
        // on 1, an even count is +1, so mix gives exactly its `to` colour and if takes its first branch; an odd count is -1,
        // which mix clamps to its `from` colour. A deep argument read as 0 would draw the other colour.
        var minus = new string('-', 12_000);
        // Every vertex carries the fill's rgb; the feather's outer ring has alpha 0, the body 255.
        bool Painted(SurfaceFrame f, byte r, byte g, byte b) => f.Problems.Length == 0 && f.Colours.Length > 0
            && f.Colours.Chunk(4).All(c => c[0] == r && c[1] == g && c[2] == b) && f.Colours.Chunk(4).Any(c => c[3] == 255);
        SurfaceFrame Square(string fill) => Draw(Src("SCENE w=10 h=10\nR w=10 h=10 f=\"=" + fill + "\""), 10, 10);
        check(Painted(Square("mix(#E23D3D,#5FD9A8," + minus + "1)"), 0x5F, 0xD9, 0xA8)
              && Painted(Square("mix(#E23D3D,#5FD9A8,-" + minus + "1)"), 0xE2, 0x3D, 0x3D),
              "frame: a 12,000-deep blend factor in mix() evaluates (+1 draws the to colour, -1 the from colour), with no problem (0.11.95)");
        check(Painted(Square("if(" + minus + "1,#5FD9A8,#E23D3D)"), 0x5F, 0xD9, 0xA8),
              "frame: a 12,000-deep condition in if() evaluates (non-zero takes the first branch), with no problem (0.11.95)");
        // 0.11.96: a gradient stop's $name the payload does not supply is listed with the other unresolved names, as a node's
        // is (Gradient.cs Resolve), so the frame names it as a problem; supplied, it is none.
        string Stop(string? data) => string.Join(" | ", Draw(Src("SCENE w=10 h=10\nDEFS {\nGL id=g stops=[[0,$c],[1,#fff]]\n}\nR w=10 h=10 f=@g"),
            10, 10, data: data).Problems.Select(p => p.Message));
        check(Stop(null) == "unresolved data name $c" && Stop("{ c = '#000' }") == "",
              $"frame: a gradient stop's missing $name is an unresolved data name, and a supplied one no problem (0.11.96) ({Stop(null)})");

        var valign = new SurfaceFrame([], [], [], [], [], [], [new FrameText(0, -1, "x", 0, 0, 1, 1, 8, [1, 1, 1, 1], 0, 2, null, false, 0, 0,
                                                                                6, 0, false, 0, null, null, 0, null, true, null, null, null, null, 0)], []);
        var label = JsonDocument.Parse(Decode(FrameWriter.Write(valign)).Json).RootElement.GetProperty("text")[0];
        check(label.TryGetProperty("valign", out var va) && va.GetInt32() == 2 && !label.TryGetProperty("vAlign", out _),
              "frame: FrameText.VAlign is written as valign");

        // The JSON keys the web decoder's types read (web/src/runtime/frame.test.ts checks them against the same list).
        var keysFile = Path.Combine(Fixtures.Root, "fixtures", "frames", "keys.json");
        var one = JsonDocument.Parse(Decode(FrameWriter.Write(valign with { Elements = [new FrameElement("e", "s", 0, 0, 1, 1, 0, 0)],
            Images = [new FrameImage(0, "data:x", 0, 0)] })).Json).RootElement;
        string[] Keys(JsonElement value) => value.EnumerateObject().Select(p => p.Name).ToArray();
        if (Fixtures.Write) File.WriteAllText(keysFile, JsonSerializer.Serialize(new
        {
            format = "VBF3", element = Keys(one.GetProperty("elements")[0]), text = Keys(one.GetProperty("text")[0]),
            image = Keys(one.GetProperty("images")[0]), body = Keys(one),
        }) + "\n");
        var pinned = File.Exists(keysFile) ? JsonDocument.Parse(File.ReadAllText(keysFile)).RootElement : default;
        bool Pinned(JsonElement written, string list) => pinned.ValueKind == JsonValueKind.Object
            && pinned.TryGetProperty(list, out var names) && Keys(written).SequenceEqual(names.EnumerateArray().Select(k => k.GetString()));
        check(Pinned(one.GetProperty("elements")[0], "element") && Pinned(one.GetProperty("text")[0], "text")
            && Pinned(one.GetProperty("images")[0], "image") && Pinned(one, "body") && pinned.GetProperty("format").GetString() == "VBF3",
              "frame: VBF3 records write exactly the JSON keys in test/fixtures/frames/keys.json");

        // Two triangles over six vertices; vertex 4 (in the second) has a NaN y.
        var xy = new float[] { 0, 0, 1, 0, 0, 1, 2, 2, 3, float.NaN, 2, 3 };
        var tris = new List<int> { 0, 1, 2, 3, 4, 5 };
        check(Compositor.Sanitise(xy, tris) == 1 && tris.SequenceEqual([0, 1, 2]) && xy.All(float.IsFinite),
              "frame: the sanitiser zeroes a non-finite position and drops the triangles that use it");
        var nan = Draw(Src("SCENE w=100 h=100\nR x==sqrt(-1) y=0 w=10 h=10 f=#FFF"), 100, 100);
        check(nan.Positions.All(float.IsFinite), "frame: a NaN x reaches no position");
        // ^ answers 0 where it has no value since 0.11.98, as / and % do, so no power poisons a vertex (until 0.11.97 0^-1
        // was infinity and the compositor dropped the vertex); a power with a value is unchanged.
        var power = Draw(Src("SCENE w=100 h=100\nR x==0^-1 y==(0-2)^0.5 w==2^999+10 h==-2^2+14 f=#FFF"), 100, 100);
        float Power(string x) => ScriptedScreensVector.Expression.Parse(x, -1f).Evaluate(new ScriptedScreensVector.EvalContext());
        check(power.Problems.Length == 0 && power.Indices.Length > 0 && power.Positions.All(float.IsFinite)
              && new[] { Power("0^-1"), Power("(0-2)^0.5"), Power("2^999"), Power("2^3"), Power("2^-3"), Power("-2^2") }.SequenceEqual([0f, 0f, 0f, 8f, 0.125f, -4f]),
              "frame: ^ with no value is 0, and draws a 10 by 10 square at the origin");
        // The mod keeps that one finite itself; an element rect at x = NaN reaches the sanitiser, and the JSON, for certain.
        var nanRect = Draw(Src("SCENE w=100 h=100\nR x=0 y=0 w=10 h=10 f=#FFF\nT x=0 y=20 w=50 h=10 text=A"), 100, 100,
                           rect: "{ unit = 'px', x = 0/0, y = 0, w = 100, h = 100 }");
        bool Writes(SurfaceFrame f) { try { return FrameWriter.Write(f).Length > 0; } catch (Exception) { return false; } }
        check(nanRect.Positions.Length > 0 && nanRect.Positions.All(float.IsFinite) && nanRect.Indices.Length == 0
              && nanRect.Problems.Any(p => p.Message == "non-finite vertex dropped") && float.IsNaN(nanRect.Text.Single().X) && Writes(nanRect),
              "frame: an element at x = NaN draws nothing, says so, and its frame still writes");

        var bytes = FrameWriter.Write(hello);
        var back = Decode(bytes);
        var body = JsonDocument.Parse(back.Json).RootElement;
        var element = body.GetProperty("elements")[1];
        check(Encoding.ASCII.GetString(bytes, 0, 4) == "VBF3" && back.Positions.SequenceEqual(hello.Positions) && back.Coverage.SequenceEqual(hello.Coverage)
              && back.Uv.SequenceEqual(hello.Uv) && back.Edges.SequenceEqual(hello.Edges) && back.StoredColours.SequenceEqual(hello.StoredColours)
              && back.Colours.SequenceEqual(hello.Colours) && back.Indices.SequenceEqual(hello.Indices) && back.Spans.SequenceEqual(hello.Spans)
              && body.GetProperty("elements").GetArrayLength() == 2 && element.GetProperty("id").GetString() == "hello"
              && element.GetProperty("firstVertex").GetInt32() == hello.Elements[1].FirstVertex
              && element.GetProperty("vertexCount").GetInt32() == hello.Elements[1].VertexCount
              && body.GetProperty("text").GetArrayLength() == hello.Text.Length && body.GetProperty("problems").GetArrayLength() == hello.Problems.Length,
              "frame: VBF3 decodes back to the same arrays and JSON");

        // The web decoder's fixture: rewrite it with --write-fixtures when the pin changes the bytes.
        var bin = Path.Combine(Fixtures.Root, "fixtures", "frames", "01-hello.bin");
        var expectPath = Path.ChangeExtension(bin, ".expect.json");
        if (Fixtures.Write)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(bin)!);
            File.WriteAllBytes(bin, bytes);
            File.WriteAllText(expectPath, JsonSerializer.Serialize(new
            {
                V = back.Positions.Length / 2, I = back.Indices.Length, S = back.Spans.Length, firstPositions = back.Positions.Take(8), coverage = back.Coverage,
                elementIds = hello.Elements.Select(e => e.Id), textCount = hello.Text.Length, problemCount = hello.Problems.Length,
            }) + "\n");
        }
        var committed = File.Exists(bin) ? Decode(File.ReadAllBytes(bin)) : default;
        var expect = File.Exists(expectPath) ? JsonDocument.Parse(File.ReadAllText(expectPath)).RootElement : default;
        var committedBody = committed.Json == null ? default : JsonDocument.Parse(committed.Json).RootElement;
        check(committed.Json != null && expect.ValueKind == JsonValueKind.Object
              && committed.Positions.Length / 2 == expect.GetProperty("V").GetInt32() && committed.Indices.Length == expect.GetProperty("I").GetInt32()
              && committed.Spans.Length == expect.GetProperty("S").GetInt32()
              && committed.Positions.Take(8).SequenceEqual(expect.GetProperty("firstPositions").EnumerateArray().Select(p => p.GetSingle()))
              && committedBody.GetProperty("elements").EnumerateArray().Select(e => e.GetProperty("id").GetString())
                     .SequenceEqual(expect.GetProperty("elementIds").EnumerateArray().Select(e => e.GetString()))
              && committedBody.GetProperty("text").GetArrayLength() == expect.GetProperty("textCount").GetInt32()
              && committedBody.GetProperty("problems").GetArrayLength() == expect.GetProperty("problemCount").GetInt32()
              && committed.Positions.Length == hello.Positions.Length && committed.Indices.Length == hello.Indices.Length
              && committed.Spans.Length == hello.Spans.Length,
              "frame: the committed 01-hello.bin decodes to its expected counts, and to this build's (else run --write-fixtures)");
    }

    /// <summary>A VBF1/VBF2/VBF3 reader, independent of FrameWriter: the layout as the format states it.</summary>
    public static (float[] Positions, float[] Coverage, float[] Uv, float[] Edges, float[] StoredColours, byte[] Colours, int[] Indices, FrameSpan[] Spans, string Json) Decode(byte[] b)
    {
        var magic = Encoding.ASCII.GetString(b, 0, 4);
        if (magic is not ("VBF1" or "VBF2" or "VBF3"))
            throw new InvalidDataException("not a VBF1, VBF2 or VBF3 frame");
        var head = MemoryMarshal.Cast<byte, int>(b.AsSpan(4, 16));
        int v = head[0], i = head[1], s = head[2], j = head[3], o = 20;
        T[] Take<T>(int count, int size) where T : struct
        {
            var part = MemoryMarshal.Cast<byte, T>(b.AsSpan(o, count * size)).ToArray();
            o += count * size;
            return part;
        }
        var positions = Take<float>(2 * v, 4);
        var coverage = Take<float>(v, 4);
        var edges = magic == "VBF3" ? Take<float>(v, 4) : new float[v];
        var uv = magic != "VBF1" ? Take<float>(2 * v, 4) : new float[2 * v];
        var colours = Take<byte>(4 * v, 1);
        var stored = magic == "VBF3" ? Take<float>(4 * v, 4) : new float[4 * v];
        var indices = Take<int>(i, 4);
        var spans = Take<int>(4 * s, 4);
        if (o + j != b.Length)
            throw new InvalidDataException("frame length does not match its header");
        return (positions, coverage, uv, edges, stored, colours, indices,
                Enumerable.Range(0, s).Select(k => new FrameSpan(spans[4 * k], spans[4 * k + 1], spans[4 * k + 2], spans[4 * k + 3])).ToArray(),
                Encoding.UTF8.GetString(b, o, j));
    }
}
