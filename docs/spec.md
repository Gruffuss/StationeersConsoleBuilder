# VectorBuilder — design

Status: approved on 2026-10-04, and amended in place since (§12). M0, M1, M2a, M2b, M2c and M3 built; E1's implementation integrated; M4's implementation integrated with browser/console evidence still pending. M4 is not complete; see docs/m4.md. M5 and M6 built; the site launched on 2026-10-13 (docs/m6.md).

## 0. Amendments

This spec states current decisions in place; the dated history of changes is in the Decision log at the end. A new decision is written into the body where it applies, then logged in §12; `docs/decisions.md` digests the decisions in force.

## 1. What it is

A free, public, static web app in which any Stationeers player builds a console screen
visually and exports one `.lua` chip script. The script runs on a StationeersLua chip and
draws through ScriptedScreens with the **ScriptedScreens Vector** element type (`vector`).
It never goes through the HTML mod of ScriptedScreens.

At its core it is a general vector editor inspired by Illustrator and Figma (draw,
transform, style and arrange any shape): they are an inspiration, never a specification or a
feature checklist (owner, 2026-10-12). It has extra options for consoles: data bindings,
logic, pages, devices and export. It is not built around any particular set of consoles or
one design system (owner, 2026-10-11): the owner's consoles, and the test fixtures made from
them, are examples of what consoles need, never a target; behaviour is judged, never how an
example looks. A starting set of widgets, editable once placed, and complete themes sit on
top: provided ones, and from M5 ones imported from design systems. A theme sets the widgets'
paint, dimensions and shapes. More widgets come after 1.0 (owner, 2026-10-12).

Audience: players of every skill level. Beginners assemble widgets and bind them to devices
without writing Lua. Experienced players edit the vector scene text and add their own Lua.

Editor UI (owner, 2026-10-12, the UI redesign): the chrome is Vanilla + drawn at 50 % of its
token sizes (smallest text 12 px), with simple line icons for now; the scene source pane is
open by default, docked under the canvas, in a bundled monospace face (JetBrains Mono, SIL
OFL, never fetched). New and open, Share link, Fonts, Export, Import a design system (the
import panel unchanged in a scrolling dialog, no wizard), Adopt, Keyboard
shortcuts, and the autosave-conflict and start-up recovery choices are modal dialogs; Blank
project and Wipe persist ask for confirmation first (Cancel focused, Esc cancels); the
start-up "Choose a project" dialog has Close, which, like Esc, continues without autosave.
One page is on the canvas at a time, switched from the Pages list, with the frame look;
developer items sit under Help › Developer, marked DEV, in every build; a node id is renamed
in its Layers row with reference carry-over; no bar appears with a gesture. Mobile is out of
the redesign's scope (owner: "it was never optimized for mobile yet and it is not in scope
for today"): phone-width checks and phone-layout issues are not part of it, and mobile
optimisation is a later item. No player-visible text shows a chip, device or network
reference id (§6.1). In the editor (owner's choice, 2026-10-12), the role's ref field moves
behind a collapsed "Advanced" disclosure labelled "Pin to one specific device", the only
place the id shows, and saved projects keep their value; the simulated-devices panel's
"ref N" and the write log's "ref N:" become device names.

Not in v1:
- a backend or accounts;
- runtime theme switching on the console;
- a visual logic editor;
- `ic.net` messaging (P1).

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Draw directly with `vector` elements (structure + data element per scene). No HTML mod. |
| D2 | Public static site for any player. No backend. Projects live in the browser. |
| D3 | Editing = a canvas of widgets and raw vector shapes **and** a code pane editing the vector `src` scene text. The two sync both ways. |
| D4 | Stack: Vite + TypeScript + React for the app, CodeMirror 6 for the code pane. |
| D5 | One project = one chip script = a multi-page console. Each page is a ScriptedScreens surface holding one vector scene. Bindings and `tick()` are shared. |
| D6 | The preview **runs the exported Lua**. The vector mod's own C# core and the game's Lua interpreter (Lua-CSharp) are compiled to WebAssembly and run in a Web Worker. WebGL 2 interpolates float sRGB vertex colours, decodes per fragment and composites opacity in linear light through an sRGB8 target (§7). |
| D7 | A Data panel binds every `$name` to a role read, a computed value or a constant (the preview's simulated values live on simulated devices, §6.1), and the builder generates `tick()`. Device control uses **latched rules**. A custom-Lua block is kept verbatim. |
| D8 | Exports include a generated in-game **Devices page** where the player assigns real devices to roles. The choice persists. |
| D9 | Export = Download + Copy. "Send to chip" through the game's MCP is a hidden, optional panel. |
| D10 | Starter templates, plus sharing as a compressed URL fragment or a project `.json`. |
| D11 | Themes are complete designs: colours, type, paint parts, dimensions and anatomy (the shapes each widget part is drawn with, which a theme may add to, replace or remove: owner, 2026-10-12; E1), resolved to literal values at export. The provided themes are **Neutral**, the default, on the game's own font, and **Vanilla +**, the game-menu design system (owner, 2026-10-12; E1). Themes can be imported from Claude Design design systems, anatomy included (M5). |
| D12 | Native ScriptedScreens item icons and text input are allowed beside vector scenes. |
| D13 | A page's shape follows the real console's **proportions** only. The viewbox is in design units, with 480 per console-cell height as a **reference unit only**. Nothing has a fixed resolution: a console renders more pixels as the player gets closer, and groups scale (`s`) freely, so artwork scales without limit. |
| D14 | Exports use only APIs the **public** StationeersLua and ScriptedScreens have. Beta extras are feature-detected. The preview follows public behaviour, with an "assume beta mods" toggle. |
| D15 | The export floor is the **newest vector tag**, which is the pin (§3): the owner publishes to the Steam Workshop daily, and Steam auto-updates mods for clients and dedicated servers. Nothing is gated per feature. The only guard is each page's old-mod banner (§6.3), for a game started before an update landed. |
| D16 | Widgets expand to plain vector nodes. They do not use `SYM`/`USE`. |
| D17 | Generated Lua is Lua 5.2: no `//`, no bitwise operators, no integer subtype, `%d` only on integers. |
| D18 | MIT licence. Public GitHub repo: committed files carry no local paths, account names, session names or console ids. The one exception (owner, 2026-10-12: "keep it yes"): THIRD-PARTY-NOTICES reproduces the vendored vector mod's MIT copyright line, "Copyright (c) 2026 Gruffuss", as MIT requires; `.gitmodules` already names that repository. VectorBuilder's own LICENSE holder stays "Copyright (c) 2026 Gruffus" (one s, the owner's spelling). Work happens on branches, committed by path with plain messages and no attribution trailers. `main`, any push to it, and GitHub Pages only on the owner's say. |

## 3. Architecture

```
VectorBuilder/
  web/          Vite + TS + React
    model/      Project → Pages → Scene (nodes, defs) · Roles · Reads · State · Actions · Rules · Bindings · Theme · CustomLua · SimDevices · Settings
    srctext/    src scene text ⇄ model (parser + printer)
    schema/     op/attribute catalogue (a base extracted from the pinned parser + a hand overlay, joined by drift tests) → property panels, validation, autocomplete
    widgets/    one module per widget: params + theme → nodes (+ per-instance defs) + data keys
    theme/      provided themes (Neutral default, Vanilla +), paint parts, metrics and anatomy, token resolution, raw-shape style links; design-system importers (M5)
    catalog/    fonts.json; devices.json and enums.json, generated from the game's Stationpedia export (tools/catalog/; "Device catalogue" below)
    codegen/    model → .lua (fixed runtime library + generated config tables + one src literal per page)
    editor/     canvas (WebGL preview + SVG selection overlay) · layers · properties · code pane · data · devices · problems
    runtime/    bridge to the core worker
    project/    versioned JSON/gzip transfer worker, sharing, templates and IndexedDB current/recovery records
  core/         .NET 10 browser-wasm (net10.0), loaded in a Web Worker
    vendor/vector   git submodule of scripted-screens-vector pinned at a tag (current pin: `v0.11.118`, 1f877d7); the pin is the export floor
    Lua-CSharp      nuskey8/Lua-CSharp at commit d9fb336931d2dc874c924575cc15d9c2d35841ce (the game's Lua.dll)
    host/           clean-room fake ScriptedScreens + StationeersLua host, written from the public docs
  tools/        catalog/ (the catalogue generator, the enum probe and its collector) · ingame/ (the in-game probes)
  templates/    starter projects in the builder's own format
  docs/
```

**Device catalogue.** The catalogue of devices (each prefab with logic: its hash, readable and
writable LogicTypes, slots and modes) and of the LogicType, LogicSlotType and LogicBatchMethod
enums with their numbers is generated by `tools/catalog/` from the game's own Stationpedia
export, written by StationeersStationpediaExtractor (MIT, a BepInEx plugin): its
`Stationpedia.json` and `Enums.json`, build 0.2.6428.27798 at M3 (owner, 2026-10-06). The
owner's `ic10-devices.md` (407 devices, game 0.2.6403) cross-checks it and names the vanilla
devices, since the export comes from a modded game. The repo commits only the generated JSON:
the extractor export, `ic10-devices.md` and any dump stay local, and the generator takes their
paths on the command line (owner, 2026-10-06).

**Pin.** The preview pins the newest vector tag pushed to origin, re-pinned only when the current
work is done or after asking the owner (a crash fix is a reason to ask, not to act); between
re-pins, upstream's changes wait in a running list;
the pin is also the export floor (D15). The current pin is `v0.11.118` (`1f877d7a3682fc61cec364427d590d6400319ecb`). The builder never
waits for upstream: a vector bug it finds goes upstream with a repro and is then treated as solved, so
the builder adds no workaround, guard or trap warning for it, and no test depends on it before
the fixed tag is pinned.

**Data flow.** The preview always runs the exported script, never the model directly:

```
edit (canvas | code pane | panels) → model → codegen → .lua
  → core: Lua-CSharp runs it against the fake host → the fake ScriptedScreens records elements per surface
  → the vector mod's parser builds each page's scene → each frame: evaluate + tessellate at t
  → meshes + label boxes → WebGL 2 (linear light) + browser-drawn text
```

So what the preview shows is what a chip will run. Lua errors, budget overruns, scene
problems and unresolved data names all appear before the game is opened.

**Selection.** The core sets `Tessellator.TagNodes = true` (vector 0.11.61+) and returns
`NodeSpans`. The smallest span containing the pointer is the innermost node; the editor
selects from it the node at the current editing depth (§4, E1). A span with
`Count == 0` still maps hidden nodes back to the tree. Selection handles are sized from
these spans.

## 4. Scene model, properties and code pane

```ts
Project { name, target, theme, pages: Page[], roles, reads, state, actions, rules, bindings, customLua, simDevices, settings }
Page    { id, surface, shape /* aspect + design units */, fit, background? /* absent: no panel */, defs: Node[], root: Node[] }
Node    { op, attrs: Record<key, Value>, c?, comments? }
Value   = number | string | "=expr" | "$name" | "@gradientId" | table
```

`Project.target` is `{ vectorMod: VECTOR_FLOOR }`: the pinned vector version (currently
`0.11.118`), restored to that pin on load. It is recorded in projects; export requirements
and the old-mod banner always use the current pin (§2), with no per-project version picker.

A widget is a `G id=<uid>` whose last own-line comment is its marker
`widget <type> <uid> <params JSON>` (owner decision Q1); the marker is its only record. Built
widgets are root-level nodes. E1 lets an ordinary group hold widgets (a widget never holds
another) and adds to the marker JSON an optional `__edit` record of the instance's part
overrides (§5.1); a marker without one prints as before.

**Canvas editing.** The builder is a drawing tool, not only a property editor:
- **Draw:** tools that create a node by dragging on the canvas: rectangle, ellipse, line,
  polyline and polygon, path (`SP`), text, and an image placeholder. A new node takes its op's
  defaults and the theme's styles. E1: the theme's draw defaults (parts `shape` and `line`, the
  style `drawText`), linked to the theme (§5.2), or the look a person chose with Use as
  default (per browser); a pen for literal Bézier `P` paths, built last.
- **Navigate** (E1): zoom at the pointer (Ctrl/Cmd + wheel, or a pinch), pan (a plain wheel or
  two-finger scroll, Shift + wheel sideways; Space-drag), Fit, 100 % and Fit selection (wheel:
  owner, 2026-10-12). The view is editor state per page, never artwork or undo history; the canvas,
  the text layer, covers, natives, overlays, picking and snapping share one view mapping.
- **Layers and picking** (E1): a click selects the node at the current editing depth (the
  entered group's children, or the page's top-level nodes); a double-click or Enter enters a
  group, Shift+Enter leaves; Ctrl/Cmd+click selects the innermost node. Drawing goes into the
  entered group. A layers panel lists the page's nodes and defs to select, hide, lock, rename
  and reorder or reparent without moving the artwork. Entering a widget exposes its parts.
- **Paint and layout** (E1): colour with alpha and theme tokens, gradients with stops and
  handles, stroke (width, cap, join, dash and an animated dash offset) and shadow lists; and
  layout on a group: direction, padding, gap, alignment, per-child margins and fixed or hug
  size, kept as own-line comments and written as ordinary positions and sizes.
  For a turned child, stretch changes only the local scale nearer the cross axis and
  uses the resulting main extent. A child that cannot reach the target overflows and
  is named; one re-flow is a fixed point (E1 ruling, 2026-10-12).
- **Transform:** move and resize any node with handles (Shift keeps the proportions, Alt
  resizes from the centre), rotate where the op reads a rotation, nudge with the arrow keys.
  A widget stops at its module's minimum size with the edge the drag left where it was, never
  crossing over. With Shift, a side handle dragged across the opposite edge stops its axis at
  the module's minimum (held where the other axis reaches its own minimum) and the other axis
  follows the clamped lead, so the proportions hold. On a corner under Shift the axis dragged
  further for its size leads (dragged across, it stops at the minimum the same way), and the
  axis that follows never flips: a corner whose following axis is dragged past its anchor
  follows the lead on its own side and never collapses to the minimum. The snap acts where
  the pointer is, never on the stopped edge, and not at all once the leading axis has crossed.
- **Snap:** to a grid with a settable step, to other nodes' edges and centres, and to the page's
  edges and centre, with guides shown while dragging. A modifier turns it off. A snapped value
  is a whole design unit, except where another node's or the page's line puts it (an odd width
  centres on a half unit) and where a Shift resize keeps a plain node's proportions (below).
- **Space:** multi-select (Shift+click, marquee); align left, centre, right, top, middle or
  bottom; distribute; set an exact gap between the selected nodes.
- **Style:** set fill, stroke, text and effects from the panel; copy a style from one node
  and paste it onto others; named styles from the theme tokens (§5.2), applied in one click.
  E1: the named styles come from the theme's parts, type styles and status colours, and a raw
  shape remembers, per key, the token a named style or a theme swatch gave it, so a theme
  switch reaches it (§5.2). A named style or a style paste never rewrites a `theme_` gradient def the page has; it only
  adds one the page lacks, so a hand edit of the def survives them. Only a theme switch
  refreshes the `theme_` defs; loads and widget edits keep their existing behaviour (a load
  makes every `theme_` gradient in the theme's colours, and an edit of a widget that paints
  with one writes it again). Only a theme switch also removes a `theme_` gradient def
  with no `@theme_<name>` reference anywhere in the page's nodes or defs and no
  `theme_<name>` mention in custom Lua. A missing linked gradient keeps its last
  literal, link and def; undo restores pruned defs. `theme_` defs are the builder's.
- **Arrange:** duplicate, copy and paste, delete, group and ungroup, bring forward and send
  back, hide and lock.

**How the editor does it** (M2c, built 2026-10-06). The rulings in force, one each; the owner
may overturn any, and those marked *owner* are the owner's answers to the M2c questions
(2026-10-06, `docs/m2c.md`):
- **Snapping:** per axis, another node's or the page's edge or centre within 8 CSS px wins,
  else the grid, else a whole design unit; an object snap beats wholeness (an odd width
  centres on a half unit), and Ctrl/Cmd held snaps nothing and keeps 3 decimals. The grid
  step is a whole number of design units (0 is off; a sub-unit step is read as the nearest
  whole one). Under a scaled or rotated group the snapped design value becomes a fractional
  local value, and a resize under a rotated or sheared group does not snap. A Shift resize of
  a plain node keeps the ratio before wholeness. On a corner only another node's or the page's
  line snaps it, the leading side landing on the line and the following side keeping the
  ratio; with no line within reach nothing snaps, and both sides are written to 3 decimals, so
  the sizes are fractional (a 120 × 80 rectangle to 166.95 × 111.3). On a side handle the
  dragged side snaps as any edge does (a line, else the grid, else a whole unit) and the other
  side keeps the ratio, to 3 decimals, about its middle (its east handle: 166 × 110.667). A
  widget's resize is always whole units. The targets are every visible leaf's box and each
  root block's own box (a group's centre, which no leaf need have; a widget root's params box),
  but a box the moving set is in.
- **Boxes are exact geometry:** a `P`'s box holds every Bézier and arc extreme, an `SP`'s is its
  drawn samples, a `C`'s its ellipse, and a node under a turn the box of its turned geometry.
  That box places the handles and the outlines, and align, distribute, the gap, snapping and
  the marquee read it. It is the geometric box, not the drawn one: a stroke, shadow or glow
  lies outside it. A curve's fractional extremes give fractional positions (a gap across can
  put an `SP` at `x` 92.557). A widget root's box is its params box, for all of these alike
  (some modules draw up to 1.5 units outside it). A root node with no literal box (a `USE`,
  an `RP`, an expression position) is caught by the marquee and outlined in a set by its spans
  in the frame shown. A group is read at any scale the mod draws (`G s=[1e-7,1e-7]`); only a
  singular one (determinant 0) has no box or handles, and a move under it says so.
- **Expressions are never overwritten** (*owner*, Q1): a canvas edit that would write
  over an expression or a `$data` value (any string, a quoted number included) leaves that
  axis or handle where it is and says why (`x is an expression`); multi-node commands skip
  such nodes and count them. Group (a group of one) is the escape: its `t` moves freely.
  A style paste or a named style is the exception: it replaces such values, as the user's
  explicit act, and says how many (`2 expression or data values replaced`).
  Resize handles need the node's whole box literal; a `G` with `m` keeps its rotate knob but
  refuses resizing. The padlock and the selection path's "locked:" show only where a move moves
  nothing of the node (every axis held, or no position of its own).
- **Rotation** (*owner*, Q2) writes `G r` about `a`. `L`, `Y` and `SP` turn their
  points exactly; any other leaf is wrapped once in a turn wrapper `G a=[cx,cy] r=D { node }`,
  visible in the code pane, which later turns edit; the selection stays on the node.
- **Group scale:** a `G`'s handles sit on its children's union box in its own frame, and a drag
  writes `s` and `t` so the opposite handle stays put. `s` is written to 6 significant digits
  as float32, not 3 decimals, which would turn a scale below 0.0005 into 0.
- **Point handles:** the Points tool (`A`, or a double click on a selected `L`, `Y`, `SP` or
  `P`) gives each point a handle, and a drag moves it, snapped. A path keeps every command's
  letter and every other explicit point, except an `H` or `V` end's other coordinate and a
  reflected `S` or `T` control, which follow the point they come from. Points are not yet
  added or removed; E1 adds that, with the pen, last (owner, 2026-10-12: "low priority").
- **Hide and lock** (*owner*, Q3): hide is the mod's `v=0`, exported hidden. The same
  command shows a node whose literal `v` is 0.5 or less again (its `v` removed), and skips one
  whose `v` is an expression, saying so; hiding everything is allowed, with a note that the mod
  then draws its empty-scene marker. Lock is the own-line comment `# lock` above the node
  (above a widget's marker), so it rides with the node through undo, the code pane, copy,
  paste and reorder: a locked node, or one under it, is neither picked nor caught by the
  marquee, and stays selectable from the code pane and the selection path; a press sees through
  a locked node drawn on top to the node under it. Lock holds the geometric edits (move,
  nudge, resize, turn, points, align, distribute, gap); delete, hide, the styles, group,
  reorder and duplicate act on a locked node selected from the code pane or the selection path
  (*owner*, question 9 in `docs/m2c.md`). On a set, hide flips each member by its own
  `v` (a mixed set swaps), and lock locks every member while any is unlocked, else unlocks
  them all (*owner*, question 8). Show all and Unlock all leave the nodes under a
  widget root to its module (the root's own lock goes).
- **The image placeholder** (*owner*, Q4) is an `R` with a faint fill, a dashed
  outline and the own-line comment `# image`. Giving it a source (the panel's Picture URL,
  or Choose picture file..., which reads a PNG, JPEG, BMP or GIF told by its first bytes as
  the mod's sniff does and writes a `data:` URL, showing the bytes it adds to the page)
  replaces it with an `IMG` in one undo step (M5). An `IMG` without `src` is a reported scene
  problem, so a new box does not start as one.
- **Editor settings** (*owner*, Q4), the grid step and snap on or off, are per browser,
  not in the project and not undoable. The nudge steps are fixed at 1 and 10 design units.
- **The clipboard:** copy keeps an in-memory `src` text and writes it to the system clipboard
  too; Mod+V on the canvas pastes the in-memory text, 10 design units further right and down
  per paste on the page it was copied from, in place on another; an undone paste no longer
  counts. Duplicate puts each copy 10 units right and down, right after its original (a
  widget's copy on top, under a new uid); a member inside another duplicated member goes
  with that one's copy. No id a copy gives (a node's, a def's, a clip copied with it) holds a
  native's uid, nor has a widget's or a native's uid as its stem (up to its first `_`): such an
  id becomes `<uid>copy<k>_…`, as a pasted widget's copied defs are named (Q14), so the next
  load neither drops a native nor detaches a widget.
- **A multi-selection** (*owner*, Q5) moves, nudges, aligns, distributes, takes an exact
  gap, deletes, duplicates, copies, groups, reorders, hides, locks and takes a style paste or
  a named style; resize and rotate handles are for a single node. E1 adds resize and rotate
  of a multi-selection about its union box (owner, 2026-10-12: "yes yes", superseding Q5);
  expressions, locks and natives stay where they are and are named.
- **Drawing:** a draw tool inserts at the top of the page root and switches back to Select
  after one shape. E1: at the top of the entered group, in its frame.
- **Picking:** where the mesh hits nothing, the smallest closed shape with its own fill or
  stroke, `T` or `IMG` whose outline holds the point is picked (the inside of a stroke-only
  shape), never a pure hit region; a label is paired with its `T` by geometry (centre and size
  within half a px), the frame's own node first when it fits.
- **`ztext`** (*owner*, Q6): picking follows the game's order, so a shape drawn after a
  label wins a press over it, and the preview matches the game: a shape drawn after a label
  covers it, through WebGL covers among the labels of the text layer, each scissored to its
  covered label (§7). The core sends the mod's box-based cut (`cover`), each label's earliest
  eligible later vertex (`after`), and each element's shape starts and surface bounds. The
  preview can move the cut earlier when a later shape overlaps the measured text/ink region
  outside the T box, including rotated and sheared text. Under `ztext=0` the eligible range
  starts after the element's shapes; every later element is drawn over it either way, as
  UGUI draws a later sibling over an earlier one. Picking uses the displayed measured cut. The labels and the covers stack in that draw order: a
  label drawn after a covering shape stays over that shape (a button's label over a text
  label's cover), and where label boxes meet, the label drawn last by its cover is on top, in
  the preview and for a press alike; a label whose `T` the pairing cannot find is placed by
  its cover too, as is every label under `ztext=0` (over its own element's shapes, under a
  later element's). A missing or non-finite cover leaves the label on top; equal covers put
  the later label in the frame list on top, for drawing and picking alike. Exact for opaque
  covers wherever a label's ink lies in its region (its box, laid-out text and measured
  per-line glyph ink, past the box under fit 0 or 2, grown by its shadows and outline; fit 1
  clips to the box, §7); under a translucent cover the text shows through by exactly what
  the geometry leaves, but in the canvas's colour, blended in sRGB (§7).
- **Undo:** one gesture, one command or one nudge burst (committed 500 ms after its last press)
  is one undo step; a gesture that writes nothing leaves none, and one dragged back to where
  it began keeps the node its press selected. Undo brings back the selection the project had
  before the edit; redo brings back the set the edited project had when the undo left it.
- **Esc** has one order: an open gesture, then the active tool (back to Select), then the
  selection (a set clears; one node selects its parent; a top-level node or a widget root
  deselects). Esc on an open gesture cancels it with no undo step: the project and the set at
  its first step come back, so a drag keeps the node its press selected, and a drawing tool's
  Esc leaves the set from before the shape, never the new node's path.
- **The status bar** under the canvas is one line of fixed height, scrolling sideways; messages
  open in a Messages drawer of fixed height that scrolls; the selection path is a one-line
  overlay on the canvas's top-left corner, scrolling sideways (the UI redesign, 2026-10-12,
  `docs/ui.md`). So a message during a gesture never moves the canvas under the pointer. For the same reason nothing in the
  editor's chrome mounts, unmounts or re-wraps when a gesture starts or ends, and every
  gesture keeps its press's canvas origin and view until it ends (2026-10-12: the export
  controls used to unmount during a drag, so the header shrank and every drag landed off).
- **Frames carry the scene they were drawn from** (`drawnFrom`): a press reads the node
  numbering only while that scene has the current scene's shape, so a click right after an
  undo or a structural edit never names the node that now holds the old index.
- **Widgets:** a press selects a widget's root; a move or resize writes its params in whole
  units (no `G s` or `t`); Delete takes the widget's own defs with it; duplicate and paste give
  new uids. A widget root has no rotate knob; group refuses it, and hide and a style paste skip
  it, each saying why; ungroup does not apply (Detach is the way out); lock works. A native
  (M2b) is selected alone, never in a set; Delete removes it and no other command acts on it.
  E1 changes this: entering a widget selects its parts, whose paint, effects, position and
  size become the instance's overrides without Detach (a theme's ornaments are parts too, but
  their place follows their part: §5.1); a widget root hides, fades and
  rotates through root attributes the marker keeps; group keeps it a widget; structural
  changes still go through Detach.

The list grows: the owner adds tools as ideas come. So tools and commands plug into one
registry (a tool: its pointer handling and overlay; a command: its action, shortcut and
when it applies), and snapping and layout are pure functions any tool can call. A new tool
or command is one file plus its registration, with no change to the canvas or the store.

The builder's UI was a rough, functional prototype until these utilities existed. The owner
then designed the final UI, built on 2026-10-12 (`docs/ui.md`); a cleanup pass follows once he
has worked with it.

**Property panel.** E1 adds the paint and layout controls above, labelled and usable from the
keyboard, beside the generated fields. Generated from the op/attribute catalogue, so every key the parser
accepts is offered with its type, default and enum values. The catalogue is extracted from the pinned
parser and cross-checked against the mod's `REFERENCE.md`. A disagreement between the code
and the reference is the signal: it goes upstream as a report. Only a measurement on a console
decides which side is wrong; the code was wrong about `fea` and the reference was wrong about
the flush rule. Until it is measured, the catalogue takes the reference as a provisional
tie-break and marks the row as provisional, never as settled. It never encodes a rule only the
code implies without reporting it. Where the reference is merely silent, that is a question to
ask upstream, not a defect. Every attribute that reads an
expression has an **fx** toggle: literal, data (`$name`) or expression. Autocomplete is a
panel `<datalist>` (no CodeMirror autocomplete) covering data names, the 35 expression
functions and the variables `true false ver t sy vh n hover down i i1` (iN names repeat indices).

The panel and the code pane warn on silent traps, as the mod behaves at the pin; the `SCENE` header is
checked like a node, as op `SCENE`:
- a gradient on a moving shape without `units=bbox`;
- a 1-based array index in an expression (`[n]`, `[i+1]`);
- bare `pi` or `tau` (needs `pi()`);
- a self-intersecting `Y`;
- a point list `p` (`L`, `Y`, `SP`) with an odd number of values (the mod reads x, y pairs and
  drops the last value: `{10,10,60,10,60}` is a two-point line, `{10,10,60}` one point), or too
  few points for its paints: a stroke takes two, a fill and a shadow three. An `L`, `Y` or `SP`
  with fewer than two, or with every point at one place (a stroke drops a point that repeats the
  one before it), draws nothing, and the advice asks for three points where it fills or casts a
  shadow, else two. With two, its stroke draws the line between them and a fill encloses
  nothing: a `Y`'s fill and shadow draw nothing, an `L`'s fill nothing, and an `SP`'s fill (its
  points are its curve's samples) at most its feathered edge, a hairline (nothing where the two
  are level or one above the other), open or closed: the mod leaves a two-point ring open, where
  REFERENCE.md says it encloses a sliver (for upstream); a closed two-point `SP`'s shadow draws,
  as a blurred line. A fill counts on an `L` or an `SP` only when it is its own, not one passed
  down to a line under a filled group (provisional, for the owner to rule: from three points the
  mod does fill one passed down, and with two it is lost as an own fill is). Measured at
  0.11.97 to 0.11.101; a two-point `Y` (stroked, not filled) and the odd `L`s above were seen on
  a console at 0.11.101. A clip's shape with too few points the mod reports. A `p` that is not
  a list (`p=5`) has no point. Points closer than 0.01, which the stroke merges too, are not
  judged;
- a shadow on `SP` without `close=1` (an open `SP` fills as if closed, like `L`/`LS`: the
  code's reading, confirmed upstream (0.11.94); REFERENCE.md is to follow);
- text or an expression on a number-only key, or a single value on a pair key; on a list key
  (`p`, `dash`, `m`, `uv`, `slice`, `bw`), an entry that is not a number, a nested list too
  (read as 0), and a single number on `dash` (no dash: the stroke is solid; the mod reports
  one on the other list keys for its length);
- a key read only with another (`fo` without `f`, stroke keys without `s`, a pointer key
  without `id`: no hit region; inside an `RP` each instance has its own, `id:0`, `id:1`, …;
  an `SC`'s `sov` without its own `so`: since 0.11.98 the mod reads the scroll offset from the
  `SC`'s own map, so a `so` passed down to it, from a G or the SCENE header, is stroke opacity
  only);
- a `SCENE` `w` or `h` below 1 (the mod raises it to 1 without a report);
- where a label formats a number: both float and long routes are tried. Since 0.11.103,
  empty fmt and empty placeholder formats use the default. A literal that loses the number
  is reported when it has a letter or %+more; punctuation-only literals are silent. Thus
  x{{y, %q and {0:abc} are reported, while %% and ] alone are silent. Final 0.11.105
  escape scanning handles composite placeholders; the first colon outside an index splits
  the format (a later colon belongs to it), and %% collapses. Reports stay warnings;
- a group default written in another case than lower (`F=`, `SO=`, `S_=`) on a node with a
  block where it is only a default: a `G`, the header, or an op that does not read that key
  itself (`RP FO=`, an `L` with children): `ParseStyle` takes a default by its exact key, so it
  is not passed down. The panel reads and writes a default there by its exact key, and src
  keeps a later exact key after another spelling (`G F=#0f0 f=#f00` passes red down);
- strict strings retain their own readers. Since 0.11.102 free text and identifiers use
  invariant numeric text: text=100, id=5, symbol names/refs and font names work quoted or
  unquoted. Colour/enum/op slots are not blanket-coerced. Table booleans read as 1/0 in
  numeric attributes, data and arrays (including flags), with the shadow inset flag distinct;
- any node inside a clip path's shape, whose children the mod never parses and drops
  unreported (since 0.11.96 the mod reports a clip's further shapes and a `mask` without its
  `@`, and since 0.11.99 a def op in a clip, so none of these is a trap);
- a colour the mod takes but does not draw as written: one it reports (a paint or an outline
  colour that is not a colour, drawn magenta; a shadow or a stop colour that does not parse,
  dropped, since 0.11.96), including a colour where a numeric expression wants a number
  (reported since 0.11.102). These are warnings, never errors: nothing the mod accepts is refused;
- an enum word the mod does not know (reported since 0.11.102). Only authored keys
  receive literal-only, enum, opacity, event, radius and unit reports; inherited defaults
  are not authored values after a nodes patch (0.11.105);
- a key the op does not read, or an unknown key (which the mod reports with the magenta border:
  on a def since 0.11.94, on a clip's shape and the header since 0.11.96; `sd` and `sdo` are
  unknown since 0.11.96). On the header the host's own keys (`z_index`, `visible`, `parent_id`,
  `probe`, `visor_anchor_*`) pass unreported and do nothing in src: a key the op does not read;
- an id drawn twice in one scene (both nodes report the same clicks and hover; a symbol body
  counts as often as `USE` draws it), or two DEFS of one kind (gradient, clip, symbol) with one
  id (only one is used);
- a clip, a symbol, a mask or a gradient that `DEFS` does not declare (the mod reports it: the
  group draws unclipped, the `USE` nothing, the mask nothing, the shape magenta);
- with reads (M3): an unclamped sensor value driving a size, and a data colour that is not
  `#rrggbb[aa]`.

`%` by zero, `^` with no value (`0` since 0.11.98, as `/` and `%` answer) and `blur` on any shape
are not traps at the pin. A known upstream bug never gets
a trap warning (§3, Pin). `nofill` skips radial and blurred fills as well as labels
(since 0.11.105). REFERENCE:679 at the pin wrongly retained them; the author confirmed
the code and corrected the reference in an untagged commit batched with 0.11.113.

**Validation.** The builder has no depth limit of its own. Since vector 0.11.86/0.11.87 the
mod has no nesting limit (blocks, arrays, expressions and nodes all work at 100,000 levels),
so the builder's parse, print, validate, numbering and scene checks are iterative: explicit
stacks, no path kept per node. A cap that refuses legitimate input is a mitigation, not a
fix. Limits remain only for wrong input (a `SYM` cycle is refused) and for real external
limits (§6.4: the props tables handed to `ss.ui`). There is no builder instance/node
cardinality cap; charged work and the worker timeout protect responsiveness. The mod
reports an exhausted repeat work budget rather than clamping RP/LS/YS n to 20,000.
Scene checks run in a worker with a
timeout; the work budgets only protect UI responsiveness, and running out of budget or time
reports "too large to check here", never "invalid". Only the validator's budgets decide that:
a budget on a warning (the self-crossing test) leaves a warning that says what was not checked.
A scene too large to check here still lands, from the code pane, from both panels and from the
canvas's checked edits (paste, duplicate, group, ungroup, style paste) alike; its reason shows
as information, and the preview keeps the last scene it showed until the page checks again.
Ids and the bindings that are not expressions (`text=$name`, `{$name}`, a paint's `$name[i]`)
take any Unicode, supplementary-plane characters included (measured at 0.11.94); a name inside an
`=` expression or a `{=…}` placeholder is letters, digits and `_`, and since 0.11.98 any
supplementary-plane character too, a letter or not (until then it was reported and the default
used). The traps, the panel's data names and the colour-expression check read names so.

**Code pane.** CodeMirror 6 with a `src` language mode shows the active page:
`SCENE …`, then `DEFS { … }`, then the nodes.
- Canvas edits reprint the text in a canonical layout. `#` comments stay attached to the
  node that follows them.
- Text edits re-parse after a ~300 ms debounce and replace the page model on a valid parse.
  Errors show inline and the canvas keeps the last good model. Selection survives a parse: it
  keeps its tree path while the node there keeps its `id` (ids may repeat), else it follows the
  `id`, else the path.
- A widget instance prints as `# widget <type> <uid> <params JSON>` above `G id=<uid> { … }`.
  Parameters are edited in the property panel. A text edit that changes how the widget's
  subtree or its own `<uid>_` defs print (or its marker's params), or that stops the marker
  reading, detaches it into plain nodes, with undo; layout and comments above the marker never
  do. Pasted text keeps its widgets (the defs they lack are added; text whose body its params
  give but for its colour literals, in this theme or in another provided theme, stays a widget and is
  made again in this theme: a palette retuned since the text was written, or text from a project
  in another theme, is never detached; a text value, a label's `#404` too, is compared as
  written) unless its uid is used already: seen twice on the page,
  held by another page, or the stem of a plain id beside it (a detached copy). Such a widget is
  detached as a copy, and the notice says so rather than "edited by hand", which stays for real
  edits. A copy beside its widget gets copies of the `<uid>_` defs it points at, under
  `<uid>copy<k>_` (no widget uid has that stem), so editing, dragging or deleting the widget
  leaves both drawing; a def its page lacks (the root copied alone, to this page or another) is
  made from the copy's marker, a `theme_` gradient it paints with from the theme. A load re-associates every page the same way, page by page (uids are
  unique across the project), and makes every `theme_` gradient in the theme's colours, as a
  theme switch does. A widget moved
  into a group is detached and loses its marker; from E1 it stays a widget there. A detach pins
  the widget's samples as preview values, so its nodes keep drawing them. E1: a widget's part
  overrides print baked into its subtree and are recorded under `__edit` in its marker, so the
  comparison above includes them; an edit in the code pane that the marker does not reproduce
  still detaches the widget (with undo): overrides are made on the canvas and in the panels.
- Exporter rules (from the vector mod's author):
  - quote any value containing a space, `=` or `;`;
  - quote `$name[...]` (the parser reads it unquoted too since 0.11.93, outside an array, as the mod does; the
    printer still quotes it);
  - `w`/`h`/`fit`/`ztext` go on the `SCENE` line when `src` is used.

## 5. Widgets, themes, fonts, page shapes

### 5.1 Widgets

Widgets are generic helpers built from ordinary shapes. A widget's look comes from the theme,
never from per-widget options copied from particular consoles (owner, 2026-10-11): in E1 every
module paints through the theme's parts, lays out by the theme's metrics and draws each part
through the theme's anatomy, which may add shapes to it, replace its shape or remove it
(§5.2). The Panel's `look` (`well`/`hairline`) and corner `marks` options, taken from the
owner's console corpus, are removed (owner, 2026-10-12, audit priority 1: "exactly"); a theme
may draw such marks through its anatomy. Default texts are neutral
("Title", "Label", "Value", "Button"). The set below is the starting set; more widgets come
after 1.0 (owner, 2026-10-12).

Each widget is a TS module: params + theme tokens → plain nodes + per-instance defs + the data
keys it reads. Every clipped widget needs its own clip def (`<uid>_clip`), because clip
outlines are in scene coordinates; from E1 no module draws a clip (the Flow duct is rebuilt on
an animated dash), which lets widgets sit inside transformed groups.

| Group | Widgets (P0 unless marked) |
|---|---|
| Chrome / layout | Panel · Header bar · Page tabs / nav · Key–value table · Repeater (grid/list over an array) · Flow duct |
| Values | Text (caption, live value, rich template) · Readout tile (hero / KPI / compact) · Readout row · Bar (h / v / cells, marks, target) · Status light · Alert (chip + message) · Event log · Gauge (needle; E1) |
| Controls | Button (primary / secondary / danger / disabled / multi-state) · Toggle · Stepper · Option group |
| Icons / native | Vector glyph (cog, arrow, check, cross) · Item / gas icon (native) · Text input (native) |
| Generated | Devices page (M3: built by codegen from the widget modules, not a palette widget; its looks, shapes and dimensions come from the theme's parts, anatomy and metrics; an editable Devices page comes later, owner 2026-10-12, audit Q16) |
| After 1.0 | More widgets (owner, 2026-10-12); Tank, Trend chart / sparkline and Scroll list, the former P1 list, are candidates (its Dial is E1's Gauge) |

- **State.** Each widget has one state integer: 0 idle, 1 ok, 2 warn, 3 crit. Colours that
  follow it are colour expressions over it (`if`/`mix` of `#hex` colours, on `f`, `s` and
  `s_`), not data colours (`f="$x_c"`). A shadow colour cannot be an expression, so glows use
  per-state `v=` copies. When more than colour changes, the widget uses `v=` variant groups
  fed by snapped data. The state's colours, glows and chip words come from the theme.
- **Editing.** Selection snaps to a widget's root; inner nodes are edited after Detach.
  Widgets do not nest. Widget uids are unique across the project. E1 (owner, 2026-10-12: "a
  widget also needs to be editable"; instance overrides, the E1 plan's OQ1, which the owner
  answered "default"): every restylable node a module draws carries a semantic part name;
  entering a widget selects a part, and its paint, effects, position and size become overrides
  recorded in the marker (`__edit`), applied after each expansion, so parameter edits, theme
  switches, copies and loads keep them while untouched parts follow the theme; Reset part
  removes one; an override whose part the current parameters or theme do not draw is kept,
  listed and never applied elsewhere. Overrides never touch ids, events, clips, masks or text,
  so click ids and data names stay. A theme's ornaments are parts too, named
  `<part>~<ornament>`: their paint and visibility are overrides, and their place follows their
  part, which carries them when it is moved or resized. A part the theme removes keeps its
  overrides, and painting it brings it back on that instance. Adding, removing or replacing a
  widget's nodes on one instance still goes through Detach; a theme's anatomy does it for
  every instance. An ordinary group may hold widgets; a widget never holds another.
  Marks are named by position (`mark@<value>`, duplicate suffix `#2`, etc.) and Gauge
  ticks by their float32 sweep fraction (`tick@<fraction>`), using shortest decimals.
  A position no longer drawn stays dormant; legacy index names also stay dormant,
  never transferred to a different mark or tick (E1 ruling, 2026-10-12).
- **Text width.** Expressions cannot measure text, so widgets use fixed slots and
  right-aligned cells. Layouts never depend on string width. The slots, offsets and pitches
  are the theme's metrics (E1), so a theme with other type sizes keeps them right.
  A Repeater's row item keeps the value column when the value label would draw a
  value; otherwise its name uses that column and its gap, ending at the row's
  right padding, and the value label hides. One name label switches between the
  two widths through a clamped expression. The runtime derives a snapped 0/1
  `hasv` array after bindings and data normalization, for ordinary repeaters and
  the shared Devices row item. Numeric zero (including an out-of-range numeric
  slot, which the mod draws as zero) counts as a value; empty or missing string
  slots do not. A snapped `ready` signal arrives with the flags: unsent flags
  keep the original name width and value column. Both flags are runtime-owned,
  named from the widget uid: no renaming, binding or unbound-sample notice. A saved
  binding to either is reported as unused. The editor still samples both, hiding
  one row's numeric value with `hasv` so the value format works in the preview.
- **Data names.** A slot an expression reads takes a name of letters, digits and _, and since
  0.11.98 any supplementary-plane character (the mod's `ReadName`); a slot that labels alone
  read takes any name their binding reads back whole (`room kPa`), and its value may be a
  number or a string (the mod prints either). Any name is
  kept, `constructor` included. A Text declares every name its template reads. List items own
  their slots by a stable key (the Key–value table's rows), so a Remove moves no name.
- **Sizes.** A widget takes any size the mod draws. A height is held only where a
  `fit=ellipsis` label needs one line, 1.4 × its style's size, read from the theme.
- **Never empty.** A widget whose drawing all hides at rest (an Alert at state 0, an Event log
  with no entry, a Repeater at `n` 0) holds its box with an unpainted `R`, so a page of them
  draws no empty-scene marker.
- **Native icons: names only, no game images.** The Item / gas icon defaults to
  `Oxygen` and offers `gas`, `slot` and `prefab`. The generated catalogue ships
  names only; no game image, atlas or sprite is copied or bundled. The canvas and
  preview keep the existing placeholder: the icon's box and its chosen name.
  The panel offers catalogue keys through a datalist, plus known device prefab
  names for `prefab`. Unknown gas and slot names get a warning with a suggested
  key when known; the chosen value is kept. Prefab names are never warned about.
  A project load repairs old gas names `O2`, `N2`, `CH4`, `X` to `Oxygen`,
  `Nitrogen`, `Methane`, `Pollutant` and names each changed icon in its notice.
  At every declaration, including bound names, the runtime resolves
  `ss.ui.icons[icon_type][name]` when the table and entry exist and sets
  `icon_type` to the resolved value's prefix. A prefab entry such as GasOxygen
  therefore sends `gas:Oxygen` with type `gas`. An explicit `icon_type`
  overrides a qualified value's prefix; qualified values auto-detect their type
  only without that property. Raw unknown names retain the widget's explicit
  type; raw `Oxygen` with that type remains unmeasured in game. Empty parked
  names and bound names get no static-name catalogue warning. The preview host
  carries icon tables only when some page has an icon native.
  The guide also accepts any prefab name or numeric prefab hash as a string,
  optional `color_index`, and style `tint` (white by default); these add no widget
  parameters here. An icon with no name stays parked off the surface; its in-game
  behavior and the public build's availability of `ss.ui.icons` remain pending.
- **Gauge full turns.** A sweep with `|end - start| >= 360` draws a closed track from
  four quarter arcs in the sweep's direction. Needle and ticks keep the authored
  angles, including repeated turns (E1 ruling, 2026-10-12).
- **Import boundaries.** Shared tree access, comparison and style helpers live in
  leaf modules; value imports must not form a cycle (E1 ruling, 2026-10-12).

### 5.2 Themes

A theme is a complete design, not a palette (owner, 2026-10-12: the recoloured presets "only
took the colors"). From E1:

```ts
Theme { id, name, colors: Record<role|custom, "#rrggbb[aa]">,
        gradients: Record<name, [topRole, bottomRole]>,      // two stops, top to bottom, units=bbox; filled as @theme_<name>
        type: Record<style, { font, size, cspace, upper, ink, shadow?, weight? }>,   // font: a face name, or '' for the game's own; ink: a role
        geo: { space, radius, edge, size, floor, chip, heroUnit },          // design units
        shadows: Record<name, [dx, dy, blur, spread, roleOrHex, 'inset'?][]>,
        parts: Record<part, { fill?, stroke?, width?, radius?, outline?, shadow?, ink? }>,   // E1: how each widget part is painted
        metrics: Record<metric, number>,                    // E1: module slots, offsets and pitches, in design units
        stateWords: [ok, warn, crit], pressed, drawText,    // E1
        anatomy?: { v: 1, looks: Record<hook, { shape?, add? }> } }   // E1: shapes added to, replacing or removed from a part
```

A type style names its face (`faceOf(family, weight)`, §5.3), or `''`: the `font` attribute is
then left out and the game draws its own LiberationSans SDF (REFERENCE.md: a named face that
nothing registers is drawn in the game's font and reported), with `weight=bold` for emphasis
(synthetic, §5.3). Parts name paints (a role, a theme gradient, the widget's state colour, or
none), an outline width, a corner radius, where the outline sits (inside the box, centred, or
outside), a shadow and a label ink; parts never change a widget's shapes, the theme's anatomy
does (below). `widgetDefaults` (parameters only, never anatomy) arrives with the design-system
import (M5: only the parameters the player sets on the mapping screen, never a project's
page ids); `motion` waits for the first widget that animates by theme; no P0 widget does (no
blink).

When either switch-track fill is a gradient, the toggle draws an off track and an
on track whose fill and stroke opacity crossfade by the eased level. Both take the
switch shape; only the off track takes its ornaments. A translucent on paint shows
over the off track. Colour-only track fills retain their one mixed track (E1
ruling, 2026-10-12).

The hero unit baseline retains Vanilla +'s explicit `hero.unitY` 85.5. Neutral,
and a theme stating no baseline value, uses the font-line rule: centre each face's
`hhea` line in its box and align baselines. Neutral's result is 63.3609; the rule
would give 85.6 for Vanilla +. Neither comparison has been seen in game (E1
ruling, 2026-10-12).

**Anatomy** (E1; owner, 2026-10-12, E1 plan OQ2: "yes but not necesaly for my design we
decided at the beging users willbe abel to import design system/themes from claude design").
A theme may add shapes to a widget's part, replace a part's shape or remove it. It exists for
design systems imported in M5, which carry their own anatomy. It is built in E1 (the E1 plan's
placement, Tasks 21 and 22), where every module is rebuilt onto the theme contract, so the
import only maps onto it. Neither provided theme uses it, and the owner's own designs are not
made into themes.
- **Hooks.** Anatomy attaches to every paint part a widget draws, to each type style's labels
  (`text:<style>`), to the toggle's switch track and to the Vector glyph's box. A look keyed
  `<widget type>/<hook>` replaces the generic look for that widget only. Native widgets (item
  icon, text input) and raw shapes take none.
- **A look** has a `shape`: the part's rectangle or ellipse replaced by a rectangle with
  per-corner radii, an ellipse or a rectangle with 45° corner cuts, or `none`. It also has
  `add`: ornaments drawn under or over the part, painted from the theme's roles, gradients,
  shadows or the part's state colour. An ornament is a rectangle, an ellipse, a cut rectangle, a
  filled triangle or convex polygon, or a stroked polyline or polygon.
- **Placement.** Every edge or point is `[at, by]` on the part's box: its edge plus `at` × its
  size plus `by` units, CSS's `calc(at·100% + by px)`. So ornaments follow any part size, the
  rows of a repeat and a part override's move or resize.
- **The mod's rules hold.** A fill never crosses itself: rectangles, ellipses, corner cuts and
  triangles cannot, and a larger filled polygon is accepted only when it stays convex at any
  box size. Point lists are literal: a point-list shape on a part whose position is an
  expression sits in a `G t`, and one on a part whose size follows data (a Bar's fill, a KPI
  meter) is not offered. No paths, text, pictures, clips, masks or rotation.
- **Function stays.** A label keeps its text and is never removed or replaced; its ornaments
  draw before the first label in their sibling list, in label order and with their
  own label's visibility, remaining inside repeat/state scopes. A part that shows a
  value by its size or place (a fill, a meter, a target, a toggle's knob, a gauge's
  needle) may be replaced but never removed. A removed shape stays as
  an unpainted node, so its name, its overrides and the widget's structure hold.
- **Slot checks.** Under anatomy, “every slot key is read” judges the module's own
  drawing before dressing; “every data name read is a slot key” judges the dressed
  drawing. Removing a slot's only reader never removes its slot or binding (E1
  rule E2, 2026-10-12).
- **Anatomy is data.** Once imported it is outside input: one sanitizer reads it (known keys,
  null-prototype records, finite float32 numbers, the theme's own tokens) and names every item
  it drops; the dresser writes only keys each op reads.

- Every theme defines every required role, part and metric. The required roles are the 26 UI
  roles (surfaces, rows, well, borders, texts, accent, brand, statuses, danger and their
  on-colours); a missing one is an export error. Gas colours are not theme roles (below).
- Widgets reference tokens, never literal colours. Raw shapes may use literals, or (E1) keep a
  per-key link to a token in an own-line comment `# style <JSON>`: a named style or a theme
  swatch records it, a theme switch writes the new theme's value, a literal that no longer
  matches its token (a hand edit, in the panel or the code pane) drops that key's link, and a
  token the new theme lacks keeps the literal and the link and is reported. Detach style drops
  them all. New shapes take the theme's draw defaults, linked, unless the person chose a look
  with Use as default (per browser).
- Tokens resolve to literals when a widget is expanded: `src` holds literals only, and a gradient
  becomes a `theme_<name>` def.
- The provided themes are **Neutral** (the default) and **Vanilla +** (owner, 2026-10-12; E1).
  Dark steel, Slate, Light, Mobile dark and Mobile light, Vanilla + recoloured, are removed; no
  replacement palette is made. Another provided theme comes only as a complete design. A
  project naming a theme this build does not provide is drawn in the default theme, with a
  notice. Switching the project's theme in the editor re-expands every widget (its overrides
  kept), resolves linked raw-shape styles and moves pages on the old ground to the new one, in
  one undo step.

**Neutral** (E1) is the default: a plain, flat, dark design on the game's own font. No
gradients and no shadows; flat parts with thin outlines; Liberation Sans, bold for titles and
buttons; a 20-unit text floor. A console of widgets in Neutral needs no ScriptedScreens Fonts.
Its exact values are in the E1 plan, Task 3; the owner tunes them.

**Vanilla +** is the game's menu kit:
- Slate gradient ground.
- Sunk panels with an inset shadow.
- Raised gradient rows.
- A blue header banner with an orange outline.
- Outlines sit inside the box (the header's 3 px, the primary button's 2 px).
- Four statuses with glows.
- Gas fills (its own `gas-*` tokens; see Gas colours below).
- Barlow / Barlow Condensed.
- A 24-unit text floor; the hero unit is 64 px.

E1 moves Vanilla + into parts and metrics with its output unchanged byte for byte; the neutral
default texts, the removed Panel options, the rebuilt Flow duct and the cog's real hole are
separate, listed changes (E1 plan, Tasks 4–6). Its tokens are absolute design units
and never scale with the console. Its starter template is "Overview" (M4), with no fidelity
target to Vanilla +'s OverviewScreen (owner, 2026-10-12). M4's seven independent starter
projects follow both provided themes; the plain-shape Needle gauge follows E1's raw-shape
links and remains separate from E1's Gauge widget. The owner's consoles remain examples only.

Things in its README the vector layer cannot honour:
- video;
- tabular figures.

**Gas colours** are game facts shared by every theme, held once in
`web/src/catalog/gases.json` with their source: the game's gas icons, supplied by the owner on
2026-10-12 alongside the wiki's colour-coding table. The sixteen exact fills and symbol inks are
sampled from those icons, not the game's code tints (its nitrogen tint is cyan #00FFE4; the icon
fill is black). Liquids share their gas's colours; Steam shares Water's. Icon aliases resolve
through their atlas names. Split icons keep both halves in left/right order; a use that needs
one colour takes the left half. Mixtures (fuel, superfuel, breathable air, hydroponic air, high
temperature and dirty gas) are out of v1. Every provided theme exposes `gas.<Name>`, split-only
`gas.<Name>.2` and `gas.<Name>.ink` from the shared table in swatches and links; a
`{ gas: 'Oxygen' }` style link keeps its value across theme switches. A theme may restyle how
the colours are used, never their identities. Vanilla +'s existing `gas-*` tokens stay unchanged
as its own design palette, neither required UI roles nor game facts. E1 Task 19 is settled by
icon catalogue plan §6; the split and single-colour defaults may be overturned by the owner.

**Design-system import.** Sources:
- the claude.ai **Design System** artifact format: `project/tokens.json` v3 (colour themes
  with flat token lists, `{alias}`; `type.fonts/families/groups/styles`; `spacing`, `radius`,
  `shadow`, `size` lists), plus `README.md` and `components/<Name>/README.md`;
- the older Claude Design `_ds` bundle (`tokens/*.css` custom properties plus the
  `_ds_bundle.js` component header).

Mapping:
- colours, with aliases resolved and `rgba()` turned into `#rrggbbaa`;
- type styles, with family + weight mapped to ScriptedScreens Fonts names (§5.3);
- spacing / radius / size → `geo` and `metrics`;
- box-shadow strings → vector `sh` lists (inset or outset; glows);
- component styles → `parts` (paint), component names → `widgetDefaults` (parameters only);
- component anatomy → `anatomy` looks on the matching hook, through E1's sanitizer. A border on
  one side, or a positioned decoration (`::before`, `::after`, an absolutely placed element such
  as a corner mark), becomes an ornament whose edges are its CSS `left`, `right`, `top`,
  `bottom`, `width` and `height` as `[at, by]`. Per-corner radii and a polygon `clip-path` of
  45° corner cuts replace the part's shape; a hidden element removes it; a rotated square
  becomes its turned points. What the vocabulary cannot draw is listed on the mapping screen.

A role-mapping screen auto-matches tokens to builder roles. The player confirms, and
unmatched tokens remain usable as custom tokens.

As built (M5, 2026-10-12): a role takes the token of its exact name, else a synonym's; a type
style takes the design system's style of its name or a synonym, and a CSS type rule only by
the style's own name; a part takes a rule whose class equals or ends with its words or their
synonyms, and a bar's or progress's fill is the track's child whatever its element. Border
and outline longhands and an implicit `currentcolor` are listed as unrepresented, never
dropped in silence. A design-system token whose name a builder role also uses keeps its value
under a new name, reported. An imported theme's display name differs from every provided
theme's. Every value carries its source: a token, a CSS rule, the base theme or the player.

An imported theme lives in the project that uses it, so a link, a JSON file or an exported
script's embedded block reopens anywhere with the same look, and in a per-browser list of
imported themes that another project can use without importing it again (owner, 2026-10-12,
M5 plan OQ1). The worked example is the owner's Vanilla + design system: its `tokens.json`
and `components/bundle.css` are committed unchanged as the importer's test fixture (owner,
2026-10-12, OQ3).

How a design system gets in:
1. **Paste the link.** The builder first tries a direct fetch, which will work if claude.ai
   ever serves those files with CORS. Today it cannot:
   - the share page's data needs sign-in;
   - the files at `<uuid>.frame.claudeusercontent.com/_f/<version>/project/…` are publicly
     readable but carry no CORS header;
   - resolving a share id to its artifact id and version needs a claude.ai API behind a
     bot challenge.
   The builder never works around that challenge.
2. **Drop the design-system folder or zip, or paste `tokens.json`.**
3. **Fallback:** a ready-made prompt the player pastes into Claude, which reads the design
   system and returns a theme file to drop in.

### 5.3 Fonts

- **Game defaults.** ScriptedScreens Fonts 0.3.0.0 supplies exactly 36 faces: Barlow and
  Barlow Condensed, each with nine upright weights and the italic of every weight
  (source-verified 2026-10-11). Neither Manrope nor Inter is supplied. Liberation Sans
  remains the preview's base fallback. The vector T game default is LiberationSans SDF with
  the measured synthetic styles below, including when the Fonts mod is available.
- **Exact names.** Each field uses typographic ID16/17, falling back independently to
  legacy ID1/2; ID4 and CSS family/weight are not naming authorities. Empty or
  case-insensitive Regular style registers Family; otherwise Family Style verbatim.
  For each of Barlow and Barlow Condensed the upright names are the bare family, then
  family plus Thin, ExtraLight, Light, Medium, SemiBold, Bold, ExtraBold or Black. Every
  italic adds ` Italic`, including the regular `Barlow Italic` and `Barlow Condensed Italic`.
- **Slots and italics.** Slots derive from style, never usWeightClass: remove ITALIC
  while recording italic, uppercase and discard nonletters. Thin/Hairline 1,
  ExtraLight/UltraLight 2, Light 3, empty/Regular 4, Medium 5, SemiBold/DemiBold 6,
  Bold 7, ExtraBold/UltraBold 8, Black/Heavy 9; unknown styles 0, reachable by exact
  name. Oblique remains verbatim and is not implicitly italic. Only `<b>` (slot 7)
  and `<font-weight=N>` (integer N/100) move the weight slot, initially 4. A face
  name chooses glyphs, not a slot. An italic request uses the slot's real italic face
  as is, with no shear or faux bold. With no italic face, shear the upright current
  glyph, weight unchanged. Bold plus italic uses Bold Italic when available; otherwise
  retain the current glyph (not the Bold face), add faux bold and shear. Bold alone
  with no real slot adds faux bold only. Barlow Bold plus `<i>` therefore draws
  Barlow Italic; Barlow plus `<b><i>` draws Barlow Bold Italic. LiberationSans SDF,
  the vector T default, has no linked weight or italic faces: both styles are synthetic.
- **Per-face TMP metrics.** The vector default and Fonts-mod faces have italicStyle 35
  (shear factor 0.35), boldStyle 0.75 and boldSpacing 7. The default has gradientScale 10
  and sampling point size 86; Fonts-mod files, including player imports, use 6 and 48.
  Faux bold offsets each contour outward by (boldStyle/4) × (gradientScale-1)/pointSize
  em: about 0.0196 for the default and 0.0195 for Fonts-mod faces. The DOM uses twice
  that stroke width with stroke painted before fill, and adds 0.07 × base size per
  character to spacing. Dilation follows the current text size; spacing follows the
  base size even inside a size tag. Browser font synthesis is disabled. Synthetic
  italics use an explicit run transform, with unchanged advances; `<i=angle>` sets
  factor angle/100 clamped to ±180. Real italic faces ignore the synthetic shear.
  Ink bounds use that same transform. One per-face table holds these values. Native
  ScriptedScreens labels retain their separate font_english calibration; its 0.20 shear
  is not a vector T default.
- **Sizes and spacing.** Absolute `<size=n>` or `<size=npx>` uses n label units.
  Relative +n/-n means base size ±n; nem means base ×n; n% means base ×n/100.
  Nesting never compounds; closing size restores the prior value. TMP decides the unit
  by the character ending the number: e for em, % for percent, p/space/end for px.
  The T attribute `cspace` adds cspace/100 × base size per character. The tag
  `<cspace=n>` or npx adds n scene units; nem adds n × current size; percentage
  cspace is rejected and displayed literally. Closing cspace removes its last
  character's trailing tag gap. Nested style closers restore previous styles; malformed
  weight/italic values are ignored, br becomes a newline, and other unimplemented
  styling tags are stripped.
- **Outline padding and faux bold.** The preview mirrors the author's shipped vector
  0.11.113 `TextOutline.cs` formula, seen in game; the vendored core pin remains
  0.11.118. The preview draws the outline itself. Per face, `gs` is gradient scale,
  `pointSize` is sampling point size, and `other = max(WeightNormal, WeightBold)/4
  + FaceDilate + OutlineSoftness`: 0.1875 for both calibrations (weights 0 and 0.75,
  dilate and softness 0). With label base `size >= 1`, `target = ow*pointSize/(2*size)`
  atlas px. Set `W = target/(gs-1)` when `target <= (gs-1)*(1-other)`;
  otherwise `W = target*other/(gs-1-target)` when `target < gs-1`; otherwise `W = 1`.
  Clamp any W above 1. TMP's outward reach is `W*(gs-1)/max(1,other+W)` atlas px,
  with the same inward reach; one atlas px is `size/pointSize` scene units.
  `ScaleRatioA = (gs-1)/(gs*max(1,other+W))`. Multiply the no-outline faux-bold
  offset by `ScaleRatioA/((gs-1)/gs)`; the contour offset is thus
  `(boldStyle/4)*gs*ScaleRatioA/pointSize` em. Spacing remains 0.07 times base size.
  Up to W = 0.8125 the centred stroke retains total width ow, and bold is unchanged:
  the knee is ow 14.625 at size 86 for LiberationSans, 8.125 at size 48 for Fonts-mod
  faces. Past the knee bold shrinks. When W clamps, draw twice the capped outward
  reach as the stroke and report on the label: “the outline is reduced to N%”, where
  `N = 100*Outward(1)/target` (preview displays one decimal). Clamping can occur before
  target reaches gs-1; the maximum widths at those sizes are 288/19 and 160/19 scene
  units respectively. Font-tag runs use their own face calibration and the label base size.
- **Open font gaps.** Run-centred italic preserves
  shaping but differs from TMP's individual glyph-centred quads: at 100 px in Liberation
  Sans, Hello's pivot offsets produce horizontal differences of 0 px (H), 0.525 px (l)
  and -2.8 px (e/o), measured in Chrome. A glyph renderer is needed for exact pivots.
  Shrink fit still uses requested Size in the preview; the game auto-sizes, so its
  shrunk base-size spacing remains unimplemented. Missing-glyph fallback and font
  baselines remain browser approximations.
- **Characters and layout.** Every glyph in the file draws. A codepoint missing from the
  face uses TMP's global fallback, represented by the browser's own font fallback;
  no glyph-limit check or warning. The former printable ASCII, Latin-1 and 81-symbol
  limit is superseded. GPOS kerning is on by default (`kern=0` explicitly disables it).
  Production text uses browser shaping and layout, never a sum of glyph advances.
  Letter spacing follows the base-size and tag rules above.
- **Bundled preview.** All 36 faces above are self-hosted OFL `.woff2` files, alongside
  Liberation Sans regular, with each project's `OFL.txt`. Registered through
  FontFace without calling load: the browser fetches only faces used by text. No
  third-party request for bundled faces. Explicit page requests follow the policy below.
  The source is the official Google Fonts OFL release:
  [Barlow](https://github.com/google/fonts/tree/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/barlow) and
  [Barlow Condensed](https://github.com/google/fonts/tree/bd8f81ddb5c74d5c8897b36ad88b440266245103/ofl/barlowcondensed).
  FontTools WOFF2 conversion retains every source cmap entry and GPOS table; no subsetting.
- **Page declarations.** Direct scene.defs may contain ordinary FONT src="…" nodes;
  there is no Page.fonts list or project migration. Op/key reads are case-insensitive;
  src alone is a strict non-empty string (numeric, missing or empty reports
  "FONT: src needs a non-empty string URL"). No id/style keys are supported, and
  root/child FONT reports unsupported. Whitespace-only strings are preserved by
  grammar but refused by preview policy, like malformed or blocked links. Exact
  duplicate strings request once in declaration order; alternate spellings are not merged.
- **Explicit consent.** The prototype Fonts panel separates this page's links from local
  preview files. Add of a complete link consents for that link; Load this page's fonts/Retry
  requests the active page's declarations, with a clear Google notice. Opening/importing/
  sharing, selecting an example or page, quiet code parsing, undo/redo, source reapply,
  layout changes and Copy/Download never grant consent. Saved project approval is ignored;
  no automatic opt-in preference is added. Add/Remove each uses normal history; imported
  duplicate declarations remain intact and Remove targets the declaration index. Registry
  conflict/subset notices belong to a link generation and expire on cancellation or removal
  of its final project declaration. Local stored-record notices belong to the imported name
  and expire on removal/replacement. Project replacement clears notices and late observers
  while retaining session-cached faces; late stored reads cannot revive cleared notices.
  A removed/superseded local import reports that cause, never a storage failure.
- **Network policy.** Preview CSS is HTTPS on exact fonts.googleapis.com, assets HTTPS
  on exact fonts.gstatic.com, with credentials omitted, no referrer, CORS and redirect:error.
  Credentials, non-default ports, scheme-relative URLs, other/deceptive hosts and private
  addresses are refused before fetch; project allowlists are ignored. Downloaded CSS is
  parsed inertly, never attached; selectors, @import, local() and HTML never execute.
  Each src uses the first supported allowed candidate; all assets are checked. Native lazy
  loads use the narrow font-src CSP and no-referrer boundary; off-host redirect enforcement
  requires browser verification. Direct font-file src remains unsupported here, with cause,
  readable fallback and unchanged export. In game, owner-supplied 0.4.0 facts are HTTPS only
  (also inside CSS), redirects refused as download-failed, both Google hosts and subdomains
  allowed, direct TTF/OTF accepted and WOFF2 failing. The exact-host preview is narrower.
- **Names and lazy subsets.** Variable aliases are named fvar instances whose wght lies
  in the CSS rule's inclusive normalized range and whose ital/slnt match its style; axes
  the group does not select (including wdth) must equal their metadata defaults. Single
  weights select exactly that instance. Static files use their metadata pair. Metadata comes
  from one representative per CSS family/style/weight group and is cached by exact URL;
  remaining validated Unicode subsets register lazily with display:swap. Aliases carry a
  fixed single instance weight descriptor and explicit axes. Page and local faces use
  isolated browser family names, so CSS lookup cannot bypass registry precedence;
  authored names remain their lookup/display identity. These mechanisms are implemented
  and covered by registry tests; the Chrome registration results below do not measure
  selected glyph axes or compare width/ink. No matching instance or a metadata name
  mismatch fails the link with its cause, rather than guessing a CSS-derived face name.
  Served-file inspection of 151 files found matching browser-variable and game-static names
  for Orbitron (six for 400..900; two for 400;700) and Roboto (nine for 100..900), but not
  Noto Sans JP: raw browser "Noto Sans JP Thin"/"Noto Sans JP Thin Bold" versus game TTF
  "Noto Sans JP"/"Noto Sans JP Bold". A follow-up of eight variable families (24 native-read
  representatives/static files at 400;700) verifies a metadata-only derivation in all eight,
  including six with non-Regular defaults. ID16 remains authoritative. Without ID16, obtain
  the default style from ID17, else the instance matching every axis default, else ID2.
  If that style is non-Regular or default wght is not 400, ID1 must end with a space plus
  that exact non-Regular style; remove it only if a nonempty family remains. Otherwise
  refuse naming with a cause, readable fallback and unchanged export. Regular defaults,
  static files and local imports keep their metadata family. All twelve recorded requested
  ranges match after derivation, including Noto Sans JP; no family or CSS name is guessed.
  These are twelve comparisons across eleven distinct families: Orbitron (two requests),
  Roboto, Noto Sans JP/SC/TC/KR, Noto Serif JP/SC, Montserrat, Oswald and Open Sans.
  Their sampled 400/700 names match the static TTF names read by the game. The six
  non-Regular defaults are in the eight-family follow-up; the original Noto Sans JP
  profile exercises the same derivation. Binary inspection does not establish glyph axes.
  Supplied Chrome checks on the integrated build observed no Google request on opening
  example 19. Load fetched CSS and one representative, registering Orbitron and Orbitron
  Bold for 400;700 in 407 ms; 400..900 registered six aliases, Roboto 100..900 nine.
  Noto Sans JP 400;700 registered its two correct names from one representative of 124
  files in 5.7 s. An off-host font URL was blocked by page CSP before any network entry.
  These are registration/transport observations, not an exhaustive subset/glyph comparison.
- **Metadata isolation.** One async reader handles local SFNT/TTF/OTF/collections and
  WOFF2 names/fvar, with bounds/encoding/overflow checks and streamed Brotli skipping
  unused tables. It runs in a separate worker/runtime, never the chip queue or instance.
  Startup has a separate 60-second allowance; the existing 5-second read watchdog starts
  only after the runtime signals ready. A ready worker is reused. The loader passes its
  AbortSignal to the reader; removed-link/project cancellation reaches queued or active
  metadata work and late replies cannot register faces. The real 512-MB wasm heap and
  these time budgets are external limits, not font validity caps. Structured invalid/failed/
  read-budget outcomes preserve
  chip state; timeout/fatal failure terminates that worker, late replies cannot affect a
  departed link/project, and a later explicit job recreates it. Locale preference remains
  provisional: Windows English, supported Unicode/Windows, then Mac; per-field name
  fallback is settled. Supplied browser measurements observed boot at 120–211 ms in
  development and 79–89 ms in production, with reads of 62.7 ms then 2.6 ms. Those
  samples do not establish peak memory or browser fault-isolation behavior.
- **Precedence and local files.** Player local files > mod bundled faces > earlier usable
  page downloads > fresh requests: the settled Fonts-mod 0.4.0 order. Replacing or
  removing local files reveals the next usable face;
  conflicting page names reuse the first usable session entry, while Unicode subsets of
  one face coexist. Removing a link retains usable session faces and never deletes local
  bytes. Local and page entries carry Fonts-mod calibration. Local .woff2/.ttf/.otf bytes
  are browser-only IndexedDB data, never uploaded or put in projects. The suggested
  metadata name is editable; typed names control lookup/display only, not family/slot/italic.
  A late suggestion cannot overwrite an edited name or another file. Metadata-unavailable
  manual imports may use slot 0 after browser validation with a preview warning; page
  aliases require metadata. Corrupt persisted records are skipped with a visible cause.
- **States and diagnostics.** Pending, loaded (aliases known, subsets lazy), refused or
  failed carry exact cause/names; a later subset failure names its URL and keeps other
  usable faces. Pending/loaded attempts deduplicate. Failed/refused links retry only on
  another explicit Add/Load/Retry after 60 seconds; no timer fetches. Delivered names
  deduplicate in link/face order. With declarations but no load, the preview asks to Load
  this page's fonts and uses fallback; pending says fallback until arrival; settled mismatch
  lists delivered names or none and causes. Unknown ordinary font= falls back in game
  and reports (since 0.11.102); unknown inline font tags retain measured literal-tag behavior.
  Registry/status changes refresh datalists, diagnostics, layout, covers and picking without
  chip reloads or new requests. Export remains model/declaration-only (§8).
- **Requirements and counts.** Any FONT requires ScriptedScreens Fonts, even without
  font=. Page downloads use FontApi.RequestFontWithReason (since 0.3.0); late registry
  arrivals use FontApi.Registrations (since 0.4.0). The deterministic export line names
  each capability and its introduction version; availability depends on the installed build.
  Owner-supplied 0.4.0 is unpublished; only 0.2.0 is a confirmed Workshop publish.
  The 0.3.0.0 inventory proves the bundled faces, not Workshop publication. The 48-face
  request cap dates from 0.3.0 and refuses before download since 0.4.0. It counts faces
  built by requests per session: cached faces cost nothing, a name clash counts, failed and
  disabled requests do not. The distinct-link limit is 48 per process, shared with other
  pages/projects/consoles; preview counts never claim remaining allowance (§8).

A design system's own font files (M5) enter this browser only on the mapping screen's
explicit **Use the design system's font files in this browser**: only the faces the mapping
needs, at the weights each file serves; a face the player already has locally is kept, with a
note. The bytes never enter a project, and the import never requests a font.

### 5.4 Page shapes

Page settings in the inspector's Design → Page section include the background: a colour,
a vertical two-colour gradient, or No background. New pages keep their theme's ground.
Choosing No background sets background to undefined in one undo step; setting a colour
again assigns one. Save/load and theme switches preserve absence. The owner states
"console without a bg assigned have NO background" (2026-10-13): an absent background
exports no native bg panel and previews as the checkerboard wherever the scene leaves it
transparent. The Devices page inherits the first page's background, including none. Assigned
backgrounds retain their colour/gradient values. No legacy #0A121C background is invented.

Page shape = proportions of the real surface:

| Surface | Preview px | Design units | Size read from |
|---|---|---|---|
| square | 460×460 | 480×480 | game: 460×460 (Console) |
| 2×1 | 1036×460 (2.25:1) | 1080×480 | game: 1035.69983×460 (Console 2x1, Console Dual 2x1) |
| monitor | 943×460 (≈2.05:1) | 984×480 | game: 943.3719×460 (Console Monitor 2x1) |
| vertical 2×1 | 460×1036 | 480×1080 | game: 460×1035.69983 (Console 2x1, Console Dual 2x1, each placed turned); 2026-10-12: a standard landscape 2×1 rotated in the world renders portrait at 460×1036 |
| vertical monitor | 460×943 | 480×984 | prefab (the 2×1 monitor's), turned |
| Air Conditioner face | 319×273 (≈1.17:1, beta) | 561×480 | not read on 2026-10-06 (no AC chip in the test world) |
| 2×2 (LargeConsoleMod) | 460×460 | 960×960 | game: 460×460 (Console 2x2) |
| 2×2 (MoreConsoles) | 456×460 | 952×960 | prefab: Rugged 456.3115, Bulkhead 456.2688 |
| 3×2 (MoreConsoles) | 714×460 | 1490×960 | prefab: 713.864 (Console 3x2, Console Dual 3x2); its vertical read in game |
| vertical 3×2 (MoreConsoles) | 460×714 | 960×1490 | game: 460×713.864 (Console 3x2 placed turned) |
| 3×2 Panel (MoreConsoles) | 713×460 | 1488×960 | game: 713.3855×460 (Console Panel 3x2, Console Panel Dual 3x2) |
| 3×2 Rugged (MoreConsoles) | 720×460 | 1503×960 | prefab: 719.7708 |
| 3×2 Bulkhead (MoreConsoles) | 723×460 | 1509×960 | prefab: 722.781 |
| 3×3 (LargeConsoleMod) | 460×460 | 1440×1440 | game: 460×460 (Console 3x3) |
| 3×3 (MoreConsoles) | 458×460 | 1434×1440 | prefab: Rugged 457.65472, Bulkhead 457.63754 |
| Monitor 2×2 Rugged (MoreConsoles) | 435×460 | 908×960 | prefab: 434.7484 |
| Monitor 2×2 Bulkhead (MoreConsoles) | 433×460 | 904×960 | prefab: 433.22696 |
| Monitor 3×2 (MoreConsoles) | 684×460 | 1427×960 | game: 684.330139×460 (Console Monitor 3x2, Console Panel Monitor 3x2) |
| Monitor 3×2 Rugged or Bulkhead (MoreConsoles) | 686×460 | 1432×960 | prefab: Rugged 685.75793, Bulkhead 686.2801 |
| Monitor 3×3 Rugged (MoreConsoles) | 444×460 | 1390×1440 | prefab: 443.66302 |
| Monitor 3×3 Bulkhead (MoreConsoles) | 443×460 | 1387×1440 | prefab: 442.7284 |
| vertical 2×2, 3×2 Panel, 3×2 Rugged, 3×2 Bulkhead, 3×3 (MoreConsoles) | the flat one's, turned | the flat one's, turned | prefab, turned |
| vertical monitors 2×2, 3×2, 3×3 (each of the six, MoreConsoles) | the flat one's, turned | the flat one's, turned | prefab, turned |
| custom | any | 480 on the shorter side | |

- The viewbox is in design units. **480 per cell height is a reference unit, not a
  resolution**, so a 2×1 page is 1080×480 units, a MoreConsoles 3×3 page 1434×1440 and a
  LargeConsoleMod 3×3 page 1440×1440. A cell is the
  console's own: a vertical page is its console turned, so 480 per cell is its width. The
  other side keeps the px aspect (rounded; the 2×1's 1080 is its nominal 2.25:1).
- "game" in the table is a size read in game on 2026-10-06: each chip's `ui:size()`, as the
  rect its script builds from `ui:size()` and the game MCP's `list_chips` both report
  it. `ui:size()` gives the fraction (1035.69983 for the 2×1); a page's px are whole, so each is
  rounded to the nearest (owner, 2026-10-06: whole px, not the fraction). "prefab" is the console canvas's size in a MoreConsoles prefab
  (`ModConsole.ScreenSize`, which the mod builds from the bezel opening at a canvas height of
  460), where every size read in game agrees with it. Plain and Dual consoles share a surface; a
  style whose rounded size differs has its own shape, and the picker lists every distinct size
  rather than one entry per footprint and kind, since the real surfaces differ (owner, 2026-10-06).
- A vertical page is the console placed a quarter turn round: the game turns the screen
  upright and `ModConsole` swaps its rect. Every MoreConsoles console, monitors included, is
  face-mounted (`PlacementType` 2) with `ModConsole`, so each one that is not square has a
  vertical shape; the swap is read in game for the 2×1, Dual 2×1 and 3×2, not yet on a monitor.
  Measured again on 2026-10-12: a standard landscape 2×1 console (the same prefab as the
  others) rotated in the world renders its screen portrait, at 460×1036, so the builder's
  vertical 2×1 shape matches it; that size is the owner's mod's own.
- The 2×2 and 3×3 consoles of the Steam Workshop mod LargeConsoleMod are their own shapes:
  their surfaces are 460×460, not the MoreConsoles sizes. A square surface turned is itself, so
  they have no vertical shape.
- The console's own resolution rises as the player gets closer, and vector geometry is
  rebuilt at the pixels actually on screen, so a design never pixelates. Groups can be
  scaled with `s` (e.g. a zoomed inset or detail view) without loss.
- The export calls `ui:set_resolution(0,0)` first (an override survives a re-push), reads
  `ui:size()` only to give the element a rect covering the surface, and maps the viewbox
  with `fit=contain`.
- The size check uses the theme's floor in design units. It is a readability-at-distance
  rule each theme sets for itself (Vanilla +: 24, readable at 25–50 % of drawn size; Neutral:
  20, from E1), never a pixel limit.

## 6. Data, devices, actions, pages, generated Lua

### 6.1 Roles and reads

- **Role.** A role is a slot such as "O2 tank": a prefab set, an optional default Labeller
  name, and `one` or `all`.
  - Resolved in game by scanning `ic.device.list()` on prefab hash (+ label); a labelled role
    the list does not show is looked up with `ic.find(label)` and taken when its prefab is one
    of the role's. Beta `ic.find_prefab` is not used.
  - Advanced: pin d0–d5, or a fixed refId. In the editor (owner's choice, 2026-10-12), the role's ref field moves behind a collapsed "Advanced" disclosure labelled "Pin to one specific device", the only place the id shows, and saved projects keep their value; the simulated-devices panel's "ref N" and the write log's "ref N:" become device names.
  - Picking a device from the game (M6, owner, 2026-10-12: "exatky"): with the game connected,
    "Pick a device" lists the linked chip's network devices (§8, the game link) by name with
    the prefab's name, and a pick writes the device's prefab into `prefabs` and its Labeller name
    into `label`, never its ref: a device's ref id changes when the device is rebuilt (the owner:
    "never with id as those change on device rebuild"). With no game connected, "Pin to one
    specific device" stays the fallback. Built and launched 2026-10-13: with nothing linked, the
    picker lists the devices of every network the game reaches.
  - Optional: the console runs without the role (it never opens the Devices page first, and
    its row reads "not present").
  - Distinct (`distinct: true`, 2026-10-12; it acts on `one` roles): the role never takes a
    device another distinct role holds by its pick, saved choice, label, pin or ref; a device
    two distinct roles reach the same way goes to neither; the Devices page's tap-to-pick
    skips a device another distinct role holds. Roles without it resolve as before. The
    Airlock starter's two door roles are distinct, so one airlock on the network never binds
    both.
  - Resolution scans the device list at boot, every 20 ticks, every 4 while a `one` role that
    is not optional is unresolved, every tick on the Devices page and on RESCAN. A `one` role
    takes, in order: the player's pick, the saved ref, the saved label, the saved name hash,
    the device whose Labeller name is the role's label, the only candidate (for a distinct
    role, unless another distinct role holds it). A label or name
    hash counts only when exactly one candidate has it, and an empty label or a zero name hash
    is never stored: several unlabelled candidates, or two sharing a label, leave the role
    unresolved (never picked at random), and the Devices page warns about a pick no label
    tells apart. An `all` role takes every candidate, or every one with its label. `R.<id>`
    gives a role's count, refs and device display names (a Labeller name, else the prefab's
    default display name, measured P4 on 2026-10-11).
- **Devices page.** A generated page that lists candidates on the network for each role and
  lets the player pick. Its appearance is the console author's concern; the builder does
  not force layouts on it. Fixtures and examples are examples built for a larger console:
  an example's appearance on another console is never a defect (owner, 2026-10-11).
  - No player-visible text shows a chip, device or network reference id (owner, 2026-10-12:
    "those are never in any way visible to the player"). A row names its device only, e.g.
    "Gas Sensor" or "Tank (2 share this label)"; a pinned role shows its pin; ids stay
    internal.
  - The choice is saved with `ic.persist` and mirrored into chip memory. Both survive
    identical and changed source pushes, including writes from a halted run (P5, P5c, P6,
    measured 2026-10-11); the mirror remains a second store. SAVE of explicit auto clears
    the saved pick; the row cycles the resolved candidate through auto before picking it again.
  - Booting reads the saved choice; only a press writes it. A store present but unreadable at
    boot turns its writes off for the session, so one unreadable boot never overwrites a choice
    with defaults.
  - A row cycles candidates through auto. From a sole automatically resolved candidate,
    first tap selects explicit auto; two consecutive taps without SAVE select the candidate.
    SAVE of auto clears the saved choice and resets the transient pick, so the next tap
    selects auto again (checked 2026-10-11).
  - SAVE keeps a role's saved pick while no device of the role is on the network: an absent
    device offers nothing to replace it with. Boot opens the Devices page first whenever a
    required `one` role is unresolved, whatever else was saved (a saved state or another
    role's pick does not suppress it).
- **Read.** `{ role, logicType | slot(index, LogicSlotType), aggregate (sum|avg|min|max|list
  for 'all' roles), transforms }` → one data key.
  - Transforms, in this order: a valid range (a raw value outside it is no reading), aggregate
    (sum, avg, min, max over an `all` role's devices; list gives one value per device), unit
    (K→°C, K→°F, kPa→MPa, kPa→atm, W→kW, W→MW, J→kJ, J→MJ, ratio→%), scale/offset, clamp,
    exponential smoothing (a time constant in seconds), a derived Lua expression over `x`,
    thresholds (warn and crit edges below and above, hysteresis, and an optional log line on
    each change) → 0 missing, 1 ok, 2 warn, 3 crit; history N, one value per N ticks, bindable.
  - The LogicType picker covers the full game enum plus numeric extension ids.
- **Simulated values** live on the simulated devices (§7), because the preview runs the export,
  which reads through `ic.*`; the Logic panel shows a read's simulated source as the value of
  its role's first simulated device. A binding may also be a constant, which the export carries.

### 6.2 State, actions, rules

- **State.** `S.*` variables (number, bool, enum, string), each with an optional range and
  saved on press.
- **Action.** `{ on: nodeId | native uid, page?, when?: guard, do: Step[] }`,
  `Step = page | set(state, expr) | toggle | cycle | step(by, min, max) | command(flag) | log(expr, level) | call(fn)`.
  An action with a page acts only on that page's node (raw ids are unique per scene only); one
  without acts on every page that holds the id. A `press=1` plate acts on `down:<id>` only.
  Clicks inside a repeat arrive as `id:i` (`E.i`). `command` sets `C.<flag>` for one tick;
  `call` runs `U.<fn>(E)` from the custom block.
- **Latched rules.** `{ role, logicType, value: expr }`: per resolved device, a rule writes when
  its value is not nil and differs from the read-back; a pulse rule writes when its value
  differs from its own value on the previous tick (set for a write-only type, and by choice on
  any type that must be re-sent on a command); nil holds; `skipBoot` takes the first value as a
  baseline. A button sets state and a rule drives the device. Seven of the twelve surveyed
  console scripts write devices, each using this pattern.

### 6.3 Pages

- One page = one surface, with a vector scene emitted as a literal `src` string only when
  it has nodes or direct FONT definitions (literal text is cheap for the instruction budget).
  A blank page exports no vector scene or data carriers, with or without native widgets,
  so it shows nothing in the game or preview; with No background the preview shows only
  the checkerboard. Adding the first node creates the scene through one preview reload
  or a re-push; later scene edits patch. Removing the last node and FONT definition reloads
  without a scene. Scenes with nodes retain the mod's problem and drew-nothing markers.
- The start page is built at load; every other page on its first visit, inside a tick, its
  declaration carrying that tick's data; then switched with `ss.ui.activate`. A page is never
  built and rendered in one execution.
- Visual states inside a page use `v=` groups fed by snapped data. Every changed data
  payload rebuilds once; snap prevents the subsequent glide, not that initial rebuild.
- Each tick sends only the active page's data keys:
  - a `snap=1, keep=1` data element for histories, states, flags, counts and text;
  - an eased data element for numbers that drive geometry (the Toggle's switch look eases its
    `on` flag).
  Generated carrier membership is explicit: added counters/text/history from hooks snap;
  arrays of moving Bar levels may ease, but history bindings always snap. Raw easing
  applies only to names read by geometry, not labels or paints alone. A numeric binding
  that becomes text snaps. Known normalized Bar/switch geometry suppresses changes below
  half a surface pixel, using a conservative travel bound and the page's actual fit scale.
  Compare with the last sent value, so slow drift accumulates. Bars with automatic colour
  thresholds and arbitrary raw expressions only suppress equal float32 inputs: their
  discontinuities/amplification have no safe geometric deadband. A shared label snaps;
  an additional raw reader or extra widget-root attributes remove the normalized travel bound.
  A name both a snapped and an eased slot read is sent snapped: `snap` persists on an element,
  so one name cannot ride both. A name with no value sends its slot kind's default (state,
  flag, count 0; text "--"; a list kind a one-item list); a number keeps its last value; an
  empty Lua table is never sent.
- Exports keep one surface per page. In-game rendering and its cost, hidden surfaces included,
  are the vector mod's to measure and handle, not the builder's (owner, 2026-10-11), so no
  single-surface mode is planned.
- Each emitted vector scene's last child is the old-mod banner: `G v="=lt(ver,FLOOR)" { … }`, where FLOOR is
  the floor's `ver` number (11118 for `v0.11.118`). It is the only version guard, for a game
  started before an update landed. On a mod older than the floor, `lt` gives 1 (or, on a mod
  too old to know `ver`, the attribute fails and `v` falls back to its default of 1), and the
  banner shows. Current mods hide it. Nothing else is gated per feature. `ver` is
  `major*1000000 + minor*1000 + patch` since 0.11.103. Keep the newest-tag floor
  and banner while Workshop publication is unchecked; there is no feature-specific floor.
- The generated Devices page carries the banner too.

### 6.4 Generated script

Shape: a **fixed, versioned Lua runtime library** that is unit-tested once, plus
**generated config tables** (roles, reads, rules, actions, pages) and one `src` literal per
page. Everything lives in one namespace table, because large consoles hit Lua's 200-local
limit.

The library is versioned (`VB.LIB = 1`) and ships with its config in every export. Its reserved
globals: `VB`, `P`, `T`, `H`, `S`, `C`, `X`, `L`, `R`, `E`, `U`, `rd`, `rds`, `wr`, `wrf`, `log`,
`persist`, `page`, `alarms`, `tick`; custom code assigns their fields, never the names. Device
reads and writes are pcalled; hooks, expressions and custom code run unprotected, so an error
halts the chip as in game, and the builder's line map names its owner (custom code line N, a
read, a rule, an action, a binding, or generated code). Expressions are Lua 5.2 expressions
under a lexical guard (no statement, no function, no `;`, no assignment, no comment, balanced
brackets).

```
U.init() once → each tick: U.before_reads(dt) → reads/transforms/thresholds → U.after_reads(P, S, dt)
→ latched rules → history → U.before_render(P, S, data) → render (never build + render in one tick)
```

- The `U.*` hooks live in the **custom-Lua block**, which the builder keeps verbatim between
  markers, inside a `do ... end` scope so its locals cannot shadow the generated boot and tick.
  Only writes to reserved globals are refused; locals, table fields, strings and comments
  are not global writes.
- API available to custom code: `P` (reads), `S` (state), `X` (exports, which become
  bindable sources), `rd/wr/wrf/rds`, `log`, `persist`, `page.go`. A page chosen in `U.init`
  opens at boot unless an unresolved required `one` role must open the Devices page first.
- **Flush rule** (measured in game). ScriptedScreens flushes at `ui:commit()` and at the end
  of every chip execution: the load chunk and each `tick()` are separate executions. Within one
  execution an element's writes reach the mod as one payload, the element's merged state, and
  the two halves differ:
  - **`set_props` merges ordinary props**: a prop set earlier, by a patch or by the declaration,
    and not named again survives, so `set_props{f=…}` then `set_props{x=…}` delivers both, and
    a later `set_props{snap=1}` keeps the `scene` and `data` an earlier write carried;
  - **table-valued props are replaced whole**: `data`, `nodes` and `ease` each hold one table,
    so a later write of the same prop replaces the earlier table, and `keep=1` cannot save it
    because the first table never arrives (measured for `data` and `nodes`; `ease` is the same
    mechanism). Different table props do not collide: `data` then `nodes` delivers both;
  - **a second declaration replaces the first whole**, unlike `set_props`: a prop it omits is
    gone, `scene` included, which sends the payload to another scene.
  - **props persist across executions**: the element keeps its accumulated props, and every
    later payload carries them. So `snap=1` written once stays on, and every later `data` change
    snaps until `snap=0` is written; `ease` persists the same way (measured, upstream f7823c6).
    A rendered capture cannot show snapping; the rebuild rate ("still animating") can.
  - **absent data is inert since vector 0.11.104**: nodes-only payloads do not deliver
    data or restart since(); explicit empty data still clears. A payload explicitly carrying
    retained data is still a delivery. The builder keeps separate geometry, snapped-data
    and eased-data elements. The earlier console observation at 0.11.101 is historical;
    a capture cannot measure since().

  So two writes to one element in one execution that carry the same table-valued prop (a
  declaration and a patch, or two patches) lose the first table unless `ui:commit()` runs
  between them. Declaring at load and patching in `tick()` is safe: the execution ends between
  them. The generated script commits between any two such writes, and never declares one id
  twice in one execution.
- **Table depth.** How deep ScriptedScreens' conversion of a Lua table can go is unproven
  either way: "dies at about 2000 nested tables" was measured at vector 0.11.81 and has not
  been re-measured. Scenes go to `ss.ui` as `src` text, so nothing relies on it, and table
  props stay shallow (no props table handed to `ss.ui` is nested deeper than 64) as a margin.

### 6.5 Importing existing scripts (adopt mode)

- **Builder exports** restore from the last genuine top-level embedded project block.
  M4 uses `1.<base64url(gzip(UTF-8 project JSON))>` with no padding. Strings pretending to
  be comments do not qualify; an older genuine comment in custom Lua does not override the
  final exporter block. Opening it never evaluates the surrounding script. The restored
  custom block runs through the existing metered preview after loading the project.
  Embedded-off exports have no restoration block. Files are read in the transfer worker,
  without copying their contents into the text box; Stop terminates a pending read and
  retains the original File for retry. Declared gzip bytes and the measured engine string
  limit are checked as §8 describes. Unreadable or unsupported data leaves the current
  project intact. Restoration grants no font consent.
- **Foreign scripts (M5)**: a `.lua` with no genuine block gets an offer ("This script has no
  embedded builder project...") with the console shape to capture at. Only **Adopt this
  script** runs it, in a disposable core worker with the boot allowance and a watchdog (Stop
  cancels): ticked, pressed through its click targets, every page and state captured as
  editable artwork. A cancelled, failed or empty capture changes nothing; a successful one
  replaces the project as an explicit replacement (M4's recovery rotation).
  - Adoption keeps the artwork: the pages (one per structure, named by surface and click
    path), the captured values as preview samples and the click ids. The script's Lua is kept
    verbatim in the custom block as a Lua long comment that never runs, for porting into the
    `U` hooks by hand; the player keeps the original file (owner, 2026-10-12, M5 plan OQ2).
    The exporter cannot run a foreign script's own `tick()` beside the generated runtime,
    which declares every page's elements itself.
  - Native labels and panels become `T` and `R` nodes, icons and text inputs the builder's
    natives, clickable natives click regions; label text that looks like a binding or a
    placeholder becomes an unbound sample, so it prints literally. Only attributes that
    change what is drawn are written.
  - The adoption report lists the pages, everything left out with its reason (reads, logic,
    device writes and `tick()`; viewport clipping; native states without a structure; scenes
    the strict parser refuses) and notes (click ids to attach actions to). It stays until
    dismissed or the project is replaced.
  - A builder export without its block gets its widgets back as widgets, in the provided
    theme its bodies reproduce. Widget boundaries are not recovered from foreign scripts.

## 7. Preview runtime

- **Worker.** The core runs in a **Web Worker**, so a runaway script cannot freeze the editor.
- **Interpreter.** Lua-CSharp at `d9fb336` is byte-identical between the public and beta
  StationeersLua builds. Numbers are doubles only (Lua 5.2), and errors are the game's.
- **Instruction counting.** Uses Lua-CSharp's own hook count, which is how the game meters.
  The shipped StationeersLua limits every execution, initialization included, to 50,000;
  P9 measured that load limit. The beta raises initialization to 500,000, and the owner
  requires that correction before release. The builder assumes that version: 500,000 at
  load and 50,000 per tick, with no load warning (owner, 2026-10-11). Preview budgets remain
  editable. An overrun halts the chip with
  `Instruction limit exceeded: script used more than <budget> instructions in a single tick.`
- **Loop.** Run the chunk. Every 0.5 s of preview time:
  1. run the builder's queued page texts (a patch of a page the chip has not built yet), then
     its page visits, then dequeue up to 8 UI events (each through its element's `on_click` or
     `on_change`, with `(value, player)` where player is the player's name, measured P10/P11
     on 2026-10-11), then call `tick(0.5)`, all in one metered execution;
  2. flush the batch and collect element changes.

  Every animation frame, evaluate and tessellate the active surface's scenes. WebGL 2 draws the
  meshes with v0.11.118's float straight-sRGB vertex colours (UV2): gradients interpolate
  sRGB, then decode per fragment; opacity still blends in linear light. An sRGB8 target
  decodes the destination for blending and encodes the result, preserving dark vector flats.
  Native UI and picture tint keep the byte-linear vertex path. The output pass samples the
  target as linear light, composites it over the page checker and encodes once for display.
  The scene target clears to (0,0,0,0): the owner states "console without a bg assigned have NO background"
  and chooses "checkerboard" (2026-10-13). Empty page areas display two close neutral greys
  (#282828/#303030) in 8 CSS px squares, independent of zoom and device-pixel density; outside
  the page the editor workspace retains its own background. The cover reconstructs the same
  linear-light composite before its label-coverage alpha pass. Only assigned page backgrounds
  produce native panel content and can hide the checker. A page with no nodes or direct
  FONT definitions has no vector scene or marker geometry over the checker. An absent
  background exports none
  and previews as the checkerboard, including through translucent geometry; the Devices page
  follows the first page's background, including absence. New pages keep their theme ground.
  readPixels and CaptureOverlay read the scene
  target without the checker; empty pixels have alpha 0 as in the capture camera, which clears
  transparent. A compare ignores RGB where both images are transparent. #0A121C was a stand-in,
  never an established game ground colour. The browser draws
  labels as DOM text in the real faces, falling back to Liberation Sans; under `ztext` a shape
  drawn after a label covers it through a cover pass over the text layer (owner, 2026-10-06),
  and WebGL text only if that pass falls short. The cover pass is a second WebGL canvas in
  the text layer, which is its own stacking context. Per frame, once React has committed the
  frame's labels (so the canvas, the covers and the text a paint shows are of one frame), it
  draws the frame into its own sRGB8 target, as the canvas does, but only inside the
  regions of the labels something is drawn over. A label's region is its box (turned and
  sheared as the text layer draws it) joined with the DOM boxes of its laid-out text and
  each run's per-line glyph ink, measured with Canvas text metrics using the same real
  face, kerning and letter spacing. Wrapped lines follow DOM breaks; ink is transformed
  with the label (text past the box under fit 0 or 2; fit 1 clips to the box), grown by its
  shadows and outline and cut to its clip. Unchanged labels reuse measured extents; a text,
  font or layout change measures only that label. Font loading/import, zoom and surface-size
  changes invalidate the cache. Colour and cover-order changes require no layout reads.
  Per label, in its region, the pass gathers the
  alpha of the triangles drawn after the label and shows the colour the canvas shows there at that alpha,
  premultiplied. The covers are in layers: where two covered labels' regions meet, the cover
  of the one drawn first (the smaller `cover`) goes a layer deeper, under the other's text; a
  covered label's text sits just under its own layer's cover, and a label nothing is drawn
  over stays on top. Layer 0 stays on the WebGL canvas; each deeper layer is copied to a
  canvas of its own at its place among the labels. Where a nearer layer's cover lies over a
  deeper label too, the deeper cover gathers only what is drawn up to the nearer one's label
  (a stencil), so the alphas over any text multiply to what the game's geometry leaves. Exact
  where the covering geometry is opaque and wherever no glyph is, provided a label's ink lies
  in its region. Glyph ink past a DOM line box is now included by the per-line measure,
  including side overhangs and accents above a line; no fixed overhang margin or synthetic
  style is used. The measurements and DOM regressions are recorded in `docs/m2c.md`;
  real font baselines and the cost on a 200-label page still need a browser check.
  Under a translucent cover the text shows through by exactly what the geometry leaves,
  but the colour laid over a glyph is the canvas's (which holds what is under the text),
  blended by the browser in sRGB: for a white glyph under `#E2563D` on `#203040` the
  preview is 30 to 32 levels per channel darker than the game at alpha 0.5, 19 to 26 at
  0.25 and 21 to 35 at 0.75. With nothing covered it only clears. Native `panel` and `label` elements are drawn as close
  copies; item icons are placeholders, because game art is not shipped.
- **Play mode.** The canvas's pointer reaches the core, which hit-tests the active scene as the
  vector mod does (down/up/leave for press plates, the plain click, enter/exit, xy, drag and
  drop, wheel over an SC; a second plain click from one pointer within 0.25 s is dropped).
- **Fake host.** Written from the public docs; decompiled code is used only to confirm
  behaviour, never copied. A host device sharing the housing ref is skipped with a warning;
  the housing and the remaining configuration still load. Malformed JSON and duplicate device
  refs reject the host. The bounded lost-write diagnostic stays at the shared flush boundary
  for runtime and export tests; it is not a preview status field. It covers:
  - `ss.ui` surfaces, `activate`, `size`, `set_resolution` and element handles
    (`set_props` replaces `data` wholesale); `ss.ui.surface` succeeds at load (P2).
    `set_resolution` changes `ui:size()` immediately, 0,0 restores the physical size, and
    its return is a function (P12, measured 2026-10-11);
  - the flush rule (§6.4): the writes to one element id are merged until a flush, which is
    `ui:commit()` or the end of a chip execution (the load chunk, and each `tick()`); the
    flush delivers one upsert of the element's merged state, where `set_props` merges ordinary
    props per key, `data`, `nodes` and `ease` are replaced whole, and a re-declaration replaces
    the element whole; cross-surface commit scope is provisional, unprobed (compare two surfaces before end-of-execution flush);
  - `ic.device.list()` (falling back to `ic.device_list`, `device_list`),
    `ic.find`/`ic.find_all` (top-level on `ic`), `read_id`/`write_id`, pins, slots,
    `batch_read(_name, _slot)`/`batch_write(…)`; the housing is absent from the device list,
    an unlabelled device uses its prefab display name, and `name_hash = hash(name)`
    (P4, measured 2026-10-11);
  - **`hash` = signed CRC-32/IEEE** of the string;
  - the full enums;
  - `ic.persist` with its documented limits (key 128, value 8192, 32768 in all; keys starting
    `__` reserved). An overlong key/value or reserved key returns false without raising
    (P5). Persist and chip memory (512 addresses) survive changed/identical pushes; writes
    from a halted run, including load-time writes, remain (P5c, P6, measured 2026-10-11).
    The preview's optional wipe-on-re-export simulation defaults off; real save/reload
    timing is still unmeasured (P5b was not run).
  - `util.clock_time` on a configurable day clock: HH = 24-hour, hh = 12-hour, MM =
    minute, ss = second, A = AM/PM (P13, measured 2026-10-11). There is no `ic.time`.
    `util.json` is a table; global `json` is absent. `ic.const.BASE_NETWORK_INDEX` is
    -2147483648 and `BASE_UNIT_INDEX` is 2147483647 (P2, measured 2026-10-11).
  - Reading a LogicType the device lacks raises `cannot read logicType <Name>`; an
    unknown ref returns nil (P1). Writing a read-only type raises
    `cannot write logicType <Name>` and leaves its value unchanged (P14). These
    measurements on 2026-10-11 reverse the earlier provisional nil rule for an absent
    type. StationeersLua is third-party; its Logic API documentation says unreadable
    LogicType reads return nil, but the preview follows the measured game behavior.
    The runtime still pcalls device I/O. LogicBatchMethod numbers are Average 0,
    Sum 1, Minimum 2, Maximum 3, Count 4; P7's enum cross-check found no differences
    from the catalogue. Empty batches return NaN, 0, 0, -Infinity and 0 respectively
    (P3, measured 2026-10-11).
  - The "assume beta" toggle adds the beta APIs (`find_prefab`, `find_all_prefab`,
    `ui:remove`, `handle:remove`); initialization spread across ticks is not modelled.
  - Coroutines run metered (every thread counts); `yield`, `sleep` and a resumable tick wait
    for the guide's text (probe P15).
  - Budgets, assume-beta, the day clock and the wipe-on-re-export toggle are project settings.
- **Simulated devices.** The catalogue (§3): every prefab with logic rows in the game's
  Stationpedia export (576 at build 0.2.6428.27798, 407 of them the vanilla devices of
  `ic10-devices.md`), with hashes, read/write LogicTypes, slots and modes.
  - Values are constant, slider, sine, ramp, random walk or keyframes.
  - Writes are stored and read back (On, Mode, Setting, Open, Lock) or ignored.
  - Adding a role auto-creates a matching device; the Sim panel adds, duplicates and removes
    devices and their values. A duplicate keeps the prefab and sources, with a new id and ref,
    no pin and an empty label; give it a label before wiring a label-selected role. New value
    names must match the catalogue (including numbered extension types) when it is loaded.
    Without a catalogue, any non-empty name can be added. Changing the set of source keys
    reloads the preview to remove old sources; changing values alone is live.
    The setup is saved with the project.
- **Not simulated** (shown as notes): real physics, TextMeshPro shaping, multiplayer
  identity, power gating of the housing, real save/load timing.

## 8. Export, sharing, hosting, testing, errors

**Export** (Download / Copy):
- Header: builder version; requirements, named in load order on one line and then each with
  its link on a comment line of its own (`web/src/codegen/requirements.ts`): BepInEx 5.x,
  StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens, ScriptedScreens Vector
  (the floor, which is the pin, "or newer"), and ScriptedScreens Fonts only when a face other
  than Liberation Sans is used or any FONT is declared; date. The README lists the same mods,
  in the same order, with the same links. (M3 writes the requirements; the builder
  version/date and embedded project block are built in M4.) Builder version 0.4.0 and one
  captured UTC ISO instant belong to the prepared export, not the deterministic preview
  generator. Project version, codec version and runtime library version remain 1.
  For FONT projects the header lists exact distinct links in page/declaration order,
  project N, both global limits (48 links/process, 48 requested faces/session) and the
  RequestFontWithReason (from 0.3.0) and Registrations (from 0.4.0) capabilities without
  asserting publication or relying on a single minimum-version claim.
  The Fonts panel shows per-link K unique delivered names, unknown until settled; rules,
  subsets and URLs are not faces. Cached faces cost nothing, name clashes count, failed
  and disabled requests do not. Counts warn above 48 and never block preview/export.
  Requirements, warnings and Lua bytes depend only on model/declarations, never network
  timing or local availability. Delivery/mismatch causes are labelled preview diagnostics.
  Link/face comment formatting makes controls visible without physical comment breaks;
  exact authored strings remain in scenes. No download or consent enters project data.
- Body: generated Lua; the custom block between markers; the banner on each page; an embedded
  project block `--[==[ vectorbuilder:project <compressed token> ]==]` plus LF, appended
  last so line maps do not move. Embedding defaults on with a guarded browser-local preference;
  the user can turn it off. Show exact comment and total UTF-8 bytes. Above P16's measured
  1,057,682 total bytes, show information that larger scripts are unmeasured; never impose
  a guessed source-size cap. The block includes all authored project fields, custom Lua,
  simulated setup and exact font names/URLs, never chip stores, font bytes or consent.
- **Check export**, then separate **Download**/**Copy** clicks on the same artifact. Project
  identity and embed preference identify it; authored edits, undo/redo/load and checkbox
  changes abort/invalidate the attempt. Selection, frames, ticks and preview font delivery
  do not. Clipboard failure leaves labelled selectable Lua. Compression failure retains
  embedding-off and JSON choices; it never silently omits the block.
- Checks run on a disposable worker's isolated chip, leaving preview time, stores and writes
  unchanged: independently parse every exact generated page source, compile and load once,
  then visit/render each generated page for two consecutive dt=0.5 ticks and pad to
  `max(20, 2 × generated pages)`. Devices is included; there is no page-count cap.
  The host uses cold persist/memory and simulated inputs. Reports accumulate load/tick
  diagnostics and disclose at most 16 distinct Scene.Problems per scene, with Missing,
  Starved and Dropped separate. No clicks, TMP shaping, real device physics or Fonts
  delivery are checked. A clean sample is not proof of all future saves or actions.
- Known errors block: real Lua parse/compile/load/tick/budget failures, malformed scene
  source, missing theme roles and provable generated persistence loss. Mod-accepted scene
  faults, unknown gradients, missing names/samples, small text, unknown fonts, starvation,
  dropped geometry and observed persist refusals warn. Nothing the mod accepts is refused.
  Static checks use the selected theme's written literal text floor and conservative
  persistence certainty; oversized init/key or speculative totals are not inevitable writes.
  Refused persist.set returns false without raising, as measured in M3; boot never writes.
- Normal export requires complete:true and no known errors. Cancellation, crash/watchdog or
  editor responsiveness exhaustion is incomplete. A scene too large to check here obtains
  exact structurally guarded source through the transfer worker for the real parser/core;
  the editor-scene check stays explicitly unfinished. After incompletion only, **Export
  unchecked** may prepare/acknowledge the current artifact with named unfinished checks,
  never bypass a known error or claim a pass. Retry and JSON rescue remain available.
  Runtime messages get no guessed node/key links; only structured locations link against
  their matching scene identity.
- **Send to chip** (M6, built and launched 2026-10-13): a section of the Export dialog, hidden
  until the per-browser "Show Send to chip (advanced)" is ticked. It talks to StationeersLua's
  MCP endpoint at the fixed `http://127.0.0.1:3030` (under `npm run dev`, through a development
  proxy at the page's own origin that forwards only same-origin loopback requests and removes
  `Origin`). One click pushes exactly the checked artifact, unchanged, with `set_chip_code` in
  `editor_then_chip` mode, so an open IC editor showing that chip shows the new code too; then it
  reads `vector_stats` and asks for a capture, which the game saves as a PNG on the player's
  computer, answering with its path. Each answer is said in words, with the raw answer behind
  Details. Sending replaces the chip's program with no backup, and the panel says so. A failure
  the browser cannot name lists its possible causes (the game not running or no world loaded,
  the endpoint off, this origin not allowed, the local-network permission refused) instead of
  guessing one. Nothing asks the game anything until a click, and nothing about the game is
  kept, in the browser or in the project.
- **The game link** (M6, built and launched 2026-10-13): the status bar's game item ("Game: not
  linked" until linked) opens a dialog that links this tab to one chip, picked from the game's
  chip list by name or taken from the IC editor's selection in one click ("Use the chip selected
  in the IC editor"). The link lasts until the tab closes. Send then writes to the linked chip,
  and the linked console's screen size is offered as the page's shape, which the page's own shape
  control can still change (the owner: "but with the ability to overide").
- **The device picker** (M6, built and launched 2026-10-13): each role in the Logic panel can take
  a real device from the linked chip's network (every network when nothing is linked), by its
  name; the pick writes the device's prefab into `prefabs` and its name into `label`, never its
  ref, so the role finds that device by name (§6.1). A role pinned to one device keeps its pin. No
  ref, network id or hash shows anywhere.
- **The game's settings** the player sets: StationeersLua's `[MCP Server] Enabled`, and the site's
  origin `https://gruffuss.github.io` in `AllowedBrowserOrigins` (a change took effect only after
  a restart); nothing suggests `*` or another origin. Which chips the game lists follows
  StationeersLua's chip-access settings (the IC editor's selected chip, a Wireless Development
  Board with `AllowNetworkChipAccess`, worn gear with `AllowPersonalAreaNetworkChipAccess`). A
  browser may ask for local-network permission. The game's preflight answer allows the listed
  origin without an `Access-Control-Allow-Private-Network` header, and Chrome accepted it
  (2026-10-13).

**Projects and sharing:**
- IndexedDB keeps one current serialized project and one recovery record, not an edit history
  or library. Read startup first, then choose an unconsumed valid fragment, current storage,
  or Blank; restore with empty undo history and reset all preview runtime references.
  Save committed identity after 500 ms quiet; skip transient drags, selection, frame and tick.
  FIFO/coalescing, transaction completion and optimistic revisions prevent stale overwrites.
  Rotate the displaced current on the first successful save of each explicit replacement
  generation, preserving recovery through subsequent edits/undo/redo. A later replacement
  may replace recovery. Storage failure/conflict visibly pauses saving with JSON rescue
  and explicit choices; never steal a newer revision. Pagehide flushing is best effort.
- Project `.json` import/export includes every persisted field and simulated devices.
  Version-absent legacy projects are sanitized; future versions are rejected explicitly.
  Unknown preview/registry/consent data is stripped, and structural walks/serialization
  are iterative without a builder depth or node cap. Font files remain browser-local.
- Share links use the versioned gzip token in `#p=…`, never a query or HTTP payload.
  Copy link is offered only when the **entire absolute URL** is at most **8,000 characters**;
  larger projects use JSON and are never truncated. A token over 7,997 characters cannot
  be a link this builder produces and is refused before decoding. Gzip's declared ISIZE
  must be at most three times the measured engine UTF-16 string limit L; output stops if
  it exceeds its declaration, and decoded text stops at L. These are format/producer/engine
  boundaries, not arbitrary valid-project caps. Exhaustion means could not open here.
- Remove p from the address bar before decoding, keeping the token in memory. Successful
  read restores it until the same fragment generation is durably saved, including its edits;
  then consume only that fragment. Content rejection leaves it removed so reload does not
  repeat bad input; transient failure restores it with a reload warning. A tab death during
  decode cannot loop on reload. Rejected hashchange input leaves autosave of the current
  project running. Preserve the original link/file externally for retry/rescue.
- Templates: Overview, Atmos/tanks, Power, Airlock, Solar, Blank, and a Needle gauge drawn from
  plain shapes and bound to a reading (owner, 2026-10-12, audit Q12–Q13). They follow whichever
  provided theme the project uses and are checked under each; Overview has no fidelity target
  to an outside design. The shapes-only gauge does not replace the Gauge widget (E1).
  Airlock (owner, 2026-10-12: "yes it should kinda match that", matching his own working airlock console script)
  opens one door at a time, only once the other reads shut and settled (Open 0, Idle not 0,
  1.5 s after its close command); an unbound door counts as shut. It holds both doors in
  Logic mode (Mode 1) and unlocked (Lock 0), written whenever a door reads otherwise; writes
  Open and Setting together; takes a door's own button as a request for that door; and at
  boot leaves the doors as they are (each door's Setting adopts its Open; if both are found
  open, the inner one is shut). Its two door roles are distinct (§6.1). Still no automatic
  pressure cycle and no safety claim. Solar remains
  read-only raw Charge/Maximum until units are independently verified; no tracking or kW
  conversion. A blank page shows nothing and exports no vector scene. Open example 01–19,
  including
  18/19 without automatic font requests, and raw Example scripts remain available.

**Hosting:**
- The public repository is `Gruffuss/StationeersConsoleBuilder` on GitHub, and the site is its
  project site, https://gruffuss.github.io/StationeersConsoleBuilder/ (its browser storage is
  shared with the owner's other github.io project sites). The public repository started at the
  launch with a single commit and receives release snapshots of this private repository, which
  keeps its history.
- `.github/workflows/ci.yml` builds `core/` (the .NET wasm workload) and `web/` on a clean Linux
  checkout, runs the suites, builds under the project path (`VB_BASE=/<repository>/`) and deploys
  `web/dist` to GitHub Pages. CI runs on pull requests and on pushes to `main`, the deploy only on
  a push to `main`. Both jobs stay off until the repository variables are set: `VB_CI = on` runs
  the build and tests, `VB_DEPLOY = on` also deploys (with Pages set to deploy from GitHub
  Actions).
  M6 (owner, 2026-10-12):
  MIT licence ("Copyright (c) 2026 Gruffus") with third-party notices (Lua-CSharp, the .NET runtime, the vector mod, the fonts,
  the npm packages) in the repository and on the site, the vector mod's notice keeping its own
  MIT line "Copyright (c) 2026 Gruffuss" (D18); no code split before the launch, the
  deployed site's first load is measured and shown to the owner; the owner publishes the pinned
  vector version (or newer) to the Workshop before the deploy, and exports keep targeting the
  pin; the builder version stays 0.4.0.
- The bundled fonts are self-hosted OFL `.woff2` files with their licence texts; imported fonts
  never leave the browser. Only explicit active-page font consent permits Google CSS/asset
  requests under §5.3; open/import/shared/example/source-parse flows never fetch. Projects,
  CSS, assets, redirects and persisted local records are untrusted at their boundaries.
- Pictures (M5): `data:` pictures decode locally at once; `https:` pictures load only on the
  page's explicit **Load pictures** (credentials omitted, no referrer, once per session; a
  later edit needs another click); opening, importing, sharing, examples, adoption, undo and
  export never request one. `file://` is not previewed (the game reads it from its own disk).
  A host without CORS gets a note that the game loads the picture itself; an HTTP error is
  named as one; a picture over the browser's texture limit is named, never drawn black.
- Design-system links (M5): only the player's **Fetch** requests the pasted URL (its query
  kept) and, for a project folder, its same-folder files, with credentials omitted and no
  referrer; a redirect is refused and said; a missing or HTML-answered optional file is a
  note; no claude.ai API is ever called.
- Deploys and releases happen only on the owner's go-ahead.

**Testing:**
- **CI:** the workflow above runs the local check's six steps in order (publish, precore,
  type-check, web tests, the build, the C# suite), each gating the next.
- **Core:**
  - the vector mod's own unit suite against the pinned tag, which detects native-only Unity
    calls;
  - fake-host tests: CRC-32 against every catalogue prefab's hash (576 at build 0.2.6428.27798),
    persist limits, `set_props` semantics, the flush merge, the click queue, budget halts.
- **Web (Vitest):**
  - `src` print → parse round-trip over vector examples 01–19 (21 structures) and captured real scenes;
  - widget expansion;
  - codegen snapshots;
  - every generated export compiles in Lua-CSharp;
  - the runtime library's behaviour under the fake host;
  - DOM wiring tests in **happy-dom** (a devDependency); such a test starts with
    `// @vitest-environment happy-dom`, and every other test runs in `node`.
- One smoke test, in happy-dom (no Playwright): open, add a widget, export.
- **In game:** at milestones, templates are pushed to a test chip, `vector_stats` must be
  clean, and a capture is taken. The in-game probes and the checklist push to one of the
  chips the owner keeps in the save for testing, without asking each time; which one is
  confirmed with the owner once, when the probes first run (owner, 2026-10-06). A capture is a
  camera render of a cloned tree on a fresh canvas, not a read-back of the live screen, and any
  canvas that draws vector geometry needs the TexCoord1 shader channel
  (`additionalShaderChannels`). Nothing counts as tested until seen on a console.

**Errors shown in the builder:**
- Lua error: line and whether it's generated or custom code; the chip shows halted.
- Budget overrun: halted, naming the phase.
- Scene problems: the magenta border as in game; the export report links only structured
  scene/static locations, never a node inferred from runtime prose.
- Invalid `src`: inline errors; the last good model stays.
- Import failure: the reason, retry/original file and JSON rescue; a script without a
  genuine block gets the adoption offer instead (§6.5).

## 9. Facts this design relies on

**Vector mod** (at the pin; offline-verified unless noted):
- seen on a console at 0.11.101 (upstream's test page: `vector_stats` reported 0.11.101.0, and
  the geometry equalled the offline probe): an `SC`'s scroll offset is its own `so`, never one
  passed down (0.11.98); the `fmt` rules of 0.11.100 (`{0} kPa` and `{0,6:0.0}` print the number
  unreported, `{$v:%q}` prints `%q` and is reported); hex in a placeholder (0.11.101:
  `%x {0:D2}` prints `8 08`, as on a whole binding); the point counts (a two-point `Y` strokes
  and does not fill; five values on an `L` draw a two-point line, three draw nothing);
- not yet seen on a console, so on the in-game checklist: the raycast filter (0.11.98: a vector
  element takes the pointer only over a hit region or a scrollable viewport, so a click on its
  empty part reaches a native element behind it), and a wheel over the empty part of a short
  `SC` list, which must still scroll it;
- no nesting limit: blocks, arrays, expressions and nodes work at 100,000 levels (seen in
  game: 60 nested groups draw); `SYM` cycles are refused;
- colour expressions (`if`/`mix` of `#hex` colours) on `f`, `s` and `s_` only, never in `oc`,
  a shadow colour or a gradient stop's colour;
- gradient stops are sampled in premultiplied sRGB and unpremultiplied by
  Gradient.MixPremultiplied, like CSS; the resulting straight float sRGB interpolates
  between vertices and decodes per fragment (v0.11.118). Opacity composites in linear light;
- `TagNodes`/`NodeSpans`;
- the `ver` variable;
- unknown gradient id → magenta;
- unknown clip id → unclipped, reported;
- stroke `units=bbox` bound to the contour box.

**Expression rules:**
- An unknown name fails only that attribute, which falls back to its own default.
- `if()` is lazy.
- `nodes` patches re-parse the whole merged subtree: patch the leaf, not a group.

**Data transport:**
- Numbers arrive as float32; since 0.11.102 numeric table booleans read as 1/0.
  The builder sends flags as 0/1; maps are not scalar data.
- `data` replaces the payload unless `keep=1`.
- The builder keeps structure, snapped data and eased data on separate elements; since
  0.11.104 absent data is inert, and an explicit empty payload still clears.
- Writes to one element id between flushes are merged: `set_props` merges ordinary props per
  key, `data`, `nodes` and `ease` are replaced whole, a re-declaration replaces the element
  whole (§6.4, measured in game).
- ScriptedScreens' Lua-table conversion has a depth limit that is unproven either way (about
  2000 nested tables at vector 0.11.81, not re-measured); scenes go as `src` text, so nothing
  relies on it (§6.4).

**Wasm core:**
- The core file set is the vector mod's `Tests/ScriptedScreensVector.Tests.csproj` sources
  plus its stubs.
- `ColorUtility.TryParseHtmlString` must be replaced by a managed parser.
- The assembly version must be stamped from the pinned tag, or `ver` reports the wrong value.

## 10. Risks and open questions

1. **First spike:** .NET browser-wasm in a Web Worker running both the vector core and
   Lua-CSharp (its async `RunAsync`), with the instruction hook working. Everything rests on it.
2. **Hidden surfaces.** Whether inactive surfaces cost render time or memory is the vector
   mod's to measure (owner, 2026-10-11: in-game rendering is its concern); exports keep
   per-page surfaces.
3. **Source size.** P16 accepted padded probe scripts through 1,057,682 bytes (about
   1 MiB) without an error on 2026-10-11. No limit was found in that range; larger
   exports remain unmeasured. M4's embedded blocks were accepted on a console on
   2026-10-12 (all seven embedding-on starters, 41,423–54,299 bytes; docs/m4.md). Offline/browser measurements
   are in docs/m4.md: the largest current template artifact is 54,004 bytes embedded,
   and the largest corpus project JSON is 119,108 bytes. Those figures do not establish
   a maximum or extend the measured game acceptance range.
4. **Text metrics.** TextMeshPro vs browser text metrics differ: label boxes, centring and
   kerning. These need an in-game comparison per font.
5. **Letter spacing.** Settled: the `T` attribute `cspace` (§5.3).
6. **Device catalogue.** Generated from the game's own Stationpedia export
   (StationeersStationpediaExtractor's `Stationpedia.json` and `Enums.json`, build
   0.2.6428.27798; §3) and cross-checked against `ic10-devices.md` (407 devices, game
   0.2.6403), which also names the vanilla devices (`tools/catalog/`). Open: a mod's LogicTypes
   have no number in the export (the in-game enum probe gives them); a device newer than the md
   is a mod's until `vanilla.txt` names it; the export comes from a modded game.
7. **Bundle size.** Measured on the deployed site (2026-10-13): first load is about 3.3 MB over
   the wire, the page's 811 KB plus 25 core files of 2,448 KB (5,698 KB uncompressed), and the
   core is ready in about 205 ms. The main JavaScript chunk remains above the 900 kB warning; no
   code split was made (the owner's OQ8 answer). See docs/m6.md.
8. **Compressed input resources.** R13 bounds startup fragments by the actual 8,000-character
   producer rule and embedded inputs by declared gzip size and the measured engine string
   limit. A real Chrome test of an honest 1,610,612,663-byte expansion stopped at L with the
   tab alive but sampled whole-browser working set reached 3,031,625,728 bytes. This is
   substantial memory, not a small-memory guarantee. Other engines/devices remain pending;
   a tab death calls for a bounded-heap decoder, not an invented valid-input size cap.

## 11. Rough milestones (refined in the plan)

- M0 spike: wasm core in a worker: parse + tessellate a scene; run Lua with metering.
- M1 model, `src` text, code pane, canvas preview of raw shapes, selection.
- M2 is split in two:
  - M2a: re-pin to the newest tag; linear-light opacity compositing (WebGL 2 with an sRGB8
    intermediate); native `panel`/`label`; the text fields M1 dropped; page shapes, with a size
    per surface; scene checks in a worker; the attribute catalogue; the property panel with
    trap warnings; fonts (bundled defaults, imported fonts) and the Vanilla + colours.
  - M2b: the widget framework and the P0 widgets, with the rest of the themes (type styles,
    geometry, shadows, the alternative presets, which E1 removes) and a plain insert palette.
  - M2c: the canvas editing utilities of §4 (draw, transform, snap, space, style, arrange),
    run alongside M2b where their files allow. The owner designed the final UI after it (built
    2026-10-12, `docs/ui.md`).
    Built 2026-10-06 (`docs/m2c.md`): one registry of tools and commands, the rulings in §4
    "How the editor does it". The owner answered questions 1-6 on 2026-10-06: the defaults
    stand, except that the preview draws a shape drawn after a label over it, as the game
    does (Q6, built 2026-10-06 as the cover pass, §7), and on 2026-10-06 kept questions 8 and 9,
    from the final review, as built; question 7 (Task 12 waits for the natives of M2b T9) was kept:
    T9 landed first.
- M3 roles, reads, state, actions, rules, bindings, the runtime library + codegen, the Devices
  page; the fake StationeersLua host, the rest of `ss.ui`, UI events and play mode, metered
  coroutines; the device catalogue and its refresh; Export (Download + Copy, with the
  requirements header).
- The earlier re-pin to 0.11.112 mapped versions 102–112: pin/host/geometry, floor/banners,
  catalogue/validation/FONT and examples 18/19; page fonts split into transport, isolated
  metadata, registry and UI/export. Only registry rendering consumes the prior text
  calibration fixes. The page Fonts UI remains a rough add/remove prototype for the
  owner's redesign. Registry, UI/export, cancellation and metadata boot/read fixes are
  integrated. Chrome consent/alias/representative/CSP results are recorded in §5.3 and
  the M3 re-pin note. The 2026-10-11 game run saw Panel wells and Bars, captured current
  example 18 geometry and loaded example 19 (Orbitron/Orbitron Bold), with clean scenes.
  Separate shadow/hairline comparisons and example 19 fallback remain untested; the font
  was already cached. Captures stay outside the repository. Obsolete widget RP caps are removed.
- M4 export checks, the export header's builder version and date, the embedded project block,
  share links, templates, IndexedDB. Built alongside E1: its widget starters wait for E1's
  Neutral default, its shapes-only gauge also for E1's raw-shape style links. Implementation
  and merged offline verification are integrated; **M4 is not complete** while real-device
  behaviour and manual browser evidence are pending (docs/m4.md); the console pushes, source sizes and embedded blocks were seen in game on 2026-10-12.
- E1, the editing milestone (owner, 2026-10-12), before M5: looks from the theme (paint parts,
  metrics, anatomy, neutral defaults, the Panel's options removed), the Neutral default theme with
  Vanilla + kept and the recoloured presets removed, editable widget instances, widgets inside
  groups, styles that follow the theme, zoom and pan, group-first picking and a layers panel,
  multi-selection resize and rotate, paint and layout controls (padding, margins, spacing), the
  Flow duct on an animated dash, a Gauge widget, and last the pen with point add/delete. Planned in
  the E1 plan.
- M5 design-system import onto E1's theme contract (parts, metrics, anatomy, links), adopt import, `IMG`.
  Built on `m5-imports` (2026-10-12; evidence offline, in the browser and in game in
  `docs/m5.md`); it merges into `main` on the owner's go. The vector re-pin is the last step
  before the public deployment (owner, 2026-10-12).
- M6 send to chip, polish, CI and Pages deploy: built and launched on 2026-10-13 (evidence in
  `docs/m6.md`), at https://gruffuss.github.io/StationeersConsoleBuilder/. Planned in
  the M6 plan; the owner answered its questions
  (2026-10-12). Polish was the player-facing texts, the README and M4's leftovers; the vector
  re-pin to 0.11.118 came last before the deployment.

- Future: pages that adapt to the console's size (owner, 2026-10-13). Today a page has one fixed
  shape: on its own console it fits exactly, and on any other the scene is only scaled to fit,
  leaving empty bands. Planned: elements pinned to the page's edges or stretched between them, so
  spare width or height is used, not left blank; and a landscape and a portrait arrangement in one
  page, the export choosing by the console's size, as the owner's own Power console does. Its own
  plan comes first. Until then a console made for both orientations ships as two templates.

Execution: tasks run in parallel wherever only shared lines of text order them; a task waits only
for another task's output (an interface it consumes). Merge conflicts are resolved at the merge, and
a milestone's next plan may start while the previous milestone's tail is still running.

## 12. Decision log

- 2026-10-11 · Preview outline padding and faux-bold dilution mirror the author's shipped vector 0.11.113 formula, seen in game (§5.3), superseding the earlier pending outline rule. Per-face gs/pointSize/other determine W and ScaleRatioA; ow stays exact below the padding cap, bold stays unchanged through the knee, and clamped strokes report “the outline is reduced to N%”. The preview draws outlines; the vendored core pin remains 0.11.112. Table-driven regressions cover both calibrations, rich-text runs and clamping before/at/past atlas exhaustion.

Dated, newest last. The body above states each decision; this log only records when it changed.

- 2026-10-04 · Design approved (D1-D18, §1-§11).
- 2026-10-05 · Export floor = the newest vector tag (Workshop daily, Steam auto-updates); the fixed minimum and per-feature gating retired; the old-mod banner is the only guard (D15, §4, §6.3, §8).
- 2026-10-05 · Pin by tag, re-pin routinely, never wait for upstream: M2a pins `v0.11.87`; an upstream bug gets a repro and is then treated as solved (§3).
- 2026-10-06 · No re-pin per tag (owner): re-pin only when the current work is done, or after asking the owner; upstream's changes between re-pins wait in a running list. Upstream tags several releases a day, and a re-pin per tag cost about a million tokens each (§3).
- 2026-10-05 · No depth caps: iterative parse, print, validate, numbering and checks; limits only for `SYM` cycles and ScriptedScreens' table conversion (props depth ≤ 64, scenes as `src`); budgets in a worker report "too large to check here" (§4, §6.4, §9).
- 2026-10-05 · ScriptedScreens flush rule measured: uncommitted upserts of one id merge; the exporter commits; the fake host models it (§6.4, §7, §9).
- 2026-10-05 · Vector canvases need the TexCoord1 channel; a capture is a camera render of a cloned tree (§8).
- 2026-10-05 · M2 split: M2a fidelity, checks, catalogue, panel, fonts, theme colours; M2b widget framework and P0 widgets (§11).
- 2026-10-05 · Linear-light compositing (WebGL 2, linear RGBA8 intermediate); labels stay DOM text (D6, §3, §7).
- 2026-10-05 · Fonts: any face; ScriptedScreensFonts naming and weight map; self-hosted OFL defaults; custom-font import; `font` free text; letter spacing = `cspace` (§3, §5.3, §8, §10).
- 2026-10-05 · Widgets: params in the marker; one state integer 0-3 with colour expressions; Vanilla + outlines inside the box, hero unit 64 px; selection on the root, no nesting, project-wide uids (§4, §5.1, §5.2).
- 2026-10-05 · happy-dom (devDependency) for DOM wiring tests and the smoke test; no Playwright (§8).
- 2026-10-05 · Property panel: fx only where an expression is read; `<datalist>` autocomplete; catalogue = extracted base + overlay; traps restated at the pin (§3, §4).
- 2026-10-05 · Repo is public: hygiene rules; `main` and Pages on the owner's say (D18).
- 2026-10-05 · The amendments table of section 0 folded into the body; this log replaces it.
- 2026-10-05 · Flush boundary corrected by an in-game measurement (vector 0.11.89): every chip execution ends a batch, the load included. Declare-at-load plus patch-in-tick keeps `data`; declare and patch in one execution loses it without `ui:commit()` (§6.4, §7).
- 2026-10-05 · Execution in parallel: a task waits only for an output it consumes, never for a shared hunk of text; conflicts are resolved at the merge; M2b may start before M2a's tail is done (§11).
- 2026-10-05 · Re-pinned to v0.11.90 (0.11.88 filters the label outline at placement, so the core's own outline filter is gone; 0.11.90 merges waiting nodes patches per node id and per prop, as the core already did).
- 2026-10-05 · Canvas editing (owner): draw tools, transform, snapping with guides, align/distribute/gap, styles (copy/paste, named from theme tokens), arrange; the UI stays a rough prototype until they exist, then the owner designs it; milestone M2c (§4, §11).
- 2026-10-05 · Editing tools are open-ended (owner: ideas will keep coming): tools and commands plug into one registry; snapping and layout are pure functions (§4).
- 2026-10-05 · Catalogue vs REFERENCE.md (corrected the same day by the mod's author): a disagreement is reported upstream; a measurement decides which side is wrong; until then the reference is a provisional tie-break, marked provisional; doc silence is a question, not a defect (§4).
- 2026-10-05 · Re-pinned to v0.11.91 (fea is read for every node, not only filled ones: a stroke-only shape honours fea; the catalogue's fea no longer requires f).
- 2026-10-05 · Flush rule settled by in-game measurement (upstream ca7f4ba): within one execution an element's ordinary properties merge and data is replaced whole; two data-bearing writes in one execution lose the first table (keep=1 cannot save it).
- 2026-10-05 · Flush rule completed (upstream 890d135): `nodes` and `ease` are replaced whole like `data` (`nodes` measured, `ease` the same mechanism); a declared prop a later patch omits still arrives; a second declaration of one id replaces the first whole; cross-surface commit scope is provisional, unprobed (§6.4, §7, §9).
- 2026-10-05 · `snap` and `ease` persist on an element until written back off (`snap=0`): the host re-delivers accumulated props (measured by rebuild rate, upstream f7823c6; the old "snap for one payload" was wrong) (§6.4).
- 2026-10-05 · A `nodes`-only patch re-delivers the element's data and restarts `since()` (measured, upstream f45b169): geometry patches go on a separate element; captures cannot measure glides or `since()` (§6.4, §8).
- 2026-10-05 · M2a final review: colours the mod takes, with a report or dropped in silence, are warnings, never errors (the panel takes any colour); the `SCENE` header is trapped as op `SCENE`; new traps for a pointer key without `id`, a number on a text-only key and a clip's extra shapes; a trap's work budget leaves a warning, never a verdict; the open-`SP` fill follows v0.11.91 marked provisional, like `L`/`LS`; unknown keys outside node bodies are worded provisional; the selection keeps its path while the node there keeps its `id` or is the only node an edit replaced (a panel rename beside a twin) (§4).
- 2026-10-05 · Re-pinned to v0.11.94 and applied upstream's answers to the REFERENCE.md sweep (§3, §4, §6.3): `weight` takes a number (≥ 600 bold); def keys on GL/GR/GC/CP are validated (a typo now shows the magenta border); an `SC` keeps its own `so` (provisional (due 0.11.97): at v0.11.94 an SC that has `sov` also takes a `so` passed down to it, from a G or the SCENE header, as its scroll offset; neither its `sov` nor the passed `so` is a trap then); `T` and `IMG` take clicks (0.11.93; `IMG` not yet seen in game), `YS` none; an unquoted `$name[i]` value reads to whitespace; `d` takes compact numbers and one-character arc flags. New traps: a number where the mod reads text (a quoted number is still a number), and a `mask` without `@`. `sd`/`sdo` are dead keys. The code's reading stands where the reference is to follow, confirmed upstream (0.11.94): an open `L`, `LS` or `SP` fills as if closed; `ry` only squares a single `rx`'s corners, at 0; `unit` is added to bound or templated text only; `nofill` hides labels too, and `noeval` stops only the `R`, `SC` and `IMG` boxes. The mod's other reported faults get no trap. Measured at 0.11.94: nodes inside an `RP` get hit regions (`RP n=3 { R id=btn click=1 }` gives `btn:0`..`btn:2`), and ids and the bindings that are not expressions (`text=$name`, `{$name}`, a paint's `$name[i]`) take any Unicode, supplementary-plane characters included. Inside an `=` expression or a `{=…}` placeholder only BMP letters work: an astral name is reported ("expected a name") and the default is used; upstream tracks it as a fault, due 0.11.97, so no trap.
- 2026-10-05 · From upstream's measurements at 0.11.94: how deep ScriptedScreens' Lua-table conversion can go is unproven either way ("about 2000 nested tables" was a vector 0.11.81 measurement); scenes go to `ss.ui` as `src` text, so nothing relies on it, and table props stay shallow (depth ≤ 64) as a margin (§6.4, §9). A `SCENE` `w` or `h` below 1 is raised to 1 without a report: a new trap (§4). A `T` `fmt` the mod cannot read is printed as written, and an empty one prints numbers as nothing, both without a report: two new traps (§4). A `v` of 0.5 or less hides a node; a `C`'s `ry` defaults to its `rx`. A `T` records its hit only with text that is not empty and without SCENE `nofill`; an `IMG` only once its picture has loaded.
- 2026-10-05 · Re-pinned to v0.11.95 (a crash fix: a deep numeric argument inside a colour expression overflowed the stack; numeric attributes were never affected).
- 2026-10-05 · `fmt` traps fire only where a label formats a number through `fmt` (a whole `$` binding, or a placeholder without its own format); a `fmt` brace `string.Format` cannot use is a new trap (the `missing` text, or literal text with no number, in place of the number); at v0.11.95 an unread spec prints as written without a report. A group default passes down only as written, in lower case (`ParseStyle` searches `GroupPaintDefaults` ordinally, checked on the mod): `F=`, `SO=` or `S_=` on a `G` or the header is a new trap (§4).
- 2026-10-05 · M2b final wave (rulings 1-4 and the final review): a scene too large to check here lands from the code pane and both panels, its reason as information (replaces M2a plan ruling 2, which did not make it); names the mod reads are never refused (an expression slot takes `ReadName`'s names, a label-only slot any name its binding reads back, a preview any non-empty name; `constructor` too); Delete is kept by any button and the bars around the canvas; the Mobile and Light palettes stay placeholders. Also: uids reused by a paste or a load detach as copies, which keep the `<uid>_` defs they use; text from another theme stays a widget; a load re-associates every page; a detach pins its samples; any size the mod draws; widgets that hide everything hold their box; undeclared clips, symbols, masks and gradients are traps; list items keep their slots by a stable key (§4, §5.1, §6.3).
- 2026-10-05 · R6 fix round: the panel reads and writes a group default by its exact key, and src keeps `G F=#0f0 f=#f00` whole, as the mod passes the `f` down; `default-case` is worded for any node with a block where the key is only a default; `fmt-brace` judges a format item's own format (`{0:Z}`, `{0:abc}`), and says nothing of a placeholder whose format the mod fails the scene on (an upstream fault, reported) (§4).
- 2026-10-06 · M2b final-wave residuals (ruling): pasted or loaded text that its widget's params give but for its colour literals (a palette retuned since, the Light and Mobile placeholders) is made again in the theme, never detached; a load also makes every `theme_` gradient in the theme's colours; "edited by hand" stays for real edits. A copy pasted beside its widget gets copies of the `<uid>_` defs it points at (`<uid>copy<k>_`) instead of sharing them, so the widget's edits no longer detach it (§4).
- 2026-10-06 · Re-pinned to v0.11.96 (4b72fd9), which reports nine faults it dropped in silence (§3, §4, §6.3): a malformed `sh`, faults inside a clip and a clip's further shapes, a `mask` without `@`, a refused `src` beside a `root` (the host port follows), bad gradient stops and the `SCENE` header's own keys; `sd` and `sdo` are gone; an `IMG` takes clicks before its picture loads. The `mask`-without-`@` trap and the clip trap for further shapes go (a def op after the clip's shape stays a trap: still unreported); unknown keys on a clip's shape and the header are the mod's to report; the host's keys on the header do nothing in src. `fmt-brace` quotes a text format item padded to its width.
- 2026-10-06 · M2b final fix round: a text value (a label's text, fmt, unit, missing) is not a colour literal, so a label edited by hand to `#505` detaches instead of being made again; a pasted copy whose page lacks a `<uid>_` def it points at (its root copied alone) gets the one its marker makes, under `<uid>copy<k>_` beside its widget, under the widget's name where no widget of that uid can stand (§4).
- 2026-10-06 · R7 review: `fmt-brace` names a text format item's width instead of quoting its spaces (a width of 999,999 made a message of a million characters); a node inside a clip's shape, whose children the mod never parses, is a `clip-extra` trap, not the loud unknown-key warning (§4).
- 2026-10-06 · M2c merge 0a: M2b final-wave ruling 1 reaches the canvas too. Paste, duplicate, group, ungroup and style paste, which are checked before they land, land a scene too large to check here, its reason as a note; before, they did nothing on such a page (§4).
- 2026-10-06 · M2a R6 and R7 merged into M2b. A copy whose page lacks a `theme_` gradient it paints with (its root copied alone to another page) gets it from the theme, as it gets a `<uid>_` def from its marker; 11 of the 18 vector widget types drew such a shape magenta (§4).
- 2026-10-06 · Re-pinned to v0.11.97 (5ee4175), the rest of upstream's silence batch; upstream's changelog says its pixel-moving changes move to 0.11.98, so the notes due 0.11.97 (an SC with `sov` takes a `so` passed down; an astral name inside an expression) stay, expected 0.11.98 (that 0.11.97 lacks them is checked in its source; the 0.11.98 date is upstream's plan) (§3, §4, §6.3). The mod refuses a `{` never closed, at the line that opened it, and a `}` that closes nothing, as the src parser already did, and names the character an op cannot start with. It reports a `fmt` its `Printf.Translate` hands back unchanged that is not one `{0:…}` between braceless text, so the `fmt-as-written` and `fmt-empty` traps go and `fmt-brace` keeps what it leaves unreported (it also reports `{0} kPa`, which prints the number, and a `fmt` on a label that formats no number: reports for upstream, which the preview shows with the problem border until they are fixed; the C# suite holds the misreported formats to neither side). A placeholder's own format follows the first `:` outside its index, so a `]` in it is literal. The 18 examples draw byte-identical frames at both tags.
- 2026-10-06 · Re-pinned to v0.11.99 (2f3bad3), with v0.11.98 (the pixel batch) under it (R9; the commits were pinned before their tags were pushed, and the tags resolve to them) (§3, §4, §6.3). The notes expected 0.11.98 are settled: an `SC` reads its scroll offset from its own map, so its `sov` needs its own `so` (the provisional note and the passed-down `so` requirement go), and a name inside an expression takes a supplementary-plane character whole, which the traps, the panel's data names and the colour-expression check now read. An `IMG` reads a per-corner `rx` list; `^` with no value is 0; an `fl` weight that is not bold, normal or a number is reported. The mod reports a def op in a clip (0.11.99), so `clip-extra` keeps only a node inside the clip's shape. A placeholder prints the `missing` text for a format its number cannot take, where the scene used to fail: the new `fmt-float` trap, apart from `fmt-brace` (a placeholder formats a float, so `{0:D3}` and `{0:B}` too). New traps `p-odd` and `p-few` (measured at 0.11.97 and 0.11.99): a point list with an odd number of values drops the last one, an `L`, `Y` or `SP` with fewer than two points draws nothing, a `Y` with two no fill or shadow. The raycast filter (a clickable element answers only over a hit region or a scrollable viewport) needs no port: the preview has no pointer input. Upstream held back the `LS` paint-scope fix. No example draws differently: all 18 drew byte-identical frames at 0.11.97 and 0.11.99.
- 2026-10-06 · R9 review: a placeholder's `X` first makes its number a long only where the `fmt` splits into one `{0:X…}` between braceless text; one that does not (`%x {0:D2}`) prints the `missing` text at the pin, an upstream fault (the long is lost in a conditional C# types as a float), handed over with no trap and read as a long. `p-few` counts the points the mod draws: a `p` that is not a list has none, and points all at one place draw nothing (a `Y`'s two-point rule stays on the points written, since three points of which two are one still cast a shadow). A list key's entry that is not a number (read as 0) and a single number on `dash` (a solid stroke) are `literal-only` traps (§4).
- 2026-10-06 · M2a R8 and R9 merged into M2b (v0.11.99). A widget's `fmt` may hold `]`: a placeholder's own format follows the first `:` outside its index since 0.11.97, so the builder refuses braces only, and reads a label's data names by the same rule. An expression slot takes a supplementary-plane name, as `ReadName` does since 0.11.98. The natives stay above the vector element, which since 0.11.98 takes the pointer only over a hit region or a scrollable viewport and passes it on elsewhere; the in-game checklist keeps that check, since nothing offline can test it (§5.1).
- 2026-10-06 · M2c Task 10b (rulings from Wave 3's reviews): a widget resized with Shift past the opposite edge stops at its module's minimum on the leading axis, held where the other axis reaches its own minimum, and the other axis follows, so the ratio holds (it was flipped into [100,-300,36,900]); the snap acts on the drag box where the pointer is, and a lead that crossed snaps nowhere. A named style and a style paste never rewrite a `theme_` gradient def the page has, only add one it lacks; a theme switch, a load and an edit of a widget that paints with it still write it again (§4).
- 2026-10-06 · M2c Task 10b re-review (rulings restated): ruling 1 is a side handle's. With Shift, a side handle dragged across the opposite edge stops its axis at the module's minimum and the other axis follows the clamped lead, so the ratio holds. A corner keeps its behaviour: its following axis never flips, so with snap on a corner whose follower crossed its anchor no longer collapses to the minimum (the snap had acted on the flipped edge: 17 of 6000 random drags). Ruling 2: a named style and a style paste never rewrite an existing `theme_` def, only add one the page lacks; only a theme switch refreshes `theme_` defs, and loads and widget edits keep their existing behaviour (§4).
- 2026-10-06 · Canvas editing built (M2c): one registry of tools and commands; snapping, layout, bounds and transforms as pure functions; expressions never overwritten; rotation, group scale, point handles; hide as v=0, lock as # lock, image placeholder; picking where nothing is drawn, labels paired by geometry, ztext order in picking (§4).
- 2026-10-06 · M2c rulings written into §4 "How the editor does it": undo brings back the selection from before the edit and redo the set the edited project had (merge gate F1); the status area and the breadcrumb keep a fixed height (F2); frames carry the scene they were drawn from, and a press reads the numbering only while it has the current shape (F3); the grid step is whole design units; a group's `s` is written to 6 significant digits; a gesture dragged back to its start keeps its press's selection, and Esc on an open gesture brings back the project and the set at its first step. Boxes are exact geometry (a path's Bézier and arc extremes, a curve's drawn samples; plan P9), not stroke, shadow or glow, and every editing command reads them. A snapped value is whole except where an object or page line puts it and where a Shift resize keeps a plain node's ratio (fractional, to 3 decimals); `# lock` rides with its node. Owner questions 1-6 run on their defaults (refuse, never wrap, an expression; rotation beyond `G`; hide as `v=0` and lock as `# lock`; the image placeholder and per-browser settings; no multi-selection resize or rotate; labels on top in the preview) until answered; question 7 was kept (§4, §11).
- 2026-10-06 · M2c final review: a style paste or a named style replaces an expression or `$data` value, as the user's explicit act, and says how many; the plan made this exception for Task 9 ("the user's explicit act"), but §4 and the digest had left it out, so they contradicted the code (§4).
- 2026-10-06 · M2c final fix round (the final review): no id a copy gives (duplicate, paste, a clip copied with it) holds a native's uid or has a widget's or a native's uid as its stem; such an id becomes `<uid>copy<k>_…` (Q14), and a duplicated member inside another goes with that one's copy. A group is read at any scale the mod draws, by one singularity rule for picking, chains, boxes and moves. The padlock shows only where a move moves nothing. A widget root's box is its params box for the marquee and snapping too, and the snap targets take each root block's own box. A press sees through a locked node; lock holds the geometric edits only, and on a set hide flips each member while lock sets all one way (owner questions 8 and 9, on their defaults). Show all and Unlock all leave a widget's own nodes to its module. A Shift side-handle resize snaps its dragged side as any edge (the earlier wording held for corners only) (§4, §11).
- 2026-10-06 · The owner answered the M2c questions: refuse an expression (Q1), rotation that turns points and wraps other leaves (Q2), hide as `v=0` and lock as `# lock` (Q3), the image placeholder and per-browser settings (Q4), no handles on a multi-selection (Q5) and the whole-unit grid stand as built; Q6 changes: the preview draws a shape drawn after a label over it, as the game does under `ztext` (a cover pass over the text layer), to build (§4, §7, §11).
- 2026-10-06 · Owner request: page shapes for the MoreConsoles 2×2, 3×2 and 3×3 consoles and their vertical variants. Each surface is its prefab's canvas size (`ModConsole.ScreenSize`, which `ConsoleBuilder` builds from the bezel opening at a canvas height of 460), rounded, and a style whose rounded size differs gets its own shape: 2×2 and 3×3 one each (Rugged and Bulkhead agree), 3×2 four (the vanilla-derived 3×2, Panel, Rugged, Bulkhead), and the monitors of the three footprints six. A vertical variant is the console placed a quarter turn round (the mod swaps the screen's rect), so each flat shape has one, its px and units turned. Design units are 480 per cell of the console's height (a vertical page's width), the other side keeping the px aspect, so they differ from a shape of the same aspect (a 2×2 is 952×960, not the square's 480×480). The sizes are read from the mod's prefabs, not yet with `ui:size()` in game (§5.4).
- 2026-10-06 · Page shapes fix round (the re-check): the owner's 2×2 and 3×3 consoles are LargeConsoleMod's (Steam Workshop), whose surfaces read 460×460 in game, so they get their own shapes, 960×960 and 1440×1440 units, and no vertical one (a square turned is itself). The monitors are turned too: every MoreConsoles monitor is face-mounted with `ModConsole`, as the other consoles are, so the 2×1 monitor and the six MoreConsoles monitors each get a vertical shape; nothing had shown they cannot turn. The sizes were read in game where a chip sat in the console (`ui:size()`), and §5.4 marks each shape as read in game or from a prefab. `ui:size()` reports the fraction (1035.69983 for the 2×1), not a rounded 1036 as §5.4 had said; the page keeps whole px (§5.4).
- 2026-10-06 · The owner kept one picker entry per distinct surface size, not one per footprint and kind: the real console sizes differ (§5.4).
- 2026-10-06 · Re-pinned to v0.11.101 (785ca65), with 0.11.100 under it (R10) (§3, §4, §6.3, §9). The mod formats a sample through each `fmt` a number goes through, a placeholder's own included, and reports one that prints the `missing` text or itself; a `fmt` on a label that formats no number is not checked, and `{0} kPa`, `{0,6:0.0}`, `{{{0}}}` and `{0:}` are no longer reported. So `fmt-float` goes and `fmt-brace` keeps a `fmt` that prints other text with no number: a format item with no digit, over every `fmt` now (`{0,5:abc}` is no longer reported), and braces that make a printf conversion literal (`{%.1f}`). `{{0}}` and `x{{y`, braces with no conversion, are no longer reported either, but REFERENCE.md says a spec with no conversion is: for upstream, no trap, the reference the provisional tie-break (reversed in the R10 review, next line). A placeholder retries a format as a long, so `{0:D3}` and `%x {0:D2}` print there as on a whole binding, and the "upstream fault, no trap" note goes. `p-few` counts per paint (a stroke two points, a fill and a shadow three): an `L`'s or an `SP`'s own fill with two points is a trap too (the `SP`'s draws only its feathered edge: the mod leaves a two-point ring open, REFERENCE.md says it encloses a sliver), and the advice asks for three points only where the node fills or casts a shadow. Upstream saw the inherited `so`, the `fmt` rules, hex and the point counts on a console; the raycast filter and a wheel over a short list's empty part are not yet seen (§9). `ver` is 1201: past patch 99 it is no longer one-to-one (0.12.1 will be 1201 too), for upstream.
- 2026-10-06 · R10 review (§4): `fmt-brace` traps braces with no conversion again (`{{0}}`, `x{{y`, `{{`, `%q{{`): the mod's check compares the output with the spec, so it leaves them unreported, and the reference's "a spec with no conversion prints itself and is reported" is measurably wrong on its first half for them (`{{0}}` prints `{0}`), so the reference is no tie-break here; the brief keeps `fmt-brace` for what the mod leaves unreported, and the trap goes when the mod reports them. A two-point `SP`'s fill draws at most its feathered edge (nothing level or upright, measured). Not counting a fill passed down to an `L` or `SP` in `p-few` is provisional, for the owner to rule (from three points the mod fills it: 4046.9 px² against 675.1). Since 0.11.100 a placeholder's own format with no conversion is reported (`''`, `%%`, `50%`, `%é`, `]`, which the M2b widget `fmt` sanitizer passes): a task for the M2a→M2b merge. The items marked "for upstream" have not been handed over yet.
- 2026-10-06 · The owner kept M2c questions 8 and 9 as built (on a set, hide flips each member and lock sets all one way; lock holds only the geometric edits) and whole px for a page's size, `ui:size()`'s fraction rounded to the nearest (§4, §5.4).
- 2026-10-06 · The cover pass built (Q6): the core runs the mod's own cut (`TextOrder.Assign`) and gives each frame label `cover`, the first vertex drawn over it (a later shape whose bounds overlap its box under `ztext`, else its element's end; every later element covers it). A second WebGL canvas over the text layer shows, in each covered label's box, the canvas's colour at the alpha of what is drawn after it, through the same linear RGBA8 target, premultiplied (straight alpha seamed where the browser filters the canvas). Exact for opaque covers, approximate for translucent ones; `ztext=0` keeps a label on top of its own element (§4, §7).
- 2026-10-06 · The cover pass, fix round before merge: a label whose `cover` is not a number stays on top (a NaN one hung the layering); picking under `ztext=0` follows the cover, so a later element wins a press over a label as the preview draws it; the glyph overhang past a line box is measured on the bundled faces and stated as a known limit (§4, §7).
- 2026-10-06 · The cover pass after review: one canvas over the whole text layer hid a label drawn after a covering shape inside a covered label's box (a button's label over a text label) and left text past its box uncovered. Now the covers stack among the labels in the game's draw order (layers by `cover`, the text layer its own stacking context; a label nothing is drawn over on top), a region joins the box with the text the text layer laid out, stacked covers multiply (a stencil), and picking takes the label drawn last by its cover where label boxes meet, a label of unknown `T` placed by its cover. Exact for opaque covers wherever a label's ink lies in its region; under a translucent cover the text shows through by exactly what the geometry leaves, in the canvas's colour, blended in sRGB, about 30 levels per channel off at alpha 0.5 (§4, §7).
- 2026-10-06 · The owner answered three M3 planning questions: no `Tone` (§5.2's project-level token rule goes; a read's thresholds give the state integer) (Q12); only the generated catalogue JSON is committed, never `ic10-devices.md` or the live dumps (Q16); pushes for M3's probes and in-game checklist go to one of the chips the owner keeps in the save for testing, without asking again each time, which chip confirmed with the owner once, when the probes first run (Q20) (§3, §5.2, §8).
- 2026-10-06 · The owner answered M3 question 19: the device catalogue is generated from the game's own Stationpedia export (StationeersStationpediaExtractor's `Stationpedia.json` and `Enums.json`, build 0.2.6428.27798, kept local), which numbers every enum member. The M3 plan's rulings follow from it: `ic10-devices.md` stays as the cross-check and names the vanilla devices, the MCP crawl goes, the in-game enum probe stays as an optional cross-check (§3).
- 2026-10-07 · M3 planned: the live data model (roles, reads, state, click actions, latched rules, bindings, custom Lua, simulated devices, settings); one runtime library (`VB.LIB = 1`) with generated config; lazy page builds with two data elements; the Devices page from widget modules; a clean-room StationeersLua host from the public docs; the catalogue generated from the game's Stationpedia export (§2, §3, §4, §5.1, §6, §7, §8, §10, §11).

- 2026-10-11 · Devices page: SAVE keeps a role's saved pick while the role has no device on the network, and boot opens the Devices page first whenever a required `one` role is unresolved, whatever else was saved (seen in the M3 browser checks: a saved state kept a new unresolved role from ever being picked) (§6.1).
- 2026-10-11 · Preview source-key changes reload the chip because live Sim messages replace or add sources without deleting them; ordinary value changes stay live. Sim duplicates clear their label and pin, and added LogicType names are validated against the catalogue (§7).
- 2026-10-11 · The earlier missing-style ruling is superseded by the source-verified font-model correction in section 5.3 (§5.3).
- 2026-10-11 · Label cover regions include per-line glyph ink beyond DOM line boxes. Missing or non-finite covers leave labels on top; equal covers draw and pick the later frame-list label (§4, §7).
- 2026-10-11 · Browser-check follow-up: cover selection uses measured ink as well as the T box, from core-exported shape bounds and label insertion vertices; picking uses the displayed cut. Measurement is incremental, with font loading, zoom and surface-size invalidation. The 200-label control and update counts are recorded in docs/m2c.md (§4, §7).
- 2026-10-11 · Sim value names are validated against a loaded catalogue; while it is loading or after loading fails, any non-empty name can be added, as for an unknown prefab (§7).
- **2026-10-11 — Font catalogue corrected from ScriptedScreensFonts 0.3.0.0.** Bundle all 36 Barlow/Barlow Condensed faces lazily from the official OFL release; Manrope and Inter are custom imports only. All source glyphs and GPOS survive conversion; missing codepoints use browser fallback with no glyph warning. Font files and licences at that change: 613,958 B before, 1,755,682 B after (+1,141,724 B). The style and spacing rules are refined in the decision below.
- 2026-10-11 · Custom Lua global-write checks distinguish locals, fields, strings and comments; the custom block has its own local scope. A page chosen by `U.init` survives boot, with unresolved required roles still opening the Devices page first (§6.2, §6.4).
- 2026-10-11 · Host parsing skips a device sharing the housing ref with a warning and keeps the remaining configuration; malformed JSON and duplicate device refs remain fatal. The bounded lost-write diagnostic remains at the shared flush boundary for runtime and export tests, without a preview status field (§7).
- 2026-10-11 · TMP live/source font corrections (§5.3): face names do not move slots; real italics draw as is; missing styles use current-face glyphs with explicit 0.35 shear and outward faux-bold stroke (0.0196/0.0195 em), plus base-size spacing. Relative sizes use base size; tag cspace uses label units or current-size em and has no final tag gap. No-font T has empty slots; remove unused Liberation Sans Bold. Font loads invalidate only dependent labels. Documented ow stays unchanged; exact glyph pivots, shrink sizing and wide-outline bold reduction remain open. Chrome run slopes match 0.35/0.60/-0.35 with identical advances.
- 2026-10-11 · Re-pinned to v0.11.112 (24409df), ver/floor 11112 with major*1000000 + minor*1000 + patch; the banner remains the only guard. Numeric free text, final fmt/escape/enum/report rules, inert absent data and unbounded cardinality replace the earlier rules (§§3–4, 6.3–6.4, 9). Page FONT uses metadata names/slots, explicit active-page click-to-load consent and preview-unsupported direct-file defaults, isolated decoding, representative metadata/lazy subsets, deterministic exports and informational global counts (§§5.3, 8). Owner-supplied unpublished Fonts 0.4.0 settles HTTPS/no redirects, hosts, local > bundled > earlier page precedence, API minima and face counting; only 0.2.0 publication is confirmed. Served-file names match Orbitron/Roboto but not Noto Sans JP; fail its preview naming with fallback/export intact. The author settled nofill in favour of code and will correct ow in 0.11.113; browser descriptor/axis, subset/fault-isolation observations and replacement 18/19 captures remain pending (§§8, 11).
- 2026-10-11 · Replaced the family-specific page-font refusal with metadata-only default-style family derivation (§5.3). Eight additional served variable families at 400;700 all match static TTF names after derivation (24 native-read files; six non-Regular defaults), and the original Noto Sans JP profiles now match too. ID16 wins; an unresolved non-Regular legacy family still fails with fallback/export intact. The earlier Noto-specific refusal is superseded.
- 2026-10-11 · Integrated page-font registry/UI/export and fixes (§§5.3, 8, 11): exact metadata aliases/slots, fixed single-weight descriptors, isolated browser family names, lazy subsets and settled local > bundled > earlier page > fresh request precedence. ID16 wins; absent ID16 uses the metadata default-style suffix derivation, with ambiguous naming refused. All twelve recorded comparisons across eleven distinct families match sampled game-static names after derivation, superseding the initial raw Noto mismatch above. Explicit active-page Add/Load/Retry, preview warnings and deterministic capability requirements are built; loader cancellation reaches the isolated reader. Boot has 60 seconds, reads have 5 seconds only after ready, and ready workers are reused. Supplied Chrome measurements establish consent, representative/alias registration, startup/read samples and off-host CSP blocking; no visual geometry or in-game example/capture result is claimed. Obsolete widget RP caps are removed. Shadows/hairlines/Panel well/Bar, example 19 in game and new 18/19 captures remain pending.
- 2026-10-11 · Wave review registry fixes (§5.3): notices follow link generations/local names and expire on cancel, final declaration removal, local replacement/removal or project replacement; cached faces remain. Removed/superseded imports report their real cause. Variable aliases retain defaults on axes not selected by the weight/style group; recorded two-axis Roboto metadata excludes nine condensed instances. Regression tests kill the different-face notice, aborted-observer and abort-rollback mutations.
- 2026-10-11 · In-game rendering and its measurement (FPS, the cost of hidden surfaces) belong to the vector mod, not the builder (owner): probe P8 and Task 21's single-surface mode are dropped, and exports keep one surface per page (§6, §10).

- 2026-10-11 · Task 19 measurements folded in (§§6–8, 10–11): absent-type reads raise despite the third-party Logic API's nil documentation; unknown refs return nil and read-only writes raise unchanged. Device display names/hash, housing exclusion, retained stores/halted writes, load surfaces, resolution, JSON/constants, empty batches, player-name events and AM/PM settled. The shipped load limit is 50,000; the builder assumes the beta correction required before release, 500,000 load/50,000 tick with no warning. Examples' appearance is never a defect; Devices appearance belongs to the console author, and the forced layout correction is reverted. The 1×1 run judges behavior only. Gradient-panel capture whitening belongs to ScriptedScreens capture serialization; a version-0 capture shows the world behind as expected. P8 is out of scope, P5b skipped; P17 and fallback remain open.
- 2026-10-11 · Export rebuild correction (§6.3): changed eased values restart a glide, rebuilding each frame up to 60 Hz for 0.05–1.5 s, as explained from source by the vector mod's author. Histories/counters/text snap; only moving geometry eases. Half-pixel deadbands on bounded normalized geometry and equal-float32 filtering elsewhere compare against the last sent value. Offline paired measurements are in the M3 report; no new in-game rebuild rate is claimed.
- 2026-10-11 · Direction (owner): VectorBuilder is a general vector editor in the manner of a combination of Illustrator and Figma, with extra options for consoles (data, logic, pages, devices, export); it is not built around the owner's consoles or any one design system. A set of widgets and the provided themes stay; a widget's look comes from the theme, never from options copied from particular consoles (the Panel's well/hairline looks and corner marks came from the owner's console corpus and are under review) (§1, §5.1, §5.2).
- 2026-10-12 · Direction refined (owner): Illustrator and Figma are an inspiration, never a specification or a feature checklist ("i said inspired!"); the owner's consoles and the fixtures made from them are examples, judged by behaviour, never by how they look (§1).
- 2026-10-12 · Editor audit answered (owner) and E1 set as the editing milestone before M5 (§§1, 2 D11, 4, 5.1, 5.2, 8, 11): looks from the theme ("exactly": paint parts, theme metrics, neutral default texts, the Panel's `look` and `marks` removed); a Neutral default theme on Liberation Sans with Vanilla + kept, with "a widget also needs to be editable" read as an addition (editable widget instances; the reading is E1 plan OQ1); styles follow the theme; zoom and pan; a layers panel and group-first picking; the pen at low priority; paint controls and "the padding the mergins the lot" (layout; the reading is E1 plan OQ3); the M4 changes. Also: the five recoloured presets are dropped ("no need to keep them"); multi-selection resize and rotate ("yes yes"), superseding M2c Q5; the Flow duct rebuilt on an animated-dash stroke; a Gauge widget beside M4's shapes-only Needle gauge starter, with more widgets after 1.0; E1 before M5's import; the Devices page generated with the theme's looks, an editable one later. Whether a theme may change a widget's anatomy, so the owner's other complete designs can become themes, is E1 plan OQ2.
- 2026-10-12 · Gas colours (§5.2): to "arent this game defined?", the game defines a colour per gas in code and draws coloured gas icons; none of Vanilla +'s 17 `gas-*` tokens matches a readable game colour. Gas colours are game facts shared by every theme, held outside the themes; their exact values and source stay open. The tokens stay Vanilla +'s own, neither required nor game facts.
- 2026-10-12 · E1 plan defaults, which the owner may overturn (§§4, 5.1, 5.2): Neutral leaves the `T` `font` out (the game's own face); a theme id this build does not provide draws in the default theme with a notice; ordinary groups may hold widgets; a code-pane edit inside a widget still detaches it; part overrides never touch ids, events, clips, masks or text; Use as default is kept per browser.
- 2026-10-12 · The owner answered the E1 plan's three questions (§§1, 2 D11, 3, 4, 5.1, 5.2, 11). OQ1, instance overrides with Detach for structural changes: "default". OQ3, live layout on groups: "default". OQ2, whether a theme may change a widget's shapes: "yes but not necesaly for my design we decided at the beging users willbe abel to import design system/themes from claude design". So themes gain anatomy: per hook, shapes added to a part, a part's shape replaced, or removed. Its reason is M5's design-system import, not the owner's own designs; no provided theme uses it in E1. It is built in E1 (the E1 plan's placement, not the owner's words), where every module is rebuilt onto the theme contract. Imported anatomy is outside input and keeps the mod's rules: fills that cannot cross themselves, literal point lists, no paths, clips or masks. A label keeps its text; a part that shows a value by its size or place is never removed; a theme's ornaments are parts whose paint and visibility are overrides and whose place follows their part. The "Not in v1" line on per-theme anatomy goes.
- 2026-10-12 · Recorded E1 implementation rulings (§§4, 5.1, 5.2; provenance in the E1 plan): anatomy rule E2 judges declared slots on the undressed module and read names on the dressed result; the native icon keeps its O2 subject; Vanilla + keeps hero.unitY 85.5 while Neutral uses the font-line rule; turned-child stretch changes only the nearer cross-axis local scale and reaches a fixed point. The icon-without-item and both baseline comparisons remain unobserved in game.
- 2026-10-12 · The E1 plan's six lows rulings are implemented (§§4, 5.1, 5.2): two-layer gradient switch crossfades; unused theme-gradient pruning only on a theme switch, with page references and custom-Lua mentions preserved; four quarter arcs for full-turn Gauge tracks, keeping authored needle/tick sweeps; position/fraction part names with absent and legacy index overrides dormant; text ornaments before the first label in their sibling scope; no value-import cycles, with shared helpers in leaf modules. Provided-theme output changes and offline evidence are listed in docs/e1.md; browser and game checks remain pending.
- 2026-10-12 · M4 implementation integrated alongside E1 (§§3, 5.2, 6.5, 8, 10, 11): accepted Q6/Q13 use explicit Check export, separate exact-artifact Download/Copy and a labelled incomplete-only unchecked escape that never bypasses known errors. Export-only UTC/version and default-on final project block; one JSON/gzip codec, whole-URL 8,000-character sharing rule, current/displaced-current recovery with optimistic revisions, startup reads and durable fragment consumption. R13 removes p before decoding, rejects non-producer links and dishonest/oversized declarations, enforces real engine string limits and keeps files in the worker with Stop/retry. Seven independent starters follow both provided themes; the shapes-only gauge remains separate from E1's widget, Airlock's continuous manual consequences and Solar's raw unverified units are explicit. Browser caption failures were fixed in starter data without changing themes or outside-example fidelity. Exact generated artifacts, a fresh core, actual Chrome checks and eight measured sharing-size rows are recorded in docs/m4.md. Historical P16 remains the only game source-size range: console/new embedded-block acceptance, manual browser checks and another engine are PENDING. M4 is not complete; no deploy, send-to-chip panel or M5 adoption is claimed.
- 2026-10-12 · Wheel (owner, "ok" to the recommendation) (§4): a plain wheel or a two-finger scroll pans the canvas, Shift + wheel sideways; Ctrl/Cmd + wheel zooms at the pointer, and so does a trackpad pinch where the browser sends it as Ctrl + wheel; Space-drag still pans. Previously every wheel zoomed.
- 2026-10-12 · Icon catalogue (§5.1), owner: "we should make an atlas of all icns ingame for them to be used in the builder (whitout actualli redistributing the ingme assets)". Names only, no game images. Measured: `ss.ui.icons` has gas 39, slot 44 and prefab 100 entries, no resource table; Oxygen maps to `gas:Oxygen`, CO2 to `gas:CarbonDioxide`, Chip to `slot:ProgrammableChip`, ActiveVent to `prefab:StructureActiveVent`, and prefab GasOxygen to `gas:Oxygen`. O2 is absent and draws a white square; a table-resolved Oxygen draws its hazard diamond. The default is now Oxygen, superseding the earlier O2 subject ruling. The runtime resolves available entries and keeps other names unchanged, with explicit icon_type. Raw canonical names with explicit icon_type are documented by the guide, still unmeasured in game; the default export and the public build's icon tables await in-game checks.
- 2026-10-12 · Repeater row names (§5.1), owner on a captured Devices row: "why is it some empty sapce on the right and the name truncated if it would have fit?" A row without a value gives its name the value column and gap, ending at the right padding; a row with a value keeps its columns. The runtime sends a snapped per-row hasv flag for every drawn row, derived from normalized values, for data-bound repeaters and Devices alike. Implementation ruling: an unsent flag reads 0 in numeric and visibility expressions, so a separate snapped ready signal guards one name label's clamped width and the value label's visibility; unsent flags keep the old layout. Fixed offline, pending in game.
- 2026-10-12 · Gas icon colours (§5.2), owner: "does this help?" with the gas-icon image and wiki colour-coding table, and "there is no distinvtion on liquid and gass colors". E1 Task 19 is settled: sixteen exact icon fills and symbol inks, with their source, live once in catalog/gases.json; liquids share their gas's colours, Steam shares Water's, and aliases resolve through the icon atlas names. Split icons retain both halves; a single-colour use takes the left half (defaults told to the owner, who may overturn them). Mixtures stay out of v1. Shared gas.<Name>, gas.<Name>.2 and gas.<Name>.ink colours and gas style links hold across theme switches; Vanilla +'s own gas-* tokens stay unchanged. Icon colours are not code tints.
- 2026-10-12 · The owner answered the M5 plan's questions (§§5.2, 6.5): OQ1, where an imported theme lives: "ok" to (c), in the project that uses it and in a per-browser list of imported themes; OQ2, an adopted script's Lua: "ok" to (b), the artwork plus the script kept verbatim as a custom-block comment that never runs (this replaces "Their Lua becomes the custom block"); OQ3, the worked example's data files: "sure", the owner's Vanilla + `tokens.json` and `components/bundle.css` are committed unchanged as the importer's test fixture.
- 2026-10-12 · Editor UI (owner, in the UI redesign work) (§1): modal dialogs are allowed: asked about §1's "Not in v1: modal dialogs", the owner: "who decided this ?:)) this is not a constraint" (the line came with the spec's first draft and had no owner decision behind it; removed). The editor chrome is Vanilla + drawn at 50 % of its token sizes, smallest text 12 px (1:1 "would be too large"); the scene source pane is open by default ("opened"), docked under the canvas; simple line icons for now, to be refined a little later.
- 2026-10-12 · Editor UI, later the same day (owner, in the UI redesign work) (§1): the code pane uses a monospace face (owner: "for code sure a monosapce font, your pick"; the pick is JetBrains Mono, SIL OFL, bundled as woff2 and never fetched); New/Open, Share and Fonts become dialogs (owner: "yes they can become dialogs that would actually be the best way"). The redesign mockup also proposes modal Export, design-system Import (a wizard), Adopt (a wizard), Keyboard shortcuts and the autosave-conflict and start-up recovery choices, for the owner's review.
- 2026-10-12 · Editor UI, settled (owner: "pls do i also agree to the others") (§1): the modal dialogs are New and open, Share link, Fonts, Export, the design-system Import and the Adopt wizards, Keyboard shortcuts, and the autosave-conflict and start-up recovery choices; Blank project and Wipe persist now ask for confirmation first (a behaviour change: Blank project moves the saved project to recovery, replacing the recovery project; Wipe persist clears the chip store's persist and tells the running simulation; Cancel holds the focus and Esc cancels).
- 2026-10-12 · Editor UI (owner, on a Close button for the start-up "Choose a project" dialog: "might be a good idea") (§1): the start-up choice gets Close; Close and Esc do what Continue without autosave does (the pending project opens, nothing is written to storage). A behaviour change for the redesign build: today the start-up choice cannot be dismissed. Closing the "Not saved" dialog keeps autosave paused, as today.
- 2026-10-12 · M5 integrated on `m5-imports` (§§4, 5.2, 5.3, 6.5, 8, 11; `docs/m5.md`): the image placeholder becomes an `IMG` when given a source; the mapping as built (type rules by the style's own name, any fill child of a track, unrepresented borders listed, colliding token names renamed and reported, distinct display names, only player-set widget defaults); design-system font files only on an explicit click, only the faces needed, never replacing a local face; adoption as built (offer, disposable capture, pages named by surface, literal-looking text as samples, the report kept until dismissed); pictures only on Load pictures, HTTP errors and texture limits named; design-system links fetched only on Fetch, redirects refused. No provided theme or codegen fixture changed.
- 2026-10-12 · Editor (§4): nothing in the chrome mounts, unmounts or re-wraps when a gesture starts or ends, and every gesture keeps its press's canvas origin and view, so the canvas never moves under the pointer. The M5 browser walk found every drag landing off by the header's re-wrap (the export controls unmounted during drags), pre-existing since M4's integration; fixed on `m5-imports` and confirmed with real mouse drags.
- 2026-10-12 · Measured in game (vector 0.11.115, ScriptedScreens beta) (§§4, 5.1): an icon with `icon_type` gas and a raw name (`Oxygen`, `Nitrogen`) draws the same sprite as the `ss.ui.icons` value; an empty shadow list `sh=[]` draws nothing and reports nothing, so the builder no longer warns about it.
- 2026-10-12 · Re-pin timing (owner, asking "Can the repin be right before deployment?", agreed) (§§3, 11): the next re-pin is the last step before the public deployment, to the newest tag then, with its own review and in-game check; M5 merges into `main` without waiting for it. Nothing M5 built depends on vector 0.11.113 to 0.11.116 (the picture code is unchanged), and the game ran the 0.11.112-targeted exports cleanly on 0.11.115. Meanwhile the preview keeps 0.11.112's dashed-stroke freeze, fixed upstream in 0.11.114.
- 2026-10-12 · Editor UI, the redesign plan's questions (owner: "Defaults sound fine") (§1): one page on the canvas at a time, switched from the Pages list, with the frame look (not all pages as frames); the import panel hosted unchanged in a scrolling "Import a design system" dialog, no step wizard; the developer items (Open example, Example scripts, Compare) stay in every build under Help › Developer, marked DEV; node-id rename stays in the Layers row, with reference carry-over; no bar appears with a gesture (the pen bar is left out), so the canvas never moves under the pointer. The owner: "we will surely do a cleanup pass as i will find what i need/want the best while working with it" (after the redesign merges).
- 2026-10-12 · The owner answered the M6 plan's twelve questions, all with the recommended defaults (§§3, 6.3, 8, 11): Send to chip in the Export dialog behind a per-browser "Show Send to chip (advanced)", at the fixed `http://127.0.0.1:3030`, one explicit click per send with no backup; CI on pull requests and pushes to `main`, the deploy only from `main`; the project site `https://<owner>.github.io/<repository>/`; a fresh public repository that starts at the launch commit, this one kept private; the owner publishes the pinned vector version (or newer) to the Workshop before the deploy and the floor stays the pin; no code split before the launch, the first load measured on the deployed site; MIT, holder line "Copyright (c) 2026 Gruffus" (the owner: "it is gruffus with one S"), plus third-party notices; M4's real-device items tested in the re-pin's game session on a save with those devices (the owner: "still do not get how this is an issue for the builder, again as i said before the code should be correct and match my examples but fine"); polish is the player-facing texts, the README and M4's leftovers; the builder version stays 0.4.0.
- 2026-10-12 · Airlock starter (owner, 2026-10-12: "yes it should kinda match that", matching his own working airlock console script) (§8): it opens one door at a time, once the other reads shut and settled (Open 0, Idle not 0, 1.5 s after its close command), an unbound door counting as shut; holds both doors in Logic mode (Mode 1) and unlocked (Lock 0), written whenever a door reads otherwise; writes Open and Setting together; a door's own button asks for that door; boot leaves the doors as they are (each door's Setting adopts its Open; if both are found open, the inner one is shut). This replaces "continuously commands the selected doors, initially closes both and overrides manual use, requiring Logic mode". Still no automatic pressure cycle and no safety claim; real doors are still to be seen (docs/m4.md).
- 2026-10-12 · Distinct roles (§6.1): a role may be marked `distinct: true` (it acts on `one` roles). Such a role never takes a device another distinct role holds by its pick, saved choice, label, pin or ref; a device two distinct roles reach the same way goes to neither; the Devices page's tap-to-pick skips a device another distinct role holds. Roles without it are unchanged. The Airlock's two door roles use it, so one airlock on the network never binds both.
- 2026-10-12 · Reference ids (owner: "you keep referencing the ids, (even in the builder) those are never in any way visible to the player") (§§1, 6.1): no player-visible text shows a chip, device or network reference id. The generated Devices page rows now show names only ("Gas Sensor", "Tank (2 share this label)"), where they showed the device's reference id; ids stay internal. Still to change: the editor's own simulated-device panel and role ref field, which belong to the UI redesign.
- 2026-10-12 · UI redesign scope (owner: "it was never optimized for mobile yet and it is not in scope for today") (§1): mobile is out of the redesign's scope; phone-width checks and phone-layout issues are not part of it, and mobile optimisation is a later item. §1 now also states the Editor UI decisions logged above, which its body had lacked.
- 2026-10-12 · Measured in game (§5.4): a standard landscape 2×1 console (the same prefab as the others) rotated in the world renders its screen portrait, at 460×1036, so the builder's vertical 2×1 shape matches it; that size is the owner's mod's own.
- 2026-10-12 · Third-party notices (owner: "keep it yes") (§2 D18, §8): THIRD-PARTY-NOTICES keeps the vendored vector mod's MIT copyright line, "Copyright (c) 2026 Gruffuss", which MIT requires to be reproduced; `.gitmodules` already names that repository. It is the stated exception to the rule against account names in committed files. VectorBuilder's own LICENSE holder stays "Copyright (c) 2026 Gruffus" (one s, the owner's spelling).
- 2026-10-12 · Reference ids in the editor (owner's choice for the UI redesign, relayed the same day) (§§1, 6.1): the role's ref field moves behind a collapsed "Advanced" disclosure labelled "Pin to one specific device", the only place the id shows, and saved projects keep their value; the simulated-devices panel's "ref N" and the write log's "ref N:" become device names. This settles the editor part the ids rule above left open.
- 2026-10-12 · The owner answered the M6 plan's game-link questions OQ13–OQ17 (§§6.1, 8): picking a device writes its prefab into `prefabs` and its Labeller name into `label`, never its ref ("exatky"; on writing the ref: "never with id as those change on device rebuild", so a device's ref id changes when the device is rebuilt); a link points at one chip, picked from the game's list or taken from the open IC editor in one click; it drives Send's target, the device picker scoped to the linked chip's network with live names, and the page shape, offering the linked console's screen size as the current page's shape with the player able to override it (OQ15 (b), "but with the ability to overide", not the recommended (a)); Send to a linked chip always passes `editor_then_chip`; the link is a "Game" status-bar item and lasts for the tab only. The owner's go for the plan's Task 9 game session: "you can use the game yes and change the setting is you revert the ghanges after".
- 2026-10-12 · The mods an export needs (owner, three messages: "the dependencies are kinda wrong as it requires stationeers lua, stationeers scripted sceens , scripted screens vector and maybe the font mod", "And maybe hyperlinks to the workshop items", "The stationmers launchapd i assume"; then "Yes ic10editor should be on that list") (§8): the header's Requires line names, in load order, BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens, ScriptedScreens Vector (the floor "or newer") and, only under the existing font condition, ScriptedScreens Fonts, and a comment line per needed mod gives its link; the README lists the same mods with the same links. Names and Workshop ids come from the mods' own About.xml files; BepInEx and StationeersLaunchPad link to their GitHub repositories, having no Workshop item. The Fonts mod's name has a space ("ScriptedScreens Fonts"); the old spelling "ScriptedScreensFonts" is corrected wherever it names the mod.
- 2026-10-12 · The editor UI redesign (§§1, 4, 11), the owner's design built from his design canvas and the UI redesign plan (record: `docs/ui.md`), merged into the M6 branch: Vanilla + chrome at 50 %, menus, a tool rail, modal dialogs, the inspector's tabs, the source pane open by default; §4's status area and breadcrumb rewritten (a one-line status bar, a Messages drawer of fixed height, the selection path as a one-line overlay on the canvas); "the UI stays a rough prototype" replaced. Its slots for M6's Send to chip, game link and device picker are empty until M6 mounts them.
- 2026-10-12 · M6 Task 7C follows v0.11.118: float sRGB UV2 colours interpolate before per-fragment decoding; opacity blends in linear light through sRGB8 scene and cover targets. Dark vector flats retain their values. Pixel edges use the tag's derivative ramp and VBF3 carries UV0, both UV1 components and UV2. Browser/game comparison remains pending with the owner (§§7, 9).
- 2026-10-12 · M6 Task 7 re-pins the submodule to v0.11.118 (1f877d7), ver/floor 11118. Catalogue, data cadence/controls, visible dash windows and VBF3 edge/float-colour transport follow the tag; outline and edge formula tables compare directly with it. No builder limit or upstream workaround is added. Offline results and each upstream map row are recorded in docs/m6-repin.md; review, browser observation and game checks remain with the owner (§§3, 6.3, 7, 9).
- 2026-10-13 · Empty console surfaces (owner: "console without a bg assigned have NO background"; choice: "checkerboard") (§7): remove the dark preview stand-in; clear the scene target transparent and display a fixed 8 CSS px neutral checker only inside the page. Scene and cover RGB blend over it in linear light; readPixels/CaptureOverlay exclude it and report empty alpha 0. Assigned native page backgrounds remain content; the workspace keeps its own background. Results are recorded in docs/m6-repin.md.
- 2026-10-13 · A page without a background exports none (owner: "console without a bg assigned have NO background", preview choice "checkerboard") (§§5.4, 7): background is optional; export and project load do not invent M1_GROUND. The runtime declares a native bg panel only when assigned, and Devices inherits the first page's background, including none. Design → Page gains the No background choice, one undo step; colour and vertical gradient controls assign backgrounds. New pages keep the theme ground. Generated Lua/core/WebGL checks and the golden diff are recorded in docs/m6-repin.md.
- 2026-10-13 · Launch (§§8, 10, 11): the site https://gruffuss.github.io/StationeersConsoleBuilder/ is live, deployed by the first public CI run (run 38318128299, a push to `main`; every build step passed, the deploy took 8 s). The owner confirmed it end to end in his Chrome: "getting chips works in chrome", "pushing works flawlesly". First load is about 3.3 MB over the wire; the evidence, by kind, is in `docs/m6.md`.
- 2026-10-13 · The public repository `Gruffuss/StationeersConsoleBuilder` (§8): its first commit is `f78534d`, a single commit holding the public tree (the development plans and local settings left out, the spec at `docs/spec.md`, process words removed). It receives release snapshots of this private repository with that transformation applied.
- 2026-10-13 · The owner's game (§8): his StationeersLua `AllowedBrowserOrigins` is permanently `https://gruffuss.github.io`, so the live site can send to his chips.

- 2026-10-13 · Blank pages (§§6.3, 7, 8), owner: "pls for the next veriosn in the builder an empty console should not show a pink border as it will misslead users". He chose option 1: export no vector scene for a page with no nodes or direct FONT definitions, with or without natives, so neither game nor preview draws the marker. Omit its data carriers too; No background shows only the checkerboard. The first node costs one preview reload, or creates the scene on re-push; subsequent edits patch. Scenes with nodes keep the mod's problem and drew-nothing markers.
- 2026-10-13 · Future milestone (§11), owner: adapting a page to the console's size goes on the roadmap ("Add it as a future feature"), after he noted "my script have the ability to adapt to console size as you can see, the designer i assume does not at the moment" and "the fact that is 100 fixed instead of spread any spare width is not really ok": edge pinning or stretching to use spare space, and a landscape and a portrait arrangement in one page chosen by the export from the console's size. Meanwhile the owner's Power wall ships as two templates, "Power wall (3×2)" and "Power wall (2×3)" (his choice).
- 2026-10-13 · Inspector (§4), owner: "yes" to moving the Page section (name, console size, background) to the top of the Design tab when nothing is selected; under a selection it stays last and collapsed. The same UI round: the console size opens from the frame label above the page, Snap and Source show their on state, dropdown lists are styled, and checkable menu items show a check.
- 2026-10-13 · Starters (§5.2), owner: his Power and Hydro farm consoles become starters rebuilt from the builder's widgets, looks from the theme and behaviour from his scripts, at their own shapes and never resized ("do not resize them"): Power wall (3×2), Power wall (2×3) and Hydro farm (3×2); docs/templates-power-farm.md maps every device, read, write and page and lists what could not be built. The Data panel's recipes are rewritten in plain words (owner: "text like this mane no sense for regular users ... make it regular human readable pls").
