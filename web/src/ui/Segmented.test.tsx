// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { Segmented } from './Segmented'

it('labels a native radio group, changes the value and disables all choices', async () => {
  const change = vi.fn()
  const view = (disabled = false) => <Segmented label="Layout direction" value="row" options={[{ value: 'row', label: 'Row' }, { value: 'column', label: 'Column' }]} onChange={change} disabled={disabled} />
  const ui = mount(view())
  expect(ui.container.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Layout direction')
  const radios = Array.from(ui.container.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
  expect(radios.filter(r => r.checked)).toHaveLength(1)
  expect(radios[0].name).toBe(radios[1].name)
  await run(() => radios[1].click())
  expect(change).toHaveBeenCalledWith('column')
  ui.rerender(view(true))
  expect(radios.every(r => r.disabled)).toBe(true)
  ui.unmount()
})
