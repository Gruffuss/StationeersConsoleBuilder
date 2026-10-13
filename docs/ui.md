# The editor UI (redesign, 2026-10-12)

The builder's UI was a rough functional prototype on purpose (spec §11, M2c: the owner designs the final UI afterwards). This is that design, built from the owner's design canvas and the UI redesign plan. Every capability of the prototype and of M5 is kept; behaviour is unchanged except where the owner asked (below).

## What was built
- **Look.** The editor chrome is Vanilla + drawn at 50 % of its token sizes (smallest text 12 px), whatever theme the project uses; the project's theme only styles the console pages. Chrome faces are bundled woff2 with their licences: Barlow and Barlow Condensed (under private family names, so the preview's own font registry is untouched) and JetBrains Mono for code. Nothing is fetched for the chrome.
- **Layout.** A blue header banner with the project name, the save state and the menus Project, Edit, Object, Style, View, Help; then Theme, Fonts, Play and Export. A tool rail on the left; a sidebar with tabs Layers | Widgets (pages above the layer tree, Definitions at the bottom); the canvas with its selection path, frame label (its console size opens the console sizes in one click; Custom clears the selection and goes to the inspector's Page section) and a task bar under the selection; the inspector on the right with tabs Design | Data | Logic | Sim | Lua, whose Design tab starts with the Page section (name, console size, background) when nothing is selected and leaves it out under a selection (owner, 2026-10-13); the scene source pane under the canvas, open by default; a status bar (zoom, fit, 100 %, fit selection, pans, X/Y, Snap, Grid, Gap, Source, run line, check chip, Messages drawer).
- **Menus.** Every command of the old Commands list is in the Edit, Object or Style menu with all its keys shown; key-only commands (Enter the group, Leave the group, Select the parent, Back to Select) have entries too. Menus stay inside the viewport and scroll. No menu or popover contains its own dropdown: the Theme menu lists the themes itself (Provided, Project, This browser) with Save to browser, Remove and Import a design system… as items.
- **Dialogs** (modal, native `<dialog>`): New and open, Share link, Fonts, Export, Import a design system, Adopt a script, Keyboard shortcuts, and the autosave choices ("Not saved", "Choose a project"). The Export dialog lists every mod the script needs, in load order, each linked: BepInEx 5.x, StationeersLaunchPad, IC10 Editor, StationeersLua, ScriptedScreens, ScriptedScreens Vector (the export floor or newer), and ScriptedScreens Fonts when the screen uses another face or a web font.
- **Mount points for M6** (empty until M6 fills them): `ExportControls` `send?`, rendered under Download and Copy with the exact artifact while they are enabled; `StatusBar` `game?`, an always-mounted slot before the run line; `LogicPanel` `roleDevice?`, beside each role's pin disclosure.

## Owner decisions and answers (2026-10-12)
- Inspired by Illustrator and Figma; modal dialogs allowed; chrome Vanilla + at 50 %; source pane open by default under the canvas; simple line icons for now; a monospace code face (JetBrains Mono).
- One page on the canvas at a time, with the frame look (not every page as a frame); the import panel hosted in a scrolling dialog (no step wizard); developer items stay in every build under Help › Developer; node-id rename stays in the Layers row; no bar that appears with a gesture.
- Behaviour changes the owner asked for: Blank project and Wipe persist now ask for confirmation (Cancel focused, Esc cancels); the start-up "Choose a project" dialog has Close, which like Esc does what Continue without autosave does; "Not saved" does not pop up again right after an explicit Continue.
- Chip, device and network reference ids are never shown: the Sim tab shows device names, the write log names its destination, and a role's fixed reference sits in a collapsed "Advanced" disclosure, "Pin to one specific device".
- Mobile is out of scope for this build. A cleanup pass follows once the owner has worked with the new UI.

## The rule the layout keeps
"The canvas never moves under the pointer": nothing in the chrome mounts, unmounts or re-wraps when a gesture starts or ends. Dialogs and drawers stay mounted; opening or closing a dialog re-renders only the dialog, not the canvas, Layers or inspector. A test counts renders during a drag and during dialog open and close.

## Evidence
- Offline: TypeScript, the web suite (225 files, 3,857 tests passed, 1 skipped), the production build with its public-path check, and the C# suite (ALL PASS), on the final tip. "Nothing dropped" tests record each panel's control names at the start and compare after.
- Browser, at 1440×900 and 1100×800: every menu by mouse and keyboard; every tool; select, move, resize, rotate, marquee, nudge, group entry, wheel pan and zoom; the header, status bar, sidebar, canvas, rail, inspector and source pane rectangles were identical at every pointerdown, pointermove and pointerup across 33 samples; status bar, sidebar, inspector tabs, every dialog (keys typed in a dialog never reach the canvas), Play, and scripts mode.
- Not seen in a browser: boot with no saved project; the start-up Close path (needs storage to fail at boot); drag-and-drop in Layers; Space-drag, pinch and a real Ctrl+wheel; pending native colour-picker values; downloads.

## Measured costs (1,152 root widgets, with Layers visible)
- Opening a dialog: about 3.2 s before the fix (New and open about 5 s), about 0.2 s after (to the DOM commit; paint not included). Closing: about 0.18 s.
- Drag, pointermove to the next painted frame: too noisy to compare on that scene. Both the redesign and the previous UI run 0.7-1.5 s main-thread tasks on it (the scene also exceeds the chip's 50,000-instruction tick), and the samples overlap. At idle the redesign shows no long tasks; the previous UI showed one of about 0.7 s every second.

## Not built from the canvas, with the reason
- Every page as a frame on one canvas (owner: one page at a time).
- The pen's bar during drawing (the gesture rule).
- Import as a three-step wizard (owner: hosted as is).
- Detach in the selection task bar (Detach waits for the widget panel's own pending field edits).
- Export's collapsed "Show the script" (a copy failure focuses that text area, which a closed disclosure cannot take).
- Export's per-page OK rows and "Checked just now" (the check reports no per-page clean list; a relative time needs a timer).
- The main-menu button with no defined function; fields inside menus (they would duplicate the status bar's names); palette thumbnails (line icons instead); the page-shape list grouped by mod.

## Left out
- Phone-width layout (out of scope).
- A batch of low-severity polish items from the reviews: menubar roving focus and Home/End, a `<main>` landmark, the tabs' `aria-controls`, a few dead CSS rules, test hygiene.
- The large-bundle build warning (the main chunk is above 900 kB), unchanged by this work.
