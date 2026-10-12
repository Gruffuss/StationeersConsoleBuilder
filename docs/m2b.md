# M2b report: the widget framework and the P0 widgets

Verified on 2026-10-05 at the tip of branch `m2b-widgets` (Tasks 1-9 and 11 merged, M2a under them, then this task), with Lua-CSharp pinned at `d9fb336` and the vector mod at **v0.11.91** (`8676595`). M2a's R6 and R7 were merged in on 2026-10-06 at **v0.11.96** (`4b72fd9`), and R8 and R9 the same day, so the pin is now **v0.11.99** (`2f3bad3`). Nothing below depends on the re-pins, except where a fact of a later version is named (0.11.93: a `T` takes clicks; 0.11.97: a `]` in a placeholder's format is literal; 0.11.98: the pointer passes through a vector element's empty part, and an expression reads a supplementary-plane name). The work followed the M2b plan; M1's report is `docs/m1.md`.

## Verdict: delivered; the final review's findings are fixed

A player inserts any of the 20 P0 widgets from a plain palette, edits its parameters in the widget panel, moves it on the canvas and sees it previewed with sample data. Each widget prints as a marker comment above plain vector nodes, survives the code pane's round trip, and detaches into plain nodes (with undo) when edited by hand. The project switches between Vanilla + and five neutral presets, and every widget follows.

What the suites prove (Task 10):
- **Every widget checks clean.** Each module's default instance breaks none of the expansion rules E1-E16 (`widgets/testing.ts` `rulesOf`) and draws no word from the checker (`checkScene`: no error, no warning).
- **Every widget round-trips.** It prints, parses and re-associates with no detach; its params read back exactly and its defs keep their ids (brief 2.4, R1).
- **No label takes a click.** No `T` in any widget carries `click`, `press` or `id`. This holds in every variant each module's params name: each enum value, each flag on, three items of each list. Since vector 0.11.93 a `T` with an id and `click=1` records its own hit region, so a label carrying a click would take the click of the plate under it. The Button, Toggle, Stepper, Option group and Page tabs each still list their plates.
- **Every widget draws in the real core with every data name.** `web/test/fixtures/codegen/widgets.lua` is a snapshot of the exporter over every widget's default instance (the Repeater with `click`), on one 480 × 480 design page drawn at 460 × 460, plus an icon and a text input. The C# suite runs it on the real core:
  - it runs, and its surface draws with no problem: every data name arrived and nothing is magenta;
  - every plate the src declares records a hit region (10 plates; inside the Repeater's `RP` as `rep1_r:0` … `rep1_r:3`);
  - both natives are declared.
- **The hit plate, headless.** An unpainted `R id=r click=1` records exactly one region, `r`, and draws no triangle (`FrameTests`, rule E3).
- **The smoke test** (spec section 8, Q12) runs in happy-dom. It opens the app, inserts a Bar from the palette, and finds the Bar's marker, its `G id=bar1` and its sample `["bar1_lvl"] = 0.62` in the shell sent to the core, which is the export until M3.

Suites at the end of M2b (after the final wave and the merge of M2a's R6 and R7, at v0.11.96): `core/Core.Tests` 399 checks, `ALL PASS`; `npm test` 848 tests; `tsc --noEmit` and `npm run build` clean; a clean publish and `npm run precore` succeed. After the merge of M2a's R8 and R9 (v0.11.99), a widget's format may hold `]` and an expression slot takes a supplementary-plane name: `core/Core.Tests` 417 checks, `ALL PASS`; `npm test` 858 tests; `tsc --noEmit` and `npm run build` clean.

**Not covered:** nothing here is tested on a console yet. The decisions say nothing counts as tested until seen on one; the in-game checklist below is the owner's.

**The final wave.** M2a was merged in first. Every important finding of the final review is fixed, each with a test, and so are the minors but those judged wrong or left to M3/M4 (named under the limits). The four rulings for the final wave are in (see "Rulings for the final wave").

## What shipped

### The 20 widgets

Slots are the data names the widget reads (`<uid>_<slot>` unless renamed in the panel). A **text** slot is one labels alone read: its value is a number or a string, since the mod prints a string as it is and a number through the label's format (`BindText`, `BindTemplate`); **texts** is a list of either. A rename is any name the slot reads back where it is read: letters, digits and _ in an expression, and since vector 0.11.98 any supplementary-plane character (`ReadName`), any name a label's binding reads whole (`room kPa`) in a label. A **snap** slot is sent snapped: states, flags, counts, strings, and numbers shown as text. An **eased** slot is a number that drives geometry. Clicks are the plate ids after the uid, each with the step M3 suggests for it. The last column is the newest vector feature each module names in its header. The export floor is the pin, so the column is information only (D1).

| Widget | type | group | slots (defaults) | clicks | newest vector feature |
|---|---|---|---|---|---|
| Panel | `panel` | chrome | none | none | inset shadows, 0.11.21 |
| Header bar | `header` | chrome | crit, warn (count, snap); clock (text, snap) when shown | none | placeholders, 0.11.34 |
| Key–value table | `kvtable` | chrome | per row, named by the row's own key: value (text, snap), state (state, snap) | none | colour expressions, 0.11.79 |
| Repeater | `repeater` | chrome | n (count, snap); per item: name, v, t (texts, snap), st (states, snap) or lvl (numbers, eased) | `_r` → `id:i` (with `click`) | `v` on `C` 0.11.75; the bar item 0.11.79 |
| Flow duct | `duct` | chrome | run (flag, snap) | none | clip paths, 0.2.0 (dashes march on `t`) |
| Page tabs | `tabs` | chrome | none | `_t<k>` → `page(<id>)` | `down`, 0.11.36 |
| Text | `text` | values | every name its template reads (text; texts for a list item; number in an expression); st (state, snap) with `state` | none | `{=…}` 0.11.36; state ink 0.11.79 |
| Bar | `bar` | values | lvl (number, eased), st (state, snap) | none | colour expressions, 0.11.79 |
| Readout row | `readoutrow` | values | st (state, snap), r1, r2 (text, snap) | none | colour expressions, 0.11.79 |
| Readout tile | `readout` | values | v, sub (text, snap), lvl (number, eased), st (state, snap), status (text, snap) | none | colour expressions, 0.11.79 |
| Alert | `alert` | values | st (state, snap), msg (text, snap) | none | colour expressions, 0.11.79 |
| Event log | `eventlog` | values | k (states, snap), m (texts, snap); t (texts) with `time` | none | colour expressions, 0.11.79 |
| Status light | `light` | values | st (state, snap) | none | `v` on `C`, 0.11.75 |
| Button | `button` | controls | none by default; state (count) when multi-state, dis and sel (flags) with `canDisable`/`canSelect`, all snap | `_hit` | `v` on `R`/`T`, 0.11.75 |
| Toggle | `toggle` | controls | on (flag; snap for the button look, eased for the switch) | `_hit` → `toggle` | `mix`, 0.11.79 |
| Stepper | `stepper` | controls | v (number, snap) | `_dec`, `_inc` (`press=1`) → `step(-by,min,max)`, `step(by,min,max)` | every `down:` arrives, 0.11.37 |
| Option group | `options` | controls | sel (count, snap) | `_o<k>` → `set(<value>)` | `v` on `R`/`T`, 0.11.75 |
| Vector glyph | `glyph` | icons | none | none | none tagged |
| Item / gas icon | `icon` | icons | none (native) | none | a ScriptedScreens `icon` element |
| Text input | `textinput` | icons | none (native) | none | a ScriptedScreens `textinput` element |

### The framework

- **The marker.** A widget is a root-level `G id=<uid> { … }` whose last own-line comment is `widget <type> <uid> <params JSON>`. The marker is the widget's only record (ruling 1). Nothing is added to `SrcNode`, and the printer, validator, numbering, canvas and hit test stay generic.
- **Re-association** (ruling 2). `setScene` keeps a widget whose marker and subtree print as before, or, for text with no earlier widget of that uid, whose params re-expand to the same subtree, or to the same but for its colour literals (in this theme: a palette retuned since; or in another preset): it is then made again in this theme, never detached. A text value is compared as written, so a label edited to `#505` detaches like any other edit. Anything else is detached with a notice that Ctrl+Z puts it back. A widget whose uid is used already (seen twice, held by another page, or the stem of a plain id beside it) is detached as a copy, and the notice says so; a copy beside its widget gets copies of the `<uid>_` defs it points at (`<uid>copy<k>_`), so the widget's edits leave it drawing as it did, and a copy whose page lacks such a def (its root copied alone) gets the one its marker makes, and the `theme_` gradients it paints with. A load re-associates every page the same way. A detach pins the widget's samples as preview values, so its nodes keep drawing them.
- **Uids** are prefix plus the smallest free number, unique across the project and across natives (Q14).
- **Defs.** Per-instance defs are `<uid>_<name>`, the widget's own: an edit writes them again and a delete drops them, so a node written by hand that points at one follows the widget's edits, and keeps the def when the widget is deleted. A pasted copy points at defs of its own: `<uid>copy<k>_<name>` beside its widget, or the widget's names on a page where no widget of that uid can stand, made from the page's defs or, for one the page lacks, from the copy's marker. They are plain defs from then on: deleting the copy leaves them, as deleting any node leaves the defs it used, so a cut and paste of the copy still draws. Theme gradients are `theme_<name>`, which the framework adds; a theme switch and a load write each one again in the theme's colours, a stop edited by hand too (ruling 3); the property panel says so on one.
- **The panel** (Task 8): parameters, lists, data names and preview values. Each edit is checked off the main thread before it lands, as the property panel's are. Detach and Delete are there too.
- **The palette:** a plain list by group (D9).
- **Natives** (Q10, Task 9): `Page.natives`, declared by the shell after the data element. Their rect is the design box mapped by the scene header's fit (`fitOf`, shared with `viewbox`). The preview draws them as DOM placeholders, and the panel moves them.
- **Preview values** (G14): each slot has a sample, and `Page.preview` holds the player's overrides.
- **Theme presets and the switch** (Task 11): Vanilla +, Dark steel, Slate, Light, Mobile dark and Mobile light. A switch re-expands every widget on every page and moves pages on the old ground to the new one, in one undo entry.

## Rulings of this plan, and the owner decisions under them

The plan's "Rulings taken while planning" holds each in full. In short:
1. The marker is the widget's only record (Q1).
2. Re-association compares prints. A hand edit detaches, with undo (spec 4).
3. Defs: `<uid>_…` per instance, `theme_…` reserved for the builder.
4. Five presets with builder-defined palettes, which the owner tunes after M2c (ruling); the switch is one history entry; `widgetDefaults` (M5) and `motion` are not added.
5. Panel looks are `well` and `hairline`; there is no `ground` look.
6. The Text input is entirely native (Q11); the Item / gas icon is a native `icon`.
7. Preview values: each slot's sample, plus `Page.preview` overrides (G14). Hover and pressed looks stay at rest.
8. A label is plain text. It refuses only a leading `$` and a closed placeholder; `literal` prints numeric-looking text through documented placeholders. The Text widget takes any template and declares every name the mod reads from it (final wave).
9. Builder-defined looks where Vanilla + is silent (Q8).
10. Simplifications with a known ceiling (see the limits).
11. The selection snaps to a widget root (Q2). M2a ruling 9's selection gaps move to M2c.
12. The widget form is its own, sharing only `TextField` and the checker round trip with the property panel.
13. Sizes are never refused: any size the mod draws, and a height only where a `fit=ellipsis` label needs one line (1.4 × its style's size, read from the theme). `cells` stops at `MAX_RP`, and a long Flow duct splits its `RP`.
14. Preview text: only centred and right-aligned overflow under `fit` 0 reaches a widget. It is now drawn as TMP draws it.
15. A `duplicate-id` trap, as a warning.
16. No label cap (the owner's rule: a cap that refuses legitimate input is a mitigation). See the label-count measurement.

The owner decisions under them: Q1 (params in the marker), Q2 (selection snaps to the root), Q3 (no nested widgets), Q4/Q5 (one state integer, 0 idle, 1 ok, 2 warn, 3 crit, as colour expressions; glows as per-state `v=` copies), Q6 (Devices page in M3), Q7 (outlines inside the box; hero unit 64 px), Q8 (builder-defined looks), Q9 (no Header cog or tabs, no blink, the glyph stays), Q10 (`Page.natives` with placeholders), Q11 (the Text input in M2b), Q12 (happy-dom smoke test), Q13 (no Event log time column by default), Q14 (project-wide uids), Q16 (marker stripping decided in M3/M4), Q17 (ScriptedScreensFonts names).

### Rulings for the final wave (all in)

These rulings were made for M2b's final wave; the final wave put each in.
1. **A "too large to check here" verdict never blocks an edit.** It lands from the code pane, the property panel and the widget panel alike, its reason shown as information; the preview keeps the last scene it showed (App sends nothing while a page is too large to check). This replaces M2a's plan ruling 2 ("not made"), which the code pane followed too.
2. **Names the mod reads are not refused.** `constructor` and `__proto__` are names like any other (renames sit in records with no prototype, previews are read by `Object.hasOwn`); a rename is kept where the slot reads it back; a Text declares `$room kPa` (the name "room kPa") and `{$a b}`, `$a[0]` (an item, `missing=""`) and supplementary-plane names; a preview value may be kept under any non-empty name (one check, `previewName`, for the load, `setPreview` and the shell).
3. **Delete does not reach a widget from a button or a bar.** `ownsDelete` keeps it for any `button` and inside the palette, the page bar, the toolbar and the breadcrumb; a native's placeholder (a `div` with the role button) still passes it on.
4. **The Mobile and Light palettes are placeholders the owner tunes.** Mobile dark's ground loses its tint and its well matches the ground's bottom stop through the 8-bit linear buffer; white on Light's `status-warn` is 2.95:1. Recorded only; nothing to change now.

## The per-tick contract M3 builds on

Each page keeps its structure element (the scene, declared at load) and gets two data elements: one `snap = 1, keep = 1` for the slots marked `snap` (states, flags, counts, strings, numbers shown as text) and one eased for the rest (numbers that drive geometry). Both are declared at load and committed (`ui:commit()`) before the first tick patches them, since a declaration and a patch in one execution lose the declaration's `data` (spec 6.4). Each tick sends only the active page's data keys. A Stepper's buttons are `press=1` (every `down:` event arrives; a `click=1` is debounced per pointer); a click inside a repeat arrives as `<id>:<i>` with the innermost index. No P0 widget patches `nodes` (brief R14), so the two elements carry `data` only. The preview's single data element (Task 3) is this milestone's stand-in.

Three details for M3, from the tasks:
- **A `press=1` plate delivers three events:** `down:<id>`, then `up:<id>`, then the plain `<id>`. M3 acts on `down:<id>` only, for a plate whose `press` attribute is set; otherwise one tap steps twice.
- **`snap` and `ease` persist** on an element until written back off (measured upstream). That is why one element cannot snap some slots and ease others: the snapped element keeps `snap = 1` for good, and the eased one must never receive it.
- **One name, two slots.** Two slots renamed to one name, or a Text reading `{$bar1_lvl}` (the Bar's eased slot), share the name. One name rides one element: a name any snapped slot reads is sent snapped, and the eased reading then steps. The panel reads such a name's preview value by the snapped slot's kind.
- **Motion is asserted through a "still animating" signal**, never through a single frame, in any test M3 adds.

## Limits, each with its ceiling and upgrade path

- **`widgetDefaults`**: no preset uses it. It arrives with the design-system import (M5, spec 5.2's mapping).
- **`motion`**: no P0 widget reads it (no blink, Q9). It arrives with the first widget that animates by theme.
- **No nested widgets** (Q3). A Panel is a background inserted first; content widgets are its later siblings.
- **The Header's counts sit in fixed slots**: a hidden crit count leaves a gap.
- **Bar cells are horizontal only.**
- **Natives move in the panel only**: no canvas handles.
- **Pressed and hover looks stay at rest in the preview.** The host never sets `hover` or `down` (M1 ruling 3).
- **TMP rich text is stripped in the preview.** The panel says so under any text param that holds a tag.
- **Page tabs keep a renamed or deleted page's old label and id** until the tab is edited or the widget inserted again.
- **The preview's text approximations** left by M2a ruling 9 that no widget reaches: `fit=ellipsis` under `wrap`, and `fit` 2.
- **M2a ruling 9's selection gaps**, which no widget needs, move to M2c.
- **A widget laid over another widget's label** (brief R7) is a layout lint for M4's export checks. In the browser check the Readout tile, Readout row and Stepper were laid over each other, and the preview drew them in node order, labels on top.
- **The Stepper has no hint line**, and the Text widget's data names are its template's (ruling 10).
- **The label count has no cap.** The text layer renders a label again only when it draws otherwise, and lays out none that surely draws nothing on the surface (see the measurements). A page whose thousands of labels are all on the surface still lays every one out when they all move.
- **A widget hidden at its preview values cannot be picked on the canvas** (an Alert at state 0, a Repeater at `n` 0): its unpainted box draws no triangle. The code pane's caret or undo reach it; a layout lint for M4.
- **A page of natives alone** (an icon and a text input) has no vector scene element in the current exporter, so no empty-scene marker appears behind them. An empty page without natives keeps a scene element so its first drawing can be patched.
- **A palette retuned after a project was saved** (the Light and Mobile placeholders): a widget whose saved body differs from its expansion only in colour literals is made again in the new colours at the load, and so is every `theme_` gradient; a colour typed into a widget's body outside the builder is lost the same way (the marker owns the body), and so is a `theme_` gradient stop edited by hand (ruling 3: `theme_` defs are the builder's; a paste keeps one, and the next load or theme switch writes it again). Text values are not colours: a label's text is compared as written. A retune of anything but colours (type sizes, faces, geometry, shadow offsets) still detaches such a widget at the load, with the notice; a palette version is the upgrade path for that.
- **A detached widget's pinned samples have no panel.** A detach pins its samples as the page's preview values, so its nodes keep drawing them; the widget panel lists only live widgets' slots, so such a value cannot be seen, edited or cleared there yet (the project file holds it). A rough UI for a page's preview values is M4's. A `<uid>_` def a node written by hand points at stays when its widget is deleted, and its stem stays taken.
- **A hidden widget of zero width or height** holds no box: its unpainted `R` is empty to the mod, so a page holding nothing else still shows the empty-scene marker, as the mod does for any scene that draws nothing.
- **An empty list as a preview value** (an Event log or a Repeater with no entries) is not sent: what the mod's data makes of an empty Lua table is unmeasured. The empty look is previewable already (`n` 0, or every class state 0).
- **Option group, Page tabs and Button states are addressed by item index** (`og1_o<k>`, `nav1_t<k>`, `eq($state,n)`): a Remove moves what follows, though each click's step moves with its item. M3 binds clicks from the expansion's list; stable item ids are M3's if it binds them by id. The Key–value table's rows already carry a stable key.

## Measurements

The checks ran in the browser pane built into the desktop app, against the Vite dev server on localhost, on a 1500 × 950 viewport, in a background tab. A background tab gets no animation frames, so a patch, which waits for one, could not be timed. Every time below is main-thread time from an event to the state shown in the DOM.

- **A param commit's round trip.** Pressing Enter in the widget form, through the off-thread check, to the checked scene in the store and the code pane, takes **7.8-9.1 ms** (median 8.5 ms over 10 edits of a Stepper's `x`, on a page holding five widgets). In a foreground tab the patch then follows on the next animation frame.
- **A Repeater drag step.** One `pointermove`, through the store, to the moved widget shown in the panel, takes **5-13 ms** over 20 steps for a 6-row Repeater. With 5,000 labels on the page it takes **25-36 ms** over 10 steps: every step renders the text layer again.
- **The text layer after the final wave** (a 5,000-label Repeater, 56 apart on a 460 surface). The browser pane was hidden this time, and a hidden tab runs neither animation frames nor ResizeObserver, so no frame arrived; the timing is the React render and DOM commit in happy-dom, the M2b text layer against the final wave's, three runs each:
  - the first frame holding them: **430-580 ms** before, **4-12 ms** after;
  - a frame in which every label moved: **100-140 ms** before, **3-4 ms** after;
  - a frame of new label objects, each as it was: **60-220 ms** before, **2-3 ms** after.
  - After, 19 labels are laid out (the surface shows 9; the reach is generous) and all 5,000 are kept. Browser layout, which the earlier 1.4-1.8 s included, falls the same way, since the DOM holds 38 elements, not 10,000. To be confirmed in a visible pane.
- **A large label count before the final wave** (ruling 16): a Repeater of 5,000 text rows, `n = 5000`, with 5,000 preview strings.
  - The first frame holding them costs one main-thread task of **1.8 s**.
  - A frame after a drag step that moved every label costs **1.4 s**.
  - Every label is kept and drawn; nothing is refused.
  - This is the cost the "no cap" rule accepts. Its upgrade path is above.

### Browser checks left to this task by earlier ones (all pass)

- **T3:** a Status light glows green from its sample, and red after its preview value is set to 3. After a canvas drag that patches only the scene, the moved light still glows red.
- **T4:** a hero figure of six digits, right-aligned at `fit` 0, overflows to the left only (ink 795-1096 px over a box of 885-1096 px). A Stepper value of nine digits, centred, overflows both ways equally (17 px each side). The Readout row's value has `fit=ellipsis` and shows `1234…`, as written.
- **T8:** inserting from the palette selects the widget and shows its form. Its params, data names and preview values commit, and a pinned preview value shows its Reset.
- **T11:** switching to Slate re-expands every widget on both pages: `theme_row` stops change on both surfaces. One Ctrl+Z restores a shell byte-identical to the one before. Light moves both grounds to `#F4F5F7`/`#E1E4E8`.
- **T9 step 5:** the icon and the text input show their placeholders (`O2`, `Type a name`). A press on the icon's placeholder selects it, and the form has no Detach. Setting `x` to 330 moves the placeholder, and the shell declares `x = ox + 330 * sx`. Delete removes it, Ctrl+Z restores it at 330, and the status line shows no problem.

## For upstream (the vector mod's author)

**U1 and U2.** At the pin, `REFERENCE.md` says every shape, `T` included, is clickable, and the CHANGELOG says open `P`/`L`/`Y`/`SP` register. But at the pin `Tessellator.cs` calls `RecordHit` only from `FillAndStroke` and from a closed `P`. Repro:
- a vector element with `src = "T id=t click=1 x=0 y=0 w=50 h=20 text=Hi size=12\nP id=p click=1 d=\"M0 0 L10 0 L10 10\" s=#fff sw=2"`;
- then `ui:commit()`;
- `Stats.Hits` holds neither.

Upstream has since made a `T` with an id and `click` clickable (0.11.93), which settles U1 from v0.11.93 on. U2, the open `P`, is still to be confirmed. The widgets depend on neither, because their plates are unpainted `R`s; nothing here waits for it.

**Code and reference disagree:**
- **Hit regions and the pointer** (answered at 0.11.98; the in-game checklist measures it). At v0.11.91 `VectorGraphic.cs` set `raycastTarget` whenever a scene had any hit region, with no raycast filter, so a vector element with one plate took the pointer over its whole rect and an element below it got nothing. Since 0.11.98 the graphic is an `ICanvasRaycastFilter`: it answers only over a hit region or a scrollable viewport, and passes the pointer on elsewhere (a vector element no longer shields what lies under its empty part). `generate.ts` declares the natives above the vector element, so a native receives the pointer over a plate too (U6).
- **U7, `fmt`.** `REFERENCE.md` says a spec that cannot be read renders `missing`. The code (`Printf.Translate`, then `string.Format`) prints it as written; only a brace throws. The `Printf` doc comment and `PrintfTests.UnreadableSpecsAreLeftAlone` are wrong the same way. `literal` uses only `%.Nf`, `%x` and `%X`, so the kit depends on neither side.
- **U8 (answered at 0.11.97), a `]` in a bound placeholder's format.** At v0.11.91 `TextTemplate` took the format from the first `:` after the last `]`, so `{$v:%.1f [kPa]}` read the name `v:%.1f ` with index `kPa` and drew `missing`. Upstream fixed it in 0.11.97: the format follows the first `:` outside the index, so a `]` in it is literal (the C# suite prints `{$v:%.2f]}` and `{$a[0]:%.2f]}` through the mod). The builder now takes a format holding `]` (it refused one before), and reads a label's data names by the same rule (`textNames`).
- **A live clip redefined by a static one** (a suspected bug). A `CP` with expressions followed by a static `CP` of the same id keeps the live one: `ResolveLiveDefs` re-cuts `Clips[id]` from `ClipNodes[id]` on every rebuild.

**Where the reference is silent** (questions, not defects):
- A text whose first character is `$` binds the whole rest as one name (`$room kPa`, `$5.00`), with no escape.
- An unclosed `{$` or `{=` is literal text.
- An expression's number literal has no exponent form (`Expression.ReadNumber`), while attribute literals take one.
- `RP n` is clamped to 0..20000 (`MaxRepeat`).
- The plain-click debounce: a second plain click from one pointer within 0.25 s is dropped. `press`, hover and drag events all arrive.
- The structure element's `w`/`h` default to 100, with a floor of 1.
- The "Data element" table's `data` row predates string data and string arrays.
- Gradients, clips and symbols keep separate DEFS id tables, and a later one of a kind wins.
- Repeated root ids all report clicks, and the last one wins for patches. A `USE`d body registers its ids unprefixed.
- `fmt` precision is passed to .NET unchecked; whatever lies between `%` and the letter is (`%1.2.3f` gives `F2.3`).
- What a data element makes of an empty Lua table (`data = { ["k"] = {} }`): an empty array, an empty map, or nothing.
- An undeclared clip, symbol, mask or gradient: the reference's Diagnostics table names the clip and the gradient; the mask and the `USE` are reported in code (`Tessellator.cs:1213`, `SceneModel.cs` USE).
- `TextTemplate.NextPlaceholder` searches again from every placeholder, which is quadratic in many `{=…}` with one late `{$`.

**Measured upstream or offline, recorded here:**
- An `RP`'s children get hit regions, as `id:i` (the widgets fixture confirms it in the core).
- `IMG` clicks are measured offline only.
- Supplementary-plane characters are fine in ids and data names.
- `snap` and `ease` persist until written back off.

## The in-game checklist (Q15)

For the owner, on one test page. Push `web/test/fixtures/codegen/widgets.lua` to a chip at the pin.
1. `cspace` as a `T` attribute, and its unit (0.01 em): the Header title's letter spacing.
2. The hover/down colour arms, and `fo=1-0.25*down` on a held button.
3. An unpainted `R` hit plate takes clicks, and `v=0` removes a plate's region: a disabled Button.
4. `ui:size()` on a 3×2 console: 714 × 460 or 460 × 460? Answered in game on 2026-10-06: MoreConsoles' Console 3x2 placed turned reads 460 × 713.864, so 713.864 × 460 flat; LargeConsoleMod's 2×2 and 3×3 read 460 × 460 (spec §5.4).
5. The hero readout's unit baseline (`y + 85.5`) against the figure.
6. The icon element: `icon_type`, and whether `name` takes the raw gas name (sent today) or an `ss.ui.icons.gas` key.
7. The text input's `style.bg` as an opaque background, and its own face.
8. A native element above a vector element with hit regions receives clicks (U6).
9. `fit=ellipsis` boxes at 1.4 × size, in the Fonts mod's faces and in the fallback face (no Fonts mod).
10. A centred or right-aligned value that outgrows its slot (a hero figure of six digits) overflows as the preview now shows it.
11. `{=0:<digits>}` formatting: a label whose digits a float would not print as written (more than 7 digits, a leading zero) prints them exactly. Seen in code, not yet on a console.
12. A prefab icon: is the hash wanted as a number? It is sent as a string today, because `name` is a text param.
13. Does `textinput` take `style.font_size` and `style.placeholder_color`?
14. The natives' `z_index`, 6 for the icon and 22 for the text input: does each sit where the preview draws it, the text input over the icon and both over the vector element?
15. Since 0.11.98 a vector element takes the pointer only over a hit region or a scrollable viewport, and passes it on elsewhere: a native beside a plate, not over it, receives clicks, a press on the scene's empty part reaches no plate, and a plate still takes its own. Natives stay above the vector element either way. Nothing offline can test it.
16. Labels carry no `click`: on a mod at 0.11.93 or later, a press on a Button's, Toggle's, Stepper's or Page tab's label still reaches the plate under it.
17. Ellipsis boxes narrower than `…` (a zero-wide Panel title, Header title, Alert message or Key–value caption): does TMP draw nothing, or a stray `…`?
18. The text drop shadow (`0 2 2`) on Barlow at sizes 24-36: does it fit the glyph atlas padding, or does TMP draw an extra copy of each label?
19. The Mobile dark and Light presets, on a console: Mobile dark's ground bands and well, and white on Light's `status-warn`. They are placeholder palettes, for the owner to tune.
