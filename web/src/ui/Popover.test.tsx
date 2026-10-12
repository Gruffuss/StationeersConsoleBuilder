// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { useState } from 'react'
import { mount, run } from '../testing'
import { Popover } from './Popover'

it('keeps hidden children mounted and closes only for Escape or outside presses while open', async () => {
  const close = vi.fn()
  const view = (open: boolean) => <Popover open={open} label="Theme" onClose={close}><input aria-label="Theme choice" /></Popover>
  const ui = mount(view(false))
  const popover = ui.container.querySelector<HTMLElement>('[role="dialog"]')!
  const input = ui.container.querySelector('input')!
  expect(popover.hidden).toBe(true)
  await run(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
  expect(close).not.toHaveBeenCalled()
  ui.rerender(view(true))
  expect(popover.hidden).toBe(false)
  expect(ui.container.querySelector('input')).toBe(input)
  await run(() => { input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
  expect(close).not.toHaveBeenCalled()
  const bubble = vi.fn()
  document.addEventListener('keydown', bubble)
  await run(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(close).toHaveBeenCalledTimes(1)
  expect(bubble).not.toHaveBeenCalled()
  document.removeEventListener('keydown', bubble)
  await run(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
  expect(close).toHaveBeenCalledTimes(2)
  ui.unmount()
})
it('lets the anchor trigger close the popover instead of reopening it', async () => {
  function Example() {
    const [open, setOpen] = useState(true)
    return <div><button onClick={() => setOpen(value => !value)}>Theme</button><Popover open={open} label="Theme" onClose={() => setOpen(false)}>Choices</Popover></div>
  }
  const ui = mount(<Example />), button = ui.container.querySelector('button')!
  await run(() => { button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
  await run(() => button.click())
  expect(ui.container.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(true)
  ui.unmount()
})
