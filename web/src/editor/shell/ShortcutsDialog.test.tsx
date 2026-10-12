// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount } from '../../testing'
import { harness } from '../../editing/testing'
import { ShortcutsDialog } from './ShortcutsDialog'

it('keeps the full keyboard and gesture reference mounted while closed', () => {
  const h = harness({ header: {}, defs: [], root: [] }), ui = mount(<ShortcutsDialog ctx={h.ctx} open={false} onClose={() => {}} />)
  try {
    expect(ui.container.querySelector('dialog')!.open).toBe(false)
    expect(ui.container.querySelector('h2')!.textContent).toBe('Keyboard and gestures')
    expect(ui.container.textContent).toContain('Ctrl')
    expect(ui.container.textContent).toContain('Escape')
  } finally { ui.unmount(); h.checker.dispose() }
})
