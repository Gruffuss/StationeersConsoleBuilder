using System;
using System.Collections.Generic;
using System.Linq;
using VectorBuilder.Core;

/// <summary>The rest of ss.ui and the UI event queue: handlers kept from defs, at most 8 events a tick before tick(dt), page visits first.</summary>
static class EventTests
{
    static ChipRunner Chip(string lua)
    {
        var chip = new ChipRunner();
        chip.LoadAsync(lua).Wait();
        return chip;
    }
    static string Out(ChipRunner c) => string.Join("|", c.Output);

    public static void Run(Action<bool, string> check)
    {
        const string Scene = """
            local ui = ss.ui.surface("main")
            ui:element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 10, h = 10 }, props = { scene = "k", src = "SCENE w=10 h=10\n" },
                         on_click = function(v, who) print("click " .. v .. " " .. who) last = v end })
            ui:element({ id = "t", type = "textinput", rect = { unit = "px", x = 0, y = 0, w = 10, h = 10 }, props = {},
                         on_change = function(v) print("change " .. v) end })
            function tick(dt) print("tick " .. tostring(last)) end
            """;
        var c = Chip(Scene);
        check(c.State == ChipState.Running && c.Screens.ElementsOf("main").Count == 2,
              "ss.ui P2: surface and elements are available at load (measured 2026-10-11)");
        c.Screens.Enqueue("main", "s", "click", "a");
        c.Screens.Enqueue("main", "t", "change", "hello");
        c.TickAsync().Wait();
        check(Out(c) == "click a preview|change hello|tick a", $"events: on_click and on_change are kept from the def; handlers get (value, player) and run before tick, in one tick {Out(c)}");

        var injected = Chip(Scene.Replace("on_change = function(v) print(\"change \" .. v) end", "on_change = function(v, who) print(\"change \" .. v .. \" \" .. who) end"));
        for (var i = 0; i < 3; i++) injected.Screens.Enqueue("main", "s", "click", "verbatim:id", "the player's name");
        injected.Screens.Enqueue("main", "t", "change", "hello", "the player's name");
        injected.TickAsync().Wait();
        check(injected.Output.Count(x => x == "click verbatim:id the player's name") == 3
              && injected.Output.Contains("change hello the player's name"),
              "events P10/P11: repeated injected values arrive verbatim with the player's name in both handlers (measured 2026-10-11)");

        c = Chip(Scene);
        for (var i = 1; i <= 10; i++)
            c.Screens.Enqueue("main", "s", "click", i.ToString());
        c.TickAsync().Wait();
        var first = c.Output.Count(l => l.StartsWith("click"));
        c.TickAsync().Wait();
        check(first == 8 && c.Output.Where(l => l.StartsWith("click")).Select(l => l.Split(' ')[1]).SequenceEqual(Enumerable.Range(1, 10).Select(i => i.ToString())),
              $"events: at most 8 a tick, the rest the next tick, first in first out {Out(c)}");

        c = Chip(Scene);
        c.Screens.Enqueue("main", "gone", "click", "x");
        c.Screens.Enqueue("main", "s", "change", "y");
        c.TickAsync().Wait();
        check(Out(c) == "tick nil" && c.Screens.PendingEvents == 0, "events: one for an element or a handler that is not there is dropped");

        // Five dropped (three for an element that is not there, two for a handler it lacks), then five that run: the first tick
        // takes eight, so three handlers run and two events wait.
        c = Chip(Scene);
        for (var i = 1; i <= 3; i++)
            c.Screens.Enqueue("main", "gone", "click", "x" + i);
        for (var i = 1; i <= 2; i++)
            c.Screens.Enqueue("main", "s", "change", "y" + i);
        for (var i = 1; i <= 5; i++)
            c.Screens.Enqueue("main", "s", "click", "v" + i);
        c.TickAsync().Wait();
        var firstTick = Out(c);
        var pending = c.Screens.PendingEvents;
        c.TickAsync().Wait();
        check(firstTick == "click v1 preview|click v2 preview|click v3 preview|tick v3" && pending == 2
              && Out(c) == firstTick + "|click v4 preview|click v5 preview|tick v5",
              $"events: a dropped event still counts toward the 8 a tick (provisional: P10) {Out(c)}");

        c = Chip(Scene.Replace("print(\"click \" .. v .. \" \" .. who) last = v", "while true do end"));
        c.Screens.Enqueue("main", "s", "click", "a");
        c.TickAsync().Wait();
        check(c.State == ChipState.Halted && c.Error == "Instruction limit exceeded: script used more than 50,000 instructions in a single tick.", "events: a handler that runs away halts the chip with the measured instruction-limit error");

        c = Chip(Scene + "\nVB = { go = function(id) print('visit ' .. id) end }");
        c.Screens.Enqueue("main", "s", "click", "b");
        c.Screens.QueueVisit("p2");
        c.TickAsync().Wait();
        check(Out(c) == "visit p2|click b preview|tick b", $"events: a page visit runs first, then the events, then tick {Out(c)}");

        c = Chip(Scene + """

            local h = ss.ui.surface("main"):get("s")
            h:off("click")
            h:on("click", function(v) print("on " .. v) end)
            """);
        c.Screens.Enqueue("main", "s", "click", "z");
        c.TickAsync().Wait();
        check(Out(c) == "on z|tick nil", $"events: a handle's on and off replace and remove a handler {Out(c)}");

        c = Chip("""
            local ui = ss.ui.surface()
            ss.ui.activate()
            ui:element({ id = "p", type = "panel", props = {} })
            print(ss.ui.surface("main"):get("p") ~= nil, pcall(ui.get, ui, "nope"), pcall(ui.element, ui, { id = "", type = "panel" }), pcall(ui.element, ui, { type = "panel" }))
            """);
        check(c.State == ChipState.Running && c.Screens.ActiveSurface == "main" && Out(c).StartsWith("true\tfalse") && Out(c).Split('\t').Count(x => x == "false") == 3,
              $"ss.ui: no surface name means main, for surface and activate; get of an unknown id raises; an empty or missing id raises {Out(c)}");

        c = Chip("""
            local ui = ss.ui.surface("main")
            ui:set_resolution(800, 600)
            local r, s = ui:get_resolution(), ui:size()
            ui:set_resolution(0, 0)
            local back = ui:get_resolution()
            print(r.w, r.h, s.w, s.h, back.w, back.h)
            local h = ui:element({ id = "p", type = "panel", props = {}, style = { bg = "#000000", border = 1 } })
            h:set_style({ bg = "#ffffff" })
            print(ui.remove)
            """);
        var style = c.Screens.ElementsOf("main").Single(e => e.Id == "p").Style!;
        check(c.Output.First() == "800\t600\t800\t600\t480\t480" && c.Output.Last() == "nil" && (string)style["bg"] == "#ffffff" && (double)style["border"] == 1,
              $"ss.ui P12: size follows set_resolution immediately and (0, 0) restores the physical size (measured 2026-10-11); set_style merges {Out(c)}");

        var resolution = Chip("""
            local ui = ss.ui.surface('main')
            local ok, result = pcall(ui.set_resolution, ui, 800, 600)
            print(ok, type(result))
            """);
        check(Out(resolution) == "true\tfunction", $"ss.ui P12: set_resolution returns a function (measured 2026-10-11) {Out(resolution)}");

        var beta = new ChipRunner();
        beta.Screens.Beta = true;
        beta.LoadAsync("""
            local ui = ss.ui.surface("main")
            ui:element({ id = "a", type = "panel", props = {} })
            local b = ui:element({ id = "b", type = "panel", props = {} })
            ui:remove("a") b:remove()
            """).Wait();
        check(beta.State == ChipState.Running && beta.Screens.ElementsOf("main").Count == 0, "ss.ui: beta adds ui:remove(id) and handle:remove()");

        beta.LoadAsync("""
            local ui = ss.ui.surface("main")
            local h = ui:element({ id = "a", type = "panel", props = { data = { x = 1 } } })
            h:remove()
            ui:element({ id = "a", type = "panel", props = { data = { x = 2 } } })
            """).Wait();
        check(beta.State == ChipState.Running && beta.Screens.LostWrites.Count == 0,
              "ss.ui: Remove resets declaration and table-write counters before reusing the id");

        // A removed element leaves the vector host too, at the flush, before the batch's upserts (as a clear does): an id
        // removed and declared again in one execution is a new scene, and one removed alone leaves no scene behind.
        var gone = new ChipRunner();
        gone.Screens.Beta = true;
        const string Declared = """ui:element({ id = "s", type = "vector", rect = { unit = "px", x = 0, y = 0, w = 10, h = 10 }, props = { scene = "k", src = "SCENE w=10 h=10\n" } })""";
        gone.LoadAsync("ui = ss.ui.surface(\"main\")\n" + Declared).Wait();
        var before = gone.Vectors.SceneOf("main", "s");
        gone.LoadAsync("ui:remove(\"s\")\n" + Declared).Wait();
        var again = gone.Vectors.SceneOf("main", "s");
        gone.LoadAsync("""ui:remove("s")""").Wait();
        check(gone.State == ChipState.Running && before != null && again != null && again != before && gone.Vectors.SceneOf("main", "s") == null,
              "ss.ui: a beta remove takes the element's scene off the vector host at the flush");

        c = Chip("""
            local ui = ss.ui.surface("main")
            d = ui:element({ id = "d", type = "vector", props = { scene = "k", data = { a = 1 } } })
            function tick() d:set_props({ data = { a = 2 } }) end
            """);
        var d = c.Screens.ElementsOf("main").Single(e => e.Id == "d");
        var atLoad = d.Upserts;
        c.TickAsync().Wait();
        check(atLoad == 1 && d.Upserts == 2, $"ss.ui: one upsert per element per flush, counted ({atLoad}, {d.Upserts})");

        // The flush rule's lost writes are counted.
        c = Chip("""
            local ui = ss.ui.surface("main")
            d = ui:element({ id = "d", type = "vector", props = { scene = "k", data = { a = 1 } } })
            d:set_props({ data = { a = 2 } })
            ui:element({ id = "e", type = "panel", props = {} })
            ui:element({ id = "e", type = "panel", props = {} })
            function tick() d:set_props({ data = { a = 3 } }) ui:commit() d:set_props({ data = { a = 4 } }) end
            """);
        var atLoadLost = c.Screens.LostWrites.Count;
        c.TickAsync().Wait();
        check(atLoadLost == 2 && c.Screens.LostWrites.Count == 2,
              $"ss.ui: a table prop written twice before a flush, and an id declared twice in one execution, are lost writes; a commit between is safe ({string.Join("; ", c.Screens.LostWrites)})");

        // A re-declaration replaces the element whole, so a table prop set_props wrote since the last flush is lost even when a commit
        // came before the write (the id is then declared once in its batch): one line whether or not the re-declaration carries it,
        // and a write after the re-declaration loses nothing.
        const string Redeclared = """
            local ui = ss.ui.surface("main")
            d = ui:element({ id = "d", type = "vector", props = { scene = "k", data = { a = 1 } } })
            ui:commit()
            d:set_props({ data = { a = 2 } })
            ui:element({ id = "d", type = "vector", props = { scene = "k" AGAIN } })
            """;
        var without = Chip(Redeclared.Replace(" AGAIN", "") + "\nd:set_props({ data = { a = 4 } })");
        var with = Chip(Redeclared.Replace(" AGAIN", ", data = { a = 3 }"));
        check(string.Join("; ", without.Screens.LostWrites) == "main/d: data written then replaced by a re-declaration"
              && string.Join("; ", with.Screens.LostWrites) == "main/d: data written twice before a flush",
              $"ss.ui: a table prop written and then dropped by a re-declaration in one batch is a lost write ({string.Join("; ", without.Screens.LostWrites)} / {string.Join("; ", with.Screens.LostWrites)})");

        // A chip that loses writes every tick: the list keeps the first MaxLostWrites lines, so a long session cannot grow it without end.
        c = Chip("""
            ui = ss.ui.surface("main")
            function tick() for _ = 1, 30 do ui:element({ id = "e", type = "panel", props = {} }) end end
            """);
        for (var k = 0; k < 5; k++)
            c.TickAsync().Wait();
        check(c.State == ChipState.Running && c.Screens.LostWrites.Count == FakeScriptedScreens.MaxLostWrites
              && c.Screens.LostWrites.All(l => l == "main/e: declared twice before a flush"),
              $"ss.ui: the lost-write list keeps the first {FakeScriptedScreens.MaxLostWrites} lines (5 ticks lose 145: {c.Screens.LostWrites.Count} kept)");

        var late = new ChipRunner();
        late.Screens.NotReady = true;
        late.LoadAsync("""print(pcall(ss.ui.surface, "main"))""").Wait();
        late.Screens.NotReady = false;
        late.LoadAsync("""print(pcall(ss.ui.surface, "main"))""").Wait();
        check(late.Output.First().StartsWith("false") && late.Output.First().Contains("host not ready") && late.Output.Last().StartsWith("true"),
              $"ss.ui: simulated late-host failure raises; the default load succeeds (P2 measured 2026-10-11, late readiness unprobed) {string.Join("|", late.Output)}");

        c = Chip("""
            VB = { setSrc = function(s, src) print("src " .. s .. " " .. src) end, go = function(id) print("visit " .. id) end }
            function tick() print("tick") end
            """);
        c.Screens.QueueVisit("p2");
        c.Screens.QueueSrc("page2", "SCENE w=1 h=1");
        c.TickAsync().Wait();
        check(string.Join("|", c.Output) == "src page2 SCENE w=1 h=1|visit p2|tick", $"events: queued page texts run first, then visits, then tick (ruling P19) {string.Join("|", c.Output)}");
    }
}
