import { expect, it } from 'vitest'
import type { SrcNode } from '../model/scene'
import { namesOf } from '../codegen/names'
import { newProject } from '../model/project'
import { copyText, idsIn, pasteText, uidOn } from '../editing/clipboard'
import { printChecked } from '../srctext/print'
import { THEMES } from '../theme'
import { sanitizeAnatomy } from './anatomy'
import { expandRoot, sanitize, widgetOf } from './core'
import { dressing } from './dress'
import { literal, oneLine, tagOf } from './paint'
import { WIDGETS } from './registry'
import { bracket, checked, rules, sceneOf, TEST_CTX } from './testing'
import type { Params } from './types'

function gauge(over: Params = {}, t = THEMES.neutral) {
  expect(WIDGETS.gauge).toBeDefined()
  const m = WIDGETS.gauge
  return { type: 'gauge', uid: 'gauge1', params: sanitize(m, { ...m.defaults(t, TEST_CTX), ...over }, t) }
}
function nodes(root: SrcNode): SrcNode[] {
  const out: SrcNode[] = [], stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    out.push(n)
    for (let i = (n.c?.length ?? 0) - 1; i >= 0; i--) stack.push(n.c![i])
  }
  return out
}

it('registers an editable Gauge in the values palette', () => {
  expect(WIDGETS.gauge).toMatchObject({ type: 'gauge', prefix: 'gauge', group: 'values', resize: 'both' })
})
it.each(Object.values(THEMES))('keeps the mod rules in $name', t => {
  const cases: Params[] = [{}, { min: 10, max: 10 }, { ticks: 0 }, { ticks: 1 }, { value: false }, { state: false }, { start: -90, end: 90 }, { w: 0, h: 0 }]
  for (const over of cases) {
    const w = gauge(over, t)
    expect([...rules(w, t), ...checked(w, t)], JSON.stringify(over)).toEqual([])
  }
})
it('turns a literal needle about the dial centre with the exact clamped expression', () => {
  const e = expandRoot(gauge(), THEMES.neutral).exp, turn = e.nodes.find(n => n.op === 'G')!
  expect(turn.attrs.r).toBe('=-135+clamp(($gauge1_v-0)/100,0,1)*270')
  const [cx, cy] = turn.attrs.a as number[], needle = turn.c![0], b = dressing(needle)!.box
  expect(needle.op).toBe('L')
  expect(needle.attrs.p).toEqual([cx, cy, cx, Math.fround(Number(b.y))])
  expect(b).toEqual({ x: cx - 1.5, y: b.y, w: 3, h: cy - Number(b.y) })
  expect(expandRoot(gauge({ min: 10, max: 10 }), THEMES.neutral).exp.nodes.find(n => n.op === 'G')!.attrs.r)
    .toBe('=-135+gt($gauge1_v,10)*270')
})
it('declares the eased number and optional snapped state, snapping a shown reading through the shared rule', () => {
  const e = expandRoot(gauge(), THEMES.neutral)
  expect(e.exp.slots).toEqual([{ slot: 'v', key: 'gauge1_v', kind: 'number', snap: false, sample: 50 },
    { slot: 'st', key: 'gauge1_st', kind: 'state', snap: true, sample: 1 }])
  expect(expandRoot(gauge({ state: false }), THEMES.neutral).exp.slots.map(s => s.slot)).toEqual(['v'])
  const page = newProject().pages[0]
  expect(namesOf({ ...page, scene: sceneOf(gauge(), THEMES.neutral) }, THEMES.neutral).find(s => s.slot === 'v')!.snap).toBe(true)
  expect(namesOf({ ...page, scene: sceneOf(gauge({ value: false }), THEMES.neutral) }, THEMES.neutral).find(s => s.slot === 'v')!.snap).toBe(false)
})
it.each(Object.values(THEMES))('keeps the state slot read at zero radius in $name', t => {
  const w = gauge({ w: 12, h: 0, value: false }, t)
  expect(expandRoot(w, t).exp.slots.map(s => s.slot)).toEqual(['v', 'st'])
  expect([...rules(w, t), ...checked(w, t)]).toEqual([])
})
it.each(['kPa', '007', '1e3', '=x', ''])('tags every painted node and places the formatted reading with unit %s above the bottom label', unit => {
  const e = expandRoot(gauge({ unit }), THEMES.neutral)
  for (const n of nodes(e.root)) if (n.attrs.f !== undefined || n.attrs.s !== undefined || n.op === 'T') expect(tagOf(n)).toBeDefined()
  expect(Object.keys(e.exp.parts!)).toEqual(['track', 'tick@0', 'tick@0.25', 'tick@0.5', 'tick@0.75', 'tick@1', 'needle', 'hub', 'value', 'label'])
  const value = nodes(e.root).find(n => tagOf(n) === 'value')!, label = nodes(e.root).find(n => tagOf(n) === 'label')!
  expect(value.attrs).toMatchObject({ text: '{$gauge1_v:%.0f}', align: 'center' })
  expect(value.attrs.unit).toBe(unit ? literal(THEMES.neutral, 'unit', unit) : undefined)
  expect(checked(gauge({ unit }), THEMES.neutral)).toEqual([])
  expect(label.attrs.text).toBe('Label')
  expect(label.attrs.h).toBe(oneLine(THEMES.neutral, 'unit'))
  expect(Number(value.attrs.y) + Number(value.attrs.h)).toBeLessThanOrEqual(Number(label.attrs.y))
})
it('copies the Gauge with a fresh uid and the same part names', () => {
  const w = gauge(), s = sceneOf(w, THEMES.neutral), p = newProject()
  p.pages[0].scene = s
  const result = pasteText(s, copyText(s, s.root, THEMES.neutral), idsIn(p, THEMES.neutral), 10, 10, THEMES.neutral, uidOn(p, p.pages[0].id))
  expect(typeof result).not.toBe('string')
  if (typeof result === 'string') return
  const copy = widgetOf(result.scene.root[1], THEMES.neutral)!
  expect(copy.uid).toBe('gauge2')
  expect(Object.keys(expandRoot(copy, THEMES.neutral).exp.parts!)).toEqual(Object.keys(expandRoot(w, THEMES.neutral).exp.parts!))
})
it('keeps the tail ornament inside the turning group and rejects removal of the needle', () => {
  const t = bracket
  const e = expandRoot(gauge(), t), turn = e.exp.nodes.find(n => n.attrs.r !== undefined)!
  expect(nodes(turn).map(tagOf)).toContain('needle~tail')
  expect([...rules(gauge(), t), ...checked(gauge(), t)]).toEqual([])
  const sanitized = sanitizeAnatomy({ v: 1, looks: { 'gauge.needle': { shape: 'none' } } }, t)
  expect(sanitized.anatomy?.looks['gauge.needle']?.shape).toBeUndefined()
  expect(sanitized.notes).toEqual([expect.stringContaining('shape not allowed')])
})
it('draws full turns as four quarter arcs', () => {
  for (const t of Object.values(THEMES)) for (const [start, end] of [[-180,180], [0,720], [180,-180]]) {
    const w = gauge({ start, end }, t), e = expandRoot(w, t)
    const d = e.exp.nodes[0].attrs.d as string
    expect(d.match(/A/g)).toHaveLength(4)
    expect(d).toMatch(/Z$/)
    const direction = end > start ? 1 : 0
    expect(d.match(new RegExp(` 0 0 ${direction} `, 'g'))).toHaveLength(4)
    expect(e.exp.nodes.find(n => n.attrs.r !== undefined)!.attrs.r).toBe(`=${start}+clamp(($gauge1_v-0)/100,0,1)*${end-start}`)
    expect([...rules(w, t), ...checked(w, t)]).toEqual([])
  }
})
it('keeps full-turn quarter endpoints distinct at float32 angle extremes', () => {
  for (const start of [-3e38, 3e38]) {
    const d = expandRoot(gauge({ start, end: 0, ticks: 0 }), THEMES.neutral).exp.nodes[0].attrs.d as string
    const ends = d.replace(/ Z$/, '').split(' A').slice(1).map(arc => arc.split(' ').slice(-2).join(' '))
    expect(new Set(ends).size).toBe(4)
  }
})
const coreCases: { name: string; over: Params }[] = [{ name: 'gauge', over: { start: -45, end: 45 } }, { name: 'gauge-default', over: {} },
  { name: 'gauge-full', over: { start: -180, end: 180 } }]
it.each(coreCases)('freezes the $name core direction fixture', async ({ name, over }) => {
  const base = THEMES['vanilla-plus']
  // A one-unit stroke keeps the drawn span within one unit of the dial's square.
  const t = name === 'gauge-full' ? { ...base, parts: { ...base.parts, 'gauge.track': { ...base.parts['gauge.track'], width: 1 } } } : base
  const w = gauge({ ...over, state: false, value: false, ticks: 0 }, t)
  await expect(printChecked(sceneOf(w, t))).toMatchFileSnapshot(`../../test/fixtures/widgets/${name}.src`)
})
