// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { mount, run } from '../../testing'
import { harness } from '../../editing/testing'
import { StatusBar } from './StatusBar'
import { pointerStore } from './pointer'
import { templateProject } from '../../project/templateData'

afterEach(() => pointerStore.reset())

it('visibly shows the editing note left by a mouse set resize while Messages is closed', () => {
  const h = harness(templateProject('airlock', 'vanilla-plus').pages[0].scene)
  let ui: ReturnType<typeof mount> | undefined
  try {
    h.key({ key: 'a', ctrlKey: true })
    h.drag({ x: 437, y: 435 }, { x: 230, y: 213.15 }, { ctrlKey: true })
    expect(h.status()).not.toBe('')
    ui = mount(<StatusBar ctx={h.ctx} play={false} gap="10" onGap={vi.fn()} source={false} onSource={vi.fn()}
      messagesOpen={false} onMessages={vi.fn()} setViewSlot={vi.fn()}
      messages={[{ level: 'info', source: 'Editing', text: h.status() }]}
      status={{ shown: 'Running (7 instructions)', spoken: h.status() }} />)
    expect(ui.container.querySelector('.vb-run-line')!.textContent).toContain(h.status())
    expect(ui.container.querySelector('.vb-run-line')!.getAttribute('title')).toContain(h.status())
  } finally { ui?.unmount(); h.checker.dispose() }
})

it('keeps an empty game slot mounted and renders optional game content after Source', () => {
  const h = harness({ header: {}, defs: [], root: [] })
  const props = { ctx: h.ctx, play: false, gap: '10', onGap: vi.fn(), source: true, onSource: vi.fn(), messagesOpen: false, onMessages: vi.fn(), messages: [], status: { shown: '', spoken: '' }, setViewSlot: vi.fn() }
  const ui = mount(<StatusBar {...props} />)
  try {
    const slot = ui.container.querySelector<HTMLElement>('.vb-status-game')
    expect(slot).not.toBeNull(); expect(slot!.hidden).toBe(true); expect(slot!.textContent).toBe('')
    ui.rerender(<StatusBar {...props} game={<button>Game status</button>} />)
    expect(ui.container.querySelector('.vb-status-game')).toBe(slot)
    expect(slot!.hidden).toBe(false); expect(slot!.textContent).toBe('Game status')
    expect(slot!.previousElementSibling?.getAttribute('aria-label')).toBe('Source')
  } finally { ui.unmount(); h.checker.dispose() }
})

it('keeps the live line mounted, exposes status controls and suppresses navigation in Play', async () => {
  const h = harness({ header: {}, defs: [], root: [] }), source = vi.fn(), messages = vi.fn(), slot = vi.fn()
  const props = { ctx: h.ctx, gap: '10', onGap: vi.fn(), source: true, onSource: source, messagesOpen: false, onMessages: messages, messages: [], status: { shown: 'a\nb', spoken: 'warning' }, setViewSlot: slot }
  const ui = mount(<StatusBar {...props} play={false} />)
  try {
    expect(ui.container.querySelector('[aria-live]')!.textContent).toBe('warning')
    expect(ui.container.querySelector('.vb-run-line')!.textContent).toBe('a · b')
    await run(() => pointerStore.set({ x: 12.2, y: -4.8 }))
    expect(ui.container.querySelector('.vb-pointer')!.textContent).toBe('X 12 Y -5')
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Source"]')!.click()); expect(source).toHaveBeenCalledWith(false)
    ui.rerender(<StatusBar {...props} play />)
    expect(ui.container.textContent).toContain('Zoom, fit and pan are off while playing.')
    expect(ui.container.querySelector<HTMLElement>('.vb-pointer')!.hidden).toBe(true)
  } finally { ui.unmount(); h.checker.dispose() }
})
