# The Power wall and Hydro farm starters

Three starters rebuild the owner's two working console scripts from the builder's own widgets (owner, 2026-10-13: "Rebuild
each from builder widgets (slower). Fully editable like the other starters, with data and logic in the panels. The look
follows the theme, and the behaviour matches your scripts", and "do not resize them, they are made for 2x3 consoles"):

| Starter | Script | Layout | Page shape |
| --- | --- | --- | --- |
| Power wall (3×2) | PowerConsole.lua | its 3x2 landscape artboard (1440 x 960) | `3x2`, 714 x 460 px, 1490 x 960 units |
| Power wall (2×3) | PowerConsole.lua | its 2x3 portrait artboard (960 x 1440) | `v3x2`, 460 x 714 px, 960 x 1490 units |
| Hydro farm (3×2) | HydroFarmConsole.lua | its 3x2 artboard, three pages | `3x2`, 714 x 460 px, 1490 x 960 units |

The two Power walls share their devices, reads, writes, thresholds and logic; only the layout differs. The scripts are the
ground truth for behaviour; they are not copied into the repository. Looks come from the theme (Neutral or Vanilla +),
never from the scripts' colours or fonts.

Panels are placed where each script's own layout function puts them on the shape's real design size (the scripts grow the
artboard along its spare axis to the screen's aspect: a 3x2 console is 1490 x 960 units, the vertical one 960 x 1490), so
every panel rectangle below is the script's, in units:

- Power 3x2: header 24,24,1442,64; Storage 24,104,1442,284; Now 24,404,470,288; Solar panels 510,404,470,288; Coal
  generators 996,404,470,288; Yesterday 24,708,470,228; Sun 510,708,470,228; Coal reserve 996,708,470,228.
- Power 2x3: header 24,24,912,64; Storage 24,104,912,416.5; Now 24,536.5,448,298.5; Yesterday 488,536.5,448,298.5; Solar
  panels 24,851,448,300.5; Sun 488,851,448,300.5; Coal generators 24,1167.5,448,298.5; Coal reserve 488,1167.5,448,298.5.
- Hydro farm main: header 24,24,1442,64; Light cycle 24,104,470,608; Plant 510,104,470,288; Export bin 996,104,470,288;
  Larre 510,408,470,304; Harvest 996,408,470,304; Pots 24,728,1442,208. Picker: one panel 24,104,1442,832 with a 6 x 3
  grid of tiles. Settings: Pots 24,104,713,358; Light phase 753,104,713,358 (on 1490 units: (W - 64) / 2 columns);
  Harvest 24,478,713,358; Dark phase 753,478,713,358; the bottom bar 24,852,1442,84.

Carriers, in the builder's words: a **role** finds devices (by prefab, optionally by Labeller name); a **read** reads one
LogicType or slot type from a role, with an aggregate, a scale, thresholds and a derived expression; a **binding** feeds a
widget's data name from a read, a state, an expression, a constant or a custom export (`X.<name>`); a **state** is a
saved variable; an **action** runs steps when a control is pressed; a **rule** writes a device when its value's read-back
differs. **Custom Lua** is used only where no panel feature expresses the behaviour; every such use is listed.

## Power wall

### Devices

| Script | Builder |
| --- | --- |
| Station Battery and Station Battery (Large), by prefab hash, every one on the network | role `batt`, prefabs StructureBattery and StructureBatteryLarge, mode all, optional |
| Generator (Solid Fuel), every one | role `gen`, StructureSolidFuelGenerator, mode all, optional |
| The twelve solar panel prefabs, every one, grouped by prefab | role `panels`, the twelve prefabs, mode all, optional; the grouping by prefab is custom Lua (below) |
| The eight tracked panel prefabs (standard, dual, 1x5, dual 1x5 and their heavy versions; flat and angled are left alone), written by `ic.batch_write` per prefab | role `tracked`, those eight prefabs, mode all, optional |
| The first Daylight Sensor found | role `sun`, StructureDaylightSensor, mode one, optional |
| Every Active Vent labelled `GeneratorsVent` | role `vent`, StructureActiveVent, label GeneratorsVent, mode all, optional |
| Rescan every 10 s (20 ticks) | the runtime's own rescan, every 20 ticks |

### Reads and derived values

| Script | Builder |
| --- | --- |
| stored = sum of battery Charge, cap = sum of Maximum | reads `cap` (Maximum, sum) and `stored` (Charge, sum) |
| pct = stored / cap, nil without batteries | read `frac` (Charge, sum) with derived `P.cap and P.cap > 0 and x / P.cap or nil`, thresholds warn below 0.5 and crit below 0.1 (the script's CELL_WARN and CELL_CRIT, which colour its storage bar) |
| using = PowerActual of the FIRST battery only (every battery repeats its network's total) | read `using` (PowerActual, aggregate list), bound as `P.using and P.using[1]` |
| solar = sum of panel Charge (W) | read `solar` (Charge, sum) on `panels` |
| coal = sum of generator PowerGeneration | read `coal` (PowerGeneration, sum) on `gen` |
| per generator kW and coal (slot 0 Quantity) | reads `genW` (PowerGeneration, list) and `genCoal` (slot 0 Quantity, list) |
| coal left = sum of slot 0 Quantity | read `coalN` (slot 0 Quantity, sum) |
| sensor Horizontal, Vertical; Logic Extended TimeOfDay (#1110) and DayLengthSeconds (#1114) | reads `sunH`, `sunV`, `tod` (#1110), `dayLen` (#1114) on `sun` |
| net = solar + coal - using | custom export `net` (custom Lua, since it feeds the day totals as well) |

### Writes

| Script | Builder |
| --- | --- |
| Generators On: Override On 1, Off 0; Auto 1 below 0.10 charge, 0 above 0.25, else no write; written only when the read-back differs | rule on `gen`, On = `S.mode == 1 and 1 or S.mode == 2 and 0 or (P.frac and (P.frac < 0.1 and 1 or P.frac > 0.25 and 0 or nil))`; nil holds |
| The GeneratorsVent follows the same want | the same rule on `vent` |
| Tracking every tick: Vertical = sensor Vertical + 90, Horizontal = sensor Horizontal + 90 | rules on `tracked`: Vertical = `S.parked and 90 or (P.sunV and P.sunV + 90)`, Horizontal = `not S.parked and P.sunH and P.sunH + 90 or nil` |
| Parked: Vertical 90, Horizontal left as it is | the same two rules (nil holds Horizontal) |

The script batch-writes the panels every tick; a rule writes a panel when its read-back differs, which leaves the same
values on the panels.

### Controls and states

| Script | Builder |
| --- | --- |
| Override AUTO / ON / OFF, saved (`power.cfg`) | Option group, state `mode` (0 auto, 1 on, 2 off, saved); its three options set it |
| PARK PANELS / RESUME TRACKING, saved | primary Button with two states, action toggles state `parked` (bool, saved); the label follows `parked` |

### Screen

| Script | Widget and binding |
| --- | --- |
| Header POWER, clock, warn and crit counts | Header bar: clock bound to `util.clock_time("HH:MM")` (guarded, `--:--` without it), warn to the custom export `nwarn` (every active alert: damaged panels, parked), crit 0 |
| Storage hero: charge %, bar, status word, net kW | Readout tile (hero): value `P.frac * 100`, unit %, bar `frac`, state `frac`'s state, status `Charging` / `Discharging` (custom export), supporting value the signed net kW (custom export) |
| Stored, Capacity, Time left or Time to full, Batteries | Key–value table: `stored` and `cap` in MJ, the time row (custom export; h, or min below one hour) with its caption as a Text over the row, `R.batt.n` |
| One cell per battery (max 16, 8 to a row), filled to its charge, green / amber below 0.5 / red below 0.1 | Repeater, grid of 8, 16 bars: levels and states are custom exports `cells`, `cellSt` |
| Battery count per type, only the types present | Repeater, 2 rows: names and counts are custom exports |
| Now (kW): Solar, Coal, Using, Net (warn when negative) | Key–value table; Net carries a state (custom export `netSt`) |
| Yesterday (MJ): Produced, Used, Net on 3x2; Solar, Coal, Used, Net on 2x3 | Key–value table, values custom exports |
| Solar panels: per present type (max 3 rows), light ok or warn when damaged (idle while parked), name, Qty, kW, Eff % | Repeater rows (light, name, kW) with Repeater text columns for Qty and Eff %, all custom exports; the column captions are Texts |
| One alert line: `N <type> panels damaged`, `N panels damaged`, or `Panels parked`; dropped when three types fill the panel | Alert widget, state and message custom exports |
| Coal generators: per generator (max 2) light ok while generating, name (`Generator N` while it wears its prefab name), kW, coal | Repeater rows (light, name, kW) and a Repeater text column for coal; names from custom Lua |
| Override label and buttons | Text and Option group |
| Sun: the dial, angle (`62°`, negative at night), Sunset in, Sunrise in, Night lasts (2x3) | Gauge (−90° to 90°, value = share of the day, needle idle at night), a Text for the angle, Key–value table for the times; all from custom exports over `tod` and `dayLen` |
| Coal reserve: Coal left, Coal energy (MJ), Coal lasts (h or min), Producing (2x3) | Key–value table; energy and lasts are custom exports (per-generator fuel type) |

### Custom Lua (no panel feature expresses these)

1. Grouping the solar panels by prefab: per present type, in the script's order, count, kW, mean SolarEfficiency (#1224)
   and the number damaged (SolarDamageRatio #1221 above 0); the rows, the alert text and the warn count.
2. Battery cells (each battery's Charge / Maximum, the first 16) and the count per battery prefab.
3. Generator display names (`Generator N` for an unlabelled one) and coal energy: slot 0 OccupantHash x energy per item
   (Charcoal 20 kJ, Coal ore 100 kJ, Solid fuel 200 kJ, the script's figures), then Coal lasts = energy / using.
4. Net, Charging / Discharging, Time left / Time to full with the script's h-or-min rule and its true minus sign.
5. The day totals: joules of solar, coal and use per game day (`util.days_past()`), rolled at a day change, saved every
   120 ticks and at the roll, restored at boot (today's when the day matches, yesterday's from the day before). Saved
   through the builder's `persist`, so under its own key prefix, never the script's `power.days`.
6. The sun maths: day while TimeOfDay is below 0.5, the angle above or below the horizon, Sunset in, Sunrise in, Night
   lasts, from TimeOfDay and DayLengthSeconds.

### Not built, or built differently

- **Looks.** Fonts, colours, the screen gradient, glows and shadows come from the theme. The battery and pot cells fill
  left to right (the Repeater's bar), not bottom up. The Storage status word takes the charge level's colour (the hero
  tile has one state for its bar and its word), where the script colours it by the flow direction. A Repeater row carries
  a status light, so the battery-type rows show one (always ok). Eff % is not inked warn for a damaged type; the row's
  light is. The sun dial is the Gauge's needle on its arc, not a dot on a half circle with the travelled part drawn.
- **Saved state.** The script saves `power.cfg` and `power.days`; the starter saves `mode` and `parked` as builder states
  and the day totals under the custom block's own key, so a console moved from the script starts with Auto, tracking and
  no yesterday.
- **Device choice.** The script takes the first Daylight Sensor it finds. A builder `one` role never picks between several
  unlabelled candidates: with more than one sensor, label one or pick it on the Devices page. A Devices button (an
  addition the script does not have) sits beside Park panels, since the builder's Devices page needs a way in.
- **Order.** The script lists batteries by type, name, then id and generators by name, then id; the builder orders a role's
  devices by name, then id, so batteries of two types interleave by name in the cells.
- **Batch writes.** Tracking writes each tracked panel the role holds (by ref) when its read-back differs, not every
  panel of the prefab by one batch write each tick; the panels end on the same values.
- **Threshold edges.** A read's thresholds include their edge, so the storage bar turns amber at exactly 0.5 and red at
  exactly 0.1, where the script's are strict (below 0.5, below 0.1).
- **Stationeers Logic Extended.** SolarEfficiency, SolarDamageRatio, TimeOfDay and DayLengthSeconds come from that mod and
  are read by number (#1224, #1221, #1110, #1114), as the script falls back to. The builder's device catalogue does not
  list them; the simulator carries them as its simulated values say, so the preview shows the sun, Eff % and damage. In
  game they read with the mod installed.
- **Text width.** Neutral's face is wider than the scripts' Barlow Condensed. The battery-type rows give the count a
  narrow value column (the Repeater's value width), so "Large station battery" stays whole in both themes.

## Hydro farm

### Devices

| Script | Builder |
| --- | --- |
| The first LArRE Dock (Hydroponics) | role `larre`, StructureLarreDockHydroponics, mode one, optional |
| The first Chute Import Bin | role `bin`, StructureChuteBin, mode one, optional |
| Every Grow Light, written by batch | role `lights`, StructureGrowLight, mode all, optional |
| Rescan every 10 s | the runtime's rescan |

### Reads

| Script | Builder |
| --- | --- |
| Grow lights on: count of lights with On, and the sum of their RequiredPower | reads `lightOn` (On, list) and `lightPower` (RequiredPower, list); the sum over the lit ones is custom Lua |
| Bin slot 0 Occupied, bin Open | reads `binOcc` (slot 0 Occupied), `binOpen` (Open) |
| Larre Error and Power | reads `larreErr` (Error), `larrePower` (Power) |
| Larre Idle, PositionX, TargetPrefabHash, slot 0 (the hand: Occupied, OccupantHash, Quantity), slot 255 (the tray under it: Growth, Health, Efficiency, Seeding, Occupied, ReferenceId) | custom Lua through the runtime's `rd` and `rds`, which are protected, so a slot-255 read the proxy refuses is nil (the script guards the same reads with pcall) |

### Writes

| Script | Builder |
| --- | --- |
| Grow lights On: Lights ON 1, OFF 0, AUTO 1 in the light phase else 0; re-sent at a change or every 20 ticks | rule on `lights`, On = `S.lmode == 1 and 1 or S.lmode == 2 and 0 or X.lightPhase`; written whenever a light's read-back differs |
| Bin Open 1 while the bin is empty, 0 while occupied, written at a change | rule on `bin`, Open = `P.binOcc and (P.binOcc ~= 0 and 0 or 1)` |
| Larre Setting (a station) and Activate 1, one command per harvester step | custom Lua (`wrf`), the harvester below |

### Controls, states and pages

| Script | Builder |
| --- | --- |
| Pages main, picker, settings | pages Main, Plant picker and Settings; buttons go there by page steps |
| Plant tile and CHANGE open the picker | the tile (a Button under the plant's icon and texts) and CHANGE: page step to Plant picker |
| Picker: 17 tiles in the script's order, the current one ringed; a tap selects and returns; BACK | 17 Buttons (selected ring on `S.plant == k`): set `plant` = k, then page Main; BACK: page Main |
| Lights AUTO / ON / OFF, saved | Option group, state `lmode` (saved) |
| SKIP TO NIGHT / SKIP TO DAY ends the phase | Button with two states; its action sets the one-tick command `skip`, handled by custom Lua |
| SETTINGS opens settings | Button, page step |
| PAUSE / RESUME (primary) | primary Button with two states; toggles state `paused` (saved) |
| SEND HOME, DUMP NOW | Buttons; one-tick commands `home`, `dump` for the harvester |
| Settings steppers: First pot, Last pot, Dump station (step 1, 0..999, first never past last); Long day, Short day, Mushrooms for the light and the dark phase (step 15 s, 0..2400); Perennial ready at and Annual ready at (pinned at 5); Bin warning after (1..60 min) | Stepper widgets on number states `first`, `last`, `dump`, `lightLong`, `lightShort`, `lightMush`, `darkLong`, `darkShort`, `darkMush`, `per`, `ann`, `binwarn` (all saved), each with step actions carrying the script's limits (`first` up to `S.last`, `last` down to `S.first`) |
| Each stepper's one-line hint | a Text under each stepper |
| BACK on settings | Button, page step to Main |

### Screen

| Script | Widget and binding |
| --- | --- |
| Header HYDRO FARM (HYDRO FARM SETTINGS on settings), clock, warn and crit counts | Header bar on each page; counts are custom exports (warn: bin warning, pots growing slowly; crit: Larre error or no power, damaged pots) |
| Light cycle hero: time left `8:42`, phase bar, `Day` / `Night`, `left of 12:30` | Readout tile (hero): value, bar, status and supporting text from custom exports |
| Light / dark `750 / 450 s`; Grow lights on: count and kW | Key–value table, custom exports |
| Plant: icon, name, Annual / Perennial | Item icon (prefab, the produce's hash, as the script names it) and Texts bound to custom exports |
| This pass, Next pass with lights | Readout rows |
| Export bin: Contents (light ok empty, idle occupied, warn once warned), Door, Occupied for (warn ink over the limit), WARN `Export bin full for N min` | Readout rows, a Key–value table row with a state, an Alert |
| Larre: Status (light and word; crit on Error, idle with `No power`), Pot `23 of 90`, Holding (icon and name) | Readout row (its value is inked by the state, so Error reads crit), Key–value table, an Item icon bound to the held item |
| Harvest: This pass, All time, Last pass took, Last harvest | Key–value table, custom exports |
| Pots: 90 cells, 30 to a row, fill = growth / ready, colour = condition (healthy, slowly, damaged, empty), unvisited dimmed, the Larre's pot outlined; the legend | Repeater grid of bars (levels, states and per-item fades custom exports: a pot not visited this pass at 35 %), a plain outline rectangle linked to the theme's text colour for the Larre's pot, and the legend as Status lights and Texts, with the same outline as the Larre's swatch |

### Custom Lua

1. The light cycle: a day is the light phase then the dark phase, lengths from the selected plant's group (long, short,
   mushrooms) read only when a day starts; Skip ends the phase; the phase, time left and lengths for the screen; the
   lights' want for the rule. Mushrooms (light 0) start in the dark.
2. The harvester: the script's state machine (start, check, per_check, ann_check, ann_dump, ann_back, ann_replant, next,
   home_done, the dump legs, Send home and Dump now between commands, Pause), one Larre command per state and the next
   state once the Larre reads Idle; blocked moves wait; a reload resumes the saved step and nudges a Larre still busy
   after 10 s; produce counted at the bin.
3. The per-pot record: growth, condition (Health below 1 damaged, Efficiency below 1 slow, else healthy; empty tray 0),
   the pass it was seen in, and which plant (by ReferenceId) stands in which pot, learnt at a pot and used to read pots
   passed in transit.
4. Saved run state (step, pot, pass, the pot record, the light day, the bin timer) and harvest statistics (all time, last
   pass), through the builder's `persist`, so under its own key prefix and not the script's `farm.run` / `farm.stats`.
5. The bin timer and its warning, the held item's name (produce by the plant table, seeds as `<plant> seeds`, else the
   prefab's name where the host offers `prefab_name`), status words and the header counts.

### Not built, or built differently

- **The configuration surface.** With ScriptedScreens' custom config surface enabled, the script draws Settings on the
  console's config surface (the disk or the screw) instead of behind SETTINGS. The builder has no page kind for that
  surface, so Settings is always a page behind SETTINGS.
- **Looks.** As for the Power wall: theme looks, cells filling left to right. A pot not visited this pass keeps its
  condition colour at 35 % opacity, as the script draws it (the Repeater's per-item fade, owner 2026-10-13). The phase
  bar takes the status colour (idle at night), where the script keeps it green. Icons are the game's own, placed by the
  theme's layout.
- **The held-item icon** shows the held item's prefab; with nothing held its name is empty, and the runtime parks an icon
  with no name off the surface, as the script does.
- **Device choice.** The script takes the first dock and bin it finds; with several unlabelled ones the builder's `one`
  roles pick none: label one or pick it on the Devices page. A Devices button (an addition) sits beside BACK on Settings.
- **Saved state.** Settings, the plant, the light mode and Pause are builder states; the run state and statistics are
  saved under the custom block's keys, so a console moved from the script starts afresh.
- **Light re-sends.** The script re-sends the lights' On every 20 ticks whatever they read; the rule writes when a light's
  read-back differs, which corrects a light changed by hand on the next tick.
- **Text width.** Under Neutral, whose face is wider than Barlow Condensed, SEND HOME and DUMP NOW end in an ellipsis: the
  three Larre buttons share the panel's width by label length, as the script's flex row does, and that width is too small
  for Neutral's labels. Under Vanilla + every label fits.
- **The Larre's pot outline** is a plain rectangle sized to Vanilla +'s 30-unit cell; under Neutral (24-unit cells) it
  reaches 6 units below the cell.
