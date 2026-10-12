// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { WIDGETS } from '../widgets/registry'
import { WidgetPalette } from './WidgetPalette'

it('shows four open counted groups and a line icon on every widget tile', async () => {
  const onInsert = vi.fn(), ui = mount(<WidgetPalette onInsert={onInsert} />)
  try {
    const groups = Array.from(ui.container.querySelectorAll<HTMLDetailsElement>('details.disc'))
    expect(groups).toHaveLength(4)
    expect(groups.every(d => d.open)).toBe(true)
    expect(groups.map(d => d.querySelector('summary .unit')?.textContent)).toEqual(['6', '8', '4', '3'])
    const buttons = Array.from(ui.container.querySelectorAll<HTMLButtonElement>('button.raised'))
    expect(buttons).toHaveLength(Object.keys(WIDGETS).length)
    expect(buttons.every(b => b.querySelector('svg[aria-hidden="true"]'))).toBe(true)
    for (const button of buttons) {
      await run(() => button.click())
      expect(onInsert).toHaveBeenLastCalledWith(Object.values(WIDGETS).find(w => w.label === button.textContent)!.type)
    }
    expect(ui.container.querySelector('p.unit')?.textContent).toBe('Click a widget to insert it at the page centre, inside the entered group if there is one. Item / gas icon and Text input are native game elements.')
  } finally { ui.unmount() }
})
