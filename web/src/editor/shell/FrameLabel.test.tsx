// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../../testing'
import { FrameLabel } from './FrameLabel'
import { newProject } from '../../model/project'

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
