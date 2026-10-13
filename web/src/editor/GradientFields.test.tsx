// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { parseSrc } from '../srctext/parse'
import { first } from '../srctext/props'
import { SceneChecker } from '../srctext/checker'
import { checkWorkers } from '../srctext/testing'
import { mount, run } from '../testing'
import { themeOf } from '../theme'
import { PropertyPanel } from './PropertyPanel'
import { harness } from '../editing/testing'
import { node } from '../model/testing'
import { TOOLS } from '../editing/registry'
import { execFileSync } from 'node:child_process'
import { printChecked } from '../srctext/print'

let coreChecked = false
function coreFixture(scene: ReturnType<typeof parseSrc>['scene']) {
  if (coreChecked || !scene) return
  const fixture = { ...scene, defs: [...scene.defs,
    node('GR', { id: 'fixture_radial', units: 'bbox', cx: 0.5, cy: 0.5, r: 0.5, stops: [[0, '#336699'], [1, '#ffffff']] }),
    node('GC', { id: 'fixture_conic', units: 'bbox', cx: 0.5, cy: 0.5, a: 45, stops: [[0, '#336699'], [1, '#ffffff']] })],
    root: [...scene.root, node('R', { x: 120, w: 100, h: 100, f: '@fixture_radial' }), node('R', { x: 240, w: 100, h: 100, f: '@fixture_conic' })] }
  const lua = `local ui=ss.ui.surface('main'); ss.ui.activate('main')\nui:element({id='s',type='vector',rect={unit='px',x=0,y=0,w=460,h=460},props={src=[==[${printChecked(fixture)}]==]}})`
  const script = `import assert from 'node:assert/strict';
    import {decodeFrame} from './src/runtime/frame.ts';
    const {dotnet}=await import('./public/_framework/dotnet.js');
    const runtime=await dotnet.create();
    const api=(await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)).VectorBuilder.Wasm.Exports;
    const status=JSON.parse(await api.Load(${JSON.stringify(lua)},460,460,'{}','{}'));
    assert.equal(status.state,'Running',status.error);
    const bytes=api.Frame('main',1,false), frame=decodeFrame(bytes.slice().buffer);
    assert.deepEqual(frame.problems,[]); assert.ok(frame.positions.length>0);
    console.log('GL GR GC core fixture clean'); runtime.exit(0);`
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), timeout: 30000, encoding: 'utf8' })).toContain('GL GR GC core fixture clean')
  coreChecked = true
}

function gradientHarness(op = 'GL', attrs: Record<string, number | string> = {}, id = 'mine', nested = false) {
  const def = node(op, { id, units: 'bbox', ...(op === 'GL' ? { x1: 0, y1: 0, x2: 1, y2: 0 } : op === 'GR' ? { cx: 0.5, cy: 0.5, r: 0.5 } : { cx: 0.5, cy: 0.5, a: 0 }),
    stops: [[0, '#336699'], [1, '#ffffff']], ...attrs })
  const shape = node('R', { w: 100, h: 100, f: '@' + id })
  const h = harness({ header: { w: 460, h: 460 }, defs: [def], root: [nested ? node('G', { t: [20, 10], s: [2, 2] }, [shape]) : shape] },
    { sel: { pageId: 'p1', path: nested ? [0, 0] : [0] } })
  h.ctx.setTool('gradient')
  return h
}
function cssDrag(h: ReturnType<typeof gradientHarness>, from: { x: number; y: number }, to: { x: number; y: number }) {
  const ev = (at: { x: number; y: number }) => ({ pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: at.x, clientY: at.y, timeStamp: 1000 }) as PointerEvent
  const view = h.ctx.view(), surface = (at: { x: number; y: number }) => ({ x: (at.x - view.pan.x) / view.zoom, y: (at.y - view.pan.y) / view.zoom })
  const a = surface(from), b = surface(to)
  h.router.pointer('down', a.x, a.y, ev(from)); h.router.pointer('move', b.x, b.y, ev(to)); h.router.pointer('up', b.x, b.y, ev(to))
}

it('registers the gradient tool and drags the end by 50 CSS px at zoom 2, one undo step', async () => {
  expect(TOOLS.some(t => t.id === 'gradient')).toBe(true)
  const h = gradientHarness(); h.ctx.setView({ zoom: 2, pan: { x: 0, y: 0 } })
  cssDrag(h, { x: 200, y: 0 }, { x: 250, y: 0 }); await h.settle()
  expect(h.scene().defs[0].attrs.x2).toBe(1.25); expect(h.state().past).toHaveLength(1)
})
it('maps bbox handles through a nested scale and pan and draws them in CSS coordinates', async () => {
  const h = gradientHarness('GL', {}, 'mine', true); h.ctx.setView({ zoom: 2, pan: { x: 30, y: 40 } })
  cssDrag(h, { x: 470, y: 60 }, { x: 520, y: 60 }); await h.settle()
  expect(h.scene().defs[0].attrs.x2).toBe(1.125)
  const overlay = h.router.overlay({ zoom: 2, pan: { x: 30, y: 40 }, frame: null })
  ui = mount(<>{overlay}</>)
  expect(ui.container.querySelector('[aria-label="Gradient f end"]')?.getAttribute('cx')).toBe('490')
})
it.each(['GR', 'GC'])('drags %s centre and radial radius or conic angle in its bbox', async op => {
  const h = gradientHarness(op)
  h.drag({ x: 50, y: 50 }, { x: 60, y: 50 }); await h.settle()
  expect(h.scene().defs[0].attrs.cx).toBeCloseTo(0.6)
  h.drag(op === 'GR' ? { x: 110, y: 50 } : { x: 60, y: 0 }, op === 'GR' ? { x: 60, y: 100 } : { x: 110, y: 50 }); await h.settle()
  expect(h.scene().defs[0].attrs[op === 'GR' ? 'r' : 'a']).toBe(op === 'GR' ? 0.5 : 90)
  expect(h.state().past).toHaveLength(op === 'GR' ? 1 : 2)
})
it('clones a theme gradient on drag and Esc restores the def, reference and selection', async () => {
  const h = gradientHarness('GL', {}, 'theme_row'), before = h.scene(), selection = h.state().selection
  h.down({ x: 100, y: 0 }); h.move({ x: 125, y: 0 })
  expect(h.scene().defs).toHaveLength(2); expect(h.scene().defs[0]).toBe(before.defs[0])
  expect(h.root()[0].attrs.f).not.toBe('@theme_row')
  h.key({ key: 'Escape' }); await h.settle()
  expect(h.scene()).toBe(before); expect(h.state().selection).toEqual(selection); expect(h.state().past).toHaveLength(0)
})
it('does not drag over gradient geometry expressions', async () => {
  const h = gradientHarness('GL', { x2: '=t' }), before = h.scene()
  h.drag({ x: 100, y: 0 }, { x: 125, y: 0 }); await h.settle()
  expect(h.scene()).toBe(before); expect(h.state().past).toHaveLength(0)
  expect(h.notes.join(' ')).toContain('expression')
})
it.each(['shape', 'locked', 'group'])('selects on a gradient-handle miss with a selected %s and clears on empty space', selected => {
  const h = gradientHarness()
  if (selected === 'locked') h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: { ...h.root()[0], comments: ['lock'] } })
  if (selected === 'group') h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: node('G', { f: '@mine' }, [h.root()[0]]) })
  const other = node('R', { x: 200, y: 0, w: 100, h: 100, f: '#ffffff' })
  h.ctx.dispatch({ type: 'setScene', pageId: 'p1', scene: { ...h.scene(), root: [...h.root(), other] } })
  h.ctx.pick = at => ({ target: at.x === 250 ? { pageId: 'p1', path: [1] } : null })
  h.click({ x: 250, y: 50 })
  expect(h.state().selection?.path).toEqual([1])
  h.click({ x: 400, y: 400 })
  expect(h.state().selection).toBeNull()
})
it('enters the picked group before selecting a child on a gradient-handle miss', () => {
  const target = { pageId: 'p1', path: [0, 0] }
  const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('G', {}, [node('R', { w: 100, h: 100 })])] },
    { pick: () => target })
  h.ctx.setTool('gradient')
  const before = h.scene(), past = h.state().past
  h.click({ x: 50, y: 50 })
  expect(h.state().entered).toEqual({ pageId: 'p1', path: [0] })
  expect(h.state().selection).toEqual(target)
  expect(h.scene()).toBe(before); expect(h.state().past).toBe(past)
})
it('does not drag a gradient on a locked shape', async () => {
  const h = gradientHarness()
  h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: { ...h.root()[0], comments: ['lock'] } })
  const before = h.scene()
  h.drag({ x: 100, y: 0 }, { x: 125, y: 0 }); await h.settle()
  expect(h.scene()).toBe(before); expect(h.state().past).toHaveLength(1)
  expect(h.notes.join(' ')).toContain('locked')
})
it.each(['scene', 'node', 'def'])('rejects a changed %s between gradient pointer-down and its first write', kind => {
  const h = gradientHarness(), before = h.scene()
  const press = { at: { x: 100, y: 0 }, px: { x: 100, y: 0 }, start: { x: 100, y: 0 }, css: 0,
    mods: { shift: false, alt: false, mod: false }, clicks: 1 }
  const gesture = TOOLS.find(t => t.id === 'gradient')!.down(press, h.ctx)
  expect(gesture).not.toBeNull()
  // Exercise the tool'Stroke boundary itself, independently of the router'Stroke history cancellation.
  const change = (kind: string) => kind === 'scene' ? { ...before, header: { ...before.header, w: 480 } }
    : kind === 'node' ? { ...before, root: [node('R', { w: 200, h: 100, f: '@mine' })] }
    : { ...before, defs: [{ ...before.defs[0], attrs: { ...before.defs[0].attrs, x2: '=t' } }] }
  const next = change(kind)
  h.ctx.dispatch({ type: 'setScene', pageId: 'p1', scene: next })
  const move = { ...press, at: { x: 125, y: 0 }, px: { x: 125, y: 0 }, css: 25 }
  gesture!.move(move); gesture!.up(move)
  expect(h.scene()).toBe(next); expect(h.state().past).toHaveLength(1)
  expect(h.notes.join(' ')).toContain('changed')
})
it('uses a painted shape’s own bbox when it also has descendants', async () => {
  const h = gradientHarness(), painted = { ...h.root()[0], c: [node('R', { x: 200, w: 50, h: 50 })] }
  h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: painted })
  ui = mount(<>{h.router.overlay({ zoom: 1, frame: null })}</>)
  const axis = ui.container.querySelector('line')!
  expect(axis.getAttribute('x1')).toBe('0'); expect(axis.getAttribute('x2')).toBe('100')
  h.drag({ x: 100, y: 0 }, { x: 125, y: 0 }); await h.settle()
  expect(h.scene().defs[0].attrs.x2).toBe(1.25)
})
it('gives inherited group paints no invented union-box handles and explains how to edit them', () => {
  const h = gradientHarness()
  h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: node('G', { f: '@mine' }, [node('R', { x: 200, w: 50, h: 50 })]) })
  const before = h.scene()
  ui = mount(<>{h.router.overlay({ zoom: 1, frame: null })}</>)
  expect(ui.container.querySelector('circle')).toBeNull()
  h.drag({ x: 250, y: 0 }, { x: 275, y: 0 })
  expect(h.scene()).toBe(before); expect(h.notes.join(' ')).toContain('painted child')
})

let ui: ReturnType<typeof mount> | undefined
afterEach(() => { ui?.unmount(); ui = undefined })
function panel(src: string, inDefs = false, path = [0]) {
  const project = newProject(); project.pages[0].scene = parseSrc('SCENE w=460 h=460\n' + src).scene!
  let state = initialState(project)
  const checker = new SceneChecker(checkWorkers().make), theme = themeOf(project)
  const draw = () => <PropertyPanel page={state.project.pages[0]} selection={{ pageId: 'p1', path, inDefs }} theme={theme} checker={checker}
    sceneOf={() => state.project.pages[0].scene} dispatch={a => { state = reducer(state, a) }} />
  ui = mount(draw())
  const get = (label: string) => { const el = ui!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`input[aria-label="${label}"], select[aria-label="${label}"], button[aria-label="${label}"], [role="radiogroup"][aria-label="${label}"]`); expect(el, label).not.toBeNull(); return el! }
  const update = () => ui!.rerender(draw())
  return { get, theme, state: () => state, scene: () => state.project.pages[0].scene, text: () => ui!.container.textContent,
    edit: (label: string, text: string) => run(async () => {
      const el = get(label); if (el.getAttribute('role') === 'radiogroup') { el.querySelector<HTMLInputElement>(`input[value="${text}"]`)!.click(); await new Promise(r => setTimeout(r, 0)); update(); return }
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, text)
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement || el.type === 'color' ? 'change' : 'input', { bubbles: true }))
      if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise(r => setTimeout(r, 0)); update()
    }),
    click: (label: string) => run(async () => { (get(label) as unknown as HTMLButtonElement).click(); await new Promise(r => setTimeout(r, 0)); update() }),
  }
}
const defs = (id = 'mine') => `DEFS { GL id=${id} units=bbox x1=0 y1=0 x2=1 y2=0 stops=[[0,#336699],[1,#ffffff]] }`

it('keeps the kind and New gradient controls inside the mounted Gradient tab', async () => {
  const h = panel('R w=100 h=50 f=#336699')
  const kind = h.get('Fill gradient kind'), create = h.get('Fill New gradient')
  const pane = kind.closest<HTMLElement>('[role=tabpanel]')!
  expect(pane).not.toBeNull()
  expect(pane.contains(create)).toBe(true)
  expect(pane.hidden).toBe(true)
  await h.click('Fill colour panel')
  await run(() => ui!.container.querySelector<HTMLButtonElement>(`[aria-controls="${pane.id}"]`)!.click())
  expect(pane.hidden).toBe(false)
  await h.click('Fill New gradient')
  expect(h.scene().root[0].attrs.f).toBe('@gradient2')
  expect(h.state().past).toHaveLength(1)
})

it('keeps a gradient geometry draft when its colour panel closes', async () => {
  const h = panel(defs() + '\nR w=100 h=50 f=@mine')
  await h.click('Fill colour panel')
  const field = h.get('Fill gradient End X'), pane = field.closest('[role=tabpanel]')!
  await run(() => {
    ui!.container.querySelector<HTMLButtonElement>(`[aria-controls="${pane.id}"]`)!.click()
    field.focus()
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, '2')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await h.click('Fill colour panel')
  expect(h.scene().defs[0].attrs.x2).toBe(1)
  expect(h.state().past).toHaveLength(0)
  await h.click('Fill colour panel')
  expect(h.get('Fill gradient End X')).toBe(field)
  expect(field.value).toBe('2')
})

it('keeps shared gradient geometry expressions and reports dropped keys when changing kind', async () => {
  const h = panel('DEFS { GR id=mine units=bbox cx="=$centre" cy=0.3 r="=$radius" stops=[[0,#336699],[1,#ffffff]] }\nR w=100 h=50 f=@mine')
  await h.edit('Fill gradient kind', 'GC')
  expect(h.scene().defs[0].attrs.cx).toBe('=$centre')
  expect(h.scene().defs[0].attrs.cy).toBeCloseTo(0.3)
  expect(h.scene().defs[0].attrs.r).toBeUndefined()
  expect(h.text()).toContain('Dropped geometry: r')
})
it('reports that units changes keep the authored numbers', async () => {
  const h = panel(defs() + '\nR w=100 h=50 f=@mine')
  await h.edit('Fill gradient units', 'scene')
  expect(h.scene().defs[0].attrs.x2).toBe(1)
  expect(h.text()).toContain('Geometry values kept; their units are now scene')
  await h.edit('Fill gradient units', 'bbox')
  expect(h.text()).toContain('Geometry values kept; their units are now bbox')
})

it('creates a bbox GL from the current fill and theme text colour in one undo step', async () => {
  const h = panel('R w=100 h=50 f=#336699')
  await h.click('Fill New gradient')
  const d = h.scene().defs[0]
  expect(d.op).toBe('GL'); expect(d.attrs.units).toBe('bbox')
  expect(d.attrs.stops).toEqual([[0, '#336699'], [1, h.theme.colors.text]])
  expect(h.scene().root[0].attrs.f).toBe('@' + first(d, 'ID'))
  expect(h.state().past).toHaveLength(1)
  await h.click('Fill Add stop')
  expect(h.scene().defs[0].attrs.stops).toEqual([[0, '#336699'], [1, h.theme.colors.text], [0.5, '#336699']])
  expect(h.state().past).toHaveLength(2)
})
it.each(['GL', 'GR', 'GC'])('creates and edits %s geometry, units and applicable spread without the code pane', async kind => {
  const h = panel('R w=100 h=50 f=#336699 s=#123456')
  await h.edit('Stroke gradient kind', kind); await h.click('Stroke New gradient')
  expect(h.scene().defs[0].op).toBe(kind)
  const key = kind === 'GL' ? 'x2' : kind === 'GR' ? 'r' : 'a'
  await h.edit(`Stroke gradient ${{ x2: 'End X', r: 'Radius', a: 'Start angle' }[key]}`, '0.75')
  expect(h.scene().defs[0].attrs[key]).toBe(0.75)
  await h.edit('Stroke gradient units', 'scene'); expect(h.scene().defs[0].attrs.units).toBeUndefined()
  if (kind !== 'GC') { await h.edit('Stroke gradient spread', 'reflect'); expect(h.scene().defs[0].attrs.spread).toBe('reflect') }
  expect(h.state().past).toHaveLength(kind === 'GC' ? 3 : 4)
  if (kind === 'GL') coreFixture(h.scene())
}, 30000)
it('edits literal stop colours, supports equal positions and moves/removes rows', async () => {
  const h = panel(defs() + '\nR w=100 h=50 f=@mine')
  await h.edit('Fill Stop 2 position', '0'); await h.edit('Fill Stop 2 colour', '#123456')
  await h.click('Fill Stop 2 up')
  expect(h.scene().defs[0].attrs.stops).toEqual([[0, '#123456'], [0, '#336699']])
  await h.click('Fill Stop 1 down'); await h.click('Fill Stop 2 remove')
  expect(h.scene().defs[0].attrs.stops).toEqual([[0, '#336699']]); expect(h.state().past).toHaveLength(5)
})
it('names shared users and Make independent leaves the other node and original def untouched', async () => {
  const h = panel(defs() + '\nR w=100 h=50 f=@mine\nR x=120 w=100 h=50 f=@mine')
  expect(h.text()).toContain('2 nodes use this gradient')
  const d = h.scene().defs[0]
  await h.click('Fill Make independent')
  expect(h.scene().defs).toHaveLength(2); expect(h.scene().defs[0]).toBe(d)
  expect(h.scene().root[1].attrs.f).toBe('@mine'); expect(h.scene().root[0].attrs.f).not.toBe('@mine')
  expect(h.state().past).toHaveLength(1)
})
it('clones theme defs on their first edit, clearing only this key’s style link', async () => {
  const h = panel(defs('theme_row') + '\n# style {"f":{"gradient":"row"},"s":{"role":"border"}}\nR w=100 h=50 f=@theme_row s=#5A5A69')
  const d = h.scene().defs[0]
  await h.edit('Fill gradient End X', '0.75')
  expect(h.scene().defs[0]).toBe(d); expect(h.scene().defs[1].attrs.x2).toBe(0.75)
  expect(h.scene().root[0].attrs.f).not.toBe('@theme_row')
  expect(h.scene().root[0].comments?.join(' ')).not.toContain('"gradient":"row"')
  expect(h.scene().root[0].comments?.join(' ')).toContain('"role":"border"')
  expect(h.state().past).toHaveLength(1)
})
it('does not replace a paint expression by New gradient', async () => {
  const h = panel('R w=100 h=50 f="=if(1,#336699,#ffffff)"')
  expect((h.get('Fill New gradient') as unknown as HTMLButtonElement).disabled).toBe(true)
  expect(h.state().past).toHaveLength(0)
})
it('keeps a bound stop colour during position, geometry and stop-order edits', async () => {
  const h = panel('DEFS { GL id=mine units=bbox stops=[[0,$colour],[1,#ffffff]] }\nR w=100 h=50 f=@mine')
  await h.edit('Fill Stop 1 position', '0.25')
  await h.edit('Fill gradient End X', '0.75')
  await h.click('Fill Stop 1 down')
  expect(h.scene().defs[0].attrs.stops).toEqual([[1, '#ffffff'], [0.25, '$colour']])
  expect(h.state().past).toHaveLength(3)
})
it('protects a selected theme def from in-place catalogue edits and directs the author to a referencing shape', async () => {
  const h = panel(defs('theme_row') + '\nR w=100 h=50 f=@theme_row', true), d = h.scene().defs[0]
  await h.edit('End X', '0.75')
  expect(h.scene().defs[0]).toBe(d); expect(h.state().past).toHaveLength(0)
  expect(h.text()).toContain('Select a shape that uses this theme gradient')
})
it('repoints a shape inside a symbol def when creating its gradient', async () => {
  const h = panel('DEFS { SYM id=icon { R w=100 h=50 f=#336699 } }\nUSE ref=icon', true, [0, 0])
  await h.click('Fill New gradient')
  expect(h.scene().defs[0].c![0].attrs.f).toBe('@' + first(h.scene().defs[1], 'ID'))
  expect(h.state().past).toHaveLength(1)
})
