import { describe, expect, it } from 'vitest'
import { SHAPES, SIZES, sizeOf, unitsOf } from './shapes'

// Every shape, in the picker's order: [px w, px h, units w, units h, cells tall, turned]. Cells tall are the console's own
// (its footprint's second number); a turned page is the console placed a quarter turn round, read upright (portrait).
// The MoreConsoles px are the console canvas's sizeDelta in each prefab (= ModConsole.ScreenSize), rounded to whole px
// (ui:size() reports the fraction, 1035.69983 for the 2×1); a turned console's rect is swapped (ModConsole.OnRegistered).
// "game" marks a size read in game (2026-10-06: each chip's ui:size(), as its own rects and list_chips report it).
const ALL: Record<string, [number, number, number, number, number, boolean]> = {
  square: [460, 460, 480, 480, 1, false],                  // game: 460
  '2x1': [1036, 460, 1080, 480, 1, false],                 // game: 1035.69983, and its Dual
  monitor: [943, 460, 984, 480, 1, false],                 // game: 943.3719
  v2x1: [460, 1036, 480, 1080, 1, true],                   // game: 460 × 1035.69983, and its Dual
  vmonitor: [460, 943, 480, 984, 1, true],
  ac: [319, 273, 561, 480, 1, false],
  '2x2-lcm': [460, 460, 960, 960, 2, false],               // LargeConsoleMod's Console 2x2, game: 460
  '2x2': [456, 460, 952, 960, 2, false],                   // Rugged 456.3115, Bulkhead 456.2688, and their Duals
  v2x2: [460, 456, 960, 952, 2, true],
  '3x2': [714, 460, 1490, 960, 2, false],                  // Console 3x2 and Dual 3x2: 713.864
  v3x2: [460, 714, 960, 1490, 2, true],                    // game: 460 × 713.864
  '3x2-panel': [713, 460, 1488, 960, 2, false],            // Panel 3x2 and Panel Dual 3x2: 713.3855, game too
  'v3x2-panel': [460, 713, 960, 1488, 2, true],
  '3x2-rugged': [720, 460, 1503, 960, 2, false],           // 719.7708
  'v3x2-rugged': [460, 720, 960, 1503, 2, true],
  '3x2-bulkhead': [723, 460, 1509, 960, 2, false],         // 722.781
  'v3x2-bulkhead': [460, 723, 960, 1509, 2, true],
  '3x3-lcm': [460, 460, 1440, 1440, 3, false],             // LargeConsoleMod's Console 3x3, game: 460
  '3x3': [458, 460, 1434, 1440, 3, false],                 // Rugged 457.65472, Bulkhead 457.63754
  v3x3: [460, 458, 1440, 1434, 3, true],
  'monitor-2x2-rugged': [435, 460, 908, 960, 2, false],    // 434.7484
  'vmonitor-2x2-rugged': [460, 435, 960, 908, 2, true],
  'monitor-2x2-bulkhead': [433, 460, 904, 960, 2, false],  // 433.22696
  'vmonitor-2x2-bulkhead': [460, 433, 960, 904, 2, true],
  'monitor-3x2': [684, 460, 1427, 960, 2, false],          // Monitor 3x2 and Panel Monitor 3x2: 684.33014, game: 684.330139
  'vmonitor-3x2': [460, 684, 960, 1427, 2, true],
  'monitor-3x2-rugged': [686, 460, 1432, 960, 2, false],   // Rugged 685.75793, Bulkhead 686.2801
  'vmonitor-3x2-rugged': [460, 686, 960, 1432, 2, true],
  'monitor-3x3-rugged': [444, 460, 1390, 1440, 3, false],  // 443.66302
  'vmonitor-3x3-rugged': [460, 444, 1440, 1390, 3, true],
  'monitor-3x3-bulkhead': [443, 460, 1387, 1440, 3, false], // 442.7284
  'vmonitor-3x3-bulkhead': [460, 443, 1440, 1387, 3, true],
}
// Spec 5.4's first shapes; the 2×1's 1080 is its 2.25:1, not 480 · 1036 / 460 rounded (1081).
const FIRST = ['square', '2x1', 'monitor', 'v2x1', 'ac']
// Labelled without a mod's name, as the first shapes are (the turned 2×1 monitor), or with LargeConsoleMod's.
const PLAIN = [...FIRST, 'vmonitor'], LCM = ['2x2-lcm', '3x3-lcm']

describe('shapes', () => {
  it('has each shape at its px and units, in this order', () => {
    expect(Object.keys(SHAPES)).toEqual(Object.keys(ALL))
    for (const [k, [pw, ph, uw, uh]] of Object.entries(ALL))
      expect([k, SHAPES[k as keyof typeof SHAPES].px, SHAPES[k as keyof typeof SHAPES].units]).toEqual([k, { w: pw, h: ph }, { w: uw, h: uh }])
  })

  it('gives every shape 480 units per cell of its height (a turned page\'s width), the other side keeping its px aspect', () => {
    for (const [k, [, , , , cells, turned]] of Object.entries(ALL)) {
      const { px, units } = SHAPES[k as keyof typeof SHAPES]
      const [side, other, pxSide, pxOther] = turned ? [units.w, units.h, px.w, px.h] : [units.h, units.w, px.h, px.w]
      expect([k, side]).toEqual([k, 480 * cells])
      expect(Math.abs((units.w / units.h) / (px.w / px.h) - 1)).toBeLessThan(0.005)
      if (!FIRST.includes(k)) expect([k, other]).toEqual([k, Math.round(side * pxOther / pxSide)])
    }
  })

  it('makes a vertical shape its console turned: px and units swapped', () => {
    for (const k of Object.keys(ALL).filter(k => ALL[k][5])) {
      const v = SHAPES[k as keyof typeof SHAPES], s = SHAPES[k.slice(1) as keyof typeof SHAPES]
      expect([k, v.px, v.units]).toEqual([k, { w: s.px.h, h: s.px.w }, { w: s.units.h, h: s.units.w }])
    }
  })

  // Every console here is placed face-mounted and can be turned (PlacementType 2, ModConsole), monitors too; a square
  // surface turned is itself, and the AC face is no console.
  it('turns every console that is not square, monitors too', () => {
    for (const [k, [pw, ph, , , , turned]] of Object.entries(ALL))
      if (!turned && pw !== ph && k !== 'ac') expect([k, Object.hasOwn(SHAPES, 'v' + k)]).toEqual([k, true])
  })

  it("names each mod's shapes after it", () => {
    for (const k of Object.keys(ALL)) {
      const label = SHAPES[k as keyof typeof SHAPES].label
      expect([k, label.endsWith('(LargeConsoleMod)'), label.endsWith('(MoreConsoles)')])
        .toEqual([k, LCM.includes(k), !LCM.includes(k) && !PLAIN.includes(k)])
    }
    expect([SHAPES['2x2-lcm' as keyof typeof SHAPES].label, SHAPES['3x3-lcm' as keyof typeof SHAPES].label])
      .toEqual(['2×2 (LargeConsoleMod)', '3×3 (LargeConsoleMod)'])
  })

  it('is frozen to the leaves, since pages and unitsOf share its objects', () => {
    expect(Object.isFrozen(SHAPES)).toBe(true)
    for (const s of Object.values(SHAPES)) expect([s, s.px, s.units].every(o => Object.isFrozen(o))).toBe(true)
    expect(() => { (unitsOf('2x1', SHAPES['2x1'].px) as { w: number }).w = 1 }).toThrow(TypeError)
  })

  it('makes a custom size 480 on its shorter side', () => {
    expect(unitsOf('custom', { w: 800, h: 400 })).toEqual({ w: 960, h: 480 })
    expect(unitsOf('custom', { w: 400, h: 800 })).toEqual({ w: 480, h: 960 })
  })
})

// The menus offer sizes, not models (owner, 2026-10-13: "here you should only have the sizes not all the consoles").
describe('sizes', () => {
  const within = (a: { w: number; h: number }, b: { w: number; h: number }) => Math.abs(a.w - b.w) / b.w <= 0.02 && Math.abs(a.h - b.h) / b.h <= 0.02
  it('puts every model in exactly one size, each within 2% of its representative on each side', () => {
    expect([...SIZES.flatMap(s => s.keys)].sort()).toEqual(Object.keys(SHAPES).sort())
    for (const s of SIZES) for (const k of s.keys) expect([k, within(SHAPES[k].units, SHAPES[s.keys[0]].units)]).toEqual([k, true])
  })
  it('keeps the sizes apart: no two representatives within 2%', () => {
    for (const a of SIZES) for (const b of SIZES) if (a !== b) expect([a.label, b.label, within(SHAPES[a.keys[0]].units, SHAPES[b.keys[0]].units)]).toEqual([a.label, b.label, false])
  })
  it('lists the sizes in order, named without mod names', () => {
    expect(SIZES.map(s => s.label)).toEqual(['Square (1×1)', '2×1', 'Vertical 2×1', 'Monitor', 'Vertical Monitor', 'Air Conditioner face (beta)',
      '2×2', '3×2', 'Vertical 3×2', '3×3', 'Monitor 2×2', 'Vertical Monitor 2×2', 'Monitor 3×2', 'Vertical Monitor 3×2', 'Monitor 3×3', 'Vertical Monitor 3×3'])
  })
  it('finds the size of any model, and none for a custom size', () => {
    expect([sizeOf('3x2-rugged')?.label, sizeOf('3x3-lcm')?.label, sizeOf('v2x2')?.label, sizeOf('custom')]).toEqual(['3×2', '3×3', '2×2', undefined])
  })
})
