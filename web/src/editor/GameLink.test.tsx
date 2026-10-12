// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { newProject } from '../model/project'
import { initialState, reducer, type Action, type State } from '../model/store'
import { GAME_MCP_URL, GameMcp } from '../runtime/gameMcp'
import { GameLink as Link } from '../runtime/gameLink'
import { fakeGame, recordedText, toolText } from '../runtime/gameMcpTesting'
import { mount, run } from '../testing'
import { GameLink } from './GameLink'

const cleanups: (() => void)[] = []
afterEach(() => { for (const f of cleanups.splice(0)) f(); vi.restoreAllMocks() })
const settle = () => new Promise(r => setTimeout(r))
const LIST = recordedText('s4-list-chips-editor-closed')
const EDITOR = recordedText('s5-editor-state-no-chip-selected')
/** Every id in the recorded list: chip refs, housing refs and the network id. */
const IDS = [...new Set(LIST.match(/"(?:ref_id|housing_ref_id|network_id)":\d+/g)!.map(m => m.split(':')[1]))]

function mountLink(answers: Record<string, string> = { list_chips: LIST, get_editor_state: EDITOR }, fetch?: typeof globalThis.fetch) {
  const game = fakeGame(name => answers[name] !== undefined ? toolText(answers[name]) : toolText(`Error: unknown tool ${name}`), {})
  const link = new Link(new GameMcp({ endpoint: GAME_MCP_URL, fetch: fetch ?? game.fetch, origin: 'http://localhost:4173' }))
  let state: State = initialState(newProject())
  const dispatched: Action[] = []
  const dispatch = (a: Action) => { dispatched.push(a); state = reducer(state, a); render() }
  const page = () => state.project.pages.find(p => p.id === state.activePageId)!
  const ui = mount(<GameLink link={link} page={page()} dispatch={dispatch} />)
  function render() { ui.rerender(<GameLink link={link} page={page()} dispatch={dispatch} />) }
  cleanups.push(() => ui.unmount())
  const button = (label: string) => ui.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const click = async (label: string) => { expect(button(label), label).toBeTruthy(); await run(async () => { button(label)!.click(); await settle() }) }
  const readable = () => [ui.container.textContent ?? '', ...Array.from(ui.container.querySelectorAll('[aria-label],[alt],[title]'))
    .map(e => ['aria-label', 'alt', 'title'].map(a => e.getAttribute(a) ?? '').join(' '))].join('\n')
  return { ui, game, link, button, click, readable, dispatched, page, undo: () => dispatch({ type: 'undo' }), text: () => ui.container.textContent ?? '' }
}

it('lists chips by name with their state and screen in words, never an id, and makes no request until asked', async () => {
  const p = mountLink()
  expect(p.game.calls).toEqual([])
  expect(p.text()).toContain('Not linked')
  await p.click('List chips')
  expect(p.text()).toContain('Console B (Scripted Screens)')
  expect(p.text()).toContain('off')
  expect(p.text()).toContain('no error')
  expect(p.text()).toContain('screen 1036 × 460 px')
  expect(p.text()).toContain('Labeller')
  expect(p.text()).toContain('not a Lua chip')
  const seen = p.readable()
  for (const id of IDS) expect(seen).not.toMatch(new RegExp(`(?<![\\d.])${id}(?!\\d)`))
  // Only Lua chips that are not libraries can be linked.
  expect(p.ui.container.querySelectorAll('button[aria-label^="Link "]:not([disabled])')).toHaveLength(11)
})

it('links a chip, offers its console\'s shape, and taking it is one undo step', async () => {
  const p = mountLink()
  await p.click('List chips')
  await p.click('Link Console B (Scripted Screens)')
  expect(p.text()).toContain('Linked to Console B (Scripted Screens).')
  expect(p.link.state.linked?.ref).toBe(1002)
  const before = p.page()
  expect(before.shape).toBe('square')
  await p.click('Use this console\'s shape: 2×1')
  expect(p.dispatched.filter(a => a.type === 'setPageShape')).toEqual([{ type: 'setPageShape', pageId: before.id, shape: '2x1' }])
  expect(p.page().shape).toBe('2x1')
  expect(p.button('Use this console\'s shape: 2×1')).toBeNull()
  await run(() => p.undo())
  expect(p.page().shape).toBe('square')
  expect(p.page().size).toEqual(before.size)
})

it('leaving the offer changes nothing; it comes back only when the link changes', async () => {
  const p = mountLink()
  await p.click('List chips')
  await p.click('Link Console B (Scripted Screens)')
  expect(p.dispatched).toEqual([])
  await p.click('Not now')
  expect(p.button('Use this console\'s shape: 2×1')).toBeNull()
  expect(p.dispatched).toEqual([])
  await p.click('Link Console D (Scripted Screens)')
  expect(p.button('Use this console\'s shape: Vertical 3×2 (MoreConsoles)')).toBeTruthy()
})

it('several shapes of one size are a choice with none taken; no match is a custom size', async () => {
  const p = mountLink()
  await p.click('List chips')
  await p.click('Link Console A (Scripted Screens)')
  for (const label of ['Square (1×1)', '2×2 (LargeConsoleMod)', '3×3 (LargeConsoleMod)']) expect(p.button(`Use this console's shape: ${label}`), label).toBeTruthy()
  expect(p.dispatched).toEqual([])
  await p.click('Use this console\'s shape: 2×2 (LargeConsoleMod)')
  expect(p.page().shape).toBe('2x2-lcm')
  await p.click('Link Device A - Player A')
  await p.click('Use this console\'s size: 2226 × 932 px (custom)')
  expect(p.page()).toMatchObject({ shape: 'custom', size: { w: 2226, h: 932 } })
  expect(p.dispatched.filter(a => a.type === 'setPageShape')).toHaveLength(2)
})

it('a chip with no screen offers no shape', async () => {
  const list = JSON.stringify(JSON.parse(LIST).map((c: Record<string, unknown>) => c.ref_id === 1002 ? (({ screen_size: _, ...x }) => x)(c) : c))
  const p = mountLink({ list_chips: list })
  await p.click('List chips')
  await p.click('Link Console B (Scripted Screens)')
  expect(p.text()).not.toContain('Use this console')
})

it('the open editor\'s chip: says no chip is selected in an IC editor, never whether the editor is open', async () => {
  const p = mountLink()
  await p.click('Use the chip selected in the IC editor')
  expect(p.text()).toContain('No chip is selected in an IC editor in the game.')
  expect(p.text()).not.toMatch(/editor is (open|closed)/i)
  expect(p.link.state.linked).toBeNull()
})

it('the open editor\'s chip, when the game reports one selected (derived input), is linked by its name', async () => {
  const selected = JSON.stringify({ ...JSON.parse(EDITOR), selected_chip_ref_id: 1005, selected_housing_ref_id: 2005, selected_housing_name: 'Console E' })
  const p = mountLink({ list_chips: LIST, get_editor_state: selected })
  await p.click('Use the chip selected in the IC editor')
  expect(p.text()).toContain('Linked to Console E (Scripted Screens).')
  expect(p.link.state.linked?.ref).toBe(1005)
})

it('unlinks', async () => {
  const p = mountLink()
  await p.click('List chips')
  await p.click('Link Console B (Scripted Screens)')
  await p.click('Unlink')
  expect(p.text()).toContain('Not linked')
  expect(p.link.state.linked).toBeNull()
})

it('a game that does not answer is said, with the possible causes', async () => {
  const p = mountLink(undefined, async () => { throw new TypeError('Failed to fetch') })
  await p.click('List chips')
  expect(p.text()).toContain('No answer from the game')
  expect(p.text()).toContain('AllowedBrowserOrigins')
  // Seen in the browser: a long answer in one unwrapped line ran past the dialog's edge.
  for (const pre of Array.from(p.ui.container.querySelectorAll('pre'))) expect(pre.style.whiteSpace).toBe('pre-wrap')
})

it('the last request\'s problem is shown without an id', async () => {
  const p = mountLink(undefined, async () => { throw new Error('socket closed for chip 1002 on network 3001') })
  await run(async () => { await p.link.listChips(new AbortController().signal) })
  expect(p.link.state.problem).toContain('1002')
  expect(p.text()).toContain('The game did not answer the last request')
  expect(p.readable()).not.toMatch(/1002|3001/)
})

it('offers no Link button on a row that cannot be linked', async () => {
  const p = mountLink()
  await p.click('List chips')
  const rows = Array.from(p.ui.container.querySelectorAll('li'))
  const unlinkable = rows.filter(r => /not linkable/.test(r.textContent ?? ''))
  expect(unlinkable.length).toBe(12)
  for (const r of unlinkable) expect(r.querySelector('button')).toBeNull()
  for (const r of rows.filter(r => !unlinkable.includes(r))) expect(r.querySelector('button')).not.toBeNull()
})
