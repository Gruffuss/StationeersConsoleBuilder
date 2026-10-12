import { describe, expect, it } from 'vitest'
import { boxOf } from '../editor/geometry'
import { moveBy, resizeTo } from '../editing/transform'
import { nodeAt, replaceAt } from '../model/store'
import { node } from '../model/testing'
import { neutral } from '../theme/neutral'
import { vanillaPlus } from '../theme/vanillaPlus'
import { expandRoot, markerOf, reassociate, sanitize, widgetOf } from './core'
import { applyEdit, editFrom, resetPart, sanitizeEdit } from './edits'
import { WIDGETS } from './registry'
import { bracket, instance, sceneOf } from './testing'
import type { SrcNode } from '../model/scene'

const edited = () => ({ ...instance('panel'), edit: { v: 1 as const, parts: { body: { attrs: { f: '#123456', sh: [[1, 2, 3, 4, '#000']] } } } } })
const part = (w: ReturnType<typeof instance>, name: string, t = vanillaPlus) => {
  const e = expandRoot(w, t)
  return nodeAt(e.root.c!, e.exp.parts![name])!
}

describe('overrides on dressed parts', () => {
  it('reports a look that overflows only after a part is moved', () => {
    const t = { ...bracket, anatomy: { v: 1 as const, looks: { panel: { shape: { op: 'ellipse' as const,
      frame: { l: [0,3e38] as const, t: [0,0] as const, r: [1,3e38] as const, b: [1,0] as const } } } } } }
    const w = { ...instance('panel'), edit: { v: 1 as const, parts: { body: { dx: 3e38 } } } }
    expect(expandRoot(instance('panel'), t).exp.notes).toBeUndefined()
    expect(expandRoot(w, t).exp.notes).toEqual(['panel: derived geometry is not finite float32; look not applied'])
  })
  it.each([neutral, vanillaPlus, bracket])('reports rejected expression geometry deltas as dormant in $name', t => {
    const w = { ...instance('bar', { cells: 4 }), edit: { v: 1 as const, parts: { fill: { dx: 3, dy: 2 }, track: { dw: 5 } } } }
    const e = expandRoot(w, t).exp
    expect(e.dormant).toEqual(expect.arrayContaining(['fill.dx', 'fill.dy', 'track.dw']))
    expect(e.dormant).toHaveLength(3)
    for (const k of e.dormant!) expect(e.dormantReasons![k]).toContain('expression')
    expect(part(w, 'fill', t).attrs).toEqual(part(instance('bar', { cells: 4 }), 'fill', t).attrs)
  })
  it('redress declines expression geometry and unsupported resize deltas', async () => {
    const api = await import('./dress')
    for (const [n, deltas] of [
      [node('R', { x: '=i', y: 0, w: 20, h: 30 }), [3, 0, 0, 0]],
      [node('R', { x: 0, y: 0, w: '=$w', h: 30 }), [0, 0, 5, 0]],
      [node('L', { p: [0, 0, 20, 30] }), [0, 0, 5, 0]],
    ] as const) {
      const held = api.dress(bracket, 'track', { x: 0, y: 0, w: 20, h: 30 }, n)
      expect(api.redress(held, deltas[0], deltas[1], deltas[2], deltas[3])).toBeNull()
    }
  })
  const panel = () => instance('panel', { x: 24, y: 24, w: 440, h: 300 })
  it('keeps Task 7 geometry rules on an undressed path', async () => {
    const api = await import('./dress'), path = node('P', { d: 'M0 0 L20 30', s: '#123456' })
    const n = api.dress(neutral, 'gauge.track', { x: 0, y: 0, w: 20, h: 30 }, path)
    expect(applyEdit([n], { track: [0] }, { v: 1, parts: { track: { dx: 4 } } }).nodes[0].attrs).toEqual(path.attrs)
  })
  it('redress keeps the circle corner rule', async () => {
    const api = await import('./dress'), n = node('C', { cx: 20, cy: 30, rx: 10, f: '#123456' }), box = boxOf(n)!
    for (const dw of [-20, 4, -30]) {
      const held = api.dress(bracket, 'light.ok', box, n)
      expect(held.op).toBe('R')
      const moved = api.redress(held, 0, 0, dw, 2)!
      expect(api.dressing(moved)?.node).toEqual(resizeTo(n, 'se', box, { ...box, w: box.w+dw, h: box.h+2 }).node)
      expect(moved).toEqual(api.dress(bracket, 'light.ok', { ...box, w: box.w+dw, h: box.h+2 }, api.dressing(moved)!.node))
    }
  })
  it('redress keeps a literal group translation', async () => {
    const api = await import('./dress'), g = node('G', { t: [10, 20] }, [node('R', { w: 20, h: 30 })])
    const moved = api.redress(api.dress(bracket, 'panel', { x: 10, y: 20, w: 20, h: 30 }, g), 4, 2, 0, 0)!
    expect(api.dressing(moved)?.node).toEqual(moveBy(g, 4, 2).node)
    expect(moved.c![1].attrs.p).toEqual([10,34,10,18,26,18])
  })
  it('refuses a resize the geometry writer cannot apply', () => {
    const w = panel(), e = expandRoot(w, bracket), path = e.exp.parts!.body, n = nodeAt(e.root.c!, path)!
    const after = { ...e.root, c: replaceAt(e.root.c!, path, { ...n, attrs: { ...n.attrs, w: 0 } })! }
    expect(editFrom(w, bracket, e.root, after)).toMatchObject({ refused: expect.stringContaining('cannot be represented') })
  })
  it('moves a primary inside a dressed G t without allowing edits to that structure', () => {
    const w = { ...instance('eventlog'), edit: { v: 1 as const, parts: { row: { attrs: { f: '#123456' } } } } }
    const e = expandRoot(w, bracket), path = e.exp.parts!.row, n = nodeAt(e.root.c!, path)!
    const after = { ...e.root, c: replaceAt(e.root.c!, path, { ...n, attrs: { ...n.attrs, p: (n.attrs.p as number[]).map((v, i) => v+(i % 2 === 0 ? 4 : 0)) } })! }
    const edited = editFrom(w, bracket, e.root, after)
    expect(edited).toHaveProperty('ref')
    if (!('ref' in edited)) throw Error(edited.refused)
    expect(edited.ref.edit?.parts.row.dx).toBe(4)
    const frame = path.slice(0, -1), g = nodeAt(e.root.c!, frame)!
    const changed = { ...e.root, c: replaceAt(e.root.c!, frame, { ...g, attrs: { ...g.attrs, t: [28, '=24+i*56'] } })! }
    expect(editFrom(w, bracket, e.root, changed)).toMatchObject({ refused: expect.stringContaining('Detach') })
  })
  it('keeps an imported ornament offset dormant instead of moving it', () => {
    const w = { ...panel(), edit: { v: 1 as const, parts: { 'body~mark-tl': { dx: 5 } } } }
    const e = expandRoot(w, bracket)
    expect(e.exp.dormant).toEqual(['body~mark-tl.dx'])
    expect(part(w, 'body~mark-tl', bracket).attrs.p).toEqual(part(panel(), 'body~mark-tl', bracket).attrs.p)
  })
  it('ornaments follow', () => {
    const w = panel(), moved = { ...w, edit: { v: 1 as const, parts: { body: { dx: 4, dw: 10 } } } }
    for (const corner of ['tl', 'bl', 'tr', 'br']) {
      const name = `body~mark-${corner}`, before = part(w, name, bracket).attrs.p as number[]
      const after = part(moved, name, bracket).attrs.p
      expect(after).toEqual(before.map((v, i) => v + (i % 2 === 0 ? corner.endsWith('l') ? 4 : 14 : 0)))
    }
    expect(part(moved, 'body', bracket).attrs).toMatchObject({ x: 28.5, w: 449 })
  })
  it("an ornament's paint", () => {
    const w = { ...panel(), edit: { v: 1 as const, parts: { body: { dx: 4 }, 'body~mark-tl': { attrs: { s: '#123456', v: 0 } } } } }
    const points = part(panel(), 'body~mark-tl', bracket).attrs.p as number[]
    expect(part(w, 'body~mark-tl', bracket).attrs).toMatchObject({ s: '#123456', v: 0, p: points.map((v, i) => v + (i % 2 === 0 ? 4 : 0)) })
    expect(part(w, 'body~mark-tr', bracket).attrs.s).toBe('#7A7A7A')
  })
  it('across themes', () => {
    const w = { ...panel(), edit: { v: 1 as const, parts: { body: { dx: 4 }, 'body~mark-tl': { attrs: { s: '#123456' } } } } }
    const plain = expandRoot(w, neutral)
    expect(plain.exp.dormant).toEqual(['body~mark-tl'])
    const read = widgetOf(plain.root, neutral)!
    expect(read.edit).toEqual(w.edit)
    const points = part(panel(), 'body~mark-tl', bracket).attrs.p as number[]
    expect(part(read, 'body~mark-tl', bracket).attrs).toMatchObject({ s: '#123456', p: points.map((v, i) => v + (i % 2 === 0 ? 4 : 0)) })
  })
  it('painted back', () => {
    const w = { ...instance('header'), edit: { v: 1 as const, parts: { banner: { attrs: { f: '#123456' } } } } }
    expect(part(w, 'banner', bracket)).toMatchObject({ op: 'R', attrs: { f: '#123456' } })
  })
  it('a key this shape cannot take', () => {
    const w = { ...instance('button', { states: [{ key: 8, label: 'A', variant: 'primary' }] }),
      edit: { v: 1 as const, parts: { 'state.8.body': { attrs: { rx: 9 } } } } }
    expect(part(w, 'state.8.body', neutral).attrs.rx).toBe(9)
    expect(part(w, 'state.8.body', bracket)).toMatchObject({ op: 'Y' })
    expect(part(w, 'state.8.body', bracket).attrs.rx).toBeUndefined()
    const cut = expandRoot(w, bracket)
    expect(cut.exp.dormant).toEqual(['state.8.body.rx'])
    expect(part(widgetOf(cut.root, bracket)!, 'state.8.body', neutral).attrs.rx).toBe(9)
  })
  it("the repeat's rows", () => {
    const w = instance('repeater', { click: true }), before = expandRoot(w, bracket)
    const after = expandRoot({ ...w, edit: { v: 1, parts: { row: { dx: 4 }, 'row~accent': { attrs: { f: '#123456' } } } } }, bracket)
    expect(after.exp.slots).toEqual(before.exp.slots)
    expect(after.exp.clicks).toEqual(before.exp.clicks)
    expect(part(widgetOf(after.root, bracket)!, 'row~accent', bracket).attrs).toMatchObject({ x: 28, f: '#123456' })
    const plates = (root: SrcNode) => {
      const out: string[] = [], stack = [root]
      while (stack.length) { const n = stack.pop()!; if (n.attrs.click !== undefined) out.push(String(n.attrs.id)); for (const c of n.c ?? []) stack.push(c) }
      return out
    }
    expect(plates(after.root)).toEqual(plates(before.root))
  })
  it('redress rebuilds a recorded result and declines an unrecorded node', async () => {
    const api = await import('./dress')
    expect(api).toHaveProperty('redress')
    const redress = (api as typeof api & { redress(n: SrcNode, dx: number, dy: number, dw: number, dh: number): SrcNode | null }).redress
    expect(redress(node('R'), 4, 0, 10, 0)).toBeNull()
    const result = api.dress(bracket, 'panel', { x: 24, y: 24, w: 440, h: 300 }, node('R', { x: 24, y: 24, w: 440, h: 300, f: '#000' }))
    expect(redress(result, 4, 0, 10, 0)).toEqual(api.dress(bracket, 'panel', { x: 28, y: 24, w: 450, h: 300 }, node('R', { x: 28, y: 24, w: 450, h: 300, f: '#000' })))
  })
})

describe('widget part overrides', () => {
  it('marks keep their overrides by position', () => {
    for (const orient of ['h', 'v']) {
      const base = { ...instance('bar', { orient, marks: [0.25,0.5,0.75] }),
        edit: { v: 1 as const, parts: { 'mark@0.5': { attrs: { f: '#123456' } } } } }
      for (const marks of [[0.25,0.5,0.75], [0.5,0.75], [0.6,0.75], [0.5,0.75]]) {
        const w = { ...base, params: { ...base.params, marks } }, e = expandRoot(w, vanillaPlus)
        if (marks.includes(0.5)) {
          expect(e.exp.parts!['mark@0.5']).toBeDefined()
          expect(part(w, 'mark@0.5').attrs.f).toBe('#123456')
          expect(part(w, 'mark@0.75').attrs.f).not.toBe('#123456')
          expect(e.exp.dormant).toEqual([])
        } else expect(e.exp.dormant).toEqual(['mark@0.5'])
        expect(widgetOf(e.root, vanillaPlus)!.edit).toEqual(base.edit)
      }
      const duplicate = expandRoot(instance('bar', { orient, marks: [0.5,0.5,0.5,1e-7] }), vanillaPlus)
      expect(Object.keys(duplicate.exp.parts!).filter(k => k.startsWith('mark@'))).toEqual(['mark@0.5', 'mark@0.5#2', 'mark@0.5#3', 'mark@1e-7'])
      const legacy = { ...base, edit: { v: 1 as const, parts: { 'mark.1': { attrs: { f: '#123456' } } } } }
      const loaded = widgetOf(expandRoot(legacy, vanillaPlus).root, vanillaPlus)!
      expect(expandRoot(loaded, vanillaPlus).exp.dormant).toEqual(['mark.1'])
      expect(loaded.edit).toEqual(legacy.edit)
      const saved = sceneOf(legacy), path = expandRoot(legacy, vanillaPlus).exp.parts!['mark@0.5'], n = nodeAt(saved.root[0].c!, path)!
      saved.root[0] = { ...saved.root[0], c: replaceAt(saved.root[0].c!, path, { ...n, attrs: { ...n.attrs, f: '#123456' } })! }
      const result = reassociate({ ...saved, root: [], defs: [] }, saved, vanillaPlus, undefined, true)
      expect(result.detached).toEqual([])
      expect(expandRoot(widgetOf(result.scene.root[0], vanillaPlus)!, vanillaPlus).exp.dormant).toEqual(['mark.1'])
    }
  })
  it('ticks keep theirs by fraction', () => {
    const base = { ...instance('gauge', { ticks: 5 }), edit: { v: 1 as const, parts: { 'tick@0.5': { attrs: { s: '#123456' } } } } }
    for (const ticks of [5,3,4,3]) for (const [start, end] of [[-135,135], [0,720]]) {
      const w = { ...base, params: { ...base.params, ticks, start, end } }, e = expandRoot(w, vanillaPlus)
      if (ticks === 4) expect(e.exp.dormant).toEqual(['tick@0.5'])
      else {
        expect(e.exp.parts!['tick@0.5']).toBeDefined()
        expect(part(w, 'tick@0.5').attrs.s).toBe('#123456')
        expect(part(w, 'tick@0').attrs.s).not.toBe('#123456')
        expect(e.exp.dormant).toEqual([])
      }
      expect(widgetOf(e.root, vanillaPlus)!.edit).toEqual(base.edit)
    }
    expect(Object.keys(expandRoot(instance('gauge', { ticks: 4 }), vanillaPlus).exp.parts!).filter(k => k.startsWith('tick@')))
      .toEqual(['tick@0', 'tick@0.33333334', 'tick@0.6666667', 'tick@1'])
    expect(Object.keys(expandRoot(instance('gauge', { ticks: 1 }), vanillaPlus).exp.parts!)).toContain('tick@0')
    const legacy = { ...base, edit: { v: 1 as const, parts: { 'tick.2': { attrs: { s: '#123456' } } } } }
    const loaded = widgetOf(expandRoot(legacy, vanillaPlus).root, vanillaPlus)!
    expect(expandRoot(loaded, vanillaPlus).exp.dormant).toEqual(['tick.2'])
    expect(loaded.edit).toEqual(legacy.edit)
    const saved = sceneOf(legacy), path = expandRoot(legacy, vanillaPlus).exp.parts!['tick@0.5'], n = nodeAt(saved.root[0].c!, path)!
    saved.root[0] = { ...saved.root[0], c: replaceAt(saved.root[0].c!, path, { ...n, attrs: { ...n.attrs, s: '#123456' } })! }
    const result = reassociate({ ...saved, root: [], defs: [] }, saved, vanillaPlus, undefined, true)
    expect(result.detached).toEqual([])
    expect(expandRoot(widgetOf(result.scene.root[0], vanillaPlus)!, vanillaPlus).exp.dormant).toEqual(['tick.2'])
  })
  it('hiding then showing an always-visible part removes the empty override', () => {
    let w = instance('panel'), before = expandRoot(w, vanillaPlus)
    const toggle = (v: number | undefined) => {
      const path = before.exp.parts!.body, n = nodeAt(before.root.c!, path)!, attrs = { ...n.attrs }
      if (v === undefined) delete attrs.v
      else attrs.v = v
      const after = { ...before.root, c: replaceAt(before.root.c!, path, { ...n, attrs })! }
      const result = editFrom(w, vanillaPlus, before.root, after)
      if (!('ref' in result)) throw Error(result.refused)
      w = result.ref; before = expandRoot(w, vanillaPlus)
    }
    toggle(0)
    expect(w.edit?.parts.body.attrs).toEqual({ v: 0 })
    toggle(undefined)
    expect(w.edit).toBeUndefined()
    expect(markerOf(w)).not.toContain('__edit')
  })
  it('leaves geometry expressions unchanged without partially applying a size offset', () => {
    const n = node('R', { x: '=t', y: 0, w: 20, h: 30 })
    expect(applyEdit([n], { body: [0] }, { v: 1, parts: { body: { dx: 4, dy: 2, dw: 5 } } }).nodes[0].attrs).toEqual(n.attrs)
  })
  it('keeps every module slot, click target and protected attribute unchanged with overrides on every named part', () => {
    for (const m of Object.values(WIDGETS).filter(m => !m.native)) {
      const w = instance(m.type), before = expandRoot(w, vanillaPlus)
      const parts = Object.fromEntries(Object.keys(before.exp.parts!).map(name => [name, { attrs: { o: 0.8, id: 'bad', click: 1, text: 'bad', clip: 'bad', mask: 'bad' } }]))
      const after = expandRoot({ ...w, edit: { v: 1, parts } }, vanillaPlus)
      expect(after.exp.slots).toEqual(before.exp.slots); expect(after.exp.clicks).toEqual(before.exp.clicks)
      for (const [name, path] of Object.entries(before.exp.parts!)) {
        const a = nodeAt(before.root.c!, path)!, b = nodeAt(after.root.c!, path)!
        for (const k of ['id', 'click', 'press', 'xy', 'hoverev', 'drag', 'drop', 'clip', 'mask', 'text']) expect(b.attrs[k], `${m.type}/${name}/${k}`).toEqual(a.attrs[k])
      }
    }
  })
  it('rejects cyclic and nested shadow overrides at the readable boundary', () => {
    const cycle: unknown[] = []; cycle.push(cycle)
    expect(sanitizeEdit({ v: 1, parts: { body: { attrs: { sh: cycle } } } })).toBeUndefined()
    let deep: import('../model/scene').Value = 1
    for (let i = 0; i < 15000; i++) deep = [deep]
    expect(sanitizeEdit({ v: 1, parts: { body: { attrs: { sh: deep } } } })).toBeUndefined()
  })
  it('keeps body paint and effects through expansion and a width change while untouched labels follow the theme', () => {
    const w = edited()
    expect(part(w, 'body').attrs).toMatchObject({ f: '#123456', sh: [[1, 2, 3, 4, '#000']] })
    const wide = { ...w, params: sanitize(WIDGETS.panel, { ...w.params, w: 300 }, vanillaPlus) }
    expect(part(wide, 'body').attrs.f).toBe('#123456')
    expect(part(wide, 'body').attrs.w).toBe(299)
    expect(part(wide, 'title', neutral).attrs.f).toBe(neutral.colors[neutral.type['panel-title'].ink])
  })
  it('round trips __edit in the marker while an old marker stays unchanged', () => {
    const w = edited(), marked = markerOf(w)
    expect(marked).toContain('"__edit":{"v":1,"parts":{"body":')
    expect(widgetOf(expandRoot(w, vanillaPlus).root, vanillaPlus)?.edit).toEqual(w.edit)
    const old = instance('panel')
    expect(markerOf(old)).toBe(`widget panel ${old.uid} ${JSON.stringify(old.params)}`)
  })
  it('sanitizes hostile records without applying prototype names or unsafe keys', () => {
    const e = sanitizeEdit(JSON.parse('{"v":1,"parts":{"__proto__":{"attrs":{"f":"#123456"}},"body":{"attrs":{"id":"x","click":1,"text":"changed","x":4,"f":null,"sw":2},"dx":4,"dy":1e40}},"root":{"v":0,"t":[1,2],"o":0.5}}'))!
    expect(e).toBeDefined()
    expect(Object.getPrototypeOf(e.parts)).toBeNull()
    expect(e.parts.body).toEqual({ attrs: { f: null, sw: 2 }, dx: 4 })
    expect(e.root).toEqual({ v: 0, o: 0.5 })
    expect(sanitizeEdit({ v: 2, parts: {} })).toBeUndefined()
    expect(sanitizeEdit({ v: 1, parts: { body: { attrs: { f: NaN, sw: Infinity, sh: [[1, 2, 3, 4, NaN]] } } } })).toBeUndefined()
    const applied = applyEdit([node('R', { f: '#fff' })], { body: [0] }, e)
    expect(applied.dormant).toEqual(['__proto__'])
    expect(applied.nodes[0].attrs).toEqual({ x: 4, f: undefined, sw: 2 })
  })
  it.each([['sw', 'abc'], ['f', 'zzz'], ['cap', 7], ['s', 5], ['dash', 'x']])('drops a malformed %s override and keeps valid overrides', (key, bad) => {
    expect(sanitizeEdit({ v: 1, parts: { body: { attrs: { [key]: bad, fo: 0.5 }, dx: 2 } } }))
      .toEqual({ v: 1, parts: { body: { attrs: { fo: 0.5 }, dx: 2 } } })
  })
  it('keeps catalogue literals, expressions, enum aliases and lists without coercing them', () => {
    const attrs = { f: '=if($on,#fff,#000)', s: '@ramp', s_: '$ink', oc: ' red ', sw: '=t+1', so: '$opacity',
      cap: 'ROUND', align: 'centre', weight: 700, dash: [2, 3], rx: [1, 2, 3, 4], sh: [[1, 2, 3, 4, '#000', 'inset']], font: 'Custom', ow: null }
    expect(sanitizeEdit({ v: 1, parts: { body: { attrs } } })?.parts.body.attrs).toEqual(attrs)
  })
  it('rejects lists for scalar numbers while keeping corner-radius lists', () => {
    expect(sanitizeEdit({ v: 1, parts: { body: { attrs: { sw: [1, 2], rx: [1, 2, 3, 4] } } } }))
      .toEqual({ v: 1, parts: { body: { attrs: { rx: [1, 2, 3, 4] } } } })
  })
  it('keeps an empty paint as no paint', () => {
    expect(sanitizeEdit({ v: 1, parts: { body: { attrs: { f: '', s: 'none' } } } }))
      .toEqual({ v: 1, parts: { body: { attrs: { f: '', s: 'none' } } } })
  })
  it.each(['R', 'T', 'C', 'L', 'Y', 'G'])('applies a position offset to a tagged %s', op => {
    const attrs: import('../model/scene').SrcNode['attrs'] = op === 'C' ? { cx: 10, cy: 20, rx: 5, ry: 5 }
      : op === 'L' || op === 'Y' ? { p: [10, 20, 20, 30] } : op === 'G' ? { t: [10, 20] } : { x: 10, y: 20, w: 20, h: 30 }
    const n = node(op, attrs), out = applyEdit([n], { part: [0] }, { v: 1, parts: { part: { dx: 4, dy: 2 } } }).nodes[0]
    expect(out.attrs).toMatchObject(op === 'C' ? { cx: 14, cy: 22 } : op === 'L' || op === 'Y' ? { p: [14, 22, 24, 32] }
      : op === 'G' ? { t: [14, 22] } : { x: 14, y: 22 })
    expect(n.attrs).toEqual(attrs)
  })
  it.each(['R', 'T', 'C'])('applies size offsets to a tagged %s', op => {
    const n = op === 'C' ? node(op, { cx: 20, cy: 30, rx: 10, ry: 15 }) : node(op, { x: 10, y: 15, w: 20, h: 30 })
    const out = applyEdit([n], { part: [0] }, { v: 1, parts: { part: { dw: 4, dh: 2 } } }).nodes[0]
    expect(boxOf(out)).toEqual({ x: 10, y: 15, w: 24, h: 32 })
  })
  it('records changes on tagged parts, accumulates offsets and reset returns the theme expansion', () => {
    const w = instance('panel'), e = expandRoot(w, vanillaPlus), p = e.exp.parts!.title, title = nodeAt(e.root.c!, p)!
    const after = { ...e.root, c: replaceAt(e.root.c!, p, { ...title, attrs: { ...title.attrs, x: (title.attrs.x as number) + 4, y: (title.attrs.y as number) + 2, f: '#123456' } })! }
    const result = editFrom(w, vanillaPlus, e.root, after)
    expect('ref' in result).toBe(true)
    if (!('ref' in result)) throw Error(result.refused)
    expect(result.ref.edit?.parts.title).toMatchObject({ dx: 4, dy: 2, attrs: { f: '#123456' } })
    const current = expandRoot(result.ref, vanillaPlus).root, moved = nodeAt(current.c!, p)!
    const again = editFrom(result.ref, vanillaPlus, current, { ...current, c: replaceAt(current.c!, p, { ...moved, attrs: { ...moved.attrs, x: (moved.attrs.x as number) + 3 } })! })
    expect('ref' in again && again.ref.edit?.parts.title.dx).toBe(7)
    expect(part(resetPart(result.ref, 'title'), 'title')).toEqual(title)
  })
  it('refuses structure, untagged content and protected identities', () => {
    const w = instance('button'), e = expandRoot(w, vanillaPlus), p = e.exp.parts!['state.0.body'], body = nodeAt(e.root.c!, p)!
    for (const changed of [{ ...body, op: 'C' }, { ...body, attrs: { ...body.attrs, id: 'new' } }])
      expect(editFrom(w, vanillaPlus, e.root, { ...e.root, c: replaceAt(e.root.c!, p, changed)! })).toMatchObject({ refused: expect.stringMatching(/Detach/) })
    const plate = e.root.c![0]
    expect(editFrom(w, vanillaPlus, e.root, { ...e.root, c: [{ ...plate, attrs: { ...plate.attrs, x: 99 } }, ...e.root.c!.slice(1)] })).toMatchObject({ refused: expect.stringMatching(/Detach/) })
  })
  it('keeps dormant state overrides by semantic name and Reset removes them', () => {
    const w = instance('button', { states: [{ label: 'A', variant: 'secondary', key: 3 }, { label: 'B', variant: 'primary', key: 8 }] })
    const over = { ...w, edit: { v: 1 as const, parts: { 'state.8.body': { attrs: { f: '#123456' } } } } }
    const one = { ...over, params: { ...w.params, states: (w.params.states as import('./types').Json[]).slice(0, 1) } }
    const exp = expandRoot(one, vanillaPlus)
    expect(exp.exp.dormant).toEqual(['state.8.body'])
    expect(widgetOf(exp.root, vanillaPlus)?.edit).toEqual(over.edit)
    expect(part(over, 'state.8.body').attrs.f).toBe('#123456')
    expect(resetPart(one, 'state.8.body').edit).toBeUndefined()
  })
})
