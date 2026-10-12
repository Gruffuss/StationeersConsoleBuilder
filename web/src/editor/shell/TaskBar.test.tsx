// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../../testing'
import { harness } from '../../editing/testing'
import { parseSrc } from '../../srctext/parse'
import * as registry from '../../editing/registry'
import { TaskBar } from './TaskBar'

it('anchors selection actions without taking the canvas press and runs registry commands', async () => {
  const h = harness(parseSrc('G { R w=20 h=10 }\nR w=20 h=10').scene!, { sel: { pageId: 'p1', path: [0] } })
  const command = vi.spyOn(registry, 'runCommand').mockResolvedValue(undefined), press = vi.fn()
  const box = { x: 10, y: 20, w: 30, h: 40 }
  const ui = mount(<div onPointerDown={press}><TaskBar ctx={h.ctx} box={box} zoom={2} onDataNames={() => {}} /></div>)
  try {
    const toolbar = ui.container.querySelector<HTMLElement>('[aria-label="Selection actions"]')!
    expect(toolbar.style.left).toBe('50px'); expect(toolbar.style.top).toBe('132px')
    await run(() => { toolbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) }); expect(press).not.toHaveBeenCalled()
    const enter = Array.from(toolbar.querySelectorAll('button')).find(b => b.textContent === 'Enter the group')!
    await run(() => enter.click()); expect(command.mock.calls.at(-1)![0].id).toBe('select.enter')
    await run(() => toolbar.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click())
    const duplicate = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(b => b.textContent?.startsWith('Duplicate'))!
    await run(() => duplicate.click()); expect(command.mock.calls.at(-1)![0].id).toBe('duplicate')
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [1] }, also: [{ pageId: 'p1', path: [0] }] })
    ui.rerender(<TaskBar ctx={h.ctx} box={box} zoom={1} onDataNames={() => {}} />); expect(ui.container.textContent).toContain('2 selectedGroup')
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0], inDefs: true } })
    ui.rerender(<TaskBar ctx={h.ctx} box={box} zoom={1} onDataNames={() => {}} />); expect(ui.container.querySelector('[role="toolbar"]')).toBeNull()
  } finally { ui.unmount(); h.checker.dispose(); command.mockRestore() }
})
