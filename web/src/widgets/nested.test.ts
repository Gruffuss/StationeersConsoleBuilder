import { describe, expect, it } from 'vitest'
import { newProject } from '../model/project'
import { initialState, nodeAt, reducer, replaceAt } from '../model/store'
import { node } from '../model/testing'
import type { Scene } from '../model/scene'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { themeOf } from '../theme'
import * as core from './core'
import { instance, noClip, sceneOf } from './testing'

const w = instance('button', { canDisable: true })
const nested = (): Scene => { const s = sceneOf(w); return { ...s, root: [node('G', { t: [100, 50], r: 30 }, [node('R', { id: 'plain' }), s.root[0]])] } }
const state = () => { const p = newProject(); p.theme = t.id; p.pages[0].scene = nested(); return initialState(p) }
const scene = (s: ReturnType<typeof state>) => s.project.pages[0].scene

describe('widgets in ordinary groups: core and store', () => {
  it('reads any depth, stops at a widget root, and finds the containing widget', () => {
    const s = nested()
    noClip([...s.root, ...s.defs])
    expect(core.widgetAt(s, [0, 1], t)).toEqual(w)
    expect(core.widgetsIn(s, t)).toEqual([{ path: [0, 1], ref: w }])
    expect(core.widgetRootOf(s, [0, 1, 0], t)).toEqual([0, 1])
    expect(core.widgetRootOf(s, [0, 0], t)).toBeNull()
    let deep = s.root[0]
    for (let i = 0; i < 12000; i++) deep = node('G', {}, [deep])
    expect(core.widgetsIn({ ...s, root: [deep] }, t)[0].path).toHaveLength(12002)
  })
  it('re-expands, detaches and drops a nested widget in place', () => {
    const s = nested(), out = core.putWidget(s, { ...w, params: { ...w.params, x: 90 } }, t)
    expect(out.root).toHaveLength(1)
    expect(core.widgetAt(out, [0, 1], t)?.params.x).toBe(90)
    expect(core.widgetAt(core.detach(s, w.uid, t), [0, 1], t)).toBeNull()
    expect(core.dropWidget(s, w.uid, t).root[0].c).toHaveLength(1)
  })
  it('re-associates a grouped widget and loads it without detaching or pinning its samples', () => {
    const s = nested(), r = core.reassociate(sceneOf(w), s, t)
    expect(r.detached).toEqual([]); expect(r.scene).toBe(s)
    const loaded = reducer(state(), { type: 'loadProject', project: state().project })
    expect(core.widgetAt(scene(loaded), [0, 1], t)).toEqual(w)
    expect(loaded.notice).toBe(''); expect(loaded.project.pages[0].preview).toBeUndefined()
  })
  it('snaps to a nested widget until that widget is entered; entering its structure stops at its root', () => {
    const s = state(), selected = reducer(s, { type: 'select', selection: { pageId: 'p1', path: [0, 1, 0] } })
    expect(selected.selection?.path).toEqual([0, 1])
    const parent = reducer(s, { type: 'enter', pageId: 'p1', path: [0] })
    expect(reducer(parent, { type: 'select', selection: { pageId: 'p1', path: [0, 1, 0] } }).selection?.path).toEqual([0, 1])
    const entered = reducer(s, { type: 'enter', pageId: 'p1', path: [0, 1] })
    expect(entered.entered?.path).toEqual([0, 1])
    expect(reducer(entered, { type: 'enter', pageId: 'p1', path: [0, 1, 1] })).toBe(entered)
  })
  it('inserts into the entered ordinary group, and refuses insertion inside an entered widget with a note', () => {
    const parent = reducer(state(), { type: 'enter', pageId: 'p1', path: [0] })
    const out = reducer(parent, { type: 'insertWidget', pageId: 'p1', widget: 'bar' })
    expect(out.selection?.path).toEqual([0, 2]); expect(core.widgetAt(scene(out), [0, 2], t)?.type).toBe('bar')
    const entered = reducer(parent, { type: 'enter', pageId: 'p1', path: [0, 1] })
    const refused = reducer(entered, { type: 'insertWidget', pageId: 'p1', widget: 'bar' })
    expect(refused.project).toBe(entered.project); expect(refused.notice).toMatch(/inside a widget/)
  })
  it('routes nested part edits into overrides and preserves them through parameters, theme, load and undo', () => {
    const s = state(), part = [0, 1, ...core.expandRoot(w, t).exp.parts!['state.0.body']], n = nodeAt(scene(s).root, part)!
    const edited = reducer(s, { type: 'updateNode', pageId: 'p1', path: part, node: { ...n, attrs: { ...n.attrs, f: '#123456' } } })
    const over = core.widgetAt(scene(edited), [0, 1], t)!
    expect(over.edit?.parts['state.0.body'].attrs?.f).toBe('#123456')
    const moved = reducer(edited, { type: 'setWidget', pageId: 'p1', ref: { ...over, params: { ...over.params, w: 280 } } })
    expect(core.widgetAt(scene(moved), [0, 1], t)?.params.w).toBe(280)
    const themed = reducer(moved, { type: 'setTheme', theme: 'neutral' })
    expect(core.widgetAt(scene(themed), [0, 1], themeOf(themed.project))?.edit).toEqual(over.edit)
    const load = reducer(themed, { type: 'loadProject', project: themed.project })
    expect(core.widgetAt(scene(load), [0, 1], themeOf(load.project))?.edit).toEqual(over.edit)
    expect(core.widgetAt(scene(reducer(moved, { type: 'undo' })), [0, 1], t)?.params.w).toBe(w.params.w)
  })
  it('refuses structural edits to a nested widget', () => {
    const s = state(), n = nodeAt(scene(s).root, [0, 1])!
    const out = reducer(s, { type: 'updateNode', pageId: 'p1', path: [0, 1], node: { ...n, comments: undefined } })
    expect(out.project).toBe(s.project); expect(out.notice).toContain('Detach')
  })
  it('carries slot renames and removes deleted slots and their bindings at any depth', () => {
    const s = state(); s.project.pages[0].preview = { btn1_dis: 2 }; s.project.bindings.btn1_dis = { from: 'const', value: 1 }
    const changed = reducer(s, { type: 'setWidget', pageId: 'p1', ref: { ...w, params: { ...w.params, keys: { dis: 'other' } } } })
    expect(changed.project.pages[0].preview).toEqual({ other: 2 })
    expect(changed.project.bindings).toEqual({ other: { from: 'const', value: 1 } })
    expect(reducer(changed, { type: 'deleteWidget', pageId: 'p1', uid: w.uid }).project.bindings).toEqual({})
  })
  it('deleting a nested widget shifts only siblings in its parent and detaching pins samples', () => {
    const s = state(); s.project.pages[0].scene.root[0].c!.push(node('R', { id: 'after' }))
    s.selection = { pageId: 'p1', path: [0, 2] }
    const gone = reducer(s, { type: 'deleteWidget', pageId: 'p1', uid: w.uid })
    expect(gone.selection?.path).toEqual([0, 1]); expect(nodeAt(scene(gone).root, [0, 1])?.attrs.id).toBe('after')
    const detached = reducer(s, { type: 'detachWidget', pageId: 'p1', uid: w.uid })
    expect(core.widgetAt(scene(detached), [0, 1], t)).toBeNull()
    expect(detached.project.pages[0].preview?.btn1_dis).toBeDefined()
  })
  it('a code-pane edit to nested widget structure still detaches', () => {
    const s = state(), n = nodeAt(scene(s).root, [0, 1])!
    const out = reducer(s, { type: 'setScene', pageId: 'p1', scene: { ...scene(s), root: replaceAt(scene(s).root, [0, 1], { ...n, c: [] })! } })
    expect(out.notice).toContain('detached btn1'); expect(core.widgetAt(scene(out), [0, 1], t)).toBeNull()
  })
})
