// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount } from '../../testing'
import { harness } from '../../editing/testing'
import { parseSrc } from '../../srctext/parse'
import { Inspector } from './Inspector'

it('offers the five panels and shows page or selected-node identity with alignment and style controls', () => {
  const h = harness(parseSrc('G id=parent { R id=box w=20 h=10 }\nR id=other').scene!), ui = mount(<Inspector ctx={h.ctx} tab="Design" onTab={() => {}}>Fields</Inspector>)
  try {
    expect(Array.from(ui.container.querySelectorAll('[role="tab"]')).map(t => t.textContent)).toEqual(['Design', 'Data', 'Logic', 'Sim', 'Lua'])
    expect(ui.container.querySelector('.vb-inspector-head')!.textContent).toContain('Page · scene')
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] } })
    ui.rerender(<Inspector ctx={h.ctx} tab="Design" onTab={() => {}}>Fields</Inspector>)
    expect(ui.container.querySelector('.vb-inspector-head')!.textContent).toContain('#boxR · in parent')
    expect(ui.container.querySelector('[aria-label="Align"]')).not.toBeNull()
    expect(ui.container.querySelector('[aria-label="Style"]')).not.toBeNull()
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] }, also: [{ pageId: 'p1', path: [1] }] })
    ui.rerender(<Inspector ctx={h.ctx} tab="Design" onTab={() => {}}>Fields</Inspector>)
    expect(ui.container.querySelector('.vb-inspector-head')!.textContent).toContain('2 selectedthe panel shows the last')
  } finally { ui.unmount(); h.checker.dispose() }
})
