using System;
using System.IO;
using System.Linq;
using ScriptedScreensVector;
using UnityEngine;
using VectorBuilder.Core;

/// <summary>Play mode's pointer: canvas points (surface px) become the vector element's click values, as the mod sends them.</summary>
static class PointerTests
{
    const string Src = """
        SCENE w=100 h=100
        R id=plate press=1 x=0 y=0 w=50 h=50 f=#336699
        RP n=2 {
            R id=row click=1 x=50 y==i*25 w=50 h=20 f=#669933
        }
        R id=pad click=1 xy=1 x=0 y=60 w=40 h=40 f=#993366
        R id=hov click=1 hoverev=1 x=60 y=60 w=20 h=15 f=#999999
        R id=src drag=1 click=1 x=60 y=80 w=15 h=15 f=#AAAAAA
        R id=dst drop=1 click=1 x=80 y=80 w=15 h=15 f=#BBBBBB
        """;

    static (ChipRunner Chip, PointerInput Input, Func<string[]> Events) Make(Func<double>? clock = null)
    {
        var chip = new ChipRunner(clock: clock);
        chip.LoadAsync("local ui = ss.ui.surface('main') ui:element({ id = 's', type = 'vector', rect = { unit = 'px', x = 0, y = 0, w = 100, h = 100 }, "
                       + "props = { scene = 'k', src = [==[\n" + Src + "\n]==] }, on_click = function(v) print(v) end })").Wait();
        Compositor.Compose(chip, "main", 1f, false);   // a frame fills the hit regions, as the canvas's frames do
        var input = new PointerInput(chip);
        return (chip, input, () => { chip.TickAsync().Wait(); var o = chip.Output.ToArray(); return o; });
    }

    public static void Run(Action<bool, string> check)
    {
        var (chip, p, events) = Make();
        p.Apply("main", 25, 25, "down");
        p.Apply("main", 25, 25, "up");
        check(events().SequenceEqual(new[] { "down:plate", "up:plate", "plate" }), $"pointer: a press plate sends down:, up:, then the plain click {string.Join("|", chip.Output)}");

        // Two plain clicks from one pointer: a second within 0.25 s is dropped (ruling P11), so advance the clock between them.
        var clock = 0.0;
        (chip, p, events) = Make(() => clock);
        p.Apply("main", 75, 35, "down");
        p.Apply("main", 75, 35, "up");
        clock = 1;
        p.Apply("main", 10, 90, "down");
        p.Apply("main", 10, 90, "up");
        check(events().SequenceEqual(new[] { "row:1", "pad@0.250,0.750" }), $"pointer: a region in a repeat sends id:i; an xy region its fractions {string.Join("|", chip.Output)}");

        (chip, p, events) = Make();
        p.Apply("main", 25, 25, "down");
        p.Apply("main", 25, 80, "move");
        p.Apply("main", 25, 81, "move");
        p.Apply("main", 25, 80, "up");
        check(events().SequenceEqual(new[] { "down:plate", "leave:plate", "up:plate" }), $"pointer: moving off a held plate sends leave: once; a press that moved gives no plain click {string.Join("|", chip.Output)}");

        (chip, p, events) = Make();
        p.Apply("main", 65, 65, "move");
        var live = chip.Vectors.SceneOf("main", "s")!;
        var over = live.HoverScope?.Contains("hov") == true;
        p.Apply("main", 5, 5, "move");
        var off = live.HoverScope?.Contains("hov") != true;
        p.Apply("main", 5, 5, "leave");
        live.Prepare((float)chip.Now);
        check(over && off && live.HoverScope == null && live.Context.HoverScope == null && events().SequenceEqual(new[] { "enter:hov", "exit:hov" }),
              $"pointer: hover follows the pointer into the context, a hoverev region sends enter: and exit: {string.Join("|", chip.Output)}");

        (chip, p, events) = Make();
        p.Apply("main", 67, 87, "down");
        p.Apply("main", 87, 87, "move");
        p.Apply("main", 87, 87, "up");
        check(events().SequenceEqual(new[] { "dragstart:src", "drop:src>dst", "dragend:src" }), $"pointer: drag off a drag region, drop on a drop region {string.Join("|", chip.Output)}");

        var now = 0.0;
        (chip, p, events) = Make(() => now);
        foreach (var t in new[] { 0.0, 0.1, 0.4 })
        {
            now = t;
            p.Apply("main", 75, 10, "down");
            p.Apply("main", 75, 10, "up");
        }
        check(events().SequenceEqual(new[] { "row:0", "row:0" }), $"pointer: a second plain click from one pointer within 0.25 s is dropped (ruling P11) {string.Join("|", chip.Output)}");

        (chip, p, events) = Make();
        p.Apply("main", 99, 50, "down");
        p.Apply("main", 99, 50, "up");
        p.Apply("main", 300, 300, "down");
        p.Apply("main", 300, 300, "up");
        check(events().Length == 0, "pointer: a point over no region, or off the element, sends nothing");

        (chip, p, events) = Make();
        live = chip.Vectors.SceneOf("main", "s")!;
        p.Apply("main", 75, 35, "move");
        p.Apply("main", 75, 35, "down");
        live.Prepare((float)chip.Now);
        check(live.Context.HoverScope?.Contains("row") == true && live.Context.HoverIndex == 1
              && live.Context.DownScope?.Contains("row") == true && live.Context.DownIndex == 1,
              "pointer: hover and down scopes and repeat indices reach the context");
        p.Apply("main", 75, 35, "up");
        live.Prepare((float)chip.Now);
        check(live.Context.DownScope == null && live.Context.DownIndex == -1, "pointer: release clears down in the context");
        live.Offsets["scroll"] = 12;
        live.Prepare((float)chip.Now);
        var copied = live.Context.ScrollOffsets.TryGetValue("scroll", out var copiedOffset) && copiedOffset == 12;
        live.Offsets.Clear();
        live.Prepare((float)chip.Now);
        check(copied && live.Context.ScrollOffsets.Count == 0, "pointer: removed scroll offsets do not survive in the context");

        (chip, p, events) = Make();
        chip.LoadAsync("local ui = ss.ui.surface('other') ui:element({ id = 's', type = 'vector', rect = { unit = 'px', x = 0, y = 0, w = 100, h = 100 }, "
                       + "props = { scene = 'k', src = [==[\n" + Src + "\n]==] }, on_click = function(v) print('other:' .. v) end })").Wait();
        Compositor.Compose(chip, "other", 1f, false);
        live = chip.Vectors.SceneOf("main", "s")!;
        p.Apply("main", 65, 65, "move");
        p.Apply("other", 65, 65, "move");
        check(live.HoverScope == null && events().SequenceEqual(new[] { "enter:hov", "exit:hov", "other:enter:hov" }),
              "pointer: equal region ids on different surfaces exit and enter their own elements");
        p.Apply("other", 65, 65, "leave");
        events();
        p.Apply("main", 25, 25, "down");
        p.Apply("other", 25, 25, "move");
        p.Apply("other", 25, 25, "up");
        check(events().TakeLast(3).SequenceEqual(new[] { "down:plate", "leave:plate", "up:plate" }),
              "pointer: equal element ids on different surfaces cannot receive a held click");
        p.Apply("main", 67, 87, "down");
        p.Apply("other", 67, 87, "move");
        p.Apply("other", 87, 87, "up");
        check(events().TakeLast(2).SequenceEqual(new[] { "dragstart:src", "dragend:src" }),
              "pointer: equal region ids on different surfaces cannot hold or receive a drag");

        (chip, p, events) = Make();
        chip.LoadAsync("ss.ui.surface('main'):element({ id='overlay', type='vector', rect={ unit='px', x=0, y=0, w=100, h=100 }, "
                       + "props={ src='SCENE w=100 h=100\\nR id=top click=1 x=90 y=90 w=5 h=5 f=#fff', z_index=1 } })").Wait();
        Compositor.Compose(chip, "main", 1f, false);
        p.Apply("main", 25, 25, "down");
        p.Apply("main", 25, 25, "up");
        check(events().SequenceEqual(new[] { "down:plate", "up:plate", "plate" }),
              "pointer: empty space in a top element lets a lower hit region take the press");

        // Wheel: vector example 09's scroll container, found from its frame, scrolled by one notch down.
        var dir = Path.Combine(Fixtures.Root, "..", "..", "core", "vendor", "vector", "examples");
        var nine = Directory.GetFiles(dir, "09-*.lua").Single();
        var ex = new ChipRunner();
        ex.Screens.Size = (460, 460);
        ex.LoadAsync(File.ReadAllText(nine)).Wait();
        foreach (var s in ex.Screens.SurfaceNames.ToList())
            Compositor.Compose(ex, s, 1f, false);
        var (surf, el, scene) = ex.Screens.SurfaceNames.SelectMany(s => ex.Screens.ElementsOf(s).Select(e => (s, e, ex.Vectors.SceneOf(s, e.Id))))
            .First(x => x.Item3?.Stats.Scrolls.Any(r => r.Max > 0) == true);
        var region = scene!.Stats.Scrolls.First(r => r.Max > 0);
        var (sw, sh) = ex.Screens.SizeOf(surf);
        var (rx, ry, _, rh) = Compositor.RectOf(el.Rect, sw, sh);
        var c = region.Rect.center;
        new PointerInput(ex).Apply(surf, rx + c.x, ry + rh - c.y, "wheel", -1);
        check(scene.Offsets.TryGetValue(region.Id, out var at) && Math.Abs(at - region.Clamp(region.WheelStep)) < 1e-4,
              $"pointer: a wheel notch down over example 09's container scrolls it one step ({at})");

        new PointerInput(ex).Apply(surf, rx + c.x, ry + rh - c.y, "wheel", double.NaN);
        check(scene.Offsets[region.Id] == at, "pointer: a non-finite wheel delta leaves the offset intact");
    }
}
