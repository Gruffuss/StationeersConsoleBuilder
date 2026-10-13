import { describe, expect, it } from 'vitest'
import type { Scene } from '../model/scene'
import { initialState } from '../model/store'
import { node } from '../model/testing'
import { invalid, tooLarge, type Checked } from '../srctext/check'
import { makeCtx, membersOf, nativeMembersOf, paramsOf, sameShape, selectionOf } from './ctx'
import { DEFAULTS } from './settings'
import { harness } from './testing'

const R = node('R', { x: 1, y: 1, w: 2, h: 2 })
const scene = (root = [R], w = 460): Scene => ({ header: { w, h: w, fit: 'contain' }, defs: [], root })
const clean = (): Checked => ({ errors: [], warnings: [], src: 'R', order: { ops: [], nodes: [] } })

it('nativeMembersOf returns active-page selected native selections while membersOf stays scene-only', () => {
  const ref = { type: 'icon', uid: 'ico1', params: { x: 10, y: 20, w: 30, h: 30, kind: 'gas', name: 'Oxygen' } }
  const native = { pageId: 'p1', path: [], native: 'ico1' }, r = { pageId: 'p1', path: [0] }
  const h = harness(scene(), { natives: [ref], sel: native, also: [r, { ...native, pageId: 'p2' }, { ...native, native: 'missing' }] })
  expect(nativeMembersOf(h.ctx)).toEqual([native])
  expect(membersOf(h.ctx)).toEqual([r])
})

it('apply carries an explicit native list through a native-only edit', async () => {
  const ref = { type: 'icon', uid: 'ico1', params: { x: 10, y: 20, w: 30, h: 30, kind: 'gas', name: 'Oxygen' } }
  const h = harness(scene(), { natives: [ref] }), refs = [{ ...ref, hidden: true as const }]
  expect(await h.ctx.apply({ scene: h.scene(), natives: refs })).toBeNull()
  expect(h.ctx.page().natives).toEqual(refs)
  expect(h.state().past).toHaveLength(1)
})
it('checked apply refuses an explicit native list when the natives changed during its check', async () => {
  const ref = { type: 'icon', uid: 'ico1', params: { x: 10, y: 20, w: 30, h: 30, kind: 'gas', name: 'Oxygen' } }
  const h = harness(scene(), { natives: [ref] }), before = h.scene()
  const late = h.ctx.apply({ scene: before, natives: [] }, { check: true })
  h.ctx.dispatch({ type: 'setWidget', pageId: 'p1', ref: { ...ref, params: { ...ref.params, x: 40 } } })
  expect(await late).toBe('the natives changed while this was checked; not applied')
  expect(h.ctx.page().natives?.[0].params.x).toBe(40)
  expect(h.notes).toContain('the natives changed while this was checked; not applied')
  expect(h.state().past).toHaveLength(1)
})

describe('sameShape', () => {
  it('compares ops and child counts at every level, skipping identical objects', () => {
    const g = node('G', {}, [R])
    expect(sameShape([g], [{ ...g, attrs: { t: [1, 1] } }])).toBe(true)
    expect(sameShape([g], [node('G', {}, [R, R])])).toBe(false)
    expect(sameShape([g], [node('G', {}, [node('C')])])).toBe(false)
    expect(sameShape([R], [R, R])).toBe(false)
  })
  it("sees what a symbol's numbering hangs on: a USE's ref, a SYM's id and, where a symbol takes %params, their arguments", () => {
    const use = node('USE', { ref: 'a', t: [0, 0] }), sym = node('SYM', { id: 'a', kind: 'R' }, [R])
    expect(sameShape([use], [{ ...use, attrs: { ref: 'a', t: [5, 0] } }])).toBe(true)   // a drag
    expect(sameShape([use], [{ ...use, attrs: { REF: 'b', t: [0, 0] } }])).toBe(false)
    expect(sameShape([sym], [{ ...sym, attrs: { id: 'b', kind: 'R' } }])).toBe(false)
    expect(sameShape([sym], [{ ...sym, attrs: { id: 'a', kind: 'C' } }])).toBe(true)
    // An argument a %param reads, as a USE's attribute or a SYM's default; any case.
    const reads = paramsOf([node('SYM', { id: 'a' }, [node('%Kind')])])!
    expect(sameShape([sym], [{ ...sym, attrs: { id: 'a', kind: 'C' } }], reads)).toBe(false)
    expect(sameShape([use], [{ ...use, attrs: { ref: 'a', t: [0, 0], KIND: 'C' } }], reads)).toBe(false)
    expect(sameShape([use], [{ ...use, attrs: { ref: 'a', t: [5, 0] } }], reads)).toBe(true)   // a drag still keeps it
  })
  it('paramsOf: the arguments a %param in DEFS reads (in an op, a USE\'s ref or a nested USE\'s argument), none without a %', () => {
    expect(paramsOf([node('SYM', { id: 'a', w: '%w' }, [node('R', { w: '%w' })])])).toBeUndefined()   // not an op or a USE's
    const reads = paramsOf([node('SYM', { id: 'a' }, [node('R%shape'), node('USE', { ref: '%r', n: ['x', '%inner'] })])])!
    expect(['shape', 'R', 'INNER', 'w'].map(reads)).toEqual([true, true, true, false])
  })
})

describe('the editing context', () => {
  it.each([true, false])('picking returns enter intent without changing editor state (deep=%s)', deep => {
    const target = { pageId: 'p1', path: deep ? [0, 0] : [1] }
    const h = harness(scene([node('G', {}, [R]), R]), { pick: () => target })
    if (!deep) h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: deep ? [1] : [0, 0] } })
    const before = h.state(), actions = h.actions.length
    const picked = h.ctx.pick({ x: 1, y: 1 }, deep)
    expect(h.state()).toBe(before)
    expect(h.actions).toHaveLength(actions)
    expect(picked).toEqual({ target, enter: { type: 'enter', pageId: 'p1', path: deep ? [0] : [] } })
  })
  it('converts surface px, design units and CSS px for the active page at the zoom', () => {
    const h = harness(scene([R], 480))   // a 460 px page: one unit is 460/480 px
    h.ctx.setView({ zoom: 2, pan: { x: 0, y: 0 } })
    const v = h.ctx.view()
    expect(v.size).toEqual({ w: 480, h: 480 })
    const u = v.toUnits({ x: 46, y: 23 })
    expect(u.x).toBeCloseTo(48, 9)
    expect(u.y).toBeCloseTo(24, 9)
    expect(v.css({ x: 48, y: 24 }).x).toBeCloseTo(92, 9)
    expect(v.threshold).toBeCloseTo(8 / (2 * 460 / 480), 9)
    const g = harness(scene([node('G', { t: [10, 0] }, [R])]))
    expect(g.ctx.view().world([0, 0])!.map(x => x + 0)).toEqual([1, 0, 0, 1, 10, 0])   // + 0: no -0
  })
  it('keeps the numbering while an edit only moves numbers, and drops it after a structural one until its check lands', async () => {
    const h = harness(scene())
    await h.checker.check(h.scene())
    expect(h.ctx.order()?.nodes).toEqual([0])
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: scene([{ ...R, attrs: { ...R.attrs, x: 5 } }]), transient: true })
    expect(h.ctx.order()?.nodes).toEqual([0])
    h.ctx.dispatch({ type: 'commitDrag' })
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: scene([...h.root(), node('C', { cx: 1, cy: 1, rx: 1 })]) })
    expect(h.ctx.order()).toBeUndefined()
    await h.checker.check(h.scene())
    expect(h.ctx.order()?.nodes).toEqual([0, 1])
  })
  it('apply: lands an unchecked edit at once as one undo step, with the selection it names', async () => {
    const h = harness(scene()), next = scene([R, R])
    expect(await h.ctx.apply({ scene: next, selection: [{ pageId: 'p1', path: [1] }] })).toBeNull()
    expect(h.scene()).toBe(next)
    expect(h.state().past).toHaveLength(1)
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [1] })
  })
  it('apply with check: lands a clean scene, refuses an invalid one with its reason, drops one the page moved under', async () => {
    const bad = scene([R, R, R])
    const h = harness(scene(), { verdict: s => s.root.length === 3 ? invalid('three is too many') : clean() })
    const good = scene([R, R])
    expect(await h.ctx.apply({ scene: good }, { check: true })).toBeNull()
    expect(h.scene()).toBe(good)
    expect(await h.ctx.apply({ scene: bad }, { check: true })).toBe('three is too many')
    expect(h.scene()).toBe(good)
    expect(h.notes).toContain('three is too many')
    const late = h.ctx.apply({ scene: scene([R]) }, { check: true })
    const meanwhile = scene([node('C', { cx: 1, cy: 1, rx: 1 })])
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: meanwhile })
    expect(await late).toBe('the scene changed while this was checked; not applied')
    expect(h.scene()).toBe(meanwhile)
  })
  it('apply with check: a scene too large to check here lands all the same, its reason said as information (M2b final-wave ruling 1)', async () => {
    const h = harness(scene(), { verdict: () => tooLarge('x') }), next = scene([R, R])
    expect(await h.ctx.apply({ scene: next, selection: [{ pageId: 'p1', path: [1] }] }, { check: true })).toBeNull()
    expect(h.scene()).toBe(next)
    expect(h.state().past).toHaveLength(1)
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [1] })
    expect(h.notes).toEqual([tooLarge('x').errors[0].message])
  })
  it('converts at any design size the mod takes: a SCENE of 1e9 units is still pressable', () => {
    const h = harness(scene([R], 1e9))
    const u = h.ctx.view().toUnits({ x: 230, y: 115 })
    expect(u.x).toBeCloseTo(5e8, 0)
    expect(u.y).toBeCloseTo(2.5e8, 0)
    expect(() => h.click({ x: 230, y: 115 })).not.toThrow()
  })
  it('apply with check, before the checker is up: not applied, and says why', async () => {
    const h = harness(scene())
    const ctx = makeCtx({ get: () => h.state(), dispatch: h.ctx.dispatch, checker: () => null, frame: () => null, pick: () => null,
      redraw: () => {}, note: h.ctx.note, storage: null })
    expect(await ctx.apply({ scene: scene([R, R]) }, { check: true })).toBe('the checker is not ready; not applied')
    expect(h.root()).toHaveLength(1)
    expect(h.notes).toEqual(['the checker is not ready; not applied'])
  })
  it('turns an Edit selection into the action fields', () => {
    const a = { pageId: 'p1', path: [0] }, b = { pageId: 'p1', path: [1] }
    expect(selectionOf(undefined)).toEqual({})
    expect(selectionOf([])).toEqual({ selection: null, also: [] })
    expect(selectionOf([a, b])).toEqual({ selection: b, also: [a] })
  })
  it('switches tools, telling the hooks; settings change and are read back', () => {
    const h = harness(scene()), told: string[] = []
    h.ctx.onTool(id => told.push(id))
    h.ctx.setTool('rect')
    h.ctx.setTool('rect')
    expect(h.ctx.tool()).toBe('rect')
    expect(told).toEqual(['rect'])
    h.ctx.setSettings({ grid: 10 })
    expect(h.ctx.settings()).toEqual({ grid: 10, snap: true })
  })
  it('settings: kept per browser, rendered again on a change, and held to what loading would read back', () => {
    const m = new Map<string, string>(), storage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    let redraws = 0
    const deps = { get: () => initialState(), dispatch: () => {}, checker: () => null, frame: () => null, pick: () => null,
      redraw: () => { redraws++ }, note: () => {}, storage }
    const ctx = makeCtx(deps)
    expect(ctx.settings()).toEqual(DEFAULTS)
    ctx.setSettings({ grid: 7.6, snap: false })
    expect(ctx.settings()).toEqual({ grid: 8, snap: false })
    expect(redraws).toBe(1)
    ctx.setSettings({ grid: NaN, snap: 'yes' as unknown as boolean })
    ctx.setSettings({ grid: -2 })
    expect(ctx.settings()).toEqual({ grid: 8, snap: false })
    expect(makeCtx(deps).settings()).toEqual({ grid: 8, snap: false })   // a reload reads back what this session used
  })
  it('lists the set\'s root-tree members on the active page: not a DEFS node, not another page\'s', () => {
    const h = harness(scene([R, R]), { sel: { pageId: 'p1', path: [1] }, also: [{ pageId: 'p1', path: [0] }] })
    expect(membersOf(h.ctx)).toEqual([{ pageId: 'p1', path: [0] }, { pageId: 'p1', path: [1] }])
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0], inDefs: true } })
    expect(membersOf(h.ctx)).toEqual([])
  })
  it("withholds the numbering when a USE's ref, a SYM's id or a parametrised symbol's argument changes, until its check lands", async () => {
    const sym = (id: string, op = 'R') => node('SYM', { id }, [node(op, { x: 0, y: 0, w: 1, h: 1 })])
    const withUse = (ref: string, defs = [sym('a'), sym('b', 'C')], kind?: string, t = [0, 0]) =>
      ({ ...scene([node('USE', { ref, t, ...(kind && { kind }) })]), defs })
    const h = harness(withUse('a'))
    await h.checker.check(h.scene())
    expect(h.ctx.order()).toBeDefined()
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: withUse('b') })
    expect(h.ctx.order()).toBeUndefined()
    await h.checker.check(h.scene())
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: withUse('b', [sym('b'), sym('a', 'C')]) })   // the ids swapped
    expect(h.ctx.order()).toBeUndefined()
    const params = [sym('a', '%kind')]
    const p = harness(withUse('a', params, 'R'))
    await p.checker.check(p.scene())
    expect(p.ctx.order()).toBeDefined()
    p.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: withUse('a', params, 'R', [5, 0]) })   // a drag keeps it
    expect(p.ctx.order()).toBeDefined()
    p.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: withUse('a', params, 'bogus') })   // now an op the mod drops
    expect(p.ctx.order()).toBeUndefined()
  })
  it('withholds the numbering when the defs change shape (a USE may expand otherwise: a load, a pasted symbol), until its check lands', async () => {
    const h = harness(scene())
    await h.checker.check(h.scene())
    expect(h.ctx.order()).toBeDefined()
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...scene(), defs: [node('SYM', { id: 's' }, [R])] } })
    expect(h.ctx.order()).toBeUndefined()
  })
})
