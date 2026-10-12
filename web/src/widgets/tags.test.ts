import { describe, expect, it } from 'vitest'
import { printChecked } from '../srctext/print'
import { THEMES } from '../theme'
import { vanillaPlus } from '../theme/vanillaPlus'
import { expandRoot, markerOf, reassociate, sanitize, widgetOf } from './core'
import { WIDGETS } from './registry'
import { instance, sceneOf, TEST_CTX } from './testing'
import type { Expansion, Params } from './types'

const light = ['idle', 'ok', 'warn', 'crit'], chip = ['chip', 'chip.ok', 'chip.warn', 'chip.crit']
const lit = light.map(s => 'light.' + s)
const base: Record<string, string[]> = {
  alert: ['row', ...chip, 'message'], eventlog: ['row', ...chip, 'message'], bar: ['track', 'fill'],
  button: ['state.0.body', 'state.0.label'], options: [0, 1, 2].flatMap(k => ['ring', 'body', 'label'].map(s => `option.${k}.${s}`)),
  tabs: ['tab.0.ring', 'tab.0.body', 'tab.0.label', 'tab.1.body', 'tab.1.label'],
  duct: ['track', 'flow'], glyph: ['tooth', 'disc'], header: ['banner', 'title', 'crit.lamp', 'crit.count', 'warn.lamp', 'warn.count'],
  gauge: ['track', 'tick@0', 'tick@0.25', 'tick@0.5', 'tick@0.75', 'tick@1', 'needle', 'hub', 'value', 'label'],
  kvtable: [0, 1, 2].flatMap(k => [`row.${k}`, `row.${k}.caption`, `row.${k}.value`]), light,
  panel: ['body', 'title'], readout: ['track', 'fill', 'figure', 'status', 'sub'],
  readoutrow: ['row', ...lit, 'name', 'reading1'], repeater: ['row', ...lit, 'name', 'value'],
  stepper: ['dec.body', 'inc.body', 'name', 'dec.sign', 'value', 'inc.sign'], text: ['text'],
  toggle: ['ring', 'body', 'label', 'off', 'on'],
}
type Case = { type: string; over: Params; names: string[] }
const variants: Record<string, { over: Params; names?: string[] }[]> = {
  button: [{ over: { states: [{ label: 'Primary', variant: 'primary' }] } }, { over: { states: [{ label: 'Danger', variant: 'danger' }] } },
    { over: { states: [{ label: 'First', variant: 'secondary' }, { label: 'Second', variant: 'primary' }] }, names: ['state.0.body', 'state.0.label', 'state.1.body', 'state.1.label'] },
    { over: { canDisable: true } }, { over: { canSelect: true }, names: ['ring', ...base.button] }],
  readout: [{ over: { variant: 'hero' } }, { over: { variant: 'kpi' }, names: ['meter', 'caption', 'value'] },
    { over: { variant: 'compact' }, names: [...lit, 'caption', 'status'] }, { over: { bar: false }, names: ['figure', 'status', 'sub'] },
    { over: { unit: '' } }, { over: { unit: 'kPa' }, names: [...base.readout, 'unit'] },
    { over: { variant: 'kpi', unit: 'kPa' }, names: ['meter', 'caption', 'value', 'unit'] },
    { over: { subFmt: '' }, names: ['track', 'fill', 'figure', 'status'] }],
  toggle: [{ over: { look: 'button' } }, { over: { look: 'switch' }, names: ['track', 'knob', 'label'] }],
  bar: [{ over: { orient: 'h' } }, { over: { orient: 'v' } }, { over: { cells: 4 } }, { over: { stateMode: 'auto' } },
    { over: { stateMode: 'ok' } }, { over: { marks: [0.5] }, names: [...base.bar, 'mark@0.5'] },
    { over: { target: true }, names: [...base.bar, 'target'] }, { over: { orient: 'v', marks: [0.5], target: true }, names: [...base.bar, 'mark@0.5', 'target'] },
    { over: { marks: [0.25, 0.75] }, names: [...base.bar, 'mark@0.25', 'mark@0.75'] }],
  repeater: [{ over: { item: 'row' } }, { over: { item: 'text' }, names: ['text'] }, { over: { item: 'bar' }, names: ['track', 'fill'] },
    { over: { item: 'light' }, names: lit }, { over: { layout: 'grid' } }, { over: { click: true } }],
  header: [{ over: { clock: true }, names: [...base.header, 'clock'] }, { over: { counts: false }, names: ['banner', 'title'] }],
  panel: [{ over: { title: '', unit: 'kPa' }, names: ['body', 'unit'] }],
  glyph: [{ over: { glyph: 'cog' } }, { over: { glyph: 'arrow' }, names: ['arrow'] }, { over: { glyph: 'check' }, names: ['line'] }, { over: { glyph: 'cross' }, names: ['line.1', 'line.2'] }],
  alert: [{ over: { row: false }, names: [...chip, 'message'] }], eventlog: [{ over: { time: true }, names: [...base.eventlog, 'time'] }],
  text: [{ over: { state: true } }, { over: { style: 'hero' } }],
  readoutrow: [{ over: { fmt2: '%.1f' }, names: [...base.readoutrow, 'reading2'] }],
  duct: [{ over: { dir: 'v' } }, { over: { period: 0 }, names: ['track'] }],
  gauge: [{ over: { ticks: 0 }, names: ['track', 'needle', 'hub', 'value', 'label'] },
    { over: { value: false }, names: ['track', 'tick@0', 'tick@0.25', 'tick@0.5', 'tick@0.75', 'tick@1', 'needle', 'hub', 'label'] }],
}
const cases: Case[] = Object.keys(WIDGETS).filter(type => !WIDGETS[type].native).flatMap(type => [
  { type, over: {}, names: base[type] }, ...(variants[type] ?? []).map(v => ({ type, over: v.over, names: v.names ?? base[type] })),
])
const partsOf = (exp: Expansion) => {
  expect(exp).toHaveProperty('parts')
  return (exp as Expansion & { parts: Record<string, number[]> }).parts
}

describe('semantic parts', () => {
  it.each(cases)('$type $over names every restylable node in both themes', ({ type, over, names }) => {
    for (const t of Object.values(THEMES)) {
      const m = WIDGETS[type], w = { type, uid: m.prefix + '1', params: sanitize(m, { ...m.defaults(t, TEST_CTX), ...over }, t) }
      const { exp } = expandRoot(w, t), parts = partsOf(exp), drawn: string[] = [], stack = exp.nodes.map((n, i) => ({ n, path: [i] }))
      expect(Object.getPrototypeOf(parts)).toBeNull()
      while (stack.length) {
        const { n, path } = stack.pop()!
        const painted = n.attrs.f !== undefined || n.attrs.s !== undefined || n.op === 'T'
        const plate = n.op === 'R' && (n.attrs.click !== undefined || n.attrs.press !== undefined)
        if (painted && !plate) drawn.push(path.join('.'))
        n.c?.forEach((n, i) => stack.push({ n, path: [...path, i] }))
      }
      const paths = Object.values(parts).map(p => p.join('.'))
      expect(paths.sort()).toEqual(drawn.sort())
      expect(new Set(paths).size).toBe(paths.length)
      expect(Object.keys(parts).sort()).toEqual([...names].sort())
      expect(Object.keys(parts).some(name => name.includes('~'))).toBe(false)
    }
  })
})

const lists: { type: string; list: string; prefix: string; rows: Params[]; want: string[] }[] = [
  { type: 'button', list: 'states', prefix: 'state', rows: [{ label: 'First', variant: 'secondary', key: 4 }, { label: 'Second', variant: 'primary', key: 9 }], want: ['state.9.body', 'state.9.label'] },
  { type: 'options', list: 'options', prefix: 'option', rows: [{ label: 'First', value: 0, key: 4 }, { label: 'Second', value: 1, key: 9 }], want: ['option.9.ring', 'option.9.body', 'option.9.label'] },
  { type: 'tabs', list: 'tabs', prefix: 'tab', rows: [{ label: 'First', page: 'p1', key: 4 }, { label: 'Second', page: 'p2', key: 9 }], want: ['tab.9.ring', 'tab.9.body', 'tab.9.label'] },
  { type: 'kvtable', list: 'rows', prefix: 'row', rows: [{ caption: 'First', fmt: '', state: false, key: 4 }, { caption: 'Second', fmt: '', state: false, key: 9 }], want: ['row.9', 'row.9.caption', 'row.9.value'] },
]
it.each(lists)('$type keeps the remaining item names after removal and parameter edits', ({ type, list, prefix, rows, want }) => {
  const w = instance(type, { [list]: rows, active: 'p2' }), before = partsOf(expandRoot(w, vanillaPlus).exp)
  const changed = { ...w, params: sanitize(WIDGETS[type], { ...w.params, [list]: rows.slice(1), x: 80, w: 500 }, vanillaPlus) }
  const after = partsOf(expandRoot(changed, vanillaPlus).exp)
  expect(Object.keys(before).filter(n => n.startsWith(prefix + '.9')).sort()).toEqual([...want].sort())
  expect(Object.keys(after).sort()).toEqual([...want].sort())
})

it.each(lists.slice(0, 3))('$type reads a legacy marker without keys and keeps its body attached', ({ type, list, rows }) => {
  const oldRows = rows.map(({ key: _, ...row }) => row), w = instance(type, { [list]: oldRows })
  const old = sceneOf(w), params = { ...w.params, [list]: oldRows }
  old.root[0].comments = [markerOf({ ...w, params })]
  const read = widgetOf(old.root[0], vanillaPlus)!
  expect((read.params[list] as Params[]).map(r => r.key)).toEqual([0, 1])
  const out = reassociate({ ...old, root: [], defs: [] }, old, vanillaPlus, undefined, true)
  expect(out.detached).toEqual([])
  expect(printChecked(out.scene)).toBe(printChecked(old))
})

it.each(lists)('$type assigns unique float32 keys even when the largest key cannot increment by one', ({ type, list, rows }) => {
  for (const key of [2 ** 24, Math.fround(3.4028235e38)]) {
    const w = instance(type, { [list]: rows.map(row => ({ ...row, key })) })
    const keys = (w.params[list] as Params[]).map(row => row.key)
    expect(keys[0]).toBe(key)
    expect(new Set(keys).size).toBe(2)
    expect(Object.keys(partsOf(expandRoot(w, vanillaPlus).exp)).filter(n => n.includes('body') || n.endsWith('.value'))).toHaveLength(2)
  }
})
