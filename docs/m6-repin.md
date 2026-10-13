# M6 Task 7: vector v0.11.118

The gitlink is v0.11.118, annotated tag a02f608c287276161568c0a762c6be5d8aca367d, peeled commit 1f877d7a3682fc61cec364427d590d6400319ecb. Origin's tags were checked before implementation. No v0.11.114 tag exists; its changes ship in v0.11.115. The export floor, header, cfg.floor and every banner use 0.11.118 / 11118. An independent diff check confirmed that the 62 floor fixture/template files changed only their version values: 39 Lua, 14 page manifests, metadata.json, unicode.project.json and seven templates. This base has 55 floor-bearing files under web/test, one more than the plan's count of 54.

Steps 1–7, including 7C, were implemented offline. A review covered all eight checks (0 high, 1 medium and several lows); its fixes are recorded below. The browser observation is recorded separately. The owner dropped in-game step 9; numeric tests are not captures.

## Extended map

These rows came from CHANGELOG.md and the v0.11.117 → v0.11.118 diff before moving the gitlink. Gradient.cs itself is unchanged: it samples premultiplied sRGB stops and unpremultiplies them; MeshBuilder.cs and VectorDither.shader change their transport and interpolation.

| v0.11.118 change | Builder consequence | Evidence |
|---|---|---|
| Float straight sRGB in TEXCOORD2 / UV2, w marking vector geometry; dark flats retain levels | VBF3 carries float32[4V] storedColours, uploaded as attribute 5 | New-frame decoder failed before implementation. Shader/dark-flat tests failed before 7C, then pass. All 256 flat levels and explicit 5/10/20 anchors pass; actual dark vertices carry float RGB and w=1. |
| Stored sRGB interpolates between vertices and decodes per fragment; opacity still blends linearly | Fragment decoding and SRGB8_ALPHA8 scene/cover targets; target texture reads decode before display encoding | Shader/target/clear/translucent expectations failed → passed. Actual solid/dashed whole-path gradient sampling failed under the previous sampler → agrees at red 70.5, reported 70.6. Three-channel model is within 0.2 of (70.6,177.9,138.9), and displayed bytes within 1 of CSS (70,178,139). |
| Old/missing unsupported game bundle retains byte-linear fallback; pictures/other UI keep existing path | No game bundle loader or browser compatibility mode needed; marker-zero native UI/picture tint retains byte-linear path | Existing picture order, textures, alpha, point/smooth sampling and covers pass with VBF3. Older VBF1/VBF2 readers remain supported. The supplied upstream console captures used the current bundle. |

## Each original map row

“Failed → passed” means the expectation ran before its implementation changed and passed afterward. Linked-code and existing-code rows explain why no extra implementation was needed.

| Plan row | Outcome and evidence |
|---|---|
| 113: TMP-aware outline | Added linked TextOutline.cs. Preview unchanged: 48 width/bold-ratio rows, both calibrations, sizes and clamping, match actual tag C# arithmetic. |
| 113: nofill reference correction | Closed the resolved disagreement in decisions. No geometry change: existing radial/blurred nofill regressions pass; upstream corrected the reference to the implemented behaviour. |
| 114: visible double-precision dashes, odd periods, negative entries | DashWindow linked; local y-up surface window supplied; inspector counts negatives as zero. Negative-entry editor/animation and billion-unit visible-window tests failed → passed. Moving 1e9-unit 6/4 duct completes with finite geometry. Odd-period behaviour already implemented. Old fine-dash case was not deliberately run to resource exhaustion; the safe long-window test established the missing window. |
| 115: moving dashes, zero scale, non-finite dofs/windows/ends | Linked tag fix and visible window. Zero-scale/non-finite-dofs test returns finite geometry without a draw fault; moving billion-unit test passes. No extra finite-arithmetic port or guard needed. |
| 116: lower-case literal booleans/lists/numeric DATA, other words reported | Traps/fromProps follow tag; linked ReadData used. Raw scene true and numeric DATA true/false failed at old pin → passed at new. TS literal/fromProps failed → passed. Numeric-list smoke test passes; the mod's own other-word diagnostics failed at old pin → pass. Review fix: no extra plain-word trap; decisions:77 overrides the plan row's warning wording. |
| 116: endpoint keys only where read | Regenerated known/read keys. Raw unread x1 report failed at old pin → passed; extraction/not-read tests failed → passed. All four GL keys and YS y2 explicitly remain asserted. |
| 116: non-map nodes patch entry | Immediate/queued controls reach linked PatchNodes. Raw nodes={box=3} report failed at old pin → passed. Every generated DATA/nodes payload is checked with tag code and has no malformed-map report; exporter already emits valid maps. |
| 116: mix without hex in numeric slot | Numeric-colour diagnostic detects mix without hex. Raw diagnostic failed at old pin → passed; TS diagnostic failed → passed. No independent trap added for a reported mod fault. |
| 116: equals expression on keep/snap/ease | Queued controls retained. Raw reports failed at old pin → passed; queued ease failed before port → passed. Tag checks every generated DATA control: no plain-number-expression report. Exporter already emits literals. |
| 116: bbox gradient spans whole dashed/clipped path | Linked tessellation fix, no bounds port. Existing whole-shape trap wording regression passes unchanged; actual solid/dashed whole-path midpoint agrees. |
| 116: identical DATA does not restart blend; since still stamps | CompareData/arrival/cadence port. Equal-payload blend and next changed payload's arrival duration failed → passed; since stamps pass. Existing runtime equal-float32 filter remains. |
| 116: vector_stats either thread, last landed build | No builder implementation/parser to change. Source inspected; no new console/thread measurement was made; the owner dropped step 9. |
| 116: example 17 comment | Comment is outside printed scene. Regenerated fixtures have no example-17 scene diff; no builder change needed. |
| 117: automatic 1.3 px pixel edges | PixelEdges enabled; VBF3 includes both UV1 components and UV0 band; shader uses distance derivatives. Core channels/frame magic and TS new-frame/derivative tests failed → passed. 32 EdgeRamp C# rows match executed shader arithmetic including fallback. Browser edge observation is recorded below; no new local game capture. |
| 117: nopixeledges | Extracted root flag, catalogue/checkbox, core switch. Catalogue failed → passed. Inspector inventory retains all old items and adds nopixeledges. Core literal true yields zero edges and no diagnostics. |
| 117: out-of-range text array is unresolved DATA | Existing headless missing-name route already handled it. Out-of-range text reports unresolved data name $a; missing=empty suppresses it. Both passed at old pin too; no extra port. Linked tag handles live scene problem policy. |
| 117: every bad ease entry | Raw count/named reports for ease={a='=1',b='=1'} failed at old pin → passed; queued two-entry test failed before host port → passed. |
| 117: vector_stats scene header | No parser to change. Tag emits scene "<id>" (under "<root>") when active, scene "<id>" (under "<root>", inactive) otherwise: inactive is inside the closing parenthesis. Owner records console output. |
| 117: lower-case scene switches | Core nofill=true failed at old pin → passed; literal checks and inspector checkbox reader failed → passed. |

Unity stand-ins are checked for column-major matrix indexing, Vector4 all-component clamped interpolation, Rect size and Vector3 extrema. Current source line anchors and pin audits follow the tag. No dependency or limit was added. CSS import preserves exactly the authored stops, with no ramp compensation; E1's existing two-layer gradient switch tests pass unchanged.

## Verification

| Ordered stage | Exit code | Result |
|---|---|---|
| 1: clean Release browser-wasm publish | 0 | Published the pinned core |
| 2: npm run precore | 0 | Copied current core assets |
| 3: npx tsc -b | 0 | TypeScript checks pass |
| 4: npx vitest run | 0 | 241 files, 3976 passed, 1 skipped (3977 total) |
| 5: npm run build | 0 | Built; 123 public files contain no local paths; 9 base-path files pass |
| 6: dotnet Core.Tests | 0 | 2114 PASS, 0 FAIL, 0 SKIP; ends ALL PASS |

The one skipped web test regenerates the device catalogue from optional external source/Markdown inputs, which were not provided. No five-second timeout occurred, so no timeout-only Vitest rerun was needed. Build warns that an application chunk exceeds 900 kB; the warning remains without changing its limit.

The first full run passed stages 1–3, then stopped at stage 4 (exit 1): 12 stale assertions failed, 3964 passed, one skipped, across 241 files. Seven expected floor 11112, one scene-control inventory lacked nopixeledges, and four picture/core-memory checks expected VBF2. All affected checks passed in a targeted rerun: four files, 26 tests. No expected item was removed, assertion weakened or timeout raised.

Earlier targeted Core runs had four missing generation stamps because the full web suite had not yet generated M4/adopt artifacts. Those are ordering prerequisites, separate from regression failures.

## Owner browser observation

Observed on 2026-10-13 in a real WebGL 2 browser, at merged tip 0bcbecf. Both observation pages were corrected to f= on T before this run; the fix round commits those corrections and checks the editor's own parse/validate path.

At 0.8 px per unit, the colour page's dark cells 0/5/10/20 read 0/5/10/20 exactly. The filled midpoint (240,140) reads (70,178,139), against upstream's (70.6,177.9,138.9); solid and dashed stroke midpoints read the same (70,178,139). Gradient ends read #5FD9A8 and #2E8B6E exactly. The 85% #E2563D overlap over #0A121C reads (211,80,58), against the linear prediction (210.4,79.9,57.4). Flat colours show dither: about 11% of pixels one level up; #0A121C is about 89% (10,18,28), 11% (11,18,28).

On the edge page at 80% and 200% zoom, an axis-aligned edge has one intermediate pixel: examples 41 → 208 → 255 at 80%, 39 → 170 → 254 → 255 at 200%. The band does not widen with zoom. A 30-degree edge crossed horizontally spans about three pixels. The one-unit hairline at 80% draws two bright pixels (223,254).

These observations predate the checkerboard follow-up. The owner dropped in-game step 9: the vector mod's author already saw both changes on a console by capture, and tag code ran every generated scene offline without new reports. Those upstream facts remain separate from this browser observation and local suites.

## Defects, limitations and upstream

- Fixed: inspector misread literal true/false even though the tag accepts them.
- Fixed: one-float frame transport lost the new band's/distance inputs; VBF3 carries them.
- Fixed: decoded vertex ramps and linear RGBA8 quantization disagreed with 118; float sRGB/per-fragment decoding and encoded targets now follow it.
- Fixed stale checks: seven M4 floors, one inspector inventory and four picture format assertions; original checks retained.
- Fixed stale source references: current-pin comments carried the old line anchors; remapped them to the tag, including mixed SceneModel/Tessellator references.
- Existing limitation: translucent covers over DOM labels still blend in browser sRGB; this is a preview limitation, not an upstream fault.
- No new upstream defect found offline. Old/missing game bundle fallback is intentional; the console captures used the current bundle, and the owner dropped step 9. ScriptedScreens gradient-panel capture serialization is historical upstream work, not worked around here.

The plan's pre-implementation game capture and browser edge observation were left to the owner; the tag's code and the owner's measurements were used instead. Local suites do not establish Linux CI; browser and upstream capture evidence are attributed separately.


## Commits through step 6

- c22e550 Pin the vector core to v0.11.118
- bd22534 Raise the export floor and fixtures to v0.11.118
- 9774a64 Follow the new vector catalogue and literal diagnostics
- b07f350 Update live data cadence and dashed-path windows
- 438bfd6 Carry pixel-edge and float-colour channels in VBF3
- 7e7365c Match the vector sRGB colour pipeline

The commit containing this record completes step 7.

## Review fix round, 2026-10-13

The retained fallback tests were retargeted in the first re-pin without full disclosure. Every affected check is listed here:

- FrameTests.At: rounded inset shadow and panel-base recovery.
- FrameTests.At: shadow/stroke support for R/C/P at four scales, baseline/outset/inset and expression-width equality.
- FrameTests.At: scaled-group stroke/shadow versus equivalent scene-unit geometry.
- FrameTests.At: four hairline widths under geometric min(auto,width) feathering.
- FrameTests.At: radial/blurred nofill base frames.
- FrameTests.At: repeat-work and sampled-work budgets.
- FrameTests.At: the initial animated circle-feather frame.
- FrameTests.Full: fraction rect placement, percentage rect equivalence including forced px, and padded percentage strings, now explicitly fea=0.
- SchemaTests: scalar dash versus solid and list dash covered-area comparisons, now explicitly fea=0.

All remain. Default-path twins now sample real geometry with pixel edges on: rounded inset, rounded-rectangle support, inward hole ring and hairline support/coverage at 0.24/0.48/1.22/3 px per unit. Each of the 13 new checks rejected the fallback route first, then passed when the default-path helper no longer supplied nopixeledges=1. The tag's geometry needed no production change.

Literal words, empty strings and percent substitutions no longer gain a literal-only trap. decisions:77 overrides the plan row 116 wording: the preview shows the mod's own report; true/false stay accepted. Expression warnings and nested-list/scalar-dash warnings remain. Plain-word tests failed before removal and pass afterward. Both observation fixtures failed the editor parser on reserved c before changing their T lines to f; they now pass parseSrc and checkScene as well as the C# draw check.

The numeric-array text gap is covered for a whole binding and placeholder, both with and without missing=empty. These pass with the already linked StringSlot; no additional port was required. CaptureOverlay's stale composite comment and PointerInput's ending line are corrected. Bare remains a last-resort VBF2 frame with an explicit compatibility comment, supported by the reader's existing VBF2 tests. The two spec log entries now share normal adjacent-list formatting. Dated M2a/M2c reports are untouched in this round.

CLEAR restoration was superseded by the owner's checkerboard decision; no restoration is claimed. The vector mod's author answered: "NOT the vector path, so 0.11.118 cannot have changed it." It emits only scene geometry; the float-sRGB channel exists only on vector meshes. Whether #0A121C was any actual game ground was unknown; the capture camera clears transparent, so its capture could not establish that. The later owner ruling removes the stand-in rather than choosing another colour.

## Checkerboard follow-up, 2026-10-13

The owner states "console without a bg assigned have NO background", and chooses "checkerboard". This supersedes both CLEAR colour choices. The changed "clears to the original sRGB ground colour" test is now "clears the capture target to transparent without a stand-in ground", asserting (0,0,0,0); no (13,22,28) restoration remains. #0A121C was a preview stand-in, never established as a game ground colour. The vector mod's author confirmed that empty ground is not on the vector path; the capture camera clears transparent, so a capture cannot establish any game ground colour. That unanswered historical colour question is outside this re-pin.

The page interior is not painted by canvas CSS: the generated runtime declares a native panel with style pg.bg (web/src/codegen/runtime.lua:863). Page backgrounds are project content; default new pages receive the theme's top/bottom screen colours (web/src/model/project.ts:27, web/src/theme/index.ts:37). Neutral's screen role is #262626 (38,38,38), with a #2B2B2B → #202020 default panel ramp. This explains a dark interior separately from the old WebGL clear outside the page; a particular sample cannot establish which point of that ramp it read. Assigned panels remain drawn content. Empty areas in the target now remain transparent; only the displayed page receives #282828/#303030 in 8 CSS px cells. The workspace canvas is transparent outside the page, exposing the existing redesign background and dot grid. No chrome CSS changed.

Scene RGB accumulates premultiplied in linear light with independently accumulated alpha, in the existing sRGB8 target. Its output composites over the decoded checker and encodes once. The cover initializes its presentation RGB over the same decoded checker, preserves alpha for the existing post-label coverage pass, and keeps the existing DOM-text limitation. CaptureOverlay's renderer.readPixels reads the scene FBO, never the display; the comparison ignores RGB of two alpha-zero pixels.

Six browser-entry WebGL 2 checks cover empty target/display, translucent black in linear light, opaque page fill then removal, zoom/outer workspace, cover composite and device density. All six reject the former clear/presentation route and pass the new route. This is an automated headless software-renderer run, separate from the owner's real-browser observations above. The translucent anchor is computed from decode(40/48) at alpha 128/255 (rounded 26/32); an early hand calculation of 28/34 was corrected to that transfer-curve calculation without increasing tolerance. The target-clear, separate-alpha and target-read unit checks fail on the old renderer and pass on the new one. The transparent-compare check fails before the RGB skip and passes after; all existing nontransparent comparison checks remain.

Outside the requested renderer/Canvas/CSS files, production changes are limited to web/src/editor/diff.ts (ignore meaningless RGB when both compared pixels are transparent) and a comment in web/src/theme/index.ts (remove the false claim that the canvas clears to M1_GROUND). The latter constant remains an assigned legacy project/example colour, not an empty-console default. Tests and the requested spec/decisions/report also change. No export behaviour, dependencies, limits or upstream workaround was added. web/test/transparency.ts is the reproducible browser test entry; its temporary bundler/runner and logs remain outside the repository.

Review fix commit: 6153099 Address the re-pin review findings. The checkerboard commit follows the six-suite run below.

## Fix-round six-suite verification

Run in the required order, after the checkerboard code and before its commit. Each exit code was read; the script gated the next stage on it.

| Stage | Exit | Result |
|---|---|---|
| Release browser-wasm publish into an emptied publish directory | 0 | Published with VectorSrc set to the vendored checkout |
| npm run precore | 0 | Browser core copied |
| npx tsc -b | 0 | Type check passed |
| npx vitest run | 0 | 242 files; 3981 passed, 1 skipped (3982 total) |
| npm run build | 0 | Built; public-path check: 123 files, zero local paths; base-path check: 9 files |
| Core.Tests with the same VectorSrc | 0 | 2129 PASS checks, zero FAIL; ends ALL PASS |

No 5-second timeout occurred; no standalone timeout rerun was needed. The one optional device-catalogue extractor test remains skipped without its external inputs. The pre-existing large-chunk warning remains (1,434.05 kB entry chunk, 900 kB warning threshold). No threshold changed. Earlier targeted core runs lacked four web-generation stamps; this ordered run generated them and passed all four checks. The separate browser entry returned exit 1 with 0/6 passes on the old route, then exit 0 with 6/6 passes on the new route. Its three unit files pass 44/44 after rejecting the old route.

No new upstream fault was found. The existing DOM-label translucency approximation remains; hardware browser observation of this checkerboard change is not claimed. For observation, use a surface with no opaque assigned page panel (or a page background #00000000): empty areas show 8 CSS px checker cells at 80% and 200% zoom; a half-transparent black rect dims them in linear light; a page-filling opaque rect hides them, and removing it reveals them again. Outside the page, verify the redesign's workspace and dot grid. CaptureOverlay/raw reads of empty cells must be (0,0,0,0), never checker greys. The owner dropped game step 9; no game run or capture was added.

## No-background export and inspector follow-up

This work started from 1e892c5. The owner's browser observation at that tip, fresh origin and 194% zoom, found an empty interior at (38,38,38), with no checker under a 50% shape. The earlier renderer-only tests missed an implicit export background. The owner decision remains: "console without a bg assigned have NO background", then "checkerboard". This round checks actual generated Lua → ChipRunner/Compositor → VBF3 → WebGL, rather than a manually empty frame.

Page.background is optional. bgLit returns nil for absence (also an empty list); VB.build declares a native bg panel only when pg.bg exists. A prior panel is removed by the existing ui:clear before rebuilding. Valid assigned colour/gradient bytes are unchanged. Invalid explicit colours now sanitize to transparent instead of a dark stand-in: bgLit has no M1_GROUND fallback. loadProject also stopped restoring M1_GROUND; empty lists normalize to undefined, while save/load and theme switches preserve absence. The M1 constant remains only an explicitly assigned vector-example colour. No renderer change or workaround was added in this round.

No page-background control existed in PageSettings at the merged tip: it contained Name, PageShape and Remove page. The new Background control is beside PageShape, in Inspector → Design → Page (open Page if collapsed). It offers No background, Colour and Vertical gradient and reuses the existing colour/alpha picker. No background dispatches one setPageBackground with undefined, one undo step; undo/redo and setting a colour again are tested. New pages still use groundOf(theme). An adoption-code non-null assertion only records its existing invariant after assigning a captured gradient; it changes no adoption behaviour.

All seven shipped starters were inspected: Airlock, Atmos/tanks, Blank, Needle gauge, Overview, Power and Solar each assign #2B2B2B → #202020. None lacked a background. Their theme variants and all pre-existing codegen fixtures have assigned backgrounds. Devices has no independent background value: it derives the first page's. The generated no-background tests include Devices and confirm no native bg panel after visiting it.

Failure evidence: the export/Devices nil check, inspector No background/undo test, save/load test, loadProject absence test and invalid-colour test failed before the production changes, then passed. Both generated exports (empty scene and 50% black rect) initially produced alpha 255 in their empty areas in WebGL; the final checks reject that old export route (0/2, exit 1) and pass the new one (2/2, exit 0). Core checks assert the active edited surface before composing it: an unresolved required role initially opens Devices, so inspecting unvisited main would be vacuous. The test visits p1 explicitly, then Devices. Assigned flat/gradient checks and new-page default checks remain.

The empty scene also exposed the tag's deliberate magenta diagnostic border (Tessellator.cs:491-492, emitted == 0). It is drawn content and remains; the empty interior reads alpha 0 and shows the checker. The initial corner probe was on that border; the final zero-alpha probe is at (8,8), with a separate assertion that the border remains visible. No alpha tolerance was loosened and no upstream marker was hidden. Upstream should decide whether an intentionally empty valid scene should retain this diagnostic.

A separate test-helper defect was found: FrameTests.Sample included both triangles on a shared diagonal, reading a half-transparent quad as 75% instead of 50%. A dedicated exact-alpha regression failed first. The sampler now follows the GPU's top-left fill rule, and that check plus the real exported rectangle's 50% check pass. Production rendering already used the GPU rule and was unchanged.

Golden regeneration used one update command. All 39 existing Lua goldens were read and compared in full against their previous contents: the sole change is the conditional around the native bg panel declaration, with all config, assigned background and scene bytes unchanged. Two new no-background Lua goldens cover the empty and translucent pages, both with Devices. No starter JSON or host/page manifest bytes changed. The update run saw one stale invalid-colour expectation and eleven manifest comparisons against snapshots awaiting the update flush; the invalid expectations now assert transparent while retaining their cases, and all 202 generate/input checks pass after the snapshot writes. Targeted core runs still lacked four web-generation stamps; the ordered full suite below produces them.

### No-background final verification

All six stages ran in the required order before the commit, gated by their actual exit codes:

| Stage | Exit | Result |
|---|---|---|
| Release browser-wasm publish into an emptied publish directory | 0 | VectorSrc set to the vendored checkout |
| npm run precore | 0 | Core copied |
| npx tsc -b | 0 | Type check passed |
| npx vitest run | 0 | 248 files; 4031 passed, 1 skipped (4032 total) |
| npm run build | 0 | Public paths: 123 files, zero local paths; base paths: 9 files |
| Core.Tests with the same VectorSrc | 0 | 2142 PASS, zero FAIL; ALL PASS |

The final automated WebGL run consumes the VBF3 frames that stage 6 wrote from the actual exported fixtures: 2/2 pass, exit 0. The paired old-export run with these same final probe locations failed 0/2, exit 1, reading alpha 255 in the empty interior. This is a headless software-renderer check, not a claim of owner/hardware browser observation. No 5-second timeout occurred; no standalone timeout retry was needed. The four generation-stamp prerequisites pass after the full web suite. The optional external device-catalogue extractor remains skipped; the pre-existing large-chunk warning remains (1,437.27 kB entry chunk against the unchanged 900 kB threshold).

For owner observation: in Inspector → Design → Page, choose Background → No background on a default page. Look for fixed-size checker cells in the interior at 80%, 194% and 200%; a 50% shape should leave them visible through it. Raw/capture reads in empty interior cells should have alpha 0. Choose a colour or vertical gradient to assign a panel again, then undo to return to none. The mod's empty-scene magenta diagnostic border is retained as drawn geometry; the checker is visible inside it. Workspace chrome, all starter JSON, the export floor and the vendor pin are unchanged. No push, dev server or game action was performed.
