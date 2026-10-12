using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using ScriptedScreensVector;
using UnityEngine;
using VectorBuilder.Core;

// The live vector host: per-element scenes that persist across upserts, as VectorGraphic does in game.
// Every check drives the host through Lua, so the real element{} / set_props path runs, on a fake clock.
static class LiveTests
{
    // A Lua "\n" inside a Lua string: the raw C# literal keeps the backslash.
    const string Prelude = """
        TEXT = "SCENE w=100 h=100\nR id=box x=0 y=0 w==$w h=10 f=#FFFFFF"
        OTHER = "SCENE w=100 h=100\nR id=box x=0 y=0 w==$w h=20 f=#FFFFFF"
        local ui = ss.ui.surface("main")
        s = ui:element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                         props = { scene = "k", src = TEXT } })
        d = ui:element({ id = "d", type = "vector", props = { scene = "k", data = { w = 10, b = 2 } } })
        """;

    const string Text = "SCENE w=100 h=100\nR id=box x=0 y=0 w==$w h=10 f=#FFFFFF";

    public static void Run(Action<bool, string> check)
    {
        double now = 0;

        ChipRunner Chip(string prelude = Prelude)
        {
            now = 0;
            var chip = new ChipRunner(clock: () => now);
            Lua(chip, prelude);
            return chip;
        }

        // Each snippet is one execution, so its upserts reach the mod when it ends.
        void Lua(ChipRunner chip, string code)
        {
            chip.LoadAsync(code).Wait();
            if (chip.State != ChipState.Running)
                check(false, $"lua chunk ran: {chip.Error}");
        }

        float? Scalar(ChipRunner chip, string name, string element = "s") =>
            chip.Vectors.SceneOf("main", element) is { } live && live.Context.Scalars.TryGetValue(name, out var v) ? v : null;

        // The box's opaque vertex colours, from the element's own builder after the dispatch preamble and one Emit.
        List<Color> Box(ChipRunner chip)
        {
            var live = chip.Vectors.SceneOf("main", "s")!;
            live.Prepare((float)now);
            Tessellator.Emit(live.Builder, live.Scene, live.Context, new Rect(0f, 0f, 100f, 100f), 1f, true, live.Stats);
            return MeshAccess.ColoursOf(live.Builder).Where(c => c.a > 0.5f).ToList();
        }
        bool White(List<Color> cs) => cs.Count > 0 && cs.All(c => c.r == 1f && c.g == 1f && c.b == 1f);
        bool Red(List<Color> cs) => cs.Count > 0 && cs.All(c => c.r == 1f && c.g == 0f && c.b == 0f);

        var chip = Chip();
        check(Scalar(chip, "w") == 10f && Scalar(chip, "b") == 2f, "live: data reaches the structure's context");

        Lua(chip, "d:set_props{ keep=true, data={ alarm=false } }");
        check(Scalar(chip, "w") == 10 && Scalar(chip, "b") == 2 && Scalar(chip, "alarm") == 0,
              "live: boolean keep preserves omitted names and false alarm arrives as zero");

        chip = Chip();
        now = 3;
        Lua(chip, """ss.ui.surface("main"):element{ id="p", type="vector", props={ scene="k", nodes={ box={ h=12 } } } }""");
        var nodesOnly = chip.Vectors.SceneOf("main", "s")!;
        nodesOnly.Prepare(3);
        check(Scalar(chip, "w") == 10 && Scalar(chip, "b") == 2 && nodesOnly.Context.Since("w") == 3,
              "live: a separate nodes-only element preserves data and since");
        Lua(chip, """ss.ui.surface("main"):element{ id="empty", type="vector", props={ scene="k", data={} } }""");
        check(Scalar(chip, "w") == null && Scalar(chip, "b") == null, "live: explicit empty data still clears");

        chip = Chip("""
            local ui = ss.ui.surface("main")
            ui:element{ id="d", type="vector", props={ scene="k", data={ w=10 } } }
            ui:element{ id="p", type="vector", props={ scene="k", nodes={ box={ h=12 } } } }
            s = ui:element{ id="s", type="vector", props={ scene="k", src="SCENE w=100 h=100\nR id=box w=10 h=10" } }
            """);
        check(Scalar(chip, "w") == 10, "live: queued nodes-only payload leaves queued data intact");

        chip = Chip("""
            local ui = ss.ui.surface("main")
            d = ui:element{ id="d", type="vector", props={ scene=1.25, nodes={ [1]={ f="#FF0000" } } } }
            """);
        Lua(chip, """d:set_props{ nodes={ [1]={ x=5 }, [2]={ f="#FF0000" } } }""");
        Lua(chip, """d:set_props{ nodes={ [3]={ f="#FF0000" }, named={ f="#FF0000" } } }""");
        Lua(chip, """
            local ui = ss.ui.surface("main")
            s = ui:element{ id="s", type="vector", rect={ unit="px", w=100, h=100 },
                props={ scene="1.25", src="SCENE w=100 h=100\nR id=1 w=10 h=10 f=#FFFFFF\nR id=2 x=20 w=10 h=10 f=#FFFFFF\nR id=3 x=40 w=10 h=10 f=#FFFFFF\nR id=named x=60 w=10 h=10 f=#FFFFFF" } }
            ui:element{ id="values", type="vector", props={ scene=1.25, data={ [1]=false, [2]=8 }, ease={ [2]=1 } } }
            """);
        var numeric = chip.Vectors.SceneOf("main", "s")!;
        check(Red(Box(chip)) && numeric.Scene.Root[0].X.Evaluate(numeric.Context) == 5,
              "live: queued numeric-id patches merge per id/property and numeric scene pairs with text");
        numeric.Prepare(0.5f);
        check(Scalar(chip, "1") == 0 && Scalar(chip, "2") == 8 && numeric.Context.NameBlend.GetValueOrDefault("2") == 0.5f,
              "live: numeric-keyed data and ease recover names, boolean data reads as zero");
        Lua(chip, """ss.ui.surface("main"):element{ id="numsrc", type="vector", props={ src=12 } }""");
        check(chip.Vectors.SceneOf("main", "numsrc") is { StructureText: "12" } srcScene && srcScene.Scene.Problems.Count > 0,
              "live: numeric src is read as text and its refusal is reported");

        chip = Chip();
        Lua(chip, "d:set_props{ data = { w = 20 } }");
        check(Scalar(chip, "w") == 20f && Scalar(chip, "b") == null, "live: a payload without keep replaces every name");

        chip = Chip();
        Lua(chip, "d:set_props{ keep = 1, data = { w = 20 } }");
        check(Scalar(chip, "w") == 20f && Scalar(chip, "b") == 2f, "live: keep = 1 keeps the names a payload omits");
        Lua(chip, "d:set_props{ data = { w = 30 } }");
        check(Scalar(chip, "w") == 30f && Scalar(chip, "b") == 2f, "live: a standing keep = 1 is re-read at every later payload");

        chip = Chip();
        var before = Box(chip);
        Lua(chip, """d:set_props{ nodes = { box = { f = "#FF0000" } } }""");
        check(White(before) && Red(Box(chip)), "live: a nodes patch recolours the box");
        Lua(chip, "s:set_props{ src = TEXT }");
        var kept = Box(chip);
        Lua(chip, "s:set_props{ src = OTHER }");
        var reparsed = Box(chip);
        Lua(chip, "d:set_props{ data = { w = 10 } }");
        check(Red(kept) && White(reparsed) && Red(Box(chip)),
              "live: the same src keeps nodes patches; another src drops them until the standing nodes is re-applied");

        chip = Chip("""
            TEXT = "SCENE w=100 h=100\nR id=box x=0 y=0 w==$w h=10 f=#FFFFFF"
            local ui = ss.ui.surface("main")
            d = ui:element({ id = "d", type = "vector", props = { scene = "k", data = { w = 10 }, nodes = { box = { f = "#FF0000" } } } })
            s = ui:element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                             props = { scene = "k", src = TEXT } })
            """);
        check(Red(Box(chip)) && Scalar(chip, "w") == 10f,
              "live: data and a nodes patch sent before their structure wait, and both apply when it arrives (0.11.82)");

        chip = Chip();
        now = 5;
        var first = chip.Vectors.SceneOf("main", "s")!;
        var oldScene = first.Scene;
        Lua(chip, "s:set_props{ src = TEXT }");
        check(first.TimeAt(5) == 5f && ReferenceEquals(oldScene, first.Scene) && Scalar(chip, "w") == 10f,
              "live: re-sending the same src changes nothing: the same scene, t keeps counting, data kept (0.11.74)");
        now = 7;
        Lua(chip, "s:set_props{ src = OTHER }");
        check(chip.Vectors.SceneOf("main", "s") == first && first.TimeAt(7) == 0f && Scalar(chip, "w") == 10f,
              "live: a different src restarts t and keeps data");

        now = 9;
        chip.Vectors.HotSwap("main", "s", Text);
        check(first.TimeAt(9) == 2f && first.StructureText == Text && Scalar(chip, "w") == 10f
              && chip.Screens.ElementsOf("main").Single(e => e.Id == "s").Props["src"] as string == Text,
              "live: a hot-swap installs the src and keeps the clock and data");

        // The table form has nothing cheap to compare, so it re-installs on every upsert.
        chip = Chip("""
            local ui = ss.ui.surface("main")
            t = ui:element({ id = "t", type = "vector", props = { scene = "tk", w = 100, h = 100,
                             root = { { op = "R", x = 0, y = 0, w = 10, h = 10 } } } })
            """);
        now = 3;
        Lua(chip, "t:set_props{ w = 100 }");
        check(chip.Vectors.SceneOf("main", "t")!.TimeAt(3) == 0f, "live: a table-form structure re-installs on every upsert");

        // A src that will not parse beside a root: the root draws, and the refusal is reported (0.11.96; it used to be hidden).
        chip = Chip("""
            local ui = ss.ui.surface("main")
            t = ui:element({ id = "t", type = "vector", props = { scene = "tk", w = 100, h = 100, src = "SCENE w=100 h=100\nR x=[1",
                             root = { { op = "R", x = 0, y = 0, w = 10, h = 10 } } } })
            """);
        var refusedSrc = chip.Vectors.SceneOf("main", "t")!.Scene;
        check(refusedSrc.Root.Count == 1 && refusedSrc.Problems.Count(p => p.StartsWith("src: ")) == 1,
              "live: a src that will not parse beside a root is reported, and the root draws (0.11.96)");

        // A picture takes clicks on its box before it loads, and behind a source that never does (0.11.96), but not without
        // a src, which the mod reports (overlay.json).
        chip = Chip("""
            local ui = ss.ui.surface("main")
            s = ui:element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                             props = { scene = "k", src = "SCENE w=100 h=100\nIMG id=pic x=0 y=0 w=10 h=10 src=nowhere.png click=1\nIMG id=bare x=20 y=0 w=10 h=10 click=1" } })
            """);
        var pic = chip.Vectors.SceneOf("main", "s")!;
        pic.Prepare((float)now);
        Tessellator.Emit(pic.Builder, pic.Scene, pic.Context, new Rect(0f, 0f, 100f, 100f), 1f, true, pic.Stats);
        check(pic.Stats.Hits.Any(h => h.Id == "pic"), "live: an IMG that has not loaded takes clicks on its box (0.11.96)");
        check(!pic.Stats.Hits.Any(h => h.Id == "bare") && pic.Scene.Problems.Contains("IMG has no src"),
              "live: an IMG without a src is reported and takes no click");

        // Payloads that wait for their structure merge as the mod merges them (EvalContext.MergeFrom): a later payload replaces
        // every earlier name unless it carries keep = 1.
        chip = Chip("""
            local ui = ss.ui.surface("main")
            d = ui:element({ id = "d", type = "vector", props = { scene = "k", data = { a = 1 } } })
            """);
        Lua(chip, "d:set_props{ data = { b = 2 } }");
        Lua(chip, "d:set_props{ keep = 1, data = { c = 3 } }");
        Lua(chip, """
            s = ss.ui.surface("main"):element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                                                 props = { scene = "k", src = "SCENE w=100 h=100\nR x=0 y=0 w=10 h=10" } })
            """);
        check(Scalar(chip, "a") == null && Scalar(chip, "b") == 2f && Scalar(chip, "c") == 3f,
              "live: payloads waiting for their structure merge as the mod merges them: a later one replaces every name unless keep = 1");

        // snap = 1 reads the new number at once; without it the number blends from what is shown.
        var plain = Chip();
        var snappy = Chip();
        now = 10;
        Lua(plain, "d:set_props{ data = { w = 50 } }");
        Lua(snappy, "d:set_props{ snap = 1, data = { w = 50 } }");
        var p = plain.Vectors.SceneOf("main", "s")!;
        var q = snappy.Vectors.SceneOf("main", "s")!;
        p.Prepare(10.1f);
        q.Prepare(10.1f);
        check(p.Context.Scalar("w") < 50f && q.Context.Scalar("w") == 50f, "live: snap = 1 applies a number at once; without it the number blends");

        chip = Chip();
        now = 1;
        Lua(chip, "d:set_props{ data = { w = 10 } }");
        now = 3.5;
        var sinceScene = chip.Vectors.SceneOf("main", "s")!;
        sinceScene.Prepare(3.5f);
        check(sinceScene.Context.Since("w") == 2.5f && sinceScene.Context.Since("never") == 1e6f, "live: since($w) counts from the payload's arrival");

        chip = Chip();
        now = 10;
        Lua(chip, "d:set_props{ ease = { w = 1 }, data = { w = 50 } }");
        var eased = chip.Vectors.SceneOf("main", "s")!;
        eased.Prepare(10.5f);
        var halfway = eased.Context.Scalar("w");
        eased.Prepare(11.1f);
        check(Math.Abs(halfway - 30f) < 1e-3f && eased.Context.Scalar("w") == 50f, "live: ease = { w = 1 } glides 10 to 50 linearly over 1 s");

        chip = Chip();
        Lua(chip, """
            local ui = ss.ui.surface("main")
            ui:element({ id = "p", type = "panel", props = { src = TEXT } })
            ui:element({ id = "v", type = "VECTOR", props = { src = TEXT } })
            """);
        check(chip.Vectors.SceneOf("main", "p") == null && chip.Vectors.SceneOf("main", "v") != null,
              "live: only type vector (any case) makes a scene");

        // The flush rule's two halves (upstream REFERENCE.md ca7f4ba), each in one tick: ordinary props merge, `data` is replaced whole.
        void Tick(ChipRunner c, string body)
        {
            Lua(c, "function tick(dt) " + body + " end");
            c.TickAsync().Wait();
        }
        chip = Chip();
        Tick(chip, """d:set_props{ f = "#FF0000" } d:set_props{ x = 10 }""");
        check(chip.State == ChipState.Running
              && chip.Screens.ElementsOf("main").Single(e => e.Id == "d").UiProps.Select(p => p.Key).Order().SequenceEqual(["data", "f", "scene", "x"]),
              "flush: f then x in one tick both reach the mod (ordinary props merge)");

        chip = Chip();
        Tick(chip, "d:set_props{ keep = 1, data = { a = 1 } } d:set_props{ keep = 1, data = { c = 3 } }");
        check(Scalar(chip, "a") == null && Scalar(chip, "c") == 3f && Scalar(chip, "w") == 10f,
              "flush: data { a } then data { c } in one tick loses a, keep = 1 or not (the first table never arrives); keep = 1 keeps the declared w");

        chip = Chip();
        Tick(chip, """d:set_props{ scene = "k", keep = 1, data = { v = 5 } } d:set_props{ snap = 1 }""");
        check(Scalar(chip, "v") == 5f, "flush: { scene, keep, data } then { snap = 1 } in one tick keeps the scene and the data");

        chip = Chip();
        Lua(chip, "d:set_props{ keep = 1, data = { a = 1 } }");
        Lua(chip, "d:set_props{ keep = 1, data = { c = 3 } }");
        check(Scalar(chip, "a") == 1f && Scalar(chip, "c") == 3f, "flush: data { a } then data { c } with keep = 1 in two executions keeps both");

        chip = Chip("""
            local ui = ss.ui.surface("main")
            s = ui:element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                props = { scene = "k", src = "SCENE w=100 h=100\nR id=a x=0 y=0 w=10 h=10 f=#FFFFFF\nR id=b x=20 y=0 w=10 h=10 f=#FFFFFF" } })
            d = ui:element({ id = "d", type = "vector", props = { scene = "k", data = { w = 1 } } })
            """);
        Tick(chip, """d:set_props{ nodes = { a = { f = "#FF0000" } } } d:set_props{ nodes = { b = { f = "#FF0000" } } }""");
        var halves = Box(chip);
        check(halves.Any(c => White([c])) && halves.Any(c => Red([c])),
              "flush: nodes { a } then nodes { b } in one tick loses a's patch (nodes is replaced whole, like data)");

        chip = Chip();
        Tick(chip, """
            e = ss.ui.surface("main"):element({ id = "e", type = "vector", props = { scene = "k", keep = 1, data = { v = 7 } } })
            e:set_props{ snap = 1 }
            """);
        check(Scalar(chip, "v") == 7f && Scalar(chip, "w") == 10f, "flush: a declared prop a patch in the same tick omits still arrives (scene, data)");

        chip = Chip();
        Tick(chip, """
            local ui = ss.ui.surface("main")
            ui:element({ id = "d", type = "vector", props = { scene = "k", data = { v = 1 } } })
            ui:element({ id = "d", type = "vector", props = { data = { v = 2 } } })
            """);
        check(Scalar(chip, "v") == null && Scalar(chip, "w") == 10f
              && chip.Screens.ElementsOf("main").Single(e => e.Id == "d").Props.Keys.SequenceEqual(["data"]),
              "flush: a second declaration in one tick replaces the first whole; without scene its data pairs elsewhere");

        // ScriptedScreens' flush, measured in game (0.11.89): A, declared at load and patched in tick, keeps the declared data;
        // B, declared and patched in one tick, loses it; a commit between them in that tick keeps it.
        const string Declare = """
            local ui = ss.ui.surface("main")
            s = ui:element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                             props = { scene = "log", src = "SCENE w=100 h=100\nR x=0 y=0 w==$pct h=10" } })
            d = ui:element({ id = "d", type = "vector", props = { scene = "log", keep = 1, data = { long = 7 } } })
            """;
        const string Patch = """d:set_props({ scene = "log", keep = 1, data = { pct = 42 } })""";
        foreach (var (lua, survives, what) in new[]
        {
            (Declare + "\nfunction tick() " + Patch + " end", true,
             "flush A: declared at load and patched in the first tick, with no commit, the declaration's data survives"),
            ("function tick()\n" + Declare + "\n" + Patch + "\nend", false,
             "flush B: declared and patched in one tick, with no commit, the declaration's data is lost"),
            ("function tick()\n" + Declare + "\nss.ui.surface('main'):commit()\n" + Patch + "\nend", true,
             "flush B: a commit between declaring and patching in one tick delivers the declaration"),
        })
        {
            var c = new ChipRunner(clock: () => now);
            c.LoadAsync(lua).Wait();
            c.TickAsync().Wait();
            var live = c.Vectors.SceneOf("main", "s");
            check(c.State == ChipState.Running && live != null && live.Context.Scalars.GetValueOrDefault("pct") == 42f
                  && live.Context.Scalars.ContainsKey("long") == survives, what);
        }

        var quiet = new ChipRunner(clock: () => now);  // example 09's shape: no commit anywhere
        quiet.LoadAsync("""
            local ui = ss.ui.surface("main")
            ui:element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 }, props = { src = "SCENE w=100 h=100\nR x=0 y=0 w=10 h=10" } })
            """).Wait();
        check(quiet.Vectors.SceneOf("main", "s") != null, "flush: the load's end delivers its declarations, with no commit and before any tick");

        var cleared = Chip();
        Lua(cleared, """
            local ui = ss.ui.surface("main")
            ui:clear()
            ui:element({ id = "n", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 }, props = { src = TEXT } })
            """);
        check(cleared.Vectors.SceneOf("main", "s") == null && cleared.Vectors.SceneOf("main", "n") != null,
              "flush: a clear and a declaration in one batch reach the mod in that order");

        var dropped = Chip();
        Lua(dropped, """
            local ui = ss.ui.surface("main")
            ui:element({ id = "gone", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 }, props = { src = TEXT } })
            ui:clear()
            """);
        check(dropped.Vectors.SceneOf("main", "gone") == null && dropped.Vectors.SceneOf("main", "s") == null,
              "flush: an element declared and then cleared in one batch never reaches the mod");

        var broken = new ChipRunner(clock: () => now);
        broken.LoadAsync("""
            local ui = ss.ui.surface("main")
            ui:element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                         props = { src = "SCENE w=100 h=100\nR x=0 y=0 w=10 h=10 f=#FFFFFF" } })
            error("boom")
            """).Wait();
        check(broken.State == ChipState.Halted && broken.Vectors.SceneOf("main", "s") != null
              && Compositor.Compose(broken, "main", 1, false).Indices.Length > 0,
              "flush: a load that halts flushes what it declared, which draws beside the error");

        var dying = Chip();
        Lua(dying, """function tick(dt) d:set_props{ data = { w = 60 } } error("boom") end""");
        dying.TickAsync().Wait();
        check(dying.State == ChipState.Halted && Scalar(dying, "w") == 60f, "flush: a tick that halts still flushes what it sent before");

        var flags = new ChipRunner(clock: () => now);
        var declared = flags.Screens.Declare("main", "p", "panel", null, new());
        var flushedAtDeclare = declared.Flushed;
        flags.Screens.Flush();
        var flushedAfter = declared.Flushed;
        flags.LoadAsync("""ss.ui.surface("main"):clear()""").Wait();
        var redeclared = flags.Screens.Declare("main", "p", "panel", null, new());
        check(!flushedAtDeclare && flushedAfter && !ReferenceEquals(declared, redeclared) && !redeclared.Flushed,
              "flush: ElementRecord.Flushed is false after a declare, true once a flush delivers it, false for a cleared and re-declared id");

        // Two nodes patches waiting for their structure (two executions, so two upserts) merge per node id, then per
        // prop (0.11.90), so both apply when it arrives: a from the first, b and a's x from the second.
        chip = Chip("""
            local ui = ss.ui.surface("main")
            d = ui:element({ id = "d", type = "vector", props = { scene = "k", nodes = { a = { f = "#FF0000" } } } })
            """);
        Lua(chip, """d:set_props{ nodes = { a = { x = 5 }, b = { f = "#FF0000" } } }""");
        Lua(chip, """
            s = ss.ui.surface("main"):element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                props = { scene = "k", src = "SCENE w=100 h=100\nR id=a x=0 y=0 w=10 h=10 f=#FFFFFF\nR id=b x=20 y=0 w=10 h=10 f=#FFFFFF" } })
            """);
        check(Red(Box(chip)), "live: two nodes patches waiting for their structure merge, and both apply when it arrives (0.11.90)");

        // The same merge's other paths: a property is matched case-insensitively (F replaces f), and a later nodes that is
        // not a map leaves the earlier patches standing.
        chip = Chip("""
            local ui = ss.ui.surface("main")
            d = ui:element({ id = "d", type = "vector", props = { scene = "k", nodes = { a = { f = "#00FF00" }, b = { f = "#FF0000" } } } })
            """);
        Lua(chip, """d:set_props{ nodes = { a = { F = "#FF0000" } } }""");
        Lua(chip, """d:set_props{ nodes = "none" }""");
        Lua(chip, """
            s = ss.ui.surface("main"):element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                props = { scene = "k", src = "SCENE w=100 h=100\nR id=a x=0 y=0 w=10 h=10 f=#FFFFFF\nR id=b x=20 y=0 w=10 h=10 f=#FFFFFF" } })
            """);
        check(Red(Box(chip)), "live: waiting nodes patches merge a property case-insensitively, and a later nodes that is not a map changes nothing");

        chip = Chip();
        var wasActive = chip.Vectors.IsActive("main", "s");
        Lua(chip, """
            s2 = ss.ui.surface("main"):element({ id = "s2", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 100, h = 100 },
                                                 props = { scene = "k", src = TEXT } })
            d:set_props{ data = { w = 40 } }
            """);
        check(wasActive && chip.Vectors.IsActive("main", "s2") && !chip.Vectors.IsActive("main", "s")
              && Scalar(chip, "w", "s2") == 40f && Scalar(chip, "w") == 10f,
              "live: the last structure with a scene id takes its data; the older one is inactive and keeps its last data");

        chip = Chip();
        Lua(chip, """ss.ui.surface("main"):clear()""");
        check(chip.Vectors.SceneOf("main", "s") == null && chip.Screens.ElementsOf("main").Count == 0, "live: clear drops the surface's scenes");

        // Count conversions and copies across growth and one upsert; doubling storage must keep their sum linear.
        chip = Chip();
        var timer = Stopwatch.StartNew();
        var growing = chip.Screens.ElementsOf("main").Single(e => e.Id == "d");
        var beforeWork = growing.PropsWork;
        Lua(chip, """
            ok, err = pcall(function() for i = 1, 20000 do d:set_props{ ["k" .. i] = 1 } end end)
            print(tostring(ok) .. " " .. tostring(err))
            """);
        timer.Stop();
        var grown = chip.Screens.ElementsOf("main").Single(e => e.Id == "d").Props;
        check(chip.State == ChipState.Running && chip.Output.Any(l => l.StartsWith("false") && l.Contains("element props too large"))
              && grown.Count == 4096 && !grown.ContainsKey("k4095"),
              "live: an element that only grows hits a catchable cap at 4096 keys without storing the refused key");
        Console.WriteLine($"MEASURE live: 4096-key store and upsert {timer.ElapsedMilliseconds} ms (informational)");
        var work = growing.PropsWork - beforeWork;
        check(work <= 4L * grown.Count, $"live C7: growing to 4096 keys does linear property storage work ({work} conversions/copies)");

        // Re-sending the same keys replaces their values: 1,500 payloads of 102 values each stay under the 100,000 cap.
        chip = Chip();
        Lua(chip, """
            local big = {} for i = 1, 100 do big[i] = i end
            for i = 1, 1500 do d:set_props{ data = { w = i, a = big } } end
            """);
        check(Scalar(chip, "w") == 1500f && chip.Vectors.SceneOf("main", "s")!.Context.Arrays["a"].Length == 100
              && chip.Screens.ElementsOf("main").Single(e => e.Id == "d").Props.Count == 2,
              "live: repeated set_props of the same keys keep working and reach the scene");
    }
}
