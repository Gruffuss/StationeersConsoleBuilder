// @vitest-environment happy-dom
import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { Dialog } from './Dialog'

afterEach(() => vi.restoreAllMocks())

it('closes the topmost modal on Escape even when its focused control disappeared', async () => {
  const first = vi.fn(), last = vi.fn()
  const ui = mount(<><Dialog open title="First" onClose={first}>Text</Dialog><Dialog open title="Last" onClose={last}>Text</Dialog></>)
  try {
    await run(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(last).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled()
  } finally { ui.unmount() }
})

it('keeps children mounted and opens once with a labelled title and initial focus', () => {
  const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
  const ref = createRef<HTMLButtonElement>()
  const close = vi.fn()
  const view = (open: boolean) => <Dialog open={open} title="Export" onClose={close} initialFocus={ref}><button ref={ref}>First</button></Dialog>
  const ui = mount(view(false))
  const dialog = ui.container.querySelector('dialog')!
  expect(dialog.open).toBe(false)
  const child = ui.container.querySelector('.dlg-body button')!
  expect(child.textContent).toBe('First')
  ui.rerender(view(true))
  ui.rerender(view(true))
  expect(show).toHaveBeenCalledTimes(1)
  expect(dialog.open).toBe(true)
  expect(document.activeElement).toBe(ref.current)
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Export')
  ui.rerender(view(false))
  expect(dialog.open).toBe(false)
  expect(close).not.toHaveBeenCalled()
  expect(ui.container.querySelector('.dlg-body button')).toBe(child)
  ui.unmount()
})

it('prevents native cancel and reports cancel, Close and browser close', async () => {
  const close = vi.fn()
  const ui = mount(<Dialog open title="Fonts" onClose={close}>Contents</Dialog>)
  const dialog = ui.container.querySelector('dialog')!
  const cancel = new Event('cancel', { cancelable: true })
  await run(() => { dialog.dispatchEvent(cancel) })
  expect(cancel.defaultPrevented).toBe(true)
  expect(close).toHaveBeenCalledTimes(1)
  await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
  expect(close).toHaveBeenCalledTimes(2)
  await run(() => { dialog.dispatchEvent(new Event('close')) })
  expect(close).toHaveBeenCalledTimes(3)
  ui.unmount()
})

it('keeps a non-closable dialog open on cancel', async () => {
  const close = vi.fn()
  const ui = mount(<Dialog open title={<span>Choose</span>} label="Choose a project" closable={false} onClose={close}>Contents</Dialog>)
  expect(ui.container.querySelector('[aria-label="Close"]')).toBeNull()
  expect(ui.container.querySelector('dialog')!.getAttribute('aria-label')).toBe('Choose a project')
  expect(ui.container.querySelector('dialog')!.hasAttribute('aria-labelledby')).toBe(false)
  const cancel = new Event('cancel', { cancelable: true })
  await run(() => { ui.container.querySelector('dialog')!.dispatchEvent(cancel) })
  expect(cancel.defaultPrevented).toBe(true)
  expect(close).not.toHaveBeenCalled()
  ui.unmount()
})

it('sets open when showModal is unavailable', () => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(undefined as never)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: undefined, configurable: true })
  const ui = mount(<Dialog open title="Fallback" onClose={() => {}}>Contents</Dialog>)
  expect(ui.container.querySelector('dialog')!.open).toBe(true)
  ui.unmount()
})
it('reopens a non-closable modal after an unavoidable native close', async () => {
  const close = vi.fn(), show = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
  const ui = mount(<Dialog open title="Choose a project" closable={false} onClose={close}>Contents</Dialog>)
  const dialog = ui.container.querySelector('dialog')!
  await run(() => { dialog.open = false; dialog.dispatchEvent(new Event('close')) })
  expect(dialog.open).toBe(true)
  expect(show).toHaveBeenCalledTimes(2)
  expect(close).not.toHaveBeenCalled()
  ui.unmount()
})
