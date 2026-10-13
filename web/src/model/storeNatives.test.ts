import { describe, expect, it } from 'vitest'
import { node } from './testing'
import { newProject, type Project } from './project'
import type { SrcNode } from './scene'
import { initialState, reducer, selected, type Selection } from './store'
import { themeOf } from '../theme'
import { expandRoot, sanitize } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import type { NativeRef } from '../widgets/types'
import { reflow, withLayout, type LayoutRecord } from '../editing/layoutRecords'
import { holderOf, innerFrame } from '../editing/natives'
import { widgetAt } from '../widgets/core'

const potato = (attrs: SrcNode['attrs'] = {}): SrcNode => node('G', { id: 'potato', ...attrs }, [node('R', { x: 0, y: 0, w: 200, h: 200 })])
function project(root = [potato()]): Project {
  const p = newProject(), t = themeOf(p)
  p.pages[0].scene.root = root
  p.pages[0].natives = [{ type: 'icon', uid: 'ico1', params: sanitize(WIDGETS.icon,
    { x: 104.5, y: 168.8, w: 20, h: 30, kind: 'gas', name: 'Oxygen' }, t), group: 'potato' }]
  return p
}
const native = (p: Project): NativeRef => p.pages[0].natives![0]

describe('native persistence', () => {
  it('loads valid membership and true flags with no repairs', () => {
    const p = project(); Object.assign(native(p), { hidden: true, lock: true })
    const s = reducer(initialState(), { type: 'loadProject', project: p })
    expect(s.project).toEqual(p)
    expect(s.notice).toBe('')
  })
  it.each(['missing', 'R', 'widget', 'SC', 'RP'])('drops a %s holder with a repair notice and keeps the box', kind => {
    const p = project(), w = expandRoot({ type: 'panel', uid: 'pan1', params: sanitize(WIDGETS.panel, {}, themeOf(p)) }, themeOf(p)).root
    if (kind === 'widget') native(p).group = 'pan1'
    p.pages[0].scene.root = kind === 'missing' ? [] : kind === 'R' ? [node('R', { id: 'potato' })]
      : kind === 'widget' ? [w] : [node(kind, {}, [potato()])]
    const s = reducer(initialState(), { type: 'loadProject', project: p })
    expect(native(s.project)).not.toHaveProperty('group')
    expect(native(s.project).params).toEqual(native(p).params)
    expect(s.notice).toContain(`page p1 icon ico1: no ordinary group ${native(p).group}; it sits on the page`)
    expect(s.notice).toContain('Repaired project fields: page p1 natives')
  })
  it.each([false, 1, 'true', null])('drops flags other than true (%j)', flag => {
    const p = project(); Object.assign(native(p), { hidden: flag, lock: flag })
    const s = reducer(initialState(), { type: 'loadProject', project: p })
    expect(native(s.project)).not.toHaveProperty('hidden')
    expect(native(s.project)).not.toHaveProperty('lock')
    expect(native(s.project).group).toBe('potato')
  })
  it.each(['', 5, null])('drops a nonempty-string membership that is malformed (%j)', group => {
    const p = project(); Object.assign(native(p), { group })
    const s = reducer(initialState(), { type: 'loadProject', project: p })
    expect(native(s.project)).not.toHaveProperty('group')
    expect(s.notice).toContain('Repaired project fields: page p1 natives')
  })
  it('leaves an old project without native keys equal to its input', () => {
    const p = project(); delete native(p).group
    expect(reducer(initialState(), { type: 'loadProject', project: p }).project).toEqual(p)
  })
  it.each([undefined, null, { root: [null] }])('drops membership on an unreadable scene without blocking the checker (%j)', scene => {
    const p = project(); p.pages[0].scene = scene as never
    const s = reducer(initialState(), { type: 'loadProject', project: p })
    expect(native(s.project)).not.toHaveProperty('group')
    expect(native(s.project).params).toEqual(native(p).params)
    expect(s.notice).toContain('page p1 icon ico1: no ordinary group potato; it sits on the page')
  })
  it('setWidget changes only native params, retaining membership and flags and omitting edit', () => {
    const p = project(); Object.assign(native(p), { hidden: true, lock: true })
    const s = reducer(initialState(p), { type: 'setWidget', pageId: 'p1', ref: {
      type: 'icon', uid: 'ico1', params: { ...native(p).params, x: 200 } } })
    expect(native(s.project)).toEqual({ ...native(p), params: { ...native(p).params, x: 200 } })
    expect(native(s.project)).not.toHaveProperty('edit')
  })
})

describe('native selection sets', () => {
  const nsel: Selection = { pageId: 'p1', path: [], native: 'ico1' }, rsel: Selection = { pageId: 'p1', path: [1] }
  it.each([true, false])('keeps a node and native together (native primary=%s), once by last mention', primary => {
    const p = project([potato(), node('R')])
    const s = reducer(initialState(p), { type: 'select', selection: primary ? nsel : rsel, also: primary ? [nsel, rsel] : [nsel, nsel] })
    expect(selected(s)).toEqual(primary ? [rsel, nsel] : [nsel, rsel])
  })
  it.each([false, true])('drops a native whose holder is selected or under a selected ancestor (nested=%s)', nested => {
    const p = project(nested ? [node('G', {}, [potato()])] : [potato()]), group = { pageId: 'p1', path: [0] }
    const s = reducer(initialState(p), { type: 'select', selection: nsel, also: [group] })
    expect(selected(s)).toEqual([group])
  })
  it('drops foreign-page and absent native uids, including a missing primary', () => {
    const p = project([potato(), node('R')]); p.pages.push({ ...p.pages[0], id: 'p2', surface: 'second' })
    const s = reducer(initialState(p), { type: 'select', selection: rsel, also: [{ ...nsel, pageId: 'p2' }, { ...nsel, native: 'missing' }, nsel] })
    expect(selected(s)).toEqual([nsel, rsel])
    expect(selected(reducer(s, { type: 'select', selection: { ...nsel, native: 'missing' }, also: [rsel] }))).toEqual([rsel])
    expect(reducer(s, { type: 'select', selection: { ...nsel, native: 'missing' } }).selection).toBeNull()
  })
  it('keeps a DEFS primary lone', () => {
    const p = project([potato(), node('R')]), def = { pageId: 'p1', path: [0], inDefs: true }
    expect(selected(reducer(initialState(p), { type: 'select', selection: def, also: [rsel, nsel] }))).toEqual([def])
  })
  it('drops a removed native primary while retaining its scene member after an edit', () => {
    const p = project([potato(), node('R')]), before = reducer(initialState(p), { type: 'select', selection: nsel, also: [rsel] })
    const s = reducer(before, { type: 'editScene', pageId: 'p1', scene: p.pages[0].scene, natives: [] })
    expect(selected(s)).toEqual([rsel])
    expect(selected(reducer(s, { type: 'undo' }))).toEqual([rsel, nsel])
  })
  it('a native-only transient step writes and commits as one entry', () => {
    const p = project(), refs = [{ ...native(p), params: { ...native(p).params, x: 300 } }]
    const s = reducer(initialState(p), { type: 'editScene', pageId: 'p1', scene: p.pages[0].scene, natives: refs, transient: true })
    expect(native(s.project)).toBe(refs[0])
    expect(s.dragBase).toBe(p)
    expect(s.past).toHaveLength(0)
    const end = reducer(s, { type: 'commitDrag' })
    expect(end.past).toHaveLength(1)
    expect(reducer(end, { type: 'undo' }).project).toBe(p)
  })
})

describe('native scene integration', () => {
  it('editScene carries the holder and native in one undo and redo entry', () => {
    const p = project(), before = initialState(p), scene = { ...p.pages[0].scene, root: [potato({ t: [10, 5] })] }
    const next = reducer(before, { type: 'editScene', pageId: 'p1', scene })
    expect(native(next.project).params).toMatchObject({ x: 114.5, y: Math.fround(173.8) })
    expect(next.past).toHaveLength(1)
    const undo = reducer(next, { type: 'undo' })
    expect(undo.project).toBe(p)
    expect(reducer(undo, { type: 'redo' }).project).toBe(next.project)
  })
  it.each(['editScene', 'updateNode'] as const)('200 transient %s steps follow from the drag base exactly once', type => {
    const p = project(), original = native(p), scene = p.pages[0].scene
    let s = initialState(p)
    for (let i = 1; i <= 200; i++) {
      const n = potato({ t: [i * 0.1, 0] })
      s = reducer(s, type === 'editScene' ? { type, pageId: 'p1', scene: { ...scene, root: [n] }, transient: true }
        : { type, pageId: 'p1', path: [0], node: n, transient: true })
    }
    expect(native(s.project).params.x).toBe(Number(original.params.x) + 20)
    expect(s.past).toHaveLength(0)
    s = reducer(s, { type: 'commitDrag' })
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
    expect(reducer(reducer(s, { type: 'undo' }), { type: 'redo' }).project).toBe(s.project)
  })
  it('a drag back to the start restores identical natives and adds no entry', () => {
    const p = project(), before = initialState(p)
    let s = reducer(before, { type: 'editScene', pageId: 'p1', scene: { ...p.pages[0].scene, root: [potato({ t: [10, 0] })] }, transient: true })
    expect(native(s.project).params.x).toBe(114.5)
    s = reducer(s, { type: 'editScene', pageId: 'p1', scene: p.pages[0].scene, transient: true })
    s = reducer(s, { type: 'commitDrag' })
    expect(s.past).toHaveLength(0)
    expect(s.project).toBe(p)
    expect(s.project.pages[0].natives).toBe(p.pages[0].natives)
  })
  it('cancelDrag restores both the scene and native objects', () => {
    const p = project()
    const s = reducer(initialState(p), { type: 'editScene', pageId: 'p1', scene: { ...p.pages[0].scene, root: [potato({ t: [10, 0] })] }, transient: true })
    expect(native(s.project).params.x).toBe(114.5)
    expect(reducer(s, { type: 'cancelDrag' }).project).toBe(p)
  })
  it.each(['updateNode', 'setScene'] as const)('%s carries a panel or code-pane holder move', type => {
    const p = project(), n = potato({ t: [10, 5] })
    const s = reducer(initialState(p), type === 'updateNode' ? { type, pageId: 'p1', path: [0], node: n }
      : { type, pageId: 'p1', scene: { ...p.pages[0].scene, root: [n] } })
    expect(native(s.project).params).toMatchObject({ x: 114.5, y: Math.fround(173.8) })
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
  })
  it('setScene loses renamed membership, keeps the native box and names it in the notice', () => {
    const p = project(), s = reducer(initialState(p), { type: 'setScene', pageId: 'p1', scene: { ...p.pages[0].scene, root: [potato({ id: 'renamed', t: [10, 0] })] } })
    expect(native(s.project)).not.toHaveProperty('group')
    expect(native(s.project).params).toBe(native(p).params)
    expect(s.notice).toContain('ico1 left group potato: no ordinary group has that id now; it stays where it is, on the page (Ctrl+Z puts it back)')
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
  })
  it('explicit changed or added natives stay as given while untouched refs still follow', () => {
    const p = project(), untouched = { ...native(p), uid: 'ico2' }
    p.pages[0].natives!.push(untouched)
    const added = { ...native(p), uid: 'ico3', params: { ...native(p).params, x: 400 } }
    const refs = [{ ...native(p), params: { ...native(p).params, x: 300 } }, untouched, added]
    const s = reducer(initialState(p), { type: 'editScene', pageId: 'p1', scene: { ...p.pages[0].scene, root: [potato({ t: [10, 0] })] }, natives: refs })
    expect(native(s.project).params.x).toBe(300)
    expect(s.project.pages[0].natives![0]).toBe(refs[0])
    expect(s.project.pages[0].natives![1].params.x).toBe(114.5)
    expect(s.project.pages[0].natives![2]).toBe(added)
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
  })
  it.each(['base', 'current'] as const)('transient explicit lists from the %s move touched natives and follow untouched ones from the drag base', source => {
    const p = project(), held = { ...native(p), uid: 'ico2' }
    p.pages[0].natives!.push(held)
    let s = initialState(p)
    for (let i = 1; i <= 3; i++) {
      const refs = source === 'base' ? p.pages[0].natives! : s.project.pages[0].natives!
      const explicit = { ...refs[0], params: { ...refs[0].params, x: 200 + i } }
      s = reducer(s, { type: 'editScene', pageId: 'p1', transient: true,
        scene: { ...p.pages[0].scene, root: [potato({ t: [i * 0.1, 0] })] }, natives: [explicit, refs[1]] })
      expect(native(s.project)).toBe(explicit)
      expect(s.project.pages[0].natives![1].params.x).toBe(Math.fround(104.5 + i * 0.1))
    }
    const once = reducer(initialState(p), { type: 'editScene', pageId: 'p1', scene: { ...p.pages[0].scene, root: [potato({ t: [0.3, 0] })] } })
    expect(s.project.pages[0].natives![1]).toEqual(once.project.pages[0].natives![1])
    s = reducer(s, { type: 'commitDrag' })
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
  })
  it('an explicit native-only edit is one history entry and takes removed native bindings', () => {
    const p = project(); p.bindings = { '@ico1.name': { from: 'expr', expr: '"name"' }, '@ico2.name': { from: 'expr', expr: '"other"' } }
    const s = reducer(initialState(p), { type: 'editScene', pageId: 'p1', scene: p.pages[0].scene, natives: [] })
    expect(s.project.pages[0].natives).toEqual([])
    expect(s.project.bindings).not.toHaveProperty('@ico1.name')
    expect(s.project.bindings).toHaveProperty('@ico2.name')
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
  })
  it.each([true, false])('inserts a native into an entered group (named=%s) with one entry and selection', named => {
    const p = project([node('G', named ? { id: 'potato' } : {}, [node('R', { w: 200, h: 200 })])]); p.pages[0].natives = []
    const before = reducer(initialState(p), { type: 'enter', pageId: 'p1', path: [0] })
    const s = reducer(before, { type: 'insertWidget', pageId: 'p1', widget: 'icon' })
    expect(native(s.project).group).toBe(named ? 'potato' : 'group_1')
    expect(s.project.pages[0].scene.root[0].attrs.id).toBe(named ? 'potato' : 'group_1')
    expect(s.selection).toEqual({ pageId: 'p1', path: [], native: 'ico1' })
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
  })
  it('inserts on the page when the entered widget cannot hold, with its reason', () => {
    const p = project(), t = themeOf(p), w = expandRoot({ type: 'panel', uid: 'pan1', params: sanitize(WIDGETS.panel, {}, t) }, t)
    p.pages[0].scene = { ...p.pages[0].scene, root: [w.root], defs: w.defs }; p.pages[0].natives = []
    const before = reducer(initialState(p), { type: 'enter', pageId: 'p1', path: [0] })
    const s = reducer(before, { type: 'insertWidget', pageId: 'p1', widget: 'icon' })
    expect(native(s.project)).not.toHaveProperty('group')
    expect(s.notice).toContain('a native never sits inside a widget')
    expect(s.past).toHaveLength(1)
    expect(s.selection?.native).toBe('ico1')
  })

  const layout: LayoutRecord = { dir: 'column', pad: [0, 0, 0, 0], gap: 10, align: 'start', justify: 'start', size: 'hug', box: [0, 0, 500, 500] }
  function laid() {
    const p = project(), t = themeOf(p)
    const w = expandRoot({ type: 'readoutrow', uid: 'row1', params: sanitize(WIDGETS.readoutrow, { h: 1 }, t) }, t)
    const outer = withLayout(node('G', { id: 'layout' }, [w.root, potato()]), layout)
    p.pages[0].scene = reflow({ ...p.pages[0].scene, root: [outer], defs: w.defs }, [0], t).scene
    return p
  }
  it.each(['setTheme', 'setWidget', 'deleteWidget'] as const)('%s follows a holder moved by layout reflow', type => {
    const p = laid(), t = themeOf(p), before = initialState(p), oldScene = p.pages[0].scene
    const w = widgetAt(oldScene, [0, 0], t)!
    const s = reducer(before, type === 'setTheme' ? { type, theme: 'vanilla-plus' } : type === 'setWidget'
      ? { type, pageId: 'p1', ref: { ...w, params: { ...w.params, h: Number(w.params.h) + 20 } } } : { type, pageId: 'p1', uid: 'row1' })
    const nowScene = s.project.pages[0].scene, nowT = themeOf(s.project)
    const from = innerFrame(oldScene, holderOf(oldScene, native(p), t)!)!, to = innerFrame(nowScene, holderOf(nowScene, native(s.project), nowT)!)!
    const dy = to[5] - from[5]
    expect(dy).not.toBe(0)
    expect(Number(native(s.project).params.y) - Number(native(p).params.y)).toBeCloseTo(dy, 3)
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
  })
  it('inserting a scene widget carries holders moved by layout in the same entry', () => {
    const p = project(), t = themeOf(p), outer = withLayout(node('G', { id: 'layout' }, [potato()]), { ...layout, dir: 'row', size: 'fixed', justify: 'end' })
    p.pages[0].scene = reflow({ ...p.pages[0].scene, root: [outer] }, [0], t).scene
    const before = reducer(initialState(p), { type: 'enter', pageId: 'p1', path: [0] }), x = innerFrame(p.pages[0].scene, [0, 0])![4]
    const s = reducer(before, { type: 'insertWidget', pageId: 'p1', widget: 'button' })
    const moved = innerFrame(s.project.pages[0].scene, [0, 0])![4] - x
    expect(moved).not.toBe(0)
    expect(Number(native(s.project).params.x) - Number(native(p).params.x)).toBeCloseTo(moved, 3)
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
  })
})
