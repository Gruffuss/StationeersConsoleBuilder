using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Lua;
using Lua.IO;
using Lua.Platforms;
using Lua.Runtime;
using Lua.Standard;

namespace VectorBuilder.Core
{
    public enum ChipState { Running, Halted }

    /// <summary>
    /// One Lua chip on Lua-CSharp, the interpreter StationeersLua ships: a load, then <c>tick(dt)</c> calls,
    /// each metered against its own instruction budget. Any error halts the chip for good, as in game.
    /// </summary>
    public sealed class ChipRunner
    {
        const int Step = 1000;  // the count hook fires once per Step VM instructions

        readonly PrintLog printed = new();
        readonly LuaState lua;
        readonly LuaFunction meter;
        readonly int initBudget, tickBudget;
        readonly Func<double> clock;
        int budget;
        bool outOfMemory;
        CancellationTokenSource halt = new();

        // clock: seconds, read by os.clock and the vector host; by default a stopwatch started here.
        // host: what the page hands the StationeersLua host (enums, simulated devices, persist, memory, the day clock); none is the empty host.
        public ChipRunner(int initBudget = 500_000, int tickBudget = 50_000, Func<double>? clock = null, HostJson? host = null)
        {
            (this.initBudget, this.tickBudget) = (initBudget, tickBudget);
            if (clock == null)
            {
                var started = Stopwatch.StartNew();
                clock = () => started.Elapsed.TotalSeconds;
            }
            this.clock = clock;
            Vectors = new VectorHost(clock);
            Screens = new FakeScriptedScreens(Vectors);
            Stationeers = new FakeStationeersLua(host ?? HostJson.Empty, Screens);
            lua = LuaState.Create(LuaPlatform.Default with { StandardIO = printed, OsEnvironment = new ChipClock(clock) });
            lua.OpenStandardLibraries();
            // Absent on chips, and each one would let a script escape the meter or the sandbox:
            // debug.sethook clears the meter, file loading and os.exit reach the host.
            foreach (var lib in new[] { "io", "debug" })
                lua.Environment[lib] = lua.LoadedModules[lib] = LuaValue.Nil;
            foreach (var name in new[] { "dofile", "loadfile", "require", "package" })
                lua.Environment[name] = LuaValue.Nil;
            var os = lua.Environment["os"].Read<LuaTable>();
            var chipOs = new LuaTable();
            foreach (var name in new[] { "time", "clock", "date", "difftime" })
                chipOs[name] = os[name];
            lua.Environment["os"] = lua.LoadedModules["os"] = chipOs;
            Screens.Install(lua, host?.icons);
            Stationeers.Install(lua);
            // Out of memory in host code halts the run the way the budget does, so pcall and xpcall rethrow it; Run then
            // hands the caller an OutOfMemoryException.
            Screens.OutOfMemory = () =>
            {
                outOfMemory = true;
                halt.Cancel();
                halt.Token.ThrowIfCancellationRequested();
            };

            // The hook runs before the VM fetches instruction n*Step+1, so LastInstructions >= budget means
            // the script is about to run instruction budget+1. Exact when the budget is a multiple of Step.
            // The budget halts by cancelling, not with a plain Lua error: pcall and xpcall rethrow a cancellation,
            // while a caught error would leave Lua-CSharp's hook disabled (IsInHook stays set) and the chip unmetered.
            meter = new LuaFunction("meter", (_, _) =>
            {
                LastInstructions += Step;
                if (LastInstructions >= budget)
                {
                    halt.Cancel();
                    halt.Token.ThrowIfCancellationRequested();
                }
                return new ValueTask<int>(0);
            });

            // Coroutines: every thread the script makes gets the meter (Lua-CSharp hooks are per thread), so none runs unmetered.
            // create and wrap are the stock ones, each thread they make then hooked, so a script meets the stock argument checks
            // and errors: create returns its thread (protected: resume hands an error back as false and its message), wrap a
            // closure holding its thread as its first upvalue (unprotected: an error goes on to the caller with its line).
            LuaFunction Metered(string name, Func<LuaFunctionExecutionContext, CancellationToken, ValueTask<int>> stock,
                                Func<LuaValue, LuaState> threadOf) => new(name, async (ctx, ct) =>
            {
                var count = await stock(ctx, ct);
                threadOf(ctx.State.Stack.AsSpan()[ctx.ReturnFrameBase]).SetHook(meter, "", Step);
                return count;
            });
            var co = lua.Environment["coroutine"].Read<LuaTable>();
            co["create"] = Metered("coroutine.create", CoroutineLibrary.Instance.Create, made => made.Read<LuaState>());
            co["wrap"] = Metered("coroutine.wrap", CoroutineLibrary.Instance.Wrap,
                                 made => made.Read<CSharpClosure>().UpValues[0].Read<LuaState>());
            // The stock xpcall rethrows a cancellation only when its own thread's token is cancelled, and a coroutine runs on the
            // token of the execution that first resumed it: in a later execution xpcall caught the meter's cancellation, and the
            // thread, its hook left off (Lua-CSharp stays in the hook it left by a throw), ran unmetered and hung the preview
            // (measured). So xpcall is the stock one with its handler first rethrowing a spent budget.
            lua.Environment["xpcall"] = new LuaFunction("xpcall", (ctx, ct) =>
            {
                if (ctx.ArgumentCount > 1 && ctx.Arguments[1].TryRead<LuaFunction>(out var handler))
                    ctx.State.Stack.AsSpan()[ctx.FrameBase + 1] = new LuaFunction(handler.Name, (h, hct) =>
                    {
                        halt.Token.ThrowIfCancellationRequested();
                        return h.State.RunAsync(handler, h.ArgumentCount, h.ReturnFrameBase, hct);
                    });
                return BasicLibrary.Instance.XPCall(ctx, ct);
            });
        }

        public ChipState State { get; private set; }
        public string? Error { get; private set; }          // Lua error or the game's instruction-limit error
        public long LastInstructions { get; private set; }  // instructions used by the last Load/Tick, in whole Steps
        public FakeScriptedScreens Screens { get; }
        public FakeStationeersLua Stationeers { get; }
        public VectorHost Vectors { get; }
        public double Now => clock();  // the chip's clock, in seconds
        public IReadOnlyCollection<string> Output => printed.Lines;  // what `print` wrote: the last 50 lines
        internal LuaState Lua => lua;  // for tests that fake a host failure

        public const int MaxEvents = 8;   // spec 7: at most 8 UI events a tick

        // The end of every chip execution, the load and each tick, halted or not, flushes the batch (measured in game, 0.11.89).
        public async Task LoadAsync(string luaSource)
        {
            await Run(async token => await lua.DoStringAsync(luaSource, "chip", token), initBudget);
            Screens.Flush();
        }

        // One metered execution (spec 7): the queued page texts (VB.setSrc, ruling P19) and the builder's page visits (VB.go),
        // each when the script defines it, then at most MaxEvents UI events in arrival order, each through its element's
        // handler with (value, player), then tick(dt). Events past MaxEvents wait for the next tick.
        public async Task TickAsync(double dt = 0.5)
        {
            Stationeers.Advance(dt);  // the preview's time moves by each tick's dt before the tick runs
            await Run(async token =>
            {
                foreach (var (surface, src) in Screens.TakeSrcs())
                    if (lua.Environment["VB"].TryRead<LuaTable>(out var vb0) && vb0["setSrc"].TryRead<LuaFunction>(out var setSrc))
                        await Call(setSrc, surface, src, token);
                foreach (var page in Screens.TakeVisits())
                    if (lua.Environment["VB"].TryRead<LuaTable>(out var vb) && vb["go"].TryRead<LuaFunction>(out var go))
                        await Call(go, page, token);
                foreach (var (fn, value, player) in Screens.TakeEvents(MaxEvents))
                    await Call(fn, value, player, token);
                if (lua.Environment["tick"].TryRead<LuaFunction>(out var tick))
                    await Call(tick, dt, token);
            }, tickBudget);
            Screens.Flush();
        }

        // Not async: the argument span must not live across an await.
        ValueTask<LuaValue[]> Call(LuaFunction f, LuaValue a, CancellationToken token) => lua.CallAsync(f, [a], token);
        ValueTask<LuaValue[]> Call(LuaFunction f, LuaValue a, LuaValue b, CancellationToken token) => lua.CallAsync(f, [a, b], token);

        // A halted chip's VM is dead (and its hook may be stuck off), so nothing runs on it again: reload with a new ChipRunner.
        async Task Run(Func<CancellationToken, Task> body, int phaseBudget)
        {
            if (State == ChipState.Halted)
                return;
            LastInstructions = 0;
            budget = phaseBudget;
            halt = new CancellationTokenSource();
            lua.SetHook(meter, "", Step);  // restarts the VM's countdown, so each phase is metered from its first instruction
            try
            {
                await body(halt.Token);
                // Whatever caught the meter's cancellation (a protected resume, CoroutineCore; an xpcall), a spent budget halts.
                // A guard: the VM checks the caller's token as each C# call returns, and the main thread's token is this run's,
                // so no script or host function was found that reaches this line with the budget spent (measured).
                if (halt.IsCancellationRequested)
                    throw new OperationCanceledException(halt.Token);
            }
            catch (Exception e)
            {
                // The host ran out, not the script (Lua-CSharp wraps it in a LuaRuntimeException): the caller's to handle.
                // ponytail: an OOM inside Lua-CSharp itself (string.rep, table growth) under pcall is still caught as a Lua
                // error and the chip runs on; only host code (FakeScriptedScreens.Method) and unprotected throws end the run.
                for (var inner = e; inner != null; inner = inner.InnerException)
                    if (inner is OutOfMemoryException || outOfMemory)
                        throw new OutOfMemoryException("out of memory", e);
                State = ChipState.Halted;
                // P9 measured 2026-10-11: a load overrun uses this tick wording too.
                Error = halt.IsCancellationRequested
                    ? $"Instruction limit exceeded: script used more than {budget.ToString("N0", CultureInfo.InvariantCulture)} instructions in a single tick."
                    : e.Message;
            }
        }
    }

    /// <summary>
    /// The source of <c>os.clock</c>. Lua-CSharp's default reads the process CPU time, which throws on browser-wasm
    /// (PlatformNotSupportedException), so the chip's clock, the seconds since it started, stands in for it.
    /// </summary>
    sealed class ChipClock(Func<double> clock) : ILuaOsEnvironment
    {
        public double GetTotalProcessorTime() => clock();
        public string? GetEnvironmentVariable(string name) => null;                    // os.getenv is not on chips
        public ValueTask Exit(int exitCode, CancellationToken cancellationToken) => default;  // nor is os.exit
    }

    /// <summary>Where <c>print</c> writes instead of the console: the last 50 lines, each cut at 500 chars, for the page to show.</summary>
    sealed class PrintLog : ILuaStandardIO, ILuaStream
    {
        const int MaxLines = 50, MaxLine = 500;
        readonly StringBuilder line = new();
        public Queue<string> Lines { get; } = new();

        public ILuaStream Input => this;
        public ILuaStream Output => this;
        public ILuaStream Error => this;
        public bool IsOpen => true;
        public LuaFileOpenMode Mode => LuaFileOpenMode.Write;
        public void Dispose() { }

        public ValueTask WriteAsync(ReadOnlyMemory<char> content, CancellationToken cancellationToken)
        {
            var rest = content.Span;
            while (true)
            {
                var end = rest.IndexOf('\n');
                var part = end < 0 ? rest : rest[..end];
                line.Append(part[..Math.Min(part.Length, MaxLine - line.Length)]);
                if (end < 0)
                    return default;
                Lines.Enqueue(line.ToString());
                line.Clear();
                if (Lines.Count > MaxLines)
                    Lines.Dequeue();
                rest = rest[(end + 1)..];
            }
        }
    }
}
