// The client against the answers recorded from the game (web/test/fixtures/game-mcp): each request it sends must be the
// one recorded, and each recorded answer must read as the panel needs it.
import { expect, it } from 'vitest'
import { GAME_MCP_URL, GameMcp, readChips, readDevices, readEditorState, readNetworks, statsFor } from './gameMcp'
import { recorded, recordedResponse, recordedText, type Message } from './gameMcpTesting'

const signal = () => new AbortController().signal

/** A fetch that answers each request with its recording: `initialize` and the notification from `start`, each tool from
 *  `tools`. It checks the request against the recorded one (method, tool, arguments) and keeps the headers sent. */
function replay(tools: Record<string, string>, start: { initialize: string; initialized?: string } = { initialize: 's1-initialize' }) {
  const sent: { body: Message; headers: Record<string, string> }[] = []
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const body: Message = JSON.parse(String(init!.body)), headers: Record<string, string> = {}
    new Headers(init!.headers).forEach((v, k) => { headers[k] = v })
    sent.push({ body, headers })
    const name = body.method === 'initialize' ? start.initialize : body.method === 'notifications/initialized' ? start.initialized ?? 's1-initialized' : tools[body.params!.name!]
    expect(name, JSON.stringify(body)).toBeTruthy()
    const r = recorded(name)
    expect(body.method).toBe(r.request.body!.method)
    if (body.method === 'tools/call') expect(body.params).toEqual({ name: r.request.body!.params!.name, arguments: r.request.body!.params!.arguments })
    return recordedResponse(r)
  }
  return { client: new GameMcp({ endpoint: GAME_MCP_URL, fetch, origin: 'http://localhost:4173' }), sent }
}

it('sends only headers the recorded preflight allows, Accept being one a browser always may send', async () => {
  const allowed = recorded('s3-preflight').headers.find(([k]) => k === 'Access-Control-Allow-Headers')![1].toLowerCase().split(/\s*,\s*/)
  expect(allowed).toEqual(['content-type'])
  const { client, sent } = replay({ list_chips: 's4-list-chips-editor-closed', vector_stats: 's4-vector-stats-all' })
  await client.listChips(signal())
  await client.vectorStats(signal())
  expect(sent.map(s => s.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call'])
  for (const s of sent) for (const h of Object.keys(s.headers)) expect([...allowed, 'accept'], h).toContain(h)
})

it('reads the recorded chip list: every chip with its ref and every other field', async () => {
  const { client } = replay({ list_chips: 's4-list-chips-editor-closed' })
  const answer = await client.listChips(signal())
  expect(answer.ok).toBe(true)
  const chips = readChips(answer)!
  expect(chips).toHaveLength(23)
  expect(new Set(chips.map(c => c.ref)).size).toBe(23)
  for (const c of chips) {
    expect(c.ref).toBeGreaterThanOrEqual(1001)
    expect(c.fields.map(([k]) => k)).toEqual(expect.arrayContaining(['ref_id', 'is_lua', 'is_library', 'housing_name', 'housing_type', 'is_on']))
  }
})

it('a recorded push is a success, and a push to a chip out of reach is a failure in the game\'s words', async () => {
  const ok = replay({ set_chip_code: 's4-set-chip-code-test-chip' })
  const okSource = (recorded('s4-set-chip-code-test-chip').request.body!.params!.arguments as { source: string }).source
  const pushed = await ok.client.setChipCode(1001, okSource, signal())
  expect(pushed.ok).toBe(true)
  expect(JSON.parse((pushed as { texts: string[] }).texts[0])).toMatchObject({ success: true })
  const refused = await replay({ set_chip_code: 's4-set-chip-code-inaccessible' }).client.setChipCode(1024, 'print(1)', signal())
  const why = 'Error: chip 1024 is not accessible from the current editor session'
  expect(refused).toEqual({ ok: false, why, texts: [why] })
})

it('reads the recorded stats, all scenes and one scene, as text', async () => {
  const { client } = replay({ vector_stats: 's4-vector-stats-all' })
  const all = await client.vectorStats(signal())
  expect(all.ok && all.texts[0].startsWith('ScriptedScreensVector 0.11.118.0')).toBe(true)
  const one = await replay({ vector_stats: 's4-vector-stats-scene' }).client.vectorStats(signal(), 'p1')
  expect(one.ok && one.texts[0].includes('scene "p1"')).toBe(true)
})

it('a recorded capture is a JSON text naming a file, with no image', async () => {
  const shot = await replay({ capture_scripted_screen: 's4-capture-ref' }).client.capture(1001, signal())
  expect(shot.ok).toBe(true)
  if (!shot.ok) return
  expect(shot.images).toEqual([])
  expect(JSON.parse(shot.texts[0])).toMatchObject({ success: true, housing_name: 'Console A (Scripted Screens)', path: '<capture path A>' })
})

it('a refused origin is HTTP 403 with the game\'s JSON error text', async () => {
  const r = recorded('s2-origin-refused')
  const answer = await replay({}, { initialize: 's2-origin-refused' }).client.listChips(signal())
  expect(answer).toEqual({ ok: false, why: 'HTTP 403 Forbidden', status: 403, texts: [r.body] })
})

it('the game\'s start-up timeout is a JSON-RPC failure with its message', async () => {
  const answer = await replay({}, { initialize: 's3-post-startup-timeout' }).client.listChips(signal())
  expect(answer).toEqual({ ok: false, why: 'JSON-RPC error -32603: Request timed out waiting for game thread' })
})

it('reads the recorded editor state: no chip selected, the scope\'s network kept for the link', async () => {
  const { client } = replay({ get_editor_state: 's5-editor-state-no-chip-selected' })
  const answer = await client.editorState(signal())
  expect(answer.ok).toBe(true)
  expect(readEditorState(answer)).toEqual({ selectedChip: null, networkId: 3001 })
  expect(readEditorState({ ok: true, texts: ['not json'], images: [] })).toBeNull()
})

it('pushes with mode editor_then_chip as recorded, and editor_only (no export) is a failure', async () => {
  const r = recorded('s5-set-chip-code-editor-then-chip'), source = (r.request.body!.params!.arguments as { source: string }).source
  const pushed = await replay({ set_chip_code: 's5-set-chip-code-editor-then-chip' }).client.setChipCode(1001, source, signal(), 'editor_then_chip')
  expect(pushed.ok).toBe(true)
  expect(JSON.parse((pushed as { texts: string[] }).texts[0])).toMatchObject({ mode: 'editor_then_chip', editor_synced: false })
  const only = await replay({ set_chip_code: 's5-set-chip-code-editor-only' }).client.setChipCode(1001, source, signal(), 'editor_only')
  expect(only.ok).toBe(false)
})

it('reads the recorded devices: every network\'s, and one network\'s, the same entries in the same order', async () => {
  const all = await replay({ get_all_network_devices: 's6-all-network-devices' }).client.allNetworkDevices(signal())
  const networks = readNetworks(all)!
  expect(networks).toHaveLength(1)
  expect(networks[0].networkId).toBe(3001)
  expect(networks[0].devices).toHaveLength(30)
  expect(networks[0].devices[0]).toEqual({ ref: 4001, name: 'Device B', prefab: 'StructureComputer' })
  const one = await replay({ get_network_devices: 's6-network-devices' }).client.networkDevices(3001, signal())
  expect(readDevices(one)).toEqual(networks[0].devices)
  expect(readDevices({ ok: true, texts: ['[{"display_name":"no ref"}]'], images: [] })).toBeNull()
  expect(readNetworks({ ok: false, why: 'x' })).toBeNull()
})

it('keeps only the asked scenes of a recorded all-scenes stats report, with its version line', () => {
  const text = (recordedText('s4-vector-stats-all'))
  const lines = statsFor(text, ['lines'])
  expect(lines.version).toBe('ScriptedScreensVector 0.11.118.0')
  expect(lines.scenes.map(s => s.scene)).toEqual(['lines'])
  expect(lines.scenes[0].text.startsWith('scene "lines" (under "StructureConsoleMonitorLarge")')).toBe(true)
  expect(lines.scenes[0].text).not.toMatch(/scene "(lc|html:run)"/)
  expect(statsFor(text, ['not-in-the-world']).scenes).toEqual([])
  const one = statsFor(recordedText('s4-vector-stats-scene'), ['p1'])
  expect(one.scenes.map(s => s.scene)).toEqual(['p1'])
  expect(one.scenes[0].text).toContain('no problems')
})
