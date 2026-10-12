import { describe, expect, it } from 'vitest'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import type { SrcNode } from '../model/scene'
import { expandRoot, sanitize } from './core'
import { WIDGETS } from './registry'
import { bracket, checked, holds, instance, printed, rules, TEST_CTX } from './testing'
import type { Theme } from '../theme/types'
import { nodeAt } from '../model/tree'
import type { Params } from './types'

const exp = (type: string, over: Params = {}) => expandRoot(instance(type, over), t).exp
/** Every numeric w and h in the widget's expansion. */
const sizes = (type: string, over: Params) => {
  const out: number[] = [], stack: SrcNode[] = [...exp(type, over).nodes]
  for (let n = stack.pop(); n; n = stack.pop()) {
    for (const k of ['w', 'h']) if (typeof n.attrs[k] === 'number') out.push(n.attrs[k] as number)
    stack.push(...(n.c ?? []))
  }
  return out
}
const DROP = 'sh=[[0,2,2,0,#00000099]]'
const LABEL = 'size=26 font="Barlow Condensed Bold" cspace=3.85'

describe('Button', () => {
  it('draws a plate, the secondary body pressed by down, and its label', () => {
    const p = printed(instance('button', { x: 24, y: 500 })), at = p.findIndex(l => l.startsWith('# widget button'))
    expect(p.slice(at, at + 5)).toEqual(['# widget button btn1 {"x":24,"y":500,"w":200,"h":54,"states":[{"label":"Button","variant":"secondary","key":0}],"canDisable":false,"canSelect":false,"keys":{}}',
      'G id=btn1 {', 'R id=btn1_hit click=1 x=24 y=500 w=200 h=54',
      'R x=24.5 y=500.5 w=199 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down',
      `T x=42 y=500 w=164 h=54 text=BUTTON ${LABEL} f=#FFFFFF ${DROP} align=center valign=middle fit=ellipsis`])
    expect(exp('button').clicks).toEqual([{ id: 'btn1_hit', step: '' }])
    expect(instance('button', { h: 10 }).params.h).toBeCloseTo(36.4, 3)
  })
  it('can be disabled (plate removed, group dimmed) and selected (the focus ring)', () => {
    const p = printed(instance('button', { x: 24, y: 500, canDisable: true, canSelect: true }))
    expect(p).toContain('R id=btn1_hit click=1 v==1-$btn1_dis x=24 y=500 w=200 h=54')
    expect(p).toContain('R v==$btn1_sel x=22.5 y=498.5 w=203 h=57 rx=7.5 f=none s=#FF772D sw=3')
    expect(p).toContain('G o==1-0.5*$btn1_dis {')
    expect(exp('button', { canDisable: true, canSelect: true }).slots.map(s => [s.slot, s.kind, s.sample])).toEqual([['dis', 'flag', 0], ['sel', 'flag', 0]])
  })
  it('switches between states: bodies first, then the labels', () => {
    const states = [{ label: 'Open', variant: 'secondary' }, { label: 'Close', variant: 'danger' }, { label: 'Lock', variant: 'primary' }]
    const p = printed(instance('button', { x: 24, y: 500, states }))
    expect(p).toContain('G v==eq($btn1_state,1) {')
    expect(p).toContain('R x=24 y=500 w=200 h=54 rx=6 f=@theme_danger fo==1-0.25*down')
    expect(p).toContain('R x=25 y=501 w=198 h=52 rx=5 f=@theme_brand s=#FF772D sw=2 fo==1-0.25*down')
    expect(p).toContain(`T v==eq($btn1_state,2) x=42 y=500 w=164 h=54 text=LOCK ${LABEL} f=#FFFFFF ${DROP} align=center valign=middle fit=ellipsis`)
    expect(exp('button', { states }).clicks).toEqual([{ id: 'btn1_hit', step: 'cycle' }])
    expect(exp('button', { states }).slots).toEqual([{ slot: 'state', key: 'btn1_state', kind: 'count', snap: true, sample: 0 }])
    holds('button', {}, { canDisable: true, canSelect: true }, { states }, { states, canDisable: true, canSelect: true },
      { states: [{ label: '12', variant: 'primary' }], h: 36.4 })
  })
})

describe('Toggle', () => {
  const gradientSwitch: Theme = { ...t, parts: { ...t.parts, 'switch.on': { fill: { gradient: 'brand' } } } }
  const part = (e: ReturnType<typeof expandRoot>, name: string) => e.exp.parts![name] && nodeAt(e.root.c!, e.exp.parts![name])
  it('a gradient switch crossfades', () => {
    for (const theme of [gradientSwitch, { ...t, parts: { ...t.parts, 'switch.off': { fill: { gradient: 'row' } },
      'switch.on': { fill: 'state', stroke: 'state', width: 1 } } } as Theme]) {
      const w = instance('toggle', { look: 'switch' }), e = expandRoot(w, theme)
      expect(part(e, 'track')?.attrs.fo).toBeUndefined()
      expect(part(e, 'track.on')).toMatchObject({ op: 'R', attrs: {
        fo: '=clamp($tg1_on,0,1)', so: '=clamp($tg1_on,0,1)' } })
      expect(part(e, theme === gradientSwitch ? 'track.on' : 'track')?.attrs.f).toBe(theme === gradientSwitch ? '@theme_brand' : '@theme_row')
      expect(e.defs.some(n => n.attrs.id === (theme === gradientSwitch ? 'theme_brand' : 'theme_row'))).toBe(true)
      expect(printed(w, theme).join('\n')).not.toMatch(/f=.*mix\([^\n]*@/)
      expect(rules(w, theme)).toEqual([])
      expect(checked(w, theme)).toEqual([])
    }
  })
  it('colours still mix', () => {
    expect(exp('toggle', { look: 'switch' }).nodes[1].attrs.f).toBe('=mix(#111116,#7FD970,clamp($tg1_on,0,1))')
    expect(expandRoot(instance('toggle', { look: 'switch' }), t).exp.parts).not.toHaveProperty('track.on')
  })
  it('one outline for both', () => {
    const theme: Theme = { ...gradientSwitch, anatomy: { v: 1, looks: { ...bracket.anatomy.looks,
      switch: { shape: { op: 'cut', cut: [4,4,4,4] }, add: [{ name: 'outline', op: 'rect', fill: 'accent' }] } } } }
    const e = expandRoot(instance('toggle', { look: 'switch' }), theme)
    expect(part(e, 'track')).toMatchObject({ op: 'Y' })
    expect(part(e, 'track.on')).toMatchObject({ op: 'Y', attrs: { p: part(e, 'track')!.attrs.p } })
    expect(Object.keys(e.exp.parts!).filter(k => k.endsWith('~outline'))).toEqual(['track~outline'])
  })
  it('button look: the ring when on, ON/OFF at the right; on snaps', () => {
    const p = printed(instance('toggle', { x: 24, y: 560 }))
    expect(p).toContain('R id=tg1_hit click=1 x=24 y=560 w=300 h=54')
    expect(p).toContain('R v==$tg1_on x=22.5 y=558.5 w=303 h=57 rx=7.5 f=none s=#FF772D sw=3')
    expect(p).toContain(`T x=42 y=560 w=180 h=54 text=LABEL ${LABEL} f=#FFFFFF ${DROP} valign=middle fit=ellipsis`)
    expect(p).toContain(`T v==eq($tg1_on,0) x=222 y=560 w=84 h=54 text=OFF ${LABEL} f=#A6A6B4 ${DROP} align=right valign=middle`)
    expect(p).toContain(`T v==eq($tg1_on,1) x=222 y=560 w=84 h=54 text=ON ${LABEL} f=#FFFFFF ${DROP} align=right valign=middle`)
    expect(exp('toggle').slots).toEqual([{ slot: 'on', key: 'tg1_on', kind: 'flag', snap: true, sample: 1 }])
    expect(exp('toggle').clicks).toEqual([{ id: 'tg1_hit', step: 'toggle' }])
  })
  it('switch look: a track that blends to ok and a knob that slides; on eases', () => {
    const p = printed(instance('toggle', { x: 24, y: 560, look: 'switch' }))
    expect(p).toContain('R x=242 y=568 w=64 h=38 rx=19 f==mix(#111116,#7FD970,clamp($tg1_on,0,1))')
    expect(p).toContain('R x==244+26*clamp($tg1_on,0,1) y=570 w=34 h=34 rx=17 f=#FFFFFF')
    expect(exp('toggle', { look: 'switch' }).slots[0].snap).toBe(false)
    holds('toggle', {}, { look: 'switch' }, { onText: '1', offText: '0' }, { h: 36.4 }, { look: 'switch', h: 36.4 })
  })
  it('takes any height its labels fit; the switch track shrinks with it', () => {
    expect(instance('toggle', { h: 10 }).params.h).toBeCloseTo(36.4, 3)
    expect(printed(instance('toggle', { x: 24, y: 560, h: 36, look: 'switch' })).join('\n')).toContain('R x=242 y=560 w=64 h=36.4 rx=18.2')
  })
})

describe('Stepper', () => {
  it('draws the name, a − and a + button that send press events, and the value between them', () => {
    const p = printed(instance('stepper', { x: 24, y: 24 }))
    expect(p).toContain(`T x=24 y=24 w=192 h=54 text=Value size=28 font="Barlow SemiBold" f=#FFFFFF ${DROP} valign=middle fit=ellipsis`)
    expect(p).toContain('G id=stp1_gd {')
    expect(p).toContain('R id=stp1_dec press=1 x=226 y=24 w=54 h=54')
    expect(p).toContain(`T x=226 y=24 w=54 h=54 text=− ${LABEL} f=#FFFFFF ${DROP} align=center valign=middle`)
    expect(p).toContain(`T x=290 y=27.2 w=110 h=47.6 text="{$stp1_v:%.0f}" size=34 font="Barlow SemiBold" f=#FFFFFF ${DROP} align=center valign=middle`)
    expect(p).toContain('R id=stp1_inc press=1 x=410 y=24 w=54 h=54')
    expect(exp('stepper').clicks).toEqual([{ id: 'stp1_dec', step: 'step(-1,0,100)' }, { id: 'stp1_inc', step: 'step(1,0,100)' }])
    holds('stepper', {}, { by: 0.5, fmt: '%.1f', name: '' }, { h: 39.2 }, { w: 1 }, { w: 100, h: 200 }, { name: '', h: 10 })
    expect(instance('stepper', { h: 10 }).params.h).toBeCloseTo(39.2, 3)
  })
  it('without a name draws no name label, and then takes any height (no label has fit=ellipsis)', () => {
    const p = printed(instance('stepper', { x: 24, y: 24, name: '' }))
    expect(p.filter(l => l.startsWith('T '))).toHaveLength(3)
    expect(p.some(l => l.includes('size=28'))).toBe(false)
    expect(instance('stepper', { name: '', h: 10 }).params.h).toBe(10)
  })
  it('steps by 0 as step(0,…), not -0; takes a format holding ] (literal in a placeholder\'s format since vector 0.11.97)', () => {
    expect(exp('stepper', { by: 0 }).clicks![0].step).toBe('step(0,0,100)')
    for (const fmt of ['[%.0f]', '%.0f]', '[%.0f', 'a:%d units', '(%.1f)']) expect(instance('stepper', { fmt }).params.fmt).toBe(fmt)
    expect(printed(instance('stepper', { fmt: '[%.0f]' })).join('\n')).toContain(':[%.0f]}"')
    holds('stepper', { fmt: '[%.0f]' }, { fmt: '%.0f]' })
  })
})

describe('Option group', () => {
  it('rings the selected option; each option is a plate, a body and, after all of them, a label', () => {
    const p = printed(instance('options', { x: 24, y: 24 }))
    expect(p).toContain('G id=og1_g1 {')
    expect(p).toContain('R id=og1_o1 click=1 x=174 y=24 w=140 h=54')
    expect(p).toContain('R v==eq($og1_sel,1) x=172.5 y=22.5 w=143 h=57 rx=7.5 f=none s=#FF772D sw=3')
    expect(p).toContain(`T x=324 y=24 w=140 h=54 text=OFF ${LABEL} f=#FFFFFF ${DROP} align=center valign=middle fit=ellipsis`)
    expect(p.findIndex(l => l.startsWith('T x=24'))).toBeGreaterThan(p.findIndex(l => l.startsWith('G id=og1_g2')))
    expect(exp('options').clicks).toEqual([{ id: 'og1_o0', step: 'set(0)' }, { id: 'og1_o1', step: 'set(1)' }, { id: 'og1_o2', step: 'set(2)' }])
    expect(exp('options').slots).toEqual([{ slot: 'sel', key: 'og1_sel', kind: 'count', snap: true, sample: 0 }])
    holds('options', {}, { options: [{ label: 'Only', value: 5 }] }, { gap: 0 }, { w: 40, gap: 30 })
    expect(instance('options', { h: 10 }).params.h).toBeCloseTo(36.4, 3)
  })
  it('draws no negative size when its gaps are wider than the box (the options overlap instead)', () => {
    expect(Math.min(...sizes('options', { w: 40, gap: 30 }))).toBeGreaterThanOrEqual(0)
  })
  it('writes a value in an expression as a plain decimal, never 1e-7', () => {
    expect(printed(instance('options', { options: [{ label: 'A', value: 1e-7 }] })).some(l => l.startsWith('R v==eq($og1_sel,0.0000001) '))).toBe(true)
  })
})

describe('Page tabs', () => {
  it('has one tab per project page; the hosting page’s tab is ringed, baked; each tab goes to its page', () => {
    const p = printed(instance('tabs', { x: 24, y: 24 }))
    expect(p).toContain('R id=nav1_t0 click=1 x=24 y=24 w=211 h=54')
    expect(p).toContain('R x=22.5 y=22.5 w=214 h=57 rx=7.5 f=none s=#FF772D sw=3')
    expect(p.filter(l => l.includes('s=#FF772D sw=3'))).toHaveLength(1)
    expect(p).toContain(`T x=245 y=24 w=211 h=54 text=POWER ${LABEL} f=#FFFFFF ${DROP} align=center valign=middle fit=ellipsis`)
    expect(exp('tabs').clicks).toEqual([{ id: 'nav1_t0', step: 'page(p1)' }, { id: 'nav1_t1', step: 'page(p2)' }])
    expect(exp('tabs').slots).toEqual([])
    holds('tabs', {}, { active: 'p2' }, { tabs: [{ label: '1', page: 'p1' }] }, { w: 40, gap: 50 })
    expect(instance('tabs', { h: 10 }).params.h).toBeCloseTo(36.4, 3)
  })
  it('rings the active page’s tab, whichever it is', () => {
    const p = printed(instance('tabs', { x: 24, y: 24, active: 'p2' }))
    expect(p.filter(l => l.includes('s=#FF772D sw=3'))).toEqual(['R x=243.5 y=22.5 w=214 h=57 rx=7.5 f=none s=#FF772D sw=3'])
  })
  it('draws no negative size when its gaps are wider than the box', () => {
    expect(Math.min(...sizes('tabs', { w: 40, gap: 50 }))).toBeGreaterThanOrEqual(0)
  })
  it('starts a tab blank when its page name cannot be a label as written', () => {
    const pages = [{ id: 'p1', name: '$x' }, { id: 'p2', name: 'a {=b}' }, { id: 'p3', name: '1e5' }, { id: 'p4', name: 'Power' }]
    expect((sanitize(WIDGETS.tabs, WIDGETS.tabs.defaults(t, { ...TEST_CTX, pages }), t).tabs as Params[]).map(x => x.label)).toEqual(['', '', '1e5', 'Power'])
  })
})


it('controls use neutral defaults', () => {
  expect(instance('button').params.states).toEqual([{ label: 'Button', variant: 'secondary', key: 0 }])
  expect(instance('toggle').params.label).toBe('Label')
  expect(instance('stepper').params).toMatchObject({ name: 'Value', min: 0, max: 100, by: 1 })
})
