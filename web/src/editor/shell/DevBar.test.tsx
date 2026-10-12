// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount } from '../../testing'
import { DevBar } from './DevBar'

it('uses chrome controls for both developer toggles', () => {
  const ui = mount(<DevBar scripts onScripts={() => {}} compare={false} onCompare={() => {}}><select aria-label="Example" /></DevBar>)
  try {
    expect(ui.container.querySelector('header')!.classList.contains('raised')).toBe(true)
    expect(ui.container.querySelectorAll('label.chk > input[type=checkbox]')).toHaveLength(2)
  } finally { ui.unmount() }
})
