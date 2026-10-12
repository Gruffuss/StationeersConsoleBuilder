using System;
using System.Linq;
using System.Threading.Tasks;
using Lua;
using Lua.Platforms;
using Lua.Standard;
using VectorBuilder.Core;

/// <summary>Coroutines on a chip: present, metered per thread, never hanging the preview.</summary>
static class CoroutineTests
{
    static async Task<ChipRunner?> Within(Func<ChipRunner, Task> run, int seconds = 10)
    {
        var chip = new ChipRunner();
        var task = Task.Run(() => run(chip));
        return await Task.WhenAny(task, Task.Delay(seconds * 1000)) == task ? chip : null;
    }

    // What `print` writes when the stock library (unmetered) runs the chunk, under the chip's chunk name
    static string[] Stock(string lua)
    {
        var log = new PrintLog();
        var state = LuaState.Create(LuaPlatform.Default with { StandardIO = log });
        state.OpenStandardLibraries();
        state.DoStringAsync(lua, "chip").AsTask().Wait();
        return log.Lines.ToArray();
    }

    public static void Run(Action<bool, string> check)
    {
        var c = new ChipRunner();
        c.LoadAsync("""
            local co = coroutine.create(function(a) local b = coroutine.yield(a + 1) return b * 2 end)
            print(coroutine.resume(co, 1)) print(coroutine.resume(co, 5)) print(coroutine.status(co))
            local f = coroutine.wrap(function() coroutine.yield(1) coroutine.yield(2) end)
            print(f(), f())
            print(pcall(coroutine.wrap(function() error("inner") end)))
            """).Wait();
        check(c.State == ChipState.Running && c.Output.Take(4).SequenceEqual(new[] { "true\t2", "true\t10", "dead", "1\t2" }) && c.Output.Last().StartsWith("false") && c.Output.Last().Contains("inner"),
              $"coroutines: create, resume, yield, status and wrap behave as Lua 5.2's; an error in a wrapped one reaches pcall {string.Join("|", c.Output)} {c.Error}".TrimEnd());

        c = new ChipRunner();
        c.LoadAsync("print(coroutine.resume(coroutine.create(function() error('E') end))) print('after')").Wait();
        check(c.State == ChipState.Running && c.Output.SequenceEqual(new[] { "false\tE", "after" }),
              $"coroutines: create makes a protected thread, so resume hands an error back as false and its message and the chip runs on {string.Join("|", c.Output)} {c.Error}".TrimEnd());

        c = new ChipRunner();
        c.LoadAsync("""
            ticker = coroutine.wrap(function() local n = 0 while true do n = n + 1 coroutine.yield(n) end end)
            function tick() print("tick " .. ticker()) end
            """).Wait();
        c.TickAsync().Wait();
        c.TickAsync().Wait();
        check(c.Output.SequenceEqual(new[] { "tick 1", "tick 2" }), "coroutines: one made at load resumes on later ticks");

        foreach (var (name, lua) in new[] {
            ("a wrapped runaway", "coroutine.wrap(function() while true do end end)()"),
            ("a resumed runaway", "local co = coroutine.create(function() while true do end end) print(coroutine.resume(co))"),
            ("a runaway under pcall", "print(pcall(coroutine.wrap(function() while true do end end)))"),
            ("a runaway in a nested coroutine", "coroutine.wrap(function() coroutine.wrap(function() while true do end end)() end)()") })
        {
            var done = Within(chip => chip.LoadAsync(lua)).Result;
            check(done != null && done.State == ChipState.Halted && done.Error == "Instruction limit exceeded: script used more than 500,000 instructions in a single tick.", $"coroutines: {name} halts on the load budget, never hangs");
        }

        // xpcall rethrows a cancellation only when the calling thread's token is cancelled, and a coroutine runs on the
        // token of the execution that first resumed it: in a later tick xpcall caught the budget's cancellation, and the
        // thread's hook stayed off (Lua-CSharp leaves it in the hook), so a loop in a new frame after it hung (measured)
        var stale = Within(async chip =>
        {
            await chip.LoadAsync("""
                co = coroutine.wrap(function()
                  coroutine.yield()
                  xpcall(function() while true do end end, function(m) return m end)
                  local function spin() while true do end end
                  spin()
                end)
                co()
                function tick() co() end
                """);
            await chip.TickAsync();
        }).Result;
        check(stale != null && stale.State == ChipState.Halted && stale.Error == "Instruction limit exceeded: script used more than 50,000 instructions in a single tick.",
              "coroutines: xpcall in a coroutine made at load cannot catch a later tick's budget; a runaway after it halts, never hangs");

        c = new ChipRunner();
        c.LoadAsync("""
            print(xpcall(function(a, b) return a + b end, print, 1, 2))
            print(xpcall(function() error("x", 0) end, function(m) return "handled " .. m end))
            print(pcall(xpcall, function() end, nil))
            """).Wait();
        var xp = c.Output.ToArray();
        check(c.State == ChipState.Running && xp.Length == 3 && xp[0] == "true\t3" && xp[1] == "false\thandled x" && xp[2].StartsWith("false\t") && xp[2].Contains("xpcall"),
              $"coroutines: xpcall still passes its arguments, calls its handler and refuses a handler that is not a function {string.Join("|", xp)} {c.Error}".TrimEnd());

        // The metered create, wrap and xpcall read as the stock ones in every error a script can catch: a bad argument
        // names the function as the caller called it, at the caller's line; a wrapped coroutine's error keeps its line
        const string Errors = """
            print(pcall(function() coroutine.wrap(1) end))
            print(pcall(coroutine.wrap))
            print(pcall(coroutine.create))
            local w = coroutine.wrap
            print(pcall(function() w(nil) end))
            print(pcall(coroutine.wrap(function() error("inner") end)))
            print(pcall(function() local k k = coroutine.wrap(function() k() end) k() end))
            local done = coroutine.wrap(function() end) done()
            print(pcall(done))
            print(pcall(function() xpcall(function() end, nil) end))
            print(pcall(xpcall))
            print(xpcall(function() error("e") end, function(m) return "h: " .. m end))
            print(pcall(function() xpcall(function() error("a") end, function() error("in handler") end) end))
            """;
        c = new ChipRunner();
        c.LoadAsync(Errors).Wait();
        var stock = Stock(Errors);
        var same = c.Output.SequenceEqual(stock);
        var odd = c.Output.Zip(stock).FirstOrDefault(p => p.First != p.Second);
        var why = same ? "" : odd.First != null ? $"{odd.First} | stock: {odd.Second}" : $"{c.Output.Count} lines | stock: {stock.Length}";
        check(c.State == ChipState.Running && same, $"coroutines: create, wrap and xpcall raise and report errors as stock Lua-CSharp's {why} {c.Error}".TrimEnd());

        const string Split = "function tick() local co = coroutine.create(function() for i = 1, {0} do end end) coroutine.resume(co) for i = 1, {0} do end end";
        var under = new ChipRunner();
        under.LoadAsync(string.Format(Split, 20000)).Wait();
        under.TickAsync().Wait();
        var over = new ChipRunner();
        over.LoadAsync(string.Format(Split, 30000)).Wait();
        over.TickAsync().Wait();
        check(under.State == ChipState.Running && over.State == ChipState.Halted && over.Error == "Instruction limit exceeded: script used more than 50,000 instructions in a single tick.",
              "coroutines: a coroutine's instructions count against the tick's 50,000 with the main thread's (2 x 20,000 runs, 2 x 30,000 halts)");
    }
}
