// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../../testing'
import { FrameLabel } from './FrameLabel'
import { newProject } from '../../model/project'
import { SIZES } from '../../model/shapes'

it('opens the console sizes from the label above the page: a size is one click, Custom goes to the inspector', async () => {
  const page = newProject().pages[0], dispatch = vi.fn(), custom = vi.fn()
  const ui = mount(<FrameLabel page={page} dispatch={dispatch} onCustom={custom} />)
  try {
    const trigger = ui.container.querySelector<HTMLButtonElement>('button[aria-label="Console size"]')!
    expect(trigger.textContent).toBe('Square (1×1)')
    await run(() => trigger.click())
    const items = Array.from(ui.container.querySelectorAll<HTMLButtonElement>('[role="menu"] button'))
    expect(items.find(b => b.getAttribute('aria-checked') === 'true')!.textContent).toBe('Square (1×1)')
    expect(items.map(b => !!b.querySelector('.mi-check svg'))).toEqual(items.map(b => b.getAttribute('aria-checked') === 'true'))   // the current size shows a check
    await run(() => items.find(b => b.textContent === '2×1')!.click())
    expect(dispatch).toHaveBeenCalledWith({ type: 'setPageShape', pageId: page.id, shape: '2x1', size: page.size })
    await run(() => trigger.click())
    await run(() => Array.from(ui.container.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(b => b.textContent === 'Custom size…')!.click())
    expect(custom).toHaveBeenCalledOnce(); expect(dispatch).toHaveBeenCalledOnce()
  } finally { ui.unmount() }
})

it('lists sizes, not models: a page on any model shows its size, and choosing that size again changes nothing', async () => {
  const page = { ...newProject().pages[0], shape: '3x2-rugged' as const }, dispatch = vi.fn()
  const ui = mount(<FrameLabel page={page} dispatch={dispatch} onCustom={() => {}} />)
  try {
    const trigger = ui.container.querySelector<HTMLButtonElement>('button[aria-label="Console size"]')!
    expect(trigger.textContent).toBe('3×2')
    await run(() => trigger.click())
    const items = () => Array.from(ui.container.querySelectorAll<HTMLButtonElement>('[role="menu"] button'))
    expect(items().map(b => b.textContent)).toEqual([...SIZES.map(s => s.label), 'Custom size…'])
    expect(items().filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.textContent)).toEqual(['3×2'])
    await run(() => items().find(b => b.textContent === '3×2')!.click())
    expect(dispatch).not.toHaveBeenCalled()
    await run(() => trigger.click())
    await run(() => items().find(b => b.textContent === 'Monitor 3×3')!.click())
    expect(dispatch).toHaveBeenCalledWith({ type: 'setPageShape', pageId: page.id, shape: 'monitor-3x3-rugged', size: page.size })
  } finally { ui.unmount() }
})
