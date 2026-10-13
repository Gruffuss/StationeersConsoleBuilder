// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { GAME_MCP_URL, GameMcp } from '../runtime/gameMcp'
import { chipEntries, GameLink } from '../runtime/gameLink'
import { defaultTool, fakeGame, hang, recordedText, toolText, type Call } from '../runtime/gameMcpTesting'
import { mount, run } from '../testing'
import { SendToChip } from './SendToChip'

const cleanups: (() => void)[] = []
afterEach(() => { for (const f of cleanups.splice(0)) f(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear() })
const ARTIFACT = { lua: '-- builder 0.4.0\r\nlocal s = "é\u{1F600}"\n', name: 'Panel', scenes: ['main'] }
const settle = () => new Promise(r => setTimeout(r))

function mountPanel(game = fakeGame(), artifact: { lua: string; name: string; scenes: string[] } | null = ARTIFACT) {
  const client = new GameMcp({ endpoint: GAME_MCP_URL, fetch: game.fetch, origin: 'https://example.test' })
  const ui = mount(<SendToChip artifact={artifact} client={client} origin="https://example.test" />)
  cleanups.push(() => ui.unmount())
  const button = (label: string) => ui.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const click = async (label: string) => { expect(button(label), label).toBeTruthy(); await run(async () => { button(label)!.click(); await settle() }) }
  const pick = async (name: string) => {
    const radio = Array.from(ui.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(r => r.getAttribute('aria-label')?.includes(name))
    expect(radio, name).toBeTruthy()
    await run(() => radio!.click())
  }
  const text = () => ui.container.textContent ?? ''
  return { ui, game, button, click, pick, text, rerender: (a: typeof artifact) => ui.rerender(<SendToChip artifact={a} client={client} origin="https://example.test" />) }
}

it('makes no request on mount, not even without a client of its own', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const ui = mount(<SendToChip artifact={ARTIFACT} />)
  cleanups.push(() => ui.unmount())
  const p = mountPanel()
  expect(fetch).not.toHaveBeenCalled()
  expect(p.game.calls).toEqual([])
})

it('says to check the export first, with Send disabled, while there is no artifact', async () => {
  const p = mountPanel(fakeGame(), null)
  expect(p.text()).toContain('Waiting for a completed export check')
  await p.click('List chips'); await p.pick('Test chip')
  expect(p.button('Send to the chosen chip')!.disabled).toBe(true)
  p.rerender(ARTIFACT)
  expect(p.button('Send to the chosen chip')!.disabled).toBe(false)
  p.rerender(null)
  expect(p.button('Send to the chosen chip')!.disabled).toBe(true)
})

it('Send stays disabled until a chip is picked', async () => {
  const p = mountPanel()
  expect(p.button('Send to the chosen chip')!.disabled).toBe(true)
  await p.click('List chips')
  expect(p.text()).toContain('Test chip')
  expect(p.text()).toContain('Other chip')
  expect(p.button('Send to the chosen chip')!.disabled).toBe(true)
  await p.pick('Other chip')
  expect(p.button('Send to the chosen chip')!.disabled).toBe(false)
})

it('sends exactly the artifact to the chosen chip, then reads the stats, then captures that chip', async () => {
  const p = mountPanel()
  await p.click('List chips'); await p.pick('Other chip')
  await p.click('Send to the chosen chip')
  expect(p.game.tools()).toEqual([
    { name: 'list_chips', arguments: {} },
    { name: 'set_chip_code', arguments: { ref_id: 202, source: ARTIFACT.lua, mode: 'editor_then_chip' } },
    { name: 'vector_stats', arguments: {} },
    { name: 'capture_scripted_screen', arguments: { ref_id: 202 } },
  ])
  expect((p.game.tools()[1].arguments as { source: string }).source).toBe(ARTIFACT.lua)
  expect(p.text()).toContain('{"success":true,"source_version":2}')
  expect(p.text()).toContain('scene "main": no problems')
  expect(p.text()).toContain('last build that landed')
})

it('a refused push stops the rest and shows the game\'s words', async () => {
  const p = mountPanel(fakeGame((name, args, call) => name === 'set_chip_code' ? toolText('Error: chip 202 not accessible') : defaultTool(name, args, call)))
  await p.click('List chips'); await p.pick('Other chip')
  await p.click('Send to the chosen chip')
  expect(p.game.tools().map(t => t.name)).toEqual(['list_chips', 'set_chip_code'])
  expect(p.text()).toContain('Error: chip "Other chip" not accessible')
  expect(p.button('Read stats again')).toBeNull()
})

it('shows a captured image', async () => {
  const p = mountPanel()
  await p.click('List chips'); await p.pick('Test chip')
  await p.click('Send to the chosen chip')
  const img = p.ui.container.querySelector('img')
  expect(img?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
})

it('reads the stats again and captures again on their own buttons only', async () => {
  const p = mountPanel()
  await p.click('List chips'); await p.pick('Test chip')
  await p.click('Send to the chosen chip')
  await p.click('Read stats again')
  await p.click('Capture again')
  expect(p.game.tools().slice(4)).toEqual([
    { name: 'vector_stats', arguments: {} },
    { name: 'capture_scripted_screen', arguments: { ref_id: 101 } },
  ])
})

it('Stop aborts the pending request and says so', async () => {
  let pending: Call | null = null
  const p = mountPanel(fakeGame((name, args, call) => name === 'set_chip_code' ? (pending = call, hang(call)) : defaultTool(name, args, call)))
  await p.click('List chips'); await p.pick('Test chip')
  expect(p.button('Stop')!.disabled).toBe(true)
  await p.click('Send to the chosen chip')
  expect(pending).not.toBeNull()
  expect(p.button('Send to the chosen chip')!.disabled).toBe(true)
  expect(p.button('List chips')!.disabled).toBe(true)
  await p.click('Stop')
  expect(pending!.signal!.aborted).toBe(true)
  expect(p.text()).toContain('Stopped')
  expect(p.game.tools().map(t => t.name)).toEqual(['list_chips', 'set_chip_code'])
  expect(p.button('Send to the chosen chip')!.disabled).toBe(false)
})

it('a failed list shows why, with no chips to pick', async () => {
  const failing: typeof fetch = async () => { throw new TypeError('Failed to fetch') }
  const client = new GameMcp({ endpoint: GAME_MCP_URL, fetch: failing, origin: 'https://example.test' })
  const ui = mount(<SendToChip artifact={ARTIFACT} client={client} origin="https://example.test" />)
  cleanups.push(() => ui.unmount())
  await run(async () => { ui.container.querySelector<HTMLButtonElement>('button[aria-label="List chips"]')!.click(); await settle() })
  expect(ui.container.textContent).toContain('the game is not running or no world is loaded')
  expect(ui.container.querySelector('input[type="radio"]')).toBeNull()
})

it('says the program is replaced, and names the settings, the restart they need and what decides the chips listed', () => {
  const p = mountPanel()
  expect(p.text()).toContain('replaces the chip\'s program')
  expect(p.text()).toContain('Enabled = true')
  expect(p.text()).toContain('AllowedBrowserOrigins')
  expect(p.text()).toContain('https://example.test')
  expect(p.text()).toContain('then restart the game')
  expect(p.text()).toContain('Request timed out waiting for game thread')
  expect(p.text()).toContain('AllowNetworkChipAccess')
  // Recorded: with no IC editor open the game listed 23 chips, so the editor is not a requirement.
  expect(p.text()).not.toContain('needs the in-game IC editor open')
})

it('says a capture is a file on this computer', async () => {
  const p = mountPanel(fakeGame((name, args, call) => name === 'capture_scripted_screen' ? toolText(recordedText('s4-capture-ref')) : defaultTool(name, args, call)))
  await p.click('List chips'); await p.pick('Test chip')
  await p.click('Send to the chosen chip')
  expect(p.text()).toContain('<capture path A>')
  expect(p.text()).toContain('saves each capture as a PNG file on this computer')
  expect(p.ui.container.querySelector('img')).toBeNull()
})

it('with the recorded chip list, offers only Lua chips that are not libraries, by name, never by id', async () => {
  const list = recordedText('s4-list-chips-editor-closed'), chips = JSON.parse(list) as { ref_id: number; is_lua: boolean; is_library: boolean }[]
  const p = mountPanel(fakeGame((name, args, call) => name === 'list_chips' ? toolText(list)
    : name === 'capture_scripted_screen' ? toolText(recordedText('s4-capture-ref')) : defaultTool(name, args, call)))
  await p.click('List chips')
  const offered = chips.filter(c => c.is_lua && !c.is_library)
  expect(offered).toHaveLength(11)
  expect(p.ui.container.querySelectorAll('input[type="radio"]')).toHaveLength(11)
  expect(p.text()).toContain('12 listed chips are not offered')
  expect(p.text()).toContain('Labeller')
  await p.pick('Console B (Scripted Screens)')
  await p.click('Send to the chosen chip')
  expect(p.game.tools()[1].arguments).toMatchObject({ ref_id: chips.find(c => JSON.stringify(c).includes('Console B'))!.ref_id })
  const seen = readable(p.ui.container)
  const ids = new Set(list.match(/"(?:ref_id|housing_ref_id|network_id)":\d+/g)!.map(m => m.split(':')[1]))
  expect(ids.size).toBeGreaterThan(40)
  for (const id of ids) expect(seen).not.toMatch(new RegExp(`(?<![\\d.])${id}(?!\\d)`))
})

it('says how to tell apart chips whose names repeat even when their other fields differ', async () => {
  const twins = [{ ref_id: 101, housing_name: 'Console', source_length: 1 }, { ref_id: 202, housing_name: 'Console', source_length: 2 }]
  const p = mountPanel(fakeGame((name, args, call) => name === 'list_chips' ? toolText(JSON.stringify(twins)) : defaultTool(name, args, call)))
  await p.click('List chips')
  expect(p.text()).toContain('Labeller')
})

it('keeps no chip ref or name in browser storage', async () => {
  const set = vi.spyOn(Storage.prototype, 'setItem')
  const p = mountPanel()
  await p.click('List chips'); await p.pick('Other chip')
  await p.click('Send to the chosen chip')
  expect(set).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0)
  expect(sessionStorage.length).toBe(0)
})

it('aborts a pending request when unmounted', async () => {
  let pending: Call | null = null
  const p = mountPanel(fakeGame((_n, _a, call) => (pending = call, hang(call))))
  await p.click('List chips')
  expect(pending).not.toBeNull()
  p.ui.unmount(); cleanups.length = 0
  expect(pending!.signal!.aborted).toBe(true)
})

/** Every text a player can read or hear: the visible text and each aria-label, alt and title. */
const readable = (root: HTMLElement) => [root.textContent ?? '', ...Array.from(root.querySelectorAll('[aria-label],[alt],[title]'))
  .flatMap(e => ['aria-label', 'alt', 'title'].map(a => e.getAttribute(a) ?? ''))].join('\n')

it('shows no reference id anywhere a player can read, while the requests still carry it', async () => {
  const capture = toolText(JSON.stringify({ ref_id: 202, housing_name: 'Vertical (Scripted Screens)', network_id: 5151, surfaces: [{ surface: 'main', file: 'main.png' }] }))
  const p = mountPanel(fakeGame((name, args, call) => name === 'capture_scripted_screen' ? capture
    : name === 'vector_stats' ? toolText('ScriptedScreensVector 0.11.118.0\nscene "main" (under "StructureConsole")\n  chip 202: no problems') : defaultTool(name, args, call)))
  await p.click('List chips'); await p.pick('Other chip')
  await p.click('Send to the chosen chip')
  expect(p.game.tools()[1].arguments).toMatchObject({ ref_id: 202 })
  const seen = readable(p.ui.container)
  expect(seen).toContain('Vertical (Scripted Screens)')
  expect(seen).toContain('main.png')
  expect(seen).toContain('chip "Other chip": no problems')
  expect(seen).toContain('Sent to Other chip')
  for (const id of ['101', '202', '5151']) expect(seen).not.toContain(id)
  expect(seen).not.toContain('ref_id')
  expect(seen).not.toContain('network_id')
})

it('a refusal naming the chip by its id names it by its name instead', async () => {
  const p = mountPanel(fakeGame((name, args, call) => name === 'set_chip_code' ? toolText('Error: chip 101 not accessible') : defaultTool(name, args, call)))
  await p.click('List chips'); await p.pick('Test chip')
  await p.click('Send to the chosen chip')
  const seen = readable(p.ui.container)
  expect(seen).toContain('Error: chip "Test chip" not accessible')
  expect(seen).not.toMatch(/(101|202)/)
})

it('says how to tell apart chips that show the same name', async () => {
  const twins = [{ ref_id: 101, name: 'Console' }, { ref_id: 202, name: 'Console' }]
  const p = mountPanel(fakeGame((name, args, call) => name === 'list_chips' ? toolText(JSON.stringify(twins)) : defaultTool(name, args, call)))
  await p.click('List chips')
  expect(p.ui.container.querySelectorAll('input[type="radio"]').length).toBe(2)
  expect(p.text()).toContain('Labeller')
  expect(readable(p.ui.container)).not.toMatch(/(101|202)/)
})

it('a list the panel cannot read is shown without its ids', async () => {
  const p = mountPanel(fakeGame((name, args, call) => name === 'list_chips' ? toolText('{"chips":[{"ref_id":101,"name":"Test chip"}]}') : defaultTool(name, args, call)))
  await p.click('List chips')
  const seen = readable(p.ui.container)
  expect(seen).toContain('Test chip')
  expect(seen).not.toMatch(/101/)
})

function mountLinked(tool: Parameters<typeof fakeGame>[0] = defaultTool) {
  const game = fakeGame(tool)
  const link = new GameLink(new GameMcp({ endpoint: GAME_MCP_URL, fetch: game.fetch, origin: 'https://example.test' }))
  link.linkChip(chipEntries({ ok: true, texts: [recordedText('s4-list-chips-editor-closed')], images: [] })!.find(c => c.name === 'Console B (Scripted Screens)')!)
  const ui = mount(<SendToChip artifact={ARTIFACT} link={link} origin="https://example.test" />)
  cleanups.push(() => ui.unmount())
  const button = (label: string) => ui.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const click = async (label: string) => { expect(button(label), label).toBeTruthy(); await run(async () => { button(label)!.click(); await settle() }) }
  return { ui, game, link, button, click, text: () => ui.container.textContent ?? '' }
}

it('with a link, sends to the linked chip without asking which, in mode editor_then_chip', async () => {
  const p = mountLinked()
  expect(p.text()).toContain('Sends to Console B (Scripted Screens), the linked chip.')
  expect(p.button('List chips')).toBeNull()
  await p.click('Send to the chosen chip')
  expect(p.game.tools()[0]).toEqual({ name: 'set_chip_code', arguments: { ref_id: 1002, source: ARTIFACT.lua, mode: 'editor_then_chip' } })
  expect(p.game.tools().map(t => t.name)).toEqual(['set_chip_code', 'vector_stats', 'capture_scripted_screen'])
  expect(p.game.tools()[2].arguments).toEqual({ ref_id: 1002 })
  expect(p.text()).toContain('Sent to Console B (Scripted Screens).')
  expect(p.text()).not.toContain('1002')
})

it('says in words whether the IC editor took the new code', async () => {
  const recordedPush = recordedText('s5-set-chip-code-editor-then-chip')
  const notSynced = mountLinked((name, args, call) => name === 'set_chip_code' ? toolText(recordedPush) : defaultTool(name, args, call))
  await notSynced.click('Send to the chosen chip')
  expect(notSynced.text()).toContain('The IC editor was not updated: chip is not currently selected in the in-game IC editor dropdown.')
  // Derived, not recorded (it needs a player at the editor): the recorded answer with editor_synced true.
  const synced = JSON.stringify({ ...JSON.parse(recordedPush), editor_synced: true, editor_sync_path: 'editor', editor_sync_reason: '' })
  const p = mountLinked((name, args, call) => name === 'set_chip_code' ? toolText(synced) : defaultTool(name, args, call))
  await p.click('Send to the chosen chip')
  expect(p.text()).toContain('The IC editor showing this chip shows the new code too.')
})

it('follows the link: unlinked, it goes back to listing chips', async () => {
  const p = mountLinked()
  await run(() => p.link.unlink())
  expect(p.button('List chips')).toBeTruthy()
  expect(p.button('Send to the chosen chip')!.disabled).toBe(true)
})

it('says "Sent to" only once the push landed: never while it runs, never when it failed', async () => {
  let pending: Call | null = null
  const p = mountPanel(fakeGame((name, args, call) => name === 'set_chip_code' ? (pending = call, hang(call)) : defaultTool(name, args, call)))
  await p.click('List chips'); await p.pick('Other chip')
  await p.click('Send to the chosen chip')
  expect(pending).not.toBeNull()
  expect(p.text()).not.toContain('Sent to')
  expect(p.text()).toContain('Sending to Other chip')
  await p.click('Stop')
  expect(p.text()).not.toContain('Sent to')
  expect(p.text()).toContain('Not sent to Other chip')
  for (const refusal of [toolText('Error: chip 202 not accessible'), toolText('{"success":false,"error":"refused"}'), new Response('', { status: 403, statusText: 'Forbidden' })]) {
    const q = mountPanel(fakeGame((name, args, call) => name === 'set_chip_code' ? refusal : defaultTool(name, args, call)))
    await q.click('List chips'); await q.pick('Other chip')
    await q.click('Send to the chosen chip')
    expect(q.text()).not.toContain('Sent to')
    expect(q.text()).toContain('Not sent to Other chip')
  }
})

it('repeating stats or a capture keeps the steps in their order', async () => {
  const p = mountPanel()
  await p.click('List chips'); await p.pick('Test chip')
  await p.click('Send to the chosen chip')
  await p.click('Read stats again')
  const labels = Array.from(p.ui.container.querySelectorAll('.vb-send-steps > div > div:first-child')).map(e => e.textContent)
  expect(labels).toEqual(['Push (set_chip_code): done', 'Stats (vector_stats): done', 'Capture (capture_scripted_screen): done'])
})

/** The text a player sees without opening a Details disclosure. */
const shown = (root: HTMLElement) => { const c = root.cloneNode(true) as HTMLElement; c.querySelectorAll('details').forEach(d => d.remove()); return c.textContent ?? '' }

it('shows only the pushed script\'s own scenes from the stats, which cover every scene in the world', async () => {
  const all = recordedText('s4-vector-stats-all')
  const p = mountPanel(fakeGame((name, args, call) => name === 'vector_stats' ? toolText(all) : defaultTool(name, args, call)), { ...ARTIFACT, scenes: ['p1'] })
  await p.click('List chips'); await p.pick('Test chip')
  await p.click('Send to the chosen chip')
  expect(p.text()).toContain('scene "p1" (under "StructureConsole")')
  expect(p.text()).toContain('ScriptedScreensVector 0.11.118.0')
  for (const other of ['scene "lc"', 'scene "lines"', 'scene "html:run"']) expect(p.text(), other).not.toContain(other)
  const q = mountPanel(fakeGame((name, args, call) => name === 'vector_stats' ? toolText(all) : defaultTool(name, args, call)), { ...ARTIFACT, scenes: ['vb_devices'] })
  await q.click('List chips'); await q.pick('Test chip')
  await q.click('Send to the chosen chip')
  expect(q.text()).toContain("No scene of this script is in the game's report yet")
  expect(q.text()).not.toContain('scene "lc"')
})

it('says the push and the capture in words, with the raw answer behind Details and no id in either', async () => {
  const push = recordedText('s5-set-chip-code-editor-then-chip'), capture = recordedText('s4-capture-ref')
  const p = mountPanel(fakeGame((name, args, call) => name === 'set_chip_code' ? toolText(push) : name === 'capture_scripted_screen' ? toolText(capture) : defaultTool(name, args, call)))
  await p.click('List chips'); await p.pick('Test chip')
  await p.click('Send to the chosen chip')
  const words = shown(p.ui.container)
  expect(words).not.toContain('{"success"')
  expect(words).toContain('The chip took the script.')
  expect(words).toContain('The IC editor was not updated: chip is not currently selected in the in-game IC editor dropdown.')
  expect(words).toContain('The game saved a capture of main (460 × 460 px) to:')
  expect(Array.from(p.ui.container.querySelectorAll('code')).map(c => c.textContent)).toContain('<capture path A>')
  const details = Array.from(p.ui.container.querySelectorAll('details')).filter(d => d.querySelector('summary')?.textContent === 'Details')
  expect(details.length).toBe(2)
  expect(details.map(d => d.textContent).join('\n')).toContain('"editor_synced":false')
  expect(p.text()).not.toMatch(/1001|2001|3001/)
})
