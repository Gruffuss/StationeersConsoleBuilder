// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { GAME_MCP_URL, GameMcp } from '../runtime/gameMcp'
import { GameLink } from '../runtime/gameLink'
import { fakeGame } from '../runtime/gameMcpTesting'
import { mount, run } from '../testing'
import { SendSection } from './SendSection'

const cleanups: (() => void)[] = []
afterEach(() => { for (const f of cleanups.splice(0)) f(); localStorage.clear(); vi.restoreAllMocks() })
const ARTIFACT = { lua: '-- checked\n', name: 'Panel' }

function mountSection(ready: { lua: string; name: string } | null = ARTIFACT) {
  const game = fakeGame()
  const link = new GameLink(new GameMcp({ endpoint: GAME_MCP_URL, fetch: game.fetch, origin: 'http://localhost:4173' }))
  const ui = mount(<SendSection ready={ready} scenes={['p1']} link={link} />)
  cleanups.push(() => ui.unmount())
  const box = () => ui.container.querySelector<HTMLInputElement>('input[aria-label="Show Send to chip (advanced)"]')!
  return { ui, game, box, panel: () => ui.container.querySelector('section[aria-label="Send to chip"]'),
    rerender: (r: typeof ready) => ui.rerender(<SendSection ready={r} scenes={['p1']} link={link} />) }
}

it('is hidden until the per-browser checkbox is ticked, and the tick survives a reload', async () => {
  const a = mountSection()
  expect(a.box().checked).toBe(false)
  expect(a.panel()).toBeNull()
  await run(() => a.box().click())
  expect(a.panel()).not.toBeNull()
  expect(localStorage.getItem('vb.sendToChip')).toBe('true')
  a.ui.unmount(); cleanups.length = 0
  const b = mountSection()
  expect(b.box().checked).toBe(true)
  expect(b.panel()).not.toBeNull()
  await run(() => b.box().click())
  expect(b.panel()).toBeNull()
  expect(localStorage.getItem('vb.sendToChip')).toBe('false')
  expect(b.game.calls).toEqual([])
})

it('gives the panel exactly the artifact the export hands it, and nothing while there is none', async () => {
  localStorage.setItem('vb.sendToChip', 'true')
  const a = mountSection(null)
  expect(a.ui.container.textContent).toContain('Waiting for a completed export check')
  a.rerender(ARTIFACT)
  expect(a.ui.container.textContent).toContain('Ready: the checked script of "Panel".')
  a.rerender(null)
  expect(a.ui.container.textContent).toContain('Waiting for a completed export check')
})
