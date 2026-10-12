import { describe, expect, it } from 'vitest'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { parseSrc } from '../srctext/parse'
import { printChecked } from '../srctext/print'
import { expandRoot, reassociate } from './core'
import { holds, instance, printed, sceneOf } from './testing'
import type { Params } from './types'

const exp = (type: string, over: Params = {}) => expandRoot(instance(type, over), t).exp
const DROP = 'sh=[[0,2,2,0,#00000099]]'
const ST4 = (v: string) => `if(eq(${v},1),#7FD970,if(eq(${v},2),#F2B233,if(eq(${v},3),#F7777A,#A6A6B4)))`
/** A size that is negative, as a literal or as an expression's factor (`=clamp(…)*-5`). */
const NEGATIVE = / [wh]=-| [wh]==\S*\*-/

describe('Repeater', () => {
  it('keeps numeric value samples so the row preview follows its format', () => {
    const e = exp('repeater', { fmt: '%.0f' })
    expect(e.slots.find(s => s.slot === 'v')!.sample).toEqual([21.4, 19.8, 0, 101.3])
    expect(e.slots.find(s => s.slot === 'hasv')!.sample).toEqual([1, 1, 0, 1])
  })
  it('carries a snapped per-row value flag and gives the name both column widths', () => {
    const e = exp('repeater'), stack = [...e.nodes], labels = []
    while (stack.length) { const n = stack.pop()!; if (n.op === 'T') labels.push(n); stack.push(...n.c ?? []) }
    const name = labels.find(n => n.attrs.text === '$rep1_name[i]')!
    expect(e.slots.find(s => s.slot === 'hasv')).toMatchObject({ key: 'rep1_hasv', kind: 'numbers', snap: true, sample: [1, 1, 0, 1] })
    expect(typeof name.attrs.w).toBe('string')
    expect(name.attrs.w).toContain('$rep1_hasv[i]')
    expect(name.attrs.w).toContain('244')
    expect(name.attrs.w).toContain('384')
    expect(e.slots.find(s => s.slot === 'v')!.sample).toEqual([21.4, 19.8, 0, 101.3])
  })
  it('repeats a Readout-row item max times, each row shown while i < n', () => {
    const p = printed(instance('repeater', { x: 24, y: 24 }))
    expect(p).toContain('RP n=6 {')
    expect(p).toContain('G v==lt(i,$rep1_n) {')
    expect(p).toContain('R x=24.5 y==24+i*56+0.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1')
    expect(p).toContain('C v==eq($rep1_st[i],1) cx=47 cy==24+i*56+25 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]')
    expect(p).toContain(`T x=66 y==24+i*56 w==lerp(244,384,clamp(and($rep1_ready,eq($rep1_hasv[i],0)),0,1)) h=50 text="$rep1_name[i]" size=28 font="Barlow SemiBold" f=#FFFFFF ${DROP} valign=middle fit=ellipsis missing=""`)
    expect(p).toContain(`T v==not(and($rep1_ready,eq($rep1_hasv[i],0))) x=320 y==24+i*56 w=130 h=50 text="{$rep1_v[i]:%.1f}" size=34 font="Barlow SemiBold" f=#FFFFFF ${DROP} align=right valign=middle`)
    expect(exp('repeater').slots.map(s => [s.slot, s.kind, s.snap])).toEqual([['n', 'count', true], ['name', 'texts', true], ['v', 'texts', true], ['hasv', 'numbers', true], ['ready', 'flag', true], ['st', 'states', true]])
    expect(instance('repeater').params.h).toBe(5 * 56 + 50)
  })
  it('lays a grid out with one RP, and gives each row a plate on request', () => {
    const p = printed(instance('repeater', { x: 24, y: 24, layout: 'grid', cols: 2, item: 'light', pitch: 28, click: true }))
    expect(p).toContain('R id=rep1_r click=1 x==24+mod(i,2)*225 y==24+floor(i/2)*28 w=215 h=18')
    expect(p).toContain('C v==1-eq($rep1_st[i],1)-eq($rep1_st[i],2)-eq($rep1_st[i],3) cx==24+mod(i,2)*225+9 cy==24+floor(i/2)*28+9 rx=9 ry=9 f=#A6A6B4')
    expect(exp('repeater', { click: true }).clicks).toEqual([{ id: 'rep1_r', step: 'id:i' }])
    holds('repeater', {}, { item: 'text' }, { item: 'bar' }, { item: 'light', layout: 'grid', cols: 4, pitch: 28 }, { click: true, max: 30000 })
    expect(instance('repeater', { max: 30000 }).params.max).toBe(30000)
    expect(printed(instance('repeater', { max: 30000 })).filter(l => l.startsWith('RP n='))).toEqual(['RP n=30000 {'])
    expect([-1, 2.6, Infinity].map(max => instance('repeater', { max }).params.max)).toEqual([1, 3, 6])
  })
  it('draws the text and bar items, in a list and in a grid', () => {
    const text = `text="$rep1_t[i]" size=28 font="Barlow SemiBold" f=#FFFFFF ${DROP} valign=middle fit=ellipsis missing=""`
    expect(printed(instance('repeater', { x: 24, y: 24, item: 'text' }))).toContain(`T x=24 y==24+i*56 w=440 h=39.2 ${text}`)
    expect(printed(instance('repeater', { x: 24, y: 24, item: 'text', layout: 'grid', cols: 2 })))
      .toContain(`T x==24+mod(i,2)*225 y==24+floor(i/2)*56 w=215 h=39.2 ${text}`)
    expect(instance('repeater', { item: 'text' }).params.h).toBe(Math.fround(5 * 56 + 39.2))
    const bar = printed(instance('repeater', { x: 24, y: 24, item: 'bar' }))
    expect(bar).toContain('R x=24.5 y==24+i*56+0.5 w=439 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1')
    expect(bar).toContain(`R x=29 y==24+i*56+5 w==clamp($rep1_lvl[i],0,1)*430 h=20 rx=2 f==${ST4('$rep1_st[i]')}`)
    expect(printed(instance('repeater', { x: 24, y: 24, item: 'bar', layout: 'grid', cols: 2 })))
      .toContain(`R x==24+mod(i,2)*225+5 y==24+floor(i/2)*56+5 w==clamp($rep1_lvl[i],0,1)*205 h=20 rx=2 f==${ST4('$rep1_st[i]')}`)
    expect(exp('repeater', { item: 'bar' }).slots.map(s => [s.slot, s.kind, s.snap])).toEqual([['n', 'count', true], ['lvl', 'numbers', false], ['st', 'states', true]])
  })
  it('reads renamed keys and the row item’s format; an empty format reads %.1f', () => {
    const keys = { n: 'pumps', name: 'pump_names', v: 'pump_kpa', st: 'pump_st' }
    const p = printed(instance('repeater', { x: 24, y: 24, fmt: '%.0f kPa', keys })), all = p.join('\n')
    expect(p).toContain('G v==lt(i,$pumps) {')
    expect(all).toContain('text="$pump_names[i]"')
    expect(all).toContain('text="{$pump_kpa[i]:%.0f kPa}"')
    expect(all).toContain('C v==eq($pump_st[i],1)')
    expect(printed(instance('repeater', { fmt: '' })).join('\n')).toContain('text="{$rep1_v[i]:%.1f}"')
    holds('repeater', { keys }, { fmt: '%.0f kPa' }, { fmt: '' })
    // A ] in the item's format is literal since vector 0.11.97: the format follows the first ':' outside the index.
    expect(printed(instance('repeater', { fmt: '%.1f [kPa]' })).join('\n')).toContain('text="{$rep1_v[i]:%.1f [kPa]}"')
    holds('repeater', { fmt: '%.1f [kPa]' }, { fmt: '%d]', keys })
  })
  it('never draws a negative size, however narrow the row or many the columns', () => {
    for (const item of ['row', 'text', 'bar', 'light'])
      for (const over of [{ w: 1 }, { w: 5 }, { w: 1, layout: 'grid', cols: 2 }, { layout: 'grid', cols: 100 }] as Params[]) {
        const p = printed(instance('repeater', { item, click: true, ...over }))
        expect({ item, over, bad: p.filter(l => NEGATIVE.test(l)) }).toEqual({ item, over, bad: [] })
      }
    expect(printed(instance('repeater', { x: 24, y: 24, w: 1, layout: 'grid', cols: 2, item: 'text', click: true })))
      .toContain('R id=rep1_r click=1 x==24+mod(i,2)*5.5 y==24+floor(i/2)*56 w=0 h=39.2')
    expect(printed(instance('repeater', { item: 'bar', w: 5 })).join('\n')).toContain('w==clamp($rep1_lvl[i],0,1)*0 ')
    expect(printed(instance('repeater', { x: 24, y: 24, w: 100 })).join('\n')).toContain('T x=66 y==24+i*56 w==lerp(0,44,clamp(and($rep1_ready,eq($rep1_hasv[i],0)),0,1)) h=50 text="$rep1_name[i]"')
    expect(printed(instance('repeater', { x: 24, y: 24, w: 100 })).join('\n')).toContain('T v==not(and($rep1_ready,eq($rep1_hasv[i],0))) x=38 y==24+i*56 w=72 h=50 text="{$rep1_v[i]:%.1f}"')
  })
})

describe('Event log', () => {
  it('keeps large row counts in one RP and sanitizes wrong counts', () => {
    const log = instance('eventlog', { rows: 30000 })
    expect(log.params.rows).toBe(30000)
    expect(log.params.h).toBe(29999 * 56 + 50)
    expect(printed(log).filter(l => l.startsWith('RP n='))).toEqual(['RP n=30000 {'])
    expect([-1, 2.6, Infinity].map(rows => instance('eventlog', { rows }).params.rows)).toEqual([1, 3, 4])
  })
  it('draws an Alert row per entry, hidden where the class state reads 0', () => {
    const p = printed(instance('eventlog', { x: 24, y: 24 }))
    expect(p).toContain('RP n=4 {')
    expect(p).toContain('G v==gt($log1_k[i],0) {')
    expect(p).toContain('R x=38 y==24+i*56+7.6 w=86 h=34.8 rx=4 f==if(eq($log1_k[i],1),#7FD970,if(eq($log1_k[i],2),#F2B233,if(eq($log1_k[i],3),#F7777A,#A6A6B4)))')
    expect(p).toContain(`T x=138 y==24+i*56 w=312 h=50 text="$log1_m[i]" size=26 font="Barlow Medium" f=#FFFFFF ${DROP} valign=middle fit=ellipsis missing=""`)
    expect(exp('eventlog').slots.map(s => s.slot)).toEqual(['k', 'm'])
    expect(exp('eventlog', { time: true }).slots.map(s => s.slot)).toEqual(['k', 'm', 't'])
    expect(printed(instance('eventlog', { x: 24, y: 24, time: true })).join('\n')).toContain('T x=228 y==24+i*56 w=222 h=50 text="$log1_m[i]"')
    holds('eventlog', {}, { time: true }, { rows: 12, pitch: 50 })
  })
  it('follows its rows and pitch in height, and shows the time before the message when on', () => {
    expect(instance('eventlog').params.h).toBe(3 * 56 + 50)
    expect(instance('eventlog', { rows: 12, pitch: 50, h: 5 }).params.h).toBe(11 * 50 + 50)
    expect(printed(instance('eventlog', { x: 24, y: 24, pitch: 50 })))
      .toContain(`T x=138 y==24+i*50 w=312 h=50 text="$log1_m[i]" size=26 font="Barlow Medium" f=#FFFFFF ${DROP} valign=middle fit=ellipsis missing=""`)
    expect(printed(instance('eventlog', { x: 24, y: 24, time: true })))
      .toContain(`T x=138 y==24+i*56 w=80 h=50 text="$log1_t[i]" size=24 font="Barlow Medium" f=#A6A6B4 ${DROP} valign=middle fit=ellipsis missing=""`)
  })
})

describe('Vector glyph', () => {
  it('draws a cog of eight teeth around a hole', () => {
    const p = printed(instance('glyph', { x: 24, y: 24, w: 134 }))   // r = 134 / 2 / 1.34 = 50: every number exact in float32
    expect(p).toContain('G t=[91,91] {')
    expect(p).toContain('G r==i*45 {')
    expect(p).toContain('R x=-8.5 y=-67 w=17 h=26 rx=4 f=#C8C8D2')
    expect(p).toContain('P d="M50 0 A50 50 0 1 0 -50 0 A50 50 0 1 0 50 0 Z M20 0 A20 20 0 1 0 -20 0 A20 20 0 1 0 20 0 Z" fr=evenodd f=#C8C8D2')
  })
  it('draws an arrow, a check and a cross', () => {
    expect(printed(instance('glyph', { x: 24, y: 24, w: 20, glyph: 'arrow' }))).toContain('Y p=[24,24,44,34,24,44] f=#C8C8D2')
    expect(printed(instance('glyph', { x: 24, y: 24, w: 16, glyph: 'check' }))).toContain('L p=[26.4,32.8,30.4,36.8,37.6,27.2] s=#C8C8D2 sw=2 cap=round join=round')
    expect(printed(instance('glyph', { x: 24, y: 24, w: 16, glyph: 'cross' }))).toContain('L p=[36.8,27.2,27.2,36.8] s=#C8C8D2 sw=2 cap=round')
    expect(exp('glyph').slots).toEqual([])
    holds('glyph', {}, { glyph: 'arrow', dir: 'up' }, { glyph: 'arrow', dir: 'left' }, { glyph: 'check' }, { glyph: 'cross', ink: 'status-crit' })
  })
  it('points the arrow each way, stays square and takes its ink', () => {
    const arrow = (dir: string) => printed(instance('glyph', { x: 24, y: 24, w: 20, glyph: 'arrow', dir }))
    expect(arrow('up')).toContain('Y p=[34,24,44,44,24,44] f=#C8C8D2')
    expect(arrow('left')).toContain('Y p=[44,24,24,34,44,44] f=#C8C8D2')
    expect(arrow('down')).toContain('Y p=[24,24,44,24,34,44] f=#C8C8D2')
    expect(instance('glyph', { w: 40, h: 5 }).params.h).toBe(40)
    const p = printed(instance('glyph', { x: 24, y: 24, w: 134, ink: 'status-crit' }))
    expect(p.find(l => l.startsWith('P '))).toContain('f=#F7777A')
  })
})

describe('Round trip and number text', () => {
  it('keeps a widget dragged to -0 attached when its text is read back', () => {
    for (const w of [instance('duct', { x: -0 }), instance('glyph', { x: -0, glyph: 'arrow' }), instance('eventlog', { y: -0 }), instance('repeater', { x: -0, y: -0 })]) {
      const r = parseSrc(printChecked(sceneOf(w)))
      expect(r.errors).toEqual([])
      expect([w.type, reassociate({ ...r.scene!, root: [] }, r.scene!, t).detached]).toEqual([w.type, []])
    }
  })
  it('writes numbers inside expressions without an exponent (the mod reads digits and a point)', () => {
    expect(printed(instance('repeater', { x: 24, y: 1e-7, pitch: 1e-7 })).join('\n')).toContain('y==0.0000001+i*0.0000001')
    expect(printed(instance('eventlog', { y: 1e30 })).join('\n')).toContain('y==1000000000000000000000000000000+i*56')
    holds('repeater', { y: 1e-7, pitch: 1e-7 })
  })
})


it('list samples use neutral words', () => {
  expect(exp('eventlog').slots.find(s => s.slot === 'm')!.sample).toEqual(['Message 1', 'Message 2', 'Message 3'])
  for (const item of ['row', 'text'])
    expect(exp('repeater', { item }).slots.find(s => s.slot === (item === 'row' ? 'name' : 't'))!.sample).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 4'])
})

it("the cog's hole is a hole", () => {
  const p = printed(instance('glyph', { w: 134 }))
  const paths = p.filter(l => l.startsWith('P '))
  expect(paths).toHaveLength(1)
  expect(paths[0]).toContain('fr=evenodd')
  expect(paths[0].match(/Z/g)).toHaveLength(2)
  expect(p.some(l => l.startsWith('C ') || l.includes('f=#1D1D23'))).toBe(false)
  expect(instance('glyph', { hole: 'surface-well' }).params).toHaveProperty('hole', 'surface-well')
  holds('glyph', { glyph: 'cog' })
})
