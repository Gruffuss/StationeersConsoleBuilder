// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { newProject } from '../model/project'
import type { Action } from '../model/store'
import { SceneChecker } from '../srctext/checker'
import { checkWorkers } from '../srctext/testing'
import { mount, run } from '../testing'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { instance } from '../widgets/testing'
import { NativeLayer } from './NativeLayer'
import { WIDGET_GONE, WidgetPanel } from './WidgetPanel'

it('places each native at its design box and leaves presses to the canvas, retaining keyboard selection', async () => {
  const p = newProject(), got: string[] = []
  const page = { ...p.pages[0], size: { w: 460, h: 460 }, scene: { header: { w: 480, h: 480, fit: 'contain' }, defs: [], root: [] },
    natives: [instance('icon', { x: 48, y: 96 }), instance('textinput')] }
  const ui = mount(<NativeLayer page={page} theme={t} zoom={2} selected={new Set(['ti1'])} onSelect={uid => got.push(uid)} />)
  const [icon, input] = Array.from(ui.container.querySelectorAll<HTMLElement>('.vb-native'))
  expect([icon.textContent, icon.style.left, icon.style.top]).toEqual(['Oxygen', '92px', '184px'])
  expect([input.textContent, input.className]).toEqual(['Text', 'vb-native vb-native-sel'])
  // 300 × 54 units and a 26-unit font at 460/480 px a unit, zoom 2
  expect([input.style.width, input.style.height, input.style.background]).toEqual(['575px', '103.5px', '#111116'])
  expect(parseFloat(input.style.fontSize)).toBeCloseTo(26 * 460 / 480 * 2, 5)
  await run(() => { icon.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
  expect(got).toEqual([])
  expect(icon.style.pointerEvents).toBe('none')
  expect(input.tabIndex).toBe(0)   // and from the keyboard
  await run(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(got).toEqual(['ti1'])
})

it('renders only shown natives in z order and marks every selected uid', () => {
  const p = newProject(), page = { ...p.pages[0], natives: [instance('textinput'), instance('icon'),
    { ...instance('icon'), uid: 'hidden', hidden: true as const }, { ...instance('icon'), uid: 'held', group: 'gone' }] }
  page.scene = { header: {}, defs: [], root: [{ op: 'G', attrs: { id: 'gone', v: 0 }, c: [] }] }
  const ui = mount(<NativeLayer page={page} theme={t} zoom={1} selected={new Set(['ico1', 'ti1'])} onSelect={() => {}} />)
  expect(Array.from(ui.container.querySelectorAll('.vb-native'), el => el.getAttribute('aria-label'))).toEqual(['icon ico1', 'textinput ti1'])
  expect(ui.container.querySelectorAll('.vb-native-sel')).toHaveLength(2)
})

it('places natives by the scene header’s fit, as the shell does', () => {
  const p = newProject()
  // A 480-unit square on a 460 × 230 surface. contain: s = 230/480, centred (ox 115); cover: s = 460/480, centred (oy −115);
  // stretch: 460/480 across, 230/480 down.
  for (const [fit, want] of [['contain', ['138px', '46px', `${66 * 230 / 480}px`]], ['cover', ['46px', '-23px', '63.25px']],
    ['stretch', ['46px', '46px', '63.25px']]] as const) {
    const page = { ...p.pages[0], size: { w: 460, h: 230 }, scene: { header: { w: 480, h: 480, fit }, defs: [], root: [] },
      natives: [instance('icon', { x: 48, y: 96 })] }
    const icon = mount(<NativeLayer page={page} theme={t} zoom={1} onSelect={() => {}} />).container.querySelector<HTMLElement>('.vb-native')!
    expect([icon.style.left, icon.style.top, icon.style.width]).toEqual(want)
  }
})

it('the widget panel edits a native through setWidget, unchecked, from the store’s native, and offers no Detach', async () => {
  const p = newProject(), actions: Action[] = []
  const page = { ...p.pages[0], natives: [instance('icon')] }
  // The store has moved it since the panel's render: the edit keeps that move.
  const now = { ...page, natives: [{ ...page.natives[0], params: { ...page.natives[0].params, y: 50 } }] }
  const ui = mount(<WidgetPanel page={page} pages={[]} widget={page.natives[0]} native checker={new SceneChecker(checkWorkers().make)} theme={t}
    dispatch={a => actions.push(a)} sceneOf={() => page.scene} themeNow={() => t} pageNow={() => now} />)
  const x = ui.container.querySelector<HTMLInputElement>('[aria-label="X position"]')!
  await run(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(x, '10')
    x.dispatchEvent(new Event('input', { bubbles: true }))
    x.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  expect(actions).toEqual([{ type: 'setWidget', pageId: 'p1', ref: { ...page.natives[0], params: { ...page.natives[0].params, x: 10, y: 50 } } }])
  expect(Array.from(ui.container.querySelectorAll('button'), b => b.textContent)).toEqual(['Delete'])
})

it('a native commit reads only the store: a page the store no longer has is not edited from the panel’s render', async () => {
  const p = newProject(), actions: Action[] = []
  const page = { ...p.pages[0], natives: [instance('icon')] }
  const ui = mount(<WidgetPanel page={page} pages={[]} widget={page.natives[0]} native checker={new SceneChecker(checkWorkers().make)} theme={t}
    dispatch={a => actions.push(a)} sceneOf={() => undefined} themeNow={() => t} pageNow={() => undefined} />)
  const x = ui.container.querySelector<HTMLInputElement>('[aria-label="X position"]')!
  await run(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(x, '10')
    x.dispatchEvent(new Event('input', { bubbles: true }))
    x.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  expect(actions).toEqual([])
  expect(Array.from(ui.container.querySelectorAll('[role=alert]'), e => e.textContent)).toEqual([WIDGET_GONE])
})

it('keeps a long icon name whole on one line in its placeholder at any zoom', () => {
  const p = newProject()
  const at = (zoom: number) => {
    const page = { ...p.pages[0], size: { w: 460, h: 460 }, scene: { header: { w: 480, h: 480, fit: 'contain' }, defs: [], root: [] },
      natives: [instance('icon', { x: 0, y: 0, w: 96, h: 96, kind: 'prefab', name: '1929046963' })] }
    return mount(<NativeLayer page={page} theme={t} zoom={zoom} onSelect={() => {}} />).container.querySelector<HTMLElement>('.vb-native')!
  }
  // 96 units are 92, 69 and 23 px at zoom 1, 0.75 and 0.25; the ten characters (7.2 px each at 12 px here, without a canvas)
  // fill the box less its borders, padding and a spare pixel (15 px), never more than 12 px and never wrapped.
  expect(at(1).style.fontSize).toBe('12px')
  expect(parseFloat(at(0.75).style.fontSize)).toBeCloseTo(12 * (69 - 15) / 72, 5)
  const tiny = at(0.25)
  expect(parseFloat(tiny.style.fontSize)).toBeCloseTo(12 * (23 - 15) / 72, 5)
  expect([tiny.style.whiteSpace, tiny.textContent]).toEqual(['', '1929046963'])
})
