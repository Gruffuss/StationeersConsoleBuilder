// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { node } from '../model/testing'
import type { Scene, SrcNode } from '../model/scene'
import { newProject } from '../model/project'
import { initialState, nodeAt, reducer, type Action } from '../model/store'
import { checkWorkers } from '../srctext/testing'
import { SceneChecker } from '../srctext/checker'
import { checkScene } from '../srctext/check'
import { printChecked } from '../srctext/print'
import { parseSrc } from '../srctext/parse'
import { mount, run } from '../testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { expandRoot, widgetAt } from '../widgets/core'
import { instance } from '../widgets/testing'
import { layoutOf, marginOf, fillsBox, withLayout, type LayoutRecord } from '../editing/layoutRecords'
import { PropertyPanel } from './PropertyPanel'
import { WidgetPanel } from './WidgetPanel'
import { LayoutFields } from './LayoutFields'

const record: LayoutRecord = { dir: 'row', pad: [4, 8, 4, 8], gap: 6, align: 'start', justify: 'start', size: 'fixed', box: [0, 0, 100, 60] }
const kids = () => [node('R', { id: 'a', w: 10, h: 10 }), node('R', { id: 'b', w: 10, h: 10 })]
const group = () => withLayout(node('G', {}, kids()), record)
let ui: ReturnType<typeof mount> | undefined
afterEach(() => { ui?.unmount(); ui = undefined })
const settle = () => new Promise(r => setTimeout(r, 0))

it('changes Layout direction through the named segmented group', async () => {
  const h = panel()
  const direction = ui!.container.querySelector('[role=radiogroup][aria-label="Layout direction"]')!
  expect(direction).not.toBeNull()
  expect(direction.querySelectorAll('input[type=radio]')).toHaveLength(2)
  await run(async () => { direction.querySelector<HTMLInputElement>('input[value=column]')!.click(); await settle() })
  expect(layoutOf(h.scene().root[0])!.dir).toBe('column')
  expect(h.state().past).toHaveLength(1)
})
function panel(root = [group()], path = [0], defs: SrcNode[] = [], widgetPanel = false, layoutOnly = false) {
  const p = newProject(); p.theme = 'vanilla-plus'; p.pages[0].scene = { header: { w: 460, h: 460 }, defs, root }
  let state = initialState(p)
  const workers = checkWorkers(), checker = new SceneChecker(workers.make)
  const dispatch = (a: Action) => { state = reducer(state, a) }
  const draw = () => widgetPanel ? <WidgetPanel page={state.project.pages[0]} pages={[{ id: 'p1', name: 'Page' }]}
    widget={widgetAt(state.project.pages[0].scene, path, vanillaPlus)!} theme={vanillaPlus} checker={checker}
    sceneOf={() => state.project.pages[0].scene} themeNow={() => vanillaPlus} pageNow={() => state.project.pages[0]} dispatch={dispatch} />
    : layoutOnly ? <LayoutFields page={state.project.pages[0]} path={path} theme={vanillaPlus} checker={checker}
      sceneOf={() => state.project.pages[0].scene} dispatch={dispatch} />
    : <PropertyPanel page={state.project.pages[0]} selection={{ pageId: 'p1', path }} theme={vanillaPlus} checker={checker}
      sceneOf={() => state.project.pages[0].scene} dispatch={dispatch} />
  ui = mount(draw())
  const get = (label: string) => {
    const field = ui!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)
    expect(field, label).not.toBeNull(); return field!
  }
  const update = () => ui!.rerender(draw())
  return { get, workers, checker, dispatch, update, select: (next: number[]) => run(() => { path = next; update() }), state: () => state, scene: () => state.project.pages[0].scene,
    edit: (label: string, text: string) => run(async () => {
      const field = get(label)
      if (field.getAttribute('role') === 'radiogroup') {
        field.querySelector<HTMLInputElement>(`input[value="${text}"]`)!.click()
        await settle(); update(); return
      }
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, text)
      field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
      if (!(field instanceof HTMLSelectElement)) field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle(); update()
    }),
    click: (label: string) => run(async () => { (get(label) as unknown as HTMLButtonElement).click(); await settle(); update() }),
  }
}
it('resets same-padding when the selected group changes without remounting the fields', async () => {
  const h = panel([group(), group()], [0], [], false, true)
  await h.click('Same padding on all sides')
  expect((h.get('Same padding on all sides') as HTMLInputElement).checked).toBe(true)
  await h.select([1])
  expect((h.get('Same padding on all sides') as HTMLInputElement).checked).toBe(false)
  await h.edit('Padding top', '9')
  expect(layoutOf(h.scene().root[1])!.pad).toEqual([9, 8, 4, 8])
})
it('edits direction, padding, gap, align, justify and fixed/hug size in one undo step per field', async () => {
  const h = panel()
  await h.edit('Layout gap', '12')
  expect(h.scene().root[0].c![1].attrs.x).toBe(30); expect(h.state().past).toHaveLength(1)
  await h.edit('Padding left', '10'); expect(h.scene().root[0].c![0].attrs.x).toBe(10)
  await h.edit('Layout align', 'center'); expect(h.scene().root[0].c![0].attrs.y).toBe(25)
  await h.edit('Layout justify', 'between'); expect(h.scene().root[0].c![1].attrs.x).toBe(82)
  await h.edit('Layout direction', 'column'); expect(layoutOf(h.scene().root[0])!.dir).toBe('column')
  await h.edit('Layout sizing', 'hug'); expect(layoutOf(h.scene().root[0])!.box).toEqual([0, 0, 28, 40])
  expect(h.state().past).toHaveLength(6)
  expect(checkScene(h.scene()).errors).toEqual([])
  expect(layoutOf(parseSrc(printChecked(h.scene())).scene!.root[0])).toEqual(layoutOf(h.scene().root[0]))
})
it('adds layout to an ordinary group and removes it without moving the children', async () => {
  const h = panel([node('G', {}, kids())])
  await h.click('Add layout'); expect(layoutOf(h.scene().root[0])).not.toBeNull()
  await h.edit('Padding top', '5')
  const placed = h.scene().root[0].c
  await h.click('Remove layout')
  expect(layoutOf(h.scene().root[0])).toBeNull(); expect(h.scene().root[0].c).toEqual(placed)
  expect(h.state().past).toHaveLength(3)
})
it('supports same padding on all sides and labelled fixed box fields', async () => {
  const h = panel()
  await h.click('Same padding on all sides'); await h.edit('Padding top', '9')
  expect(layoutOf(h.scene().root[0])!.pad).toEqual([9, 9, 9, 9])
  await h.edit('Layout box width', '200'); await h.edit('Layout box height', '80')
  expect(layoutOf(h.scene().root[0])!.box).toEqual([0, 0, 200, 80])
  await h.click('Same padding on all sides'); await h.edit('Padding left', '3')
  expect(layoutOf(h.scene().root[0])!.pad).toEqual([9, 9, 9, 3])
})
it('edits each margin, permits negatives, and fills the parent box outside the flow', async () => {
  const h = panel([group()], [0, 0])
  for (const [side, value] of [['top', '-2'], ['right', '3'], ['bottom', '4'], ['left', '5']]) await h.edit('Margin ' + side, value)
  const child = () => nodeAt(h.scene().root, [0, 0])!
  expect(marginOf(child())).toEqual([-2, 3, 4, 5])
  expect(child().attrs).toMatchObject({ x: 13, y: 2 })
  await h.click('Fill the box')
  expect(fillsBox(child())).toBe(true); expect(child().attrs).toMatchObject({ x: 0, y: 0, w: 100, h: 60 })
  expect(h.scene().root[0].c![1].attrs.x).toBe(8); expect(h.state().past).toHaveLength(5)
})
it('reflows a raw child resized through the existing property catalogue', async () => {
  const h = panel([group()], [0, 0])
  await h.edit('Width', '30')
  expect(h.scene().root[0].c![1].attrs.x).toBe(44)
  expect(h.state().past).toHaveLength(1)
})
it('offers widget-root margins but never widget-internal layout or padding', async () => {
  const w = expandRoot(instance('button'), vanillaPlus), g = withLayout(node('G', {}, [w.root]), record)
  const h = panel([g], [0, 0], w.defs)
  expect(ui!.container.querySelector('[aria-label="Add layout"]')).toBeNull()
  await h.edit('Margin left', '7')
  expect(widgetAt(h.scene(), [0, 0], vanillaPlus)!.params.x).toBe(15)
  expect(h.scene().root[0].c![0].comments!.at(-1)).toMatch(/^widget /)
  await run(() => { ui?.unmount(); ui = undefined })
  panel([g], [0, 0, 0], w.defs)
  expect(ui!.container.querySelector('[aria-label="Margin left"]')).toBeNull()
  expect(ui!.container.querySelector('[aria-label="Add layout"]')).toBeNull()
})
it('refuses negative padding/gap and nonfinite values without changing the scene', async () => {
  const h = panel(), before = h.scene()
  for (const [label, value] of [['Padding top', '-1'], ['Layout gap', '-1'], ['Layout gap', 'Infinity'], ['Layout box width', '1e40']]) {
    await h.edit(label, value); expect(h.scene()).toBe(before)
    expect(ui!.container.querySelector('[role="alert"]')).not.toBeNull()
  }
  expect(h.state().past).toHaveLength(0)
})
it('keeps an expression child and reports it while placing literal siblings', async () => {
  const g = group(); g.c![0] = node('R', { id: 'dynamic', x: '=t', w: 10, h: 10 })
  const h = panel([g]); await h.edit('Layout gap', '8')
  expect(h.scene().root[0].c![0].attrs.x).toBe('=t'); expect(h.state().notice).toContain('dynamic')
})
it('refuses a layout field whose check lands after the scene was replaced', async () => {
  const h = panel(); await run(async () => { await h.checker.check(h.scene()) }); h.workers.made[0].held = true
  await h.edit('Layout gap', '8')
  const replacement: Scene = { ...h.scene(), root: [node('G', {}, [node('R', { x: '=t', w: 10, h: 10 })])] }
  await run(() => { h.dispatch({ type: 'setScene', pageId: 'p1', scene: replacement }); h.update() })
  await run(async () => { h.workers.made[0].held = false; h.workers.made[0].release(); await settle() })
  expect(h.scene()).toBe(replacement); expect(ui!.container.textContent).toContain('not applied')
})
it('exposes margins in the actual widget panel and reflows its parameter edits', async () => {
  const w = expandRoot(instance('button'), vanillaPlus)
  const g = withLayout(node('G', {}, [w.root, node('R', { id: 'next', w: 10, h: 10 })]), record)
  const h = panel([g], [0, 0], w.defs, true)
  await h.edit('Margin left', '7')
  expect(widgetAt(h.scene(), [0, 0], vanillaPlus)!.params.x).toBe(15)
  await h.edit('Width', '300')
  expect(h.scene().root[0].c![1].attrs.x).toBe(321)
  expect(h.state().past).toHaveLength(2)
})
