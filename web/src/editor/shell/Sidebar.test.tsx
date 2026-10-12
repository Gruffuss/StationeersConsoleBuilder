// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { mount, run } from '../../testing'
import { Sidebar } from './Sidebar'

it('switches tabs with both lists mounted and a sticky tab strip', async () => {
  function Harness() {
    const [tab, setTab] = useState<'Layers' | 'Widgets'>('Layers')
    return <Sidebar tab={tab} onTab={setTab} layers={<input aria-label="Layer draft" />} widgets={<button>Widget</button>} />
  }
  const ui = mount(<Harness />)
  try {
    const layer = ui.container.querySelector<HTMLInputElement>('input')!
    expect(ui.container.querySelector('[id="vb-side-panel-Widgets"]')).not.toBeNull()
    layer.value = 'draft'
    await run(() => ui.container.querySelector<HTMLButtonElement>('#vb-side-tab-Widgets')!.click())
    expect(ui.container.querySelector('input')).toBe(layer)
    expect(layer.value).toBe('draft')
    expect(ui.container.querySelector<HTMLElement>('#vb-side-panel-Layers')!.hidden).toBe(true)
    expect(ui.container.querySelector<HTMLElement>('#vb-side-panel-Widgets')!.hidden).toBe(false)
    const style = document.createElement('style')
    style.textContent = readFileSync(`${import.meta.dirname}/../../app.css`, 'utf8')
    document.head.append(style)
    try { expect(getComputedStyle(ui.container.querySelector('[role=tablist]')!).position).toBe('sticky') }
    finally { style.remove() }
  } finally { ui.unmount() }
})
