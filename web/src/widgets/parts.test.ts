import { expect, it } from 'vitest'
import { boxOf } from '../editor/geometry'
import type { SrcNode } from '../model/scene'
import { printChecked } from '../srctext/print'
import { vanillaPlus } from '../theme/vanillaPlus'
import { THEMES } from '../theme'
import type { PaintPart, PartName, Theme } from '../theme/types'
import * as paint from './paint'
import { sanitize } from './core'
import { WIDGETS } from './registry'
import { checked, instance, noClip, rules, sceneOf, TEST_CTX } from './testing'
import type { Params } from './types'

const variants: Record<string, Params[]> = {
  button: [{ states: [{ label: 'Primary', variant: 'primary' }] }, { states: [{ label: 'Danger', variant: 'danger' }] },
    { states: [{ label: 'First', variant: 'secondary' }, { label: 'Second', variant: 'primary' }] }, { canDisable: true }, { canSelect: true }],
  readout: [{ variant: 'hero' }, { variant: 'kpi' }, { variant: 'compact' }, { bar: false }, { unit: '' }],
  toggle: [{ look: 'button' }, { look: 'switch' }],
  bar: [{ orient: 'h' }, { orient: 'v' }, { cells: 4 }, { stateMode: 'auto' }, { stateMode: 'ok' }, { marks: [0.5] }, { target: true },
    { orient: 'v', marks: [0.5], target: true }],
  repeater: [{ item: 'row' }, { item: 'text' }, { item: 'bar' }, { item: 'light' }, { layout: 'grid' }],
  header: [{ clock: true }, { counts: false }],
  panel: [{ title: '', unit: 'kPa' }],
  glyph: [{ glyph: 'cog' }, { glyph: 'arrow' }, { glyph: 'check' }, { glyph: 'cross' }],
  alert: [{ row: false }], eventlog: [{ time: true }], text: [{ state: true }, { style: 'hero' }],
  gauge: [{ state: false }],
}
const cases = Object.keys(WIDGETS).flatMap(type => [{ type, over: {} }, ...(variants[type] ?? []).map(over => ({ type, over }))])
// The historical corpus stays frozen; Gauge has its own core direction fixtures.
const frozen = cases.filter(c => c.type !== 'gauge')
const output = (t = vanillaPlus, corpus = cases) => corpus.map(({ type, over }) => {
  const w = instance(type, over), m = WIDGETS[type]
  return `${type} ${JSON.stringify(over)}\n${m.native ? JSON.stringify(m.expand(w.params, t, w.uid).natives) : printChecked(sceneOf(w, t))}`
}).join('\n\n') + '\n'

it('switch and bar accept absent and state paints', () => {
  for (const [off, on] of [[undefined, undefined], ['none', 'none'], ['state', 'state']] as const) {
    const t: Theme = { ...vanillaPlus, parts: { ...vanillaPlus.parts,
      'switch.off': { fill: off }, 'switch.on': { fill: on }, 'light.ok': { fill: 'state' },
      fill: { fill: 'state', stroke: 'state', width: 1 } } }
    for (const [type, over] of [['toggle', { look: 'switch' }], ['bar', { stateMode: 'auto' }], ['bar', { stateMode: 'ok' }]] as const) {
      const w = instance(type, over)
      expect(() => sceneOf(w, t)).not.toThrow()
      expect(rules(w, t)).toEqual([])
      expect(checked(w, t)).toEqual([])
      expect(printChecked(sceneOf(w, t))).not.toMatch(/undefined|mix\(@/)
    }
  }
})

it('registers the switch state paint as its own snapped slot and keeps on eased', () => {
  const t: Theme = { ...vanillaPlus, parts: { ...vanillaPlus.parts,
    'switch.off': { fill: 'state', stroke: 'state', width: 1 }, 'switch.on': { fill: 'state' } } }
  const w = instance('toggle', { look: 'switch', keys: { st: 'condition' } })
  const e = WIDGETS.toggle.expand(w.params, t, w.uid)
  expect(e.slots).toEqual(expect.arrayContaining([
    expect.objectContaining({ slot: 'on', snap: false }),
    expect.objectContaining({ slot: 'st', key: 'condition', kind: 'state', snap: true }),
  ]))
  expect(rules(w, t)).toEqual([])
  expect(checked(w, t)).toEqual([])
})

it('keeps an absent ok paint empty instead of reading an unbound state', () => {
  const t: Theme = { ...vanillaPlus, parts: { ...vanillaPlus.parts, 'light.ok': {}, fill: { fill: 'state' } } }
  const w = instance('bar', { stateMode: 'ok' })
  expect(() => sceneOf(w, t)).not.toThrow()
  expect(rules(w, t)).toEqual([])
  expect(checked(w, t)).toEqual([])
  expect(WIDGETS.bar.expand(w.params, t, w.uid).nodes[1].attrs.f).toBe('none')
})

it('a larger theme lays out cleanly', () => {
  expect(vanillaPlus.metrics).toBeDefined()
  const large: Theme = { ...vanillaPlus,
    type: Object.fromEntries(Object.entries(vanillaPlus.type).map(([name, style]) => [name, { ...style, size: style.size * 1.5 }])) as Theme['type'],
    metrics: Object.fromEntries(Object.entries(vanillaPlus.metrics).map(([name, value]) => [name, value * 1.5])) as Theme['metrics'] }
  const overlaps = (nodes: SrcNode[]) => {
    const labels: ReturnType<typeof boxOf>[] = [], pairs: string[] = [], stack = [...nodes]
    for (let n = stack.pop(); n; n = stack.pop()) {
      if (n.op === 'T') labels.push(boxOf(n))
      for (const child of n.c ?? []) stack.push(child)
    }
    labels.forEach((a, i) => labels.slice(i + 1).forEach((b, j) => {
      if (a && b && a.w > 0 && b.w > 0 && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        pairs.push(`${i}:${i + j + 1}`)
    }))
    return pairs
  }
  for (const { type, over } of cases) {
    if (WIDGETS[type].native) continue
    const m = WIDGETS[type], base = instance(type, over)
    const w = { ...base, params: sanitize(m, { ...m.defaults(large, TEST_CTX), ...over }, large) }
    expect([...rules(w, large), ...checked(w, large)], `${type} ${JSON.stringify(over)}`).toEqual([])
    expect(overlaps(m.expand(w.params, large, w.uid).nodes), `${type} ${JSON.stringify(over)}`)
      .toEqual(overlaps(m.expand(base.params, vanillaPlus, base.uid).nodes))
  }
})

it('keeps Vanilla + widget output byte for byte', async () => {
  await expect(output(vanillaPlus, [...frozen,
    { type: 'readout', over: { variant: 'hero', unit: '%' } },
    { type: 'readout', over: { variant: 'kpi', unit: '%' } },
  ])).toMatchFileSnapshot('../../test/fixtures/widgets/vanilla-plus.txt')
})

it('keeps Neutral widget output byte for byte', async () => {
  await expect(output(THEMES.neutral, frozen)).toMatchFileSnapshot('../../test/fixtures/widgets/neutral.txt')
})

it('every part is used', () => {
  expect(vanillaPlus.parts).toBeDefined()
  const colors = { ...vanillaPlus.colors }, parts = { ...vanillaPlus.parts }
  for (const [i, name] of (Object.keys(parts) as PartName[]).entries()) {
    const role = `sentinel-${name}`
    colors[role] = '#0000' + (i + 1).toString(16).padStart(2, '0')
    parts[name] = { ...parts[name], fill: role, stroke: role, ink: role }
  }
  const text = output({ ...vanillaPlus, colors, parts })
  for (const name of Object.keys(parts)) if (!['shape', 'line'].includes(name))
    expect(text, name).toContain(colors[`sentinel-${name}`])
})

it('a flat square theme reaches every widget', () => {
  expect(vanillaPlus.parts).toBeDefined()
  const parts = Object.fromEntries(Object.keys(vanillaPlus.parts).map(name => [name, { fill: 'surface-panel', radius: 0 }])) as Record<PartName, PaintPart>
  parts.focus = { stroke: 'accent', width: 2, outline: 'outside' }
  parts['duct.flow'] = { stroke: 'surface-panel' }
  const flat: Theme = { ...vanillaPlus, gradients: {}, shadows: {}, parts }
  for (const { type, over } of cases) {
    if (WIDGETS[type].native) continue
    const w = instance(type, over), text = printChecked(sceneOf(w, flat))
    expect(rules(w, flat), `${type} ${JSON.stringify(over)}`).toEqual([])
    expect(checked(w, flat), `${type} ${JSON.stringify(over)}`).toEqual([])
    expect(text).not.toContain('@theme_')
    expect(text).not.toMatch(/\bsh=/)
    // The cog's teeth are glyph geometry, not theme part rectangles.
    if (type !== 'glyph') expect(text.split('\n').filter(line => /^\s*R /.test(line)).join('\n')).not.toContain('rx=')
  }
})

it('modules paint only through parts', () => {
  const sources = import.meta.glob('./modules/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const allow = new Set(['./modules/glyph.ts'])
  expect(Object.entries(sources).filter(([path, source]) => !allow.has(path) && /\bcolour\s*\(/.test(source)).map(([path]) => path)).toEqual([])
})

it('no module or Vanilla + golden case expands a clip or CP', () => {
  for (const { type, over } of cases) {
    const w = instance(type, over), e = WIDGETS[type].expand(w.params, vanillaPlus, w.uid)
    noClip([...e.nodes, ...e.defs ?? []])
  }
})

it('partRect places outlines', () => {
  expect(paint.partRect).toBeTypeOf('function')
  const row = paint.partRect(vanillaPlus, 'row', 0, 0, 100, 50).attrs
  expect(row).toEqual({ x: 0.5, y: 0.5, w: 99, h: 49, rx: 5.5, f: '@theme_row', s: '#5A5A69', sw: 1 })
  expect(Object.keys(row)).toEqual(['x', 'y', 'w', 'h', 'rx', 'f', 's', 'sw'])
  const focus = paint.partRect(vanillaPlus, 'focus', 0, 0, 100, 50, { v: '=$s' }).attrs
  expect(focus).toEqual({ v: '=$s', x: -1.5, y: -1.5, w: 103, h: 53, rx: 7.5, f: 'none', s: '#FF772D', sw: 3 })
  expect(Object.keys(focus)).toEqual(['v', 'x', 'y', 'w', 'h', 'rx', 'f', 's', 'sw'])
})


it('an inside outline never has a negative radius', () => {
  for (const radius of [0, 0.25, 0.5]) {
    const t = { ...vanillaPlus, parts: { ...vanillaPlus.parts, header: { fill: 'surface-panel', stroke: 'border', width: 1, radius, outline: 'inside' as const } } }
    expect(paint.partRect(t, 'header', 0, 0, 100, 50).attrs.rx ?? 0).toBe(0)
  }
})
