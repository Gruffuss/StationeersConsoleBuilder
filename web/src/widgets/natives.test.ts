import { describe, expect, it } from 'vitest'
import { generate } from '../codegen/generate'
import { newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { printSrc } from '../srctext/print'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { allocUid, expandRoot, nativeAt, NO_CTX, putWidget, sanitize, takenUids, widgetOf } from './core'
import { WIDGETS } from './registry'
import { instance } from './testing'

const project = () => {
  const p = newProject()
  p.theme = 'vanilla-plus'
  p.pages[0] = { ...p.pages[0], scene: { header: { w: 480, h: 480, fit: 'contain' }, defs: [], root: [] } }
  return p
}

describe('Item / gas icon and Text input', () => {
  it('takes a new icon box from the theme metric and retains explicit saved dimensions', () => {
    const m = WIDGETS.icon, themed = { ...t, metrics: { ...t.metrics, 'icon.size': 99 } }
    expect(m.defaults(themed, NO_CTX)).toMatchObject({ w: 99, h: 99, name: 'Oxygen' })
    expect(sanitize(m, { w: 80, h: 70 }, themed)).toMatchObject({ w: 80, h: 70, name: 'Oxygen' })
  })
  it('declare one native each, with no src nodes and no slots', () => {
    expect(expandRoot(instance('icon'), t).exp).toEqual({ nodes: [], slots: [], parts: Object.create(null), natives: [{ type: 'icon', box: { x: 24, y: 24, w: 66, h: 66 },
      props: { icon_type: 'gas', name: 'Oxygen', z_index: 6 }, style: {} }] })
    expect(expandRoot(instance('textinput'), t).exp.natives).toEqual([{ type: 'textinput', box: { x: 24, y: 24, w: 300, h: 54 },
      props: { value: '', placeholder: 'Text', z_index: 22 }, style: { bg: '#111116', text: '#FFFFFF', placeholder_color: '#A6A6B4' }, fontSize: 26 }])
    expect(widgetOf({ op: 'G', attrs: { id: 'ico1' }, c: [], comments: ['widget icon ico1 {}'] }, t)).toBeNull()
  })
})

it('exports slot icons with their chosen name and kind', () => {
  expect(expandRoot(instance('icon', { kind: 'slot', name: 'Chip' }), t).exp.natives?.[0].props)
    .toMatchObject({ icon_type: 'slot', name: 'Chip' })
})

it('repairs each legacy gas icon on load, names it in the notice, and keeps other chosen names', () => {
  const p = project(), old = ['O2', 'N2', 'CH4', 'X'], names = ['Oxygen', 'Nitrogen', 'Methane', 'Pollutant']
  p.pages[0].natives = [...old.map((name, i) => ({ ...instance('icon', { kind: 'gas', name }), uid: `ico${i + 1}` })),
    { ...instance('icon', { kind: 'prefab', name: 'O2' }), uid: 'ico5' },
    { ...instance('icon', { kind: 'slot', name: 'X' }), uid: 'ico6' },
    { ...instance('icon', { name: 'CustomGas' }), uid: 'ico7' }]
  const loaded = reducer(initialState(), { type: 'loadProject', project: p })
  expect(loaded.project.pages[0].natives?.map(n => n.params.name)).toEqual([...names, 'O2', 'X', 'CustomGas'])
  old.forEach((name, i) => {
    expect(loaded.notice).toContain(`ico${i + 1}`)
    expect(loaded.notice).toContain(`${name} -> ${names[i]}`)
  })
  expect(loaded.notice).not.toContain('ico5')
  expect(sanitize(WIDGETS.icon, { kind: 'gas', name: 'O2' }, t).name).toBe('O2')
})

describe('natives in the store', () => {
  it('insert into Page.natives, selected by uid; set, delete and undo; uids count across scene ids and natives', () => {
    const s = reducer(initialState(project()), { type: 'insertWidget', pageId: 'p1', widget: 'icon' })
    expect(s.project.pages[0].natives).toEqual([{ type: 'icon', uid: 'ico1', params: { x: 207, y: 207, w: 66, h: 66, kind: 'gas', name: 'Oxygen' } }])
    expect(s.selection).toEqual({ pageId: 'p1', path: [], native: 'ico1' })
    expect(allocUid(s.project, 'ico')).toBe('ico2')
    expect(takenUids(s.project, 'p1').has('ico1')).toBe(true)   // a scene pasted on its own page cannot take a native's uid
    const moved = reducer(s, { type: 'setWidget', pageId: 'p1', ref: { type: 'icon', uid: 'ico1', params: { ...s.project.pages[0].natives![0].params, x: 10 } } })
    expect(nativeAt(moved.project.pages[0], 'ico1', t)?.params.x).toBe(10)
    // the same params again: no change, no history entry
    expect(reducer(moved, { type: 'setWidget', pageId: 'p1', ref: { type: 'icon', uid: 'ico1', params: { ...moved.project.pages[0].natives![0].params } } })).toBe(moved)
    const gone = reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'ico1' })
    expect(gone.project.pages[0].natives).toEqual([])
    expect(gone.selection).toBeNull()
    expect(reducer(gone, { type: 'undo' }).project).toBe(s.project)
  })
  it('selects one native after another (the selection compares the native too)', () => {
    let s = reducer(initialState(project()), { type: 'insertWidget', pageId: 'p1', widget: 'icon' })
    s = reducer(s, { type: 'insertWidget', pageId: 'p1', widget: 'textinput' })
    s = reducer(s, { type: 'select', selection: { pageId: 'p1', path: [], native: 'ico1' } })
    expect(s.selection).toEqual({ pageId: 'p1', path: [], native: 'ico1' })
    expect(reducer(s, { type: 'select', selection: { pageId: 'p1', path: [], native: 'ti1' } }).selection).toEqual({ pageId: 'p1', path: [], native: 'ti1' })
  })
  it('load only known native types with a valid uid, once each, their params sanitized', () => {
    const p = project()
    const natives = [{ type: 'icon', uid: 'ico1', params: { x: 'a', name: 'N2' } }, { type: 'bar', uid: 'bar1', params: {} }, { type: 'icon', uid: 'x_1', params: {} }, 7,
      { type: 'textinput', uid: 'ico1', params: {} }]
    const s = reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], natives: natives as never }] } })
    expect(s.project.pages[0].natives).toEqual([{ type: 'icon', uid: 'ico1', params: { x: 24, y: 24, w: 66, h: 66, kind: 'gas', name: 'Nitrogen' } }])
    expect(s.notice).toBe('Repaired project fields: page p1 natives; not loaded: 4 native widgets of an unknown type, with an invalid uid, or with a uid another widget holds; page p1 icon ico1: N2 -> Nitrogen')
  })
  it('load a native uid once across the project and never a scene widget’s (Q14)', () => {
    const p = project(), scene = putWidget(p.pages[0].scene, instance('light'), t)
    const s = reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [
      { ...p.pages[0], scene, natives: [{ ...instance('icon'), uid: 'lt1' }, instance('icon')] },
      { ...p.pages[0], id: 'p2', natives: [instance('icon'), instance('textinput')] }] } })
    expect(s.project.pages.map(pg => pg.natives?.map(n => n.uid))).toEqual([['ico1'], ['ti1']])
    expect(s.notice).toBe('Repaired project fields: page p1 natives, page p2 natives; not loaded: 2 native widgets of an unknown type, with an invalid uid, or with a uid another widget holds')
    const gone = reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'lt1' })   // the scene widget, not a native
    expect([gone.project.pages[0].scene.root.length, gone.project.pages[0].natives?.length]).toEqual([0, 1])
    expect(reducer(initialState(), { type: 'loadProject', project: p }).notice).toBe('')
  })
  it('load from a malformed outside project: a page with no usable scene, or a root entry that is no node, seeds no uid', () => {
    const p = project(), scene = putWidget(p.pages[0].scene, instance('light'), t), page = p.pages[0]
    const odd = [undefined, null, 7, {}, { root: 'x' }, { root: [null, 7, 'G', {}, { op: 'G' }, { op: 7, attrs: {} }, { op: 'G', attrs: null }] }]
    const pages = [...odd.map((x, i) => ({ ...page, id: `q${i}`, scene: x as never, natives: [{ ...instance('icon'), uid: `ico${i + 2}` }] })),
      { ...page, scene, natives: [{ ...instance('icon'), uid: 'lt1' }, instance('icon')] }]
    const s = reducer(initialState(), { type: 'loadProject', project: { ...p, pages } })
    expect(s.project.pages.map(pg => pg.natives?.map(n => n.uid))).toEqual([...odd.map((_, i) => [`ico${i + 2}`]), ['ico1']])
    expect(s.notice).toBe('Repaired project fields: page p1 natives; not loaded: 1 native widget of an unknown type, with an invalid uid, or with a uid another widget holds')
  })
})

describe('natives in the export', () => {
  it('follow the page data and keep their design boxes, props, styles and font', () => {
    const p = project()
    p.pages[0] = { ...p.pages[0], natives: [instance('icon'), instance('textinput')] }
    const { lua } = generate(p, pg => printSrc(pg.scene))
    expect(lua.indexOf('samples = {')).toBeLessThan(lua.indexOf('uid = "ico1"'))
    expect(lua).toContain('uid = "ico1", type = "icon", x = 24, y = 24, w = 66, h = 66, props = { ["icon_type"] = "gas", ["name"] = "Oxygen", ["z_index"] = 6 }, style = {  }')
    expect(lua).toContain('uid = "ti1", type = "textinput", x = 24, y = 24, w = 300, h = 54, props = { ["value"] = "", ["placeholder"] = "Text", ["z_index"] = 22 }, style = { ["bg"] = "#111116", ["text"] = "#FFFFFF", ["placeholder_color"] = "#A6A6B4" }, font = 26')
    expect(lua).toContain('dw = 480, dh = 480, fit = "contain"')
    expect(lua).toContain('empty = true')
  })
  it('map the design box by the header’s fit, as the vector element does', () => {
    const p = project(), at = (fit?: string) => {
      p.pages[0] = { ...p.pages[0], scene: { ...p.pages[0].scene, header: { w: 480, h: 240, ...(fit && { fit }) } }, natives: [instance('icon')] }
      return generate(p, pg => printSrc(pg.scene)).lua
    }
    expect(at('cover')).toContain('dw = 480, dh = 240, fit = "cover"')
    expect(at()).toContain('dw = 480, dh = 240, fit = "stretch"')
  })
})


it('Text input has a neutral placeholder', () => {
  expect(instance('textinput').params.placeholder).toBe('Text')
})
