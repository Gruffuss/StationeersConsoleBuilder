# M2a report: fidelity, checks, catalogue and the property panel

Measured on 2026-10-05 at commit `4c52d72` (branch `m2a-fidelity-panel`), with Lua-CSharp pinned at `d9fb336` and the vector mod at `c52bbef` (v0.11.94); the measurements are that pin's. The pin is now vector `1f877d7` v0.11.118 (see [M6 re-pin](m6-repin.md)), and the re-pin rows below say what each later tag was checked against. The console captures are v0.11.83's (`d3d3bfe`, which differs from the tag only in `TODO.md`). The work followed the M2a plan; M1's report is `docs/m1.md`.

## Verdict: delivered; the preview matches the v0.11.83 captures

Every M2a item of D9, as the owner's updates left it, is in place, and the comparison found no preview bug.

| M2a item | Result | Evidence |
|---|---|---|
| Re-pin to the newest tag, v0.11.87 to v0.11.101 (T1, then re-pins R1 to R10) | yes | T1 pinned v0.11.87, R1 v0.11.90, R2 v0.11.91, R5 v0.11.94, R6 v0.11.95 (a crash fix in colour expressions), R7 v0.11.96 (nine silent faults reported), R8 v0.11.97 (the rest of the silence batch: a malformed brace, an unreadable `fmt`, a `]` in a placeholder's format), R9 v0.11.99 (0.11.98's pixel batch, and 0.11.99's guarded placeholder format and reported def op in a clip) and R10 v0.11.101 (0.11.100's `fmt` check, which formats a sample, and 0.11.101's placeholder that retries a format as a long); R3 applied the in-game flush measurements, R4 the `REFERENCE.md` cross-check. At R10, `core/Core/LiveScene.cs` and `core/Core/VectorHost.cs` were ports at v0.11.101, the identical-`src` no-op included. The examples went from 15 to 18 (`web/src/ExampleScripts.tsx`, `web/test/fixtures/examples/`). The depth caps went as upstream removed them (0.11.85, 0.11.86): parse, print, validate, numbering, the scene checks and the compositor's numbering use explicit stacks and keep no path per node, with tests at 100,000 levels; a scene crosses to the check worker packed flat (`web/src/srctext/wire.ts`). The C# suite checks `ver == 1201`, and `VECTOR_FLOOR` is `'0.11.101'`. |
| The attribute catalogue, with drift tests | yes | `web/src/schema/`: a base extracted from the pinned parser (`extract.ts`, `extracted.json`) and a hand overlay (`overlay.json`). `extract.test.ts` fails when the pin's parser changes; the C# scope oracle (`core/Core.Tests/SchemaTests.cs`) checks that every overlay key changes what the mod parses, op by op. Rows where `REFERENCE.md` and the code disagree follow the code at the pin, marked provisional. |
| The property panel, with trap warnings | yes | `web/src/editor/PropertyPanel.tsx` and `fields.ts`: every parsed key with its type, default and enum; the fx toggle only where an expression is read; `<datalist>` autocomplete. `web/src/schema/traps.ts` runs in the check worker beside validation, and each warning sits beside its key. A colour the mod takes, with a report or in silence, is a warning, never an error. |
| Linear light | yes | `web/src/editor/gl.ts`: WebGL 2 composites into an 8-bit linear target and encodes once (`linear.ts` holds the arithmetic and its tests). The probes below match the captures to within 1 in every channel, where M1 was up to 48 off. |
| Fonts and the Vanilla + colours | yes | Self-hosted OFL faces in `web/public/fonts` (Liberation Sans, the default, and five Barlow faces), named as ScriptedScreensFonts names them (`web/src/catalog/fonts.json`); any other font by name with an info note, or imported from a local file and kept in that browser (`FontImport.tsx`, D13). The Vanilla + theme's colours (`web/src/theme/`) give the panel's swatches and a new page's ground. |
| Page shapes, with a size per surface | yes | `web/src/model/shapes.ts` and `PageShape.tsx`: square, 2×1, monitor, vertical 2×1, the AC face (beta) and custom sizes, each with its design units; each surface's `ui:size()` is its page's size (`CoreBridge.load(lua, size, sizes)`). |
| Native `panel` and `label` | yes | The core composes a panel (flat or a two-stop gradient) and a label (a `FrameText` drawn by the text layer); the shell declares each page's background as a panel. The captures' backgrounds match exactly (probes). |
| The comparison against the 0.11.83 captures | yes | Below: at a matched phase, examples 01–16 and 18 differ by 0.87 % to 6.10 % at tolerance 4, all of it explained; 17 by 57.97 %, its pictures (`IMG` is not drawn). |

Also delivered:
- **Scene checks in a worker** with a hard timeout (`web/src/srctext/checker.ts`, `check.worker.ts`): a check that times out says "too large to check here", never "invalid", and the editor keeps the last clean scene.
- **happy-dom** for DOM wiring tests and the smoke test, closing M1's N-C (App and PageTabs wiring) and N1 (a rename returns focus).
- **The fake host's flush model and the exporter's commit rule.** `core/Core/FakeScriptedScreens.cs` batches upserts and flushes at `ui:commit()` and at the end of every chip execution, the load included; `data`, `nodes` and `ease` are replaced whole, other props merge. `web/src/codegen/generate.ts` commits between writes that would lose a table. M1's finding 3 is closed: examples 10 and 12 now show the same labels as their captures.
- **The text fields M1 dropped** (`web/src/runtime/frame.ts`, `TextLayer.tsx`): kerning, every shadow, the inset shadow, the clip outline, tint and shear, with letter spacing, line height, the outline and the element origin under test.

Suites at the end of M2a: `core/Core.Tests` 365 checks, `ALL PASS`; `npm test` 602 tests in 43 files; `npm run build` clean (M1: 252, 316 in 21 files). A browser smoke ran examples 01–18 in both modes with no console error. The project mode's structure-only fixtures carry no data, so the mod lists their unresolved data names, as at M1; the script mode reports no problem.

What the verdict does not cover:
- **Captures are not a console.** They are camera renders of a cloned tree. They cannot show glides (`ease`), `since()`, hover or presses, and outside every element they hold nothing at all (see the empty surface below), so the console's own empty surface is still not measured.
- **Text is compared by eye and by its ink box.** Labels are DOM text, so `diffPercent` sees shapes only; the title of 13 is the one label measured (colour, centre, width).
- **`ztext` interleaving was not drawn at M2a.** All text was on top of the canvas; 14 showed where the game put it under a shape. M2c's cover pass now draws it (`docs/m2c.md`).

## Measurements

The machine is an AMD Ryzen 9 9950X3D (16 cores, 32 threads) on Windows 11 Pro 10.0.26200, with .NET SDK 10.0.401 and Node 24.19.0. The browser is the Chromium 152.0.7977.130 in the desktop browser pane, drawing through ANGLE (Direct3D 11) on an NVIDIA GeForce RTX 3090, at `devicePixelRatio` 1. Everything ran on localhost against the Vite dev server, from a clean publish of the core.

The browser pane was hidden during the measurements. The page stayed "visible" and its timers ran, but animation frames and `ResizeObserver` callbacks did not fire. So `requestAnimationFrame` was replaced from the page's console with a 16 ms timer (not committed); it paced frame requests at 50 to 60 per second, against the 23 that M1's pane gave. A round trip is timed per request, so the pacing does not change it.

### Example 08 frame, 460 × 460 surface, scale 1

The dev "Example scripts" mode with "Compare" on (zoom 1). Each series is 300 frames after a warm-up of at least 1 s, with the chip ticking every 0.5 s. The table shows the first series, and the brackets the other two.

| | median | p95 | min / max |
|---|---:|---:|---:|
| round trip, untagged | **6.3 ms** (5.6, 5.9) | 8.7 ms (6.8, 6.9) | 4.8 / 39.0 ms |
| round trip, tagged | **5.8 ms** (5.9, 5.8) | 7.3 ms (7.3, 7.4) | 4.6 / 10.8 ms |
| worker `Frame`, untagged | 6.1 ms (5.5, 5.7) | 8.5 ms (6.7, 6.7) | 4.6 / 38.0 ms |
| worker `Frame`, tagged | 5.7 ms (5.7, 5.6) | 7.1 ms (7.0, 7.2) | 4.4 / 10.6 ms |

- **Against M1:** 5.5 ms median untagged. The medians here are 5.6 to 6.3 ms; the frame now carries the native panel and the new text fields.
- **The frame:** about 3,420 vertices and 4,030 triangles (the count follows the animation), 8 labels, 218 spans when tagged, no problems.

### The renderer's draw

`performance.now()` around `renderer.draw`, from the page's console, 300 frames each. The 1036 × 460 case is example 08 loaded with a 2×1 page's size and drawn by a second renderer on a 1036 × 460 canvas.

| | draw | draw, then a 1-pixel `readPixels` | 300 draws back to back, per draw |
|---|---|---|---|
| 08 at 460 × 460 (3,424 vertices) | median 0.0, p95 0.1, max 0.1 ms | median 0.6, p95 1.2 ms | 0.013 to 0.032 ms; 0.035 to 0.068 ms with the GPU |
| 08 at 1036 × 460 (4,008 vertices) | median 0.0, p95 0.1, max 0.4 ms | median 0.6, p95 1.2 ms | 0.018 to 0.064 ms; 0.046 to 0.099 ms with the GPU |

The page's timer has a resolution of 0.1 ms, so the draw call returns in under 0.1 ms at both sizes. The GPU's work is waited for only by a readback, and a 1-pixel readback costs about 0.5 ms on its own.

### Scene checks

`checker.check` round trips, 100 runs of each scene, each on a fresh `structuredClone` so the cache misses. The worst shapes are M1's 12-level doubling symbol scenes from `print.test.ts`.

| Scene | Verdict | median | p95 | min / max |
|---|---|---:|---:|---:|
| Example 08 (3,832 characters of `src`) | clean | 0.7 ms | 1.2 ms | 0.4 / 4.0 ms |
| Task 2's 5,000-symbol `USE` chain | clean (232,791 characters) | 73.3 ms | 85.1 ms | 50.5 / 107.3 ms |
| 12 doubling levels over a 100-node leaf | too large to check here: more than 100,000 nodes | 102.0 ms | 116.8 ms | 98.9 / 146.8 ms |
| 12 levels of `USE` pairs, 300 arguments: a long text spliced per argument | too large to check here: too much work | 2.5 ms | 3.3 ms | 2.2 / 4.1 ms |
| the same, whole-value `%` params | too large to check here: too much work | 128.6 ms | 173.9 ms | 119.8 / **268.0 ms** |
| the same, one-character `"%"` values | too large to check here: too much work | 22.8 ms | 27.8 ms | 21.6 / 34.4 ms |
| the same, 300 arguments merged at every level | too large to check here: too much work | 127.4 ms | 140.9 ms | 114.2 / 153.3 ms |

The worst seen is 268 ms. The main thread stayed responsive meanwhile: the frame series ran at 57 to 61 frames a second throughout, the longest gap between two frames was 34 ms (during the chain, whose clone and packing run on the main thread), and a 16 ms timer was never more than 9 ms late.

### A panel commit

From a `setScene` dispatch to the first frame whose vertex colours carry the change, 20 times, alternating the fill of example 08's first node: median **40.6 ms** (min 18.1, p95 48.5, max 54.7 ms). The patch round trip itself (`bridge.patchMs`) was 2.6 ms at the median. Eight more runs, split: the check lands 5 to 8 ms after the dispatch, the patch is sent 27 to 32 ms after it (a render, the patch effect and one animation frame, 16 ms here), and the frame follows about 10 ms later.

### Load

| | runs | median |
|---|---|---:|
| Page load to "core ready", dev server, warm cache (the page's own `core ready in N ms`) | 121, 252, 139 ms | **139 ms** |
| Navigation start to "core ready" (the worker's start time plus the above) | 273, 612, 275 ms | 275 ms |

M1 measured 392 ms and 828 ms. The hidden pane painted nothing during these loads, which may flatter them.

### Download size

From `dotnet publish core/Wasm -c Release` into an empty `core/Wasm/bin/publish`: 22 files in `_framework` (M1: 20). The compressed sizes are the SDK's own `.gz` and `.br` files.

| | bytes | MiB | M1 |
|---|---:|---:|---:|
| raw | 4,179,179 | 3.99 | 4,080,355 |
| gzip | 1,605,182 | 1.53 | 1,564,557 |
| brotli | 1,315,312 | 1.25 | 1,280,203 |

The largest files (raw) are:
- `dotnet.native.wasm`: 1,486,510 B;
- `System.Private.CoreLib`: 1,228,565 B;
- `VectorBuilder.Core`: 268,565 B (M1: 245,013);
- `Lua`: 267,541 B;
- `dotnet.native.js`: 224,733 B;
- `dotnet.runtime.js`: 198,480 B;
- `System.Text.Json`: 180,501 B (M1: 133,909).

The app bundle (`npm run build`; gzip at level 9, brotli at Node's default):

| | raw | gzip | brotli |
|---|---:|---:|---:|
| `index-*.js` (React, CodeMirror, the editor) | 673,923 | 213,054 | 182,145 |
| `check.worker-*.js` | 49,355 | 15,774 | 14,270 |
| `core.worker-*.js` | 1,041 | 611 | 520 |
| `index-*.css` | 3,528 | 1,268 | 1,048 |

M1's bundle was 620 kB (199 kB gzip).

`web/public/fonts`, 613,958 B in all:
- `LiberationSans-Regular.woff2`: 146,884 B; `LiberationSans-Bold.woff2`: 148,348 B;
- `Barlow-Regular.woff2`: 61,316 B; `Barlow-Medium.woff2`: 61,584 B; `Barlow-SemiBold.woff2`: 61,252 B;
- `BarlowCondensed-SemiBold.woff2`: 62,764 B; `BarlowCondensed-Bold.woff2`: 62,824 B;
- the two licences, `OFL-Barlow.txt` (4,470 B) and `OFL-LiberationSans.txt` (4,516 B).

## Comparison with console captures

The captures are 460 × 460 PNGs of a 1 × 1 console running vector 0.11.83, one per example, with the TexCoord1 capture fix. They are not in this repo. The tool is the "Compare" toggle of the dev "Example scripts" mode, as at M1 (`web/src/editor/CaptureOverlay.tsx`): pick a PNG, which never leaves the browser, and "Measure" gives `diffPercent` at tolerance 4.

**No example changed between v0.11.83 and the pin**, and of the upstream changes since, only one draws an example differently:
- **0.11.91: `fea` is read for every node.** 11 and 13 draw stroke-only groups (`G f=none … fea=0`), which now get the hard edge they ask for, where the captures still show the automatic feather.
- **0.11.92 to 0.11.94 touch no example's drawing.** No `P` carries `sh` (05's one `P` has a fill and no shadow); no group sets `blur`; every gradient's numbers are well-formed and no def carries an unknown key; 05's one path is written out in full; no example sets `weight`; 09's `SC` sets no `so`. Since 0.11.93 17's rounded `IMG` takes presses (`press=1`), which a capture cannot show; no `T` carries `click`. Since 0.11.94 a missing numeric array read in an expression is reported; 04, 05 and 12 read one, and their data is always there.
- 0.11.84 to 0.11.90 change nothing an example draws: no example writes a colour expression with a non-colour branch, throws inside a filter or a mask, formats with `%x`, outlines a label inside a filtered group, or patches `nodes` other than on a click.

How to read `diffPercent`:
- A pixel counts when its largest colour channel differs by more than 4 (out of 255). Alpha is not compared.
- Text is DOM over the canvas, so "Measure" sees shapes only: every label in a capture counts.
- **The capture's outermost ring of pixels is half covered** (alpha 127, and the colour halved: (6, 12, 18) where the panel is (13, 22, 28)). That ring is 1,836 pixels, 0.87 % of every result. It comes from the capture's camera render, not from the console.
- **Outside every element, a capture holds nothing.** 16–18 declare no panel and place their element 4 px in from the edge. In that band the captures are (0, 0, 0) with alpha 0, except four opaque black pixels at (456–459, 83) in all three; the preview shows its ground there. That band adds 2.58 % to 16–18.
- **The phase.** The capture manifest marks 02, 08, 15 and 16 animated, and 14 still. At the pin, 01, 09, 16 and 17 draw the same every frame; every other example moves with `t` or with its ticked data. So each example was compared at its best-matching frame: about 60 frames a second were measured over 9 s after the run, and the table gives the lowest share and the median. Most best frames fell 4.4 to 5.6 s after the run was picked.
- **What a capture cannot show:** glides (`ease`), `since()`, hover and pressed states, and clicks.

The four right-hand columns split the best frame's share: the edge ring; the empty band; pixels inside a label's box (3 px around it), where the capture has TextMeshPro glyphs that the canvas lacks; and the rest. "Measure" is the tool's own one-shot result about 2 s after the run.

| Example | `diffPercent`, matched phase | scan median | "Measure" at 2 s | ring | empty | labels | rest | What differs, and why | Preview bug? |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| 01-hello | **0.87 %** | 0.87 % | 0.87 % | 0.87 | 0 | 0 | 0.01 | Nothing but the ring. | No |
| 02-moving | **1.21 %** | 9.84 % | 8.29 % | 0.87 | 0 | 0 | 0.34 | The animation phase. | No |
| 03-data | **1.13 %** | 5.23 % | 7.97 % | 0.87 | 0 | 0 | 0.26 | The data phase. | No |
| 04-repeat | **2.24 %** | 13.16 % | 11.98 % | 0.87 | 0 | 0 | 1.38 | The bar tops and some dots: the data phase and `t` do not line up together. | No |
| 05-curves | **1.73 %** | 15.91 % | 16.63 % | 0.87 | 0 | 0 | 0.86 | The animation and data phase. | No |
| 06-paint | **0.97 %** | 2.67 % | 2.67 % | 0.87 | 0 | 0 | 0.10 | The animated circle (`fo` from `t`, colour from the ticked level). | No |
| 07-clip | **1.54 %** | 7.87 % | 16.49 % | 0.87 | 0 | 0 | 0.67 | The data phase. | No |
| 08-console | **3.47 %** | 12.00 % | 15.15 % | 0.87 | 0 | 1.05 | 1.56 | The 8 labels; the wave tops (`t`), and the dial needle, the chart's end and the alarm bar (the data phase). The background is exact (probes). | No |
| 09-scroll | **3.73 %** | 3.73 % | 3.73 % | 0.87 | 0 | 2.66 | 0.20 | The 26 labels. The bottom fade matches (probe). | No |
| 10-text | **4.86 %** | 5.14 % | 5.14 % | 0.87 | 0 | 3.98 | 0.01 | The 11 labels; the needle's data phase. The `$long` row reads the same as the capture. | No |
| 11-symbols | **2.36 %** | 2.63 % | 7.68 % | 0.87 | 0 | 0.34 | 1.15 | The labels; the row outlines, hard since 0.11.91 (`fea=0`) and feathered in the capture. The halos match (probe). | No (upstream change) |
| 12-click | **2.91 %** | 4.49 % | 4.50 % | 0.87 | 0 | 2.03 | 0.01 | The labels; the row names and the picked line read the same as the capture. | No |
| 13-src | **3.74 %** | 14.71 % | 27.22 % | 0.87 | 0 | 0.71 | 2.16 | The tank outlines, hard since 0.11.91 (sampled: the capture feathers each edge by a pixel, the preview steps straight from the panel to the stroke); the liquid's wave (`t`); the labels and the title's drop shadow (probe). Both columns still match each other. | No (upstream change) |
| 14-ztext | **1.99 %** | 15.78 % | 20.59 % | 0.87 | 0 | 1.02 | 0.10 | The shutter is animated by `t`; at the matched phase both shutters sit exactly where the capture has them. The labels, which the game draws under the left shutter (`ztext`) and the preview on top. | No (`ztext` is a known limit) |
| 15-effects | **2.05 %** | 6.52 % | 6.52 % | 0.87 | 0 | 1.08 | 0.10 | The labels; the badge's `$offline` state flips every 4 s of ticks, and the scan's median frame shows the state the capture does not. | No |
| 16-pointer | **5.81 %** | 5.81 % | 5.81 % | 0.87 | 2.58 | 2.36 | 0 | The empty band; the labels. The pointer arms are at rest in both. | No |
| 17-pictures | **57.97 %** | 57.97 % | 57.97 % | 0.87 | 2.58 | 2.56 | 51.96 | The pictures: `IMG` is not drawn (M5). | No (known limit) |
| 18-lines | **6.10 %** | 6.71 % | 6.34 % | 0.87 | 2.58 | 2.65 | 0 | The empty band; the labels. The marching dashes (`dofs = t*10`) match at the matched phase. | No |

### Probes, preview against capture

| Probe | Capture | Preview | Note |
|---|---|---|---|
| 08's background, (2, 230) and (230, 2) | (13, 13, 22) | (13, 13, 22) | `#070D16` through the dark crush |
| 01–07's background, the same two points | (13, 22, 28) | (13, 22, 28) | `#0A121C`, all seven |
| The empty surface: 16–18, the band outside the element (7,296 px each) | (0, 0, 0), alpha 0, on 7,292 px; four opaque black px | (13, 22, 28) on every pixel | The capture holds no colour there |
| 09 at (64, 350), still | (206, 133, 22) | (206, 132, 22) | the fade, blended in linear light |
| 11 at (84, 282), matched phase | (43, 102, 80) | (42, 102, 79) | a lamp halo |
| 14 at (220, 190), matched phase | (13, 22, 28) | (13, 22, 28) | the shutter's right edge is at x 208 in both at this phase |
| 14 at (122, 222), on the shutter | (210, 80, 59) | (210, 81, 59) | `#E2563D` at `fo=0.85` |
| 06 mid-ramp, `@sheen` at (339, 66) | (75, 183, 143) | (75, 183, 143) | a mix in sRGB would give (71, 178, 139) |
| 13's title label | `#5A7085`; ink 134–326 by 14–27 | `#5A7085`; text box 139–321 by 12–28 | same colour and centre (x 230); the capture's ink, its shadow included, spans 193 px, the browser's ink 183 px. The capture also has the game's drop shadow, 340 px darker than the panel, down to (0, 0, 0); the preview draws none (ruling 4). |

The W1 merge gate measured 09, 11 and 14 at v0.11.87; nothing moved at v0.11.94.

### Findings

1. **The preview draws what the captures draw.** Opaque colours, translucent blending, gradient ramps and the dark crush all match to within 1 in every channel sampled. Every shape that differs is explained by the capture's edge ring, the label layer, the phase, `IMG`, or upstream's `fea` change since the captures.
2. **The captures cannot measure the console's empty surface.** Outside every element a capture is transparent black: the camera render of a cloned tree starts from a clear texture and the console's screen is not part of it. Ruling 4 said to replace the stand-in if 16–18 differed from it; they differ only because they hold no colour, so `CLEAR` keeps M1's stand-in, `#0A121C` as the 8-bit linear target holds it, which shows as (13, 22, 28). Measuring the real one needs a look at a live console running 16, 17 or 18.
3. **M1's finding 3 is closed.** With upstream's fixed examples and the fake host's flush model, 10 and 12 show the labels their captures show.
4. **No preview bug was found**, so nothing was fixed in this task.

## Known limits carried forward

### M2b: the widgets and the rest of the themes

- The widget framework and the P0 widgets, and a plain insert palette.
- The rest of the themes: type styles, geometry and shadows, the neutral presets, `motion` and `widgetDefaults`.
- Natives beyond `panel` and `label`, and a panel's diagonal, radial and array gradients (drawn flat).
- Text in WebGL, if a widget draws a shape over a label.
- Ruling 9's text approximations: `fit=ellipsis` under `pre-wrap`, centred or right overflow, and `fit` 2.

### M2c: the canvas editing utilities

- Draw, transform, snap, space, style and arrange (§4); the owner designs the final UI after them.
- Ruling 9's selection gaps: point handles, rotation and group scale; a stroke-only shape's interior; arc bulges in a path's box; the text-node fallback.
- `ztext` interleaving in picking.

### M3: play mode and the full host

- Pointer input and `SC` scrolling (M1 ruling 3).
- `set_resolution`: until then a fraction rect on a non-square page may sit differently in game.
- The rest of `ss.ui`, and the traps that need reads (an unclamped sensor driving a size, a non-hex data colour).
- The old-mod banner `G v="=lt(ver,FLOOR)"`, generated with the page code.

### M4 and M5

- M4: the export header's Fonts-mod line.
- Imported fonts live in one browser: a project opened elsewhere draws the fallback with a note until the font is imported there (D13).
- M5: `IMG`, adopt-mode strictness, and a table-form scene's root paint defaults (ruling 11).

### Not drawn by the preview

- A `T`'s gradient fill, its first-line style (`fl`) and a text shadow's spread.
- A label's drop shadow (ruling 4): its parameters are not recorded.
- TextMeshPro and the browser measure each face differently: 13's title is 193 px of ink in the capture, its shadow included, and 183 px in the preview. No capture isolates a face.
- An empty scene shows the magenta marker with no problem line; upstream knows.
- The preview carries a vector element's coverage as its own `cov` attribute. An exported page and any capture canvas rely on the mod requesting the TexCoord1 channel itself, which it does since 0.11.83.

### Rulings taken in M2a

- **Natives** (ruling 4): `panel` and `label` only. A label draws without the game's drop shadow. `parent_id` placement is not modelled; nothing in M2a emits it.
- **The empty surface** (ruling 4, finding 2): the stand-in `#0A121C` stays until a live console is measured.
- **The flush boundary** (ruling 1, measured in game): `ui:commit()` and the end of every chip execution, the load included.
- **Any font** (D13, ruling 5): bundled defaults plus any font by name or by import.
- **Depth** (ruling 10): no nesting limit anywhere; the printer indents 4 spaces a level up to 32 levels and no further, so deep text stays linear in size.

## Keeping in step with the pin

- **The ports.** At v0.11.118, LiveScene mirrors VectorGraphic data arrival, cadence and blending; VectorHost mirrors VectorElementPatch src/data/nodes/control handling; PointerInput mirrors VectorGraphic pointer polling and hover/down/click. Source headers carry current line ranges; re-read them on every re-pin.
- **The catalogue.** Regenerate `web/src/schema/extracted.json` with `npx vitest run src/schema/extract.test.ts -u` (in `web/`) and review the diff. When upstream publishes a machine-readable key catalogue, `extract.ts` reads that instead of the parser's source.
- **The version.** The C# suite's ver == 11118 check and VECTOR_FLOOR ('0.11.118') move together. Since 0.11.103, ver is major*1000000 + minor*1000 + patch. The banner remains the only version guard; Workshop publication is checked separately from a tag.
- **Seen on a console** (upstream's test page at 0.11.101, `vector_stats` 0.11.101.0): 0.11.98's inherited `so` (an `SC` scrolls by its own `so` only), 0.11.100's `fmt` check on `{0} kPa` and `{0,6:0.0}` (the number, unreported) and `{$v:%q}` (`%q`, reported; `{0:Z}`, `{{{0}}}` and `{0:}` are offline only), 0.11.101's hex in a placeholder (`%x {0:D2}` prints `8 08`), and the point counts (a two-point `Y`, odd `L`s). **Not yet seen, on the in-game checklist:** 0.11.98's raycast filter (a click on a vector element's empty part reaches a native element behind it) and a wheel over the empty part of a short `SC` list.
- **Depth.** The pin has no nesting limit, and neither has the builder (ruling 10). A re-pin that brings a limit back is mirrored only if it is a real limit, never as a guard of our own.

## How to run it

You need the .NET SDK 10.0.401 or newer, and Node 24 with npm.

```sh
git clone --recurse-submodules <this repo>    # Windows: git -c core.longpaths=true clone --recurse-submodules ...
cd <repo>                                     # an existing clone: git submodule update --init --recursive
dotnet workload install wasm-tools wasm-experimental
dotnet run --project core/Core.Tests -p:VectorSrc=<abs path to core/vendor/vector/>     # ends with ALL PASS
rm -rf core/Wasm/bin/publish                  # publish into an empty folder
dotnet publish core/Wasm -c Release -p:VectorSrc=<abs path to core/vendor/vector/> -o core/Wasm/bin/publish
cd web
npm install                                   # brings happy-dom for the DOM tests
npm run precore                               # copies _framework and the 18 vector examples into web/public
npm test
npm run dev                                   # then open the printed localhost URL
```

These steps were checked in a fresh checkout at `4c52d72` for this report: the suite printed `ALL PASS` (365 checks), the publish succeeded, `precore` copied the 22 `_framework` files and the 18 example scripts, `npm test` passed 602 tests, and `npm run build` succeeded.

Notes:
- On Windows, Lua-CSharp's own checkout has paths too long for git's default: if the submodule update fails, run `git -C core/vendor/lua-csharp config core.longpaths true` and `git submodule update --init --recursive --force`.
- Always pass `-p:VectorSrc` with the absolute path of the `core/vendor/vector/` submodule, ending in a slash, so a local `core/VectorSrc.user.props` never decides what is built.
- After any change under `core/`, publish into an emptied folder and run `npm run precore` again.
- The bundled fonts ship in `web/public/fonts`, with their OFL licences.

To compare with a capture:
1. Tick "Example scripts (dev)" and pick an example.
2. Tick "Compare", choose the capture PNG, and press "Measure".
3. For an example that moves, measure at several moments, or at the frame that matches the capture best.
