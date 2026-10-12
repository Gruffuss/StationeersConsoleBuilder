import { describe, expect, it } from 'vitest'
import { newProject, type Page } from '../model/project'
import type { Scene, SrcNode, Value } from '../model/scene'
import { node } from '../model/testing'
import { decodeFrame, type Frame } from '../runtime/frame'
import { label, vbf1 } from '../runtime/testing'
import { hollowAt, pairLabel, pickNode } from './pick'

const scene = (root: SrcNode[]): Scene => ({ header: { w: 460, h: 460 }, defs: [], root })   // one unit per px on 460 px
const pageOf = (root: SrcNode[]): Page => ({ ...newProject().pages[0], scene: scene(root) })
const T = (more = {}) => node('T', { x: 0, y: 0, w: 40, h: 10, text: 'hi', ...more })
const frame = (text: ReturnType<typeof label>[]) => decodeFrame(vbf1(JSON.stringify({ elements: [{ id: 'scene', scene: 'p1', x: 0, y: 0,
  w: 460, h: 460, firstVertex: 0, vertexCount: 0 }], text, problems: [] })))
const size = { w: 460, h: 460 }
/** A frame of page `of` with one opaque 40 x 10 square at the origin, its vertices 0-3 the span of node `node`. */
const squareFrame = (of: string, node: number): Frame => ({
  positions: Float32Array.of(0, 0, 40, 0, 40, 10, 0, 10), coverage: Float32Array.of(1, 1, 1, 1), colours: new Uint8Array(16).fill(255),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3), spans: Int32Array.of(0, node, 0, 4),
  elements: [{ id: 'scene', scene: of, x: 0, y: 0, w: 460, h: 460, firstVertex: 0, vertexCount: 4 }], text: [], problems: [] })
const R = (more = {}) => node('R', { x: 0, y: 0, w: 100, h: 100, s: '#fff', ...more })

describe('pairLabel', () => {
  it('pairs a label with the T whose box it is, through a turned group; the last of two equal ones', () => {
    const s = scene([node('G', { t: [100, 100], r: 90 }, [T()])])
    expect(pairLabel(s, { w: 460, h: 460 }, label({ x: 75, y: 115, w: 40, h: 10, rotation: 90 }))).toEqual([0, 0])
    expect(pairLabel(s, { w: 460, h: 460 }, label({ x: 0, y: 0, w: 40, h: 10 }))).toBeNull()
    expect(pairLabel(scene([T(), T()]), { w: 460, h: 460 }, label({ x: 0, y: 0, w: 40, h: 10 }))).toEqual([1])
  })
  it('keeps the T the frame names when its box fits the label: two Ts in one box (state-swapped text)', () => {
    const s = scene([T({ v: '=s==1' }), T({ v: '=s==2' })]), t = label({ x: 0, y: 0, w: 40, h: 10, node: 0 })
    expect(pairLabel(s, size, t, [0])).toEqual([0])
    expect(pairLabel(s, size, t)).toEqual([1])   // without the frame's word, the last
  })
  it('falls to geometry when the named T does not fit (a stale or a wrong index); keeps a name whose fit it cannot tell', () => {
    const t = label({ x: 0, y: 0, w: 40, h: 10 })
    expect(pairLabel(scene([T({ x: 100 }), T()]), size, t, [0])).toEqual([1])
    expect(pairLabel(scene([T({ x: 100 })]), size, t, [0])).toBeNull()   // a definite misfit is not kept
    expect(pairLabel(scene([T({ x: '=$x' }), T({ x: 100 })]), size, t, [0])).toEqual([0])   // placed by an expression
  })
  it('pairs a T in a USE\'s own block, through the USE\'s x y', () => {
    const s = scene([node('USE', { ref: 'k', x: 100, y: 20 }, [T()])])
    expect(pairLabel(s, size, label({ x: 100, y: 20, w: 40, h: 10 }))).toEqual([0, 0])
  })
})

describe('hollowAt', () => {
  it('picks the smallest stroke-bearing or filled closed shape, T or IMG holding the point', () => {
    const s = scene([node('R', { x: 0, y: 0, w: 100, h: 100, s: '#fff' }), node('C', { cx: 50, cy: 50, rx: 10, f: '#000' })])
    expect(hollowAt(s, { x: 50, y: 50 })).toEqual([1])
    expect(hollowAt(s, { x: 10, y: 10 })).toEqual([0])
    expect(hollowAt(s, { x: 59, y: 59 })).toEqual([0])   // outside the circle, inside its box
  })
  it('never a pure hit region, an open curve, a hidden or a locked node', () => {
    const s = scene([node('R', { x: 0, y: 0, w: 100, h: 100 }), node('SP', { p: [0, 0, 100, 0, 50, 100], s: '#fff' }),
      node('G', { v: 0 }, [node('R', { x: 0, y: 0, w: 9, h: 9, s: '#fff' })]), { ...node('R', { x: 0, y: 0, w: 8, h: 8, s: '#fff' }), comments: ['lock'] }])
    expect(hollowAt(s, { x: 5, y: 5 })).toBeNull()
    expect(hollowAt(scene([node('SP', { p: [0, 0, 100, 0, 50, 100], s: '#fff', close: 1 })]), { x: 50, y: 20 })).toEqual([0])
  })
  it('reads # lock loosely, as tree.ts isLock does', () => {
    expect(hollowAt(scene([{ ...node('R', { x: 0, y: 0, w: 8, h: 8, s: '#fff' }), comments: [' Lock '] }]), { x: 5, y: 5 })).toBeNull()
  })
  it('a stroke-only P needs a closed subpath (the mod\'s hit area for a P); a filled one does not', () => {
    const P = (more: object) => scene([node('P', { d: 'M0 0 L100 0 L50 100', ...more })])
    expect(hollowAt(P({ s: '#fff' }), { x: 50, y: 20 })).toBeNull()
    expect(hollowAt(P({ s: '#fff', d: 'M0 0 L100 0 L50 100 Z' }), { x: 50, y: 20 })).toEqual([0])
    expect(hollowAt(P({ f: '#fff' }), { x: 50, y: 20 })).toEqual([0])
  })
  it('refuses no chain the mod draws: groups of tiny scales inside one another, or one tinier still', () => {
    const s = scene([node('G', { s: [1e-4, 1e-4] }, [node('G', { s: [1e-4, 1e-4] }, [node('R', { x: 0, y: 0, w: 1e8, h: 1e8, s: '#fff' })])])])
    expect(hollowAt(s, { x: 0.5, y: 0.5 })).toEqual([0, 0, 0])
    expect(hollowAt(scene([node('G', { s: [1e-7, 1e-7] }, [R({ w: 1e9, h: 1e9 })])]), { x: 50, y: 50 })).toEqual([0, 0])
  })
  it('picks a T or an IMG by its box with no paint (an image placeholder, an empty text); not a T without a box', () => {
    expect(hollowAt(scene([node('IMG', { x: 0, y: 0, w: 50, h: 50 })]), { x: 10, y: 10 })).toEqual([0])
    expect(hollowAt(scene([T({ text: '' })]), { x: 5, y: 5 })).toEqual([0])
    expect(hollowAt(scene([node('T', { x: 0, y: 0, text: 'hi' })]), { x: 0, y: 0 })).toBeNull()
  })
  it('picks a stroke-only Y polygon inside it', () => {
    expect(hollowAt(scene([node('Y', { p: [0, 0, 100, 0, 50, 100], s: '#fff' })]), { x: 50, y: 20 })).toEqual([0])
  })
  it('reads paint as the mod does: none in any case, or a number, is no paint', () => {
    for (const paint of [{ f: 'None' }, { f: 'NONE' }, { s: 'none' }, { f: 3 }, { s: 0 }] as Record<string, Value>[])
      expect(hollowAt(scene([node('R', { x: 0, y: 0, w: 100, h: 100, ...paint })]), { x: 5, y: 5 })).toBeNull()
    expect(hollowAt(scene([node('R', { x: 0, y: 0, w: 100, h: 100, f: '#0000' })]), { x: 5, y: 5 })).toEqual([0])
  })
  it('on equal areas the later in pre-order wins', () => {
    expect(hollowAt(scene([R(), R()]), { x: 5, y: 5 })).toEqual([1])
  })
  it('leaves out what an SC viewport cuts away at the point (list rows scrolled out of sight)', () => {
    const s = scene([node('SC', { id: 'l', x: 0, y: 0, w: 100, h: 100 }, [T({ y: 150 }), R({ x: 10, y: 10, w: 20, h: 20 })])])
    expect(hollowAt(s, { x: 20, y: 155 })).toBeNull()
    expect(hollowAt(s, { x: 15, y: 15 })).toEqual([0, 1])
    expect(hollowAt(scene([node('SC', { id: 'l', x: 0, y: 0, w: '=$w', h: 100 }, [R()])]), { x: 5, y: 5 })).toBeNull()   // unplaced
  })
  it('leaves out what a G clip cuts away, in scene units, its group moved or not; the ancestors\' clips too', () => {
    const defs = [node('CP', { id: 'k' }, [node('R', { x: 0, y: 0, w: 100, h: 100 })]), node('CP', { id: 'o' }, [node('C', { cx: 50, cy: 50, rx: 50 })]),
      node('CP', { id: 'live' }, [node('R', { x: 0, y: 0, w: '=$w', h: 100 })]), node('CP', { id: 'text' }, [T()])]
    const g = (attrs: Record<string, Value>, c = [R({ w: 300, h: 300 })]): Scene => ({ header: { w: 460, h: 460 }, defs, root: [node('G', attrs, c)] })
    expect(hollowAt(g({ clip: 'k' }), { x: 250, y: 250 })).toBeNull()
    expect(hollowAt(g({ clip: 'k' }), { x: 50, y: 50 })).toEqual([0, 0])
    expect(hollowAt(g({ clip: 'k', t: [200, 200] }), { x: 250, y: 250 })).toBeNull()   // the clip stays put
    expect(hollowAt(g({ clip: 'o' }), { x: 5, y: 5 })).toBeNull()   // in the circle's box, outside the circle
    expect(hollowAt(g({ clip: 'k' }, [node('G', {}, [R({ w: 300, h: 300 })])]), { x: 250, y: 250 })).toBeNull()
    // Drawn unclipped by the mod: a clip no CP declares, a CP of no usable shape. A live clip cannot be placed: left out.
    expect(hollowAt(g({ clip: 'none' }), { x: 250, y: 250 })).toEqual([0, 0])
    expect(hollowAt(g({ clip: 'text' }), { x: 250, y: 250 })).toEqual([0, 0])
    expect(hollowAt(g({ clip: 'live' }), { x: 50, y: 50 })).toBeNull()
  })
})

describe('pickNode', () => {
  it('pairs a hit label with its T by geometry, even when the frame could not (node -1)', () => {
    const page = pageOf([node('R', { x: 200, y: 200, w: 9, h: 9 }), T()])
    expect(pickNode(frame([label({ x: 0, y: 0, w: 40, h: 10 })]), page, undefined, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path: [1] })
  })
  it('falls back to the hollow pick where the frame shows nothing; never picks a locked node', () => {
    const page = pageOf([node('R', { x: 0, y: 0, w: 100, h: 100, s: '#fff' })])
    expect(pickNode(frame([]), page, undefined, { x: 50, y: 50 })).toEqual({ pageId: 'p1', path: [0] })
    expect(pickNode(null, page, undefined, { x: 50, y: 50 })).toEqual({ pageId: 'p1', path: [0] })
    const locked = pageOf([{ ...T(), comments: ['lock'] }])
    expect(pickNode(frame([label({ x: 0, y: 0, w: 40, h: 10, node: 0 })]), locked, { ops: ['T'], nodes: [0] }, { x: 5, y: 5 })).toBeNull()
  })
  it('a design size the mod takes, however large, maps the press without a determinant floor', () => {
    const page: Page = { ...pageOf([]), scene: { header: { w: 1e9, h: 1e9 }, defs: [], root: [node('R', { x: 0, y: 0, w: 5e8, h: 5e8, s: '#fff' })] } }
    expect(pickNode(null, page, undefined, { x: 100, y: 100 })).toEqual({ pageId: 'p1', path: [0] })
  })
  it('two Ts in one box (state-swapped text): the frame\'s node decides, not the last in pre-order', () => {
    const order = { ops: ['T', 'T'], nodes: [0, 1] }, f = frame([label({ x: 0, y: 0, w: 40, h: 10, node: 0 })])
    expect(pickNode(f, pageOf([T({ v: '=s==1' }), T({ v: '=s==2' })]), order, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path: [0] })
    expect(pickNode(f, pageOf([T({ v: '=s==1' }), T({ text: '' })]), order, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path: [0] })
  })
  it('falls back to the hollow pick when what is drawn under the press is another page\'s', () => {
    expect(pickNode(squareFrame('p2', 0), pageOf([R()]), { ops: ['R'], nodes: [0] }, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path: [0] })
  })
  it('sees through a locked node drawn on top: the node under it is picked', () => {
    const two: Frame = { ...squareFrame('p1', 0), positions: Float32Array.of(0, 0, 40, 0, 40, 10, 0, 10, 0, 0, 40, 0, 40, 10, 0, 10),
      coverage: new Float32Array(8).fill(1), colours: new Uint8Array(32).fill(255), indices: Uint32Array.of(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7),
      spans: Int32Array.of(0, 0, 0, 4, 0, 1, 4, 4), elements: [{ id: 'scene', scene: 'p1', x: 0, y: 0, w: 460, h: 460, firstVertex: 0, vertexCount: 8 }] }
    const sq = node('R', { x: 0, y: 0, w: 40, h: 10, f: '#fff' }), order = { ops: ['R', 'R'], nodes: [0, 1] }
    expect(pickNode(two, pageOf([sq, sq]), order, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path: [1] })   // the top one
    expect(pickNode(two, pageOf([sq, { ...sq, comments: ['lock'] }]), order, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path: [0] })
  })
  it('never picks a node under a locked ancestor through the frame', () => {
    const page = pageOf([{ ...node('G', {}, [node('R', { x: 0, y: 0, w: 40, h: 10, f: '#fff' })]), comments: ['lock'] }])
    expect(pickNode(squareFrame('p1', 1), page, { ops: ['G', 'R'], nodes: [0, 1] }, { x: 5, y: 5 })).toBeNull()
  })
  it('follows the scene\'s ztext: a shape drawn after a label wins the press, unless ztext=0', () => {
    // A T's label (node 0, place 0) under an opaque square drawn after it (node 1, vertices 0-3).
    const f: Frame = { positions: Float32Array.of(0, 0, 40, 0, 40, 10, 0, 10), coverage: Float32Array.of(1, 1, 1, 1),
      colours: new Uint8Array(16).fill(255), indices: Uint32Array.of(0, 1, 2, 0, 2, 3), spans: Int32Array.of(0, 0, 0, 0, 0, 1, 0, 4),
      elements: [{ id: 'scene', scene: 'p1', x: 0, y: 0, w: 460, h: 460, firstVertex: 0, vertexCount: 4 }],
      text: [label({ x: 0, y: 0, w: 40, h: 10, node: 0 })], problems: [] }
    const root = [T(), node('R', { x: 0, y: 0, w: 40, h: 10, f: '#fff' })], order = { ops: ['T', 'R'], nodes: [0, 1] }
    expect(pickNode(f, pageOf(root), order, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path: [1] })
    const off: Page = { ...pageOf(root), scene: { ...scene(root), header: { w: 460, h: 460, ztext: 0 } } }
    expect(pickNode(f, off, order, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path: [0] })
  })
})

describe('deep trees (explicit stacks, a path made once)', () => {
  const N = 100_000
  it('hollowAt: concentric stroke-only rectangles, each a new smallest one, 100,000 deep', () => {
    let inner: SrcNode[] = []
    for (let k = N - 1; k >= 0; k--) inner = [node('G', {}, [R({ x: k - N, y: k - N, w: 2 * (N - k), h: 2 * (N - k) }), ...inner])]
    expect(hollowAt(scene(inner), { x: 0, y: 0 })).toEqual([0, ...Array<number>(N - 1).fill(1), 0])
  }, 20_000) // measured: 0.501 s alone, 1.770 s focused, 2.469-4.366 s full suite; at least 3x headroom
  it('pairLabel and pickNode: a T at the bottom of a 100,000-deep chain', () => {
    let root: SrcNode[] = [T()]
    for (let k = 0; k < N; k++) root = [node('G', {}, root)]
    const path = Array<number>(N + 1).fill(0), t = label({ x: 0, y: 0, w: 40, h: 10, node: N })
    expect(pairLabel(scene(root), size, t)).toEqual(path)
    const order = { ops: [...Array<string>(N).fill('G'), 'T'], nodes: Array.from({ length: N + 1 }, (_, i) => i) }
    expect(pickNode(frame([t]), pageOf(root), order, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path })
    expect(pickNode(null, pageOf(root), undefined, { x: 5, y: 5 })).toEqual({ pageId: 'p1', path })
  }, 10_000) // measured: 0.343 s alone, 2.454 s full suite; at least 3x headroom
})
