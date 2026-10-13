import { describe, expect, it, vi } from 'vitest'
import type { Scene, SrcNode, Value } from './scene'
import { initialState, nodeAt, reducer, replaceAt, selected, type Action, type Entry, type State } from './store'
import { newPage, newProject, VECTOR_FLOOR, type Page, type Project } from './project'
import type { ShapeKind } from './shapes'
import type { Json, Params } from '../widgets/types'
import { newLogic } from './logic'
import { node } from './testing'
import { parseSrc } from '../srctext/parse'
import { printChecked } from '../srctext/print'
import { problemsOf } from '../srctext/testing'
import { groundOf, THEMES, themeOf } from '../theme'
import { vanillaPlus } from '../theme/vanillaPlus'
import { expandRoot, putWidget, sanitize, takenUids, widgetAt, widgetOf } from '../widgets/core'
import { resetPart } from '../widgets/edits'
import { WIDGETS } from '../widgets/registry'
import { gradientDef } from '../widgets/paint'
import { bracket, clipProbe, instance } from '../widgets/testing'
import { neutral } from '../theme/neutral'
import { linked, linksOf } from '../theme/links'
import { layoutOf, reflow, withLayout, type LayoutRecord } from '../editing/layoutRecords'
import { imported } from '../theme/testing'
import { themeFileOf } from '../theme/file'

describe('imported project themes', () => {
  it('adds and switches in one undo step, preserving part overrides', () => {
    let before = initialState()
    for (const widget of ['panel', 'button']) before = reducer(before, { type: 'insertWidget', pageId: 'p1', widget })
    const panel = widgetAt(before.project.pages[0].scene, [0], themeOf(before.project))!
    before = reducer(before, { type: 'setWidget', pageId: 'p1', ref: { ...panel, edit: { v: 1, parts: { body: { attrs: { f: '#AA0000' } } } } } })
    const after = reducer(before, { type: 'addTheme', theme: imported })
    expect(themeOf(after.project)).toEqual(imported)
    expect(after.project.themes).toEqual({ [imported.id]: imported })
    expect(after.past).toHaveLength(before.past.length + 1)
    expect(widgetAt(after.project.pages[0].scene, [0], imported)!.edit).toEqual(panel.edit ?? { v: 1, parts: { body: { attrs: { f: '#AA0000' } } } })
    expect(printChecked(after.project.pages[0].scene)).toContain('#AA0000')
    const undo = reducer(after, { type: 'undo' })
    expect(undo.project).toBe(before.project)
    expect(reducer(undo, { type: 'redo' }).project).toBe(after.project)
  })

  it('replaces the current imported theme and re-expands its artwork', () => {
    let s = reducer(initialState(), { type: 'insertWidget', pageId: 'p1', widget: 'panel' })
    s = reducer(s, { type: 'addTheme', theme: imported })
    const changed = { ...imported, colors: { ...imported.colors, 'surface-panel': '#ABCDEF' } }
    const after = reducer(s, { type: 'addTheme', theme: changed, use: false })
    expect(printChecked(after.project.pages[0].scene)).toContain('#ABCDEF')
    expect(after.past).toHaveLength(s.past.length + 1)
    expect(reducer(after, { type: 'undo' }).project).toBe(s.project)
  })

  it('reads outside project themes before choosing their look', () => {
    const p = JSON.parse(JSON.stringify(newProject()))
    const hostile = JSON.parse(JSON.stringify(themeFileOf(imported)))
    hostile.theme.colors.__proto__ = { polluted: true }
    Object.defineProperty(hostile.theme.colors, '__proto__', { value: { polluted: true }, enumerable: true })
    hostile.theme.geo.floor = 1e39
    p.theme = imported.id
    p.themes = { [imported.id]: hostile, neutral: themeFileOf(imported), broken: null }
    const s = reducer(initialState(), { type: 'loadProject', project: p })
    expect(themeOf(s.project).id).toBe(imported.id)
    expect(themeOf(s.project).geo.floor).toBe(THEMES.neutral.geo.floor)
    expect(s.project.themes!.neutral).toBeUndefined()
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    for (const path of ['__proto__', 'geo.floor', 'neutral', 'broken']) expect(s.notice).toContain(path)
  })

  it('keeps the existing fallback for an unknown id', () => {
    const s = reducer(initialState(), { type: 'loadProject', project: { ...newProject(), theme: 'ds-missing', themes: { [imported.id]: imported } } })
    expect(themeOf(s.project)).toBe(THEMES.neutral)
    expect(s.notice).toContain('unknown theme "ds-missing": using Neutral')
    expect(s.project.themes![imported.id].colors).toEqual(imported.colors)
    expect(Object.getPrototypeOf(s.project.themes)).toBe(null)
  })

  it('keeps every valid stored key, whatever invalid key comes before it', () => {
    const file = (name: string) => JSON.parse(JSON.stringify(themeFileOf({ ...imported, name })))
    const p = JSON.parse(JSON.stringify(newProject()))
    p.theme = 'ds-a'
    p.themes = { 'Not an id': file('a'), 'ds-a': file('Valid A'), 'also bad': file('b'), 'ds-b': null }
    const s = reducer(initialState(), { type: 'loadProject', project: p })
    expect(themeOf(s.project).name).toBe('Valid A')
    expect(s.project.themes!['ds-a'].name).toBe('Valid A')
    const others = Object.values(s.project.themes!).filter(t => t.name !== 'Valid A')
    expect(others.map(t => t.name)).toEqual(['a', 'b'])
    // A valid key whose theme could not be read keeps its id from an invalid key's theme too.
    expect(others.map(t => t.id)).not.toContain('ds-a')
    expect(others.map(t => t.id)).not.toContain('ds-b')
    expect(s.notice).toContain('themes.Not an id.theme.id: replaced with')
  })

  it('refuses removal of the current theme and removes another in one step', () => {
    const other = { ...imported, id: 'ds-other', name: 'Other' }
    const active = reducer(initialState(), { type: 'addTheme', theme: imported })
    const both = reducer(active, { type: 'addTheme', theme: other, use: false })
    const refused = reducer(both, { type: 'removeTheme', id: imported.id })
    expect(refused.project).toBe(both.project)
    expect(refused.past).toBe(both.past)
    expect(refused.notice).toBe(`cannot remove ${imported.name}: it is the current theme; choose another theme first`)
    const removed = reducer(both, { type: 'removeTheme', id: other.id })
    expect(removed.project.themes).toEqual({ [imported.id]: imported })
    expect(reducer(removed, { type: 'undo' }).project).toBe(both.project)
  })

  it('new widgets take theme defaults without changing Neutral defaults', () => {
    let s = reducer(initialState(), { type: 'addTheme', theme: imported })
    s = reducer(s, { type: 'insertWidget', pageId: 'p1', widget: 'button' })
    expect(widgetAt(s.project.pages[0].scene, [0], imported)!.params.states).toEqual(imported.widgetDefaults!.button.states)
    const normal = reducer(initialState(), { type: 'insertWidget', pageId: 'p1', widget: 'button' })
    expect(widgetAt(normal.project.pages[0].scene, [0], THEMES.neutral)!.params.states).toEqual([{ label: 'Button', variant: 'secondary', key: 0 }])
  })
})

it.each(['setWidget', 'setScene'] as const)('keeps a dormant duct binding and preview across period zero through %s', type => {
  const p = newProject(), t = themeOf(p), w = instance('duct', { period: 2 }, 'duct1')
  p.pages[0].scene = putWidget(p.pages[0].scene, w, t)
  p.bindings.duct1_run = { from: 'const', value: 1 }
  p.pages[0].preview = { duct1_run: 0 }
  let s = initialState(p)
  for (const period of [0, 2]) {
    const ref = { ...widgetAt(s.project.pages[0].scene, [0], t)!, params: { ...w.params, period } }
    s = reducer(s, type === 'setWidget' ? { type, pageId: 'p1', ref }
      : { type, pageId: 'p1', scene: putWidget(s.project.pages[0].scene, ref, t) })
    expect(s.project.bindings).toEqual(p.bindings)
    expect(s.project.pages[0].preview).toEqual(p.pages[0].preview)
  }
  s = reducer(s, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, period: 0 } } })
  const deleted = reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'duct1' })
  expect(deleted.project.bindings).toEqual({})
  expect(deleted.project.pages[0].preview).toEqual({})
})

it('keeps a Gauge state binding and preview across shrinking and toggling state', () => {
  const p = newProject(); p.theme = 'vanilla-plus'
  const w = instance('gauge'), t = themeOf(p)
  p.pages[0].scene = putWidget(p.pages[0].scene, w, t)
  p.bindings.gauge1_st = { from: 'const', value: 2 }; p.pages[0].preview = { gauge1_st: 3 }
  let s = initialState(p)
  for (const params of [{ w: 12 }, { w: 300 }, { state: false }, { state: true }] as Params[]) {
    const was = widgetAt(s.project.pages[0].scene, [0], t)!
    s = reducer(s, { type: 'setWidget', pageId: 'p1', ref: { ...was, params: { ...was.params, ...params } } })
    expect(s.project.bindings).toEqual(p.bindings)
    expect(s.project.pages[0].preview).toEqual(p.pages[0].preview)
  }
})

describe('live group layout', () => {
  const layout: LayoutRecord = { dir: 'row', pad: [4, 8, 4, 8], gap: 6, align: 'start', justify: 'start', size: 'hug', box: [0, 0, 100, 60] }
  const start = () => {
    const p = newProject(); p.theme = 'vanilla-plus'
    p.pages[0].scene = reflow({ header: { w: 460, h: 460 }, defs: [], root: [withLayout(node('G', { id: 'row' }, [
      node('R', { id: 'a', w: 10, h: 10 }), node('R', { id: 'b', w: 10, h: 10 }),
    ]), layout)] }, [0], vanillaPlus).scene
    return initialState(p)
  }
  it.each(['updateNode', 'editScene'] as const)('reflows a child resize after %s in the same undo step', type => {
    const before = start(), page = before.project.pages[0], child = nodeAt(page.scene.root, [0, 0])!
    const made = { ...child, attrs: { ...child.attrs, w: 30 } }, root = replaceAt(page.scene.root, [0, 0], made)!
    const after = reducer(before, type === 'updateNode' ? { type, pageId: 'p1', path: [0, 0], node: made } : { type, pageId: 'p1', scene: { ...page.scene, root } })
    expect(nodeAt(after.project.pages[0].scene.root, [0, 1])!.attrs.x).toBe(44)
    expect(layoutOf(after.project.pages[0].scene.root[0])!.box).toEqual([0, 0, 62, 18])
    expect(after.past).toHaveLength(1); expect(reducer(after, { type: 'undo' }).project).toEqual(before.project)
  })
  it('keeps code-pane positions as typed, then reapplies the record on the next editor edit', () => {
    const before = start(), original = before.project.pages[0].scene
    const text = printChecked(original).replace('x=8', 'x=91'), typed = parseSrc(text).scene!
    const code = reducer(before, { type: 'setScene', pageId: 'p1', scene: typed })
    expect(nodeAt(code.project.pages[0].scene.root, [0, 0])!.attrs.x).toBe(91)
    const child = nodeAt(typed.root, [0, 1])!
    const edited = reducer(code, { type: 'updateNode', pageId: 'p1', path: [0, 1], node: { ...child, attrs: { ...child.attrs, w: 20 } } })
    expect(nodeAt(edited.project.pages[0].scene.root, [0, 0])!.attrs.x).toBe(8)
    expect(layoutOf(edited.project.pages[0].scene.root[0])!.box[2]).toBe(52)
  })
  it('reflows inserts, reorders and deletes, but removing layout keeps positions', () => {
    const before = start(), s = before.project.pages[0].scene, g = s.root[0], c = [...g.c!].reverse()
    c.push(node('R', { id: 'c', w: 20, h: 10 }))
    let after = reducer(before, { type: 'updateNode', pageId: 'p1', path: [0], node: { ...g, c } })
    expect(after.project.pages[0].scene.root[0].c!.map(n => [n.attrs.id, n.attrs.x])).toEqual([['b', 8], ['a', 24], ['c', 40]])
    const current = after.project.pages[0].scene.root[0]
    after = reducer(after, { type: 'updateNode', pageId: 'p1', path: [0], node: { ...current, c: current.c!.slice(1) } })
    expect(after.project.pages[0].scene.root[0].c!.map(n => n.attrs.x)).toEqual([8, 24])
    const placed = after.project.pages[0].scene.root[0]
    after = reducer(after, { type: 'updateNode', pageId: 'p1', path: [0], node: withLayout(placed, null) })
    expect(after.project.pages[0].scene.root[0].c).toEqual(placed.c)
  })
  it('restores in-flow drag positions and says to reorder in Layers, without an empty undo step', () => {
    const before = start(), child = nodeAt(before.project.pages[0].scene.root, [0, 0])!
    const during = reducer(before, { type: 'updateNode', pageId: 'p1', path: [0, 0], node: { ...child, attrs: { ...child.attrs, x: 99 } }, transient: true })
    expect(nodeAt(during.project.pages[0].scene.root, [0, 0])!.attrs.x).toBe(8)
    expect(during.notice).toContain('reorder'); expect(during.notice).toContain('layers')
    const after = reducer(during, { type: 'commitDrag' })
    expect(after.past).toHaveLength(0); expect(after.project).toEqual(before.project)
    expect(after.notice).toContain('reorder')
  })
  it('reflows widget params, insertion and deletion inside an entered layout group', () => {
    const before = start()
    let s = reducer(before, { type: 'enter', pageId: 'p1', path: [0] })
    s = reducer(s, { type: 'insertWidget', pageId: 'p1', widget: 'button' })
    const w = widgetAt(s.project.pages[0].scene, [0, 2], vanillaPlus)!
    expect(w.params.x).toBe(40)
    s = reducer(s, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, w: 300 } } })
    expect(layoutOf(s.project.pages[0].scene.root[0])!.box[2]).toBe(348)
    s = reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: w.uid })
    expect(layoutOf(s.project.pages[0].scene.root[0])!.box[2]).toBe(42)
  })
  it('flows nested hug layouts from the inside out, counting their padding', () => {
    const p = newProject(), inner = withLayout(node('G', {}, [node('R', { w: 10, h: 10 })]), { ...layout, pad: [5, 5, 5, 5] })
    const outer = withLayout(node('G', {}, [inner, node('R', { id: 'other', w: 10, h: 10 })]), layout)
    p.pages[0].scene = { header: { w: 460, h: 460 }, defs: [], root: [outer] }
    const after = reducer(initialState(p), { type: 'updateNode', pageId: 'p1', path: [0, 0, 0], node: node('R', { w: 30, h: 10 }) })
    expect(layoutOf(after.project.pages[0].scene.root[0])!.box[2]).toBe(72)
    expect(nodeAt(after.project.pages[0].scene.root, [0, 1])!.attrs.x).toBe(54)
  })
  it('walks deep layout ancestors without recursion or an arbitrary limit', () => {
    const p = newProject(); p.theme = 'vanilla-plus'
    let root = withLayout(node('G', {}, [node('R', { w: 10, h: 10 })]), layout)
    for (let i = 0; i < 10000; i++) root = node('G', {}, [root])
    p.pages[0].scene = { header: { w: 460, h: 460 }, defs: [], root: [root] }
    const path = Array(10002).fill(0)
    const after = reducer(initialState(p), { type: 'updateNode', pageId: 'p1', path, node: node('R', { w: 30, h: 10 }) })
    expect(layoutOf(nodeAt(after.project.pages[0].scene.root, path.slice(0, -1))!)!.box[2]).toBe(46)
    expect(after.past).toHaveLength(1)
  })
  it('reflows when a theme switch changes widget metrics, retaining comments and one undo step', () => {
    const p = newProject(), w = instance('readoutrow')
    const made = expandRoot({ ...w, params: sanitize(WIDGETS.readoutrow, { ...w.params, h: 1 }, THEMES.neutral) }, THEMES.neutral)
    const g = withLayout(node('G', {}, [made.root]), layout)
    p.pages[0].scene = reflow({ ...p.pages[0].scene, defs: made.defs, root: [g] }, [0], THEMES.neutral).scene
    const before = initialState(p), next = reducer(before, { type: 'setTheme', theme: 'vanilla-plus' })
    const child = widgetAt(next.project.pages[0].scene, [0, 0], vanillaPlus)!
    expect(layoutOf(next.project.pages[0].scene.root[0])!.box[3]).toBeCloseTo(Number(child.params.h) + 8, 3)
    expect(next.past).toHaveLength(1); expect(reducer(next, { type: 'undo' }).project).toEqual(before.project)
  })
})

describe('widget part edits in the store', () => {
  it('a part move through updateNode carries its ornaments and undo restores them', () => {
    THEMES[bracket.id] = bracket
    try {
      const p = newProject(); p.theme = bracket.id
      const w = instance('panel'), e = expandRoot(w, bracket)
      p.pages[0].scene = putWidget(p.pages[0].scene, w, bracket)
      const s = initialState(p), path = [0, ...e.exp.parts!.body], n = nodeAt(p.pages[0].scene.root, path)!
      const out = reducer(s, { type: 'updateNode', pageId: 'p1', path, node: { ...n, attrs: { ...n.attrs, x: Number(n.attrs.x)+4 } } })
      expect(out.notice).toBe('')
      const ref = widgetOf(out.project.pages[0].scene.root[0], bracket)!
      expect(ref.edit?.parts.body.dx).toBe(4)
      const mark = [0, ...e.exp.parts!['body~mark-tl']], points = nodeAt(p.pages[0].scene.root, mark)!.attrs.p as number[]
      expect(nodeAt(out.project.pages[0].scene.root, mark)!.attrs.p).toEqual(points.map((v, i) => v+(i % 2 === 0 ? 4 : 0)))
      expect(reducer(out, { type: 'undo' }).project).toEqual(s.project)
    } finally { delete THEMES[bracket.id] }
  })
  it('an ornament stays put', () => {
    THEMES[bracket.id] = bracket
    try {
      const p = newProject(); p.theme = bracket.id
      const w = instance('panel', { x: 24, y: 24, w: 440, h: 300 }), e = expandRoot(w, bracket)
      p.pages[0].scene = putWidget(p.pages[0].scene, w, bracket)
      const s = initialState(p), path = [0, ...e.exp.parts!['body~mark-tl']], n = nodeAt(p.pages[0].scene.root, path)!
      const points = (n.attrs.p as number[]).map((v, i) => v + (i % 2 === 0 ? 5 : 0))
      const out = reducer(s, { type: 'updateNode', pageId: 'p1', path, node: { ...n, attrs: { ...n.attrs, p: points } } })
      expect(out).toEqual({ ...s, notice: "an ornament's place follows its part" })
    } finally { delete THEMES[bracket.id] }
  })
  it('refuses replacing or unmarking a widget root through updateNode', () => {
    const p = newProject(), scene = putWidget(p.pages[0].scene, instance('panel'), vanillaPlus)
    p.pages[0].scene = scene
    const s = initialState(p), root = scene.root[0]
    for (const node of [{ ...root, op: 'C' }, { ...root, comments: undefined }]) {
      const out = reducer(s, { type: 'updateNode', pageId: 'p1', path: [0], node })
      expect(out.project).toBe(s.project); expect(out.notice).toContain('Detach')
    }
  })
  it('native widgets remain parameter-only even with an edit payload', () => {
    const s = reducer(initialState(), { type: 'insertWidget', pageId: 'p1', widget: 'textinput' })
    const ref = s.project.pages[0].natives![0]
    const out = reducer(s, { type: 'setWidget', pageId: 'p1', ref: { ...ref, edit: { v: 1, parts: { body: { attrs: { f: '#123456' } } } } } })
    expect(out).toBe(s)
  })
  const start = () => {
    const p = newProject(); p.theme = 'vanilla-plus'
    p.pages[0].scene = putWidget({ header: {}, defs: [], root: [] }, instance('panel'), vanillaPlus)
    return initialState(p)
  }
  const body = (s: State) => {
    const scene = s.project.pages[0].scene, w = widgetOf(scene.root[0], themeOf(s.project))!
    const path = [0, ...expandRoot(w, themeOf(s.project)).exp.parts!.body]
    return { w, path, node: nodeAt(scene.root, path)! }
  }
  it('updateNode records overrides, themes and parameters preserve them, and undo restores them', () => {
    const s = start(), b = body(s)
    const edited = reducer(s, { type: 'updateNode', pageId: 'p1', path: b.path, node: { ...b.node, attrs: { ...b.node.attrs, f: '#123456', sh: [[1, 2, 3, 4, '#000']] } } })
    expect(body(edited).w.edit?.parts.body.attrs).toMatchObject({ f: '#123456' })
    const themed = reducer(edited, { type: 'setTheme', theme: 'neutral' })
    expect(body(themed).node.attrs.f).toBe('#123456')
    const moved = reducer(themed, { type: 'setWidget', pageId: 'p1', ref: { type: b.w.type, uid: b.w.uid, params: { ...b.w.params, w: 300 } } })
    expect(body(moved).w.edit).toEqual(body(edited).w.edit)
    expect(body(reducer(moved, { type: 'undo' })).w.edit).toEqual(body(edited).w.edit)
    const reset = reducer(moved, { type: 'setWidget', pageId: 'p1', ref: resetPart(body(moved).w, 'body') })
    expect(body(reset).w.edit).toBeUndefined()
    expect(body(reducer(reset, { type: 'undo' })).node.attrs.f).toBe('#123456')
    const load = reducer(reset, { type: 'loadProject', project: edited.project })
    expect(body(load).w.edit).toEqual(body(edited).w.edit)
  })
  it.each([['sw', 'abc'], ['f', 'zzz'], ['cap', 7], ['s', 5], ['dash', 'x']])('reports a dropped %s override on load and preserves the valid part edits', (key, bad) => {
    const s = start(), w = { ...body(s).w, edit: { v: 1 as const, parts: { body: { attrs: { fo: 0.5 }, dx: 2 } } } }
    const scene = putWidget(s.project.pages[0].scene, w, vanillaPlus)
    const root = scene.root[0], comments = [...root.comments!]
    comments[comments.length - 1] = `widget ${w.type} ${w.uid} ${JSON.stringify({ ...w.params, __edit: { ...w.edit, parts: { body: { attrs: { [key]: bad, fo: 0.5 }, dx: 2 } } } })}`
    const project = { ...s.project, pages: [{ ...s.project.pages[0], scene: { ...scene, root: [{ ...root, comments }] } }] }
    const loaded = reducer(s, { type: 'loadProject', project })
    expect(widgetOf(loaded.project.pages[0].scene.root[0], vanillaPlus)?.edit).toEqual(w.edit)
    expect(body(loaded).w.edit).toEqual(w.edit)
    expect(loaded.notice).toContain('override'); expect(loaded.notice).toContain(`body.${key}`)
    expect(body(loaded).node.attrs.fo).toBe(0.5)
    expect(printChecked(loaded.project.pages[0].scene)).not.toContain(`${JSON.stringify(key)}:${JSON.stringify(bad)}`)
  })
  it.each([['sw', 'abc'], ['f', 'zzz'], ['cap', 7], ['s', 5], ['dash', 'x']])('drops a malformed %s override already present in a saved drawing', (key, bad) => {
    const s = start(), w = { ...body(s).w, edit: { v: 1 as const, parts: { body: { attrs: { fo: 0.5 } } } } }
    const scene = putWidget(s.project.pages[0].scene, w, vanillaPlus), path = [0, ...expandRoot(w, vanillaPlus).exp.parts!.body]
    const part = nodeAt(scene.root, path)!, root = replaceAt(scene.root, path, { ...part, attrs: { ...part.attrs, [key]: bad as Value } })!
    root[0] = { ...root[0], comments: [`widget ${w.type} ${w.uid} ${JSON.stringify({ ...w.params, __edit: { v: 1, parts: { body: { attrs: { fo: 0.5, [key]: bad } } } } })}`] }
    const loaded = reducer(s, { type: 'loadProject', project: { ...s.project, pages: [{ ...s.project.pages[0], scene: { ...scene, root } }] } })
    expect(widgetOf(loaded.project.pages[0].scene.root[0], vanillaPlus)?.edit).toEqual(w.edit)
    expect(loaded.notice).toContain(`body.${key}`)
    expect(nodeAt(loaded.project.pages[0].scene.root, path)!.attrs).toEqual(nodeAt(scene.root, path)!.attrs)
  })
  it('refuses structural and untagged edits in both updateNode and editScene, including transient steps', () => {
    const s = start(), b = body(s)
    for (const transient of [false, true]) {
      const bad = reducer(s, { type: 'updateNode', pageId: 'p1', path: b.path, node: { ...b.node, op: 'C' }, transient })
      expect(bad.project).toBe(s.project); expect(bad.notice).toContain('Detach'); expect(bad.past).toEqual([])
      const scene = s.project.pages[0].scene
      const changed = { ...scene, root: replaceAt(scene.root, b.path, { ...b.node, attrs: { ...b.node.attrs, id: 'bad' } })! }
      const out = reducer(s, { type: 'editScene', pageId: 'p1', scene: changed, transient })
      expect(out.project).toBe(s.project); expect(out.notice).toContain('Detach')
    }
  })
  it('code-pane hand edits still detach, while a printed override round trip stays associated', () => {
    const s = start(), b = body(s), scene = s.project.pages[0].scene
    const edited = reducer(s, { type: 'updateNode', pageId: 'p1', path: b.path, node: { ...b.node, attrs: { ...b.node.attrs, f: '#123456' } } })
    const parsed = parseSrc(printChecked(edited.project.pages[0].scene)).scene!
    const round = reducer(edited, { type: 'setScene', pageId: 'p1', scene: parsed })
    expect(body(round).w.edit?.parts.body.attrs?.f).toBe('#123456')
    const hand = reducer(s, { type: 'setScene', pageId: 'p1', scene: { ...scene, root: replaceAt(scene.root, b.path, { ...b.node, attrs: { ...b.node.attrs, f: '#123456' } })! } })
    expect(widgetOf(hand.project.pages[0].scene.root[0], vanillaPlus)).toBeNull()
  })
})

it('setTheme reports severed links across pages together with missing tokens', () => {
  const p = newProject(), linkedShape = linked(node('R'), 'f', { role: 'accent' }, vanillaPlus)
  p.theme = 'vanilla-plus'
  const stale = { ...linkedShape, attrs: { f: '#123456' } }
  p.pages[0].scene = scene([stale, linked(node('R'), 'sh', { shadow: 'glowOk' }, vanillaPlus)])
  p.pages.push({ ...p.pages[0], id: 'p2', scene: scene([stale]) })
  const s = reducer(initialState(p), { type: 'setTheme', theme: 'neutral' })
  expect(s.notice).toContain('2 style links severed')
  expect(s.notice).toContain('missing theme style tokens: glowOk')
  expect(s.project.pages[0].scene.root[0].attrs.f).toBe('#123456')
  expect(linksOf(s.project.pages[0].scene.root[0])).toEqual({})
  expect(s.past).toHaveLength(1)
  expect(reducer(s, { type: 'undo' }).project).toEqual(p)
})

it('setTheme resolves raw links on every page in one undo step; hand edits and missing tokens survive', () => {
  const p = newProject(), shape = linked(node('R', { s: '#123456' }), 'f', { role: 'accent' }, vanillaPlus)
  p.theme = 'vanilla-plus'
  const glow = linked(node('R'), 'sh', { shadow: 'glowOk' }, vanillaPlus)
  p.pages[0].scene = scene([node('G', {}, [shape]), glow])
  p.pages.push({ ...p.pages[0], id: 'p2', scene: scene([shape]) })
  let s = reducer(initialState(p), { type: 'setTheme', theme: 'neutral' })
  expect(s.project.pages[0].scene.root[0].c![0].attrs).toEqual({ f: neutral.colors.accent, s: '#123456' })
  expect(s.project.pages[1].scene.root[0].attrs.f).toBe(neutral.colors.accent)
  expect(s.notice).toContain('glowOk')
  expect(linksOf(s.project.pages[0].scene.root[1])).toEqual({ sh: { shadow: 'glowOk' } })
  expect(s.past).toHaveLength(1)
  expect(reducer(s, { type: 'undo' }).project).toEqual(p)
  s = reducer(s, { type: 'updateNode', pageId: 'p2', path: [0], node: { ...shape, attrs: { f: '#ff0000', s: '#123456' } } })
  s = reducer(s, { type: 'setTheme', theme: 'vanilla-plus' })
  expect(s.project.pages[1].scene.root[0].attrs.f).toBe('#ff0000')
  expect(linksOf(s.project.pages[1].scene.root[0])).toEqual({})
  expect(linksOf(reducer(initialState(), { type: 'loadProject', project: p }).project.pages[1].scene.root[0])).toEqual(linksOf(shape))
})

const scene = (root: SrcNode[]): Scene => ({ header: { w: 100, h: 100 }, defs: [], root })
const run = (s: State, ...actions: Action[]) => actions.reduce(reducer, s)
const root = (s: State) => s.project.pages[0].scene.root
const set = (root: SrcNode[]): Action => ({ type: 'setScene', pageId: 'p1', scene: scene(root) })
const drag = (x: number): Action => ({ type: 'updateNode', pageId: 'p1', path: [0], node: node('R', { x }), transient: true })
const held = (h: Entry[]) => h.map(e => e.project)   // a history's projects

describe('the entered group is editor state', () => {
  const start = () => run(initialState(), set([node('G', {}, [node('G', {}, [node('R', { x: 0 })])])]))
  it('a code-pane replacement with no selection leaves invalid entry at root, including undo and redo', () => {
    const s = run(start(), { type: 'enter', pageId: 'p1', path: [0] })
    const changed = run(s, set([node('R')]))
    expect(changed).toMatchObject({ entered: null, selection: null })
    const undone = run(changed, { type: 'undo' })
    expect(root(undone)[0].op).toBe('G')
    expect(undone.entered).toBeNull()
    expect(run(undone, { type: 'redo' }).entered).toBeNull()
  })
  it.each(['setScene', 'updateNode', 'editScene', 'transient updateNode', 'transient editScene'] as const)('%s falls back to the deepest enterable ancestor', kind => {
    const s = run(start(), { type: 'enter', pageId: 'p1', path: [0, 0] })
    const replacement = node('R'), changedScene = scene([node('G', {}, [replacement])])
    const action: Action = kind === 'setScene' ? set(changedScene.root)
      : kind.includes('updateNode') ? { type: 'updateNode', pageId: 'p1', path: [0, 0], node: replacement, transient: kind.startsWith('transient') }
      : { type: 'editScene', pageId: 'p1', scene: changedScene, transient: kind.startsWith('transient') }
    const changed = run(s, action)
    expect(changed.entered).toEqual({ pageId: 'p1', path: [0] })
    expect(run(changed, { type: kind.startsWith('transient') ? 'cancelDrag' : 'undo' }).entered).toEqual({ pageId: 'p1', path: [0] })
  })
  it('undo and redo settle a deeper group entered after the edit', () => {
    const s = run(initialState(), set([node('G', {}, [node('R')])]), set([node('G', {}, [node('G', {}, [node('R')])])]),
      { type: 'enter', pageId: 'p1', path: [0, 0] })
    const undone = run(s, { type: 'undo' })
    expect(undone.entered).toEqual({ pageId: 'p1', path: [0] })
    expect(run(undone, { type: 'redo' }).entered).toEqual({ pageId: 'p1', path: [0] })
  })
  it('resizing and inserting native or scene widgets preserve recovered entry', () => {
    const s = run(start(), { type: 'enter', pageId: 'p1', path: [0, 0] }, set([node('G', {}, [node('R')])]))
    const expected = { pageId: 'p1', path: [0] }
    expect(s.entered).toEqual(expected)
    const resized = run(s, { type: 'setPageShape', pageId: 'p1', shape: '2x1' })
    expect(resized.entered).toEqual(expected)
    for (const widget of ['panel', 'icon']) {
      const inserted = run(resized, { type: 'insertWidget', pageId: 'p1', widget })
      expect(inserted.entered).toEqual(expected)
      expect(run(inserted, { type: 'undo' }).entered).toEqual(expected)
    }
  })
  it('enter clears the selection without history; an empty path leaves to the page root', () => {
    const s = run(start(), { type: 'select', selection: { pageId: 'p1', path: [0] } })
    const next = run(s, { type: 'enter', pageId: 'p1', path: [0] })
    expect(next).toMatchObject({ entered: { pageId: 'p1', path: [0] }, selection: null, also: [] })
    expect(next.past).toBe(s.past)
    expect(run(next, { type: 'enter', pageId: 'p1', path: [] }).entered).toBeNull()
  })
  it('undo after an edit inside the group keeps entered, while deleting it resets depth', () => {
    const s = run(start(), { type: 'enter', pageId: 'p1', path: [0] })
    const changed = run(s, { type: 'updateNode', pageId: 'p1', path: [0, 0, 0], node: node('R', { x: 5 }) })
    expect(run(changed, { type: 'undo' }).entered).toEqual({ pageId: 'p1', path: [0] })
    expect(run(changed, { type: 'editScene', pageId: 'p1', scene: scene([]) }).entered).toBeNull()
  })
  it('refuses invalid, hidden and locked paths and accepts widget roots', () => {
    for (const n of [node('R'), node('G', { v: 0 }, [node('R')]), { ...node('G', {}, [node('R')]), comments: ['lock'] }]) {
      const s = run(initialState(), set([n]))
      expect(run(s, { type: 'enter', pageId: 'p1', path: [0] }).entered).toBeNull()
    }
    const widget = run(initialState(), { type: 'insertWidget', pageId: 'p1', widget: 'panel' })
    expect(run(widget, { type: 'enter', pageId: 'p1', path: [0] }).entered).toEqual({ pageId: 'p1', path: [0] })
    expect(run(start(), { type: 'enter', pageId: 'p1', path: [99] }).entered).toBeNull()
  })
  it('page switches and project replacement reset depth', () => {
    const s = run(start(), { type: 'addPage' }, { type: 'setActivePage', pageId: 'p1' }, { type: 'enter', pageId: 'p1', path: [0] })
    expect(s.entered).toEqual({ pageId: 'p1', path: [0] })
    expect(run(s, { type: 'setActivePage', pageId: 'p2' }).entered).toBeNull()
    expect(run(s, { type: 'loadProject', project: s.project }).entered).toBeNull()
    expect(run(s, { type: 'addPage' }).entered).toBeNull()
  })
  it('a property edit that hides or replaces the entered group resets depth', () => {
    const s = run(start(), { type: 'enter', pageId: 'p1', path: [0] })
    expect(run(s, { type: 'updateNode', pageId: 'p1', path: [0], node: node('R') }).entered).toBeNull()
    expect(run(s, { type: 'updateNode', pageId: 'p1', path: [0], node: node('G', { v: 0 }, [node('R')]) }).entered).toBeNull()
  })
})

describe('nodeAt', () => {
  it('stops at a missing index or child list instead of restarting at the root', () => {
    const nodes = [node('R'), node('G', {}, [node('C')])]
    expect(nodeAt(nodes, [1, 0])).toBe(nodes[1].c![0])
    for (const path of [[], [99, 0], [99, 1], [1, 99, 0], [0, 0, 1]]) {
      expect(nodeAt(nodes, path), JSON.stringify(path)).toBeUndefined()
      expect(replaceAt(nodes, path, node('T'))).toBeUndefined()
    }
  })
})

describe('store history', () => {
  it('undoes a setScene and redoes it', () => {
    const s0 = initialState()
    const s1 = run(s0, set([node('R')]))
    expect(root(s1)).toEqual([node('R')])
    const undone = reducer(s1, { type: 'undo' })
    expect(undone.project).toBe(s0.project)
    expect(held(undone.future)).toEqual([s1.project])
    const redone = reducer(undone, { type: 'redo' })
    expect(redone.project).toBe(s1.project)
    expect(held(redone.past)).toEqual([s0.project])
    expect(redone.future).toEqual([])
  })

  it('makes one history entry of three transient updates and a commitDrag', () => {
    const s0 = run(initialState(), set([node('R', { x: 0 })]))
    const moved = run(s0, drag(1), drag(2), drag(3))
    expect(root(moved)[0].attrs.x).toBe(3)
    expect(moved.past).toEqual(s0.past)
    expect(moved.dragBase).toBe(s0.project)
    const done = reducer(moved, { type: 'commitDrag' })
    expect(done.project).toBe(moved.project)   // nothing to patch
    expect(held(done.past)).toEqual([...held(s0.past), s0.project])
    expect(done.dragBase).toBeNull()
    expect(root(reducer(done, { type: 'undo' }))[0].attrs.x).toBe(0)
  })

  it('restores the project on cancelDrag, with no history', () => {
    const s0 = run(initialState(), set([node('R', { x: 0 })]))
    const cancelled = run(s0, drag(1), drag(2), { type: 'cancelDrag' })
    expect(cancelled.project).toBe(s0.project)
    expect(cancelled.past).toEqual(s0.past)
    expect(cancelled.dragBase).toBeNull()
  })

  it('keeps the last 200 entries and clears redo on a new edit', () => {
    let s = initialState()
    const projects = [s.project]
    for (let k = 0; k < 205; k++) {
      s = reducer(s, set([node('R', { x: k })]))
      projects.push(s.project)
    }
    expect(s.past).toHaveLength(200)
    expect(s.past[0].project).toBe(projects[5])
    s = run(s, { type: 'undo' }, set([]))
    expect(s.future).toEqual([])
  })

  it('makes one history entry of a non-transient updateNode, which undo takes back', () => {
    const s0 = run(initialState(), set([node('R', { x: 0 })]))
    const s1 = reducer(s0, { type: 'updateNode', pageId: 'p1', path: [0], node: node('R', { x: 7 }) })
    expect(root(s1)[0].attrs.x).toBe(7)
    expect(held(s1.past)).toEqual([...held(s0.past), s0.project])
    expect(s1.dragBase).toBeNull()
    expect(root(reducer(s1, { type: 'undo' }))).toEqual([node('R', { x: 0 })])
  })

  it('leaves history alone on select and setActivePage', () => {
    const s0 = run(initialState(), { type: 'addPage' })
    const s1 = run(s0, { type: 'setActivePage', pageId: 'p1' }, { type: 'select', selection: { pageId: 'p1', path: [] } })
    expect(s1.past).toBe(s0.past)
    expect(s1.activePageId).toBe('p1')
  })
})

describe('store pages', () => {
  it('refuses to remove the last page', () => {
    const s0 = initialState()
    expect(reducer(s0, { type: 'removePage', pageId: 'p1' })).toBe(s0)
  })

  it('adds, renames and removes pages, each undoable, clearing a selection on the removed page', () => {
    const added = run(initialState(), { type: 'addPage' })
    expect(added.project.pages.map(p => [p.id, p.surface])).toEqual([['p1', 'main'], ['p2', 'page2']])
    expect(added.activePageId).toBe('p2')
    const renamed = reducer(added, { type: 'renamePage', pageId: 'p2', name: 'Tanks' })
    expect(renamed.project.pages[1].name).toBe('Tanks')
    expect(reducer(renamed, { type: 'undo' }).project.pages[1].name).not.toBe('Tanks')
    const selected = reducer(renamed, { type: 'select', selection: { pageId: 'p2', path: [0] } })
    const removed = reducer(selected, { type: 'removePage', pageId: 'p2' })
    expect(removed.project.pages.map(p => p.id)).toEqual(['p1'])
    expect(removed.activePageId).toBe('p1')
    expect(removed.selection).toBeNull()
    expect(reducer(removed, { type: 'undo' }).project.pages).toHaveLength(2)
  })

  it('returns the same state for a rename to the same name or of an unknown page', () => {
    const s0 = initialState()
    expect(reducer(s0, { type: 'renamePage', pageId: 'p1', name: s0.project.pages[0].name })).toBe(s0)
    expect(reducer(s0, { type: 'renamePage', pageId: 'nope', name: 'X' })).toBe(s0)
  })
})

describe('store loadProject', () => {
  it('clamps page sizes to whole px in 1..8192, so nothing else reaches the core, the shell or the canvas', () => {
    const p = newProject()
    p.pages[0].size = { w: 1e9, h: 300.6 }
    p.pages.push({ ...newPage(p), size: { w: NaN, h: -5 } })
    const loaded = run(initialState(), { type: 'loadProject', project: p })
    expect(loaded.project.pages.map(x => x.size)).toEqual([{ w: 8192, h: 301 }, { w: 460, h: 1 }])
  })
  it('drops the whole selection, the other members of the set too: their paths name nodes of the project before', () => {
    const two = { ...initialState(), selection: { pageId: 'p1', path: [1] }, also: [{ pageId: 'p1', path: [0] }] }
    const loaded = run(two, { type: 'loadProject', project: newProject() })
    expect([loaded.selection, loaded.also]).toEqual([null, []])
  })
  it('reads an older project\'s target as the floor (spec D15)', () => {
    const old = { ...newProject(), target: { vectorMod: '0.11.64' } } as unknown as Project
    expect(run(initialState(), { type: 'loadProject', project: old }).project.target).toEqual({ vectorMod: VECTOR_FLOOR })
  })
  it('defaults a missing theme, rejects malformed themes and normalizes unknown names', () => {
    expect(newProject().theme).toBe('neutral')
    const load = (theme: unknown) => run(initialState(), { type: 'loadProject', project: { ...newProject(), theme } as unknown as Project }).project.theme
    expect(load(undefined)).toBe('neutral')
    for (const t of [null, 5]) expect(() => load(t)).toThrow('Unreadable project theme')
    expect(load('neon')).toBe('neutral')
  })
  it('gives a page without a shape square when it is 460 × 460, else custom', () => {
    const p = newProject()
    const { shape: _, ...square } = p.pages[0]
    p.pages = [square as Page, { ...square, id: 'p2', surface: 'page2', size: { w: 800, h: 400 } } as Page]
    expect(run(initialState(), { type: 'loadProject', project: p }).project.pages.map(x => x.shape)).toEqual(['square', 'custom'])
  })
  it('gives a new page its theme\'s ground', () => {
    expect(newProject().pages[0].background).toEqual(groundOf(THEMES.neutral))
    expect(newPage({ ...newProject(), theme: 'unknown' }).background).toEqual(groundOf(THEMES.neutral))
  })
  it('keeps no background absent, normalizes an empty one to none, and keeps an assigned background', () => {
    const p = newProject()
    const { background: _, ...bare } = p.pages[0]
    p.pages = [bare as Page, { ...bare, id: 'p2', surface: 'page2', background: [] }, { ...bare, id: 'p3', surface: 'page3', background: ['#3A3A43', '#24242A'] }]
    expect(run(initialState(), { type: 'loadProject', project: p }).project.pages.map(x => x.background))
      .toEqual([undefined, undefined, ['#3A3A43', '#24242A']])
  })
  it("reads a shape whose px is not the page's size as custom, and keeps one that agrees", () => {
    const p = newProject()
    p.pages = [{ ...p.pages[0], shape: '2x1' }, { ...p.pages[0], id: 'p2', surface: 'page2', shape: '2x1', size: { w: 1036, h: 460 } },
      { ...p.pages[0], id: 'p3', surface: 'page3', shape: 'custom', size: { w: 460, h: 460 } }]
    const pages = run(initialState(), { type: 'loadProject', project: p }).project.pages
    expect(pages.map(x => [x.shape, x.size])).toEqual([['custom', { w: 460, h: 460 }], ['2x1', { w: 1036, h: 460 }], ['custom', { w: 460, h: 460 }]])
  })
  it('saves and loads a page of a MoreConsoles shape, a turned one too, and reads one at another size as custom', () => {
    const s = run(initialState(), { type: 'addPage' }, { type: 'addPage' }, { type: 'setPageShape', pageId: 'p1', shape: '3x2-rugged' },
      { type: 'setPageShape', pageId: 'p2', shape: 'v3x3' }, { type: 'setPageShape', pageId: 'p3', shape: '2x2' })
    const saved = JSON.parse(JSON.stringify(s.project)) as Project
    saved.pages[2].size = { w: 460, h: 460 }
    const pages = run(initialState(), { type: 'loadProject', project: saved }).project.pages
    expect(pages.map(x => [x.shape, x.size, x.scene.header])).toEqual([
      ['3x2-rugged', { w: 720, h: 460 }, { w: 1503, h: 960, fit: 'contain' }],
      ['v3x3', { w: 460, h: 458 }, { w: 1440, h: 1434, fit: 'contain' }],
      ['custom', { w: 460, h: 460 }, { w: 952, h: 960, fit: 'contain' }]])
  })
  it('saves and loads a LargeConsoleMod page, square in px, as its own shape and units, and a vertical monitor', () => {
    const s = run(initialState(), { type: 'addPage' }, { type: 'addPage' }, { type: 'setPageShape', pageId: 'p1', shape: '2x2-lcm' as ShapeKind },
      { type: 'setPageShape', pageId: 'p2', shape: '3x3-lcm' as ShapeKind }, { type: 'setPageShape', pageId: 'p3', shape: 'vmonitor-3x3-bulkhead' as ShapeKind })
    const pages = run(initialState(), { type: 'loadProject', project: JSON.parse(JSON.stringify(s.project)) as Project }).project.pages
    expect(pages.map(x => [x.shape, x.size, x.scene.header])).toEqual([
      ['2x2-lcm', { w: 460, h: 460 }, { w: 960, h: 960, fit: 'contain' }],
      ['3x3-lcm', { w: 460, h: 460 }, { w: 1440, h: 1440, fit: 'contain' }],
      ['vmonitor-3x3-bulkhead', { w: 460, h: 443 }, { w: 1440, h: 1387, fit: 'contain' }]])
  })
  it('reads an unknown shape string as no shape', () => {
    for (const shape of ['constructor', 'toString', '__proto__', 'bogus', 7]) {
      const p = newProject()
      p.pages = [{ ...p.pages[0], shape: shape as ShapeKind }, { ...p.pages[0], id: 'p2', surface: 'page2', shape: shape as ShapeKind, size: { w: 800, h: 400 } }]
      expect(run(initialState(), { type: 'loadProject', project: p }).project.pages.map(x => x.shape)).toEqual(['square', 'custom'])
    }
  })
})

describe('store setPageShape', () => {
  const shape = (shape: ShapeKind, size?: { w: number; h: number }): Action => ({ type: 'setPageShape', pageId: 'p1', shape, size })

  it('sets the size and the scene header\'s design units, in one undo step', () => {
    const s0 = initialState()
    const s1 = reducer(s0, shape('2x1'))
    expect(s1.project.pages[0]).toMatchObject({ shape: '2x1', size: { w: 1036, h: 460 } })
    expect(s1.project.pages[0].scene.header).toEqual({ w: 1080, h: 480, fit: 'contain' })
    expect(reducer(s1, { type: 'undo' }).project).toBe(s0.project)
  })

  it('keeps a header key\'s spelling and place', () => {
    const s0 = run(initialState(), { type: 'setScene', pageId: 'p1', scene: { header: { W: 100, fit: 'contain', H: 100 }, defs: [], root: [] } })
    const header = reducer(s0, shape('v2x1')).project.pages[0].scene.header
    expect(Object.entries(header)).toEqual([['W', 480], ['fit', 'contain'], ['H', 1080]])
  })

  it('clamps a custom size through px()', () => {
    const s = reducer(initialState(), shape('custom', { w: 0, h: 'x' as unknown as number }))
    expect(s.project.pages[0]).toMatchObject({ shape: 'custom', size: { w: 1, h: 460 } })
    expect(s.project.pages[0].scene.header).toMatchObject({ w: 480, h: 220800 })
  })

  it("keeps the header's units when a page turns custom at its own size", () => {
    const s1 = run(initialState(), shape('2x1'), shape('custom', { w: 1036, h: 460 }))
    expect(s1.project.pages[0]).toMatchObject({ shape: 'custom', size: { w: 1036, h: 460 } })
    expect(s1.project.pages[0].scene.header).toEqual({ w: 1080, h: 480, fit: 'contain' })
    expect(reducer(s1, { type: 'undo' }).project.pages[0].shape).toBe('2x1')
  })

  it('ignores an unknown shape or page', () => {
    const s0 = initialState()
    for (const bad of ['constructor', 'toString', 'bogus']) expect(reducer(s0, shape(bad as ShapeKind))).toBe(s0)
    expect(reducer(s0, { type: 'setPageShape', pageId: 'nope', shape: '2x1' })).toBe(s0)
  })

  it('is a no-op for the same shape and size', () => {
    const s0 = initialState()
    expect(reducer(s0, shape('square'))).toBe(s0)
    const s1 = reducer(s0, shape('custom', { w: 800, h: 400 }))
    expect(s1.project.pages[0].scene.header).toMatchObject({ w: 960, h: 480 })
    expect(reducer(s1, shape('custom', { w: 800, h: 400 }))).toBe(s1)
  })
})

describe('store selection', () => {
  const base = run(initialState(), set([node('R'), node('G', { id: 'panel' }, [node('C'), node('T')])]))

  it('follows the node by its id across a setScene', () => {
    const s = run(base, { type: 'select', selection: { pageId: 'p1', path: [1] } },
      set([node('G', { id: 'panel' }, [node('C'), node('T', { id: 'label' })]), node('R')]))
    expect(s.selection).toEqual({ pageId: 'p1', path: [0] })
    const moved = run(s, { type: 'select', selection: { pageId: 'p1', path: [0, 1] } },
      set([node('R'), node('R'), node('G', { ID: 'label' }, [node('T', { id: 'label' })])]))
    expect(moved.selection).toEqual({ pageId: 'p1', path: [2] })   // the first node with that id, in pre-order; keys in any case
  })

  it('keeps the path while the node there has the same id: ids may repeat', () => {
    const twins = run(initialState(), set([node('R', { id: 'a' }), node('R', { id: 'a' })]), { type: 'select', selection: { pageId: 'p1', path: [1] } })
    // a panel edit of the second one's f
    const s = run(twins, set([node('R', { id: 'a' }), node('R', { id: 'a', f: '#fff' })]))
    expect(s.selection).toEqual({ pageId: 'p1', path: [1] })
    // the same edit as the panel makes it (replaceAt: the other node is the same object)
    const panel = run(twins, set(replaceAt(root(twins), [1], node('R', { id: 'a', f: '#fff' }))!))
    expect(panel.selection).toEqual({ pageId: 'p1', path: [1] })
  })

  it("keeps the path when the panel renames the selected node's id while a twin keeps the old one", () => {
    const twins = run(initialState(), set([node('R', { id: 'a' }), node('R', { id: 'a' })]), { type: 'select', selection: { pageId: 'p1', path: [0] } })
    const s = run(twins, set(replaceAt(root(twins), [0], node('R', { id: 'b' }))!))
    expect(s.selection).toEqual({ pageId: 'p1', path: [0] })
    const nested = run(initialState(), set([node('G', {}, [node('R', { id: 'a' }), node('R', { id: 'a' })])]),
      { type: 'select', selection: { pageId: 'p1', path: [0, 0] } })
    const renamed = run(nested, set(replaceAt(root(nested), [0, 0], node('R', { id: 'b' }))!))
    expect(renamed.selection).toEqual({ pageId: 'p1', path: [0, 0] })
  })

  it('re-finds the node by id after an insertion before it or a reorder, even with the other nodes kept as objects', () => {
    const two = run(initialState(), set([node('R', { id: 'a' }), node('R', { id: 'b' })]))
    const [a, b] = root(two)
    const inserted = run(two, { type: 'select', selection: { pageId: 'p1', path: [1] } }, set([node('C'), a, b]))
    expect(inserted.selection).toEqual({ pageId: 'p1', path: [2] })
    const swapped = run(two, { type: 'select', selection: { pageId: 'p1', path: [0] } }, set([b, a]))
    expect(swapped.selection).toEqual({ pageId: 'p1', path: [1] })
  })

  it('keeps the path when the node had no id, and clears a path that no longer exists', () => {
    const s = run(base, { type: 'select', selection: { pageId: 'p1', path: [0] } }, set([node('C'), node('R')]))
    expect(s.selection).toEqual({ pageId: 'p1', path: [0] })
    const gone = run(base, { type: 'select', selection: { pageId: 'p1', path: [1, 1] } }, set([node('R')]))
    expect(gone.selection).toBeNull()
  })

  it('falls back to the path when the id is gone', () => {
    const s = run(base, { type: 'select', selection: { pageId: 'p1', path: [1] } }, set([node('C'), node('G')]))
    expect(s.selection).toEqual({ pageId: 'p1', path: [1] })
  })
})

describe('store at any depth', () => {
  it('re-resolves a selection by id and replaces a node 100,000 levels down, with no recursion', () => {
    let deep: SrcNode = node('R', { id: 'r' })
    for (let k = 0; k < 100_000; k++) deep = node('G', {}, [deep])
    const path = Array<number>(100_001).fill(0)
    const s0 = run(initialState(), set([deep]), { type: 'select', selection: { pageId: 'p1', path } })
    const s1 = run(s0, set([node('C'), deep]))
    expect(s1.selection?.path).toEqual([1, ...path.slice(1)])
    const s2 = run(s1, { type: 'updateNode', pageId: 'p1', path: s1.selection!.path, node: node('R', { id: 'r', x: 5 }) })
    let n = root(s2)[1]
    while (n.c) n = n.c[0]
    expect(n.attrs).toEqual({ id: 'r', x: 5 })
  })
})

describe('the selection set and editScene', () => {
  const at = (...path: number[]) => ({ pageId: 'p1', path })
  const start = () => {
    const p = newProject()
    p.pages[0] = { ...p.pages[0], scene: { header: { w: 460, h: 460 }, defs: [], root: [node('R'), node('G', {}, [node('C')]), node('T')] } }
    return initialState(p)
  }
  it('keeps also beside the primary: one entry per path (the last), none inside another member, none elsewhere', () => {
    const s = reducer(start(), { type: 'select', selection: at(2), also: [at(0), at(1, 0), at(1), at(0), { pageId: 'p9', path: [0] }, at(7)] })
    expect(s.selection).toEqual(at(2))
    expect(s.also).toEqual([at(1), at(0)])
    expect(selected(s)).toEqual([at(1), at(0), at(2)])
    expect(reducer(s, { type: 'select', selection: at(0) }).also).toEqual([])
    expect(reducer(s, { type: 'select', selection: null, also: [at(0)] })).toMatchObject({ selection: null, also: [] })
    expect(reducer(s, { type: 'select', selection: { pageId: 'p1', path: [0], inDefs: true }, also: [at(1)] }).also).toEqual([])
  })
  it('keeps a native primary beside a node in the set (R10)', () => {
    const native = { pageId: 'p1', path: [], native: 'ico1' }
    const s0 = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'icon' })
    const s = reducer(s0, { type: 'select', selection: native, also: [at(0)] })
    expect(s.selection).toEqual(native)
    expect(s.also).toEqual([at(0)])
  })
  it('editScene: one undo step with the selection it names; transient steps commit as one; omitted keeps the set', () => {
    const s0 = reducer(start(), { type: 'select', selection: at(0), also: [at(2)] })
    const scene = { ...s0.project.pages[0].scene, root: [node('R', { x: 1 })] }
    const s1 = reducer(s0, { type: 'editScene', pageId: 'p1', scene, selection: at(0), also: [] })
    expect(s1.project.pages[0].scene).toBe(scene)
    expect(s1.past).toHaveLength(1)
    expect(selected(s1)).toEqual([at(0)])
    const kept = reducer(s0, { type: 'editScene', pageId: 'p1', scene: { ...scene, root: [...scene.root, node('C'), node('T')] } })
    expect(selected(kept)).toEqual([at(2), at(0)])
    let d = reducer(s0, { type: 'editScene', pageId: 'p1', scene, transient: true })
    d = reducer(d, { type: 'editScene', pageId: 'p1', scene: { ...scene }, transient: true })
    expect(d.past).toHaveLength(0)
    d = reducer(d, { type: 'commitDrag' })
    expect(d.past).toHaveLength(1)
    expect(reducer(d, { type: 'undo' }).project).toBe(s0.project)
    expect(reducer(s0, { type: 'editScene', pageId: 'p9', scene })).toBe(s0)
  })
  it('drops members whose node is gone (settled) after an edit; an undo gives back the set the edit started from', () => {
    const s0 = reducer(start(), { type: 'select', selection: at(0), also: [at(2)] })
    const s1 = reducer(s0, { type: 'editScene', pageId: 'p1', scene: { ...s0.project.pages[0].scene, root: [node('R')] } })
    expect(selected(s1)).toEqual([at(0)])
    // An edit that adds a node, a set naming it, then an undo of the edit: the added member goes with it, and the set
    // before the edit comes back (not the paths the edit left, which may name other nodes now).
    const grown = { ...s0.project.pages[0].scene, root: [...s0.project.pages[0].scene.root, node('C')] }
    const s2 = reducer(s0, { type: 'editScene', pageId: 'p1', scene: grown, selection: at(0), also: [at(3)] })
    expect(selected(s2)).toEqual([at(3), at(0)])
    expect(selected(reducer(s2, { type: 'undo' }))).toEqual([at(2), at(0)])
  })
  it('settles a missing intermediate selection after edits, and restores it only with its node on undo', () => {
    const p = newProject()
    p.pages[0].scene = scene([node('R'), node('C'), node('G', {}, [node('T')])])
    const s0 = reducer(initialState(p), { type: 'select', selection: at(2, 0), also: [at(0)] })
    for (const type of ['editScene', 'setScene'] as const) {
      const s1 = reducer(s0, { type, pageId: 'p1', scene: scene([node('R')]) })
      expect(selected(s1)).toEqual([])
      expect(selected(reducer(s1, { type: 'undo' }))).toEqual([at(0), at(2, 0)])
      expect(selected(reducer(reducer(s1, { type: 'undo' }), { type: 'redo' }))).toEqual([])
      expect(reducer(s1, { type: 'updateNode', pageId: 'p1', path: [2, 0], node: node('T') })).toBe(s1)
    }
  })
  it('keeps a primary that does not resolve as a select without also does, and drops the others: none is promoted', () => {
    expect(reducer(start(), { type: 'select', selection: at(7) })).toMatchObject({ selection: at(7), also: [] })
    expect(reducer(start(), { type: 'select', selection: at(7), also: [at(0), at(2)] })).toMatchObject({ selection: at(7), also: [] })
  })
  it('setScene re-finds every member by its id, as it does the primary, and keeps one entry per node', () => {
    const ids = () => {
      const p = newProject()
      p.pages[0] = { ...p.pages[0], scene: scene([node('R', { id: 'x' }), node('R', { id: 'a' }), node('R', { id: 'b' }), node('R')]) }
      return initialState(p)
    }
    // A node typed on top in the code pane: every member follows its id, so none silently means another node.
    const s0 = reducer(ids(), { type: 'select', selection: at(1), also: [at(2)] })
    const s1 = reducer(s0, set([node('C'), ...root(s0)]))
    expect(s1.selection).toEqual(at(2))
    expect(s1.also).toEqual([at(3)])
    // A member without an id keeps its path; one re-found where another member now is gives one entry, the last.
    const s2 = reducer(ids(), { type: 'select', selection: at(3), also: [at(1)] })
    const s3 = reducer(s2, set([node('R', { id: 'x' }), node('C'), node('R', { id: 'b' }), node('R', { id: 'a' })]))
    expect(selected(s3)).toEqual([at(3)])
    // A member re-found inside another member is dropped (a group and its child never both move).
    const s4 = reducer(ids(), { type: 'select', selection: at(0), also: [at(1)] })
    const s5 = reducer(s4, set([node('R', { id: 'x' }, [node('R', { id: 'a' })])]))
    expect(selected(s5)).toEqual([at(0)])
  })
  it('an unchanged scene is no edit: no undo step, redo kept; only the selection it names changes', () => {
    const undone = run(start(), set([node('R', { x: 0 }), node('C')]), set([]), { type: 'undo' })   // with a redo step to keep
    const same = undone.project.pages[0].scene
    const unchanged = (t: State) => {
      expect(t.project).toBe(undone.project)
      expect([t.past, t.future, t.dragBase]).toEqual([undone.past, undone.future, null])
    }
    expect(reducer(undone, { type: 'editScene', pageId: 'p1', scene: same })).toBe(undone)
    // A command that rebuilt an equal scene (unhide all with nothing hidden), naming a selection.
    const copy = { ...same, root: same.root.map(n => ({ ...n, attrs: { ...n.attrs } })) }
    const rebuilt = reducer(undone, { type: 'editScene', pageId: 'p1', scene: copy, selection: at(1) })
    unchanged(rebuilt)
    expect(rebuilt.selection).toEqual(at(1))
    // Drags that end where they began: a step with the very scene; a node moved out and back.
    const x = (s: State, v: number) => reducer(s, { type: 'updateNode', pageId: 'p1', path: [0], node: node('R', { x: v }), transient: true })
    for (const d of [reducer(undone, { type: 'editScene', pageId: 'p1', scene: same, transient: true }), x(x(undone, 5), 0)]) {
      unchanged(reducer(d, { type: 'commitDrag' }))
      expect(reducer(d, { type: 'undo' }).project).toBe(undone.past.at(-1)!.project)   // the edit before it, no empty step first
      // An edit after it: one step, not an empty one before it.
      expect(held(reducer(d, { type: 'editScene', pageId: 'p1', scene: { ...same, root: [] } }).past)).toEqual([...held(undone.past), undone.project])
    }
    expect(reducer(x(undone, 5), { type: 'commitDrag' }).past).toHaveLength(undone.past.length + 1)
  })
  it('cancelDrag gives back the selection the drag started from, as well as the scene', () => {
    const s0 = reducer(start(), { type: 'select', selection: at(0), also: [at(2)] })
    const base = s0.project.pages[0].scene
    // A drawing step inserts a node at 1 and selects it; Esc.
    const drawn = reducer(s0, { type: 'editScene', pageId: 'p1', scene: { ...base, root: [base.root[0], node('R'), ...base.root.slice(1)] }, selection: at(1), also: [], transient: true })
    const moved = reducer(drawn, { type: 'editScene', pageId: 'p1', scene: { ...drawn.project.pages[0].scene }, transient: true })
    const cancelled = reducer(moved, { type: 'cancelDrag' })
    expect(cancelled.project).toBe(s0.project)
    expect(selected(cancelled)).toEqual([at(2), at(0)])
    expect(reducer(reducer(moved, { type: 'commitDrag' }), { type: 'cancelDrag' }).selection).toEqual(at(1))
  })
  // Undo and redo kept the paths the set had, which could name another node in the project they brought.
  it('undo brings back the set an edit started from, redo the one its result had when the undo left it', () => {
    // A node typed on top in the code pane: the selected R follows its id to [2]; undo gives back [1], the same R.
    const two = run(initialState(), set([node('R', { id: 'a' }), node('R', { id: 'b' })]), { type: 'select', selection: at(1) })
    const typed = reducer(two, set([node('C'), ...root(two)]))
    expect(typed.selection).toEqual(at(2))
    expect(reducer(typed, { type: 'undo' }).selection).toEqual(at(1))
    expect(reducer(reducer(typed, { type: 'undo' }), { type: 'redo' }).selection).toEqual(at(2))
    // A drawing drag inserts a node at 1 and selects it, then commits: undo gives back the set the drag started from (the
    // G now at 1 is not selected), and redo the set the user had picked since (the T) when the undo left it.
    const s0 = reducer(start(), { type: 'select', selection: at(0), also: [at(2)] })
    const base = s0.project.pages[0].scene
    const drawn = run(s0, { type: 'editScene', pageId: 'p1', scene: { ...base, root: [base.root[0], node('R', { x: 1 }), ...base.root.slice(1)] },
      selection: at(1), also: [], transient: true }, { type: 'commitDrag' })
    expect(selected(drawn)).toEqual([at(1)])
    const undone = run(drawn, { type: 'select', selection: at(3) }, { type: 'undo' })
    expect(undone.project).toBe(s0.project)
    expect(selected(undone)).toEqual([at(2), at(0)])
    expect(selected(reducer(undone, { type: 'redo' }))).toEqual([at(3)])
    // An undo while the drag is open commits it first and takes it back, with the set it started from.
    const open = reducer(s0, { type: 'editScene', pageId: 'p1', scene: drawn.project.pages[0].scene, selection: at(1), also: [], transient: true })
    expect(selected(reducer(open, { type: 'undo' }))).toEqual([at(2), at(0)])
  })
  it('keeps a set at any depth: a member 100,000 levels down beside a top-level one, with no path kept per level', () => {
    let deep: SrcNode = node('R')
    for (let k = 0; k < 100_000; k++) deep = node('G', {}, [deep])
    const p = newProject()
    p.pages[0] = { ...p.pages[0], scene: scene([deep, node('C')]) }
    const path = Array<number>(100_001).fill(0)
    const s = reducer(initialState(p), { type: 'select', selection: at(...path), also: [at(1), at(...path)] })
    expect(s.also).toEqual([at(1)])
    expect(s.selection?.path).toHaveLength(100_001)
    expect(reducer(s, { type: 'select', selection: at(1), also: [at(...path), at(0)] }).also).toEqual([at(0)])
  }, 30_000)
})

describe('store widgets', () => {
  const t = vanillaPlus
  const start = () => {
    const p = newProject()
    p.theme = 'vanilla-plus'
    p.pages[0].background = groundOf(t)
    p.pages[0] = { ...p.pages[0], scene: { header: { w: 480, h: 480, fit: 'contain' }, defs: [], root: [node('R', { x: 0, y: 0, w: 10, h: 10, f: '#FFFFFF' })] } }
    return initialState(p)
  }
  const root = (s: State) => s.project.pages[0].scene.root
  const inserted = () => reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'light' })

  it('inserts a widget centred on the page, on top, selected, in one undo step; uids count up', () => {
    let s = inserted()
    expect(root(s)).toHaveLength(2)
    expect(widgetOf(root(s)[1], t)).toEqual({ type: 'light', uid: 'lt1', params: { x: 231, y: 231, w: 18, h: 18, keys: {} } })
    expect(s.selection).toEqual({ pageId: 'p1', path: [1] })
    expect(s.past).toHaveLength(1)
    s = reducer(s, { type: 'insertWidget', pageId: 'p1', widget: 'light' })
    expect(widgetOf(root(s)[2], t)?.uid).toBe('lt2')
    expect(reducer(s, { type: 'insertWidget', pageId: 'p1', widget: 'nope' })).toBe(s)
  })
  it('sets params in one entry, or in transient drag steps that commit as one; sanitized; an unknown uid changes nothing', () => {
    const s0 = inserted(), w = widgetOf(root(s0)[1], t)!
    const s1 = reducer(s0, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: 40, y: 'a' } } })
    expect(widgetOf(root(s1)[1], t)?.params).toMatchObject({ x: 40, y: 24 })
    expect(s1.past).toHaveLength(2)
    let d = reducer(s0, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: 41 } }, transient: true })
    d = reducer(d, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: 42 } }, transient: true })
    d = reducer(d, { type: 'commitDrag' })
    expect(d.past).toHaveLength(2)
    expect(reducer(d, { type: 'undo' }).project).toBe(s0.project)
    expect(reducer(s0, { type: 'setWidget', pageId: 'p1', ref: { ...w, uid: 'lt9' } })).toBe(s0)
    expect(reducer(s0, { type: 'setWidget', pageId: 'p1', ref: { ...w, type: 'nope' } })).toBe(s0)
  })
  it('makes no history entry, and no drag step, for params that change nothing once sanitized', () => {
    const s0 = inserted(), w = widgetOf(root(s0)[1], t)!
    expect(reducer(s0, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: (w.params.x as number) + 1e-9 } } })).toBe(s0)
    expect(reducer(s0, { type: 'setWidget', pageId: 'p1', ref: w, transient: true })).toBe(s0)
  })
  it('keeps a widget and a copy pasted from it drawing as they did when the widget is dragged, edited, reloaded or deleted', () => {
    const s0 = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'duct' }), text = printChecked(s0.project.pages[0].scene)
    // The root pasted again detaches the copy, whose drawing stays independent of widget edits.
    const s1 = reducer(s0, { type: 'setScene', pageId: 'p1', scene: parseSrc(text + text.slice(text.indexOf('# widget duct'))).scene! })
    expect(s1.notice).toBe('detached duct1: its uid is used already (a uid is one in the project) (Ctrl+Z puts it back)')
    const trackY = (s: State, k: number) => root(s)[k].c![0].attrs.y
    const w = widgetOf(root(s1)[1], t)!, y0 = w.params.y, at = (y: number) => ({ ...w, params: { ...w.params, y } })
    expect([s1.project.pages[0].scene.defs, trackY(s1, 1), trackY(s1, 2)]).toEqual([[], y0, y0])
    const dragged = reducer(s1, { type: 'setWidget', pageId: 'p1', ref: at(300) })
    const edited = reducer(s1, { type: 'setScene', pageId: 'p1', scene: putWidget(s1.project.pages[0].scene, at(320), t) })   // as the panel commits
    for (const [s, y] of [[dragged, 300], [edited, 320]] as const) {
      expect([widgetOf(root(s)[1], t)?.params.y, trackY(s, 1), trackY(s, 2)]).toEqual([y, y, y0])
      expect(s.notice).toBe('')
      expect(problemsOf(s.project.pages[0].scene).filter(m => /not declared/.test(m))).toEqual([])
      const again = reducer(initialState(), { type: 'loadProject', project: s.project })
      expect([again.notice, widgetOf(again.project.pages[0].scene.root[1], t)?.params.y]).toEqual(['', y])
    }
    const gone = reducer(edited, { type: 'deleteWidget', pageId: 'p1', uid: 'duct1' })
    expect([gone.project.pages[0].scene.defs, trackY(gone, 1)]).toEqual([[], y0])
  })
  it('gives a copy whose page lacks the defs it points at (its root copied alone) those its marker makes', () => {
    WIDGETS.clipprobe = clipProbe
    try {
      const s0 = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'clipprobe' }), sc = s0.project.pages[0].scene
      const p2 = newPage(s0.project), s1 = { ...s0, project: { ...s0.project, pages: [...s0.project.pages, p2] } }
      const undeclared = (s: Scene) => problemsOf(s).filter(m => /not declared/.test(m))
      // To another page, where duct1 is taken; and twice in one paste on a page with no defs.
      const other = reducer(s1, { type: 'setScene', pageId: p2.id, scene: { ...p2.scene, root: [sc.root[1]] } }).project.pages[1].scene
      const twice = reducer(start(), { type: 'setScene', pageId: 'p1', scene: { ...sc, defs: [], root: [sc.root[1], sc.root[1]] } }).project.pages[0].scene
      // On the other page no duct1 widget can stand while the copy holds the stem: the def is added as it is.
      for (const [s, k, id] of [[other, 0, 'duct1_clip'], [twice, 1, 'duct1copy1_clip']] as const) {
        expect([s.root[k].c![0].attrs.clip, undeclared(s)]).toEqual([id, []])
        expect(s.defs.find(d => d.attrs.id === id)?.c).toEqual(sc.defs[0].c)
      }
      expect([twice.root[0].c![0].attrs.clip, other.defs.length]).toEqual(['duct1_clip', 1])
    } finally { delete WIDGETS.clipprobe }
  })
  it('gives a widget root copied alone to another page the theme_ gradients it paints with, whatever its type', () => {
    const types = Object.keys(WIDGETS).filter(type => !WIDGETS[type].native)   // a native is no node of the scene
    expect(types).toHaveLength(19)
    const undeclared = types.flatMap(type => {
      const s0 = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: type }), sc = s0.project.pages[0].scene
      const p2 = newPage(s0.project), s1 = { ...s0, project: { ...s0.project, pages: [...s0.project.pages, p2] } }
      const other = reducer(s1, { type: 'setScene', pageId: p2.id, scene: { ...p2.scene, root: [sc.root[1]] } }).project.pages[1].scene
      return problemsOf(other).filter(m => /not declared/.test(m)).map(m => `${type}: ${m}`)
    })
    expect(undeclared).toEqual([])
  })
  it('detaches into plain nodes keeping its <uid>_ defs, deletes with them; undo restores either', () => {
    const s = inserted(), page = s.project.pages[0], cp = (id: string) => node('CP', { id }, [node('R', { x: 0, y: 0, w: 1, h: 1 })])
    const s0 = { ...s, project: { ...s.project, pages: [{ ...page, scene: { ...page.scene, defs: [cp('lt1_clip'), cp('lt10_clip')] } }] } }
    const plain = reducer(s0, { type: 'detachWidget', pageId: 'p1', uid: 'lt1' })
    expect(widgetOf(root(plain)[1], t)).toBeNull()
    expect(root(plain)[1].c).toBe(root(s0)[1].c)
    expect(plain.project.pages[0].scene.defs).toBe(s0.project.pages[0].scene.defs)
    expect(reducer(plain, { type: 'undo' }).project).toBe(s0.project)
    const gone = reducer(s0, { type: 'deleteWidget', pageId: 'p1', uid: 'lt1' })
    expect(root(gone)).toHaveLength(1)
    expect(gone.project.pages[0].scene.defs.map(d => d.attrs.id)).toEqual(['lt10_clip'])
    expect(gone.selection).toBeNull()
    expect(reducer(gone, { type: 'undo' }).project).toBe(s0.project)
    expect(reducer(s0, { type: 'deleteWidget', pageId: 'p1', uid: 'lt7' })).toBe(s0)
  })
  it('a delete clears a selection on the widget, and moves one on a later root down with its node', () => {
    const two = reducer(inserted(), { type: 'insertWidget', pageId: 'p1', widget: 'light' })   // lt2 at [2], selected
    const onFirst = reducer(two, { type: 'select', selection: { pageId: 'p1', path: [1] } })
    expect(reducer(onFirst, { type: 'deleteWidget', pageId: 'p1', uid: 'lt1' }).selection).toBeNull()
    expect(reducer(two, { type: 'deleteWidget', pageId: 'p1', uid: 'lt1' }).selection).toEqual({ pageId: 'p1', path: [1] })
  })
  it('setScene keeps the code pane’s scene object when no widget was edited, and detaches one that was, saying so', () => {
    const s0 = inserted(), text = printChecked(s0.project.pages[0].scene)
    const same = parseSrc(text).scene!
    expect(reducer(s0, { type: 'setScene', pageId: 'p1', scene: same }).project.pages[0].scene).toBe(same)
    const edited = reducer(s0, { type: 'setScene', pageId: 'p1', scene: parseSrc(text.replace('cx=240', 'cx=241')).scene! })
    expect(widgetOf(root(edited)[1], t)).toBeNull()
    expect(edited.notice).toBe('detached lt1: edited by hand (Ctrl+Z puts it back)')
    expect(reducer(edited, { type: 'insertWidget', pageId: 'p1', widget: 'light' }).notice).toBe('')
    expect(reducer(edited, { type: 'undo' }).notice).toBe('')
    expect(run(edited, { type: 'updateNode', pageId: 'p1', path: [0], node: node('R', { x: 1 }), transient: true }).notice).not.toBe('')
    expect(run(edited, { type: 'updateNode', pageId: 'p1', path: [0], node: node('R', { x: 1 }), transient: true }, { type: 'commitDrag' }).notice).toBe('')
  })
  it('setScene detaches a pasted widget whose uid another page uses, and keeps one whose uid is free', () => {
    const s0 = run(inserted(), { type: 'addPage' }), text = printChecked(s0.project.pages[0].scene)
    const pasted = reducer(s0, { type: 'setScene', pageId: 'p2', scene: parseSrc(text).scene! })
    expect(widgetOf(pasted.project.pages[1].scene.root[1], t)).toBeNull()
    expect(pasted.notice).toBe('detached lt1: its uid is used already (a uid is one in the project) (Ctrl+Z puts it back)')
    const fresh = reducer(s0, { type: 'setScene', pageId: 'p2', scene: parseSrc(text.replaceAll('lt1', 'lt9')).scene! })
    expect(widgetOf(fresh.project.pages[1].scene.root[1], t)?.uid).toBe('lt9')
    expect(reducer(s0, { type: 'setScene', pageId: 'p1', scene: parseSrc(text).scene! }).notice).toBe('')   // its own page
  })
  it('snaps a selection inside a widget to its root; selecting the same again is no new state', () => {
    const s0 = reducer(inserted(), { type: 'select', selection: null })
    const s1 = reducer(s0, { type: 'select', selection: { pageId: 'p1', path: [1, 2] } })
    expect(s1.selection).toEqual({ pageId: 'p1', path: [1] })
    expect(reducer(s1, { type: 'select', selection: { pageId: 'p1', path: [1, 0] } })).toBe(s1)
    expect(reducer(s1, { type: 'select', selection: { pageId: 'p1', path: [0] } }).selection).toEqual({ pageId: 'p1', path: [0] })
  })
  it('snaps a selection inside a widget to its root wherever the selection is settled: undo, redo, a scene set, a cancelled drag', () => {
    const s0 = inserted(), inside = { ...s0, selection: { pageId: 'p1', path: [1, 2] } }
    const scene = s0.project.pages[0].scene
    // History entries and a drag's start whose set points inside the widget (M2c: undo, redo and a cancel bring back a set).
    const was = { selection: inside.selection, also: [] }, entry = { ...was, project: s0.project }
    const states: State[] = [{ ...inside, past: [entry] }, { ...inside, future: [entry] }, inside, { ...inside, dragBase: s0.project, dragSel: was }]
    const actions: Action[] = [{ type: 'undo' }, { type: 'redo' }, { type: 'setScene', pageId: 'p1', scene }, { type: 'cancelDrag' }]
    expect(actions.map((a, k) => reducer(states[k], a).selection)).toEqual(actions.map(() => ({ pageId: 'p1', path: [1] })))
  })
  it('keeps preview values per page, removes one given undefined, and loads only what the data element can carry', () => {
    let s = reducer(start(), { type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: 3 })
    expect(s.project.pages[0].preview).toEqual({ lt1_st: 3 })
    s = reducer(s, { type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: undefined })
    expect(s.project.pages[0].preview).toEqual({})
    expect(reducer(s, { type: 'setPreview', pageId: 'p1', key: '', value: 1 })).toBe(s)
    // Any name a label may read: `a b` ($a b), `constructor` (final-wave ruling 2).
    for (const key of ['a b', 'température', 'constructor', '__proto__'])
      expect(Object.entries(reducer(s, { type: 'setPreview', pageId: 'p1', key, value: 1 }).project.pages[0].preview!)).toEqual([[key, 1]])
    const p = newProject()
    p.theme = 'vanilla-plus'
    const preview = { a: 1, b: 'x', c: [1, 2], d: ['x'], e: NaN, f: {}, g: [1, 'x'], 'h i': 1, j: [], k: true, débit: 2, '': 1 }
    const loaded = reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], preview: preview as never }] } })
    expect(loaded.project.pages[0].preview).toEqual({ a: 1, b: 'x', c: [1, 2], d: ['x'], 'h i': 1, débit: 2 })
  })
  it('keeps a Key–value row’s preview values on that row when another row is removed', () => {
    const w = instance('kvtable', { keys: { v1: 'temp' } }), page0 = start().project.pages[0]
    const before = putWidget(page0.scene, w, t)
    let s: State = { ...start(), project: { ...start().project, pages: [{ ...page0, scene: before, preview: { kv1_v0: 101.3, temp: 21, kv1_v2: 'Eco' } }] } }
    const rows = (w.params.rows as Json[]).filter((_, k) => k !== 0)
    s = reducer(s, { type: 'setScene', pageId: 'p1', scene: putWidget(before, { ...w, params: { ...w.params, rows } }, t) })
    expect(s.project.pages[0].preview).toEqual({ temp: 21, kv1_v2: 'Eco' })
  })
  it('drops a deleted widget’s preview values, moves a renamed slot’s, and keeps a detached widget’s and any other', () => {
    const s = run(inserted(), { type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: 3 }, { type: 'setPreview', pageId: 'p1', key: 'other', value: 1 })
    const gone = reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'lt1' })
    expect(gone.project.pages[0].preview).toEqual({ other: 1 })
    expect(reducer(gone, { type: 'undo' }).project).toBe(s.project)
    const again = reducer(gone, { type: 'insertWidget', pageId: 'p1', widget: 'light' })   // lt1 again: CRIT no longer inherited
    expect(widgetOf(root(again)[1], t)?.uid).toBe('lt1')
    expect(again.project.pages[0].preview).toEqual({ other: 1 })
    const w = widgetOf(root(s)[1], t)!, scene = s.project.pages[0].scene
    const renamed = reducer(s, { type: 'setScene', pageId: 'p1', scene: putWidget(scene, { ...w, params: { ...w.params, keys: { st: 'pump' } } }, t) })
    expect(renamed.project.pages[0].preview).toEqual({ pump: 3, other: 1 })
    const edited = reducer(s, { type: 'setScene', pageId: 'p1', scene: parseSrc(printChecked(scene).replace('cx=240', 'cx=241')).scene! })
    expect(edited.notice).toBe('detached lt1: edited by hand (Ctrl+Z puts it back)')
    expect(edited.project.pages[0].preview).toBe(s.project.pages[0].preview)   // its nodes still read lt1_st
  })
  it('pins a detached widget’s samples in the same entry, so its nodes keep drawing them; a pinned value stays as it was', () => {
    const s = run(inserted(), { type: 'insertWidget', pageId: 'p1', widget: 'alert' }, { type: 'setPreview', pageId: 'p1', key: 'al1_st', value: 3 })
    const detached = reducer(s, { type: 'detachWidget', pageId: 'p1', uid: 'al1' })
    expect(detached.project.pages[0].preview).toEqual({ al1_st: 3, al1_msg: 'Message' })
    expect(reducer(detached, { type: 'undo' }).project).toBe(s.project)
    // A hand edit that detaches the light (its colour) pins lt1_st: no 'unresolved data name' on the status line.
    const scene = s.project.pages[0].scene, edited = reducer(s, { type: 'setScene', pageId: 'p1', scene: parseSrc(printChecked(scene).replace('cx=240', 'cx=241')).scene! })
    expect(edited.notice).toBe('detached lt1: edited by hand (Ctrl+Z puts it back)')
    expect(edited.project.pages[0].preview).toEqual({ al1_st: 3, lt1_st: 1 })
  })
  it('keeps a renamed slot’s rename and pinned value while the slot is gone, so switching back finds both', () => {
    const s0 = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'bar' }), w = widgetOf(root(s0)[1], t)!
    const set = (s: State, stateMode: string) => reducer(s, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, keys: { st: 'pump_st' }, stateMode } } })
    let s = run(set(s0, 'bound'), { type: 'setPreview', pageId: 'p1', key: 'pump_st', value: 3 })
    s = reducer(s, { type: 'setScene', pageId: 'p1', scene: set(s, 'auto').project.pages[0].scene })
    expect(s.project.pages[0].preview).toEqual({ pump_st: 3 })
    s = reducer(s, { type: 'setScene', pageId: 'p1', scene: set(s, 'bound').project.pages[0].scene })
    expect([widgetOf(root(s)[1], t)!.params.keys, s.project.pages[0].preview]).toEqual([{ st: 'pump_st' }, { pump_st: 3 }])
  })
  it('gives a new widget no uid a pinned preview value is kept under, so it inherits none', () => {
    const s = run(inserted(), { type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: 3 }, { type: 'detachWidget', pageId: 'p1', uid: 'lt1' })
    const scene = s.project.pages[0].scene, bare = reducer(s, { type: 'setScene', pageId: 'p1', scene: { ...scene, root: scene.root.slice(0, 1) } })
    expect(bare.project.pages[0].preview).toEqual({ lt1_st: 3 })   // nothing reads it now, but the value stays the player's
    expect(widgetOf(root(reducer(bare, { type: 'insertWidget', pageId: 'p1', widget: 'light' }))[1], t)?.uid).toBe('lt2')
  })
  it('makes a widget saved under a palette retuned since again in the theme, at a load or a paste: no detach, no notice', () => {
    const p = newProject(), header = { w: 480, h: 480, fit: 'contain' }
    p.theme = 'vanilla-plus'
    const now = printChecked(putWidget(putWidget({ header, defs: [], root: [] }, instance('light'), t), instance('button'), t))
    // The older palette: the light's ok colour (a fill and a glow), and the first stop of the button's theme_row gradient.
    const old = now.replaceAll('#7FD970', '#70C060').replace(/stops=\[\[0,#[0-9A-F]{6}/, 'stops=[[0,#010203')
    expect(old.match(/#70C060/g)).toHaveLength(2)
    expect(old).not.toBe(now.replaceAll('#7FD970', '#70C060'))
    const loaded = reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], scene: parseSrc(old).scene! }] } })
    expect([loaded.notice, printChecked(loaded.project.pages[0].scene)]).toEqual(['', now])
    const pasted = reducer(start(), { type: 'setScene', pageId: 'p1', scene: parseSrc(old).scene! })
    expect(pasted.project.pages[0].scene.root.map(n => widgetOf(n, t)?.uid)).toEqual(['lt1', 'btn1'])
    expect(printChecked({ ...pasted.project.pages[0].scene, defs: [] })).toBe(printChecked({ ...parseSrc(now).scene!, defs: [] }))
    // Anything but a colour is an edit: a moved circle detaches, as before.
    const moved = reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], scene: parseSrc(old.replace('cx=33', 'cx=34')).scene! }] } })
    expect(moved.notice).toBe('detached lt1: edited by hand')
  })
  it('detaches a widget whose label text was edited by hand, at a load or a paste, though the text reads as a colour', () => {
    const p = newProject(), header = { w: 480, h: 480, fit: 'contain' }
    p.theme = 'vanilla-plus'
    const load = (text: string) => reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], scene: parseSrc(text).scene! }] } })
    for (const [was, now] of [['#404', '#505'], ['#abc', '#def']]) {
      const text = printChecked(putWidget({ header, defs: [], root: [] }, instance('text', { text: was }), t)), edited = text.replace(`text=${was}`, `text=${now}`)
      expect(edited).not.toBe(text)
      const loaded = load(edited), pasted = reducer(start(), { type: 'setScene', pageId: 'p1', scene: parseSrc(edited).scene! })
      expect([loaded.notice, loaded.project.pages[0].scene.root[0].c![0].attrs.text]).toEqual(['detached txt1: edited by hand', now])
      expect([pasted.notice, root(pasted)[0].c![0].attrs.text]).toEqual(['detached txt1: edited by hand (Ctrl+Z puts it back)', now])
      // Its ink retuned is a colour, not an edit: made again in the theme.
      const inked = load(text.replace('f=#FFFFFF', 'f=#EEEEEE'))
      expect([inked.notice, printChecked(inked.project.pages[0].scene)]).toEqual(['', text])
    }
  })
  it('re-associates a widget holding a list nested 100,000 deep, pasted or loaded, a copy of one, and deletes beside one', () => {
    let deep: Value = 'a'
    for (let k = 0; k < 100_000; k++) deep = [deep]
    const deepen = (n: SrcNode): SrcNode => ({ ...n, c: [{ ...n.c![0], attrs: { ...n.c![0].attrs, zz: deep } }, ...n.c!.slice(1)] })
    const lit = inserted().project.pages[0].scene, light = { ...lit, root: [deepen(lit.root[1])] }
    expect(reducer(start(), { type: 'setScene', pageId: 'p1', scene: light }).notice).toBe('detached lt1: edited by hand (Ctrl+Z puts it back)')
    const p = newProject()
    p.theme = 'vanilla-plus'
    expect(reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], scene: light }] } }).notice).toBe('detached lt1: edited by hand')
    // A Flow duct and a copy of it holding the list: detaching keeps the deeply nested value.
    const sc = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'duct' }).project.pages[0].scene
    const copied = reducer(start(), { type: 'setScene', pageId: 'p1', scene: { ...sc, root: [...sc.root, deepen(sc.root[1])] } })
    expect([copied.notice, root(copied)[2].c![0].attrs.zz]).toEqual(['detached duct1: its uid is used already (a uid is one in the project) (Ctrl+Z puts it back)', deep])
    const beside = reducer(start(), { type: 'setScene', pageId: 'p1', scene: { ...sc, root: [...sc.root, node('G', { zz: deep })] } })
    expect(reducer(beside, { type: 'deleteWidget', pageId: 'p1', uid: 'duct1' }).project.pages[0].scene.defs).toEqual([])
  })
  it('loads each scene as text against no earlier widget: a body its marker does not give, and a uid used twice, detach', () => {
    const p = newProject(), p2 = newPage(p), header = { w: 480, h: 480, fit: 'contain' }
    p.theme = 'vanilla-plus'
    const bar = putWidget({ header, defs: [], root: [] }, instance('bar'), t), cut = { ...bar, root: [{ ...bar.root[0], c: bar.root[0].c!.slice(0, 1) }] }
    const loaded = reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], scene: cut }] } })
    expect(widgetOf(loaded.project.pages[0].scene.root[0], t)).toBeNull()
    expect(loaded.project.pages[0].preview).toEqual({ bar1_lvl: 0.62, bar1_st: 1 })   // its nodes still read them
    expect(loaded.notice).toBe('detached bar1: edited by hand')
    // bar1 on two pages: the second detaches; twice on one page: the second root detaches.
    const two = reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], scene: bar }, { ...p2, scene: bar }] } })
    expect(two.project.pages.map(x => widgetOf(x.scene.root[0], t)?.uid ?? null)).toEqual(['bar1', null])
    expect(two.notice).toBe('detached bar1: its uid is used already (a uid is one in the project)')
    const one = reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], scene: { ...bar, root: [bar.root[0], bar.root[0]] } }] } })
    expect(one.project.pages[0].scene.root.map(n => widgetOf(n, t)?.uid ?? null)).toEqual(['bar1', null])
    expect(reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [{ ...p.pages[0], scene: bar }] } }).notice).toBe('')
  })
  it('a theme switch drops the gradients nothing uses', () => {
    const base = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'button' }), page = base.project.pages[0]
    const raw = linked(node('R', { x: 0, y: 0, w: 10, h: 10 }), 'f', { gradient: 'brand' }, t)
    const scene = { ...page.scene, root: [...page.scene.root, raw], defs: [...page.scene.defs, gradientDef(t, 'brand')] }
    const s = { ...base, project: { ...base.project, pages: [{ ...page, scene }] } }
    const next = reducer(s, { type: 'setTheme', theme: 'neutral' }), out = next.project.pages[0].scene
    expect(out.defs.map(d => d.attrs.id)).toEqual(['theme_brand'])
    expect(out.defs[0]).toEqual(gradientDef(t, 'brand'))
    expect(out.root.at(-1)?.attrs.f).toBe('@theme_brand')
    expect(linksOf(out.root.at(-1)!)).toEqual(linksOf(raw))
    expect(reducer(next, { type: 'undo' }).project).toBe(s.project)
    const stale = { ...next, project: { ...next.project, pages: [{ ...next.project.pages[0], scene: {
      ...out, defs: [{ ...out.defs[0], attrs: { ...out.defs[0].attrs, stops: [[0, '#010203'], [1, '#040506']] } }] } }] } }
    const back = reducer(stale, { type: 'setTheme', theme: 'vanilla-plus' }).project.pages[0].scene
    expect(back.defs).toEqual(expect.arrayContaining([gradientDef(t, 'row'), gradientDef(t, 'brand')]))
    const lua = { ...s, project: { ...s.project, customLua: '-- theme_row' } }
    expect(reducer(lua, { type: 'setTheme', theme: 'neutral' }).project.pages[0].scene.defs).toEqual(scene.defs)
    const orphan = { ...next, project: { ...next.project, pages: [{ ...next.project.pages[0], scene: { ...out, defs: scene.defs } }] } }
    expect(reducer(initialState(), { type: 'loadProject', project: orphan.project }).project.pages[0].scene.defs).toEqual(scene.defs)
    const w = widgetOf(out.root[1], neutral)!
    expect(reducer(orphan, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: 42 } } }).project.pages[0].scene.defs).toEqual(scene.defs)
    // References count under any key, inside nested values and inside defs, on each page.
    for (const inDefs of [false, true]) {
      const reference = node('G', { arbitrary: [['@theme_row']] })
      const extra = { ...scene, [inDefs ? 'defs' : 'root']: [...scene[inDefs ? 'defs' : 'root'], reference] }
      const pages = [page, { ...page, id: 'p2', scene: extra }]
      const switched = reducer({ ...s, project: { ...s.project, pages } }, { type: 'setTheme', theme: 'neutral' })
      expect(switched.project.pages[0].scene.defs).toEqual([])
      expect(switched.project.pages[1].scene.defs).toContainEqual(gradientDef(t, 'row'))
    }
  })
  it('a theme switch drops an orphan left by hand', () => {
    const s = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'button' }), page = s.project.pages[0]
    expect(page.scene.defs.map(d => d.attrs.id)).toEqual(['theme_row'])
    const left = { ...s, project: { ...s.project, pages: [{ ...page, scene: { ...page.scene, root: page.scene.root.slice(0, 1) } }] } }   // the widget gone by hand
    const next = reducer(left, { type: 'setTheme', theme: 'neutral' })
    expect(next.project.pages[0].scene.defs).toEqual([])
  })
  it('stores only preview values the data element can carry, and makes no history entry for one that changes nothing', () => {
    const s = reducer(start(), { type: 'setPreview', pageId: 'p1', key: 'a', value: [1, 2] })
    for (const value of [true, NaN, [], {}, [1, 'x']]) expect(reducer(s, { type: 'setPreview', pageId: 'p1', key: 'b', value: value as never })).toBe(s)
    expect(reducer(s, { type: 'setPreview', pageId: 'p1', key: 'a', value: [1, 2] })).toBe(s)
    expect(reducer(s, { type: 'setPreview', pageId: 'p1', key: 'b', value: undefined })).toBe(s)
    expect(reducer(s, { type: 'setPreview', pageId: 'p1', key: '__proto__', value: undefined })).toBe(s)
  })
  it('setTheme re-expands every widget in the new theme, moves pages on the old ground to the new one, in one undo step', () => {
    let s = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'light' })
    s = { ...s, project: { ...s.project, pages: s.project.pages.map(p => ({ ...p, background: groundOf(vanillaPlus) })) } }
    const before = s, next = reducer(s, { type: 'setTheme', theme: 'neutral' })
    const scene = next.project.pages[0].scene, text = printChecked(scene)
    expect(next.project.theme).toBe('neutral')
    expect(widgetOf(scene.root[1], THEMES.neutral)?.params).toEqual(widgetOf(before.project.pages[0].scene.root[1], t)?.params)
    expect(scene.root[1].comments).toEqual(before.project.pages[0].scene.root[1].comments)
    expect(text).toContain(`C v==1-eq($lt1_st,1)-eq($lt1_st,2)-eq($lt1_st,3) cx=240 cy=240 rx=9 ry=9 f=${THEMES.neutral.colors['status-idle']}`)
    expect(next.project.pages[0].background).toEqual(groundOf(THEMES.neutral))
    expect(next.past).toHaveLength(before.past.length + 1)
    expect(reducer(next, { type: 'undo' }).project).toBe(before.project)
    expect(reducer(next, { type: 'setTheme', theme: 'nope' })).toBe(next)
    expect(reducer(next, { type: 'setTheme', theme: 'neutral' })).toBe(next)
  })
  it('setTheme rewrites the theme gradients a widget uses, and leaves a page grounded otherwise', () => {
    let s = reducer(start(), { type: 'insertWidget', pageId: 'p1', widget: 'readoutrow' })   // its raised row fills with @theme_row
    s = { ...s, project: { ...s.project, pages: s.project.pages.map(p => ({ ...p, background: ['#123456'] })) } }
    const next = reducer(s, { type: 'setTheme', theme: 'neutral' }), scene = next.project.pages[0].scene
    expect(next.project.pages[0].background).toEqual(['#123456'])
    expect(scene.defs).toEqual([])
    expect(printChecked(scene)).toContain('f=#2C2C2C')
  })
  it('setTheme re-expands the widgets on every page, finds the old ground in any case, keeps a ground that is no colours', () => {
    let s = run(inserted(), { type: 'addPage' }, { type: 'insertWidget', pageId: 'p2', widget: 'light' })
    const lower = groundOf(t).map(c => c.toLowerCase()), odd = [5, ...lower.slice(1)] as never   // a loaded file may hold any array
    s = { ...s, project: { ...s.project, pages: s.project.pages.map((p, i) => ({ ...p, background: i ? odd : lower })) } }
    const next = reducer(s, { type: 'setTheme', theme: 'neutral' })
    expect(next.project.pages.map(p => p.background)).toEqual([groundOf(THEMES.neutral), odd])
    for (const p of next.project.pages) expect(printChecked(p.scene)).toContain(`rx=9 ry=9 f=${THEMES.neutral.colors['status-idle']}`)
  })
  it('setTheme commits a drag in flight as its own step first, and re-expands the dragged params', () => {
    const s0 = inserted(), w = widgetOf(root(s0)[1], t)!
    const dragged = reducer(s0, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: 41 } }, transient: true })
    const next = reducer(dragged, { type: 'setTheme', theme: 'neutral' })
    expect(held(next.past)).toEqual([...held(s0.past), s0.project, dragged.project])
    // Each entry keeps the set it was left with (M2c): the drag's, the widget it started on; the theme switch's, the same.
    expect(next.past.slice(-2).map(e => [e.selection, e.also])).toEqual([[s0.selection, []], [s0.selection, []]])
    expect(widgetOf(root(next)[1], THEMES.neutral)?.params.x).toBe(41)
    expect(reducer(next, { type: 'undo' }).project).toBe(dragged.project)
  })
  it('setTheme re-expands a uid seen twice on a page (only a hand-made file has one) once, from its first root', () => {
    const s0 = inserted(), w = widgetOf(root(s0)[1], t)!, page = s0.project.pages[0]
    const moved = root(reducer(s0, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: 40 } } }))[1]
    const s = { ...s0, project: { ...s0.project, pages: [{ ...page, scene: { ...page.scene, root: [...page.scene.root, moved] } }] } }
    const next = reducer(s, { type: 'setTheme', theme: 'neutral' })
    expect(widgetOf(root(next)[1], THEMES.neutral)?.params.x).toBe(w.params.x)
    expect(printChecked({ ...next.project.pages[0].scene, root: [root(next)[1]] })).toContain(`f=${THEMES.neutral.colors['status-idle']}`)
    expect(root(next)[2]).toBe(moved)
  })
  it('a project naming no preset, or a prototype key, reads as Neutral', () => {
    expect(themeOf({ ...newProject(), theme: 'constructor' })).toBe(THEMES.neutral)
  })
})

// Every edit (widgets, natives, preview values, the theme) records the project and the set it was left with,
// so undo and redo bring back the set; a set snaps to widget roots.
describe('widgets, natives, preview values and theme edits share model history', () => {
  const at = (...path: number[]) => ({ pageId: 'p1', path })
  // R, a light (lt1) at 1, R, R.
  const start = () => {
    const p = newProject()
    p.pages[0] = { ...p.pages[0], scene: { header: { w: 480, h: 480 }, defs: [], root: [node('R')] } }
    const s = reducer(initialState(p), { type: 'insertWidget', pageId: 'p1', widget: 'light' })
    return reducer(s, { type: 'setScene', pageId: 'p1', scene: { ...s.project.pages[0].scene, root: [...root(s), node('C'), node('T')] } })
  }
  const lt1 = (s: State) => widgetOf(root(s)[1], vanillaPlus)!
  it('an edit that names no set settles every member onto its widget root, not only the primary', () => {
    const s = start(), light = root(s)[1], plain = { ...s.project.pages[0].scene, root: [node('R'), node('G', {}, [node('R')]), node('C'), node('T')] }
    const was = reducer(reducer(s, { type: 'editScene', pageId: 'p1', scene: plain }), { type: 'select', selection: at(3), also: [at(1, 0)] })
    const now = reducer(was, { type: 'editScene', pageId: 'p1', scene: { ...plain, root: [node('R'), light, node('C'), node('T')] } })
    expect([now.selection, now.also]).toEqual([at(3), [at(1)]])
  })
  it('snaps every member of a set to its widget root, then keeps one entry per node; the same set again is the same state', () => {
    const s = reducer(start(), { type: 'select', selection: at(1, 0), also: [at(0), at(1, 1), at(3)] })
    expect([s.selection, s.also]).toEqual([at(1), [at(0), at(3)]])
    expect(reducer(s, { type: 'select', selection: at(1, 2), also: [at(0), at(3)] })).toBe(s)
  })
  it('gives each widget action an entry with the set it was left with: undo brings the set back', () => {
    const s0 = reducer(start(), { type: 'select', selection: at(3), also: [at(0)] })
    const w = lt1(s0)
    const actions: Action[] = [
      { type: 'insertWidget', pageId: 'p1', widget: 'bar' }, { type: 'insertWidget', pageId: 'p1', widget: 'icon' },
      { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: 7 } } },
      { type: 'detachWidget', pageId: 'p1', uid: 'lt1' }, { type: 'deleteWidget', pageId: 'p1', uid: 'lt1' },
      { type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: 2 }, { type: 'setTheme', theme: 'vanilla-plus' }]
    for (const a of actions) {
      const s1 = reducer(s0, a)
      expect([a.type, s1.past.at(-1)]).toEqual([a.type, { project: s0.project, selection: at(3), also: [at(0)] }])
      expect([a.type, selected(reducer(s1, { type: 'undo' }))]).toEqual([a.type, [at(0), at(3)]])
    }
  })
  it('an editScene that removes a widget drops the preview values only its slots read, in its one entry; a drag step keeps them', () => {
    const s0 = run(start(), { type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: 3 }, { type: 'setPreview', pageId: 'p1', key: 'other', value: 1 })
    const scene = s0.project.pages[0].scene, gone = { ...scene, root: scene.root.filter((_, i) => i !== 1) }
    const s1 = reducer(s0, { type: 'editScene', pageId: 'p1', scene: gone })
    expect([s1.project.pages[0].preview, s1.past.at(-1)!.project]).toEqual([{ other: 1 }, s0.project])
    expect(reducer(s0, { type: 'editScene', pageId: 'p1', scene: gone, transient: true }).project.pages[0].preview).toEqual({ lt1_st: 3, other: 1 })
  })
  it('selects an inserted widget alone, a native too', () => {
    const s0 = reducer(start(), { type: 'select', selection: at(3), also: [at(0)] })
    expect(selected(reducer(s0, { type: 'insertWidget', pageId: 'p1', widget: 'bar' }))).toEqual([at(4)])
    expect(selected(reducer(s0, { type: 'insertWidget', pageId: 'p1', widget: 'icon' }))).toEqual([{ pageId: 'p1', path: [], native: 'ico1' }])
  })
  it('a widget drag in its panel is a drag: a cancel brings back the set it started from, a commit one entry with it', () => {
    const s0 = reducer(start(), { type: 'select', selection: at(1), also: [at(0)] }), w = lt1(s0)
    const d = reducer(s0, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: 7 } }, transient: true })
    const moved = reducer(d, { type: 'select', selection: at(3) })
    const cancelled = reducer(moved, { type: 'cancelDrag' })
    expect([cancelled.project, selected(cancelled)]).toEqual([s0.project, [at(0), at(1)]])
    const committed = reducer(moved, { type: 'commitDrag' })
    expect(committed.past.at(-1)).toEqual({ project: s0.project, selection: at(1), also: [at(0)] })
  })
  it('a widget deleted from the scene takes its members with it and moves the later ones down', () => {
    const s0 = reducer(start(), { type: 'select', selection: at(3), also: [at(0), at(2)] })
    const s1 = reducer(s0, { type: 'deleteWidget', pageId: 'p1', uid: 'lt1' })
    expect(selected(s1)).toEqual([at(0), at(1), at(2)])
    const s2 = reducer(reducer(s0, { type: 'select', selection: at(1), also: [at(3)] }), { type: 'deleteWidget', pageId: 'p1', uid: 'lt1' })
    expect([s2.selection, s2.also]).toEqual([null, []])   // the primary gone, the set goes (settled)
  })
})

describe('the live data (M3)', () => {
  const role = { id: 'tank', name: 'Tank', prefabs: ['StructureGasSensor'], mode: 'one' as const }
  it('setLogic is one undo step; transient steps commit as one; the cascade runs; an equal patch is no edit', () => {
    let s = initialState()
    s = reducer(s, { type: 'setLogic', patch: { roles: [role], reads: [{ id: 'p', role: 'tank', of: { lt: { name: 'Pressure' } } }] } })
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'setLogic', patch: { roles: [role] } })).toBe(s)
    s = reducer(s, { type: 'setLogic', patch: { roles: [] } })
    expect(s.project.reads).toEqual([])
    s = reducer(s, { type: 'undo' })
    expect(s.project.reads).toHaveLength(1)
    let d = reducer(s, { type: 'setLogic', patch: { customLua: 'x' }, transient: true })
    d = reducer(d, { type: 'setLogic', patch: { customLua: 'xy' }, transient: true })
    d = reducer(d, { type: 'commitDrag' })
    expect([d.project.customLua, d.past.length]).toEqual(['xy', s.past.length + 1])
  })
  it('setLogic leaves a field the patch sets to undefined as it is', () => {
    const s = reducer(initialState(), { type: 'setLogic', patch: { roles: [role] } })
    for (const k of ['roles', 'reads', 'state', 'actions', 'rules', 'bindings', 'customLua', 'simDevices', 'settings'] as const)
      expect(reducer(s, { type: 'setLogic', patch: { [k]: undefined } })).toBe(s)
    expect(reducer(s, { type: 'setLogic', patch: { roles: undefined, customLua: 'x' } }).project).toEqual({ ...s.project, customLua: 'x' })
  })
  it('renameLogic renames with every reference and says what it does not rewrite; a refused name leaves the project', () => {
    let s = reducer(initialState(), { type: 'setLogic', patch: { roles: [role] } })
    s = reducer(s, { type: 'renameLogic', kind: 'role', from: 'tank', to: 'o2' })
    expect(s.project.roles[0].id).toBe('o2')
    expect(s.notice).toBe('renamed tank to o2; expressions that name tank are not rewritten')
    const t = reducer(s, { type: 'renameLogic', kind: 'role', from: 'o2', to: 'end' })
    expect([t.project, t.notice]).toEqual([s.project, '"end" is not a Lua name (letters, digits and _, not a keyword)'])
  })
  it('removing a page drops the page steps to it', () => {
    let s = reducer(initialState(), { type: 'addPage' })
    s = reducer(s, { type: 'setLogic', patch: { actions: [{ id: 'a', on: 'x', do: [{ op: 'page', page: 'p2' }, { op: 'command', flag: 'go' }] }] } })
    s = reducer(s, { type: 'removePage', pageId: 'p2' })
    expect(s.project.actions[0].do).toEqual([{ op: 'command', flag: 'go' }])
  })
  it('removing a page takes the bindings only its widgets read, so a widget given that uid later is not bound', () => {
    let s = reducer(initialState(), { type: 'addPage' })
    s = run(s, { type: 'insertWidget', pageId: 'p2', widget: 'bar' }, { type: 'insertWidget', pageId: 'p2', widget: 'bar' })
    const w = widgetAt(s.project.pages[1].scene, [1], vanillaPlus)!, p2 = s.project.pages[1].scene
    s = run(s, { type: 'editScene', pageId: 'p2', scene: { ...p2, header: { ...p2.header, note: '$bar1_lvl' } } },   // goes with the page
      { type: 'setWidget', pageId: 'p2', ref: { ...w, params: { ...w.params, keys: { lvl: 'tank' } } } },
      { type: 'editScene', pageId: 'p1', scene: { ...s.project.pages[0].scene, root: [node('T', { text: '$tank' })] } },
      { type: 'setLogic', patch: { roles: [role], reads: [{ id: 'p', role: 'tank', of: { lt: { name: 'Pressure' } } }],
        bindings: { bar1_lvl: { from: 'read', read: 'p' }, tank: { from: 'read', read: 'p' }, free: { from: 'const', value: 1 } } } })
    s = reducer(s, { type: 'removePage', pageId: 'p2' })
    // bar1_lvl only p2's bar read; p1 still reads tank; no slot read free (a raw name stays, as a deleted widget leaves it).
    expect(s.project.bindings).toEqual({ tank: { from: 'read', read: 'p' }, free: { from: 'const', value: 1 } })
    const t = reducer(s, { type: 'insertWidget', pageId: 'p1', widget: 'bar' })
    expect([widgetAt(t.project.pages[0].scene, [1], vanillaPlus)!.uid, t.project.bindings]).toEqual(['bar1', s.project.bindings])
    expect(Object.keys(run(t, { type: 'undo' }, { type: 'undo' }).project.bindings)).toEqual(['bar1_lvl', 'tank', 'free'])
  })
  it('deleting a native, or the page that holds it, takes its @uid.prop bindings', () => {
    let s = reducer(initialState(), { type: 'addPage' })
    s = run(s, { type: 'insertWidget', pageId: 'p1', widget: 'icon' }, { type: 'insertWidget', pageId: 'p2', widget: 'icon' },
      { type: 'setLogic', patch: { bindings: { '@ico1.name': { from: 'expr', expr: 'P.item' }, '@ico2.name': { from: 'expr', expr: 'P.gas' },
        '@ico10.name': { from: 'const', value: 'x' }, ico1: { from: 'const', value: 1 } } } })
    s = reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'ico1' })
    expect(Object.keys(s.project.bindings)).toEqual(['@ico2.name', '@ico10.name', 'ico1'])
    s = reducer(s, { type: 'removePage', pageId: 'p2' })
    expect(Object.keys(s.project.bindings)).toEqual(['@ico10.name', 'ico1'])
    expect(Object.keys(reducer(s, { type: 'undo' }).project.bindings)).toEqual(['@ico2.name', '@ico10.name', 'ico1'])
  })
  it('loadProject sanitizes the live data and round-trips a full project', () => {
    let s = reducer(initialState(), { type: 'setLogic', patch: { roles: [role], bindings: { n: { from: 'const', value: 3 } }, customLua: 'U.x = 1' } })
    const back = reducer(initialState(), { type: 'loadProject', project: JSON.parse(JSON.stringify(s.project)) })
    expect(back.project).toEqual(s.project)
    const bad = reducer(initialState(), { type: 'loadProject', project: { ...newProject(), roles: [{ id: 'end' }], settings: 7 } as never })
    expect([bad.project.roles, bad.project.settings]).toEqual([[], newLogic().settings])
    expect(bad.notice).toContain('roles: 1 could not be read and were dropped')
  })
  it('a slot renamed in the widget panel carries its binding and its preview value; a deleted widget takes its bindings', () => {
    let s = reducer(initialState(), { type: 'insertWidget', pageId: 'p1', widget: 'bar' })
    s = reducer(s, { type: 'setLogic', patch: { bindings: { bar1_lvl: { from: 'const', value: 0.5 } } } })
    s = reducer(s, { type: 'setPreview', pageId: 'p1', key: 'bar1_lvl', value: 0.25 })
    const w = widgetAt(s.project.pages[0].scene, [0], vanillaPlus)!
    s = reducer(s, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, keys: { lvl: 'tank' } } } })
    expect(s.project.bindings).toEqual({ tank: { from: 'const', value: 0.5 } })
    expect(s.project.pages[0].preview).toEqual({ tank: 0.25 })
    s = reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'bar1' })
    expect(s.project.bindings).toEqual({})
  })
  it('a widget edit leaves a binding whose name a node of its own page still reads', () => {
    let s = reducer(initialState(), { type: 'insertWidget', pageId: 'p1', widget: 'bar' })
    const w = widgetAt(s.project.pages[0].scene, [0], vanillaPlus)!, x = { from: 'const' as const, value: 0.5 }
    s = run(s, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, keys: { lvl: 'tank' } } } },
      { type: 'setLogic', patch: { bindings: { tank: x } } })
    s = reducer(s, { type: 'editScene', pageId: 'p1', scene: { ...s.project.pages[0].scene, root: [...root(s), node('T', { text: '$tank' })] } })
    expect(reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'bar1' }).project.bindings).toEqual({ tank: x })
    expect(reducer(s, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, keys: { lvl: 'o2' } } } }).project.bindings).toEqual({ o2: x, tank: x })
  })
  it('a widget delete leaves a binding a node of its page reads only through an expression with no leading =', () => {
    let s = reducer(initialState(), { type: 'insertWidget', pageId: 'p1', widget: 'bar' })
    const w = widgetAt(s.project.pages[0].scene, [0], vanillaPlus)!, x = { from: 'const' as const, value: 0.5 }
    s = run(s, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, keys: { lvl: 'tank' } } } },
      { type: 'setLogic', patch: { bindings: { tank: x } } })
    s = reducer(s, { type: 'editScene', pageId: 'p1', scene: { ...s.project.pages[0].scene, root: [...root(s), node('R', { x: '1+$tank', y: 0, w: 1, h: 1 })] } })
    expect(reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'bar1' }).project.bindings).toEqual({ tank: x })
  })
  it('a widget edit leaves a binding whose name another page still reads, and takes it once none does', () => {
    let s = run(initialState(), { type: 'addPage' }, { type: 'insertWidget', pageId: 'p1', widget: 'bar' }, { type: 'insertWidget', pageId: 'p2', widget: 'bar' })
    const lvl = (k: number, key: string): Action => {
      const page = s.project.pages[k], w = widgetAt(page.scene, [0], vanillaPlus)!
      return { type: 'setWidget', pageId: page.id, ref: { ...w, params: { ...w.params, keys: { lvl: key } } } }
    }
    const x = { from: 'const' as const, value: 0.5 }
    s = run(s, lvl(0, 'tank'), lvl(1, 'tank'), { type: 'setLogic', patch: { bindings: { tank: x } } })
    const moved = reducer(s, lvl(0, 'o2'))   // p2's bar reads tank still
    expect(moved.project.bindings).toEqual({ o2: x, tank: x })
    expect(reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'bar1' }).project.bindings).toEqual({ tank: x })
    expect(reducer(moved, { type: 'deleteWidget', pageId: 'p2', uid: 'bar2' }).project.bindings).toEqual({ o2: x })
  })
  it('a page whose scene the editor cannot read (a loaded project’s) can be removed, and a widget edit elsewhere keeps the bindings it may read', () => {
    const p = newProject(), x = { from: 'const' as const, value: 1 }
    p.pages[0].scene = putWidget(p.pages[0].scene, instance('bar'), vanillaPlus)
    const s = reducer(initialState(), { type: 'loadProject', project: { ...p, pages: [p.pages[0], { ...newPage(p), scene: {} as Scene }], bindings: { bar1_lvl: x } } })
    expect(reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: 'bar1' }).project.bindings).toEqual({ bar1_lvl: x })
    const r = reducer(s, { type: 'removePage', pageId: 'p2' })
    expect([r.project.pages.map(pg => pg.id), r.project.bindings]).toEqual([['p1'], { bar1_lvl: x }])
  })
  it('a widget step that keeps every data name it read carries nothing, so a drag re-reads no other widget', () => {
    let s = initialState()
    for (let i = 0; i < 50; i++) s = reducer(s, { type: 'insertWidget', pageId: 'p1', widget: 'bar' })
    s = reducer(s, { type: 'setLogic', patch: { bindings: { bar1_lvl: { from: 'const', value: 1 } } } })
    const w = widgetAt(s.project.pages[0].scene, [0], vanillaPlus)!, parse = vi.spyOn(JSON, 'parse')
    try {
      const d = reducer(s, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, x: (w.params.x as number) + 5 } }, transient: true })
      expect([d.project.bindings, widgetAt(d.project.pages[0].scene, [0], vanillaPlus)!.params.x]).toEqual([s.project.bindings, (w.params.x as number) + 5])
      expect(parse.mock.calls.length).toBeLessThan(10)   // a marker read per widget root was 50 (bindingsCarried's walk)
    } finally { parse.mockRestore() }
  })
})

it('keeps a binding held by an inactive slot rename on another page', () => {
  const p = newProject(), x = { from: 'const' as const, value: 1 }
  p.pages[0].scene = putWidget(p.pages[0].scene, instance('bar', { keys: { lvl: 'shared' } }), vanillaPlus)
  p.pages.push({ ...newPage(p), scene: putWidget(newPage(p).scene, instance('header', { clock: false, counts: false, keys: { clock: 'shared' } }), vanillaPlus) })
  p.bindings.shared = x
  expect(reducer(initialState(p), { type: 'deleteWidget', pageId: 'p1', uid: 'bar1' }).project.bindings).toEqual({ shared: x })
})
it('setLogic ignores non-logic keys and null fields', () => {
  const s = initialState()
  expect(reducer(s, { type: 'setLogic', patch: { name: 'injected', pages: [], roles: null } as never })).toBe(s)
})
it('takenUids skips unreadable scenes and keeps readable ids and native uids', () => {
  const p = newProject()
  p.pages[0].scene = scene([node('R', { id: 'held1_hit' }), null as never])
  p.pages.push({ ...newPage(p), scene: null as never, natives: [instance('textinput')] })
  expect([...takenUids(p)].sort()).toEqual(['held1', 'ti1'])
})
