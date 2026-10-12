import { describe, expect, it } from 'vitest'
import { apply, boxOf, groupMatrix, type Box } from '../editor/geometry'
import type { SrcNode } from '../model/scene'
import { node } from '../model/testing'
import { handlesOf, isTurnWrapper, moveBy, resizeTo, rotate, stays, turnOf } from './transform'

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })
type Turned = { root: SrcNode[]; path: number[] }
const near = (b: Box | null, e: Box, places: number) => { for (const k of ['x', 'y', 'w', 'h'] as const) expect(b![k]).toBeCloseTo(e[k], places) }

describe('moveBy', () => {
  it('says why a move moves nothing of a node (the padlock), and nothing where one axis moves', () => {
    expect([node('R', { x: '=i*4', y: '$y' }), node('R', { x: '=i*4', y: 0 }), node('YS', { n: 4 }), node('L', { p: [0, 0, '=a', 1] }),
      node('P', { d: 'M0 0 Q' }), node('G', { t: ['=sin(t)', '=t'] }), node('G', { t: ['=sin(t)', 0] }), node('G', { t: 5 })].map(stays))
      .toEqual(['x is an expression; y is an expression', null, 'move the enclosing group', 'p is not a list of numbers',
        'd is not a valid path', 't is an expression', null, 't is not a pair'])
    expect(Object.is(moveBy(node('R', { x: 1 }), -1.0001, 0).node.attrs.x, 0)).toBe(true)   // no -0
  })
  it('writes numbers and absent keys only, per axis, saying why an axis stays', () => {
    const w = moveBy(node('R', { x: '$a', y: 2, w: 1, h: 1 }), 3, 4)
    expect(w).toEqual({ node: node('R', { x: '$a', y: 6, w: 1, h: 1 }), locked: 'x is an expression' })
  })
  it('moves an SC with its children, or not at all', () => {
    const sc = node('SC', { x: 0, y: 0, w: 10, h: 10 }, [node('R', { x: 1, y: 1 })])
    expect(moveBy(sc, 2, 0).node).toEqual(node('SC', { x: 2, y: 0, w: 10, h: 10 }, [node('R', { x: 3, y: 1 })]))
    const stuck = node('SC', { x: 0 }, [node('R', { x: '$a' })])
    expect(moveBy(stuck, 2, 0)).toEqual({ node: stuck, locked: 'child 1: x is an expression' })
  })
  it('moves a G by t (one component may stay), points, paths; RP has nothing to move', () => {
    expect(moveBy(node('G'), 3, 4).node.attrs).toEqual({ t: [3, 4] })
    expect(moveBy(node('G', { t: [5, '=t'] }), 1, 1)).toEqual({ node: node('G', { t: [6, '=t'] }), locked: 't is an expression' })
    expect(moveBy(node('L', { p: [0, 0, 10, 0] }), 1, 2).node.attrs.p).toEqual([1, 2, 11, 2])
    expect(moveBy(node('P', { d: 'M0 0 L10 0' }), 2, 3).node.attrs.d).toBe('M2 3 L12 3')
    expect(moveBy(node('RP', { n: 3 }), 1, 1).locked).toBe('move the enclosing group')
  })
  it('moves each op by its own keys: C by cx cy, USE T IMG by x y, Y and SP by every point', () => {
    expect(moveBy(node('C', { cx: 1, cy: 2, rx: 3 }), 1, 1).node.attrs).toEqual({ cx: 2, cy: 3, rx: 3 })
    for (const op of ['USE', 'T', 'IMG']) expect(moveBy(node(op, { x: 1, y: 2 }), 1, 1).node.attrs).toEqual({ x: 2, y: 3 })
    expect(moveBy(node('Y', { p: [0, 0, 4, 0, 0, 4] }), 1, 2).node.attrs.p).toEqual([1, 2, 5, 2, 1, 6])
    expect(moveBy(node('SP', { p: [0, 0, 4, 0], seg: 4 }), -1, 0).node.attrs).toEqual({ p: [-1, 0, 3, 0], seg: 4 })
  })
  it('keeps a value as written when the move rounds to the same one', () => {
    const r = node('R', { x: 1.00001, y: 2 }), l = node('L', { p: [1.00001, 0, 5, 0] })
    expect(moveBy(r, 0.0001, 0)).toEqual({ node: r })
    expect(moveBy(r, 0.0001, 0).node).toBe(r)
    expect(moveBy(l, 0.0001, 0).node).toBe(l)
    expect(moveBy(l, 1, 0).node.attrs.p).toEqual([2, 0, 6, 0])
  })
  it('moves SCs inside SCs to any depth with their children, all or none, without recursion', () => {
    let deep: SrcNode = node('R', { x: 0, y: 0 })
    for (let k = 0; k < 100000; k++) deep = node('SC', { x: 0, y: 0, w: 1, h: 1 }, [deep])
    let at: SrcNode | undefined = moveBy(deep, 1, 0).node, depth = 0, wrong = 0
    for (; at; at = at.c?.[0], depth++) if (at.attrs.x !== 1) wrong++
    expect([depth, wrong]).toEqual([100001, 0])
    const inner = node('SC', { x: 0 }, [node('R', { x: 1 }), node('R', { x: '$a' })])
    const outer = node('SC', { x: 0 }, [node('R', { x: 0 }), inner])
    expect(moveBy(outer, 1, 0)).toEqual({ node: outer, locked: 'child 2: child 2: x is an expression' })
    const rp = node('SC', { x: 0 }, [node('RP', { n: 3 }, [node('R', { x: 1 })])])
    expect(moveBy(rp, 1, 0)).toEqual({ node: rp, locked: "child 1: RP has no position of its own: group the SC's children to move them" })
    expect(moveBy(node('SC', { x: 0 }), 1, 0).node).toEqual(node('SC', { x: 1 }))   // no block appears
  })
})

describe('a transform that changes nothing', () => {
  const pts = [node('L', { p: [0, 0, 10, 10] }), node('Y', { p: [0, 0, 4, 0, 0, 4] }), node('SP', { p: [0, 0, 10, 0, 10, 10] })]
  it('gives the node itself for a move that rounds to nothing, keeping a path text as written', () => {
    for (const n of [...pts, node('P', { d: 'M 0,0 L 10,10' }), node('R', { x: 0 }), node('G')]) expect(moveBy(n, 1e-9, 0).node).toBe(n)
    const p = node('P', { d: 'M 0,0 L 10,10' })
    expect(moveBy(p, 0.0001, 0)).toEqual({ node: p })
  })
  it('gives the node itself for a resize to the same box, adding no key (no s=1 1, no ry)', () => {
    for (const n of pts) expect(resizeTo(n, 'se', box(0, 0, 10, 10), box(0, 0, 10, 10)).node).toBe(n)
    const p = node('P', { d: 'M 0,0 L 10.12345 5' })
    expect(resizeTo(p, 'se', box(0, 0, 10.12345, 5), box(0, 0, 10.12345, 5)).node).toBe(p)
    const g = node('G', {}, [node('R', { x: 0, y: 0, w: 10, h: 10 })]), gt = node('G', { t: [5, 5] }, g.c)
    expect(resizeTo(g, 'se', box(0, 0, 10, 10), box(0, 0, 10, 10)).node).toBe(g)
    expect(resizeTo(gt, 'nw', box(0, 0, 10, 10), box(0, 0, 10, 10)).node).toBe(gt)
    const c = node('C', { cx: 5, cy: 5, rx: 5 })
    expect(resizeTo(c, 'e', box(0, 0, 10, 10), box(0, 0, 10, 10)).node).toBe(c)
    const r = node('R', { x: 0, y: 0, w: 10, h: 10 })
    expect(resizeTo(r, 'n', box(0, 0, 10, 10), box(0, 0, 10, 10)).node).toBe(r)
  })
  it('gives the tree itself for a turn by 0: a G gains no r, points stay, nothing is wrapped', () => {
    const root = [node('G'), ...pts, node('R', { x: 0, y: 0, w: 10, h: 10 })]
    root.forEach((_, k) => expect((rotate(root, [k], 0, { x: 3, y: 4 }) as Turned).root).toBe(root))
    expect((rotate(root, [4], 1e-9, { x: 3, y: 4 }) as Turned).root).toBe(root)
  })
})

describe('guards', () => {
  it('never writes a value that leaves float32, a path included, and keeps the reason that was pending', () => {
    const p = node('P', { d: 'M0 0 L10 5' })
    for (const w of [NaN, Infinity]) expect(resizeTo(p, 'e', box(0, 0, 10, 5), box(0, 0, w, 5))).toEqual({ node: p, locked: 'the value left float32' })
    expect(moveBy(p, NaN, 3)).toEqual({ node: p, locked: 'the value left float32' })
    expect(moveBy(p, 1e39, 0)).toEqual({ node: p, locked: 'the value left float32' })
    const r = node('R', { x: '$a', y: 0 })
    expect(moveBy(r, 1, 1e39)).toEqual({ node: r, locked: 'x is an expression; the value left float32' })
    const R = node('R', { x: 0, y: 0, w: 10, h: 10 })
    expect(rotate([R], [0], NaN, { x: 0, y: 0 })).toBe('the value left float32')
    expect(rotate([R], [0], 30, { x: Infinity, y: 0 })).toBe('the value left float32')
    expect(rotate([node('L', { p: [0, 0, 1, 1] })], [0], 30, { x: NaN, y: 0 })).toBe('the value left float32')
    expect(rotate([node('G')], [0], 30, { x: 1e39, y: 0 })).toBe('the value left float32')
  })
  it('writes a group scale to 6 significant digits as float32: no small scale refused, no coarse steps; never 0', () => {
    const kids = [node('R', { x: 0, y: 0, w: 10, h: 10 })]
    const small = node('G', { s: [0.01, 0.01] }, kids), bare = node('G', {}, kids)
    expect(resizeTo(small, 'se', box(0, 0, 10, 10), box(0, 0, 0.4, 0.4)).node.attrs.s).toEqual([0.0004, 0.0004].map(Math.fround))
    expect(resizeTo(bare, 'e', box(0, 0, 10, 10), box(0, 0, 0.004, 10)).node.attrs).toEqual({ s: [Math.fround(0.0004), 1] })
    expect(resizeTo(small, 'se', box(0, 0, 10, 10), box(0, 0, 1, 1)).node.attrs.s).toEqual([0.001, 0.001].map(Math.fround))
    // 0.0123456 x 1.01 = 0.012469056: six digits, not 3 decimals' 0.012.
    expect(resizeTo(node('G', { s: [0.0123456, 1] }, kids), 'e', box(0, 0, 10, 10), box(0, 0, 10.1, 10)).node.attrs.s)
      .toEqual([Math.fround(0.0124691), 1])
    // A ten-millionth on one axis is a scale the mod takes and inverts: only a singular scale (below) or one that leaves
    // float32 is refused.
    expect(resizeTo(bare, 'e', box(0, 0, 10, 10), box(0, 0, 1e-6, 10)).node.attrs).toEqual({ s: [Math.fround(1e-7), 1] })
    expect(resizeTo(bare, 'e', box(0, 0, 10, 10), box(0, 0, 0, 10))).toEqual({ node: bare, locked: 'too small to scale' })
    const tiny = node('G', { s: [1e-44, 1] }, kids)
    expect(resizeTo(tiny, 'e', box(0, 0, 10, 10), box(0, 0, 0.1, 10))).toEqual({ node: tiny, locked: 'too small to scale' })
    const huge = node('G', { s: [1e38, 1] }, kids)
    expect(resizeTo(huge, 'e', box(0, 0, 10, 10), box(0, 0, 100, 10))).toEqual({ node: huge, locked: 'the value left float32' })
    // A value already there that reads the same at six digits stays as written.
    const exact = node('G', { s: [0.1234567, 1] }, kids)
    expect(resizeTo(exact, 'e', box(0, 0, 10, 10), box(0, 0, 10.0000001, 10)).node).toBe(exact)
  })
  it('reads a short pair as the mod does: a missing item is the default', () => {
    expect(resizeTo(node('G', { t: [5] }, [node('R', { x: 0, y: 0, w: 10, h: 10 })]), 'se', box(0, 0, 10, 10), box(0, 0, 20, 20)).node.attrs)
      .toEqual({ t: [5], s: [2, 2] })
    expect((rotate([node('G', { t: [5] })], [0], 90, { x: 0, y: 0 }) as Turned).root[0].attrs).toEqual({ t: [0, 5], r: 90 })
  })
})

describe('resizeTo', () => {
  it('writes a box from the normalised box, only the keys that change; refuses to write over an expression', () => {
    expect(resizeTo(node('R', { x: 0, y: 0, w: 10, h: 10 }), 'se', box(0, 0, 10, 10), box(0, 0, 20, 5)).node.attrs).toEqual({ x: 0, y: 0, w: 20, h: 5 })
    expect(resizeTo(node('R', { x: 10, y: 0, w: 2, h: 2 }), 'w', box(10, 0, 2, 2), box(10, 0, -4, 2)).node.attrs).toEqual({ x: 6, y: 0, w: 4, h: 2 })
    const r = node('R', { x: '=t', y: 0, w: 10, h: 10 })
    expect(resizeTo(r, 'w', box(0, 0, 10, 10), box(-5, 0, 15, 10))).toEqual({ node: r, locked: 'x is an expression' })
  })
  it('keeps a circle a circle on a corner, against the opposite corner (Alt: the centre), and gives it ry on a side', () => {
    const c = node('C', { cx: 5, cy: 5, rx: 5 })
    expect(resizeTo(c, 'se', box(0, 0, 10, 10), box(0, 0, 20, 10)).node.attrs).toEqual({ cx: 7.5, cy: 7.5, rx: 7.5 })
    expect(resizeTo(c, 'nw', box(0, 0, 10, 10), box(-10, 0, 20, 10)).node.attrs).toEqual({ cx: 2.5, cy: 2.5, rx: 7.5 })
    expect(resizeTo(c, 'se', box(0, 0, 10, 10), box(0, 0, -20, -10)).node.attrs).toEqual({ cx: -7.5, cy: -7.5, rx: 7.5 })
    expect(resizeTo(c, 'se', box(0, 0, 10, 10), box(-5, 0, 20, 10), { centre: true }).node.attrs).toEqual({ cx: 5, cy: 5, rx: 7.5 })
    expect(resizeTo(c, 'e', box(0, 0, 10, 10), box(0, 0, 20, 10)).node.attrs).toEqual({ cx: 10, cy: 5, rx: 10, ry: 5 })
  })
  it('scales points and paths from the box at the press, mirrored past the opposite side', () => {
    const l = node('L', { p: [0, 0, 10, 10] })
    expect(resizeTo(l, 'se', box(0, 0, 10, 10), box(0, 0, 20, 5)).node.attrs.p).toEqual([0, 0, 20, 5])
    expect(resizeTo(l, 'w', box(0, 0, 10, 10), box(10, 0, -10, 10)).node.attrs.p).toEqual([10, 0, 0, 10])
    expect(resizeTo(node('P', { d: 'M0 0 l10 10' }), 'se', box(0, 0, 10, 10), box(0, 0, 20, 20)).node.attrs.d).toBe('M0 0 l20 20')
    // An ellipse turned by other than a quarter takes an uneven scale exactly (the image of an ellipse is one): its box
    // doubles in width, to the writer's 3 decimals.
    const arc = node('P', { d: 'M0 0 A10 5 30 0 1 20 0' }), b = boxOf(arc)!
    const wide = resizeTo(arc, 'e', b, { ...b, w: 2 * b.w })
    expect(wide.locked).toBeUndefined()
    near(boxOf(wide.node), { ...b, w: 2 * b.w }, 2)
  })
  it('writes only the box keys that change (an absent one that stays 0 stays absent); SC T IMG like R', () => {
    expect(resizeTo(node('R', { w: 10, h: 10 }), 'se', box(0, 0, 10, 10), box(0, 0, 20, 10)).node.attrs).toEqual({ w: 20, h: 10 })
    for (const op of ['SC', 'T', 'IMG']) {
      expect(resizeTo(node(op, { x: 1, y: 1, w: 2, h: 2 }), 'nw', box(1, 1, 2, 2), box(0, 0, 3, 3)).node.attrs).toEqual({ x: 0, y: 0, w: 3, h: 3 })
    }
  })
  it('never writes a size the mod draws as nothing (R IMG SC w or h, C rx or ry of 0); any size above 0, and a T, are written', () => {
    const r = node('R', { x: 100, y: 100, w: 40, h: 20 }), from = box(100, 100, 40, 20)
    expect(resizeTo(r, 'e', from, box(100, 100, 0.0004, 20))).toEqual({ node: r, locked: 'too small to scale' })
    expect(resizeTo(r, 'se', from, box(100, 100, 0, 0))).toEqual({ node: r, locked: 'too small to scale' })
    expect(resizeTo(r, 'e', from, box(100, 100, 0.001, 20)).node.attrs).toEqual({ x: 100, y: 100, w: Math.fround(0.001), h: 20 })
    for (const op of ['SC', 'IMG']) {
      const n = node(op, { x: 0, y: 0, w: 2, h: 2 })
      expect(resizeTo(n, 's', box(0, 0, 2, 2), box(0, 0, 2, 0)).locked).toBe('too small to scale')
    }
    const c = node('C', { cx: 200, cy: 200, rx: 20, ry: 10 })
    expect(resizeTo(c, 'e', box(180, 190, 40, 20), box(180, 190, 0, 20))).toEqual({ node: c, locked: 'too small to scale' })
    expect(resizeTo(node('C', { cx: 5, cy: 5, rx: 5 }), 's', box(0, 0, 10, 10), box(0, 0, 10, 0)).locked).toBe('too small to scale')
    expect(resizeTo(node('T', { x: 0, y: 0, w: 10, h: 10, text: 'a' }), 'e', box(0, 0, 10, 10), box(0, 0, 0, 10)).node.attrs.w).toBe(0)
    // A size that is 0 already stays 0 while another handle edits the rest (nothing new is hidden).
    expect(resizeTo(node('R', { x: 0, y: 0, w: 0, h: 10 }), 's', box(0, 0, 0, 10), box(0, 0, 0, 20)).node.attrs.h).toBe(20)
  })
  it('scales Y and SP points; an axis with no extent stays; refuses a scale too small to take back', () => {
    expect(resizeTo(node('Y', { p: [0, 0, 10, 0, 0, 10] }), 'se', box(0, 0, 10, 10), box(0, 0, 20, 30)).node.attrs.p).toEqual([0, 0, 20, 0, 0, 30])
    expect(resizeTo(node('SP', { p: [0, 0, 10, 10] }), 'nw', box(0, 0, 10, 10), box(5, 5, 5, 5)).node.attrs.p).toEqual([5, 5, 10, 10])
    // A flat line has no height to scale: its y stays wherever the handle goes.
    expect(resizeTo(node('L', { p: [0, 3, 10, 3] }), 'se', box(0, 3, 10, 0), box(0, 5, 20, 7)).node.attrs.p).toEqual([0, 3, 20, 3])
    const l = node('L', { p: [0, 0, 10, 10] })
    expect(resizeTo(l, 'e', box(0, 0, 10, 10), box(0, 0, 1e-6, 10))).toEqual({ node: l, locked: 'too small to scale' })
  })
  it('scales a group about the opposite handle (s and t); refuses one with m', () => {
    const g = node('G', {}, [node('R', { x: 0, y: 0, w: 10, h: 10 })])
    expect(resizeTo(g, 'se', box(0, 0, 10, 10), box(0, 0, 20, 20)).node.attrs).toEqual({ s: [2, 2] })
    expect(resizeTo(g, 'nw', box(0, 0, 10, 10), box(-10, -10, 20, 20)).node.attrs).toEqual({ s: [2, 2], t: [-10, -10] })
    const turned = node('G', { t: [50, 50], r: 90, a: [5, 5] }, [node('R', { x: 0, y: 0, w: 10, h: 10 })])
    const after = resizeTo(turned, 'se', box(0, 0, 10, 10), box(0, 0, 20, 20)).node
    const [x0, y0] = apply(groupMatrix(turned.attrs)!, 20, 20), [x1, y1] = apply(groupMatrix(after.attrs)!, 10, 10)
    expect(x1).toBeCloseTo(x0, 6)
    expect(y1).toBeCloseTo(y0, 6)
    expect(resizeTo(node('G', { m: [1, 0, 0, 1, 0, 0] }, [node('R')]), 'e', box(0, 0, 1, 1), box(0, 0, 2, 1)).locked)
      .toBe('m is set: group it and scale the new group')
  })
  it('refuses to write a group scale the mod cannot invert (|s0 s1| at or below 1e-12), and writes any above it', () => {
    const kids = [node('R', { x: 0, y: 0, w: 100, h: 100 })], g = node('G', {}, kids), from = box(0, 0, 100, 100)
    // The probe: se dragged to (0.0001, 0.0001) would write s = [1e-6, 1e-6], so handleFrame and chainTo give up on it.
    expect(resizeTo(g, 'se', from, box(0, 0, 0.0001, 0.0001))).toEqual({ node: g, locked: 'too small to scale' })
    expect(resizeTo(g, 'se', from, box(0, 0, 0.0002, 0.0001)).node.attrs.s).toEqual([Math.fround(2e-6), Math.fround(1e-6)])
    expect(resizeTo(g, 'e', from, box(0, 0, 1e-8, 100)).node.attrs.s).toEqual([Math.fround(1e-10), 1])
  })
})

describe('handles and rotation', () => {
  it('offers handles on a literal box; a group on its children; a circle does not turn; USE has none', () => {
    expect(handlesOf(node('R', { x: 0, y: 0, w: 10, h: 10 }))).toEqual({ box: box(0, 0, 10, 10), resize: true, rotate: true })
    expect(handlesOf(node('C', { cx: 5, cy: 5, rx: 5 }))!.rotate).toBe(false)
    expect(handlesOf(node('G', { t: [9, 9] }, [node('R', { x: 1, y: 1, w: 2, h: 2 })]))!.box).toEqual(box(1, 1, 2, 2))
    expect(handlesOf(node('G', { m: [1, 0, 0, 1, 0, 0] }, [node('R', { x: 1, y: 1, w: 2, h: 2 })]))!.resize).toBe(false)
    expect(handlesOf(node('USE', { ref: 's' }))).toBeNull()
  })
  it('offers no resize on a box with no extent at all (its handles would sit on one point); one side is enough', () => {
    expect(handlesOf(node('T', { x: 100, y: 100, text: 'a' }))).toEqual({ box: box(100, 100, 0, 0), resize: false, rotate: true })
    expect(handlesOf(node('R', { x: 1, y: 1, w: 0, h: 0 }))!.resize).toBe(false)
    expect(handlesOf(node('T', { x: 100, y: 100, w: 50, text: 'a' }))!.resize).toBe(true)
    expect(handlesOf(node('G', {}, [node('R', { x: 1, y: 1, w: 0, h: 0 })]))!.resize).toBe(false)
  })
  it("names the r a turn edits: a G's, its wrapper's, 0 for a wrapper to come; none for points", () => {
    const R = node('R', { x: 0, y: 0, w: 1, h: 1 })
    expect(turnOf([node('G', { r: 7 }, [R])], [0])).toBe(7)
    expect(turnOf([node('G', { a: [1, 1], r: 30 }, [R])], [0, 0])).toBe(30)
    expect(turnOf([node('G', { s: [2, 2] }, [R])], [0, 0])).toBe(0)
    expect(turnOf([R], [0])).toBe(0)
    expect(turnOf([node('L', { p: [0, 0, 1, 1] })], [0])).toBeNull()
  })
  it('turns a G by r and t about q; bakes L Y SP; wraps any other leaf once and turns the wrapper after', () => {
    const g = rotate([node('G')], [0], 90, { x: 10, y: 0 }) as { root: ReturnType<typeof node>[]; path: number[] }
    expect(g.root[0].attrs).toEqual({ r: 90, t: [10, -10] })
    expect((rotate([node('L', { p: [0, 0, 10, 0] })], [0], 90, { x: 5, y: 0 }) as { root: ReturnType<typeof node>[] }).root[0].attrs.p)
      .toEqual([5, -5, 5, 5])
    const R = node('R', { x: 0, y: 0, w: 10, h: 10 })
    const once = rotate([R], [0], 30, { x: 5, y: 5 }) as { root: ReturnType<typeof node>[]; path: number[] }
    expect(once).toEqual({ root: [node('G', { a: [5, 5], r: 30 }, [R])], path: [0, 0] })
    expect(isTurnWrapper(once.root[0])).toBe(true)
    const twice = rotate(once.root, [0, 0], 15, { x: 5, y: 5 }) as { root: ReturnType<typeof node>[]; path: number[] }
    expect(twice).toEqual({ root: [node('G', { a: [5, 5], r: 45 }, [R])], path: [0, 0] })
    expect(isTurnWrapper({ ...once.root[0], comments: ['lock'] })).toBe(false)
    expect(rotate([node('G', { r: '=t' })], [0], 10, { x: 0, y: 0 })).toBe('t, a and r must be numbers')
  })
  it('bakes a turn into Y and SP points', () => {
    expect((rotate([node('Y', { p: [0, 0, 10, 0, 0, 10] })], [0], 90, { x: 0, y: 0 }) as Turned).root[0].attrs.p).toEqual([0, 0, 0, 10, -10, 0])
    expect((rotate([node('SP', { p: [2, 2, 12, 2] })], [0], -90, { x: 2, y: 2 }) as Turned).root[0].attrs.p).toEqual([2, 2, 2, -8])
  })
  it('turns a wrapper about the pivot the node sees, mapped through the wrapper', () => {
    const R = node('R', { x: 0, y: 0, w: 10, h: 10 })
    const once = rotate([R], [0], 30, { x: 5, y: 5 }) as Turned
    const twice = rotate(once.root, [0, 0], 15, { x: 0, y: 0 }) as Turned   // q = the node's own (0, 0), not the wrapper's a
    expect(twice.path).toEqual([0, 0])
    const before = groupMatrix(once.root[0].attrs)!, after = groupMatrix(twice.root[0].attrs)!, [qx, qy] = apply(before, 0, 0)
    const c = Math.cos(Math.PI / 12), s = Math.sin(Math.PI / 12)
    for (const [x, y] of [[0, 0], [10, 0], [10, 10], [0, 10]]) {
      const [bx, by] = apply(before, x, y), [ax, ay] = apply(after, x, y)
      expect(ax).toBeCloseTo(qx + c * (bx - qx) - s * (by - qy), 2)
      expect(ay).toBeCloseTo(qy + s * (bx - qx) + c * (by - qy), 2)
    }
  })
  it('takes a G as a wrapper only with one child and keys among a r t', () => {
    const R = node('R', { x: 0, y: 0, w: 10, h: 10 })
    expect(isTurnWrapper(node('G', { r: 30 }, [R, R]))).toBe(false)
    expect(isTurnWrapper(node('G', { r: 30, s: [2, 2] }, [R]))).toBe(false)
    expect(isTurnWrapper(node('G', { r: 30, t: [1, 1], a: [5, 5] }, [R]))).toBe(true)
    const scaled = rotate([node('G', { r: 30, s: [2, 2] }, [R])], [0, 0], 15, { x: 5, y: 5 }) as Turned
    expect(scaled.path).toEqual([0, 0, 0])
    expect(scaled.root[0].attrs).toEqual({ r: 30, s: [2, 2] })
    expect(scaled.root[0].c![0]).toEqual(node('G', { a: [5, 5], r: 15 }, [R]))
  })
})
