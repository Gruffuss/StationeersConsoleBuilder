# M2c report: the canvas editing utilities

Verified on 2026-10-06 at the tip of branch `m2c-editing` (`857bda2`: Tasks 1-11 merged, M2a and M2b under them), plus this task's tests and documents, with Lua-CSharp pinned at `d9fb336` and the vector mod at **v0.11.99** (`2f3bad3`). This task changed one behaviour, a fix its review found (the router takes no point a canvas of no size reports; see Browser checks), and two code comments that the measurements corrected. The work followed the M2c plan; the M2b report is `docs/m2b.md`, M2a's `docs/m2a.md`.

## Verdict: delivered; a drag on a 2,000-node page now keeps drawing (measured in a harness, not yet in the browser)

The builder is a drawing tool. A player draws rectangles, ellipses, lines, polygons, curves, text and image placeholders. Handles move, resize and rotate any node, and the arrows nudge it. Edits snap to a grid, to other nodes and to the page, with guides. A multi-selection takes align, distribute and an exact gap. Styles copy, paste and come named from the theme. Arrange covers duplicate, copy, paste, delete, group, ungroup, reorder, hide and lock. Every tool and command is one file in one registry. The rulings it runs on are in spec §4, "How the editor does it", and in `docs/decisions.md` ("Editor").

Spec §4's list, item by item. "Seen" means seen in the browser on this tip during this task (see Browser checks).

| Spec §4 item | Tasks | Result | Evidence |
|---|---|---|---|
| **Draw:** rectangle, ellipse, line, polyline and polygon, path (`SP`), text, image placeholder; op defaults and the theme's styles | 4 (box and point tools), 11 (theme looks) | yes | Seen: each tool drew its shape and went back to Select after one. A polygon ended with Enter. A curve closed with a click on its first point (`close=1`). The placeholder was an `R` with a dashed outline and `# image`. Under Vanilla + a rectangle drew with `rx=6 sw=1`, and a text in Barlow Medium with its drop shadow. A rectangle drawn under Slate took Slate's colours. Tests: `tools/draw.test.ts`. |
| **Transform:** move and resize with handles (Shift keeps the proportions, Alt from the centre), rotate, nudge | 3 (the writers), 5 (handles, knob, nudge), 6 (points), 10a (widget roots), 10b (Shift on widgets) | yes | Seen: a Shift corner resize kept 3:2, and Alt resized about the centre. The knob wrapped a rectangle in `G a=[65.2,49.767] r=-88` as one undo step. The Points tool moved a line's end to whole units. Five fast arrow presses made one undo step. A Bar widget took three resizes, each in whole units: its east handle from 400 to 351 wide; its south-east handle with Shift from 351 × 30 to 585 × 50, keeping the ratio; its east handle again from 585 to 615 wide, the height kept at 50. A Shift resize of a plain rectangle keeps the ratio in 3 decimals (see Limits). A Light had no handles, and no widget had a knob. Tests: `transform.test.ts`, `tools/select.test.ts`, `tools/points.test.ts`, `commands/nudge.test.ts`, `widgets.test.ts`. |
| **Snap:** grid with a settable step, other nodes' edges and centres, the page; guides; a modifier turns it off; whole design units | 2 (pure), 4-6 (used, guides), 1 (the grid setting, the modifier) | yes, with two exceptions spec §4 now states: a node's or the page's line wins over wholeness, and a Shift resize of a plain node keeps its ratio in 3 decimals (a corner snaps only to a line; a side handle snaps its dragged side as any edge) | Seen: a widget dragged by 13.3 snapped its left edge to a rectangle's centre at 50, with y on a whole unit. A Ctrl drag wrote 15.2, 23.1, unsnapped. The points of a drawn curve snapped to other nodes' edges and centres. The grid lines and the grid step were seen in the browser checks after Tasks 4-9. Tests: `snap.test.ts`, `layout.test.ts`. |
| **Space:** Shift+click, marquee; align ×6; distribute; exact gap | 5 (sets), 9 (commands), 10a (widgets) | yes | Seen: Shift+click on two widgets, then Alt+A, aligned them left. A polygon, a curve and a text aligned left by their drawn boxes; the curve's box is its drawn samples, so it landed at `x` 20.557. "Gap across" with 12 left gaps of exactly 12, at fractional positions where a curve's drawn box has fractional extremes (see Limits). A marquee selected 50 nodes, and another all 2,000. Distribute on a set already evenly spaced changed nothing. Tests: `commands/space.test.ts`. |
| **Style:** the panel; copy and paste; named styles from the theme tokens | M2a T14 (the panel), 9 (copy and paste), 11 (named styles) | yes | Seen: Raised row on two rectangles made one `theme_row` def, in one undo step. Text: hero gave 156 Barlow Condensed Bold. A switch to Slate rewrote `theme_row` in Slate's colours. A hand-edited `theme_row` survived a style paste and a named style, and the next theme switch rewrote it (the ruling). Commands › Style lists the 11 type styles, Raised row, Well, Panel, Brand, Danger, four statuses, three outlines and three glows. Tests: `style.test.ts`, `widgets/themes.test.ts`. |
| **Arrange:** duplicate, copy and paste, delete, group and ungroup, forward and back, hide, lock | 8, 10a (widget roots), 10b (natives) | yes | Seen on plain nodes: group and ungroup; forward, backward, to front and to back; hide (`v=0`) and show; lock (`# lock`) and unlock. On widgets: duplicate made `bar2` at +10 and paste made `bar3` at +10. Delete, then undo, brought `bar3` back selected. Ctrl+G on a widget refused, with the reason, and lock put `# lock` above the marker. Deleting a Flow duct took its `duct1_clip` def with it, and with the focus on a palette button the button kept Delete. On a native icon, duplicate, group and the arrows did nothing. The menu greyed every entry but Undo (there was history), Delete, Show all hidden and Unlock all (both always live, page-wide), Paste (live only while the clipboard holds a copy; it held a widget) and Select all (live while the page has a root node neither hidden nor locked); of these, only Delete acts on the native. Delete removed the icon and undo brought it back. Shift+click left it selected alone. Tests: `commands/arrange.test.ts`, `widgets.test.ts`. |
| **Open-ended:** one registry; snapping and layout pure; a new tool or command is one file | 1 | yes | `editing/registry.ts` collects `editing/tools/*` and `editing/commands/*` through `import.meta.glob`: 9 tool files and 15 command files, 56 menu entries. After Task 1, the tools and commands came as files (see below). `snap.ts`, `layout.ts`, `bounds.ts`, `transform.ts` and `tree.ts` are pure and tested in Node. |
| **Rough UI** until the owner designs it | 1 (`EditBar`) | yes | A plain tool bar, the snap toggle and grid step, and a Commands menu. Nothing polished. |

How the registry held up after Task 1:
- Tasks 4, 6, 8 and 9 added their tools and commands as files under `editing/`, with no change to the App, the canvas, the editor overlays or the store. Beyond those files, Task 4 added four lines of CSS (`app.css`) and Task 6 three path functions to `srctext/path.ts` (`pathHandles`, `movePathPoint`, `pathCross`) and its `Point` type.
- Task 5 rebuilt the selection overlay (`Handles.tsx`, `Selection.tsx`), and Task 7 the picking (`hitTest.ts`, App's `pick`), to close M2a ruling 9's gaps. The store changed in one comment.
- The store changed later for undo's selection (a fix after the browser checks of Tasks 4-9) and for widget roots (the merge of M2b, Task 10a), not for a tool.

M2a ruling 9's selection gaps, given to M2c:

| Gap | Task | Result |
|---|---|---|
| Point handles (`L`, `Y`, `P`, `SP`) | 6 | yes: seen on a line |
| Rotation and group scale, in handles and in picking | 3 (writers), 5 (handles, knob, hit test) | yes: rotation seen; group scale in `tools/select.test.ts` |
| Picking a stroke-only shape by its inside | 7 (`hollowAt`) | yes: `pick.test.ts` |
| Arc bulges in a path's box | 3 (exact boxes: Bézier and arc extremes, an `SP`'s drawn samples) | yes: `geometry.test.ts`, `bounds.test.ts` |
| The text-node fallback | 7 (`pairLabel`: by geometry) | yes: `pick.test.ts`; on 2,000 labels a press named the right `T` |
| `ztext` interleaving in picking | 7 | yes: `pick.test.ts`, `hitTest.test.ts` |

Suites at the end of M2c:
- `core/Core.Tests`: 417 checks, `ALL PASS`.
- `npm test`: 1,317 tests in 84 files, 417 of them in `src/editing`.
- `npx tsc --noEmit`: clean.
- `npm run build`: succeeds. M2c took the index chunk from 708.5 kB (at `m2b-widgets`, `0d1fdba`, measured in the final review) to 817.0 kB, over the 800 kB warning limit; the final fix round raised the limit to 900 kB with its reason (`vite.config.ts`: everything in the chunk runs at start, so a split would not load less). See "The final fix round".

This task took the suite from 1,314 tests to 1,317: three new tests (`it` blocks), and one case appended to a test that existed. Each was seen failing first:
- The App smoke test (a tool key, Esc, select all, Delete in one undo step) failed under four mutants: the rectangle's key taken away, Esc's return to Select emptied, Mod+A unbound, and Delete written as two undo steps.
- A case appended to an existing Shift widget-resize test failed under `travelOf(from, free)`: a corner whose following axis crosses its anchor collapsed to 36 × 36. The re-review of Task 10b had found nothing pinning it.
- A new Shift widget-resize test failed with the crossed-lead guard removed: at zoom 0.1, a lead dragged past the opposite edge snapped to 60 × 60. The same re-review found its test gone.
- A new router test failed without the fix for a canvas of no size (see Browser checks): a rectangle of `NaN` was drawn, and, without the release half of the fix, the drag was left open.

## Measurements

The machine is an AMD Ryzen 9 9950X3D (16 cores, 32 threads) on Windows 11 Pro 10.0.26200, with Node 24.19 and .NET SDK 10.0.401. The browser is Chromium 152.0.7977.130. The build is the Vite dev server (React's development build) on localhost, at `9a52089`: `857bda2` plus this task's first tests, with no source change.

The page ran in a background tab, so it ran no animation frames. For these measurements a 16 ms timer stood in for `requestAnimationFrame`. That paces the frame loop and the patch sender as a 60 Hz display would, but it is not a display's vsync. Pointer events were synthetic: `PointerEvent`s dispatched on the canvas overlay, with the same handlers as real ones. The core and checker workers were timed from their own messages (`postMessage` out to the reply in).

The page: 2,000 root `R`s, 8 × 8 units on a 9-unit grid, pasted into the code pane on a 480 × 480 design (a 460 px surface). Its frame is 16,004 vertices, 20,002 triangles and 528 kB, and one scene check takes 20 to 33 ms.

### A drag on the 2,000-node page

Each drag lasts 3 s. Pointer-to-frame lag is measured from a pointer move to the first frame reply asked for after a patch sent after that move. "Handler" is the time spent in the move's own event dispatch. In the two continuous drags no patch went before the release, so every move waited for the frame after the release: their lag median is about half the drag (1.5 of 3 s) and their p95 about the whole drag. Those two figures measure the drag's length, not a latency; what they show is that nothing new was drawn until the release.

| | moves | patches sent | lag median | lag p95 | handler median / p95 | checks: per step, median | at release |
|---|---:|---:|---:|---:|---:|---:|---|
| one node, a move every ~22 ms (a continuous drag) | 139 | **1** (after release) | **1,636 ms** | **2,980 ms** | 0.9 / 1.4 ms | 20.1 ms | 0 in flight, 1 still to send, done in 24 ms; frame 90 ms after release |
| one node, a move every ~47 ms | 64 | 60 | 86 ms | 107 ms | 0.5 / 1.1 ms | 20.8 ms | 1 to send, done in 25 ms |
| one node, a move every ~68 ms | 44 | 44 | 93 ms | 111 ms | 0.5 / 0.7 ms | 21.0 ms | 1 to send, done in 34 ms |
| 50 nodes selected, a move every ~21 ms | 141 | **1** (after release) | **1,549 ms** | **2,944 ms** | 2.1 / 3.9 ms | 22.9 ms | 1 in flight, 1 to send, done in 31 ms; frame 52 ms after release |
| 50 nodes selected, a move every ~49 ms | 61 | 50 | 98 ms | 188 ms | 1.6 / 3.4 ms | 23.7 ms | 1 to send, done in 29 ms |

**This lagged; the final fix round changed it (below).** During a continuous drag on this page the preview drew nothing new until the pointer paused or was released, so the shapes stayed where they were. The selection outline is drawn from the model (`editor/Selection.tsx`), so it should keep up, but that was not watched here. The cause, as the code read:
- App's patch sender sends only when every page's check has landed (`App.tsx`: `ready = checks.every(c => c !== undefined)`).
- Each step's check takes about 20 ms, about as long as a pointer step, so in the continuous drags no render found the newest scene's check landed.
- The checker had no backlog at release: at most one check was in flight and one more still to send (the table's last column). The queue was read only at release, not during the drag. With a check taking about a pointer step, the newest scene's check is late even with nothing queued before it, so dropping superseded scenes from the checker's first-in-first-out queue would not change this, as the code reads.

The final fix round built the upgrade this section proposed: while a page's newest scene waits for its check, App patches the newest of its scenes whose check has landed clean (`App.tsx`). Measured in a harness, not in the browser: App with fake workers under happy-dom, 136 steps 22 ms apart (3 s, at fixed times), each step a new scene, and a check worker that answers a fixed time after each scene is posted. The harness adds about 8 ms of its own to each check (the check runs on the main thread there), so the regime of the browser table above, a check about as long as a step with no backlog, is a fixed time of 14 ms:

| check (fixed part) | sender | patches during the drag | in all | step to patch: median / p95 | the last step's patch |
|---:|---|---:|---:|---:|---|
| 10 ms | before | 32 | 32 | 32 / 53 ms | at release |
| 10 ms | after | 136 | 136 | 38 / 69 ms | at release |
| **14 ms** | **before** | **0** | 1 | 60 ms (the one) | 46 ms after release |
| **14 ms** | **after** | **134** | 136 | **61 / 111 ms** | 45 ms after release |
| 17 ms | before | 0 | 0 | | not within 500 ms |
| 17 ms | after | 111 | 127 | 345 / 623 ms | not within 500 ms |

At 14 ms the harness reproduces the browser's continuous drag (nothing before the release, one patch after it) and the fix draws all but two steps during the drag, each about 61 ms after its step. At 17 ms each check takes longer than a step, so the checker's first-in-first-out queue backs up: frames keep coming but trail by the backlog, which grows through the drag; that is `srctext/checker.ts`'s `ponytail:` (drop superseded scenes), not seen in the browser. A new App test pins the rule: with a scene's check landed and a newer one's held, the landed one is patched, then the newer one when it lands (it failed before: no patch).

With 1 or 50 of the 2,000 nodes selected, the per-move cost of the drag itself (snapping, the store) has a median of 0.5 to 2.1 ms and a p95 of at most 3.9 ms, so snapping's `ponytail:` upgrade (a sorted line list in `snap.ts`) is not needed yet. Those are the set sizes measured; with the whole page selected (the marquee below selects all 2,000) the drag was not timed in the browser. In Node, `moveUnits` alone took 22.7 ms per step for 2,000 selected roots before the final fix round (one write per member, quadratic) and 2.9 ms after (one pass); see "The final fix round".

### A marquee over the 2,000 root nodes

A marquee from one corner of the page to the other, until all 2,000 nodes were in the set, in two runs: 60 moves 20 ms apart timing the handler, and 40 moves 30 ms apart timing each move to the second task after it, React's render included (approximate).

| | moves | median | p95 | max |
|---|---:|---:|---:|---:|
| per move, the handler: `marqueeHits` and the store dispatch | 60 | **1.0 ms** | 4.3 ms | 5.3 ms |
| per move, the render included | 40 | 16.4 ms | 67.7 ms | 88.6 ms |
| the last 5 of those 40, the set holding most of the page (45.4, 47.5, 50.3, 88.6 and 49.0 ms) | 5 | 49.0 ms | | 88.6 ms |
| the press that starts it, on empty space | 1 | 12.6 ms | | |

The handler is well under a frame. With the render included, the median move takes about one frame (16.4 ms) and the p95 67.7 ms; the last five moves, with most of the page in the set, took 45 to 89 ms. Whether the cost grows with the set was not measured: at least one earlier move, with a smaller set, already took about 68 ms (the p95). What in that render costs the time was not profiled. One candidate is the outline of every member of the set (`SetOutlines`), but that is not measured, so it is not stated as the cause. A follow-up for the owner, if a page this size needs a smooth marquee.

### Picking on a 2,000-node page

`pickNode` was called directly, 200 times each, with the frame the core drew for the page and the page's own numbering. It was imported from the dev server, the same module the app uses.

| a press | page | median | p95 |
|---|---|---:|---:|
| on empty space (the hollow walk over every node) | 2,000 `R` | **5.2 ms** | 5.6 ms |
| on empty space | 2,000 `T` | 5.8 ms | 6.4 ms |
| on a label (the pairing walk) | 2,000 `T` | **3.9 ms** | 4.3 ms |
| on a label, no numbering (pairing by geometry alone) | 2,000 `T` | 3.9 ms | 4.1 ms |
| on a drawn `R` (the mesh) | 2,000 `R` | 0.1 ms | 0.2 ms |

All are under a frame, once per press.

## Limits, each with its ceiling and upgrade path

- **One-node resize and rotation only.** A multi-selection moves, aligns and so on, but has no resize or rotate handles (owner question 5). Upgrade: a box-to-box writer per chain, so each member maps from the set's old box to its new one.
- **No gap snapping.** A node snaps to edges and centres, not to the spacing between its neighbours. Upgrade: a candidate generator in `snap.ts`.
- **Points move, but are not added or removed.** Upgrade: one gesture in `tools/points.tsx` (its `ponytail:` says Alt+click on a segment, Delete on a point).
- **Nothing is drawn into an entered group.** A draw tool inserts at the top of the page root. Upgrade: one change in `draw.tsx`, inserting into the group the breadcrumb has entered, through its chain.
- **Geometric bounds only.** Align, distribute, snap and the marquee use a node's geometry, not its stroke width, shadow or glow. Upgrade: a visual-bounds toggle.
- **A clip does not follow a move.** A move or resize of a clipped node says `clip … does not follow a move`. Duplicate and paste do copy and move the clip. Upgrade: translate the clip's `CP` when all of its referrers move together.
- **Outside text pastes through the code pane only.** Mod+V on the canvas pastes the builder's own clipboard. Upgrade: a `paste` listener (plan ruling R10).
- **Named styles are literals.** They follow a theme switch only through the `theme_*` gradient defs; a flat colour or stroke a named style wrote stays as written (spec §5.2). Upgrade (derived here, not planned): record which named style a node took, as `# lock` records a lock, and apply it again on a theme switch.
- **Widget roots cannot be hidden yet.** M2b's `putWidget` does not keep a root's `v` (M2c's request Q2 to M2b), so hide skips a widget root and says so. Upgrade: `putWidget` keeps `v` and `o` across re-expansion.
- **The snap threshold uses the smaller axis scale.** On a stretch-fit page the other axis snaps at more than 8 CSS px (found in review, parked as cosmetic). Upgrade: a threshold per axis, a change to `snap.ts`'s options.
- **A Shift resize of a plain node writes fractional sizes.** It keeps the ratio, not whole units. On a corner with no line within reach nothing snaps, and both sides are written to 3 decimals (seen: a 120 × 80 rectangle to 166.95 × 111.3); with a line, the leading side lands on it and the following side keeps the ratio (seen: 280 × 186.667). On a side handle the dragged side snaps as any edge does (a line, else the grid, else a whole unit) and only the other side is fractional (its east handle: 166 × 110.667). A widget's resize stays whole. Upgrade for corners, if the owner wants whole units there (a design choice): with no line, round the leading side to a whole unit and let the follower keep the ratio from it, a change to `snapResize` in `snap.ts`.
- **Positions follow exact boxes, fractions included.** Align, distribute and the gap place a curve by its drawn box, so its fractional extremes give fractional positions (seen: a gap across put an `SP` at `x` 92.557 and a `T` at 165.113, exactly 165.11328125). Upgrade: round each placed position to a whole unit, at the cost of gaps a fraction off (derived here, not planned).
- **Picking under a clip is approximate in three cases** (`pick.ts`, its `ponytail:`): a clip `R`'s corner radii are not cut; a clip `P` counts as inside any of its closed contours, where the mod uses its outer one; a literal clip of no area, which the mod draws unclipped, is taken as a clip. Upgrade (derived here): each is one case in `pick.ts`'s `clipped`.
- **On a large page a drag's preview trails the pointer by about one check** (the final fix round; measured in a harness above, not in the browser). Ceiling: a check that takes longer than a pointer step backs up the checker's queue, and the preview then trails by the backlog. Upgrade: drop superseded scenes from the queue (`srctext/checker.ts`'s `ponytail:`).
- **Bring forward and Send backward can take seconds on many runs that each jump far.** A step moves each run of selected siblings past the nearest overlapping one, and a run's search also passes every sibling the runs beyond it jumped. Measured in Node (M2c residuals): every other one of 2N siblings selected, with one more on top overlapping all of them, a step took 16 / 233 / 4,901 ms at N = 1,000 / 4,000 / 16,000. On flat forests with bounded selection paths, the rest of z-order is linear: one selected child in each of N root groups, Bring to front took 1.9 / 4.1 / 29.7 ms (582.8 ms at 16,000 before, one write per parent list). Upgrade: a tree of the unselected siblings' box unions in their old order (`order.ts`'s `ponytail:`), which helps only where those unions miss the run's box.
- **A marquee over a 2,000-node page renders a move in up to 89 ms** (measured above: p95 67.7 ms and median 16.4 ms over the whole marquee). Upgrade: profile the render first; the cause is not known.
- **The rough UI.** A plain tool bar, the snap toggle, the grid step and a Commands menu. Upgrade: the owner designs the final UI over the same registry, so the tools and commands stay as they are.

## Browser checks (this task, on the merged tip)

All passed. They ran in one background browser tab, against a freshly published core (`dotnet publish` with `-p:VectorSrc`, then `npm run precore`), on the Vite dev server, with no console error. Pointer input was synthetic, as in Measurements; the native icon was clicked and Shift-clicked with real mouse input. Results are in the Verdict table. Beyond them:
- **Task 10a (widget roots).** A click on the Bar selected its root (breadcrumb `G#bar1`). A drag moved it in whole units (its marker went from 40,225 to 50,287) and it stayed a widget. The three resizes are in the Verdict table. Undo then walked back one step per gesture and per command, through paste, duplicate, align, the Light's drag, three resizes, the Bar's drag and the two inserts, to the empty page. Redo walked forward again, ending with the delete that the undo had left on top.
- **Task 10b (natives).** After the insert the focus stayed on the palette button. A click on the placeholder moved it to the canvas. The rest is in the Verdict table.
- **Task 11 (theme tokens).** The Verdict table's Draw and Style rows.
- **Esc's order.** In the Polygon tool with two points down and a rectangle selected, the first Esc dropped the shape, the second left the tool, the third cleared the selection.
- **The code pane round trip.** After drawing with every tool, the pane was emptied and the same text put back. It parsed back to the same scene, and the reprint was identical. The browser refuses a scripted clipboard cut without a user gesture, so the text went back through the editor's insert, not the clipboard.

After the review of this task, on a freshly published core again:
- **A canvas of no size.** In a background tab, until a first frame is drawn, the canvas has not measured its room, so its zoom is 0: each point it reported was `NaN` or infinite, and in the review's run a rectangle and a text drawn there were written into the scene as `R x=NaN y=NaN w=NaN h=NaN` and `T x=NaN …`, which the printer then refused. The router now takes no such point, and the release of a press held there cancels its gesture. Seen: on the unsized canvas, a rectangle and a text drawn with synthetic pointer events wrote nothing; once the canvas had its size, a rectangle drew as before.
- **Esc during a gesture.** With one rectangle selected, a press on another and a drag, then Esc: the dragged one went back to where it was and stayed selected (its press's selection), and the next undo went to the edit before the drag, so the cancel left no step. With the rectangle tool, the first rectangle selected and a new one half drawn, Esc removed the new one and left the first selected, and the tool stayed Rectangle (the next Esc leaves it).
- **A Shift resize of a plain rectangle.** 120 × 80, its south-east handle dragged with Shift and no line within reach: 166.95 × 111.3. Dragged again until its east edge came near another rectangle's left edge at 300: 280 × 186.667, the lead on the line. Without Shift: 233 × 142, whole.

## The final fix round (after the final review, branch `m2c-final`)

Every behaviour change has a test that was seen failing without it; the commits name each one. What changed:
- **Ids a copy gives (Q14).** Duplicate and paste checked new ids against the scene ids alone. A copy of a plain `R id=ico1` beside an icon native `ico2` took `ico2`, and the next load dropped the native; a clip copied for a plain node clipped to a Flow duct's `duct1_clip` took `duct1_clip2`, which the widget then claimed, so the next load detached the duct as edited by hand and Delete refused the def; a def pasted onto an earlier page kept `duct1_clip` and detached the duct as a reused uid. One namer per command now holds every id, id stem and native uid, and gives an id whose stem is a widget's or a native's uid the stem `<uid>copy<k>`. Its count goes on per stem: 50,000 copies of `r1` … `r50000`, which did not finish in 120 s, now take 45 ms in the test.
- **A select-all edit in one pass.** Measured in Node with every root `R` selected, at 500 / 2,000 / 8,000 nodes, before and after: `moveUnits` (a drag step or a nudge) 2.6 / 22.7 / 118.9 ms to 1.6 / 2.9 / 8.1 ms; hide 2.2 / 23.7 / 122.9 to 1.0 / 3.4 / 13.4 ms; lock 1.4 / 7.6 / 113.7 to 0.1 / 0.6 / 2.0 ms; duplicate (its part before the check) 3.0 / 18.9 / 293.0 to 2.6 / 6.8 / 26.3 ms; delete 0.9 / 5.3 / 86.5 to 0.1 / 0.3 / 1.3 ms. The 200,000-node tests failed on the old writers after 324 to 355 s. A duplicated member inside another duplicated member now goes with that one's copy.
- **The drag's preview** (Measurements above): App patches the newest checked scene while a newer one waits.
- **One move rule, one singularity rule.** M1's `moveNode`, `resizeNode`, `canResize`, `lockReason` and the never-used `aabb`, `writable` and `pickAt` are gone; the 100,000-deep probe runs the canvas's live readers and writers. A group of any scale the mod draws gets its box, handles and moves (`G s=[1e-7,1e-7]` was picked but had none), and a move under a singular one says so. The padlock shows only where a move moves nothing.
- **Commands from the menu** clear the status line and render as from a key (Copy left Paste greyed); a held key's repeat waits for its checked command; a nudge burst that nets to nothing no longer refuses a checked command in flight; a nudge after another set commits the open burst first.
- **Smaller fixes:** a press sees through a locked node; handles take a press only where they are drawn; a widget root is boxed by its params for the marquee too; group and widget boxes are snap targets; a snap's guides show before the first write; an undone paste no longer counts; Show all and Unlock all leave a widget's nodes to its module; a set member without a literal box is outlined by its spans; the grid field ignores an empty value.
- **Documents:** the style exception (a style paste or a named style replaces an expression or `$data` value and says how many) is in spec §4 and `docs/decisions.md`; the Shift side-handle rule, the marquee's "grows with the set" and the gap's 165.114 are corrected; owner questions 8 and 9 are new.
- **The bundle:** 819.1 kB (266.4 kB gzipped) at the end of this round; the warning limit is 900 kB (`vite.config.ts` says why).

Data for the marquee follow-up, measured in Node by the final review: for 2,000 members `unitsOf` and `cornersOf` cost 3.3 and 3.2 ms per render and grow linearly, and EditBar's `when`s 0.4 ms (its menu renders inside the closed `details`). Most of a marquee move's render cost is therefore elsewhere (React and the DOM for about 4,000 polygons); not profiled.

Suites after the final fix round: `core/Core.Tests` 417 checks, `ALL PASS`; `npm test` 1,326 tests in 84 files (441 in `src/editing`); `npx tsc --noEmit` clean; `npm run build` succeeds with no warning. Not seen in the browser: the drag's preview (measured in the harness only), and the picking, handle and marquee changes (tested in Node and happy-dom).

## Nested reorder, text and font follow-up (2026-10-11)

- **Nested reorder bounds.** The repeated subtree walks are gone: one iterative walk computes bounds per occurrence, carrying transforms down and leaf unions up; the same node object under different transforms gets different bounds. Parent lists still copy in one pass. Complexity is O(nodes + total supplied path length), plus the existing overlap searches. With one selected member per nested level, the paths themselves contain D(D+1)/2 indices, so this case is not linear in D. The old blanket linear claim was incorrect.
- **Paired measurements in Node.** Each level has two R siblings and a nested G, with the first R selected; `ctx.apply` is stubbed for reorder, and bare apply is measured separately. At D=500/2000, before/after: reorder 615/10,265 ms to 18/111 ms; bounds-op reads 501,000/8,004,000 to 2,000/8,000. The structural regression at D=200 failed first with 80,400 reads against a 2,000-read bound. These are operation-count checks, not load-sensitive timing gates.
- **Bare apply uses numeric paths (follow-up).** In `model/store.ts`, `members` used Map.has for every growing textual ancestor prefix. The restored diagnostic at D=200 failed first: 5,293,400 hashed characters against its 160,800-character bound. A numeric path trie now records the last mention and checks selected ancestors in O(total supplied path indices), preserving widget snapping, member order and selection settlement; the same diagnostic measures zero hashed string-prefix characters. Fresh paired bare-apply measurements at D=500/2000: 167.1/9,871.5 ms before, 12.6/100.5 ms after (the earlier round measured 160/9,352 ms). Reorder, isolated from apply, stayed at 18.8/102.1 ms before and 18.1/113.8 ms after, with 2,000/8,000 bounds-op reads. There is no added depth cap. To repeat: `npx vitest run src/editing/performance.test.ts -t 'reports paired' --disableConsoleIntercept`.
- **Covers include glyph ink.** `measure` joins each laid-out text run's per-line actual ink metrics with its DOM boxes, preserving kerning, letter spacing, combining marks, rotation and shear. The failing regression left j's two-pixel left overhang uncovered; it now includes that overhang and a four-pixel accent above the first line. Wrapped lines use their DOM breaks, and the transform is restored after measurement. Fit 1 remains clipped to its label box by the cover pass. The browser must check real font baselines and the cost on a page of 200 labels; DOM tests use supplied rectangles and metrics.
- **TMP fonts and styles (2026-10-11).** All 36 Barlow/Condensed faces plus Liberation Sans regular are bundled lazily; no-font T bold is faux because its TMP slot table is empty. Face names do not change the weight slot: Barlow Bold plus i selects plain Barlow Italic; Barlow plus b/i selects Bold Italic. Real italics draw as is. Missing italic uses current glyph plus shear; missing Bold Italic uses current glyph plus faux bold and shear; missing bold alone has no shear. The per-face table gives shear 0.35 and bold spacing 0.07 × base size; contour dilation is 0.0196 em for the default and 0.0195 em for Fonts-mod files, drawn with outward stroke under fill. Attribute cspace also follows base size; relative size tags never compound; tag cspace uses scene units or current-size em, rejects percentages literally and removes the last trailing tag gap. Other unimplemented styling tags are stripped. Unknown font attributes fall back, while unknown tags remain literal. Late fonts remeasure only dependent labels, including tags and weight slots. Outline ow is the documented total centred stroke width; no upstream defect multiplier or clamp. See spec §5.3 for the rules and open gaps.
- **Chrome italic check.** Explicit run transforms measured slopes 0.35, 0.60 and -0.35, with the same 227.890625 px advance for Hello at 100 px; visual bounds changed as expected. Ink regression cases use the same matrix on upright Canvas metrics. The run centre differs from individual glyph centres: measured horizontal differences in Hello were H 0 px, l 0.525 px, e/o -2.8 px. Exact per-glyph pivots, shrink auto-sizing, real baselines and faux-bold reduction under wide outlines remain gaps.
- **Kerning audit.** Production web text uses CSS font-kerning (on by default), DOM Range layout, and Canvas.measureText for ink; the core forwards the mod's Kern flag and boxes without summing advances. The sole advance sum is the test-only `editor/testing.ts:textWidth`, called only by `codegen/devicesPage.test.ts`. Its comment now calls it an unkerned layout estimate, not TMP's exact width. The supplied observation (default game face about 5% narrower) was not independently remeasured.

### Browser-check follow-up: cover selection and label-update cost

The cover region already included ink, but the core's cut was chosen solely by overlap with the T box. If no later shape hit that box, the renderer omitted the cover even when it hit glyph ink. The frame now exports each label's earliest eligible vertex and each element's shape bounds once, so the preview selects an earlier cut using the measured region. This works without node tagging and with transformed ink; ztext=0 and fit 1 stay bounded by their own ordering/clipping rules. Picking follows the displayed cuts. Core metadata and browser cover-selection regressions failed first, including rotated/sheared ink clear of the T box.

No browser surface was available for the paired control, so the same happy-dom scene was run against archived source at 528b3ad, the pre-fix tip b1dba2a, and the fix: 200 Barlow labels at size 12, eight opaque covering rectangles; add one label, or move one label by one unit. GPU drawing is stubbed, geometry is supplied: these are layout requests and DOM mutation records, not browser flush timings or a remeasurement of the earlier 186/199 ms tasks.

| Source | Update | Geometry reads | Computed-style reads | Ink measures | DOM mutations |
|---|---|---:|---:|---:|---:|
| 528b3ad | add | 202 | 0 | 0 | 202 |
| 528b3ad | drag | 201 | 0 | 0 | 201 |
| b1dba2a | add | 604 | 402 | 201 | 604 |
| b1dba2a | drag | 601 | 400 | 200 | 601 |
| fix | add | 4 | 2 | 1 | 4 |
| fix | drag | 4 | 2 | 1 | 3 |

The ink pass caused the added per-label reads and temporary transform mutations. It now measures changed labels only; unchanged z-index values are not written again either. One font change also costs four geometry reads, two style reads and one ink measure; colour and cover-order changes require none. The count regression failed first at 201 ink measures for an add, then passed at one. Font-loading/import tests check invalidation of dependent labels only. To repeat: `npx vitest run src/editor/Canvas.cost.test.tsx --disableConsoleIntercept`.

Browser checks at merge: reorder nested selections and undo/redo; overlapping cover-less labels should pick the later label; put an opaque rectangle above large j, Ǻ and U+05C3 at box edges, including wrapped/rotated/sheared text; exercise Barlow regular/Medium, Condensed SemiBold under bold, imported bold/italic faces, missing weights and nested tags; compare kerned AV with kern=0; measure 200-label cover updates after font loading. The spec and decisions now describe measured ink and cover ordering, with the real-face font rule logged in spec §12; the widget panel explains supported font tags, unavailable styles and omitted TMP styling.

## M2c residuals (branch `m2c-reorder`)

- **Z-order across many parents in one pass.** Bring forward, Send backward, Bring to front and Send to back wrote each parent list with its own copy of every list above it, and a step moved each run with a splice. They now write every list in one `editAt` pass and step through a linked list. Measured in Node, one child selected in each of N root groups, at N = 1,000 / 4,000 / 16,000, before and after: Bring to front 9.5 / 56.4 / 582.8 ms to 1.9 / 4.1 / 29.7 ms; Bring forward 12.9 / 55.0 / 682.6 to 7.0 / 23.0 / 111.9 ms. Every other one of 2N siblings selected, Bring forward 6.3 / 18.1 / 196.6 to 3.4 / 8.5 / 42.9 ms. On random scenes and selections (3,000 drawn, those with no member skipped) the new commands gave the old scenes and selections exactly. The overlap search keeps its ceiling (Limits).
- **The editor at phone width.** At 375 px the page was 624 px wide: the palette, the code pane and the properties stayed side by side, leaving the canvas 0 px wide. Below 828 px they cannot share a row, so from 840 px down the bars wrap, the columns stack (palette, code pane, canvas, properties) and the page scrolls down; the canvas is 70% of the window's height and the code pane 40%, its height resizable. The Commands menu opens in the bar there instead of over the page. Seen in the browser: from 280 to 1,300 px the page was never wider than the window, with Commands and Fonts open or closed; at 375 px also with a node of an example selected, four widgets inserted in turn, eight pages and the example scripts with Compare. Wider than 840 px nothing changed.

## The in-game checklist (for the owner; nothing counts as tested until seen on a console)

1. Draw a page with every tool and export it to a test chip. Check:
   - the shapes;
   - the text's face and size;
   - the image placeholder's dashed outline.
2. A turn wrapper (`G a=… r=…` around a rectangle) and a group scale (`G s=…`) draw as in the preview.
3. A hidden node (`v=0`) stays hidden on the console.
4. `# lock` and `# image` comments change nothing on the console.
5. `ztext`, as the preview now shows it (under a translucent shape the preview's text is in the canvas's colour, so darker than the console's):
   - A label covered by a later shape is covered on the console with `ztext` on; with `ztext=0` the label is on top.
   - A label declared before the very first shape of its scene goes under that shape (the preview covers it). The comment at the head of the vendored `examples/14-ztext.lua` says such a label stays on top; the mod's code and its CHANGELOG say otherwise, so the comment is stale: to hand upstream.
   - Text, then Button, at their default places: `VENT BAY` shows on the button, and `Label` goes under the button.
   - A fit 0 label whose text runs past its box, under a shape that overlaps its box: all of its text goes under the shape, past the box too.
   - Two covered labels whose boxes meet, the second drawn over the first one's covering shape: the second's text shows over that shape.
6. A named style's gradient (Raised row) changes after a theme switch and a re-export.

## Owner questions (answered 2026-10-06)

The owner kept every default except question 6: the preview is to draw a shape drawn after a label over it, as the game does. That is built: see "The cover pass" below. The whole-unit grid also stays.

1. **Refuse or wrap** (R3). Default: a drag on an expression position refuses that axis and says why; Group is the escape. The alternative is to wrap implicitly.
2. **Rotation** (R4). Default: `G` takes `r`, `L`, `Y` and `SP` turn their points, and any other leaf gets the turn wrapper `G a=… r=…`, visible in the code pane. The alternative, `G` only, is one deletion in `transform.ts`'s `rotate`.
3. **Hide and lock** (R6, R7). Default: hide as `v=0`, exported hidden; lock as a `# lock` comment. The alternative is editor-only records.
4. **The image placeholder and settings** (R8, R9). Default: the placeholder until M5 brings `IMG`, and editor settings per browser.
5. **Multi-selection handles** (R11). Default: no resize or rotate handles on a multi-selection.
6. **`ztext` in the preview** (P7). Default: picking follows the game, and the preview draws every label on top. Upgrades, when a page needs one: a second WebGL pass over the text layer, scissored to each covered label (exact for opaque covers), or text in WebGL. Answered: the second pass, now built.
7. **Task 12's order.** Default: Task 12 waits for Task 10b. It did, since M2b T9 landed first, so this one is closed.
8. **Hide and lock on a mixed set** (found in the final review). Answered 2026-10-06: as built. hide flips each member by its own `v`, so a set of shown and hidden nodes swaps; lock locks every member while any is unlocked, else unlocks them all. The alternative is one rule for both (hide all while any is shown), a change to `commands/hide.ts`.
9. **What lock holds** (found in the final review). Answered 2026-10-06: as built. the geometric edits (move, nudge, resize, turn, points, align, distribute, gap); delete, hide, the styles, group, reorder and duplicate act on a locked node selected from the code pane or the breadcrumb. The alternative is that lock holds every edit, a `when` on those commands.

## The cover pass (owner question 6, built 2026-10-06; fixed after review)

What covers a label is decided by the core, with the mod's own code: under `ztext` it runs `TextOrder.Assign`, which puts a label under the first later shape of its element whose bounds overlap its box. Each frame label carries `cover`, the first frame vertex drawn over it: that shape's start, or else its element's end (under `ztext=0`, or when nothing overlaps). Every later element is drawn over a label either way, as UGUI draws a later sibling over an earlier one, a native label's included. A label declared before the element's very first shape goes under it (the mod's leading empty slice).

The covers live in the text layer, among the labels (`editor/gl.ts`, `makeRenderer(canvas, true)`; `Canvas.tsx`). The text layer is its own stacking context, so the selection and the other overlays stay above it. Once React has committed a frame's labels, before the browser paints:
- The text layer measures each label's box and text as laid out (`measure`), when the labels, the zoom or the fonts change. A label's region is its box, turned and sheared as drawn, joined with that measure (text past the box under fit 0 or 2; fit 1 clips its text to the box), grown by its shadows and outline, and cut to its clip and the surface.
- `covers` lists the labels some triangle is drawn after, each with its region and its layer. Where two covered labels' regions meet, the cover of the one drawn first (the smaller `cover`) goes a layer deeper, under the other's text; labels with one `cover` share a layer.
- The cover canvas draws the frame into its own linear RGBA8 target, as the canvas does, inside the union of the regions. Per covered label, deepest layer first, it gathers in the label's region the alpha of the triangles drawn after the label, and shows the canvas's colour there at that alpha, premultiplied. Where a nearer layer's cover lies over the label too, it gathers only what is drawn up to that cover's label (a stencil marks where), so the alphas over any text multiply to what the game's geometry leaves.
- Layer 0 stays on the WebGL canvas. Each deeper layer is copied to a 2D canvas of its own, sized to that layer's regions.
- Each covered label's text gets the z-index just under its layer's cover. A label nothing is drawn over keeps z-index auto, over every cover.
- With nothing covered, the cover canvas only clears.

Where the covering geometry is opaque, and wherever no glyph is, the result is exact, provided a label's ink lies in its region. Under a translucent cover the text shows through by exactly what the geometry leaves, but in the canvas's colour, blended by the browser in sRGB (see the limits for its size).

Tests, each seen failing first:
- `core/Core.Tests`: six checks of `cover`. A shape after a label covers it, one before does not, and `ztext=0` keeps the label over its own shapes. A later shape whose bounds miss the label does not cover it. Every later element, and a native label's, does. A label declared before the very first shape goes under it (seen failing with a Compositor that leaves a cut at vertex 0 uncovered).
- `npm test`, `covers`: the box arithmetic and the index search; the label numbering; the layers (two covered labels whose regions meet, regions apart, equal covers); the region grown to the measured text under fit 0 and not under fit 1.
- `npm test`, the cover pass on a recording fake WebGL 2 context. Covered, it draws the shape's triangles into the alpha of the label's box. Uncovered, or under `ztext=0`, it only clears. Two labels each get their own alpha. Two layers: the deeper is drawn first, its alpha gathered only up to the nearer cover where that one lies over it (the stencil), handed to `copy`, then cleared off the canvas. The canvas pass is unchanged.
- `npm test`, the shaders: the shader sources the fake records. The cover compiles `FS_COVER` (premultiplied) and the canvas `FS_OUT`; swapping in `FS_OUT` for the cover fails.
- `npm test`, the Canvas wiring: the cover gets the frames the canvas gets; its canvas sits in the text layer at z-index −1, which is isolated; a covered label's text sits at its layer's place (−2, −4), a label nothing is drawn over stays at auto; a deeper layer gets its own canvas at −3, gone when nothing is covered; the covers get each label's measured box and text in surface px.
- `npm test`, picking (`hitTest`): where label boxes meet, the label drawn last by its cover wins; a covered label whose `T` is unknown loses to the shape over it, and one nothing is drawn over stays on top; under `ztext=0` a label wins over its own element's shapes and loses to a later element's.
- `npm test`, a label whose `cover` is not finite (including a frame from a core without it) stays on top; among such labels the later one wins a press, as DOM list order draws it. The regression runs `covers` in a worker: removing the finite-cover guard fails after 3 s with the cause (the layering loop is stuck), rather than hanging the test runner.
- `npm test`, the fonts: when web fonts finish loading (`loadingdone`) or a face is imported, the canvas measures the labels again and draws the covers again, and leaves no listener behind; `measure` reads the box it selected, joins a label's boxes, and gives surface px.

The suites came to 423 checks and 1,332 tests; after the fix round before merge, which left the core alone, to 1,336 tests.

### Its cost

The pages:
- The grid: 200 labels in a 20 × 10 grid, each with a 12 × 20 rectangle over its right half. A label is covered when its rectangle comes after it, so the 0, 10 and 200 cases differ only in order. A fourth case adds 2,000 more 8 × 8 rectangles after every label.
- The chains: 2, 10 or 40 labels, each 300 × 40 and 11 to 20 units below the last, so each meets the next; each is covered by a rectangle declared before the next label. Each label takes a layer of its own: as many layers as labels, the worst case for the layers.

The canvas was 865 × 865 device px, on an NVIDIA RTX 3090 (ANGLE, Direct3D 11) in Chromium 152, with the Vite dev server, in a background tab with a 16 ms timer standing in for `requestAnimationFrame`. The layout effects were timed by temporary instrumentation, not committed. "CPU" is the cover effect's own time: `covers`, the draw calls, the copies of deeper layers and the z-index writes. "With the GPU" adds a 1-pixel `readPixels` on the cover's context, which waits for its work to finish. About 120 frames a row, two runs each; `performance.now()` is coarsened to 0.1 ms.

| page | covered | layers | cover, CPU (median / p95) | cover, with the GPU (median / p95) | the canvas pass, with the GPU (median) |
|---|---:|---:|---:|---:|---:|
| grid | 0 | 0 | 0.1 / 0.2 ms | 0.3 / 0.4-0.5 ms | 0.4 ms |
| grid | 10 | 1 | 0.2 / 0.3 ms | 0.6 / 0.8 ms | 0.3-0.4 ms |
| grid | 200 | 1 | 0.3-0.4 / 0.6 ms | 2.5 / 3.2-3.6 ms | 0.4 ms |
| grid, then 2,000 rectangles | 200 | 1 | 0.4-0.5 / 0.5-0.8 ms | 2.6-2.8 / 3.8-4.1 ms | 0.6-0.7 ms |
| chain | 2 | 2 | 0.1 / 0.2 ms | 0.6 / 0.8 ms | 0.4-0.5 ms |
| chain | 10 | 10 | 0.2 / 0.3 ms | 1.4-1.7 / 1.8-2.5 ms | 0.6 ms |
| chain | 40 | 40 | 0.5-0.6 / 0.7-0.9 ms | 4.0-5.9 / 4.8-6.5 ms | 0.9-1.0 ms |

Ten covered labels spaced apart, one layer, took 0.4 / 0.5-0.6 ms with the GPU. Taking away the bare clear (0.3 ms): 10 covered labels add about 0.3 ms a frame, 200 about 2.2 ms, and each deeper layer about 0.1 ms more (10 layers against one: 1.0 to 1.3 ms). The stencil, paired with and without it on the 200-label grid: 1.9 and 2.1 ms against 1.6 and 1.7 ms median; the search it needs is now skipped on layer 0, where nothing is above. The measure of 200 labels took 1.9 to 2.2 ms, and runs only when the labels, the zoom or the fonts change. The median frame interval was 16.5 to 16.8 ms on every page but the 2,000-rectangle one, 32.9 to 33.2 ms: the core's tessellation, since the canvas pass and the cover together took about 3.5 ms of it. One run of the same rows on a loaded machine read two to three times higher throughout, the canvas pass included, and was discarded.

### Browser checks

These ran in a background tab against a freshly published core, with no console error. Scenes were typed into the code pane; the readings are the cover canvases' own pixels and the label nodes' z-index; "seen" is a screenshot.
- The reviewer's scene, a label in a covered label's box: `TITLE` (440 × 200), a red rectangle, `TOP` on the rectangle. `TOP` is on top (z-index auto, seen), `TITLE` under the rectangle (−2, seen).
- The widgets: Text, then Button at its default place. `Label` shows `Lab`, then the button; `VENT BAY` shows on the button face (seen).
- A header caption with a 440 × 160 box, a later green button and a later `OK` on it: `OK` shows on the button (seen).
- Text past its box: `OVERFLOWING TEXT` (box 100 wide, fit 0) under a 400-wide rectangle. `OV` shows; every pixel of the laid-out text under the rectangle reads cover alpha 253 to 255, the dither the game's own rectangle has. A label whose box the rectangle misses stays on top, its overflowing `D` over it.
- Two covered labels: `PPPPPPPPPPPP` under a red and a blue rectangle, `QQQQQQQ` between them. `P` goes to layer 1 (its text −4, its cover −3, on a canvas of its own), `Q` to layer 0. `Q` shows over the red rectangle and under the blue one (seen).
- Stacked translucent covers: `PPPP` under two rectangles at `fo=0.5`, `Q` between them. Where `Q`'s region lies over `PPPP`'s, `PPPP`'s cover reads alpha 127 and `Q`'s 127: the text shows through by 0.25, as in the game. Outside `Q`'s region, `PPPP`'s cover reads 193 (0.75); under the first rectangle alone, 129.
- `ztext=0`: no pixel of the cover drawn, every label at z-index auto.
- Six labels in a chain, each meeting the next: six layers, five deeper canvases at −11 to −3 and the texts at −12 to −2. On the third label's text past its own rectangle, over the rectangle before it, every cover reads alpha 0 and its text node is the topmost element.
- Example 14: the left `COVERED?` under the shutter, the right one over it (seen).
- Presses agreed with the preview: on `TOP` over the rectangle a press selected `TOP`; on `TITLE`'s covered part, the rectangle; beside it, `TITLE`. Where `PPPP` (drawn last by its cover) and `QQQQ` meet, a press selected `PPPP`, which the preview shows on top.
- Fix round before merge, against the published core: `OVERFLOWING TEXT` (box 100 wide, fit 0) under a 400-wide rectangle again: all 50,100 cover pixels where its laid-out text meets the rectangle read alpha 253 to 255. The glyph overhangs of the limits below were seen in the same tab.
- The first build drew straight alpha. The browser filters a canvas it scales or shifts (the stage sat at a half pixel), so a dark seam showed round each covered box. It went with `image-rendering: pixelated`, and then for good with premultiplied output.

### Limits, each with its ceiling and upgrade path

- **A translucent cover is in the canvas's colour.** Through it the text shows by exactly what the game's geometry leaves, but the colour laid over a glyph is the colour the canvas shows there, which holds what is under the text, and the browser blends it in sRGB, not in linear light. Computed with the blend the canvas uses, for a white glyph under `#E2563D` on `#203040`, the preview is darker than the game per channel by 19 to 26 levels at alpha 0.25, 30 to 32 at 0.5 and 21 to 35 at 0.75; example 14's `#7EE0B8` glyph under its shutter (0.85, on `#182230`) by 16 to 19. Upgrade: text in WebGL.
- **Glyph overhang, fixed in the follow-up above.** Previously the region was its box and the line boxes of its laid-out text, grown by its shadows' and outline's reach. In that version, a glyph that inked past its line box showed over an opaque cover where that ink also left the label's box: at a box edge the text reaches (the left edge of left-aligned text, the top under valign top), or past the box under fit 0. Measured on the bundled faces (Chromium 152; every glyph of each face's character map at 100 px, its outermost inked pixel against its DOM line box): at a face's own weight no ASCII or Latin-1 glyph inks above or below its line box, and at the sides they ink past it by up to 0.07 em (`j`'s tail left; `ï`, `î`, `Ì` both ways); other Latin letters by up to 0.2 em at the sides (`ď`, `ľ`, `ť` right, 0.09 to 0.17 em; `ƴ` 0.2 em) and, in Liberation Sans Bold, above (`Ǻ` 0.13 em, `Ů` 0.05 em); beyond Latin, Barlow's stacked Vietnamese accents 0.04 to 0.11 em above, Liberation Sans's box drawing 0.10 em below, the fraction slash `⁄` 0.16 to 0.21 em at both sides, and Hebrew sof pasuq U+05C3 0.24 em at a side (the earlier maximum of 0.21 em omitted it). Before the font fix, weight bold on Barlow and Barlow Medium was synthesised and added 0.02 to 0.03 em below (`g`, `j`, `y`, `§`); on Barlow SemiBold and the Condensed faces it changed nothing. Combining marks alone are left out (they sit on a letter before them). Seen: under a page-wide opaque rectangle drawn last, a 200-unit `j` at its box's left edge shows its tail as a sliver left of the box, and a 160-unit bold `Ǻ` at its box's top shows its accent above it. At a 40-unit size the ASCII and Latin-1 overhangs come to under 3 units. A fixed margin round every label would make regions meet that do not, and so add layers to a list of rows (each about 0.1 ms, measured above). The follow-up implements that upgrade in `measure`: each line's ink box comes from `measureText` at its computed font, with kerning and letter spacing, and is joined with the DOM line box in the label's own axes, then turned and sheared back. The glyph figures here are the original measurements; browser verification of the new cover regions is still required.
- **Each covered label costs a draw; each deeper layer, a canvas and a copy.** Measured above. A chain of labels that each meet the next, their covers in order, takes as many layers as labels: 40 cost 4 to 6 ms a frame. The layers are as few as the order allows (a label goes one below the deepest it must be under). Upgrade, if a page needs it: skip a label whose region no later triangle reaches (a suffix bounding box per distinct `cover`).
- **Covered labels are compared in pairs** (`covers`' `ponytail:`), 40,000 box tests for 200. Upgrade: a grid over the regions if a page carries thousands.
- **Picking under `ztext` reads a paired label's place from its `T`, not its cover.** Within the mod's 0.25-unit touch band a shape after the label wins a press while the preview shows the label on top. (Under `ztext=0` a press follows the cover since the fix round before merge: a later element wins over a label, as the preview draws it.) Upgrade: pick from `cover` alone (`hitTest`'s `pickUnder`; left for after the merge with `m2c-editing`, whose `pickUnder` takes a pass-through for locked nodes).

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
npm install
npm run precore                               # copies _framework and the 18 vector examples into web/public
npm test
npm run dev                                   # then open the printed localhost URL
```

These steps were checked in a fresh checkout of this branch, its submodules freshly initialised. The suite printed `ALL PASS` (417 checks) and the publish succeeded. `precore` copied the 22 `_framework` files and the 18 example scripts. `npm test` passed 1,317 tests, and `npx tsc --noEmit` and `npm run build` succeeded.

Notes:
- On Windows, Lua-CSharp's own checkout has paths too long for git's default. If the submodule update fails, run `git -C core/vendor/lua-csharp config core.longpaths true`, then `git submodule update --init --recursive --force`.
- Always pass `-p:VectorSrc` with the absolute path of the `core/vendor/vector/` submodule, ending in a slash, so a local `core/VectorSrc.user.props` never decides what is built.
- After any change under `core/`, publish into an emptied folder and run `npm run precore` again.

Editing keys, in brief:
- Tools: V Select, A Points, R Rectangle, O Ellipse, L Line, Y Polygon, P Path, T Text, I Image.
- Edit: Mod+Z and Mod+Shift+Z undo and redo. Mod+D duplicates, and Mod+C, Mod+X and Mod+V copy, cut and paste. Mod+A selects all, and Delete or Backspace deletes.
- Arrange: Mod+G and Mod+Shift+G group and ungroup. Mod+] and Mod+[ bring forward and send backward; with Shift, to the front and to the back. Mod+Shift+H hides, and Mod+Shift+L locks.
- Align: Alt+A, H, D, W, V and S. Alt+Shift+H and Alt+Shift+V distribute.
- Style: Mod+Alt+C and Mod+Alt+V copy and paste a style.
- Movement: the arrows nudge by 1, and with Shift by 10. Ctrl or Cmd held turns snapping off. Esc steps back.

The full list is the Commands menu.
