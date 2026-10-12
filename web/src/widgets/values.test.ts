import { describe, expect, it } from 'vitest'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { expandRoot } from './core'
import { holds, instance, printed } from './testing'
import type { Params } from './types'

const slots = (type: string, over: Params = {}) => expandRoot(instance(type, over), t).exp.slots
const ST4 = (k: string) => `if(eq($${k},1),#7FD970,if(eq($${k},2),#F2B233,if(eq($${k},3),#F7777A,#A6A6B4)))`
const DROP = 'sh=[[0,2,2,0,#00000099]]'

describe('Text', () => {
  it('draws one label in its style; a literal follows the style’s case, and digits become a template', () => {
    expect(printed(instance('text', { x: 24, y: 104, text: 'Oxygen' })))
      .toContain(`T x=24 y=104 w=300 h=39.2 text=Oxygen size=28 font="Barlow SemiBold" f=#FFFFFF ${DROP} valign=middle fit=ellipsis`)
    expect(printed(instance('text', { style: 'panel-title', text: 'Air' })).join('\n')).toContain('text=AIR')
    expect(printed(instance('text', { text: '12' })).join('\n')).toContain('text="{=12:%.0f}"')
  })
  it('reads the names in its template: a number or a string where a label prints it, a number in an expression; inks by state on request', () => {
    // The mod prints a string datum as it is and a number through the format (BindText, BindTemplate): either may come.
    expect(slots('text', { text: '{$o2_kpa:%.1f} kPa / {$o2_pct:%.0f}' }).map(s => [s.key, s.kind, s.snap])).toEqual([['o2_kpa', 'text', true], ['o2_pct', 'text', true]])
    expect(slots('text', { text: '$room' })).toEqual([{ slot: '$room', key: 'room', kind: 'text', snap: true, sample: 'Text' }])
    expect(slots('text', { text: '{$a} and {=$a*2} of {$rows[$k]}' }).map(s => [s.key, s.kind])).toEqual([['a', 'number'], ['rows', 'texts'], ['k', 'number']])
    expect(printed(instance('text', { text: '$room', state: true })).join('\n')).toContain('f==if(eq($txt1_st,2),#F2B233,if(eq($txt1_st,3),#F7777A,#FFFFFF))')
    expect(slots('text', { text: '{=$a*2:%.0f}' }).map(s => s.key)).toEqual(['a'])
    expect(slots('text', { text: 'Pump $name here' })).toEqual([])
    expect(printed(instance('text', { style: 'panel-title', text: 'Pump $name here' })).join('\n')).toContain('text="PUMP $NAME HERE"')
    holds('text', {}, { text: '{$o2_kpa:%.1f} kPa' }, { text: '$room', state: true, align: 'right', style: 'value-lg' },
      { text: '{=$a*2:%.0f}' }, { text: 'Pump $name here' })
  })
  it('binds a leading $ whole, never recased, and declares every name the mod reads from any template (final-wave ruling 2)', () => {
    // The mod binds everything after a leading $ as one name (SceneModel.cs, the T's text): `$room kPa` reads "room kPa".
    expect(printed(instance('text', { style: 'panel-title', text: '$room' })).join('\n')).toContain('text=$room size=26')
    const read = (text: string) => slots('text', { text }).map(s => s.key)
    for (const [text, names] of [['$room kPa', ['room kPa']], ['$rows[1]', ['rows']], ['$a.b', ['a.b']], ['${a}', ['{a}']], ['$a]', ['a]']],
      ['$5 off', ['5 off']], ['$constructor', ['constructor']], ['{$a b} kPa', ['a b']], ['{$a.b:%.1f}', ['a.b']], ['{$__proto__}', ['__proto__']],
      ['$x\u{1D49C}', ['x\u{1D49C}']], ['$', []]] as const) {
      expect(instance('text', { style: 'panel-title', text }).params.text).toBe(text)
      expect(read(text)).toEqual(names)
    }
    // An item of a list draws nothing while there is none (missing=""), as every list label does (E12).
    expect(printed(instance('text', { text: '$rows[1]' })).join('\n')).toContain('missing=""')
    expect(slots('text', { text: '$rows[1]' })).toEqual([{ slot: '$rows', key: 'rows', kind: 'texts', snap: true, sample: ['Text 1', 'Text 2', 'Text 3', 'Text 4'] }])
    expect(slots('text', { text: '$température' })).toEqual([{ slot: '$température', key: 'température', kind: 'text', snap: true, sample: 'Text' }])
    expect(slots('text', { text: '{$débit_2:%.1f} m³' }).map(s => s.key)).toEqual(['débit_2'])
    holds('text', { style: 'panel-title', text: '$room kPa' }, { text: '$rows[1]' }, { text: '$a.b' }, { text: '${a}' }, { text: '$a]' },
      { text: '$5 off' }, { text: '$room', style: 'panel-title' })
  })
  it('gives a name its state key reads to the state slot alone', () => {
    expect(slots('text', { text: '{$txt1_st}', state: true }).map(s => [s.key, s.kind])).toEqual([['txt1_st', 'state']])
    // A template name never shares a slot with the state: `{$st}` is the `$st` slot, apart from the state's `st`.
    expect(slots('text', { text: '$st', state: true }).map(s => [s.slot, s.key, s.kind])).toEqual([['$st', 'st', 'text'], ['st', 'txt1_st', 'state']])
    expect(slots('text', { text: '{$st} {$pump}', state: true, keys: { st: 'pump' } }).map(s => [s.slot, s.key])).toEqual([['$st', 'st'], ['st', 'pump']])
    holds('text', { text: '{$txt1_st}', state: true }, { text: '$o2', state: true, keys: { st: 'o2' } })
  })
  it('aligns as asked; keeps its box one line of its style tall', () => {
    expect(printed(instance('text', { text: 'Oxygen', align: 'center' })).join('\n')).toContain(`f=#FFFFFF ${DROP} align=center valign=middle fit=ellipsis`)
    expect(instance('text', { style: 'hero', h: 10 }).params.h).toBeCloseTo(218.4, 3)
  })
})

describe('Bar', () => {
  it('draws a bar: a well, and a fill 5 inside it in the state colour, clamped', () => {
    const p = printed(instance('bar', { x: 24, y: 300 }))
    expect(p).toContain('R x=24.5 y=300.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1')
    expect(p).toContain(`R x=29 y=305 w==clamp($bar1_lvl,0,1)*390 h=20 rx=2 f==${ST4('bar1_st')}`)
    expect(slots('bar').map(s => [s.key, s.kind, s.snap, s.sample])).toEqual([['bar1_lvl', 'number', false, 0.62], ['bar1_st', 'state', true, 1]])
  })
  it('adds literal marks and a target; auto colours from the level alone; a floor keeps a sliver', () => {
    const p = printed(instance('bar', { x: 24, y: 300, marks: [0.75], target: true, stateMode: 'auto', floor: 0.05 }))
    expect(p).toContain('R x=321 y=303 w=1 h=24 f=#8E8E9E')
    expect(p).toContain('R x==28+clamp($bar1_tgt,0,1)*390 y=301 w=2 h=28 f=#FFFFFF')
    expect(p).toContain('R x=29 y=305 w==clamp($bar1_lvl,0.05,1)*390 h=20 rx=2 f==if(lt($bar1_lvl,0.1),#F7777A,if(lt($bar1_lvl,0.25),#F2B233,#7FD970))')
    expect(slots('bar', { stateMode: 'ok' }).map(s => s.slot)).toEqual(['lvl'])
  })
  it('stands vertical, filling from the bottom, with its marks and target across it; cells are horizontal only', () => {
    const fill = `R x=29 y==295-clamp($bar1_lvl,0,1)*190 w=20 h==clamp($bar1_lvl,0,1)*190 rx=2 f==${ST4('bar1_st')}`
    expect(printed(instance('bar', { x: 24, y: 100, w: 30, h: 200, orient: 'v' }))).toContain(fill)
    const p = printed(instance('bar', { x: 24, y: 100, w: 30, h: 200, orient: 'v', marks: [0.5], target: true, cells: 4 }))
    expect(p).toContain(fill)
    expect(p).toContain('R x=27 y=199.5 w=24 h=1 f=#8E8E9E')
    expect(p).toContain('R x=25 y==294-clamp($bar1_tgt,0,1)*190 w=28 h=2 f=#FFFFFF')
    expect(p.join('\n')).not.toContain('RP ')
    expect(slots('bar', { orient: 'v', cells: 4, target: true }).map(s => s.slot)).toEqual(['lvl', 'st', 'tgt'])
  })
  it('splits into cells, each filled from the bottom as the level passes it', () => {
    const p = printed(instance('bar', { x: 24, y: 300, w: 400, h: 40, cells: 4 }))
    expect(p).toContain('RP n=4 {')
    expect(p).toContain('R x==24+i*101+0.5 y=300.5 w=96 h=39 rx=3.5 f=#111116 s=#5A5A69 sw=1')
    // Each cell's fill sits 5 inside it (its 1-unit border and the 4-unit inset), as the h and v bars' does.
    expect(p).toContain(`R x==29+i*101 y==335-30*clamp(clamp($bar1_lvl,0,1)*4-i,0,1) w=87 h==30*clamp(clamp($bar1_lvl,0,1)*4-i,0,1) rx=2 f==${ST4('bar1_st')}`)
    holds('bar', {}, { orient: 'v', w: 30, h: 200, marks: [0.5], target: true }, { cells: 8, h: 40, stateMode: 'auto' }, { stateMode: 'ok', floor: 0.1 },
      { keys: { lvl: 'o2_lvl', st: 'o2_st' } })
  })
  it('takes any size: thinner than its inset, it draws an empty fill; cells have no count cap', () => {
    expect(printed(instance('bar', { x: 0, y: 0, w: 4, h: 4 }))).toContain('R x=5 y=5 w==clamp($bar1_lvl,0,1)*0 h=0 rx=2 f==' + ST4('bar1_st'))
    const cells = instance('bar', { cells: 30000 })
    expect(cells.params.cells).toBe(30000)
    expect(printed(cells).filter(l => l.startsWith('RP n='))).toEqual(['RP n=30000 {'])
    expect([-1, 2.6, Infinity].map(cells => instance('bar', { cells }).params.cells)).toEqual([0, 3, 0])
    expect(printed(instance('bar', { floor: 1e-7 })).join('\n')).toContain('clamp($bar1_lvl,0.0000001,1)')   // digits and . only
    holds('bar', { w: 4, h: 4 }, { orient: 'v', w: 3, h: 3, marks: [0.5], target: true }, { cells: 30, w: 40, h: 6 })
  })
})

describe('Readout row', () => {
  it('draws a raised row, a light, the name, and right-aligned readings inked by state', () => {
    const p = printed(instance('readoutrow', { x: 24, y: 104 }))
    expect(p).toContain('R x=24.5 y=104.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1')
    expect(p).toContain('C v==eq($row1_st,1) cx=47 cy=129 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]')
    expect(p).toContain(`T x=66 y=104 w=264 h=50 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF ${DROP} valign=middle fit=ellipsis`)
    expect(p).toContain(`T x=340 y=104 w=110 h=50 text="{$row1_r1:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($row1_st,2),#F2B233,if(eq($row1_st,3),#F7777A,#FFFFFF)) ${DROP} align=right valign=middle fit=ellipsis`)
    expect(p).toContain('GL id=theme_row units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#3B3B45],[1,#32323A]]')
  })
  it('adds a second reading in reading style; the first moves left of it', () => {
    const p = printed(instance('readoutrow', { x: 24, y: 104, fmt2: '%.0f' }))
    expect(p).toContain(`T x=360 y=104 w=90 h=50 text="{$row1_r2:%.0f}" size=28 font="Barlow Medium" f==if(eq($row1_st,2),#F2B233,if(eq($row1_st,3),#F7777A,#C8C8D2)) ${DROP} align=right valign=middle fit=ellipsis`)
    expect(p.join('\n')).toContain('T x=236 y=104 w=110 h=50 text="{$row1_r1:%.1f}"')
    holds('readoutrow', {}, { fmt2: '%.0f', name: '12' }, { keys: { st: 'o2_st', r1: 'o2_kpa' } })
  })
  it('reads an empty first format as %.1f; a format holding ] is kept, literal in its placeholder since vector 0.11.97', () => {
    expect(printed(instance('readoutrow', { fmt1: '' })).join('\n')).toContain('text="{$row1_r1:%.1f}"')
    const w = instance('readoutrow', { fmt1: '%.1f [kPa]', fmt2: '[%d]' })
    expect(w.params).toMatchObject({ fmt1: '%.1f [kPa]', fmt2: '[%d]' })
    expect(printed(w).join('\n')).toContain('text="{$row1_r1:%.1f [kPa]}"')
    holds('readoutrow', { fmt1: '%.1f [kPa]', fmt2: '[%d]' }, { fmt1: '%.1f]', keys: { r1: 'o2_kpa' } })
  })
})

describe('Readout tile', () => {
  it('hero: the figure right-aligned in its slot, the 64-unit unit beside it, the bar under it, then the status and a supporting value', () => {
    const p = printed(instance('readout', { x: 24, y: 120, unit: '%' }))
    expect(p).toContain('R x=24.5 y=297.7 w=344 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1')
    expect(p).toContain(`R x=29 y=302.2 w==clamp($ro1_lvl,0,1)*335 h=20 rx=2 f==${ST4('ro1_st')}`)
    expect(p).toContain(`T x=24 y=120 w=273 h=187.2 text="{$ro1_v:%.0f}" size=156 font="Barlow Condensed Bold" f=#FFFFFF ${DROP} align=right valign=middle`)
    expect(p).toContain(`T x=305 y=205.5 w=64 h=89.6 text=% size=64 font="Barlow Medium" f=#A6A6B4 ${DROP} valign=middle`)
    expect(p).toContain(`T x=24 y=339 w=345 h=39.2 text=$ro1_status size=28 font="Barlow SemiBold" f==${ST4('ro1_st')} ${DROP} valign=middle fit=ellipsis`)
    expect(p).toContain(`T x=24 y=339 w=345 h=39.2 text="{$ro1_sub:%.1f}" size=28 font="Barlow Medium" f=#C8C8D2 ${DROP} align=right valign=middle`)
    expect(slots('readout').map(s => s.slot)).toEqual(['v', 'lvl', 'st', 'status', 'sub'])
  })
  it('KPI and compact, from the same params', () => {
    const k = printed(instance('readout', { x: 24, y: 24, variant: 'kpi', unit: '%' }))
    expect(k).toContain(`R x=24 y=109 w==clamp($ro1_lvl,0,1)*345 h=3 f==${ST4('ro1_st')}`)
    expect(k).toContain(`T x=24 y=57.6 w=285 h=47.6 text="{$ro1_v:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF ${DROP} valign=middle`)
    expect(slots('readout', { variant: 'compact' }).map(s => s.slot)).toEqual(['st', 'status'])
    expect(instance('readout', { variant: 'compact' }).params.h).toBeCloseTo(39.2, 3)
    expect(k).toContain(`T x=309 y=64.6 w=60 h=33.6 text=% size=24 font="Barlow Medium" f=#A6A6B4 ${DROP} align=right valign=middle`)
    const c = printed(instance('readout', { x: 24, y: 24, variant: 'compact' }))
    expect(c).toContain('C v==eq($ro1_st,1) cx=33 cy=43.6 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]')
    expect(c).toContain(`T x=52 y=24 w=187 h=39.2 text=Label size=28 font="Barlow SemiBold" f=#FFFFFF ${DROP} valign=middle fit=ellipsis`)
    expect(c).toContain(`T x=249 y=24 w=120 h=39.2 text=$ro1_status size=28 font="Barlow SemiBold" f==${ST4('ro1_st')} ${DROP} align=right valign=middle fit=ellipsis`)
    holds('readout', {}, { bar: false, subFmt: '' }, { variant: 'kpi' }, { variant: 'kpi', bar: false, unit: '' }, { variant: 'compact', caption: 'Pump B' })
  })
  it('hero without a unit keeps the figure’s slot; an empty format reads as %.0f, one holding ] is kept', () => {
    const p = printed(instance('readout', { x: 24, y: 120, unit: '', fmt: '' }))
    expect(p).toContain(`T x=24 y=120 w=273 h=187.2 text="{$ro1_v:%.0f}" size=156 font="Barlow Condensed Bold" f=#FFFFFF ${DROP} align=right valign=middle`)
    expect(p.filter(l => l.includes('size=64'))).toEqual([])
    expect(instance('readout', { fmt: '%.0f [%]', subFmt: '%d]' }).params).toMatchObject({ fmt: '%.0f [%]', subFmt: '%d]' })
    holds('readout', { unit: '', fmt: '' }, { fmt: '%.0f [%]', subFmt: '%d]' }, { variant: 'compact', fmt: '[%.1f]' }, { variant: 'kpi', fmt: '%.0f]' })
  })
  it('takes any width: narrower than its unit slot or its bar’s inset, it draws empty, never a negative size', () => {
    for (const variant of ['hero', 'kpi', 'compact']) expect(printed(instance('readout', { w: 1, variant })).join('\n')).not.toMatch(/ w=-|\*-/)
    holds('readout', { w: 1 }, { w: 1, variant: 'kpi' }, { w: 1, variant: 'compact' })
  })
})


it('values use neutral defaults', () => {
  expect(instance('readout').params).toMatchObject({ caption: 'Label', unit: '' })
  expect(instance('readoutrow').params.name).toBe('Label')
  for (const variant of ['hero', 'compact'])
    expect(slots('readout', { variant }).find(s => s.slot === 'status')!.sample).toBe('Status')
})

it('Bar edges are configurable and ordered within 0 to 1', () => {
  expect(instance('bar').params).toMatchObject({ critBelow: Math.fround(0.1), warnBelow: 0.25 })
  const p = printed(instance('bar', { stateMode: 'auto', critBelow: 0.2, warnBelow: 0.5 })).join('\n')
  expect(p).toContain('lt($bar1_lvl,0.2)')
  expect(p).toContain('lt($bar1_lvl,0.5)')
  expect(instance('bar', { critBelow: 0.6, warnBelow: 0.3 }).params).toMatchObject({ critBelow: Math.fround(0.6), warnBelow: Math.fround(0.6) })
  expect(instance('bar', { critBelow: -1, warnBelow: 2 }).params).toMatchObject({ critBelow: 0, warnBelow: 1 })
  holds('bar', { stateMode: 'auto', critBelow: 0.2, warnBelow: 0.5 })
})
