// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { GAME_MCP_URL, GameMcp } from '../runtime/gameMcp'
import { chipEntries, GameLink } from '../runtime/gameLink'
import { fakeGame, recordedText } from '../runtime/gameMcpTesting'
import { mount, run } from '../testing'
import { GameLinkStatus } from './GameLinkStatus'
import { readFileSync } from 'node:fs'

const cleanups: (() => void)[] = []
afterEach(() => { for (const f of cleanups.splice(0)) f() })
const LIST = recordedText('s4-list-chips-editor-closed')

it('shows the linked housing\'s name or "not linked", follows the link, and opens the dialog on a click', async () => {
  const game = fakeGame()
  const link = new GameLink(new GameMcp({ endpoint: GAME_MCP_URL, fetch: game.fetch, origin: 'http://localhost:4173' }))
  const open = vi.fn()
  const ui = mount(<GameLinkStatus link={link} onOpen={open} />)
  cleanups.push(() => ui.unmount())
  const button = () => ui.container.querySelector<HTMLButtonElement>('button')!
  expect(button().textContent).toBe('Game: not linked')
  const chip = chipEntries({ ok: true, texts: [LIST], images: [] })!.find(c => c.name === 'Console B (Scripted Screens)')!
  await run(() => link.linkChip(chip))
  expect(button().textContent).toBe('Game: Console B (Scripted Screens)')
  const style = document.createElement('style')
  style.textContent = readFileSync(`${import.meta.dirname}/../ui/base.css`, 'utf8') + readFileSync(`${import.meta.dirname}/game.css`, 'utf8')
  document.head.append(style)
  try {
    const name = button().querySelector('.vb-game-name')
    expect(name).not.toBeNull()
    expect(getComputedStyle(button()).textTransform).toBe('uppercase')
    expect(getComputedStyle(name!).textTransform).toBe('none')
  } finally { style.remove() }
  expect(ui.container.textContent).not.toMatch(/100\d|3001/)
  await run(() => button().click())
  expect(open).toHaveBeenCalledOnce()
  await run(() => link.unlink())
  expect(button().textContent).toBe('Game: not linked')
  expect(game.calls).toEqual([])
})

it('says when the game did not answer the last request', async () => {
  const link = new GameLink(new GameMcp({ endpoint: GAME_MCP_URL, fetch: async () => { throw new TypeError('Failed to fetch') }, origin: 'http://localhost:4173' }))
  const ui = mount(<GameLinkStatus link={link} onOpen={() => {}} />)
  cleanups.push(() => ui.unmount())
  await run(async () => { await link.listChips(new AbortController().signal) })
  expect(ui.container.textContent).toBe('Game: not linked (no answer)')
})
