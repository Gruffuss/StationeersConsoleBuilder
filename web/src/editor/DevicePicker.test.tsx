// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import type { Role } from '../model/logic'
import { newProject } from '../model/project'
import { initialState, reducer, type State } from '../model/store'
import { GAME_MCP_URL, GameMcp } from '../runtime/gameMcp'
import { chipEntries, GameLink } from '../runtime/gameLink'
import { fakeGame, recordedText, toolText } from '../runtime/gameMcpTesting'
import { mount, run } from '../testing'
import { DevicePicker } from './DevicePicker'
import { readFileSync } from 'node:fs'

const cleanups: (() => void)[] = []
afterEach(() => { for (const f of cleanups.splice(0)) f() })
const settle = () => new Promise(r => setTimeout(r))
const ALL = recordedText('s6-all-network-devices'), ONE = recordedText('s6-network-devices')
const IDS = [...new Set(ALL.match(/"(?:ref_id|network_id|prefab_hash)":-?\d+/g)!.map(m => m.split(':')[1].replace('-', '')))]

function mountPicker(role: Role, o: { linked?: boolean; fail?: boolean; all?: string } = {}) {
  const game = fakeGame(name => name === 'get_all_network_devices' ? toolText(o.all ?? ALL) : name === 'get_network_devices' ? toolText(ONE) : toolText(`Error: unknown tool ${name}`), {})
  const fetch: typeof globalThis.fetch = o.fail ? async () => { throw new TypeError('Failed to fetch') } : game.fetch
  const link = new GameLink(new GameMcp({ endpoint: GAME_MCP_URL, fetch, origin: 'http://localhost:4173' }))
  if (o.linked) link.linkChip(chipEntries({ ok: true, texts: [recordedText('s4-list-chips-editor-closed')], images: [] })!.find(c => c.name === 'Console B (Scripted Screens)')!)
  // The mount writes a pick as one setLogic, as the Logic panel writes any role edit.
  let state: State = reducer(initialState(newProject()), { type: 'setLogic', patch: { roles: [role] } })
  const steps = state.past.length
  const onPick = (next: Role) => { state = reducer(state, { type: 'setLogic', patch: { roles: state.project.roles.map(r => r.id === next.id ? next : r) } }); render() }
  const ui = mount(<DevicePicker role={state.project.roles[0]} link={link} onPick={onPick} />)
  function render() { ui.rerender(<DevicePicker role={state.project.roles[0]} link={link} onPick={onPick} />) }
  cleanups.push(() => ui.unmount())
  const button = (label: string) => ui.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const click = async (label: string) => { expect(button(label), label).toBeTruthy(); await run(async () => { button(label)!.click(); await settle() }) }
  const readable = () => [ui.container.textContent ?? '', ...Array.from(ui.container.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label'))].join('\n')
  return { ui, game, link, click, button, readable, text: () => ui.container.textContent ?? '', role: () => state.project.roles[0],
    steps: () => state.past.length - steps, undo: () => { state = reducer(state, { type: 'undo' }); render() } }
}
const ROLE: Role = { id: 'sensor', name: 'Sensor', prefabs: [], mode: 'one' }

it('lists every network\'s devices by name and prefab, never an id or a hash, and asks the game only on a click', async () => {
  const p = mountPicker(ROLE)
  expect(p.game.calls).toEqual([])
  await p.click('Pick a device')
  expect(p.game.tools().map(t => t.name)).toEqual(['get_all_network_devices'])
  expect(p.text()).toContain('Device C')
  expect(p.text()).toContain('StructureGasSensor')
  expect(p.text()).toContain('Console I')
  const name = p.ui.container.querySelector<HTMLElement>('li > .vb-device-name')
  expect(name).not.toBeNull()
  expect(name!.title).toBe(name!.textContent)
  const style = document.createElement('style'); style.textContent = readFileSync(`${import.meta.dirname}/game.css`, 'utf8'); document.head.append(style)
  try {
    expect(getComputedStyle(name!).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(name!).textOverflow).toBe('ellipsis')
  } finally { style.remove() }
  const seen = p.readable()
  for (const id of IDS) expect(seen).not.toMatch(new RegExp(`(?<![\\d.])${id}(?!\\d)`))
})

it('with a link, lists the linked chip\'s network only', async () => {
  const p = mountPicker(ROLE, { linked: true })
  await p.click('Pick a device')
  expect(p.game.tools()).toEqual([{ name: 'get_network_devices', arguments: { network_id: 3001 } }])
  expect(p.text()).toContain('Device C')
})

it('a pick writes the prefab and the name, nothing else, in one undo step', async () => {
  const role: Role = { ...ROLE, pin: 2, optional: true }
  const p = mountPicker(role)
  await p.click('Pick a device')
  await p.click('Pick Device C (StructureGasSensor)')
  expect(p.role()).toEqual({ ...role, prefabs: ['StructureGasSensor'], label: 'Device C' })
  expect(p.steps()).toBe(1)
  await run(() => p.undo())
  expect(p.role()).toEqual(role)
})

it('keeps the role\'s prefabs when the device is one of them, and lists only those', async () => {
  const role: Role = { ...ROLE, prefabs: ['StructureConsoleWide', 'StructureConsole'] }
  const p = mountPicker(role)
  await p.click('Pick a device')
  expect(p.text()).not.toContain('Device C')
  expect(p.text()).toContain('Console I')
  expect(p.text()).toContain('Console A')
  await p.click('Pick Console I (StructureConsoleWide)')
  expect(p.role()).toEqual({ ...role, label: 'Console I' })
})

it('says how many devices share a name', async () => {
  const p = mountPicker(ROLE)
  await p.click('Pick a device')
  expect(p.text()).toContain('Housing A (StructureCircuitHousingCompact): 10 devices share this name')
  expect(p.text()).toContain('Device B (StructureComputer): 3 devices share this name')
  expect(p.ui.container.querySelectorAll('button[aria-label="Pick Housing A (StructureCircuitHousingCompact)"]')).toHaveLength(1)
})

it('with no game connected, says so and points to "Pin to one specific device"', async () => {
  const p = mountPicker(ROLE, { fail: true })
  await p.click('Pick a device')
  expect(p.text()).toContain('No game is connected')
  expect(p.text()).toContain('Pin to one specific device')
  expect(p.role()).toEqual(ROLE)
})

it('a device the game lists without a name or prefab is left out; the rest stay, and no id or hash shows (derived answer)', async () => {
  // Derived from the recorded list: the first device's display_name set to null.
  const all = JSON.parse(ALL); all[0].devices[0].display_name = null
  const p = mountPicker(ROLE, { all: JSON.stringify(all) })
  await p.click('Pick a device')
  expect(p.text()).toContain('Device C (StructureGasSensor)')
  expect(p.text()).toContain('1 device the game listed without a name or prefab is not offered.')
  expect(p.text()).not.toContain('done')
  const seen = p.readable()
  for (const id of IDS) expect(seen).not.toMatch(new RegExp(`(?<![\\d.])${id}(?!\\d)`))
})

it('an answer that is not a device list is said in words, never shown raw', async () => {
  const p = mountPicker(ROLE, { all: JSON.stringify({ networks: [{ network_id: 3001, prefab_hash: -626563514 }] }) })
  await p.click('Pick a device')
  expect(p.text()).toContain("The game's device list could not be read.")
  expect(p.text()).not.toMatch(/3001|626563514/)
})

it('rows loaded for one network go when the link moves to another', async () => {
  const p = mountPicker(ROLE, { linked: true })
  await p.click('Pick a device')
  expect(p.button('Pick Device C (StructureGasSensor)')).toBeTruthy()
  const other = { ...chipEntries({ ok: true, texts: [recordedText('s4-list-chips-editor-closed')], images: [] })!.find(c => c.name === 'Console D (Scripted Screens)')!, networkId: 3002 }
  await run(() => p.link.linkChip(other))
  expect(p.button('Pick Device C (StructureGasSensor)')).toBeNull()
  expect(p.text()).toContain('The link changed: pick a device again.')
})

it('says at the pick when the role is pinned, since a pin overrides the name and prefab', async () => {
  for (const role of [{ ...ROLE, pin: 2 as const }, { ...ROLE, ref: 4 }]) {
    const p = mountPicker(role)
    await p.click('Pick a device')
    expect(p.text()).toContain('This role uses "Pin to one specific device", which overrides the name and prefab a pick sets')
  }
  const p = mountPicker(ROLE)
  await p.click('Pick a device')
  expect(p.text()).not.toContain('overrides the name and prefab')
})
