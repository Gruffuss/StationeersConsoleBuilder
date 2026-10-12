import { describe, expect, it } from 'vitest'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { parseSrc } from '../srctext/parse'
import { WIDGETS } from './registry'
import { TEST_CTX } from './testing'
import { reassociate, widgetOf, expandRoot } from './core'
import { holds, instance, printed } from './testing'
import type { Params } from './types'

const slots = (type: string, over: Params = {}) => expandRoot(instance(type, over), t).exp.slots
const DROP = 'sh=[[0,2,2,0,#00000099]]'

describe('Panel', () => {
  it('draws a sunk well with its title and unit caption', () => {
    const p = printed(instance('panel', { x: 24, y: 104, unit: 'MPa' }))
    expect(p).toContain('R x=24.5 y=104.5 w=439 h=299 rx=9.5 f=#1D1D23 s=#5A5A69 sw=1 sh=[[0,2,6,0,#0000008C,inset]]')
    expect(p).toContain(`T x=38 y=114 w=322 h=36.4 text=TITLE size=26 font="Barlow Condensed Bold" cspace=5.77 f=#A6A6B4 ${DROP} valign=middle fit=ellipsis`)
    expect(p).toContain(`T x=370 y=115.4 w=80 h=33.6 text=MPa size=24 font="Barlow Medium" f=#A6A6B4 ${DROP} align=right valign=middle`)
    expect(slots('panel')).toEqual([])
  })
  it('has no title label when empty', () => {
    expect(printed(instance('panel', { title: '' })).filter(l => l.startsWith('T '))).toEqual([])
    holds('panel', {}, { title: '', unit: 'kPa' })
  })
})

describe('Header bar', () => {
  it('draws the brand banner with its outline inside the box, the title, the counts and the clock in fixed slots', () => {
    const p = printed(instance('header', { x: 24, y: 24, w: 1392, clock: true }))
    expect(p).toContain('R x=25.5 y=25.5 w=1389 h=61 rx=12.5 f=@theme_brand s=#FF772D sw=3')
    expect(p).toContain('G v==gt($hdr1_crit,0) {')
    expect(p).toContain('C cx=1202 cy=56 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]')
    expect(p).toContain(`T x=1221 y=39 w=47 h=34 text="{$hdr1_crit:%.0f}" size=28 font="Barlow SemiBold" f=#FFFFFF ${DROP} align=right valign=middle`)
    expect(p).toContain('C cx=1111 cy=56 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]')
    expect(p).toContain(`T x=42 y=30 w=1034 h=52 text=TITLE size=36 font="Barlow Condensed Bold" cspace=4.17 f=#FFFFFF ${DROP} valign=middle fit=ellipsis`)
    expect(p).toContain(`T x=1278 y=30 w=120 h=52 text=$hdr1_clock size=28 font="Barlow Condensed SemiBold" cspace=3.57 f=#FFFFFF ${DROP} align=right valign=middle fit=ellipsis`)
    expect(slots('header', { clock: true }).map(s => [s.slot, s.kind, s.sample])).toEqual([['crit', 'count', 1], ['warn', 'count', 2], ['clock', 'text', '14:06']])
  })
  it('is 64 tall by default and any height its title fits, and leaves the clock off by default', () => {
    expect(instance('header').params).toMatchObject({ h: 64, clock: false, w: 432 })
    expect(instance('header', { h: 10 }).params.h).toBeCloseTo(62.4, 3)
    expect(printed(instance('header', { x: 24, y: 24, h: 100 }))).toContain(`T x=42 y=30 w=204 h=88 text=TITLE size=36 font="Barlow Condensed Bold" cspace=4.17 f=#FFFFFF ${DROP} valign=middle fit=ellipsis`)
    holds('header', {}, { clock: true, w: 1392 }, { counts: false }, { title: '12' }, { h: 62.4 }, { h: 120, clock: true, w: 1392 })
  })
  it('draws a bar narrower or lower than its outline with an empty inside, never a negative width or height', () => {
    expect(printed(instance('header', { x: 24, y: 24, w: 1 }))).toContain('R x=25.5 y=25.5 w=0 h=61 rx=12.5 f=@theme_brand s=#FF772D sw=3')
    expect(printed(instance('header', { x: 24, y: 24, h: 0, title: '', clock: false }))).toContain('R x=25.5 y=25.5 w=429 h=0 rx=12.5 f=@theme_brand s=#FF772D sw=3')
    holds('header', { w: 1 }, { w: 1, clock: true })
  })
  it('leaves out the counts, the clock or an empty title when asked, and takes renamed data names', () => {
    const bare = printed(instance('header', { x: 24, y: 24, w: 1392, clock: true, counts: false }))
    expect(bare.filter(l => /^(G v=|C )/.test(l))).toEqual([])
    expect(bare.join('\n')).not.toContain('_crit')
    expect(slots('header', { clock: true, counts: false }).map(s => s.slot)).toEqual(['clock'])
    const noClock = printed(instance('header', { x: 24, y: 24, w: 1392 }))
    expect(noClock.join('\n')).not.toContain('$hdr1_clock')
    expect(slots('header').map(s => s.slot)).toEqual(['crit', 'warn'])
    expect(printed(instance('header', { title: '' })).filter(l => l.includes('Barlow Condensed Bold'))).toEqual([])
    const renamed = { clock: true, w: 1392, keys: { crit: 'alarms', clock: 'time' } }
    const p = printed(instance('header', renamed)).join('\n')
    expect(p).toContain('G v==gt($alarms,0) {')
    expect(p).toContain('text="{$alarms:%.0f}"')
    expect(p).toContain('text=$time ')
    expect(slots('header', renamed).map(s => s.key)).toEqual(['alarms', 'hdr1_warn', 'time'])
    holds('header', renamed, { title: '' })
  })
})

describe('Alert', () => {
  it('hides at state 0; draws the raised row, the chip and its word, and the message', () => {
    const p = printed(instance('alert', { x: 24, y: 400 }))
    expect(p).toContain('G v==gt($al1_st,0) {')
    expect(p).toContain('R x=24.5 y=400.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1')
    expect(p).toContain('R x=38 y=407.6 w=86 h=34.8 rx=4 f==if(eq($al1_st,1),#7FD970,if(eq($al1_st,2),#F2B233,if(eq($al1_st,3),#F7777A,#A6A6B4)))')
    expect(p).toContain('T v==eq($al1_st,3) x=38 y=407.6 w=86 h=34.8 text=CRIT size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle')
    expect(p).toContain(`T x=138 y=404 w=312 h=42 text=$al1_msg size=26 font="Barlow Medium" f=#FFFFFF ${DROP} valign=middle fit=ellipsis`)
    expect(slots('alert').map(s => [s.slot, s.kind, s.sample])).toEqual([['st', 'state', 2], ['msg', 'text', 'Message']])
    holds('alert', {}, { row: false }, { keys: { st: 'a_st', msg: 'a_msg' } }, { h: 36.4 })
    expect(printed(instance('alert', { x: 24, y: 400, h: 40 })).join('\n')).toContain('T x=138 y=400 w=312 h=40 text=$al1_msg')
    const bare = printed(instance('alert', { x: 24, y: 400, row: false }))
    expect(bare.filter(l => l.includes('@theme_row'))).toEqual([])
    expect(bare).toContain('R x=38 y=407.6 w=86 h=34.8 rx=4 f==if(eq($al1_st,1),#7FD970,if(eq($al1_st,2),#F2B233,if(eq($al1_st,3),#F7777A,#A6A6B4)))')
  })
})

describe('Key–value table', () => {
  it('unrolls one raised row per entry: caption, then a number or a string in a fixed right-aligned slot', () => {
    const p = printed(instance('kvtable', { x: 24, y: 24 }))
    expect(p).toContain('R x=24.5 y=24.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1')
    expect(p).toContain(`T x=38 y=24 w=226 h=50 text="Label 1" size=28 font="Barlow SemiBold" f=#FFFFFF ${DROP} valign=middle fit=ellipsis`)
    expect(p).toContain(`T x=274 y=24 w=176 h=50 text="{$kv1_v0:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($kv1_s0,2),#F2B233,if(eq($kv1_s0,3),#F7777A,#FFFFFF)) ${DROP} align=right valign=middle fit=ellipsis`)
    expect(p).toContain(`T x=274 y=136 w=176 h=50 text=$kv1_v2 size=34 font="Barlow SemiBold" f=#FFFFFF ${DROP} align=right valign=middle fit=ellipsis`)
    expect(slots('kvtable').map(s => [s.slot, s.kind, s.sample])).toEqual([['v0', 'text', 21.4], ['s0', 'state', 1], ['v1', 'text', 21.4], ['v2', 'text', 'Auto']])
    expect(instance('kvtable').params.h).toBe(162)
  })
  it('takes any number of rows, and none from an outside marker that are not rows', () => {
    const many = Array.from({ length: 40 }, (_, k) => ({ caption: `Row ${k}`, fmt: '%.0f', state: false, key: k }))
    expect(instance('kvtable', { rows: many }).params.h).toBe(40 * 50 + 39 * 6)
    expect((instance('kvtable', { rows: [1, 'x', { caption: 'Only' }] }).params.rows as Params[])).toEqual([{ caption: 'Only', fmt: '%.1f', state: true, key: 0 }])
    holds('kvtable', {}, { rows: [{ caption: '12', fmt: '', state: true }] }, { rows: many, valueW: 120, gap: 0 })
    // A ] in a row's format is literal since vector 0.11.97, and the row keeps its own data name.
    const bracket = instance('kvtable', { rows: [{ caption: 'Pressure', fmt: '%.1f [kPa]', state: true, key: 0 }] })
    expect(printed(bracket).join('\n')).toContain('text="{$kv1_v0:%.1f [kPa]}"')
    holds('kvtable', { rows: [{ caption: 'Pressure', fmt: '%.1f [kPa]', state: true, key: 0 }, { caption: 'Mode', fmt: '%d]', state: false, key: 1 }] })
  })
  it('takes renamed data names, and draws no caption for an empty one', () => {
    const renamed = { keys: { v0: 'press', s0: 'press_st', v2: 'mode' } }
    const p = printed(instance('kvtable', renamed)).join('\n')
    expect(p).toContain('text="{$press:%.1f}" size=34 font="Barlow SemiBold" f==if(eq($press_st,2),#F2B233,if(eq($press_st,3),#F7777A,#FFFFFF))')
    expect(p).toContain('text=$mode ')
    expect(slots('kvtable', renamed).map(s => s.key)).toEqual(['press', 'press_st', 'kv1_v1', 'mode'])
    const blank = { rows: [{ caption: '', fmt: '%.1f', state: false }] }
    expect(printed(instance('kvtable', blank)).filter(l => l.startsWith('T '))).toHaveLength(1)
    holds('kvtable', renamed, blank)
  })
})


it('the Panel has no look or marks', () => {
  expect(WIDGETS.panel.params.map(p => p.key)).not.toContain('look')
  expect(WIDGETS.panel.params.map(p => p.key)).not.toContain('marks')
  const scene = parseSrc("SCENE w=480 h=480 fit=contain\n# widget panel pnl1 {\"x\":24,\"y\":24,\"w\":440,\"h\":300,\"title\":\"Atmosphere\",\"unit\":\"\",\"look\":\"hairline\",\"marks\":true}\nG id=pnl1 {\n    R x=24 y=24 w=440 h=1 f=#5A5A69\n    R x=24 y=323 w=440 h=1 f=#5A5A69\n    R x=24 y=25 w=1 h=298 f=#5A5A69\n    R x=463 y=25 w=1 h=298 f=#5A5A69\n    R x=23.5 y=17.5 w=1 h=13 f=#8E8E9E\n    R x=17.5 y=23.5 w=13 h=1 f=#8E8E9E\n    R x=463.5 y=17.5 w=1 h=13 f=#8E8E9E\n    R x=457.5 y=23.5 w=13 h=1 f=#8E8E9E\n    R x=23.5 y=317.5 w=1 h=13 f=#8E8E9E\n    R x=17.5 y=323.5 w=13 h=1 f=#8E8E9E\n    R x=463.5 y=317.5 w=1 h=13 f=#8E8E9E\n    R x=457.5 y=323.5 w=13 h=1 f=#8E8E9E\n    T x=38 y=34 w=412 h=36.4 text=TITLE size=26 font=\"Barlow Condensed Bold\" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis\n}").scene!
  const w = widgetOf(scene.root[0], t)!
  expect(w.params).not.toHaveProperty('look')
  expect(w.params).not.toHaveProperty('marks')
})

it('a saved hairline panel keeps drawing', () => {
  const scene = parseSrc("SCENE w=480 h=480 fit=contain\n# widget panel pnl1 {\"x\":24,\"y\":24,\"w\":440,\"h\":300,\"title\":\"Atmosphere\",\"unit\":\"\",\"look\":\"hairline\",\"marks\":true}\nG id=pnl1 {\n    R x=24 y=24 w=440 h=1 f=#5A5A69\n    R x=24 y=323 w=440 h=1 f=#5A5A69\n    R x=24 y=25 w=1 h=298 f=#5A5A69\n    R x=463 y=25 w=1 h=298 f=#5A5A69\n    R x=23.5 y=17.5 w=1 h=13 f=#8E8E9E\n    R x=17.5 y=23.5 w=13 h=1 f=#8E8E9E\n    R x=463.5 y=17.5 w=1 h=13 f=#8E8E9E\n    R x=457.5 y=23.5 w=13 h=1 f=#8E8E9E\n    R x=23.5 y=317.5 w=1 h=13 f=#8E8E9E\n    R x=17.5 y=323.5 w=13 h=1 f=#8E8E9E\n    R x=463.5 y=317.5 w=1 h=13 f=#8E8E9E\n    R x=457.5 y=323.5 w=13 h=1 f=#8E8E9E\n    T x=38 y=34 w=412 h=36.4 text=TITLE size=26 font=\"Barlow Condensed Bold\" cspace=5.77 f=#A6A6B4 sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis\n}").scene!
  const r = reassociate({ ...scene, root: [] }, scene, t, undefined, true)
  expect(r.detached).toEqual(['pnl1'])
  expect(r.scene.root[0].c).toEqual(scene.root[0].c)
  expect(widgetOf(r.scene.root[0], t)).toBeNull()
  const p = newProject()
  p.theme = t.id
  p.pages[0].scene = scene
  const loaded = reducer(initialState(), { type: 'loadProject', project: p })
  expect(loaded.notice).toContain('detached pnl1:')
  expect(loaded.project.pages[0].scene.root[0].c).toEqual(scene.root[0].c)
})

it('chrome defaults use neutral words and no clock at any width', () => {
  expect(instance('panel').params.title).toBe('Title')
  expect(WIDGETS.header.defaults(t, { ...TEST_CTX, size: { w: 1440, h: 900 } })).toMatchObject({ title: 'Title', clock: false })
  expect(slots('alert').find(s => s.slot === 'msg')!.sample).toBe('Message')
  expect((instance('kvtable').params.rows as Params[]).map(r => r.caption)).toEqual(['Label 1', 'Label 2', 'Label 3'])
})
