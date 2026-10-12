import { describe, expect, it } from 'vitest'
import type { Scene, SrcNode } from '../model/scene'
import { node } from '../model/testing'
import { validateScene } from '../srctext/validate'
import { handlesOf, moveBy, resizeTo } from '../editing/transform'
import { apply, boxOf, chainTo, designSize, fitOf, groupMatrix, invert, outline, spSamples, viewbox, type Box } from './geometry'

const scene = (root: SrcNode[], header: Scene['header'] = { w: 460, h: 460 }): Scene => ({ header, defs: [], root })
const at = (m: ReturnType<typeof viewbox>, x: number, y: number) => apply(m, x, y).map(v => +v.toFixed(9))
const near = (b: Box | null, e: Box) => { for (const k of ['x', 'y', 'w', 'h'] as const) expect(b![k]).toBeCloseTo(e[k], 7) }

describe('viewbox and group matrices', () => {
  it('fits contain: centred on the long axis', () => {
    const m = viewbox({ w: 100, h: 200, fit: 'contain' }, { w: 460, h: 460 })
    expect(at(m, 0, 0)).toEqual([115, 0])
    expect(at(m, 100, 200)).toEqual([345, 460])
  })

  it('fits cover: centred, cropping the long axis; fit is read in any case', () => {
    const m = viewbox({ w: 100, h: 200, fit: 'COVER' }, { w: 460, h: 460 })
    expect(at(m, 0, 0)).toEqual([0, -230])
    expect(at(m, 100, 200)).toEqual([460, 690])
    expect(at(viewbox({ w: 100, h: 200, fit: 'Contain' }, { w: 460, h: 460 }), 0, 0)).toEqual([115, 0])
  })

  it('stretches without a fit', () => {
    expect(at(viewbox({ w: 100, h: 100 }, { w: 460, h: 230 }), 100, 100)).toEqual([460, 230])
  })

  // The mod's ParseFit switches on fit?.ToUpperInvariant(), which leaves a dotless i (U+0131) and a dotted I (U+0130) as
  // they are (measured in .NET 8): both spellings are stretch there. JS toUpperCase would turn U+0131 into I and read contain.
  it('reads fit as the mod does: any ASCII case, and a Turkish i is stretch', () => {
    const fit = (f?: unknown) => fitOf({ w: 1, h: 1, ...(f !== undefined && { fit: f }) } as unknown as Scene['header'])
    expect(['contain', 'COVER', 'Contain', 'stretch'].map(fit)).toEqual(['contain', 'cover', 'contain', 'stretch'])
    expect(['conta\u0131n', 'conta\u0130n', 'fill', 1, undefined].map(fit)).toEqual(['stretch', 'stretch', 'stretch', 'stretch', 'stretch'])
  })

  it('applies a group rotation clockwise on screen, then its translation', () => {
    expect(at(groupMatrix({ t: [10, 0], r: 90 })!, 1, 0)).toEqual([10, 1])
  })

  it('composes a group as T(t)·T(a)·R(r)·S(s)·M(m)·T(-a), m being CSS matrix(a,b,c,d,e,f)', () => {
    // (1,1) - a = (0,-1); m: (0.5·-1 + 4, -1 + 5) = (3.5, 4); s: (7, 12); r 90: (-12, 7); + a: (-11, 9); + t: (-1, 29)
    expect(at(groupMatrix({ t: [10, 20], a: [1, 2], r: 90, s: [2, 3], m: [1, 0, 0.5, 1, 4, 5] })!, 1, 1)).toEqual([-1, 29])
    expect(groupMatrix({ m: [1, 0, 0, 1] })).toBeNull()
    expect(groupMatrix({ s: ['=k', 1] })).toBeNull()
  })

  it('chains through a USE as its x, y translation', () => {
    const use = (x: number | string) => scene([node('USE', { x, y: 7, ref: 's' }, [node('R')])])
    expect(at(chainTo(use(5), [0, 0], { w: 460, h: 460 })!, 1, 1)).toEqual([6, 8])
    expect(chainTo(use('$x'), [0, 0], { w: 460, h: 460 })).toBeNull()
  })

  it('gives no chain through a singular group', () => {
    expect(chainTo(scene([node('G', { s: [0, 1] }, [node('R')])]), [0, 0], { w: 460, h: 460 })).toBeNull()
  })

  it('turns a screen drag under a rotated parent into the local delta, rounded exactly', () => {
    const sc = scene([node('G', { t: [10, 0], r: 90 }, [node('R', { x: 20, y: 30, w: 5, h: 5 })])])
    const [a, b, c, d] = chainTo(sc, [0, 0], { w: 460, h: 460 })!
    const [dx, dy] = apply(invert([a, b, c, d, 0, 0])!, 5, 0)
    expect([+dx.toFixed(9), +dy.toFixed(9)]).toEqual([0, -5])
    const moved = moveBy(sc.root[0].c![0], dx, dy).node
    expect(moved.attrs.x).toBe(20)
    expect(moved.attrs.y).toBe(25)
  })
})

describe('every scene a drag makes', () => {
  const ops = [node('R', { x: 1, y: 2, w: 3, h: 4 }), node('C', { cx: 5, cy: 5, rx: 2 }), node('C', { cx: 5, cy: 5, rx: 2, ry: 3 }),
    node('L', { p: [0, 0, 10, 0] }), node('Y', { p: [0, 0, 10, 0, 5, 5] }), node('SP', { p: [0, 0, 10, 0, 5, 5] }),
    node('P', { d: 'M0 0 L10 0 Q5 5 0 0 Z' }), node('T', { x: 0, y: 0, w: 10, h: 10, text: 'hi' }),
    node('IMG', { x: 0, y: 0, w: 10, h: 10, src: 'a.png' }), node('SC', { x: 0, y: 0, w: 10, h: 10, ch: 20 }),
    node('G', {}, [node('R')]), node('G', { t: [1, 2] }, [node('R')]), node('USE', { x: 1, y: 1, ref: 's' })]
  it.each(ops.map(n => [n.op + JSON.stringify(n.attrs), n]))('passes validateScene: %s', (_, n) => {
    // The live writers (editing/transform.ts): M1's moveNode and resizeNode had no caller since M2c Task 5.
    const h = handlesOf(n), b = h?.box
    const made = [moveBy(n, 1.2345, -2.5), ...h?.resize && b ? [resizeTo(n, 'se', b, { ...b, w: b.w + 3, h: b.h + 4 }), resizeTo(n, 'w', b, { ...b, x: b.x - 2, w: b.w + 2 })] : []]
    for (const m of made) {
      expect(m.locked).toBeUndefined()
      expect(m.node).not.toBe(n)
      expect(validateScene(scene([m.node])).errors).toEqual([])
    }
  })
})

describe('boxOf', () => {
  it('reads the box each op is drawn in', () => {
    expect(boxOf(node('C', { cx: 5, cy: 5, rx: 2 }))).toEqual({ x: 3, y: 3, w: 4, h: 4 })
    expect(boxOf(node('L', { p: [4, 0, 0, 8, 2] }))).toEqual({ x: 0, y: 0, w: 4, h: 8 })
    expect(boxOf(node('P', { d: 'M1 1 l4 0 v3 Z m-2 0 h1' }))).toEqual({ x: -1, y: 1, w: 6, h: 3 })
    expect(boxOf(node('R', { x: 10, w: -4, h: 2 }))).toEqual({ x: 6, y: 0, w: 4, h: 2 })
    expect(boxOf(node('R', { x: '=t' }))).toBeNull()
    expect(boxOf(node('G'))).toBeNull()
  })
  it('boxes a path exactly: a cubic by its bulge, not its control points; an arc that bulges past its end points', () => {
    expect(boxOf(node('P', { d: 'M0 0 C0 10 10 10 10 0' }))).toEqual({ x: 0, y: 0, w: 10, h: 7.5 })
    const arc = boxOf(node('P', { d: 'M0 0 A10 10 0 0 1 20 0' }))!
    expect([arc.x, arc.y, arc.w, arc.h].map(v => Math.round(v * 1e6) / 1e6)).toEqual([0, -10, 20, 10])
    expect(boxOf(node('P', { d: 'M0 0 Q' }))).toBeNull()
  })
  it('boxes an SP by what it draws (Catmull-Rom overshoots its corner), not its control hull', () => {
    const b = boxOf(node('SP', { p: [0, 0, 10, 0, 10, 10] }))!
    expect(b.x).toBe(0)
    expect(b.y).toBeCloseTo(-0.732421875, 9)
    expect(b.w).toBeCloseTo(10.732421875, 9)
    expect(b.h).toBeCloseTo(10.732421875, 9)
    // Open: the end points repeat for the tangents (Stroke.Spline), so the samples bunch toward the ends.
    expect(spSamples([0, 0, 10, 0, 20, 0], 2, false)).toEqual([0, 0, 4.375, 0, 10, 0, 15.625, 0, 20, 0])
    expect(spSamples([0, 0, 10, 0, 10, 10], 1, true)).toHaveLength(6)
    // seg rounds half to even, as SceneModel's Mathf.RoundToInt: 2.5 draws 2 samples per span, 3.5 draws 4.
    expect(spSamples([0, 0, 10, 0], 2.5, false)).toHaveLength(6)
    expect(spSamples([0, 0, 10, 0], 3.5, false)).toHaveLength(10)
  })
  it('samples a closed SP round the ring without repeating its first point; two points never close; seg clamps to 1..32', () => {
    expect(spSamples([0, 0, 10, 0, 10, 10], 2, true)).toEqual([0, 0, 4.375, -1.25, 10, 0, 11.25, 5.625, 10, 10, 4.375, 5.625])
    expect(spSamples([0, 0, 10, 0], 2, false)).toEqual([0, 0, 5, 0, 10, 0])
    expect(spSamples([0, 0, 10, 0], 2, true)).toEqual([0, 0, 5, 0, 10, 0])
    expect(spSamples([0, 0, 10, 0], 40, false)).toHaveLength(2 * 32 + 2)
    expect(spSamples([0, 0, 10, 0], 0, false)).toEqual([0, 0, 10, 0])
    // close above 0.5 closes (SceneModel); the closed ring overshoots further than the open corner.
    const sp = (close: number) => boxOf(node('SP', { p: [0, 0, 10, 0, 10, 10], close }))
    near(sp(1), { x: 0, y: -1.25, w: 11.25, h: 11.25 })
    near(sp(0.5), { x: 0, y: -0.732421875, w: 10.732421875, h: 10.732421875 })
  })
  it('boxes curves and arcs by extremes that fall between the samples', () => {
    // y turns at t ≈ 0.18 and 0.79; the 16 samples alone give [-1.23047, 4.21875].
    near(boxOf(node('P', { d: 'M0 0 C0 12 4 -6 10 0' })), { x: 0, y: -1.2622606188815186, w: 10, h: 5.4874842007246025 })
    // A quadratic peaking at t = 10/17: y = 100/17 (the samples alone give 5.87109).
    near(boxOf(node('P', { d: 'M0 0 Q3 10 10 3' })), { x: 0, y: 0, w: 10, h: 100 / 17 })
    // The ellipse rx 10 ry 5 turned 30° about (0, 0), from θ = 0.2 to θ = 3.0: its least x is -√81.25 and its greatest y
    // √43.75, both between samples; the other sides are the end points.
    near(boxOf(node('P', { d: 'M7.990952211 5.760596326 A10 5 30 0 1 -8.926386536 -4.338894923' })),
      { x: -Math.sqrt(81.25), y: -4.338894923, w: Math.sqrt(81.25) + 7.990952211, h: Math.sqrt(43.75) + 4.338894923 })
  })
  it('gives the outline a box comes from: corners, points, samples, subpaths; none for C', () => {
    expect(outline(node('R', { x: 1, y: 2, w: 3, h: 4 }))).toEqual([[1, 2, 4, 2, 4, 6, 1, 6]])
    expect(outline(node('Y', { p: [0, 0, 4, 0, 0, 4] }))).toEqual([[0, 0, 4, 0, 0, 4]])
    expect(outline(node('P', { d: 'M0 0 L1 0 M5 5 L6 5' }))).toEqual([[0, 0, 1, 0], [5, 5, 6, 5]])
    expect(outline(node('C', { cx: 1, cy: 1, rx: 1 }))).toBeNull()
  })
})

describe('designSize', () => {
  it('reads SCENE w and h as the mod does: at least 1, else 100', () => {
    expect(designSize({ w: 480, H: 1080 })).toEqual({ w: 480, h: 1080 })
    expect(designSize({ w: 0, h: '=5' })).toEqual({ w: 1, h: 100 })
  })
})
