# M0 spike report: the vector core in the browser

Measured on 2026-10-04 at commit `11371bd` (branch `m0-wasm-core-spike`), with Lua-CSharp pinned at `d9fb336` and the vector mod at `4235ae5` (0.11.66). The work followed the M0 plan.

## Verdict: GO

All three of the plan's criteria hold. Each was checked again for this report.

| Criterion | Result | Evidence |
|---|---|---|
| 1. Both suites pass | yes | `core/Core.Tests`: 76/76, `ALL PASS`. The vector mod's own suite, compiled against our managed Unity stand-ins at the pinned 0.11.66: 295 PASS, 0 FAIL. That compile needed extra test-only stand-in members that are not committed (listed below); the production file set uses only committed members, as the Core build proves. |
| 2. Example 01 animates in the worker | yes | Example 01 draws from the worker, and the page redraws it on every animation frame. Example 01 is a still scene by design ("Nothing here animates"), so motion was checked with example 08: between two screenshots taken about 1 s apart, 4,080 canvas pixels changed (ripples, motes, dial, chart). |
| 3. A runaway tick halts without freezing the page | yes | `function tick(dt) while true do end end` gave `Halted: instruction budget exceeded (tick) (50000 instructions)`. The worst main-thread delay was 12 ms. A single-call stall in a tick gave `halted: timeout`, a fresh worker was ready in 64 ms, and the worst delay was again 12 ms. |

There is no blocker, so no fallback is needed. The number to watch is the browser frame time below: one example-08 frame takes about one 60 Hz frame budget. M1's planned work, caching the parsed scene and sending frames in binary, is expected to address it (not measured).

## Measurements

The machine is an x64 desktop with 32 hardware threads, Windows 11, .NET SDK 10.0.401 (runtime 10.0.12) and Chrome 154. Everything ran on localhost with no network or CPU throttling.

### Download size

`dotnet publish core/Wasm -c Release` into an empty folder gives 20 files in `_framework`. The compressed sizes are the SDK's own precompressed `.gz` and `.br` files.

| | bytes | MiB |
|---|---:|---:|
| raw | 3,993,827 | 3.81 |
| gzip | 1,534,017 | 1.46 |
| brotli | 1,256,414 | 1.20 |

The largest files (raw) are:
- `dotnet.native.wasm`: 1,486,510 B;
- `System.Private.CoreLib`: 1,205,013 B;
- `Lua`: 267,541 B;
- `dotnet.native.js`: 224,733 B;
- `dotnet.runtime.js`: 198,480 B;
- `VectorBuilder.Core`: 173,845 B;
- `System.Text.Json`: 129,301 B.

### Cold load to "core ready"

Each run used a new isolated browser context, so the cache was empty, against the Vite dev server. "Worker" is the page's own `core ready in N ms`, measured from `new Worker` to the ready message. "Navigation" runs from navigation start to the moment that text appeared.

| run | worker | navigation |
|---|---:|---:|
| 1 | 113 ms | 172 ms |
| 2 | 104 ms | 145 ms |
| 3 | 100 ms | 151 ms |
| **median** | **104 ms** | **151 ms** |

Not measured: load time over a real network. Localhost has no transfer time, and a static host would send 1.46 MiB gzip or 1.20 MiB brotli.

### `Frame()` for example 08 at 480×480

`web/public/examples/08-console.lua` is byte-identical to the vector mod's example. It tessellates to 3,436 vertices and 4,054 triangles with no problems. Its labels are not part of the mesh (see the limits below).

Each series is 300 frames after 20 to 50 warm-up frames, with a tick every 30 frames, as the page does at 60 fps.

| Where | median | p95 | min / max |
|---|---:|---:|---:|
| .NET desktop (JIT), mesh only (the `Exports.Mesh` logic), 3 runs | 0.92–0.97 ms | 1.34–1.40 ms | 0.87 / 2.9 ms |
| .NET desktop, mesh + JSON, 3 runs | 1.59–1.79 ms | 2.62–2.79 ms | 1.51 / 27 ms |
| Browser, in the worker: `Exports.Frame` (mesh + JSON in wasm) | 15.5 ms | 19.2 ms | 13.7 / 24.4 ms |
| Browser, in the worker: `JSON.parse` of that frame | 0.3 ms | 0.4 ms | 0.1 / 0.9 ms |
| Browser, page round trip (`postMessage` to reply) | **17.2 ms** | **21.0 ms** | 15.0 / 26.2 ms |

A few more numbers from the same runs:
- One frame is 169,701 characters of JSON.
- On the desktop, mesh + JSON allocate about 1.1 MiB per frame.
- The first frame, while the code warms up, took 45 ms on the desktop and 124 ms in the browser.
- The split between mesh and JSON inside wasm was not measured, because it would need timing code in `Exports`. On the desktop, JSON is about 40 % of the total.

**What it means.** The browser build is interpreted .NET IL, not AOT, and runs this code about ten times slower than the desktop JIT. At 17 ms per round trip, the worker can deliver at most about 58 frames per second of example 08 on this machine; slower machines get fewer.

The page never blocks: a frame is skipped while one is still in flight. The levers for M1, in order of cost:
1. Cache the parsed scene per `src`; `Render` parses it again on every frame.
2. Send frames in binary instead of JSON.
3. Reuse the `MeshBuilder`.
4. AOT compilation, if the first three are not enough. Its download cost was not measured.

### Instruction counts for example 08

| | `ChipRunner.LastInstructions` | exact count | share of budget | browser time |
|---|---:|---:|---:|---:|
| load | 1,000 | 1,302 | 0.26 % of 500,000 | 81 ms in the worker, 91 ms round trip |
| one tick | 0 | 191 (each of 5 ticks) | 0.38 % of 50,000 | 0.6 ms median in the worker (10 ticks) |

How these were counted:
- `LastInstructions` counts in whole steps of 1,000, rounded down. That is the hook period the budget uses, so a light tick shows 0.
- The exact counts come from a scratch tool. It ran the same script on a separate `LuaState` with the same fake host and a hook that fires on every instruction.
- That method was calibrated first: `for i=1,994 do end` counts 1,000 and `for i=1,995 do end` counts 1,001, as the metering design predicts.

The budget also holds in the browser. `while true do end` at load halts at 500,000 instructions within 41 ms of pressing Run.

### `//` (floor division)

**Rejected**, as on a chip. Lua-CSharp at `d9fb336` is Lua 5.2, so `x = 7 // 2` fails with `unexpected symbol near '/'`. Test: "Lua 5.4 floor division is rejected like on a chip" in `core/Core.Tests/Program.cs`.

### Changes to vector sources

**None.** `git submodule status`:

```
 d9fb336931d2dc874c924575cc15d9c2d35841ce core/vendor/lua-csharp (v0.5.6)
 4235ae551eec499548f03ab1665baff321cfcd42 core/vendor/vector (v0.2.1-95-g4235ae5)
```

Neither line has a `+` or `-` prefix, and `git status` inside each submodule is empty. Everything the browser needs beyond them is our own code: the Unity stand-ins, the fake host, a clock, and accessors for the mod's private mesh fields.

## What the spike proved and found

- **The game's Lua interpreter and the vector mod's own C# run unmodified in the browser.** The game's Lua interpreter (Lua-CSharp `d9fb336`) and the vector mod's own C# parser and tessellator (0.11.66) run unmodified in a module Web Worker on .NET 10 browser-wasm.
  - An earlier check found Lua-CSharp at `d9fb336` byte-identical to the `Lua.dll` that StationeersLua ships.
  - We compile Lua-CSharp's net10.0 target, while the game loads its netstandard2.1 build; the `#if` paths at `d9fb336` are equivalent.
- **Managed stand-ins replace Unity.** About 270 lines cover `Mathf`, `Vector2/3/4`, `Color`/`Color32`, `Rect`, `Matrix4x4` and `ColorUtility`, written from Unity's public docs.
  - The vector mod's own suite passes 295/295 on them; it was run again at the pin for this report. That run needed extra test-only members that are not committed: `Vector2.right`, `Vector2.ToString(fmt)`, `Vector3.one`, `Color(r,g,b)`, `Color.red`/`cyan` and `UI.VertexHelper`. The production file set uses only committed members, as the Core build proves.
  - The vector mod's author reviewed them and is taking them upstream as an opt-in build configuration.
- **The colour parser matches the game.**
  - The vector mod's author measured 20 colour strings on a console. Those results show three things:
    - names are case-insensitive;
    - `grey` is accepted and `gray` is rejected;
    - Unity's parser does not trim whitespace. The mod trims colour strings itself since 0.11.66, so the stand-in stays strict and the mod's own code does the trimming.
  - Unity's table of 23 colour names was read from the game's `UnityPlayer.dll`, and the vector mod's author confirmed it independently. `transparent` is in the table; `none` is not, so `none` is the mod's own special case.
  - Every row is a test. darkblue (`#00008B`) is read from the binary but has not yet been seen on a console.
- **Premultiplied gradient interpolation (0.11.60) is confirmed in game,** as reported by the vector mod's author from a console. The design spec had listed it as verified offline only.
- **`[UnsafeAccessor]` works in the trimmed browser-wasm build.** The core reads the mod's private `MeshBuilder` lists without reflection and without editing the mod.
- **`os.clock` needed an injected clock.** Lua-CSharp's default reads the process CPU time, which throws `PlatformNotSupportedException` on browser-wasm. The core now injects a clock that returns the seconds since the chip started. That is wall time, so deltas may differ: the game's `os.clock` is process CPU time.
- **The heap is capped at 512 MB** through `EmccMaximumHeapSize`; the default is 2 GB. A runaway allocation now ends the runtime, the page replaces the worker, and the restart takes 88–100 ms.
- **The instruction budget is exact.** It is 500,000 at load and 50,000 per tick, exact at multiples of 1,000. It halts by cancellation, so `pcall` and `xpcall` cannot catch it.
- **The sandbox removes what a chip lacks.** That is `debug`, `io`, `require`/`package`, `dofile`/`loadfile` and `os.exit`/`remove`/`rename`/`tmpname`/`getenv`/`execute`/`setlocale`, so `os` keeps only `time`, `clock`, `date` and `difftime`. It also removes `coroutine`, for M0 only: chips have it, but here it would run unmetered (M3).
- **The watchdog covers what metering cannot.**
  - The main thread times every request: boot 60 s, load 10 s, tick 2 s, frame 2 s. Time spent queued does not count, except a tick queued behind an in-flight frame (deliberate; gating ticks on frames would starve them).
  - On a timeout, a worker `error` event, or the runtime's own abort, the page terminates the worker and starts a fresh one, with a new runtime and a new chip. It then shows `halted: <why>`.
  - Each of these cases was run in the browser:
    - a `string.find` backtracking stall in a tick, cut at 2 s;
    - the same stall at load, cut at 10 s, while a legitimate 5.3 s load ran to completion;
    - a `collectgarbage` loop in a tick, caught by the watchdog with a large heap and by the budget with a small one;
    - a huge `string.rep`, and gradual growth to the heap cap: out of memory, reported as `worker crashed`;
    - a cyclic table passed to `set_props`: a stack overflow, caught as a timeout.
  - By design, but not run: `gsub` backtracking and `table.sort`.
  - A restart takes 57–101 ms. The page stayed responsive throughout, with a worst main-thread delay of 16 ms.

## Known limits carried forward

### M1: preview fidelity and speed

- **Soft glows band.** Colours are bytes (`FrameMesh.Colours`), so soft glows band more than under the game's dither shader. M1 needs dithering in WebGL, or float alpha/coverage.
- **Labels and images are not in the mesh.** `T` labels become text placements, which UGUI draws in game, and images go through a stub. The preview shows shapes only.
- **Every frame is rebuilt from scratch.**
  - `Render` parses the scene again on every frame; cache it per `src`. A cached scene's problem list then never shrinks, as in game.
  - Each frame allocates about 1.1 MiB: a new `MeshBuilder` of about 250 KB per `Render`, plus 170 K characters of JSON.
  - Binary frame transfer is already on the M1 roadmap.
- **Timing and input variables are not wired.** `since()` always reads 1e6, and `hover`/`down` never fire, because the clock, arrival times and pointer are not set.
- **A stack overflow is caught only by the timer.** `ToNet`/`ToMap` have no depth or cycle guard, so a cyclic table passed to `set_props` overflows the stack. That ends the runtime with no error event, and the 2 s watchdog reports it as `timeout`. Add a guard that raises a Lua error. Do this first in M1, before share links auto-run untrusted scripts.
- **One bad vertex fails the whole frame.** A NaN or ±Infinity vertex makes System.Text.Json throw in `Exports.Frame`, so the whole frame becomes `frame failed` (reasoned, not reproduced). Binary frames remove it.
- **Node patches have no effect in the preview.** `Exports.Mesh` builds a fresh `EvalContext` from the current props on every frame, so `keep=1` and `nodes` patches do nothing.
- **Element `type` is not stored.** Any element with `src`/`root` is drawn as a vector scene. That matters once native elements exist (D12).
- **Element rects are ignored.** Each structure is drawn at full surface size.
- **Span ids are not unique, and the list is post-order.** Click-select must pick the smallest span that contains the point. Upstream, child spans inside a masked group can go stale.
- **Runtime edge cases:**
  - `pcall` can catch out of memory, and the chip then carries on in a possibly degraded runtime.
  - .NET messages show as resource keys in the trimmed build; `UseSystemResourceKeys=false` would restore them at some size cost.
- **Page plumbing:**
  - A restart silently drops a queued Run click.
  - A tick can queue behind an in-flight frame.
  - The fallback reply can swallow an out-of-memory error during serialisation.
  - The worker's queue has no rejection handler.
  - A failed restart boot never retries.
  - `gl.ts` does not check shader compile and link.
  - The publish prints three CA1416 warnings (`JSExport` is browser-only); `[SupportedOSPlatform("browser")]` would silence them.
- **Test gaps:**
  - No test runs example 01 through the whole Lua → host → `Render` path. Move `Exports.Mesh` into Core with headless tests that run example 01 end to end.
  - No test checks that an untagged render after a tagged one has no spans.
  - The parse-order test distinguishes only two nodes.
  - The `os.clock` assertion could flake on a slow machine.

### M3: the full fake host

- **Coroutines are unmetered.** Lua-CSharp hooks are per thread, so `coroutine` is absent for M0, and a script that uses it fails loudly instead of hanging. M3 meters every thread, and must watch the re-entrancy of the cancellation in `CoroutineCore`.
- **The host is minimal.**
  - Handles have only `set_props`, and `set_resolution` is ignored.
  - The default `ui:size()` of 480×480 is a guess.
  - `tick` is a plain call, not a resumed coroutine, and `yield`, `sleep` and `ic.*` are not provided.
- **Conversion edge cases:**
  - A list with holes becomes a map.
  - A function inside a list becomes null.
  - A NaN or infinite `dt` would build invalid Lua.
- **Text differs from the game.** Error text carries a `Lua-CSharp:` prefix and the chunk name `chip`. `os.date()` with no format gives .NET-style text.
- **Counts are coarse.** The status shows instruction counts in whole steps of 1,000.
- **Each tick runs through a wrapper chunk.** `ChipRunner.TickAsync` compiles `if tick then tick(dt) end` on every tick, which adds about 7 metered instructions and a compile. Call `tick` directly.
- **Budgets overshoot unless they are multiples of 1,000.** Once budgets are editable, any other budget overshoots by up to 999. Restrict budgets to multiples of 1,000, or set the remainder as the final hook count.
- **The preview is more forgiving than the oldest supported mod.** The preview runs vector 0.11.66, which trims colour strings, while the export minimum is 0.11.64. A runtime-built colour in a custom-Lua block can pass in the preview and draw magenta on 0.11.64/0.11.65. Product call: raise the minimum to the pinned version, or warn on untrimmed colour data.

### M6: build, CI and deploy

- **A fresh clone needs setup steps before `npm run dev`** (see "How to run it"); there is no `predev` script. On Windows, cloning Lua-CSharp also needs `core.longpaths`.
- **`npm run precore` copies stale files.** It copies everything in the publish folder, and fingerprinted files from earlier publishes pile up there: 37 files and 13 MB instead of 20 files and 4 MB. A deploy should publish into a clean folder, or copy only the current set.
- **`copy-core.mjs` is fragile.** It is relative to the working directory, and it deletes the old copy before checking that the source exists.
- **CI should run the vector mod's suite on the stand-ins.** It is the guard for Unity semantics such as `RoundToInt(2.5) == 2`. CI needs the test-only stand-in members listed above added first, or the vector mod author's upstream opt-in stub configuration.
- **Root-absolute URLs break under a project path.** `web/src/core.worker.ts` (`/_framework/`) and `web/src/main.ts` (`/examples/`) break when served from a GitHub Pages project path. Use `import.meta.env.BASE_URL`.
- **Harden the page before share links.** Add a CSP (`script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'`), and render Lua-sourced strings as text only.
- **The version check can fall through.** If the vector csproj ever lost its `<Version>`, the build would fall back to 1.0.0.0, and only the test runner's `Major == 0` check would catch it. Add a build error for an empty match.

### Open checks

- The vector pin 4235ae5 now has the annotated tag `v0.11.66`, so recursive clones survive upstream branch moves. The tag message says it is not a Workshop release: TagNodes/NodeSpans, `ver`, the stroke units=bbox binding and magenta for an undeclared gradient id have not been drawn on a console at that commit.
- Measure darkblue on a console (`InGameTest-colournames.lua`).
- Run a differential test of the stand-ins against Unity's managed math on random inputs, for last-bit differences in trigonometry and `Pow`.

## How to run it

You need the .NET SDK 10.0.401 or newer, and Node 24 with npm.

```sh
git clone --recurse-submodules <this repo>    # Windows: git -c core.longpaths=true clone --recurse-submodules ...
cd <repo>                                     # an existing clone: git submodule update --init
dotnet workload install wasm-tools wasm-experimental
dotnet run --project core/Core.Tests          # the headless suite; ends with ALL PASS
dotnet publish core/Wasm -c Release           # builds the browser core
cd web
npm install
npm run precore                               # copies the published _framework into web/public
npm run dev                                   # then open the printed localhost URL
```

Press **Run** once the status shows `core ready`.

These steps were checked from a fresh clone for this report, with no local override:
- the suite printed `ALL PASS`;
- the publish succeeded and `precore` copied 20 files;
- the page showed `core ready in 103 ms`, and example 01 ran.

Without `core.longpaths`, cloning into a deep Windows folder failed with "Filename too long" in Lua-CSharp's Unity sample folder.

Notes:
- After any change under `core/`, run the publish and `npm run precore` again.
- The build reads the vector sources from the `core/vendor/vector` submodule. To build against another checkout, pass `-p:VectorSrc=<folder>/`, or set `VectorSrc` in a gitignored `core/VectorSrc.user.props`.
- The build stops if those sources are older than 0.11.64.
