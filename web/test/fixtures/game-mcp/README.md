# Recorded answers of the game's MCP endpoint

Recorded on 2026-10-12 from StationeersLua 1.1.0.0 with ScriptedScreens Vector 0.11.118 at `http://127.0.0.1:3030`; what they show is written up in `docs/m6.md`, "Game endpoint". One exchange per file: `request` (method, path, headers, body as sent), `status` and `reason`, `headers` (the answer's `Access-Control-*`, `Vary`, `Content-Type` and `Mcp-Session-Id` headers, in the order received; the others are left out), and `body` (the answer's text exactly as received, apart from the replacements below).

Replacements (structure, key order, wording, status codes and content types are kept):
- Chip reference ids are 1001–1024, housing reference ids 2001–2023 and the network id 3001; the same id is the same placeholder in every file.
- Console names become `Console A`–`Console I` (keeping the ` (Scripted Screens)` ending they were recorded with), other housing names `Housing A`–`Housing B`, the one device named after a player `Device A - Player A`. Names that were equal are still equal. The recorded list was in ascending order of housing name; the placeholders do not keep that order.
- The two capture file paths become `<capture path A>` and `<capture path B>`. Each was an absolute Windows path to a PNG in the user's temporary folder, named `ss-screen-<housing>-<surface>-<date>-<time>.png`.
- The `initialize` answer's `instructions` (the mod's own documentation, 6,229 characters) becomes a placeholder string.
- `tools/list` keeps the four tools the builder uses, in the recorded order and unchanged; the answer listed 30.
- The `source` sent by `set_chip_code` to the test chip was a VectorBuilder export of 41,798 bytes (UTF-8); it becomes a one-line Lua comment.
- No answer carried an image, so there is no picture here.

| File | What it records |
|---|---|
| `s1-initialize.json` | `initialize` from a native client (no `Origin`): 200, JSON, no session id |
| `s1-initialized.json` | `notifications/initialized`: 202 with an empty body and no content type |
| `s1-tools-list.json` | `tools/list`: the four tools' descriptions and input schemas |
| `s2-origin-refused.json` | `initialize` with `Origin: http://localhost:4173` while that origin was not allowlisted: 403 and its JSON error |
| `s2-host-localhost.json` | `initialize` with `Host: localhost:3030`, no `Origin`: accepted |
| `s2-host-127.json` | `initialize` with `Host: 127.0.0.1:3030`, no `Origin`: accepted |
| `s2-host-other.json` | `initialize` with `Host: example.test:3030`, no `Origin`: accepted |
| `s3-preflight-before-restart.json` | `OPTIONS` preflight after the origin was added to the allowlist with the game running: still 403 |
| `s3-post-with-origin-before-restart.json` | `initialize` with the origin, same moment: still 403 |
| `s3-post-startup-timeout.json` | `initialize` with the origin while the restarted game was starting: 200 carrying the JSON-RPC error "Request timed out waiting for game thread" |
| `s3-preflight.json` | `OPTIONS` preflight after a game restart with the origin allowlisted: 204 and its CORS headers |
| `s3-post-with-origin.json` | `initialize` with the origin after the restart: 200 with `Access-Control-Allow-Origin` and `Vary: Origin` |
| `s4-list-chips-editor-closed.json` | `list_chips` with no IC editor open: answered with 23 chips on one network |
| `s4-set-chip-code-test-chip.json` | `set_chip_code` on the test chip with an export: the success answer |
| `s4-set-chip-code-inaccessible.json` | `set_chip_code` on a ref the session cannot reach: a text block beginning `Error:` |
| `s4-vector-stats-all.json` | `vector_stats` with no arguments: the plain-text report for every scene |
| `s4-vector-stats-scene.json` | `vector_stats` with `scene`: the report for that scene |
| `s4-capture-ref.json` | `capture_scripted_screen` with `ref_id`: one capture, answered with a file path |
| `s4-capture-all.json` | `capture_scripted_screen` with `ref_id` and `all`: a `captures` list of file paths |

## The editor, chip selection and device answers (`s5-*`, `s6-*`)

Recorded on 2026-10-12 for the plan's Task 9, from the same game, mods and save, in two game sessions: the first with `[MCP Server] EnableExtensionApi = true` (as for `s1`–`s4`), the second after the game was closed and started again with `EnableExtensionApi = false` (the setting was put back afterwards). `AllowNetworkChipAccess = true` and `AllowNetworkChipAccessOnlyForWirelessBoards = false` in both. No player was at an IC editor, so every answer here is the case with no chip selected in the editor. Same format and the same replacements as above, and:
- The same real id has the same placeholder as in the `s1`–`s4` files: chips 1001–1023, housings 2001–2023 and the network 3001 are those of `s4-list-chips-editor-closed`. 1024 is the ref `s4-set-chip-code-inaccessible` pushed to, which is a console, not a chip (`Console I` in `s6-*`). The other devices are 4001–4018.
- Device display names: a name the `s1`–`s4` files replaced keeps its placeholder (`Housing A`, `Housing B`); a console's display name `X` becomes the placeholder of the board name `X (Scripted Screens)` without that ending (`Console A`–`Console I`); the other names become `Device B`–`Device F`. Names that were equal are still equal. The network's name in `get_editor_state` was the display name of the network's wireless access point, so it is that device's placeholder.
- The `source` sent by `set_chip_code` and `set_editor_code` was a 1,269-byte Lua script (the test chip's own code with one comment line added); it becomes a one-line Lua comment.
- `s5-tools-list` keeps the five tools the game link uses, in the recorded order and unchanged; the answer listed 30 (26 with `EnableExtensionApi = false`).

| File | What it records |
|---|---|
| `s5-tools-list.json` | `tools/list`: the descriptions and input schemas of `get_editor_state`, `get_editor_code`, `set_editor_code`, `get_network_devices`, `get_all_network_devices` |
| `s5-editor-state-no-chip-selected.json` | `get_editor_state` with no chip selected and the scope from a wireless development board: `editor_open` true, `wireless_remote_access_only` true, the `selected_*` fields null |
| `s5-editor-code-no-chip-selected.json` | `get_editor_code` on the test chip: a text block beginning `Error:` |
| `s5-set-editor-code-not-selected.json` | `set_editor_code` on the test chip: a text block beginning `Error:` |
| `s5-set-chip-code-editor-then-chip.json` | `set_chip_code` with `mode: editor_then_chip`: exported, `editor_synced` false |
| `s5-set-chip-code-chip.json` | `set_chip_code` with `mode: chip`: exported, `editor_sync_path` `not_attempted` |
| `s5-set-chip-code-default.json` | `set_chip_code` with no `mode`, extension API on: answered as `editor_then_chip` |
| `s5-set-chip-code-editor-only.json` | `set_chip_code` with `mode: editor_only`: `success` false, `exported` false |
| `s5-editor-state-extension-api-off.json` | `get_editor_state` with `EnableExtensionApi = false`: `mcp_debug_tools_available` false and its reason |
| `s5-set-chip-code-editor-then-chip-extension-api-off.json` | `set_chip_code` with `mode: editor_then_chip`, extension API off: exported, answered as `editor_then_chip` |
| `s5-set-chip-code-default-extension-api-off.json` | `set_chip_code` with no `mode`, extension API off: answered as `chip` |
| `s6-all-network-devices.json` | `get_all_network_devices`: one network of 30 devices, each `ref_id`, `prefab_hash`, `display_name`, `prefab_name` |
| `s6-network-devices.json` | `get_network_devices` with that `network_id`: the same 30 devices as a bare array |
| `s6-all-network-devices-after-reload.json` | `get_all_network_devices` after the game was closed and the save loaded again: the same answer |
| `s6-list-chips-after-reload.json` | `list_chips` after that reload: the same chips, refs and housings as `s4-list-chips-editor-closed` |
