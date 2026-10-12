import { describe, expect, it } from 'vitest'
import { keep, round } from '../editor/geometry'
import { absArgs, flattenPath, movePathPoint, parsePath, pathCross, pathHandles, printPath, relArgs, scalePath, translatePath, splitPathSegment, deletePathPoint, setPointMode, type PathSeg } from './path'
import { pathSegments } from './path'

it.each([0.001, 0.0001])('splits a large arc with a tiny %s chord on the arc rather than at its centre', chord => {
  const d = `M0 0 A10 10 0 1 1 ${chord} 0`
  const mid = pathSegments(d)![0].at(0.5)
  expect(mid.x).toBeCloseTo(chord / 2, 8)
  expect(mid.y).toBeCloseTo(-20, 5)
  const split = splitPathSegment(d, 1, 0.5)!
  const parsed = parsePath(split)
  expect('error' in parsed).toBe(false)
  if ('error' in parsed) return
  expect(parsed.segs[1].args[6]).toBeCloseTo(-20, 5)
  expect(pathSegments(split)![0].at(1).y).toBeCloseTo(-20, 5)
})

describe('parsePath', () => {
  it('reads commands, repeats and separators', () => {
    expect(parsePath('M0 0 L10 0 Z')).toEqual({ segs: [{ cmd: 'M', args: [0, 0] }, { cmd: 'L', args: [10, 0] }, { cmd: 'Z', args: [] }] })
    expect(parsePath('m1,2 3-4 h5')).toEqual({ segs: [{ cmd: 'm', args: [1, 2] }, { cmd: 'l', args: [3, -4] }, { cmd: 'h', args: [5] }] })
    expect(parsePath('M0 0 A1 1 0 0 1 5 5')).toEqual({ segs: [{ cmd: 'M', args: [0, 0] }, { cmd: 'A', args: [1, 1, 0, 0, 1, 5, 5] }] })
  })
  it('reads compact numbers as the mod does since 0.11.94: a second . ends a number, an arc flag is one character', () => {
    expect(parsePath('M0 0 L60.5.5')).toEqual({ segs: [{ cmd: 'M', args: [0, 0] }, { cmd: 'L', args: [60.5, 0.5] }] })
    expect(parsePath('M0 0 a20 20 0 011 40')).toEqual({ segs: [{ cmd: 'M', args: [0, 0] }, { cmd: 'a', args: [20, 20, 0, 0, 1, 1, 40] }] })
    expect(parsePath('M0 0 A1 1 0 01.5 5')).toEqual({ segs: [{ cmd: 'M', args: [0, 0] }, { cmd: 'A', args: [1, 1, 0, 0, 1, 0.5, 5] }] })
  })
  it.each(['M0 0 Z 5', 'M0 0 L1 )', 'M0 0 L1.5.5 2', 'M0 0 A1 1 0 2 1 5 5', 'M0 0 A1 1 0 1e5 5 5', '', 'M0', 'M0 0 L1 2 3', '5 5 L1 1', 'M1e 2', 'M0 0 L1e39 0', 'M1e400 0'])('rejects %j', d => {
    const r = parsePath(d)
    expect(r).toHaveProperty('error')
    expect(r).toHaveProperty('at')
  })
})

describe('translatePath', () => {
  it('shifts only absolute coordinates', () => {
    expect(translatePath('M0 0 L10 0 Z', 2, 3)).toBe('M2 3 L12 3 Z')
    expect(translatePath('m0 0 l10 0', 2, 3)).toBe('m2 3 l10 0')
    expect(translatePath('M0 0 H10 V5', 1, 1)).toBe('M1 1 H11 V6')
    expect(translatePath('M0 0 A4 4 30 0 1 8 8 C1 2 3 4 5 6', 1, 1)).toBe('M1 1 A4 4 30 0 1 9 9 C2 3 4 5 6 7')
    expect(translatePath('M0 0 L1', 1, 1)).toBeNull()
  })
  it('moves the origin a path without a leading M starts from', () => {
    // The mod's cursor starts at (0,0), so the start Z closes to moves too.
    expect(translatePath('l10 0 0 10 z', 2, 3)).toBe('M2 3 l10 0 l0 10 z')
    expect(translatePath('L10 0 L10 10 Z', 2, 3)).toBe('M2 3 L12 3 L12 13 Z')
  })
  it('prints what it parses', () => {
    const r = parsePath('M0.1,0 Q1 2 3 4 t5 6 S1 2 3 4 z')
    expect('segs' in r && printPath(r.segs)).toBe('M0.1 0 Q1 2 3 4 t5 6 S1 2 3 4 z')
  })
})

describe('absolute paths', () => {
  const segs = (d: string) => (parsePath(d) as { segs: PathSeg[] }).segs
  it('makes every argument absolute, and writes them back in each command\'s own form', () => {
    const s = segs('M1 1 l4 0 v3 Z m-2 0 h1')
    expect(absArgs(s)).toEqual([[1, 1], [5, 1], [4], [], [-1, 1], [0]])
    expect(relArgs(s, absArgs(s))).toEqual(s)
  })
  it('flattens per subpath, with curve and arc extremes; drops a lone point', () => {
    expect(flattenPath('M0 0 L1 0 M5 5 L6 5 M9 9')).toEqual([[0, 0, 1, 0], [5, 5, 6, 5]])
    const ys = flattenPath('M0 0 C0 10 10 10 10 0')![0].filter((_, i) => i % 2)
    expect(Math.max(...ys)).toBe(7.5)
    expect(flattenPath('M0 0 Q')).toBeNull()
    // An asymmetric cubic: both y turns fall between the 16 samples (which alone give -1.23047 and 4.21875).
    const turns = flattenPath('M0 0 C0 12 4 -6 10 0')![0].filter((_, i) => i % 2)
    expect(Math.min(...turns)).toBeCloseTo(-1.2622606188815186, 9)
    expect(Math.max(...turns)).toBeCloseTo(4.225223581843084, 9)
  })
  it('reflects an S or T control only after its own kind; Z puts the cursor back at the subpath start', () => {
    const ys = (d: string) => flattenPath(d)!.flat().filter((_, i) => i % 2)
    expect(Math.min(...ys('M0 0 Q5 10 10 0 T20 0'))).toBeCloseTo(-5, 9)            // control (15, -10)
    expect(Math.min(...ys('M0 0 Q5 10 10 0 L20 0 T30 0'))).toBe(0)                 // control at the cursor: a line
    expect(Math.min(...ys('M0 0 C0 10 10 10 10 0 S20 -10 20 0'))).toBeCloseTo(-7.5, 9)        // c1 = (10, -10)
    expect(Math.min(...ys('M0 0 C0 10 10 10 10 0 L20 0 S30 -10 30 0'))).toBeCloseTo(-40 / 9, 9) // c1 at the cursor
    expect(flattenPath('M5 5 L10 5 Z l0 10')).toEqual([[5, 5, 10, 5], [5, 5, 5, 15]])
  })
  it('scales about a fixed point, each command keeping its letter; mirrors flip an arc\'s sweep', () => {
    expect(scalePath('M0 0 l10 10', [2, 2], [0, 0], [0, 0])).toBe('M0 0 l20 20')
    expect(scalePath('M0 0 A10 10 0 0 1 20 0', [-1, 1], [0, 0], [20, 0])).toBe('M20 0 A10 10 0 0 0 0 0')
    expect(scalePath('M0 0 A10 10 30 0 1 20 0', [2, 1], [0, 0], [0, 0])).toBe('M0 0 A20 10 0 0 1 40 0')
    // A proportional drag's two factors may differ by float noise: still even, so the turned ellipse scales.
    const k: [number, number] = [7 / 10, 2.0999999999999996 / 3]   // 0.7 and 0.6999999999999998
    expect(scalePath('M0 0 A10 5 30 0 1 20 0', k, [0, 0], [0, 0], v => Math.round(v * 1000) / 1000)).toBe('M0 0 A7 3.5 30 0 1 14 0')
    expect(scalePath('L10 0', [2, 2], [5, 0], [5, 0])).toBe('M-5 0 L15 0')
    expect(scalePath('M0 0 L1 0', [1 / 3, 1], [0, 0], [0, 0], v => Math.round(v * 1000) / 1000)).toBe('M0 0 L0.333 0')
  })
  it('scales V on y; a mirror negates an arc\'s turn; a quarter-turned ellipse swaps its radii', () => {
    expect(scalePath('M0 0 V10', [1, 2], [0, 0], [0, 0])).toBe('M0 0 V20')
    expect(scalePath('M0 0 A10 5 30 0 1 20 0', [-1, 1], [0, 0], [0, 0])).toBe('M0 0 A10 5 -30 0 0 -20 0')
    expect(scalePath('M0 0 A10 5 90 0 1 20 0', [2, 1], [0, 0], [0, 0])).toBe('M0 0 A10 10 90 0 1 40 0')
  })
  it('scales an ellipse turned by other than a quarter unevenly to the exact image ellipse', () => {
    // An axis scale maps a shape's box to the box scaled, so the scaled path's exact box is the original's, mapped.
    const box = (d: string) => { const xy = flattenPath(d)!.flat(), xs = xy.filter((_, i) => !(i % 2)), ys = xy.filter((_, i) => i % 2)
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
    for (const [d, k, from, to] of [
      ['M0 0 A10 5 30 0 1 20 0', [2, 1], [0, 0], [0, 0]],
      ['M3 4 a10 5 30 1 0 15 5 L0 0', [-1.5, 0.5], [3, 4], [10, -2]],
      ['M0 0 A8 3 -70 0 1 5 12 A8 3 -70 0 1 0 0', [0.25, 3], [0, 0], [1, 1]],
    ] as [string, [number, number], [number, number], [number, number]][]) {
      const out = scalePath(d, k, from, to)!
      expect(out).toMatch(/^M\S+ \S+ [Aa]/)
      const [x0, y0, x1, y1] = box(d), m = (v: number, i: number) => to[i] + (v - from[i]) * k[i]
      const want = [Math.min(m(x0, 0), m(x1, 0)), Math.min(m(y0, 1), m(y1, 1)), Math.max(m(x0, 0), m(x1, 0)), Math.max(m(y0, 1), m(y1, 1))]
      // 3 places: the path is printed in float32 (the mod reads it so), and the third ellipse is thin enough (22.8 by 0.79)
      // for its turn's 7th digit to move its box by 3e-5.
      box(out).forEach((v, i) => expect(v).toBeCloseTo(want[i], 3))
    }
  })
  it('keeps a number that rounds the same as written, and gives d itself when nothing changes', () => {
    const r = (v: number, was: number) => keep(was, v)
    expect(scalePath('M0 0 L10.12345 5.12345', [2, 1], [0, 0], [0, 0], r)).toBe('M0 0 L20.247 5.12345')
    const d = 'M 0,0 L 10.12345 5 a3 3 0 0 1 6 0'
    expect(scalePath(d, [1, 1], [0, 0], [0, 0], r)).toBe(d)
    expect(scalePath('l10 0', [1, 1], [4, 4], [4, 4], r)).toBe('l10 0')
  })
})

describe('path points', () => {
  it('lists each command\'s explicit points, absolute; H and V move along their axis only', () => {
    expect(pathHandles('M0 0 h10 v10 Q20 20 30 10 Z')).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0, axis: 'x' }, { x: 10, y: 10, axis: 'y' },
      { x: 20, y: 20 }, { x: 30, y: 10 }])
    expect(pathHandles('M0 0 S10 10 20 0 A5 5 0 0 1 30 0')).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 0 }])
    expect(pathHandles('M0 0 Q')).toBeNull()
  })
  it('moves one point and keeps every other where it is, each command keeping its letter', () => {
    expect(movePathPoint('M0 0 l10 0 l0 10', 1, 20, 0)).toBe('M0 0 l20 0 l-10 10')
    expect(movePathPoint('M0 0 h10 v10 Q20 20 30 10 Z', 1, 15, 99)).toBe('M0 0 h15 v10 Q20 20 30 10 Z')
    expect(movePathPoint('M0 0 L1 1', 5, 0, 0)).toBeNull()
  })
  it('rewrites only the moved command and a relative one whose start moved on an axis it reads', () => {
    expect(movePathPoint('m10 10 l5 0', 0, 20, 20)).toBe('m20 20 l-5 -10')
    expect(movePathPoint('M0 0 L10 10 h5', 1, 20, 30)).toBe('M0 0 L20 30 h-5')
    expect(movePathPoint('M0 0 L10 10 h5', 1, 10, 30)).toBe('M0 0 L10 30 h5')   // h reads only x
    expect(movePathPoint('M0 0 L10 10 v5', 1, 10, 30)).toBe('M0 0 L10 30 v-15')
    expect(movePathPoint('M0 0 a5 5 0 0 1 10 0', 1, 20, 0)).toBe('M0 0 a5 5 0 0 1 20 0')
    // After Z the cursor is the subpath's start: moving the M keeps the next relative command's end in place.
    expect(movePathPoint('M0 0 L10 0 Z l5 5', 0, 2, 2)).toBe('M2 2 L10 0 Z l3 3')
    expect(movePathPoint('M0 0 l40 0 q20 20 40 0 h40', 1, 50, 10)).toBe('M0 0 l50 10 q10 10 30 -10 h40')
  })
  it('keeps the numbers of a command the move does not reach as written, and gives d itself when nothing changes', () => {
    // Through absolute and back, 0.3 after 1e17 would come back as 0 (a double's step there is 16).
    expect(movePathPoint('M1e17 0 l0.3 0 L5 5', 2, 6, 6)).toBe('M100000000000000000 0 l0.3 0 L6 6')
    const d = 'M 0,0 L 10 5'
    expect(movePathPoint(d, 1, 10, 5)).toBe(d)
  })
  it('rewrites an h after a move that changed only its start\'s y, and a v only its start\'s x, not at all', () => {
    // Rewritten through absolute, 0.3 after 1e17 would come back as 0: these pin which axis each one reads.
    expect(movePathPoint('M1e17 0 L1e17 10 h0.3', 1, 1e17, 30)).toBe('M100000000000000000 0 L100000000000000000 30 h0.3')
    expect(movePathPoint('M0 1e17 L10 1e17 v0.3', 1, 30, 1e17)).toBe('M0 100000000000000000 L30 100000000000000000 v0.3')
  })
  it('writes a rewritten relative number through r when that lands on the same float32 point, else exactly', () => {
    // 10 - fround(12.346) is -2.3459997 as a float32: noise, where -2.346 lands on 10 all the same.
    expect(movePathPoint('M0 0 l10 0 l0 10', 1, Math.fround(12.346), 0, round)).toBe('M0 0 l12.346 0 l-2.346 10')
    expect(movePathPoint('M0 0 l40 0 q20 20 40 0 h40', 1, Math.fround(60.4), Math.fround(0.1), round))
      .toBe('M0 0 l60.4 0.1 q-0.4 19.9 19.6 -0.1 h40')
    // Rounded, -9.87655 would move the next end from 10.12345 to 10.123; a control the move left stays as written.
    expect(movePathPoint('M0 0 l10 0 l0.12345 10', 1, 20, 0, round)).toBe('M0 0 l20 0 l-9.87655 10')
    expect(movePathPoint('M0 0 q10.12345 5 20 0', 2, 30, 0, round)).toBe('M0 0 q10.12345 5 30 0')
    expect(movePathPoint('M0 0 a5.12345 5 0 0 1 10.12345 0', 1, 20.5, 0, round)).toBe('M0 0 a5.12345 5 0 0 1 20.5 0')
    // An arc's radii, turn and flags are not relative: 5.0004 is no cursor (0.0004) plus 5.
    expect(movePathPoint('M0.0004 0 a5.0004 5 0 0 1 10 0', 1, 20, 0, round)).toBe('M0.0004 0 a5.0004 5 0 0 1 19.9996 0')
  })
  it('names the point an H or V point takes its other coordinate from: the last to set the cursor\'s', () => {
    // H100 and H120 take the L end's y, V80 and V90 the H120's x; after Z the cursor is the M's; v1 takes the Q end's x.
    expect(pathCross('M0 0 L50 50 H100 H120 V80 V90 Z h5 Q1 2 3 4 v1')).toEqual([-1, -1, 1, 1, 3, 3, 0, -1, -1, 8])
    expect(pathCross('H5 V5')).toEqual([-1, 0])   // the mod's start cursor is no point
    expect(pathCross('M0 0 Q')).toBeNull()
  })
})

describe('path segment and anchor edits', () => {
  it.each([0, 6])('deletes a pen-closed two-anchor cubic subpath from either copy of its start (%i)', point => {
    expect(deletePathPoint('M0 0 C0 40 100 40 100 0 C100 -40 0 -40 0 0 Z', point)).toBeNull()
  })
  it.each([0, 4])('deletes a closed line start and its duplicate endpoint together (%i)', point => {
    expect(deletePathPoint('M0 0 L10 0 L10 10 L0 10 L0 0 Z', point)).toBe('M10 0 L10 10 L0 10 Z')
  })
  it('joins the outer controls when deleting a duplicated start of a larger cubic contour', () => {
    expect(deletePathPoint('M0 0 C0 40 100 40 100 0 C110 20 110 80 100 100 C60 100 0 -40 0 0 Z M200 0 l10 0', 0))
      .toBe('M100 0 C110 20 110 80 100 100 C60 100 100 40 100 0 Z M200 0 l10 0')
  })
  it('splits a cubic by de Casteljau and keeps its samples', () => {
    const d = 'M0,0 C0,10 10,10 10,0', out = splitPathSegment(d, 1, 0.5)!
    expect(parsePath(out)).toEqual(parsePath('M0,0 C0,5 2.5,7.5 5,7.5 C7.5,7.5 10,5 10,0'))
    const value = (p: number[], t: number) => [0, 1].map(i => (1-t)**3*p[i] + 3*(1-t)**2*t*p[i+2] + 3*(1-t)*t*t*p[i+4] + t**3*p[i+6])
    for (let i = 0; i <= 32; i++) {
      const t = i/32, a = value([0,0,0,10,10,10,10,0], t)
      const b = t <= 0.5 ? value([0,0,0,5,2.5,7.5,5,7.5], t*2) : value([5,7.5,7.5,7.5,10,5,10,0], t*2-1)
      b.forEach((v, j) => expect(v).toBeCloseTo(a[j], 4))
    }
  })
  it('splits lines, quadratics and shorthand only at the touched segment', () => {
    expect(splitPathSegment('M0 0 L10 0', 1, 0.5)).toBe('M0 0 L5 0 L10 0')
    expect(splitPathSegment('M0 0 h10 v10', 1, 0.5)).toBe('M0 0 L5 0 L10 0 v10')
    expect(splitPathSegment('M0 0 Q0 10 10 0', 1, 0.5)).toBe('M0 0 Q0 5 2.5 5 Q5 5 10 0')
    expect(splitPathSegment('M0 0 Q0 10 10 0 T20 0 m100 100 h4', 2, 0.5)).toBe('M0 0 Q0 10 10 0 Q15 -5 17.5 -5 Q20 -5 20 0 m100 100 h4')
    expect(splitPathSegment('M0 0 C0 10 10 10 10 0 S20 -10 20 0', 2, 0.5)).toBe('M0 0 C0 10 10 10 10 0 C10 -5 12.5 -7.5 15 -7.5 C17.5 -7.5 20 -5 20 0')
    expect(splitPathSegment('M0 0 L10 0', 1, 0)).toBeNull()
    expect(splitPathSegment('M0 0 L10 0', 0, 0.5)).toBeNull()
  })
  it('splits arcs on their original ellipse, including corrected radii and large arcs', () => {
    const half = splitPathSegment('M0 0 A10 5 0 0 1 20 0', 1, 0.5)!
    const p = parsePath(half); expect('segs' in p).toBe(true)
    if ('segs' in p) {
      expect(p.segs[1].args.slice(0, 5)).toEqual([10, 5, 0, 0, 1])
      expect(p.segs[1].args[5]).toBeCloseTo(10, 4); expect(p.segs[1].args[6]).toBeCloseTo(-5, 4)
      expect(p.segs[2].args.slice(-2)).toEqual([20, 0])
    }
    for (const d of ['M0 0 A2 1 0 0 1 20 0', 'M0 0 A10 5 0 1 1 10 0']) {
      const before = flattenPath(d)!.flat(), after = flattenPath(splitPathSegment(d, 1, 0.5)!)!.flat()
      for (const axis of [0, 1]) {
        const a = before.filter((_, i) => i%2 === axis), b = after.filter((_, i) => i%2 === axis)
        expect(Math.min(...b)).toBeCloseTo(Math.min(...a), 4); expect(Math.max(...b)).toBeCloseTo(Math.max(...a), 4)
      }
    }
  })
  it('deletes anchors, keeps outer controls and untouched hole commands', () => {
    expect(deletePathPoint('M0 0 L5 5 L10 0', 1)).toBe('M0 0 L10 0')
    expect(deletePathPoint('M0 0 L10 0', 1)).toBeNull()
    expect(deletePathPoint('M0 0 L10 0 M50 50 l10 0', 0)).toBe('M50 50 l10 0')
    expect(deletePathPoint('M0 0 C1 2 3 4 5 5 C6 7 8 9 10 0', 3)).toBe('M0 0 C1 2 8 9 10 0')
    expect(deletePathPoint('M0 0 L10 0 L10 10 L0 10 Z M2 2 v6 h6 v-6 Z', 1)).toBe('M0 0 L10 10 L0 10 Z M2 2 v6 h6 v-6 Z')
    expect(deletePathPoint('M0 0 C1 2 3 4 5 5', 1)).toBeNull()
  })
  it('converts an anchor to mirrored smooth controls or collapsed corner controls', () => {
    expect(setPointMode('M0 0 C1 0 4 4 5 5 C7 5 9 0 10 0', 3, 'smooth')).toBe('M0 0 C1 0 4 4 5 5 C6 6 9 0 10 0')
    expect(setPointMode('M0 0 C1 0 4 4 5 5 C7 5 9 0 10 0', 3, 'corner')).toBe('M0 0 C1 0 5 5 5 5 C5 5 9 0 10 0')
    const sm = parsePath(setPointMode('M0 0 L5 5 L10 0', 1, 'smooth')!)
    if ('error' in sm) throw new Error(sm.error)
    expect(sm.segs.map(s => s.cmd)).toEqual(['M', 'C', 'C'])
    expect(sm.segs[1].args[2] + sm.segs[2].args[0]).toBeCloseTo(10, 5)
    expect(sm.segs[1].args[3] + sm.segs[2].args[1]).toBeCloseTo(10, 5)
    expect(setPointMode('=t', 0, 'smooth')).toBeNull()
  })
  it('edits the closing edge and preserves outer controls at closed-subpath ends', () => {
    expect(splitPathSegment('M0 0 L10 0 L10 10 Z', 3, 0.5)).toBe('M0 0 L10 0 L10 10 L5 5 Z')
    expect(deletePathPoint('M0 0 L10 0 C11 1 9 9 10 10 Z', 4)).toBe('M0 0 L10 0 C11 1 0 0 0 0 Z')
    expect(deletePathPoint('M0 0 C1 1 9 1 10 0 L10 10 Z', 0)).toBe('M10 0 L10 10 C10 10 9 1 10 0 Z')
    const sm = parsePath(setPointMode('M0 0 L10 0 L10 10 Z', 0, 'smooth')!)
    if ('error' in sm) throw new Error(sm.error)
    expect(sm.segs.map(s => s.cmd)).toEqual(['M', 'C', 'L', 'C', 'Z'])
    expect(sm.segs[1].args[0] + sm.segs[3].args[2]).toBeCloseTo(0, 5)
    expect(sm.segs[1].args[1] + sm.segs[3].args[3]).toBeCloseTo(0, 5)
  })
  it('keeps a following reflected curve geometrically unchanged when splitting its predecessor', () => {
    expect(splitPathSegment('M0 0 C0 10 10 10 10 0 S20 -10 20 0', 1, 0.5))
      .toBe('M0 0 C0 5 2.5 7.5 5 7.5 C7.5 7.5 10 5 10 0 C10 -10 20 -10 20 0')
    expect(splitPathSegment('M0 0 Q0 10 10 0 T20 0', 1, 0.5)).toBe('M0 0 Q0 5 2.5 5 Q5 5 10 0 Q20 -10 20 0')
  })
  it('keeps reflected commands after a deleted start or converted neighbour in place', () => {
    expect(deletePathPoint('M0 0 C0 10 10 10 10 0 S20 -10 20 0 L30 0', 0)).toBe('M10 0 C10 -10 20 -10 20 0 L30 0')
    const d = setPointMode('M0 0 Q0 10 10 0 T20 0 T30 0', 2, 'corner')!
    expect(d).toContain('Q20 10 30 0')
  })
  it('normalizes only the directly affected shorthand in a reflection chain', () => {
    expect(splitPathSegment('M0 0 Q0 10 10 0 T20 0 T30 0', 1, 0.5)).toBe('M0 0 Q0 5 2.5 5 Q5 5 10 0 Q20 -10 20 0 T30 0')
  })
})
