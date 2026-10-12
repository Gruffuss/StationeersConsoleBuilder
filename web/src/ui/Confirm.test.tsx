// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { Confirm } from './Confirm'

it('focuses Cancel, cancels on Escape and Close, and exposes the danger action and extra footer', async () => {
  const cancel = vi.fn(), confirm = vi.fn()
  const ui = mount(<Confirm open title="Wipe saved values?" confirmLabel="Wipe persist" onConfirm={confirm} onCancel={cancel} extra={<button>Save JSON first</button>}>Description</Confirm>)
  expect(document.activeElement?.textContent).toBe('Cancel')
  expect(ui.container.querySelector('.dlg-foot')!.textContent).toBe('Save JSON firstCancelWipe persist')
  await run(() => { ui.container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })) })
  await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
  await run(() => Array.from(ui.container.querySelectorAll('button')).find(b => b.textContent === 'Cancel')!.click())
  expect(cancel).toHaveBeenCalledTimes(3)
  await run(() => ui.container.querySelector<HTMLButtonElement>('button.danger')!.click())
  expect(confirm).toHaveBeenCalledTimes(1)
  ui.unmount()
})
