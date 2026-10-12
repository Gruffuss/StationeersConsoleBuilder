using System;
using System.Collections.Generic;
using System.Linq;
using ScriptedScreensVector;
using VectorBuilder.Core;

static class HostTests
{
    public static void Run(Action<bool, string> check)
    {
        check(!VectorConfig.CurveLodEnabled && !VectorConfig.CountLodEnabled, "curve and count LOD are off, as the game's defaults");
        check(VectorConfig.Dither == 4f && VectorConfig.PixelsPerSegment == 3f && VectorConfig.MinimumSegments == 8, "config defaults match the game");

        for (var i = 0; i < 500; i++) ScriptedScreensVectorPlugin.Log!.LogWarning("w" + i);
        check(ScriptedScreensVectorPlugin.Log!.Warnings.Count <= 64, "the mod's log keeps at most 64 lines");

        var cyclic = new ChipRunner();
        cyclic.LoadAsync("""
            local ui = ss.ui.surface("main")
            local t = {} ; t.me = t
            ok, err = pcall(function() ui:element({ id = "e", type = "vector", props = t }) end)
            print(tostring(ok) .. " " .. tostring(err))
            """).Wait();
        check(cyclic.State == ChipState.Running && cyclic.Output.Any(l => l.StartsWith("false") && l.Contains("cyclic")),
              "a cyclic table is a catchable Lua error, not a stack overflow");

        var deep = new ChipRunner();
        deep.LoadAsync("""
            local ui = ss.ui.surface("main")
            local t = {} ; local c = t
            for i = 1, 200 do c.n = {} ; c = c.n end
            ok, err = pcall(function() ui:element({ id = "e", type = "vector", props = t }) end)
            print(tostring(ok) .. " " .. tostring(err))
            """).Wait();
        check(deep.State == ChipState.Running && deep.Output.Any(l => l.StartsWith("false") && l.Contains("deep")),
              "a table nested deeper than 64 is a catchable Lua error");

        var shared = new ChipRunner();
        shared.LoadAsync("""
            local ui = ss.ui.surface("main")
            local c = { 1, 2 }
            ui:element({ id = "e", type = "vector", props = { a = c, b = c } })
            """).Wait();
        var sharedProps = shared.Screens.ElementsOf("main").Single(e => e.Id == "e").Props;
        check(shared.State == ChipState.Running && sharedProps["a"] is List<object> { Count: 2 }
              && sharedProps["b"] is List<object> { Count: 2 }, "a sub-table shared by two keys converts under both");

        // 30 levels of { l = a, r = a } is 31 tables in Lua but 2^31 values once expanded: the host walk, not the Lua budget, must stop it
        var diamond = new ChipRunner();
        diamond.LoadAsync("""
            local ui = ss.ui.surface("main")
            local a = { x = 1 }
            for i = 1, 30 do a = { l = a, r = a } end
            ok, err = pcall(function() ui:element({ id = "e", type = "vector", props = a }) end)
            print(tostring(ok) .. " " .. tostring(err))
            """).Wait();
        check(diamond.State == ChipState.Running && diamond.Output.Any(l => l.StartsWith("false") && l.Contains("too large")),
              "a table whose shared sub-tables expand past the value budget is a catchable Lua error");

        var store = new ChipRunner();
        var one = store.Screens.Declare("a", "e", "panel", new() { ["unit"] = "px" }, new());
        var again = store.Screens.Declare("a", "e", "vector", null, new() { ["x"] = 1d });
        store.Screens.Declare("b", "f", "panel", null, new());
        check(ReferenceEquals(one, again) && again.Order == 0 && again.Type == "vector" && again.Rect == null
              && store.Screens.SurfaceNames.OrderBy(n => n).SequenceEqual(new[] { "a", "b" }),
              "host: a re-declared element keeps its record and order, takes the new type and rect; every declared surface is named");
        check(new ChipRunner(clock: () => 12.5).Now == 12.5, "host: ChipRunner.Now reads the chip's clock");
    }
}
