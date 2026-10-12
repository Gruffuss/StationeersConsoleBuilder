import { expect, it, vi } from 'vitest'
import { THEMES } from '../theme'
import type { SrcNode } from '../model/scene'
import type { Ornament } from '../theme/types'
import { nodeAt, replaceAt } from '../model/tree'
import { newProject } from '../model/project'
import { parseSrc } from '../srctext/parse'
import { printChecked } from '../srctext/print'
import { problemsOf } from '../srctext/testing'
import { devicesPage } from '../codegen/devicesPage'
import { el, partRect, tagOf } from './paint'
import { expandRoot, putWidget, reassociate, sanitize, widgetOf } from './core'
import { editFrom } from './edits'
import { WIDGETS } from './registry'
import type { Params } from './types'
import { HOOKS, sanitizeAnatomy } from './anatomy'
import { allHooks, bracket, checked, instance, rules, rulesOf, sceneOf, variants } from './testing'

const api = () => import('./dress')

it('draws point and cut ornaments on fixed boxes and names the ones a live-size box cannot place', async () => {
  const add: Ornament[] = [
    { name: 'underline', op: 'line', p: [[[0,0],[1,2]], [[1,0],[1,2]]], stroke: 'accent', width: 1 },
    { name: 'notch', op: 'cut', cut: [2,0,0,0], fill: 'accent' },
    { name: 'wash', op: 'rect', fill: 'accent' },
  ]
  const { ornaments } = await api(), t = { ...bracket, anatomy: { v: 1 as const, looks: { 'text:value': { add } } } }
  const fixed = ornaments(t, 'text:value', { x: 0, y: 0, w: 40, h: 20 })
  expect([...fixed.under, ...fixed.over].map(n => n.op)).toEqual(['L', 'Y', 'R'])
  expect(fixed.notes).toEqual([])
  const live = ornaments(t, 'text:value', { x: 0, y: 0, w: '=lerp(10,40,clamp($e,0,1))', h: 20 })
  expect([...live.under, ...live.over].map(n => n.op)).toEqual(['R'])
  expect(live.notes).toEqual(['text:value: ornaments underline, notch need a fixed-size box; not drawn here'])
})

it('does not emit fill opacity when state paint has no primary fill', async () => {
  const { dress } = await api(), t = { ...bracket, anatomy: { v: 1 as const, looks: { panel: { add: [
    { name: 'a', op: 'rect' as const, fill: 'state', stroke: 'accent' },
  ] } } } }
  const primary = el('R', { x: 0, y: 0, w: 30, h: 20, fo: 0.5 })
  const result = dress(t, 'panel', { x: 0, y: 0, w: 30, h: 20 }, primary), ornament = result.c!.find(n => n !== primary)!
  expect(ornament.attrs.fo).toBeUndefined()
  expect(problemsOf({ header: {}, defs: [], root: [ornament] })).toEqual([])
})

it.each(['state', 'none'] as const)('does not emit ornament paint modifiers without resolved %s paint', async fill => {
  const { dress } = await api(), t = { ...bracket, anatomy: { v: 1 as const, looks: { panel: { add: [
    { name: 'a', op: 'rect' as const, fill, stroke: fill, width: 2 },
  ] } } } }
  const primary = el('R', { x: 0, y: 0, w: 30, h: 20, fo: 0.5 })
  const result = dress(t, 'panel', { x: 0, y: 0, w: 30, h: 20 }, primary)
  const ornament = result.c!.find(n => n !== primary)!
  expect(ornament.attrs.sw).toBeUndefined()
  expect(ornament.attrs.fo).toBeUndefined()
  expect(problemsOf({ header: {}, defs: [], root: [ornament] })).toEqual([])
})
const box = { x: 10, y: 20, w: 100, h: 50 }

it('does not inset a primary whose part has width without a stroke', () => {
  for (const stroke of [undefined, 'none']) {
    const t = { ...bracket, parts: { ...bracket.parts, panel: { fill: 'accent', width: 10, outline: 'inside' as const, stroke } },
      anatomy: { v: 1 as const, looks: { panel: { shape: { op: 'rect' as const } } } } }
    const plain = partRect({ ...t, anatomy: undefined }, 'panel', 10, 20, 100, 50)
    const dressed = partRect(t, 'panel', 10, 20, 100, 50)
    expect(plain.attrs).toMatchObject(box)
    expect(dressed.attrs).toEqual(plain.attrs)
    expect(dressed.attrs.sw).toBeUndefined()
  }
})

it('refuses sanitizer-valid derived overflow with a note instead of capping input', async () => {
  const { dress, dressing } = await api(), b = { x: 0, y: 0, w: 10, h: 10 }
  for (const shape of [
    { op: 'rect', frame: { l: [0,-3e38], t: [0,0], r: [1,3e38], b: [1,0] } },
    { op: 'ellipse', frame: { l: [0,3e38], t: [0,0], r: [1,3e38], b: [1,0] } },
  ]) {
    const read = sanitizeAnatomy({ v: 1, looks: { panel: { shape } } }, bracket)
    expect(read.notes).toEqual([])
    const t = { ...bracket, anatomy: read.anatomy }, primary = el('R', { ...b, f: '#123456' })
    // The second shape overflows only when placed far to the right.
    const placed = shape.op === 'ellipse' ? { ...b, x: 3e38 } : b
    expect(dress(t, 'panel', placed, primary)).toBe(primary)
    expect(dressing(primary)?.notes).toEqual(['panel: derived geometry is not finite float32; look not applied'])
    expect(expandRoot(instance('panel', { x: placed.x }), t).exp.notes).toEqual(expect.arrayContaining([
      'panel: derived geometry is not finite float32; look not applied',
    ]))
  }
})

it('refuses overflow in expression coefficients and ornament points for the whole look', async () => {
  const { dress, dressing } = await api()
  for (const expression of [false, true]) {
    const read = sanitizeAnatomy({ v: 1, looks: { panel: {
      add: expression ? [{ name: 'bad', op: 'rect', fill: 'accent',
        frame: { l: [0,-3e38], t: [0,0], r: [1,3e38], b: [1,0] } }]
        : [{ name: 'bad', op: 'line', stroke: 'accent', p: [[[0,3e38],[0,0]], [[1,3e38],[1,0]]] }],
    } } }, bracket)
    expect(read.notes).toEqual([])
    const b = { x: expression ? 0 : 3e38, y: 0, w: expression ? '=w' : 10, h: 10 }
    const n = el('R', { ...b, f: '#123456' })
    expect(dress({ ...bracket, anatomy: read.anatomy }, 'panel', b, n)).toBe(n)
    expect(dressing(n)?.notes).toHaveLength(1)
  }
})

it('keeps a returning line endpoint while closing a polygon implicitly', async () => {
  const { dress } = await api()
  for (const op of ['line', 'poly'] as const) {
    const t = { ...bracket, anatomy: { v: 1 as const, looks: { panel: { add: [
      { name: 'loop', op, p: [[[0,0],[0,0]], [[1,0],[0,0]], [[1,0],[1,0]], [[0,0],[0,0]]] as const, stroke: 'accent' },
    ] } } } }
    const b = { x: 0, y: 0, w: 10, h: 10 }, n = dress(t, 'panel', b, el('R', b))
    expect(n.c![1].attrs.p).toEqual(op === 'line' ? [0,0,10,0,10,10,0,0] : [0,0,10,0,10,10])
  }
})

function nodes(root: SrcNode[]): SrcNode[] {
  const out: SrcNode[] = [], stack = [...root].reverse()
  while (stack.length) { const n = stack.pop()!; out.push(n); for (let i = (n.c?.length ?? 0) - 1; i >= 0; i--) stack.push(n.c![i]) }
  return out
}
const extra = {
  readout: [{ variant: 'hero' }, { variant: 'kpi' }, { variant: 'compact' }, { bar: false }, { unit: '' }],
  bar: [{ marks: [0.5], target: true }, { orient: 'v', marks: [0.5], target: true }, { cells: 4, h: 40 }, { cells: 4, h: 40, target: true }],
  panel: [{ title: '', unit: 'kPa' }], text: [{ state: true }, { style: 'hero' }],
  header: [{ clock: true }, { counts: false }], alert: [{ row: false }],
  button: [{ states: [{ label: 'First', variant: 'secondary' }, { label: 'Second', variant: 'primary' }] },
    { states: [{ label: 'Danger', variant: 'danger' }] }],
} as Record<string, Params[]>
const cases = Object.values(WIDGETS).filter(m => !m.native).flatMap(m =>
  [...variants(m.type), ...extra[m.type] ?? []].map(over => {
    const w = instance(m.type, over)
    return { ...w, params: sanitize(m, w.params, bracket) }
  }))

it('no look, no change', async () => {
  const { dress, forWidget, hooked } = await api(), n = el('R', { ...box, f: 'N' })
  expect(dress(THEMES.neutral, 'panel', box, n)).toBe(n)
  expect(hooked(n)).toBe('panel')
  expect(forWidget(THEMES.neutral, 'panel')).toBe(THEMES.neutral)
})
it('marks at the corners', async () => {
  const { dress } = await api(), n = el('R', { ...box, f: 'N' })
  expect(dress(bracket, 'panel', box, n)).toEqual(el('G', {}, [n, ...[
    [6,32,6,16,22,16], [98,16,114,16,114,32], [114,58,114,74,98,74], [22,74,6,74,6,58],
  ].map(p => el('L', { p, s: '#7A7A7A', sw: 2, cap: 'square' }))]))
})
it('a cut replaces the body, preserving paint order', async () => {
  const { dress } = await api(), b = { x: 24, y: 24, w: 200, h: 48 }
  const n = dress(bracket, 'button.primary', b, el('R', { ...b, rx: 4, f: '#2A64BD', fo: '=1-0.25*down' }))
  expect(n).toEqual(el('Y', { p: [32,24,224,24,224,64,216,72,24,72,24,32], f: '#2A64BD', fo: '=1-0.25*down' }))
  expect(Object.keys(n.attrs)).toEqual(['p', 'f', 'fo'])
})
it('a list row in a repeat and a per-widget replacement', async () => {
  const { dress, forWidget } = await api(), b = { x: 24, y: '=24+i*56', w: 440, h: 44 }, n = el('R', { ...b, f: 'N' })
  expect(dress(bracket, 'row', b, n)).toEqual(el('G', {}, [n, el('R', { x: 24, y: b.y, w: 3, h: 44, f: '#3D8BFD' })]))
  expect(dress(forWidget(bracket, 'eventlog'), 'row', b, n)).toEqual(el('G', { t: [24,b.y] }, [
    el('Y', { p: [6,0,434,0,440,6,440,38,434,44,6,44,0,38,0,6], f: 'N' }),
  ]))
})
it('a size that follows data', async () => {
  const { dress } = await api(), b = { x: 28, y: 28, w: '=clamp($bar1_lvl,0,1)*392', h: 16 }
  expect(dress(bracket, 'fill', b, el('R', { ...b, rx: 2, f: 'S' }))).toEqual(el('G', {}, [
    el('R', { ...b, rx: [0,4,4,0], f: 'S' }),
    el('R', { x: '=28+(clamp($bar1_lvl,0,1)*392)-2', y: 28, w: 2, h: 16, f: '#F2F2F2' }),
  ]))
})
it('the knob in its own frame', async () => {
  const { dress } = await api(), b = { x: '=318+18*clamp($tg1_on,0,1)', y: 12, w: 28, h: 28 }
  expect(dress(bracket, 'knob', b, el('R', { ...b, f: 'K' }))).toEqual(el('G', { t: [b.x,12] }, [
    el('Y', { p: [4,0,24,0,28,4,28,24,24,28,4,28,0,24,0,4], f: 'K' }),
  ]))
})
it('removed, still there', async () => {
  const { dress } = await api()
  expect(dress(bracket, 'header', box, el('R', { ...box, rx: 3, f: 'N', s: 'S', sw: 2 }))).toEqual(el('G', {}, [
    el('R', box), el('R', { x: 10, y: 68, w: 100, h: 2, f: '#3D8BFD' }),
  ]))
})
it('labels keep their text and defer their ornaments', async () => {
  const { dress } = await api(), b = { x: 34, y: 30, w: 200, h: 31 }, n = el('T', { ...b, text: '$value', f: 'N' })
  const result = dress(bracket, 'text:panel-title', b, n)
  expect(result).toBe(n)
})
it('per-widget looks replace the whole generic look safely', async () => {
  const { forWidget } = await api()
  expect(forWidget(bracket, 'eventlog').anatomy!.looks.row).toEqual(bracket.anatomy.looks['eventlog/row'])
  expect(forWidget(bracket, 'readoutrow').anatomy!.looks.row).toEqual(bracket.anatomy.looks.row)
  expect(Object.getPrototypeOf(forWidget(bracket, 'eventlog').anatomy!.looks)).toBe(null)
})
it('linear coordinates have the specified expression format', async () => {
  const { lin } = await api()
  expect(lin(28, 1, '=clamp($bar1_lvl,0,1)*392', -2)).toBe('=28+(clamp($bar1_lvl,0,1)*392)-2')
  expect(lin('=i*3', 0, '=ignored', 0)).toBe('=i*3')
  expect(lin('=i*3', 2, 10, -2)).toBe('=i*3+18')
  expect(lin(0, 1, '=w', 0)).toBe('=w')
  expect(lin('=x', -2, '=w', 4)).toBe('=(x)-2*(w)+4')
  expect(lin(-3, 2, 10, 4)).toBe(21)
})
it('outline geometry, degenerate cuts and ornament paint stay valid', async () => {
  const { dress } = await api()
  const t = { ...bracket, anatomy: { v: 1 as const, looks: { panel: { shape: { op: 'cut' as const, cut: [100,100,100,100] as const },
    add: [{ name: 'zero', op: 'ellipse' as const, fill: 'state', stroke: 'accent', width: 2, outline: 'outside' as const }] } } } }
  const result = dress(t, 'panel', { x: 0, y: 0, w: 10, h: 4 }, el('R', { v: '=v', x: 0, y: 0, w: 10, h: 4, f: 'N', fo: '=fo', s: 'S', sw: 2 }))
  expect(result.c![0].attrs.p).toEqual([2,1,8,1,9,2,8,3,2,3,1,2])
  expect(result.c![1]).toEqual(el('C', { v: '=v', cx: 5, cy: 2, rx: 6, ry: 3, f: 'N', fo: '=fo', s: '#3D8BFD', sw: 2 }))
  const tiny = dress(t, 'panel', { x: 0, y: 0, w: 0, h: 0 }, el('R', { x: 0, y: 0, w: 0, h: 0, f: 'N' }))
  expect(tiny.c!.some(n => n.op === 'Y')).toBe(false)
})
it('every module, every case, the mod rules', async () => {
  await api()
  const failures: string[] = []
  for (const w of cases) {
    for (const rule of rules(w, bracket)) failures.push(`${w.type} ${JSON.stringify(w.params)}: ${rule}`)
    expect(checked(w, bracket), w.type).toEqual([])
    const dressed = nodes(expandRoot(w, bracket).exp.nodes), plain = nodes(expandRoot(w, THEMES.neutral).exp.nodes)
    expect(dressed.filter(n => n.op === 'P').length, w.type).toBe(plain.filter(n => n.op === 'P').length)
    for (const n of dressed) {
      expect(n.op).not.toBe('CP')
      expect(Object.keys(n.attrs).filter(k => ['clip', 'mask'].includes(k))).toEqual([])
      if (n.attrs.p) expect((n.attrs.p as unknown[]).some(v => typeof v === 'string')).toBe(false)
      if (n.op === 'G') expect(Object.keys(n.attrs).filter(k => /^(f|s|s_)$/.test(k))).toEqual([])
    }
  }
  expect(failures).toEqual([])
})

it('ornaments go under every label', async () => {
  const module = await api(), glyphBoxes = vi.spyOn(module, 'ornaments')
  expect(sanitizeAnatomy(allHooks.anatomy, allHooks).notes).toEqual([])
  const seen = new Set<string>()
  for (const w of cases) {
    const exp = expandRoot(w, allHooks).exp
    expect(checked(w, allHooks), w.type).toEqual([])
    for (const n of nodes(exp.nodes)) {
      const hook = module.hooked(n)
      if (hook) seen.add(hook)
    }
    expect(rules(w, allHooks), w.type).toEqual([])
    const lists = [exp.nodes]
    while (lists.length) {
      const list = lists.pop()!, labels = list.filter(n => n.op === 'T'), first = list.findIndex(n => n.op === 'T')
      const ornaments = labels.map(label => list.find(n => tagOf(n) === tagOf(label) + '~box')!)
      expect(ornaments.every(Boolean), w.type).toBe(true)
      expect(ornaments.map(n => list.indexOf(n))).toEqual(ornaments.map(n => list.indexOf(n)).sort((a,b) => a-b))
      for (let i = 0; i < labels.length; i++) {
        expect(list.indexOf(ornaments[i])).toBeLessThan(first)
        expect(ornaments[i].attrs.v).toEqual(labels[i].attrs.v)
      }
      for (const n of list) if (n.c) lists.push(n.c)
    }
  }
  for (const [, hook] of glyphBoxes.mock.calls) seen.add(hook)
  glyphBoxes.mockRestore()
  expect([...seen].sort()).toEqual([...HOOKS.keys()].sort())
  expect(Object.keys(allHooks.anatomy!.looks).sort()).toEqual([...HOOKS.keys()].sort())
})
it('they stay in their scope', () => {
  const e = expandRoot(instance('eventlog', { time: true }), allHooks), parts = e.exp.parts!
  const message = parts.message, ornament = parts['message~box']
  expect(message.slice(0,-1)).toEqual(ornament.slice(0,-1))
  const scope = nodeAt(e.exp.nodes, message.slice(0,-1))!
  expect(scope.op).toBe('G')
  expect(nodeAt(e.exp.nodes, message.slice(0,-2))!.op).toBe('RP')
  expect(scope.c!.findIndex(n => tagOf(n) === 'message~box')).toBeLessThan(scope.c!.findIndex(n => n.op === 'T'))
  expect(scope.attrs.v).toBe('=gt($log1_k[i],0)')
  const moved = expandRoot({ ...instance('eventlog', { time: true }), edit: { v: 1, parts: { message: { dx: 4 }, time: { dx: 2 } } } }, allHooks)
  const mpath = moved.exp.parts!.message, opath = moved.exp.parts!['message~box']
  expect(mpath.slice(0,-1)).toEqual(message.slice(0,-1))
  expect(opath.slice(0,-1)).toEqual(mpath.slice(0,-1))
  expect(nodeAt(moved.exp.nodes, opath)!.attrs.x).toBe(Number(nodeAt(e.exp.nodes, ornament)!.attrs.x)+4)
  expect(nodes(moved.exp.nodes).filter(n => tagOf(n) === 'message~box')).toHaveLength(1)
  expect(moved.exp.dormant).toEqual([])
})
it('redress rebuilds label ornaments in place', () => {
  const w = instance('panel'), before = expandRoot(w, allHooks), path = before.exp.parts!.title, label = nodeAt(before.exp.nodes, path)!
  expect(path).toHaveLength(1)
  const after = { ...before.root, c: replaceAt(before.exp.nodes, path, { ...label, attrs: { ...label.attrs, x: Number(label.attrs.x)+4, w: Number(label.attrs.w)+10 } })! }
  const edited = editFrom(w, allHooks, before.root, after)
  expect(edited).toHaveProperty('ref')
  if (!('ref' in edited)) return
  const e = expandRoot(edited.ref, allHooks), opath = e.exp.parts!['title~box'], ornament = nodeAt(e.exp.nodes, opath)!
  expect(opath.slice(0,-1)).toEqual(e.exp.parts!.title.slice(0,-1))
  expect(opath.at(-1)).toBeLessThan(e.exp.parts!.title.at(-1)!)
  expect(ornament.attrs).toMatchObject({ x: Number(label.attrs.x)+4, w: Number(label.attrs.w)+10 })
  expect(widgetOf(e.root, allHooks)!.edit).toEqual(edited.ref.edit)
})
it('a removed reader keeps its slot', () => {
  const w = instance('duct'), dressed = expandRoot(w, bracket), own = expandRoot(w, THEMES.neutral)
  expect(dressed.exp.slots).toEqual(own.exp.slots)
  expect(dressed.exp.slots.map(s => [s.slot, s.key])).toEqual([['run', 'duct1_run']])
  expect(JSON.stringify(dressed.root)).not.toContain('$duct1_run')
  expect(rules(w, bracket)).toEqual([])
  expect(rules(instance('duct', { dir: 'v' }), bracket)).toEqual([])
})
it('E2 keeps both halves', () => {
  const primary = el('R', { x: 0, y: 0, w: 1, h: 1 }), root = el('G', { id: 'x1' }, [primary])
  const exp = { nodes: [primary], slots: [{ slot: 'k', key: 'x1_k', kind: 'number' as const, snap: true, sample: 0 }] }
  expect(rulesOf(root, [], exp, 'x1')).toEqual(['E2: slot key x1_k is never read'])
  expect(rulesOf(root, [], exp, 'x1', root)).toEqual(['E2: slot key x1_k is never read'])
  const dressed = el('G', { id: 'x1' }, [el('R', { x: '=$x1_z', y: 0, w: 1, h: 1 })])
  const own = el('G', { id: 'x1' }, [el('R', { x: '=$x1_k', y: 0, w: 1, h: 1 })])
  expect(rulesOf(dressed, [], exp, 'x1', own)).toEqual(['E2: $x1_z is no slot key'])
})
it('every painted node has a hook, and the hook tables are exact', async () => {
  const module = await api(), { hooked, dressing } = module, { HOOKS, LIVE_SIZE, VALUE_SHAPES } = await import('./anatomy')
  const glyphBoxes = vi.spyOn(module, 'ornaments')
  const seen = new Set<string>(), live = new Set<string>(), values = new Set<string>()
  for (const w of cases) {
    const drawn = WIDGETS[w.type].expand(w.params, THEMES.neutral, w.uid).nodes
    const turning = new Set(drawn.filter(n => n.op === 'G' && String(n.attrs.r).includes('$')).flatMap(n => nodes(n.c ?? [])))
    for (const n of nodes(drawn)) {
      if (w.type === 'glyph') continue
      if (n.attrs.f !== undefined || n.attrs.s !== undefined || n.op === 'T') expect(hooked(n), `${w.type} ${n.op}`).toBeDefined()
      const hook = hooked(n), b = dressing(n)?.box
      if (!hook) continue
      seen.add(hook)
      if (b && [b.w,b.h].some(v => typeof v === 'string')) live.add(hook)
      if (turning.has(n) || Object.entries(n.attrs).some(([k,v]) => ['x','y','w','h','cx','cy','rx','ry','p','d'].includes(k) && JSON.stringify(v).includes('$'))) values.add(hook)
    }
  }
  // Glyph content is exempt; observe the module dressing its box instead.
  expect(glyphBoxes.mock.calls.length).toBe(cases.filter(w => w.type === 'glyph').length)
  for (const [, hook] of glyphBoxes.mock.calls) seen.add(hook)
  glyphBoxes.mockRestore()
  expect([...seen].sort()).toEqual([...HOOKS.keys()].sort())
  expect([...live].sort()).toEqual([...LIVE_SIZE].sort())
  expect([...values].sort()).toEqual([...VALUE_SHAPES].sort())
})
it('names stay on primaries and ornaments, never wrappers', async () => {
  await api()
  for (const w of cases) {
    const a = expandRoot(w, bracket).exp.parts!, b = expandRoot(w, THEMES.neutral).exp.parts!
    expect(Object.keys(a).filter(k => !k.includes('~')).sort(), w.type).toEqual(Object.keys(b).sort())
    for (const n of nodes(expandRoot(w, bracket).exp.nodes)) if (n.op === 'G') expect(tagOf(n)).toBeUndefined()
    const names = nodes(expandRoot(w, bracket).exp.nodes).map(tagOf).filter(Boolean)
    expect(new Set(names).size, w.type).toBe(names.length)
  }
  expect(Object.keys(expandRoot(instance('panel'), bracket).exp.parts!)).toEqual(expect.arrayContaining(
    ['body', 'body~mark-tl', 'body~mark-tr', 'body~mark-br', 'body~mark-bl', 'title~rule']))
  expect(Object.keys(expandRoot(instance('glyph'), bracket).exp.parts!)).toContain('glyph~disc')
})
it('widgets stay widgets through code and a theme reset', async () => {
  await api()
  for (const w of cases) {
    const s = sceneOf(w, bracket), back = parseSrc(printChecked(s)).scene!
    expect(reassociate(s, back, bracket).detached, w.type).toEqual([])
    const empty = { ...s, root: [], defs: [] }
    expect(printChecked(putWidget(putWidget(empty, w, bracket), w, THEMES.neutral))).toBe(printChecked(putWidget(empty, w, THEMES.neutral)))
  }
})
it('the Devices page keeps its configuration and passes the checker', async () => {
  await api()
  const p = newProject(); p.pages[0].scene = sceneOf(instance('toggle'), bracket)
  const a = devicesPage(p, bracket), b = devicesPage(p, THEMES.neutral)
  expect(a.cfg).toEqual(b.cfg)
  expect(problemsOf(a.scene)).toEqual([])
})
it('state ornaments without a bound state slot reuse the primary paint', async () => {
  await api()
  const t = { ...bracket, anatomy: { v: 1 as const, looks: { fill: { add: [
    { name: 'cap', op: 'rect' as const, fill: 'state' },
  ] } } } }
  for (const stateMode of ['auto','ok']) {
    const w = instance('bar', { stateMode }), e = expandRoot(w,t).exp
    expect(rules(w,t)).toEqual([])
    const all = nodes(e.nodes), primary = all.find(n => tagOf(n) === 'fill')!, cap = all.find(n => tagOf(n) === 'fill~cap')!
    expect(cap.attrs.f).toBe(primary.attrs.f)
  }
})
