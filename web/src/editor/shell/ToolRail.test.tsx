// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount, run } from '../../testing'
import { harness } from '../../editing/testing'
import { TOOLS } from '../../editing/registry'
import { ToolRail } from './ToolRail'

it('offers every tool once in board order, keeps focus, and updates the active tool', async () => {
  const h = harness({ header: {}, defs: [], root: [] }), ui = mount(<ToolRail ctx={h.ctx} />)
  try {
    const buttons = Array.from(ui.container.querySelectorAll<HTMLButtonElement>('button'))
    expect(buttons.map(b => b.textContent)).toEqual(['Select', 'Points', 'Pen', 'Path', 'Rectangle', 'Ellipse', 'Polygon', 'Line', 'Text', 'Image', 'Gradient'])
    expect(buttons).toHaveLength(TOOLS.length)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    buttons[0].dispatchEvent(down); expect(down.defaultPrevented).toBe(true)
    await run(() => buttons[1].click()); expect(h.ctx.tool()).toBe('points')
    ui.rerender(<ToolRail ctx={h.ctx} />)
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
    expect(ui.container.querySelector('[role="img"]')!.getAttribute('aria-label')).toContain('Draw defaults:')
  } finally { ui.unmount(); h.checker.dispose() }
})
