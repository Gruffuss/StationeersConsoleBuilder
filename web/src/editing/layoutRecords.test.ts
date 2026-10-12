import { expect, it } from 'vitest'
import { node } from '../model/testing'
import type { Scene, SrcNode, Value } from '../model/scene'
import { parseSrc } from '../srctext/parse'
import { printChecked } from '../srctext/print'
import { checkScene as checked } from '../srctext/check'
import { vanillaPlus } from '../theme/vanillaPlus'
import { expandRoot, widgetOf } from '../widgets/core'
import { instance } from '../widgets/testing'
import { layoutBox, layoutOf, marginOf, fillsBox, reflow, withLayout, withMargin, withFill, type LayoutRecord } from './layoutRecords'

const record: LayoutRecord = { dir: 'row', pad: [4, 8, 4, 8], gap: 6, align: 'start', justify: 'start', size: 'fixed', box: [0, 0, 100, 60] }
const rect = (id: string) => withMargin(node('R', { id, x: 50, y: 40, w: 10, h: 10 }), [0, 2, 0, 2])
const sceneOf = (g: SrcNode): Scene => ({ header: { w: 460, h: 460 }, defs: [], root: [g] })
const group = (patch: Partial<LayoutRecord> = {}, kids = [rect('a'), rect('b')]) => withLayout(node('G', {}, kids), { ...record, ...patch })
const flow = (patch: Partial<LayoutRecord> = {}, kids?: SrcNode[]) => reflow(sceneOf(group(patch, kids)), [0], vanillaPlus)

it.each([false, true])('keeps ordinary fill comments when setting fill to %s', fill => {
  const n = { ...node('R'), comments: ['fill with water colour', 'author note'] }
  const result = withFill(n, fill)
  expect(result.comments).toEqual([...n.comments, ...(fill ? ['fill'] : [])])
  expect(fillsBox(result)).toBe(fill)
})
it.each([null, record])('keeps ordinary layout comments on remove or record write (%j)', layout => {
  const n = { ...group(), comments: [...group().comments!, 'layout of the page', 'layout notes'] }
  const result = withLayout(n, layout)
  expect(result.comments).toContain('layout of the page'); expect(result.comments).toContain('layout notes')
  expect(layoutOf(result)).toEqual(layout)
})
it('keeps margin prose and reads its record alongside an extra comment', () => {
  const n = { ...rect('a'), comments: [...rect('a').comments!, 'margin is fine here'] }
  expect(marginOf(n)).toEqual([0, 2, 0, 2])
  const result = withMargin(n, [1, 2, 3, 4])
  expect(result.comments).toContain('margin is fine here'); expect(marginOf(result)).toEqual([1, 2, 3, 4])
})
it('still reflows a group carrying its record and layout notes through the code pane', () => {
  const g = group(); g.comments!.push('layout notes')
  const reread = parseSrc(printChecked(sceneOf(g))).scene!
  expect(layoutOf(reread.root[0])).toEqual(record)
  const result = reflow(reread, [0], vanillaPlus)
  expect(result.scene.root[0].c![0].attrs.x).toBe(10)
  expect(result.scene.root[0].comments).toContain('layout notes')
})

it('places a padded row with margins and a gap in source order', () => {
  const r = flow()
  expect(r.scene.root[0].c!.map(n => [n.attrs.x, n.attrs.y])).toEqual([[10, 4], [30, 4]])
  expect(r.skipped).toEqual([])
  expect(checked(r.scene).errors).toEqual([])
  expect(reflow(r.scene, [0], vanillaPlus).scene).toBe(r.scene)
})
it('places a column and aligns or stretches the cross axis', () => {
  expect(flow({ dir: 'column' }).scene.root[0].c!.map(n => n.attrs.y)).toEqual([4, 20])
  expect(flow({ align: 'center' }).scene.root[0].c!.map(n => n.attrs.y)).toEqual([25, 25])
  expect(flow({ align: 'end' }).scene.root[0].c!.map(n => n.attrs.y)).toEqual([46, 46])
  expect(flow({ align: 'stretch' }).scene.root[0].c!.map(n => n.attrs.h)).toEqual([52, 52])
})
it('justifies the run and hugs its margins and padding', () => {
  expect(flow({ justify: 'between' }).scene.root[0].c![1].attrs.x).toBe(80)
  expect(flow({ justify: 'center' }).scene.root[0].c![0].attrs.x).toBe(35)
  expect(flow({ justify: 'end' }).scene.root[0].c![0].attrs.x).toBe(60)
  expect(layoutOf(flow({ size: 'hug' }).scene.root[0])!.box).toEqual([0, 0, 50, 18])
  expect(layoutOf(flow({ size: 'hug', dir: 'column' }).scene.root[0])!.box).toEqual([0, 0, 30, 34])
})
it('fills the box outside the flow and leaves hidden children out', () => {
  const fill = withFill(node('R', { id: 'bg', x: 20, y: 20, w: 1, h: 1 }), true)
  const hidden = { ...rect('hidden'), attrs: { ...rect('hidden').attrs, v: 0 } }
  const r = flow({}, [fill, rect('a'), hidden, rect('b')])
  expect(r.scene.root[0].c![0].attrs).toEqual({ id: 'bg', w: 100, h: 60, x: 0, y: 0 })
  expect(r.scene.root[0].c![3].attrs.x).toBe(30)
  expect(r.scene.root[0].c![2]).toBe(hidden)
})
it('never overwrites expression or locked geometry and names what it skips', () => {
  const expr = node('R', { id: 'dynamic', x: '=t', w: 10, h: 10 })
  const locked = { ...rect('locked'), comments: ['lock'] }
  const r = flow({}, [expr, locked, rect('a')])
  expect(r.scene.root[0].c![0]).toBe(expr)
  expect(r.scene.root[0].c![1]).toBe(locked)
  expect(r.skipped.join('; ')).toContain('dynamic')
  expect(r.skipped.join('; ')).toContain('locked')
})
it('places and stretches a widget through params and preserves its marker and margins', () => {
  const w = instance('button', { x: 90, y: 90, w: 30, h: 40 }), made = expandRoot(w, vanillaPlus)
  const n = withMargin(made.root, [0, 2, 0, 2])
  expect(n.comments!.at(-1)).toMatch(/^widget /)
  const r = flow({ align: 'stretch' }, [n])
  const placed = widgetOf(r.scene.root[0].c![0], vanillaPlus)!
  expect(placed.uid).toBe(w.uid)
  expect(placed.params).toMatchObject({ x: 10, y: 4, h: 52 })
  expect(r.scene.root[0].c![0].comments![0]).toBe('margin [0,2,0,2]')
})
it('works in local units under a scaled ancestor, and scales a plain group for stretch', () => {
  const inner = group(), top = node('G', { s: [2, 2] }, [inner])
  const r = reflow(sceneOf(top), [0, 0], vanillaPlus)
  expect(r.scene.root[0].c![0].c![0].attrs.x).toBe(10)
  expect(r.scene.root[0].attrs.s).toEqual([2, 2])
  const child = node('G', { s: [2, 2] }, [node('R', { w: 10, h: 10 })])
  const stretched = flow({ align: 'stretch' }, [child]).scene.root[0].c![0]
  expect(stretched.attrs.s).toEqual([2, Math.fround(5.2)])
  expect(stretched.attrs.t).toEqual([8, 4])
})
it('keeps negative margins and fixed overflow without shrinking text', () => {
  const child = withMargin(node('T', { id: 'label', w: 150, h: 20, size: 22, text: 'Message' }), [0, 0, 0, -3])
  const n = flow({}, [child]).scene.root[0].c![0]
  expect(n.attrs).toMatchObject({ x: 5, w: 150, size: 22 })
  expect(layoutOf(flow({}, [child]).scene.root[0])!.box).toEqual(record.box)
})
it('round-trips records as comments without unsupported vector keys', () => {
  const g = group(), s = flow().scene
  const reread = parseSrc(printChecked(s)).scene!
  expect(layoutOf(reread.root[0])).toEqual(layoutOf(g))
  expect(reread.root[0].c![0].comments).toEqual(g.c![0].comments)
  expect(reread.root[0].attrs).toEqual({})
  expect(checked(reread).errors).toEqual([])
  const removed = withLayout(s.root[0], null)
  expect(layoutOf(removed)).toBeNull(); expect(removed.c).toBe(s.root[0].c)
})
it.each<Record<string, unknown>>([
  { gap: -1 }, { gap: 1e40 }, { pad: [0, -1, 0, 0] }, { box: [0, 0, -1, 60] },
  { pad: [1, 2] }, { dir: 'grid' }, { dir: ['row'] }, { align: 'invalid' }, { justify: 'invalid' }, { size: 'invalid' },
  { extra: 1 }, { __proto__: null, constructor: 'bad' },
])('rejects malformed or unsupported layout metadata %j', patch => {
  const n = node('G'); n.comments = ['layout ' + JSON.stringify({ ...record, ...patch })]
  expect(layoutOf(n)).toBeNull()
  expect(reflow(sceneOf(n), [0], vanillaPlus).scene.root[0]).toBe(n)
})
it('does not lay out a locked container or write float32 overflow', () => {
  const g = group(); g.comments!.unshift('lock')
  expect(reflow(sceneOf(g), [0], vanillaPlus).scene.root[0]).toBe(g)
  const huge = group({ box: [3e38, 0, 3e38, 60], pad: [4, 3e38, 4, 3e38], size: 'hug' })
  const r = reflow(sceneOf(huge), [0], vanillaPlus)
  expect(r.scene.root[0]).toBe(huge); expect(r.skipped.join('; ')).toContain('float32')
})
it('keeps the recorded cross size when every hug child stretches', () => {
  const kids = [node('R', { id: 'small', w: 10, h: 10 }), node('R', { id: 'large', w: 10, h: 30 })]
  const r = flow({ size: 'hug', align: 'stretch' }, kids)
  expect(r.scene.root[0].c!.map(n => n.attrs.h)).toEqual([52, 52])
  expect(layoutOf(r.scene.root[0])!.box).toEqual([0, 0, 42, 60])
})
it('never applies a group layout record to widget internals', () => {
  const w = expandRoot(instance('button'), vanillaPlus)
  const root = withLayout(w.root, record), s = { ...sceneOf(root), defs: w.defs }
  expect(reflow(s, [0], vanillaPlus).scene).toBe(s)
})
it('uses exact descendant bounds for a rotated group containing an ellipse', () => {
  const child = node('G', { r: 45 }, [node('C', { rx: 10, ry: 5 })])
  const placed = flow({}, [child]).scene.root[0].c![0]
  const extent = Math.sqrt(62.5)
  expect((placed.attrs.t as number[])[0]).toBeCloseTo(8 + extent, 3)
  expect((placed.attrs.t as number[])[1]).toBeCloseTo(4 + extent, 3)
})

const turned = (r = 10) => node('G', { id: 'turned', r }, [node('R', { x: 0, y: 0, w: 20, h: 10 })])
const stretch = (kids = [turned()], patch: Partial<LayoutRecord> = {}) =>
  group({ box: [0, 0, 200, 100], pad: [0, 0, 0, 0], align: 'stretch', ...patch }, kids)
const button = () => expandRoot(instance('button', { x: 90, y: 90, w: 100, h: 40 }), vanillaPlus).root
const ruledCases = () => [stretch(), stretch([turned(45)]), stretch([turned(90)]),
  stretch([turned()], { box: [0, 0, 200, 2] }), stretch([button()], { box: [0, 0, 300, 47.7] }),
  stretch([node('L', { p: [0, 0, 0, 30] }), turned()], { size: 'hug' })]

it('a turned child stretches along one axis', () => {
  const child = reflow(sceneOf(stretch()), [0], vanillaPlus).scene.root[0].c![0]
  expect(child.attrs.s).toEqual([1, Math.fround(9.80161)])
  const box = layoutBox(child, vanillaPlus)!
  expect(Math.abs(box.h - 100)).toBeLessThan(1e-3)
  expect(Math.abs(box.w - 36.7165)).toBeLessThan(1e-3)
})
it('at 45 degrees', () => {
  const child = reflow(sceneOf(stretch([turned(45)])), [0], vanillaPlus).scene.root[0].c![0]
  expect(child.attrs.s).toEqual([1, Math.fround(12.1421)])
  const box = layoutBox(child, vanillaPlus)!
  expect(Math.abs(box.w - 100)).toBeLessThan(1e-3)
  expect(Math.abs(box.h - 100)).toBeLessThan(1e-3)
})
it('at 90 degrees the local x scales', () => {
  const child = reflow(sceneOf(stretch([turned(90)])), [0], vanillaPlus).scene.root[0].c![0]
  expect(child.attrs.s).toEqual([5, 1])
  expect(layoutBox(child, vanillaPlus)!.w).toBeCloseTo(10, 3)
  expect(layoutBox(child, vanillaPlus)!.h).toBeCloseTo(100, 3)
})
it('too narrow to reach', () => {
  const child = turned(), r = reflow(sceneOf(stretch([child], { box: [0, 0, 200, 2] })), [0], vanillaPlus)
  expect(r.scene.root[0].c![0].attrs.s).toEqual(child.attrs.s)
  expect(r.skipped.join('; ')).toContain('turned')
})
it('a widget lands on whole units in one pass', () => {
  const child = expandRoot(instance('button', { x: 0, y: 0, w: 100, h: 47.7 }), vanillaPlus).root
  const r = reflow(sceneOf(stretch([child], { box: [0, 0, 300, 47.7] })), [0], vanillaPlus)
  expect(widgetOf(r.scene.root[0].c![0], vanillaPlus)!.params.h).toBe(48)
})
it('hug does not chase a stretched child', () => {
  const r = reflow(sceneOf(ruledCases()[5]), [0], vanillaPlus), g = r.scene.root[0]
  expect(layoutOf(g)!.box[3]).toBe(30)
  expect(Math.abs(layoutBox(g.c![1], vanillaPlus)!.h - 30)).toBeLessThan(1e-3)
})
it('measures the new main extent before placing the following child', () => {
  const r = reflow(sceneOf(stretch([turned(), node('R', { w: 10, h: 10 })])), [0], vanillaPlus)
  expect(Math.abs(Number(r.scene.root[0].c![1].attrs.x) - 42.7165)).toBeLessThan(1e-3)
})
it('bisects exact ellipse bounds rather than its enclosing rectangle', () => {
  const child = node('G', { r: 30, s: [2, 1] }, [node('C', { rx: 10, ry: 5 })])
  const a = reflow(sceneOf(stretch([child])), [0], vanillaPlus).scene
  expect(a.root[0].c![0].attrs.s).toEqual([2, Math.fround(11.3137)])
  expect(layoutBox(a.root[0].c![0], vanillaPlus)!.h).toBeCloseTo(100, 3)
  expect(reflow(a, [0], vanillaPlus).scene).toEqual(a)
})
it('takes the rising root even when the convex span first falls', () => {
  const child = node('G', { r: 45 }, [node('L', { p: [0, 10, 100, 0] })])
  const a = reflow(sceneOf(stretch([child], { box: [0, 0, 200, 50] })), [0], vanillaPlus).scene
  expect(a.root[0].c![0].attrs.s).toEqual([1, Math.fround(17.0711)])
  expect(layoutBox(a.root[0].c![0], vanillaPlus)!.h).toBeCloseTo(50, 3)
  expect(reflow(a, [0], vanillaPlus).scene).toEqual(a)
})
it('supports diagonal m and names a sheared group without stretching it', () => {
  const diagonal = node('G', { id: 'diagonal', r: 10, m: [2, 0, 0, 3, 4, 5] }, turned().c)
  const sheared = node('G', { id: 'sheared', m: [1, 0, 0.5, 1, 0, 0] }, turned().c)
  const a = reflow(sceneOf(stretch([diagonal, sheared])), [0], vanillaPlus)
  expect(layoutBox(a.scene.root[0].c![0], vanillaPlus)!.h).toBeCloseTo(100, 3)
  expect(a.scene.root[0].c![1].attrs.s).toBeUndefined()
  expect(a.skipped.join('; ')).toContain('sheared skipped: m is not diagonal')
  expect(reflow(a.scene, [0], vanillaPlus).scene).toEqual(a.scene)
})
it.each<Record<string, Value>>([{ s: '=t' }, { s: [1, '=t'] }, { a: '=t' }, { t: '=t' }, { r: '=t' }])('keeps expression group transforms untouched (%j)', attrs => {
  const child = node('G', { id: 'dynamic', ...attrs }, turned().c)
  const a = reflow(sceneOf(stretch([child])), [0], vanillaPlus)
  expect(a.scene.root[0].c![0]).toBe(child)
  expect(a.skipped.join('; ')).toContain('dynamic')
})
it.each([10, 45, 90])('swaps the local scale axis in a column at %s degrees', r => {
  const a = reflow(sceneOf(stretch([turned(r)], { dir: 'column', box: [0, 0, 100, 200] })), [0], vanillaPlus).scene
  const child = a.root[0].c![0], scale = child.attrs.s as number[]
  expect(scale[r === 90 ? 0 : 1]).toBe(1)
  expect(layoutBox(child, vanillaPlus)!.w).toBeCloseTo(100, 3)
  expect(reflow(a, [0], vanillaPlus).scene).toEqual(a)
})
it('stretches a turned widget through one param with its root transform intact', () => {
  const w = instance('button', { x: 0, y: 0, w: 100, h: 40 })
  w.edit = { v: 1, parts: {}, root: { r: 10 } }
  const a = reflow(sceneOf(stretch([expandRoot(w, vanillaPlus).root])), [0], vanillaPlus).scene
  const child = a.root[0].c![0]
  expect(widgetOf(child, vanillaPlus)!.params).toMatchObject({ w: 100, h: 84 })
  expect(child.attrs).toMatchObject({ r: 10 })
  expect(reflow(a, [0], vanillaPlus).scene).toEqual(a)
})
it.each(['start', 'center', 'end'] as const)('measures whole widget params before %s placement', align => {
  const child = expandRoot(instance('button', { x: 90, y: 90, w: 47.7, h: 47.7 }), vanillaPlus).root
  const a = reflow(sceneOf(stretch([child, node('R', { w: 10, h: 10 })], { align, size: 'hug' })), [0], vanillaPlus).scene
  expect(a.root[0].c![1].attrs.x).toBe(54)
  expect(layoutOf(a.root[0])!.box).toEqual([0, 0, 64, 48])
  expect(reflow(a, [0], vanillaPlus).scene).toEqual(a)
})
it('one re-flow is a fixed point', () => {
  const step1 = [group(), ...(['column'] as const).map(dir => group({ dir })),
    ...(['center', 'end', 'stretch'] as const).map(align => group({ align })),
    ...(['center', 'end', 'between'] as const).map(justify => group({ justify })), group({ size: 'hug' }),
    group({}, [withFill(node('R', { w: 1, h: 1 }), true), rect('a')]),
    group({}, [node('R', { id: 'dynamic', x: '=t', w: 10, h: 10 }), rect('a')]), group({}, [button()]),
    group({}, [node('G', { s: [2, 2] }, [rect('a')])])]
  const failures: unknown[] = []
  for (const [i, g] of [...ruledCases(), ...step1].entries()) {
    const a = reflow(sceneOf(g), [0], vanillaPlus).scene, b = reflow(a, [0], vanillaPlus).scene
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push({ case: i, before: a.root[0], after: b.root[0] })
  }
  let seed = 0x16e1
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)]
  const units = (n: number) => Math.fround(Math.round(rand() * n * 1000) / 1000)
  const fuzz: unknown[] = []
  for (let i = 0; i < 400; i++) {
    const kids = [node('R', { x: units(100), y: units(100), w: 1 + units(80), h: 1 + units(80) }),
      node('T', { w: 1 + units(80), h: 1 + units(80), text: 'Label' }),
      node('G', { r: units(360), s: [1 + units(2), 1 + units(2)] }, [node('R', { w: 20, h: 10 })]), button()]
      .map(n => withMargin(n, [units(10) - 5, units(10) - 5, units(10) - 5, units(10) - 5]))
    const g = group({ dir: pick(['row', 'column']), pad: [units(10), units(10), units(10), units(10)],
      gap: units(10), align: pick(['start', 'center', 'end', 'stretch']), justify: pick(['start', 'center', 'end', 'between']),
      size: pick(['fixed', 'hug']), box: [units(10), units(10), 100 + units(200), 100 + units(200)] }, kids)
    const a = reflow(sceneOf(g), [0], vanillaPlus).scene, b = reflow(a, [0], vanillaPlus).scene
    if (JSON.stringify(a) !== JSON.stringify(b)) fuzz.push({ case: i, before: a.root[0], after: b.root[0] })
  }
  expect({ cases: failures.length, fuzz: fuzz.length, firstCase: failures[0], firstFuzz: fuzz[0] }).toEqual({
    cases: 0, fuzz: 0, firstCase: undefined, firstFuzz: undefined,
  })
})
