// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { harness } from '../editing/testing'
import { mount } from '../testing'
import { instance } from '../widgets/testing'
import { Layers } from './Layers'
import { WidgetPanel } from './WidgetPanel'

vi.mock('./nativeText', () => ({ NATIVE_DESCRIPTION: 'Shared native description probe' }))

it('takes both the Layers title and panel explanation from their shared description', () => {
  const w = instance('icon'), h = harness({ header: {}, defs: [], root: [] }, { natives: [w] })
  const ui = mount(<><Layers page={h.ctx.page()} selection={null} also={[]} entered={null} dispatch={h.ctx.dispatch} ctx={h.ctx} />
    <WidgetPanel page={h.ctx.page()} pages={[]} widget={w} native checker={h.checker} theme={h.ctx.theme()} dispatch={h.ctx.dispatch}
      sceneOf={() => h.ctx.page().scene} themeNow={h.ctx.theme} pageNow={h.ctx.page} /></>)
  try {
    expect(ui.container.querySelector<HTMLElement>('[data-layer="native:ico1"]')!.title).toBe('Shared native description probe')
    expect(ui.container.querySelector('[aria-label="Widget"]')!.textContent).toContain('Shared native description probe')
  } finally { ui.unmount(); h.checker.dispose() }
})
