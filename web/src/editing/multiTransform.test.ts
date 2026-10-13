import { describe, expect, it } from 'vitest'
import { apply, groupMatrix, type Mat } from '../editor/geometry'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt } from '../model/store'
import { node } from '../model/testing'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { expandRoot, putWidget, sanitize, widgetOf } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import { instance } from '../widgets/testing'
import { worldBox } from './bounds'
import { transformSet } from './multiTransform'

const sel = (...path: number[]) => ({ pageId: 'p1', path })
const empty: Scene = { header: { w: 460, h: 460 }, root: [], defs: [] }
const pair = () => ({ ...empty, root: [node('R', { x: 0, y: 0, w: 10, h: 10 }), node('R', { x: 20, y: 0, w: 10, h: 10 })] })
const twice: Mat = [2, 0, 0, 2, 0, 0]
const turn: Mat = [0, 1, -1, 0, 20, -10]   // 90 degrees about (15,5)
const closeBox = (actual: ReturnType<typeof worldBox>, expected: NonNullable<ReturnType<typeof worldBox>>) => {
  expect(actual).not.toBeNull()
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(actual![k]).toBeCloseTo(expected[k], 3)
}

describe('transformSet', () => {
  it('mirrors plain members while preserving and naming a zero-minimum widget', () => {
    const base = putWidget(pair(), instance('panel'), t)
    const out = transformSet(base, [sel(0), sel(2)], t, [-1, 0, 0, 1, 200, 0])
    expect(out.scene.root[0].attrs).toMatchObject({ x: 190, y: 0, w: 10, h: 10 })
    expect(out.scene.root[2]).toBe(base.root[2])
    expect(out.skipped).toHaveLength(1)
    expect(out.skipped[0]).toMatch(/mirror.*widget|widget.*mirror/)
  })
  it('wraps widget rotation and drops identity rotation and anchor while retaining other overrides', () => {
    const w = { ...instance('panel', { x: 0, y: 0, w: 100, h: 80 }), edit: { v: 1 as const, parts: { body: { attrs: { f: '#123456' } } }, root: { r: 350, a: [50, 40] as [number, number], o: 0.5 } } }
    const base = putWidget(empty, w, t), angle = Math.PI / 18, c = Math.cos(angle), s = Math.sin(angle)
    const out = transformSet(base, [sel(0)], t, [c, s, -s, c, 50 - c * 50 + s * 40, 40 - s * 50 - c * 40])
    expect(widgetOf(out.scene.root[0], t)?.edit).toEqual({ v: 1, parts: w.edit.parts, root: { o: 0.5 } })
    const twice = transformSet(out.scene, [sel(0)], t, [c, s, -s, c, 50 - c * 50 + s * 40, 40 - s * 50 - c * 40])
    expect(widgetOf(twice.scene.root[0], t)?.edit?.root?.r).toBe(10)
  })
  it('scales selection-path work linearly when the selection grows fourfold', () => {
    const work = (size: number) => {
      let reads = 0
      const root = Array.from({ length: size }, (_, x) => node('R', { x, y: 0, w: 10, h: 10 }))
      const sels = root.map((_, i) => ({ ...sel(i), path: new Proxy([i], {
        get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver) },
      }) }))
      const out = transformSet({ ...empty, root }, sels, t, twice)
      expect(out.scene.root.at(-1)?.attrs.w).toBe(20)
      expect(out.skipped).toEqual([])
      return reads
    }
    const small = work(64), large = work(256)
    expect(large, `path reads: 64 members=${small}, 256 members=${large}`).toBeLessThanOrEqual(small * 5)
  })
  it('resizes two leaves about the common anchor', () => {
    const out = transformSet(pair(), [sel(0), sel(1)], t, twice)
    expect(out.scene.root.map(n => n.attrs)).toEqual([{ x: 0, y: 0, w: 20, h: 20 }, { x: 40, y: 0, w: 20, h: 20 }])
    expect(out.selection).toEqual([sel(0), sel(1)])
  })
  it('scales widget scene copies linearly when the selection grows fourfold', () => {
    const work = (size: number) => {
      let base = empty
      for (let i = 0; i < size; i++) base = putWidget(base, instance('panel', { x: i * 20, y: 0, w: 100, h: 80 }, `panel${i + 1}`), t)
      const sels = base.root.map((_, i) => sel(i)), map = Array.prototype.map, iterator = Array.prototype[Symbol.iterator]
      let copied = 0
      Array.prototype.map = function<U>(this: SrcNode[], callback: (value: SrcNode, index: number, array: SrcNode[]) => U, thisArg?: unknown) {
        if (this.length === size && this[0]?.attrs?.id === 'panel1') copied += size
        return map.call(this, callback, thisArg) as U[]
      }
      Array.prototype[Symbol.iterator] = function (this: SrcNode[]) {
        if (this.length === size && this[0]?.attrs?.id === 'panel1') copied += size
        return iterator.call(this)
      }
      try {
        const out = transformSet(base, sels, t, twice)
        expect(widgetOf(out.scene.root.at(-1)!, t)?.params.w).toBe(200)
        expect(out.skipped).toEqual([])
      } finally { Array.prototype.map = map; Array.prototype[Symbol.iterator] = iterator }
      return copied
    }
    const small = work(16), large = work(64)
    expect(large, `widget roots copied: 16 members=${small}, 64 members=${large}`).toBeLessThanOrEqual(small * 5)
  })
  it('keeps batched widget replacements equivalent to individual replacements, including comments and defs', () => {
    const a = instance('panel', { x: 10, y: 20, w: 100, h: 80 }, 'panel1'), b = instance('panel', { x: 200, y: 20, w: 100, h: 80 }, 'panel2')
    const base = putWidget(putWidget(empty, a, t), b, t)
    base.root[0] = { ...base.root[0], comments: ['mine', ...base.root[0].comments!] }
    base.defs.push(node('CP', { id: 'panel1_old' }), node('CP', { id: 'panel2_old' }), node('CP', { id: 'panel20_old' }))
    let expected = base
    for (const w of [a, b]) {
      const p = w.params as { x: number; y: number; w: number; h: number }
      expected = putWidget(expected, { ...w, params: { ...w.params, x: p.x * 2, y: p.y * 2, w: p.w * 2, h: p.h * 2 } }, t)
    }
    expect(transformSet(base, [sel(0), sel(1)], t, twice).scene).toEqual(expected)
  })
  it('turns both leaves about the common centre and retains their selections inside wrappers', () => {
    const base = pair(), out = transformSet(base, [sel(0), sel(1)], t, turn)
    expect(out.scene.root.map(n => n.op)).toEqual(['G', 'G'])
    expect(out.scene.root.map(n => n.attrs)).toEqual([{ a: [15, 5], r: 90 }, { a: [15, 5], r: 90 }])
    expect(out.scene.root.map(n => n.c![0])).toEqual(base.root)
    expect(out.selection).toEqual([sel(0, 0), sel(1, 0)])
    expect(worldBox(out.scene, [0, 0])).toEqual({ x: 10, y: -10, w: 10, h: 10 })
    closeBox(worldBox(out.scene, [1, 0]), { x: 10, y: 10, w: 10, h: 10 })
  })
  it.each([{ m: twice }, { m: turn }])('converts the matrix into each parent frame ($m)', ({ m }) => {
    const base = pair(), nested = { ...empty, root: [node('G', { t: [100, 0], s: [2, 2] },
      [node('R', { x: -50, y: 0, w: 5, h: 5 }), node('R', { x: -40, y: 0, w: 5, h: 5 })])] }
    const plain = transformSet(base, [sel(0), sel(1)], t, m), under = transformSet(nested, [sel(0, 0), sel(0, 1)], t, m)
    closeBox(worldBox(under.scene, under.selection[0].path), m === twice ? { x: 0, y: 0, w: 20, h: 20 } : { x: 10, y: -10, w: 10, h: 10 })
    plain.selection.forEach((s, i) => closeBox(worldBox(under.scene, under.selection[i].path), worldBox(plain.scene, s.path)!))
  })
  it('transforms a child selected with its parent once', () => {
    const base = { ...empty, root: [node('G', {}, [pair().root[1]])] }
    const out = transformSet(base, [sel(0), sel(0, 0)], t, twice)
    expect(out.scene.root[0].attrs).toEqual({ s: [2, 2] })
    expect(out.scene.root[0].c![0]).toBe(base.root[0].c![0])
    expect(worldBox(out.scene, [0, 0])).toEqual({ x: 40, y: 0, w: 20, h: 20 })
  })
  it('names locked and bound members while native members pass silently to the gesture', () => {
    const bound = node('R', { id: 'readout', x: '$x', y: '=t', w: 10, h: 10 }), locked = { ...pair().root[1], comments: ['lock'], attrs: { ...pair().root[1].attrs, id: 'plate' } }
    const base = { ...empty, root: [pair().root[0], locked, bound] }
    const native = { pageId: 'p1', path: [], native: 'icon1' }
    const out = transformSet(base, [sel(0), sel(1), sel(2), native], t, twice)
    expect(out.scene.root[0].attrs.w).toBe(20)
    expect(out.scene.root[1]).toBe(locked); expect(out.scene.root[2]).toBe(bound)
    expect(out.skipped.join('; ')).toMatch(/plate.*locked/)
    expect(out.skipped.join('; ')).toMatch(/readout.*expression/)
    expect(out.skipped.join('; ')).not.toMatch(/icon1|native/)
    expect(out.selection.at(-1)).toEqual(native)
  })
  it('scales a Panel and a rectangle together in whole widget units, retaining overrides', () => {
    const w = { ...instance('panel', { x: 20, y: 30, w: 101, h: 81 }), edit: { v: 1 as const, parts: { body: { attrs: { f: '#123456' } } } } }
    const base = putWidget({ ...empty, root: [pair().root[1]] }, w, t)
    const out = transformSet(base, [sel(0), sel(1)], t, [1.5, 0, 0, 1.5, 0, 0])
    expect(widgetOf(out.scene.root[1], t)?.params).toMatchObject({ x: 30, y: 45, w: 152, h: 122 })
    expect(widgetOf(out.scene.root[1], t)?.edit).toEqual(w.edit)
    expect(out.scene.root[0].attrs).toMatchObject({ x: 30, y: 0, w: 15, h: 15 })
  })
  it('turns a widget through root overrides and retains its binding keys', () => {
    const w = instance('bar', { x: 0, y: 0, w: 100, h: 30, value: 'reading' })
    const base = putWidget(empty, w, t), out = transformSet(base, [sel(0)], t, turn)
    const ref = widgetOf(out.scene.root[0], t)!
    expect(ref.params.value).toBe(w.params.value)
    expect(ref.edit?.root?.r).toBe(90)
    const B = groupMatrix(out.scene.root[0].attrs)!, p = ref.params as { x: number; y: number }
    const actual = apply(B, p.x, p.y), target = apply(turn, 0, 0)
    expect(actual[0]).toBeCloseTo(target[0], 3); expect(actual[1]).toBeCloseTo(target[1], 3)
    expect(out.selection).toEqual([sel(0)])
  })
  it('never writes a non-finite or singular transform', () => {
    const base = pair()
    for (const m of [[Infinity, 0, 0, 1, 0, 0], [0, 0, 0, 0, 0, 0]] as Mat[]) {
      const out = transformSet(base, [sel(0), sel(1)], t, m)
      expect(out.scene).toBe(base)
      expect(out.skipped.join()).toMatch(/finite|singular/)
    }
  })
  it('holds one common uniform scale at the largest widget minimum, keeping the anchor', () => {
    const a = instance('button', { x: 0, y: 0, w: 100, h: 100 }, 'btn1'), b = instance('button', { x: 200, y: 0, w: 100, h: 50 }, 'btn2')
    const min = sanitize(WIDGETS.button, { ...b.params, w: 0, h: 0 }, t).h as number, k = Math.ceil(min) / 50
    const base = putWidget(putWidget({ ...empty, root: [node('R', { x: 400, y: 0, w: 100, h: 100 })] }, a, t), b, t)
    const out = transformSet(base, [sel(0), sel(1), sel(2)], t, [0.1, 0, 0, 0.1, 0, 0])
    expect(out.scene.root[0].attrs).toMatchObject({ x: 400 * k, w: 100 * k, h: 100 * k })
    expect(widgetOf(out.scene.root[1], t)?.params).toMatchObject({ x: 0, y: 0, w: Math.round(100 * k), h: Math.round(100 * k) })
    expect(widgetOf(out.scene.root[2], t)?.params).toMatchObject({ x: Math.round(200 * k), y: 0, w: Math.round(100 * k), h: Math.ceil(min) })
  })
  it('keeps identity transforms out of the scene and undo history, including widgets', () => {
    const base = putWidget(pair(), instance('panel'), t)
    expect(transformSet(base, [sel(0), sel(1), sel(2)], t, [1, 0, 0, 1, 0, 0]).scene).toBe(base)
  })
  it('turns a widget by 180 degrees without confusing it with a crossed resize', () => {
    const base = putWidget(empty, instance('panel', { x: 0, y: 0, w: 100, h: 80 }), t)
    const out = transformSet(base, [sel(0)], t, [-1, 0, 0, -1, 200, 200])
    expect(widgetOf(out.scene.root[0], t)?.edit?.root?.r).toBe(180)
    expect(out.skipped).toEqual([])
  })
  it('refuses overflowing widget geometry before sanitization can replace it with defaults', () => {
    const base = putWidget(pair(), instance('panel', { x: 100, y: 100, w: 100, h: 80 }), t)
    const out = transformSet(base, [sel(0), sel(1), sel(2)], t, [1e38, 0, 0, 1e38, 0, 0])
    expect(out.scene).toBe(base)
    expect(out.skipped).toHaveLength(3)
    expect(out.skipped.join()).toContain('float32')
  })
  it('skips structural turns of widget parts while turning other members', () => {
    const w = instance('panel'), base = putWidget(pair(), w, t), path = [2, ...expandRoot(w, t).exp.parts!.title]
    const out = transformSet(base, [sel(0), sel(...path)], t, turn)
    expect(out.scene.root[0].op).toBe('G')
    expect(nodeAt(out.scene.root, path)).toBe(nodeAt(base.root, path))
    expect(out.skipped.join()).toMatch(/Detach|override/)
  })
  it('holds the common widget minimum under a rotated parent too', () => {
    const w = instance('button', { x: 0, y: 0, w: 100, h: 50 }), widget = putWidget(empty, w, t).root[0]
    const min = Math.ceil(sanitize(WIDGETS.button, { ...w.params, w: 0, h: 0 }, t).h as number), k = min / 50
    const base = { ...empty, root: [node('R', { x: 400, y: 0, w: 100, h: 100 }), node('G', { r: 30 }, [widget])] }
    const out = transformSet(base, [sel(0), sel(1, 0)], t, [0.1, 0, 0, 0.1, 0, 0])
    expect(out.scene.root[0].attrs.w).toBeCloseTo(100 * k, 3)
    expect(widgetOf(out.scene.root[1].c![0], t)?.params).toMatchObject({ w: Math.round(100 * k), h: min })
  })
  it('names and preserves a width-only widget when a scale would change its fixed height', () => {
    const base = putWidget(pair(), instance('readout'), t)
    const out = transformSet(base, [sel(0), sel(2)], t, twice)
    expect(out.scene.root[0].attrs.w).toBe(20)
    expect(out.scene.root[2]).toBe(base.root[2])
    expect(out.skipped.join()).toMatch(/width.*only/)
  })
  it('resizes a rotated widget in its own params frame through a design-space scale', () => {
    const w = { ...instance('bar', { x: 100, y: 100, w: 200, h: 30 }), edit: { v: 1 as const, parts: {}, root: { r: 90, a: [200, 115] as [number, number] } } }
    const base = putWidget(empty, w, t), out = transformSet(base, [sel(0)], t, [2, 0, 0, 3, 0, 0])
    const ref = widgetOf(out.scene.root[0], t)!
    expect(ref.params).toMatchObject({ w: 600, h: 60 })
    expect(ref.edit?.root).toEqual(w.edit.root)
    const B = groupMatrix(out.scene.root[0].attrs)!, p = ref.params as unknown as { x: number; y: number; w: number; h: number }
    const corner = apply(B, p.x, p.y)
    expect(corner[0]).toBeCloseTo(430, 3); expect(corner[1]).toBeCloseTo(45, 3)
  })
})
