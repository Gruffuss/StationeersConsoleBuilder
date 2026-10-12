// @vitest-environment happy-dom
import { useState } from 'react'
import { expect, it } from 'vitest'
import { mount, run } from '../testing'
import { Tabs } from './Tabs'

it('keeps exact labels, links panels and selects with arrows, Home, End and clicks', async () => {
  function Harness() {
    const [value, change] = useState('design')
    return <><Tabs label="Inspector" tabs={[{ id: 'design', label: 'Design' }, { id: 'data', label: 'Data' }, { id: 'lua', label: 'Lua' }]} value={value} onChange={change} idPrefix="inspector" /><div id={`inspector-panel-${value}`} /></>
  }
  const ui = mount(<Harness />)
  const tabs = Array.from(ui.container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  expect(tabs.map(b => b.textContent)).toEqual(['Design', 'Data', 'Lua'])
  expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  expect(tabs[0].id).toBe('inspector-tab-design')
  expect(tabs[0].getAttribute('aria-controls')).toBe('inspector-panel-design')
  expect(tabs[1].hasAttribute('aria-controls')).toBe(false)
  const key = async (index: number, key: string) => run(() => { tabs[index].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
  await key(0, 'ArrowRight')
  expect(tabs[1].getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(tabs[1])
  await key(1, 'End')
  await key(2, 'ArrowRight')
  expect(tabs[0].tabIndex).toBe(0)
  await key(0, 'ArrowLeft')
  expect(tabs[2].tabIndex).toBe(0)
  await key(2, 'Home')
  expect(tabs[0].tabIndex).toBe(0)
  await run(() => tabs[1].click())
  expect(tabs[1].tabIndex).toBe(0)
  ui.unmount()
})

it('links inactive tabs when their panels stay mounted', () => {
  const ui = mount(<><Tabs label="Colour" tabs={[{ id: 'solid', label: 'Solid' }, { id: 'gradient', label: 'Gradient' }]} value="solid" onChange={() => {}} idPrefix="colour" /><div id="colour-panel-solid" /><div id="colour-panel-gradient" hidden /></>)
  try { expect(ui.container.querySelector('#colour-tab-gradient')!.getAttribute('aria-controls')).toBe('colour-panel-gradient') }
  finally { ui.unmount() }
})
