# VectorBuilder

VectorBuilder is a free web editor for Stationeers console screens. Draw a screen, bind it to device data, add pages, controls and logic, and export one Lua 5.2 script for a programmable chip running ScriptedScreens Vector **0.11.118** or newer. The preview runs the vector mod's own C# scene core and the game's Lua interpreter in WebAssembly, with simulated devices. It talks to your own running game only when you ask it to: see "Send to chip, the game link and the device picker" below.

**Open the builder:** [https://gruffuss.github.io/StationeersConsoleBuilder/](https://gruffuss.github.io/StationeersConsoleBuilder/). Everything runs in your browser; projects are not uploaded.

**Status:** release 2, adding the Power wall (3×2 and 2×3) and Hydro farm (3×2) starters; a blank page now shows nothing. Exports need ScriptedScreens Vector 0.11.118 or newer.

## What your game needs

Each exported script lists these in its header, in load order, with their links:
1. [BepInEx](https://github.com/BepInEx/BepInEx) 5.x, the mod loader;
2. [StationeersLaunchPad](https://github.com/StationeersLaunchPad/StationeersLaunchPad), which loads the mods below;
3. [IC10 Editor](https://steamcommunity.com/sharedfiles/filedetails/?id=3592775931), which StationeersLua and ScriptedScreens depend on;
4. [StationeersLua](https://steamcommunity.com/sharedfiles/filedetails/?id=3659911735), which runs the script on a programmable chip;
5. [ScriptedScreens](https://steamcommunity.com/sharedfiles/filedetails/?id=3666779631), the screens the script draws on;
6. [ScriptedScreens Vector](https://steamcommunity.com/sharedfiles/filedetails/?id=3787517570) 0.11.118 or newer. On an older vector mod every page shows a banner asking for the update;
7. [ScriptedScreens Fonts](https://steamcommunity.com/sharedfiles/filedetails/?id=3803224901), only when the screen uses a face other than the game's default (Liberation Sans) or declares a web font; the header names the faces.

## Still to be seen in game

The builder's checks pass, and console pushes, script sizes and embedded project blocks were seen in game on 2026-10-12. These are not yet confirmed on real devices or in a real browser session; [the M4 verification report](docs/m4.md) has the measured results and the details:
- toggles and steppers, the Power starter's generator overrides and the Airlock starter's door commands on real devices;
- the Solar starter's electrical units;
- text shaping beyond the captured cases;
- copying with a physical clipboard gesture, the browser's own file chooser, spoken screen-reader announcements and a second browser engine;
- the cost of reading font metadata while a page is active.

## Export a screen

1. Open a template or example, then edit the scene, widgets, data, logic and simulated inputs.
2. Click **Check export**. After a completed check without errors, use a separate **Download** or **Copy** click. Both use the exact checked artifact, including its fixed UTC timestamp and builder version.
3. **Embed project** defaults on. The last Lua comment contains recoverable project data; the UI shows exact comment and total UTF-8 bytes. You can turn embedding off. Scripts larger than the previously measured 1,057,682 bytes get information, not a size cap.

Known errors block Lua export. Warnings do not: nothing the mod accepts is refused. A timeout, cancellation or worker failure is an incomplete check. **Export unchecked** is available only after incompletion, with no known errors, and explicitly acknowledges the named unfinished checks. It does not claim a pass. Retry or download JSON whenever you need to rescue work. If clipboard access fails, the current Lua remains selectable.

The isolated check uses cold persist/memory and simulated inputs, compiles and loads once, and samples `max(20, 2 × generated pages)` half-second ticks, including Devices. It does not exercise click handlers, actual device physics, TMP layout or Fonts API/download delivery. The mod reports at most 16 distinct scene problems per scene; missing data, starvation and dropped geometry are separate diagnostics. A clean sample does not prove every future action or save succeeds.

## Save, restore and share

- **Save JSON** preserves the whole authored project, even if its Lua cannot run. Open a `.json` file or paste JSON through the project controls.
- Open a builder `.lua` export to recover its last genuine embedded project block. Text pretending to be a marker inside a Lua string does not qualify. Importing the block never executes the surrounding Lua; recovered custom Lua runs in the existing metered preview after project loading. A script without a block offers **Adopt this script**, with a console shape choice. Only that click runs a capture in a disposable worker. Adoption makes the captured artwork editable, keeps captured values as unbound preview samples and lists click ids, errors and omissions in an adoption report. The original Lua is kept verbatim as a long comment that never runs in the preview or export; keep the original file for porting its logic by hand. **Stop** cancels capture and leaves the current project intact.
- A share link contains `#p=1.<compressed project>`. Copy link is offered only when the entire absolute URL is at most **8,000 characters**. Larger projects use JSON; links are never truncated. Compression output can differ between browsers while decoding to the same project.
- Projects, imported font bytes and chip stores are not uploaded. Fragments are not part of HTTP requests. A shared project includes custom Lua, simulated setup, font names and exact authored font URLs: share only material you intend its recipient to receive.

Links and files are untrusted input. An overlength fragment is rejected before decompression. Gzip declarations are checked before and during decoding, with the browser's measured string limit as the final platform boundary. Files are read in the transfer worker and are not copied into the text box. **Stop** ends a pending read; the file remains available for retry.

A project fragment is removed from the address bar while decoding. Successful decoding restores it until a durable autosave consumes that same fragment. Content rejection leaves it removed so reload cannot repeat a bad link; a transient failure restores it with a reload warning. If the tab dies during decoding, reload uses ordinary saved-project startup. Keep the original shared link or JSON file separately.

## Browser-local autosave

IndexedDB keeps one current project and one recovery project. Startup reads storage before saving or loading the preview: a valid unconsumed fragment takes precedence over current storage, then Blank. A restored project begins with empty undo history.

Committed edits save after 500 ms without a project change. Transient drag geometry, selections, frames and ticks do not become saved edits; undo/redo do. An explicit replacement rotates the displaced current project into recovery only on its first successful save. Further edits keep that recovery; another replacement can replace it. This is one displaced project, not an edit history or project library. Closing-page flushing is best effort.

Storage failure and another tab's newer revision pause saving visibly. Download JSON to keep the current edits; choose the offered saved/recovery/Blank or retry actions deliberately. A conflict never silently overwrites the other tab or retries with its revision. Clearing browser storage removes these browser-local copies, so keep JSON backups.

## Templates and themes

All ten starters follow the current **Neutral** or **Vanilla +** theme. Neutral uses the game's own face, previewed with Liberation Sans; its widget-only exports need no Fonts mod. The seven square-console starters are the builder's own; the corpus fixtures are examples only, not appearance specifications for them. The two Power walls and the Hydro farm rebuild the owner's two working console scripts from widgets, at the consoles they were made for: their behaviour follows the scripts and their look the theme ([docs/templates-power-farm.md](docs/templates-power-farm.md) maps each script and lists what is built differently).

| Starter | Intent |
|---|---|
| Overview | Independently named battery-charge and room-temperature starter; 50%, OK and 22 °C in its sample. It does not reproduce an outside console design. |
| Atmos/tanks | Read-only pressure/temperature and pressure history; sample 5,000 kPa, half-scale and 20 °C. |
| Power | Generator Auto/On/Off overrides; Auto turns on below 0.1 charge fraction, off above 0.25, and holds between them. |
| Airlock | One door open at a time: the other door must read shut and settled, 1.5 s after it was commanded shut. Holds both doors in Logic mode and unlocked and writes Open and Setting together; the button on a door asks for it; boot leaves the doors as they are. The two door roles never bind the same airlock. No automatic pressure cycle or physical-safety claim. |
| Solar | Read-only Charge/Maximum monitor; sample raw output 3,000 and maximum 5,000. Electrical units remain unverified; no kW conversion or tracking. |
| Blank | Empty project; a blank page shows nothing. |
| Needle gauge | Plain-shape pressure dial: 0/50/100 kPa points left/up/right; values above 100 clamp right and missing/out-of-range readings hide the needle. This starter is separate from E1's Gauge widget. |
| Power wall (3×2) | A station power wall on a 3×2 console (MoreConsoles, landscape): battery storage with a cell per battery, what is made and used now and yesterday, solar panels by type with tracking and Park, solid fuel generators with Auto/On/Off (on below 0.1 charge, off above 0.25) and their vent, the sun, and the coal reserve. |
| Power wall (2×3) | The same power wall laid out for the vertical 3×2 console (two wide, three tall): the same devices, logic and controls. |
| Hydro farm (3×2) | A hydroponics farm on a 3×2 console: runs the LArRE harvester along the trays (harvest, dump, replant, Pause, Send home, Dump now), the grow-light day by plant (Auto/On/Off, Skip) and the export bin door; a 90-pot growth strip, a plant picker and a settings page. |

**Open example** still opens vector examples 01–19 as editable projects, including examples 18/19. The raw **Example scripts (dev)** route also remains.

## Fonts

Bundled preview faces are self-hosted. Local font imports stay in the browser and are not embedded in Lua, JSON or links. Their names travel as authored data; a recipient without the face gets the existing attribute fallback or literal unknown rich-font-tag behavior. Local import/removal and pending/settled page delivery do not change an already prepared export or its warnings.

Authored `FONT src` URLs travel exactly. Opening, restoring, sharing, checking and exporting grant no download consent. Only an explicit active-page **Add**, **Load** or **Retry** starts preview requests: HTTPS CSS on `fonts.googleapis.com`, HTTPS assets on `fonts.gstatic.com`, without redirects. The requirements header discloses declared faces/links, Fonts API capabilities and shared game limits; preview loading does not prove delivery in game. Chan## Send to chip, the game link and the device picker

These reach your own running game through StationeersLua's MCP endpoint at `http://127.0.0.1:3030`, the default address of its listener. None of them asks the game anything until you click.

- **Send to chip.** An optional, advanced section of the Export dialog, hidden until you tick **Show Send to chip (advanced)**. It pushes exactly the checked script, unchanged, to a chip, then reads back the vector mod's statistics and a capture of the screen. The game saves each capture as a PNG file on your computer and answers with its path. Sending replaces the chip's program, with no backup: keep your own copy of the chip's code. If an IC editor in the game shows that chip, it shows the new code too.
- **The game link.** The status bar's game item (**Game: not linked** until you link) opens a dialog that links this tab to one chip: pick it from the game's chip list by name, or click **Use the chip selected in the IC editor**. Send then writes to the linked chip, and the linked console's screen size is offered as the page's shape, which the page's own shape control can still change. The link lasts until the tab closes.
- **Pick a device.** Each role in the Logic panel can take a real device from the linked chip's network (every network when nothing is linked), by its name: the pick writes the device's prefab and its name into the role, never its id, so the role finds that device by name. A role pinned to one specific device keeps its pin.

To set up the game:
- In StationeersLua's settings, under `[MCP Server]`, turn on `Enabled`, add exactly this site's origin, `https://gruffuss.github.io`, to `AllowedBrowserOrigins`, then restart the game: a change to that list took effect only after a restart. Do not add `*` or any other origin: that list is what stops other web pages from reaching your game.
- Which chips the game lists is set by StationeersLua's chip-access settings: the chip selected in an IC editor, a Wireless Development Board with `AllowNetworkChipAccess`, or worn gear with `AllowPersonalAreaNetworkChipAccess`. A chip the game does not list cannot be sent to or linked.
- Your browser may ask whether this site may reach devices on your local network; these features need that permission.
- Chips, devices and their ids are never shown and never kept: nothing about your game enters the project, its links or its exports.

## Development and verification

Use Node 24, .NET 10 (SDK 10.0.401) with the WebAssembly workloads (`dotnet workload install wasm-tools wasm-experimental`), and the recorded submodule pins (`git submodule update --init`). When the vector checkout is not at `core/vendor/vector`, pass its absolute path, ending in a slash, as `-p:VectorSrc=` to the publish and the core tests.

Run these in order; each must exit 0:
1. From the repository root, into an empty folder: `dotnet publish core/Wasm -c Release -o core/Wasm/bin/publish`.
2. In `web`: `npm ci`, then `npm run precore` (copies the published core and the vector examples into `web/public`).
3. In `web`: `npx tsc -b`, `npm test` and `npm run build`. The web tests write the exact M4 artifacts the C# suite reads, so they run first.
4. From the repository root: `dotnet run --project core/Core.Tests`. It ends with `ALL PASS`.

`npm run dev` serves the app. The build checks its output for local paths and, when `VB_BASE` is set, for any load from outside the site's path. The site is served under the path in `VB_BASE` (default `/`): a GitHub project site builds with `VB_BASE=/<repository>/`. The build's **900 kB** chunk warning remains enabled; the main bundle is currently above it. Native browser compression, actual worker routes and browser-local storage are separately verified in [docs/m4.md](docs/m4.md).

### Continuous integration and the site

`.github/workflows/ci.yml` runs the steps above on a clean Linux checkout for every pull request and every push to `main`, then deploys `web/dist` to GitHub Pages from `main` only. Both jobs are off until the repository's owner switches them on with repository variables (Settings › Secrets and variables › Actions › Variables):
- `VB_CI` = `on` runs the build and tests;
- `VB_DEPLOY` = `on` also deploys on a push to `main`. Pages must be set to deploy from GitHub Actions (Settings › Pages).

Without these variables every job is skipped. Deleting a variable switches that part off again.

## Licence

VectorBuilder is released under the [MIT License](LICENSE). The site and this repository also contain third-party components under their own licences: Lua-CSharp, the vector mod, the .NET runtime, the bundled fonts and the bundled npm packages, listed with their licences in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md); the site serves the same file as `THIRD-PARTY-NOTICES.txt`.
