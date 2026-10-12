// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { GAME_MCP_URL, GameMcp } from './gameMcp'
import { chipEntries, GameLink, shapeOffer } from './gameLink'
import { fakeGame, recordedText, toolText } from './gameMcpTesting'

afterEach(() => { vi.restoreAllMocks() })
const signal = () => new AbortController().signal
const LIST = recordedText('s4-list-chips-editor-closed')
const EDITOR = recordedText('s5-editor-state-no-chip-selected')
/** Derived, not recorded: the recorded no-selection answer with only the selected_* fields filled, as a player at an IC
 *  editor with the first recorded chip selected would give it (no such answer could be recorded without a player). */
const EDITOR_SELECTED = JSON.stringify({ ...JSON.parse(EDITOR), selected_chip_ref_id: 1001, selected_housing_ref_id: 2001, selected_housing_name: 'Console A' })
/** Derived, not recorded: the editor reported closed, nothing selected. */
const EDITOR_CLOSED = JSON.stringify({ ...JSON.parse(EDITOR), editor_open: false, wireless_remote_access_only: false })

function linkWith(answers: Record<string, string>) {
  const game = fakeGame(name => answers[name] !== undefined ? toolText(answers[name]) : toolText(`Error: unknown tool ${name}`), {})
  return { game, link: new GameLink(new GameMcp({ endpoint: GAME_MCP_URL, fetch: game.fetch, origin: 'http://localhost:4173' })) }
}
const entry = (name: string) => chipEntries({ ok: true, texts: [LIST], images: [] })!.find(c => c.name === name)!

it('reads the recorded chips: names, state, screen; Lua chips that are not libraries first', () => {
  const chips = chipEntries({ ok: true, texts: [LIST], images: [] })!
  expect(chips).toHaveLength(23)
  const firstOther = chips.findIndex(c => !c.lua || c.library)
  expect(chips.slice(0, firstOther).every(c => c.lua && !c.library)).toBe(true)
  expect(chips.slice(firstOther).every(c => !c.lua || c.library)).toBe(true)
  expect(firstOther).toBe(11)
  expect(entry('Console B (Scripted Screens)')).toMatchObject({ lua: true, library: false, on: false, error: false, screen: { surface: 'main', w: 1035.69983, h: 460 }, networkId: 3001 })
  expect(entry('Housing B').screen).toBeNull()
})

it('links a listed chip, and unlinks, telling subscribers each time', async () => {
  const { link, game } = linkWith({ list_chips: LIST })
  const seen: (string | null)[] = []
  link.subscribe(() => seen.push(link.state.linked?.name ?? null))
  const listed = await link.listChips(signal())
  expect(listed.ok).toBe(true)
  link.linkChip(entry('Console B (Scripted Screens)'))
  expect(link.state.linked).toMatchObject({ ref: 1002, name: 'Console B (Scripted Screens)', networkId: 3001 })
  link.unlink()
  expect(link.state.linked).toBeNull()
  expect(seen.slice(-2)).toEqual(['Console B (Scripted Screens)', null])
  expect(game.tools().map(t => t.name)).toEqual(['list_chips'])
})

it('the open editor\'s chip: linked when the game reports one selected (derived input), by its listed name', async () => {
  const { link, game } = linkWith({ get_editor_state: EDITOR_SELECTED, list_chips: LIST })
  expect(await link.linkEditorChip(signal())).toEqual({ ok: true })
  expect(link.state.linked).toMatchObject({ ref: 1001, name: 'Console A (Scripted Screens)' })
  expect(game.tools().map(t => t.name)).toEqual(['get_editor_state', 'list_chips'])
})

it('the open editor\'s chip: none selected, whether the game says the editor is open (recorded, wireless scope) or not', async () => {
  for (const state of [EDITOR, EDITOR_CLOSED]) {
    const { link } = linkWith({ get_editor_state: state, list_chips: LIST })
    const r = await link.linkEditorChip(signal())
    expect(r).toEqual({ ok: false, why: 'No chip is selected in an IC editor in the game.' })
    expect(link.state.linked).toBeNull()
  }
})

it('a failed request is kept as the link\'s problem until a request answers', async () => {
  const failing: typeof fetch = async () => { throw new TypeError('Failed to fetch') }
  const link = new GameLink(new GameMcp({ endpoint: GAME_MCP_URL, fetch: failing, origin: 'http://localhost:4173' }))
  const r = await link.listChips(signal())
  expect(r.ok).toBe(false)
  expect(link.state.problem).toContain('No answer from the game')
  const { link: ok } = linkWith({ list_chips: LIST })
  await ok.listChips(signal())
  expect(ok.state.problem).toBeNull()
})

it('makes no request without a call and writes nothing to storage', async () => {
  const set = vi.spyOn(Storage.prototype, 'setItem')
  const { link, game } = linkWith({ list_chips: LIST })
  expect(game.calls).toEqual([])
  await link.listChips(signal())
  link.linkChip(entry('Console A (Scripted Screens)'))
  link.unlink()
  expect(set).not.toHaveBeenCalled()
})

it('offers the console\'s screen as a page shape: one match, several, none (custom), and nothing without a screen', () => {
  expect(shapeOffer(entry('Console B (Scripted Screens)').screen)).toEqual({ kind: 'one', shape: '2x1', label: '2×1' })
  expect(shapeOffer(entry('Console D (Scripted Screens)').screen)).toEqual({ kind: 'one', shape: 'v3x2', label: 'Vertical 3×2 (MoreConsoles)' })
  expect(shapeOffer(entry('Console G (Scripted Screens)').screen)).toEqual({ kind: 'one', shape: 'monitor-3x2', label: 'Monitor 3×2 (MoreConsoles)' })
  expect(shapeOffer(entry('Console A (Scripted Screens)').screen)).toEqual({ kind: 'several', size: { w: 460, h: 460 },
    shapes: [{ shape: 'square', label: 'Square (1×1)' }, { shape: '2x2-lcm', label: '2×2 (LargeConsoleMod)' }, { shape: '3x3-lcm', label: '3×3 (LargeConsoleMod)' }] })
  expect(shapeOffer(entry('Device A - Player A').screen)).toEqual({ kind: 'custom', size: { w: 2226, h: 932 } })
  expect(shapeOffer(entry('Housing B').screen)).toBeNull()
})

it('the shape offer is settled for a link until the link changes', () => {
  const { link } = linkWith({})
  link.linkChip(entry('Console B (Scripted Screens)'))
  expect(link.state.shapeSettled).toBe(false)
  link.settleShape()
  expect(link.state.shapeSettled).toBe(true)
  link.linkChip(entry('Console B (Scripted Screens)'))
  expect(link.state.shapeSettled).toBe(true)
  link.linkChip(entry('Console D (Scripted Screens)'))
  expect(link.state.shapeSettled).toBe(false)
})
