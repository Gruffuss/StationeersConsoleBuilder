import { describe, expect, it } from 'vitest'
import { newProject } from '../model/project'
import type { Scene, SrcNode } from '../model/scene'
import { node } from '../model/testing'
import { DEFAULT_THEME, THEMES } from '../theme'
import { expandRoot, sanitize } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import type { WidgetRef } from '../widgets/types'
import { apply, type Mat } from '../editor/geometry'
import { canHold, carry, drawOrder, followNatives, heldBox, holderFor, holderOf, holders, idsIn, innerFrame, moveNatives, nativeHitAt, nativeTargets, nativeUnitsOf, nativesUnder, shownNatives, transformNatives, withFlag } from './natives'

const t = THEMES[DEFAULT_THEME], I: Mat = [1, 0, 0, 1, 0, 0]
type Ref = WidgetRef & { group?: string; hidden?: true; lock?: true }
const icon = (extra: Partial<Ref> = {}): Ref => ({ type: 'icon', uid: 'ico1',
  params: sanitize(WIDGETS.icon, { x: 104.5, y: 168.8, w: 20, h: 30, kind: 'gas', name: 'Oxygen' }, t), group: 'potato', ...extra })
const scene = (root: SrcNode[]): Scene => ({ header: { w: 960, h: 960, fit: 'contain' }, defs: [], root })
const g = (attrs: SrcNode['attrs'] = {}, c = [node('R', { w: 200, h: 200 })]) => node('G', { id: 'potato', ...attrs }, c)
const widget = () => expandRoot({ type: 'panel', uid: 'pan1', params: sanitize(WIDGETS.panel, {}, t) }, t).root

describe('native holder frames', () => {
  it('translates an icon with its holder', () => {
    const out = followNatives(scene([g()]), scene([g({ t: [10, 5] })]), [icon()], t)
    expect(out.natives[0].params).toMatchObject({ x: 114.5, y: Math.fround(173.8), w: 20, h: 30 })
    expect(out.lost).toEqual([])
  })
  it('scales the centre and box about a pivot and the text input font with height', () => {
    const text = icon({ type: 'textinput', uid: 'ti1', params: sanitize(WIDGETS.textinput, { x: 10, y: 20, w: 40, h: 30, fontSize: 12 }, t) })
    const out = followNatives(scene([g()]), scene([g({ a: [10, 10], s: [2, 2] })]), [text], t)
    expect(out.natives[0].params).toMatchObject({ x: 10, y: 30, w: 80, h: 60, fontSize: 24 })
  })
  it('turns the centre a quarter turn while keeping the box upright', () => {
    const ref = icon({ params: { ...icon().params, x: 20, y: 30 } })
    const out = followNatives(scene([g()]), scene([g({ a: [10, 10], r: 90 })]), [ref], t)
    expect(out.natives[0].params).toMatchObject({ x: -35, y: 15, w: 20, h: 30 })
  })
  it('uses column norms for non-uniform scale under a turn', () => {
    const ref = carry(icon(), I, [0, 2, -3, 0, 0, 0], t)
    expect(ref.params.w).toBe(40)
    expect(ref.params.h).toBe(90)
    const p = ref.params
    expect(Number(p.x) + Number(p.w) / 2).toBeCloseTo(-551.4, 3)
    expect(Number(p.y) + Number(p.h) / 2).toBe(229)
  })
  it.each<SrcNode['attrs']>([{ t: ['=x', 0] }, { s: [0, 1] }])('skips an expression or singular frame %j before or after', attrs => {
    const refs = [icon()]
    for (const [a, b] of [[scene([g(attrs)]), scene([g()])], [scene([g()]), scene([g(attrs)])]]) {
      expect(followNatives(a, b, refs, t).natives).toBe(refs)
    }
    expect(innerFrame(scene([g(attrs)]), [0])).toBeNull()
  })
  it('keeps the same ref for relative identity and rounded noise', () => {
    const ref = icon()
    expect(carry(ref, I, [1 + 1e-10, 0, 0, 1, 0, 0], t)).toBe(ref)
    const refs = [ref]
    expect(followNatives(scene([g()]), scene([g({ t: [0.0001, 0] })]), refs, t).natives).toBe(refs)
  })
  it('keeps the same array for an equivalent reparent frame and for reordered holders', () => {
    const refs = [icon()], before = scene([g({ t: [10, 5] }), node('R')])
    const after = scene([node('G', { t: [7, 2] }, [g({ t: [3, 3] })])])
    expect(followNatives(before, after, refs, t).natives).toBe(refs)
    expect(followNatives(before, scene([node('R'), before.root[0]]), refs, t).natives).toBe(refs)
  })
})

describe('natives as editable units', () => {
  const page = (refs: Ref[], root = [g()]) => ({ ...newProject().pages[0], scene: scene(root), natives: refs })
  const sel = (native: string, pageId = 'p1') => ({ pageId, path: [], native })
  it('reads native units by uid with page-space boxes and own/holder-chain locks', () => {
    const refs = [icon(), icon({ uid: 'ico2', group: undefined, lock: true }), icon({ uid: 'ico3', group: undefined })]
    const p = page(refs, [node('G', {}, [{ ...g(), comments: ['lock'] }])])
    const units = nativeUnitsOf(p, [sel('ico1'), sel('ico2'), sel('ico3'), sel('ico3'), sel('missing'), sel('ico1', 'p2')], t)
    expect(units.map(u => [u.ref.uid, u.locked])).toEqual([['ico1', 'locked'], ['ico2', 'locked'], ['ico3', null]])
    expect(units[0].ref).toBe(refs[0])
    expect(units[0].box).toEqual({ x: 104.5, y: Math.fround(168.8), w: 20, h: 30 })
  })
  it('moves by whole units, skips locked units and preserves every untouched ref', () => {
    const refs = [icon(), icon({ uid: 'ico2', lock: true }), icon({ uid: 'ico3' })], p = page(refs)
    const out = moveNatives(refs, nativeUnitsOf(p, [sel('ico1'), sel('ico2')], t), [{ dx: 0.4, dy: 0 }, { dx: 10, dy: 2 }], t)
    expect(out.natives[0].params).toMatchObject({ x: 105, y: Math.fround(168.8) })
    expect(out.skipped).toEqual(['1 skipped: locked'])
    expect(out.natives[1]).toBe(refs[1]); expect(out.natives[2]).toBe(refs[2])
  })
  it('preserves no-op arrays and refuses positions outside float32', () => {
    const refs = [icon({ params: { ...icon().params, x: 100, y: 20 } })], units = nativeUnitsOf(page(refs), [sel('ico1')], t)
    expect(moveNatives(refs, units, [{ dx: 0.1, dy: 0 }], t).natives).toBe(refs)
    const out = moveNatives(refs, units, [{ dx: 1e300, dy: 0 }], t)
    expect(out.natives).toBe(refs)
    expect(out.skipped).toEqual(['1 skipped: the value left float32'])
  })
  it('scales about a point in whole units, at least 1 a side, including text font height', () => {
    const refs = [icon({ type: 'textinput', uid: 'ti1', params: sanitize(WIDGETS.textinput, { x: 10, y: 20, w: 40, h: 30, fontSize: 12 }, t) })]
    const units = nativeUnitsOf(page(refs), [sel('ti1')], t)
    const out = transformNatives(refs, units, [2, 0, 0, 2, -10, -10], t)
    expect(out.natives[0].params).toMatchObject({ x: 10, y: 30, w: 80, h: 60, fontSize: 24 })
    expect(out.upright).toEqual([])
    const tiny = transformNatives(refs, units, [0.001, 0, 0, 0.001, 0, 0], t)
    expect(tiny.natives[0].params).toMatchObject({ w: 1, h: 1 })
  })
  it.each([90, 180])('turns a centre %s degrees, keeps upright size and names the native', angle => {
    const refs = [icon({ params: { ...icon().params, x: 20, y: 30 } })], units = nativeUnitsOf(page(refs), [sel('ico1')], t)
    const m: Mat = angle === 90 ? [0, 1, -1, 0, 20, 0] : [-1, 0, 0, -1, 20, 20]
    const out = transformNatives(refs, units, m, t)
    expect(out.natives[0].params).toMatchObject(angle === 90 ? { x: -35, y: 15, w: 20, h: 30 } : { x: -20, y: -40, w: 20, h: 30 })
    expect(out.upright).toEqual(['ico1'])
  })
  it('skips locked transforms and preserves identity and untouched refs', () => {
    const refs = [icon({ lock: true }), icon({ uid: 'ico2' })], units = nativeUnitsOf(page(refs), [sel('ico1')], t)
    expect(transformNatives(refs, units, [2, 0, 0, 2, 0, 0], t)).toEqual({ natives: refs, skipped: ['1 skipped: locked'], upright: [] })
    expect(transformNatives(refs, nativeUnitsOf(page(refs), [sel('ico2')], t), I, t).natives).toBe(refs)
  })
  it('reports non-finite transforms and deltas instead of silently calling them no-ops', () => {
    const refs = [icon()], units = nativeUnitsOf(page(refs), [sel('ico1')], t)
    expect(transformNatives(refs, units, [Infinity, 0, 0, 1, 0, 0], t)).toEqual({ natives: refs, skipped: ['1 skipped: the value left float32'], upright: [] })
    expect(moveNatives(refs, units, [{ dx: NaN, dy: 0 }], t)).toEqual({ natives: refs, skipped: ['1 skipped: the value left float32'] })
  })
  it('heldBox joins shown natives at any depth while excluding hidden natives and hidden holder chains', () => {
    const refs = [icon({ params: { ...icon().params, x: 10, y: 20, w: 20, h: 30 } }),
      icon({ uid: 'ico2', group: 'deep', params: { ...icon().params, x: 60, y: 5, w: 20, h: 10 } }),
      icon({ uid: 'ico3', hidden: true, params: { ...icon().params, x: 999 } }),
      icon({ uid: 'ico4', group: 'hidden', params: { ...icon().params, x: 999 } })]
    const s = scene([g({}, [g({ id: 'deep' }), g({ id: 'hidden', v: 0 })])])
    expect(heldBox(s, refs, [0], t)).toEqual({ x: 10, y: 5, w: 70, h: 45 })
    expect(heldBox(s, refs, [0, 0], t)).toEqual({ x: 60, y: 5, w: 20, h: 10 })
  })
  it('nativeTargets returns shown design boxes except skipped uids, retaining locked snap targets', () => {
    const refs = [icon(), icon({ uid: 'ico2', hidden: true }), icon({ uid: 'ico3', lock: true })]
    expect(nativeTargets(page(refs), t, new Set(['ico1']))).toEqual([{ x: 104.5, y: Math.fround(168.8), w: 20, h: 30 }])
  })
})

describe('membership', () => {
  it('finds the first id in pre-order, including numeric ids and folded G', () => {
    const s = scene([node('G', {}, [g()]), g(), node('g', { id: 5 })])
    expect(holders(s, ['potato', '5'], t)).toEqual(new Map([['potato', [0, 0]], ['5', [2]]]))
    expect(holderOf(s, icon(), t)).toEqual([0, 0])
    expect(holderOf(s, icon({ group: undefined }), t)).toBeNull()
    expect(canHold(s, [], t)).toBe(false)
  })
  it.each(['missing', 'R', 'widget', 'SC', 'RP', 'in-widget'])('loses a holder that is %s, keeping its box', kind => {
    const w = widget()
    const root = kind === 'missing' ? [] : kind === 'R' ? [node('R', { id: 'potato' }), g()]
      : kind === 'widget' ? [w, g({ id: 'pan1' })] : kind === 'in-widget' ? [{ ...widget(), c: [g()] }]
      : [node(kind, {}, [g()])]
    const before = scene([g()]), after = scene(root), ref = icon(kind === 'widget' ? { group: 'pan1' } : {})
    expect(holders(after, [ref.group!], t).size).toBe(0)
    const out = followNatives(before, after, [ref], t)
    expect(out.lost).toEqual(['ico1'])
    expect(out.natives[0]).not.toHaveProperty('group')
    expect(out.natives[0].params).toBe(ref.params)
  })
  it('collects natives held at or under selected paths only', () => {
    const refs = [icon(), icon({ uid: 'ico2', group: 'other' }), icon({ uid: 'ico3', group: undefined })]
    expect(nativesUnder(scene([node('G', {}, [g()]), g({ id: 'other' })]), refs, [[0]], t)).toEqual([refs[0]])
  })
  it('returns an existing holder id without rewriting its scene', () => {
    const p = newProject(), s = scene([g()])
    expect(holderFor(p, 'p1', s, [0], t)).toEqual({ scene: s, id: 'potato' })
    expect(holderFor(p, 'p1', scene([g({ id: 5 })]), [0], t)).toMatchObject({ id: '5' })
  })
  it.each(['id', 'uid'])('allocates a free group id with another page holding its %s', kind => {
    const p = newProject(), s = scene([node('G', {}, [])])
    p.pages.push({ ...p.pages[0], id: 'p2', scene: scene([g({ id: kind === 'id' ? 'group_1' : kind === 'stem' ? 'group_1_extra' : 'other' })]),
      ...(kind === 'uid' && { natives: [icon({ uid: 'group_1' })] }) })
    const out = holderFor(p, 'p1', s, [0], t)
    expect(out).toMatchObject({ id: 'group_2' })
    if ('scene' in out) expect(out.scene.root[0].attrs.id).toBe('group_2')
    expect(idsIn(p, t).taken.size).toBeGreaterThan(0)
    expect(holderFor(newProject(), 'p1', s, [0], t)).toMatchObject({ id: 'group_1' })
  })
  it('refuses naming a pointer scope, but respects a child id', () => {
    const p = newProject(), child = node('R', { v: '=hover' })
    const out = holderFor(p, 'p1', scene([node('G', {}, [child])]), [0], t)
    expect(out).toEqual({ refused: 'this group has no id, and giving it one would change what hover and down inside it answer to; name the group yourself if that is meant' })
    expect(holderFor(p, 'p1', scene([node('G', {}, [{ ...child, attrs: { ...child.attrs, id: 'own' } }])]), [0], t)).toMatchObject({ id: 'group_1' })
  })
  it.each([{ o: '=0.5+0.5*hover' }, { v: '{=down}' }] as SrcNode['attrs'][])('refuses naming a group whose own attrs read a pointer (%j)', attrs => {
    const p = newProject(), s = scene([node('G', attrs, [node('R')])])
    expect(holderFor(p, 'p1', s, [0], t)).toMatchObject({ refused: expect.stringContaining('change what hover and down') })
    expect(s.root[0].attrs).toEqual(attrs)
  })
  it.each(['G', 'R'])('refuses joining a later duplicate id when its first node is %s', op => {
    const p = newProject(), s = scene([node(op, { id: 'potato' }), node('G', { id: 'potato' }, [node('R')])])
    expect(holderFor(p, 'p1', s, [1], t)).toMatchObject({ refused: expect.stringContaining('first with id potato') })
    expect(s.root[1].attrs.id).toBe('potato')
  })
  it('respects numeric child ids as existing pointer scopes when naming a holder', () => {
    const p = newProject(), s = scene([node('G', {}, [node('R', { id: 5, v: '=hover' })])])
    expect(holderFor(p, 'p1', s, [0], t)).toMatchObject({ id: 'group_1' })
  })
  it('refuses widgets and scrolling/repeating ancestors', () => {
    const p = newProject()
    expect(holderFor(p, 'p1', scene([widget()]), [0], t)).toEqual({ refused: 'a native never sits inside a widget' })
    for (const op of ['SC', 'RP']) expect(holderFor(p, 'p1', scene([node(op, {}, [g()])]), [0, 0], t))
      .toEqual({ refused: 'a native cannot follow scrolling or repeating' })
  })
})

describe('visibility, flags and picking', () => {
  it('omits own hidden and literal hidden holder chains, but keeps expression visibility', () => {
    const p = newProject().pages[0]
    p.natives = [icon()]
    for (const s of [scene([g({ v: 0 })]), scene([node('G', { v: 0 }, [g()])])]) expect(shownNatives({ ...p, scene: s }, t)).toEqual([])
    expect(shownNatives({ ...p, scene: scene([g({ v: '=live' })]) }, t).map(x => x.uid)).toEqual(['ico1'])
    expect(shownNatives({ ...p, natives: [icon({ hidden: true })] }, t)).toEqual([])
  })
  it('orders expansions by z_index then declaration', () => {
    const refs = [icon({ type: 'textinput', uid: 'ti1' }), icon(), icon({ uid: 'ico2' })]
    expect(drawOrder(refs, t).map(n => n.uid)).toEqual(['ico1', 'ico2', 'ti1'])
  })
  it('picks the topmost native in surface px through the header fit', () => {
    const p = { ...newProject().pages[0], scene: scene([g()]), natives: [icon(), icon({ uid: 'ico2' }), icon({ type: 'textinput', uid: 'ti1' })] }
    const [x, y] = apply([460 / 960, 0, 0, 460 / 960, 0, 0], 114.5, 178.8)
    expect(nativeHitAt(p, t, { x, y })?.uid).toBe('ti1')
    p.natives.pop()
    expect(nativeHitAt(p, t, { x, y })?.uid).toBe('ico2')
    expect(nativeHitAt(p, t, { x: 114.5, y: 178.8 })).toBeNull()
  })
  it('picks through hidden, own locked and locked holder chains', () => {
    const p = { ...newProject().pages[0], scene: scene([{ ...g(), comments: ['lock'] }]),
      natives: [icon({ uid: 'ico0', group: undefined }), icon(), icon({ uid: 'ico2', group: undefined, hidden: true }), icon({ uid: 'ico3', group: undefined, lock: true })] }
    const x = 114.5 * 460 / 960, y = 178.8 * 460 / 960
    expect(nativeHitAt(p, t, { x, y })?.uid).toBe('ico0')
  })
  it('toggles flags with omitted false keys, preserving no-op arrays', () => {
    const refs = [icon(), icon({ uid: 'ico2' })]
    const set = withFlag(refs, ['ico1'], 'hidden', true)
    expect(set[0].hidden).toBe(true)
    expect(set[1]).toBe(refs[1])
    expect(withFlag(set, ['ico1'], 'hidden', true)).toBe(set)
    expect(withFlag(set, ['ico1'], 'hidden', false)[0]).not.toHaveProperty('hidden')
    expect(withFlag(refs, ['ico1'], 'lock', true)[0].lock).toBe(true)
  })
})
