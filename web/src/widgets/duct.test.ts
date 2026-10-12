import { describe, expect, it } from 'vitest'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { THEMES } from '../theme'
import { expandRoot } from './core'
import { holds, instance, printed, rules } from './testing'
import type { Params } from './types'

const expansion = (over: Params = {}) => expandRoot(instance('duct', over), t)
const line = (over: Params = {}) => expansion(over).exp.nodes.find(n => n.op === 'L')

describe('Flow duct', () => {
  it('draws its track and one literal dashed centre line without a clip or repeat', () => {
    const e = expansion()
    expect(e.defs).toEqual([])
    expect(e.exp.nodes.map(n => n.op)).toEqual(['R', 'L'])
    expect(e.exp.nodes[0].attrs).toEqual({ x: 24, y: 24, w: 300, h: 4, f: '#5A5A69' })
    expect(line()?.attrs).toEqual({ p: [24, 26, 324, 26], sw: 4, s: '#C8C8D2', cap: 'butt', dash: [11, 11],
      dofs: '=-mod(t*20,22)', so: '=clamp($duct1_run,0,1)' })
    holds('duct')
  })

  it('draws only the track at period zero, without an unused run slot', () => {
    holds('duct', { period: 0 })
    const e = expansion({ period: 0 })
    expect(e.exp.nodes).toEqual([{ op: 'R', attrs: { x: 24, y: 24, w: 300, h: 4, f: '#5A5A69' } }])
    expect(e.exp.slots).toEqual([])
    for (const theme of Object.values(THEMES)) expect(rules(instance('duct', { period: 0 }), theme)).toEqual([])
    const renamed = expansion({ period: 0, keys: { run: 'moving' } })
    expect(renamed.root.comments!.at(-1)).toContain('"keys":{"run":"moving"}')
  })

  it.each([22, 30])('draws a continuous line when dash %i reaches or exceeds the period', dash => {
    expect(line({ dash })?.attrs.dash).toEqual([22, 0])
    holds('duct', { dash })
  })

  it('draws a vertical centre line with the same thickness, motion and run opacity', () => {
    expect(line({ dir: 'v', w: 4, h: 300, idle: 0.25, keys: { run: 'moving' } })?.attrs).toEqual({
      p: [26, 24, 26, 324], sw: 4, s: '#C8C8D2', cap: 'butt', dash: [11, 11],
      dofs: '=-mod(t*20,22)', so: '=0.25+0.75*clamp($moving,0,1)',
    })
    holds('duct', { dir: 'v', w: 4, h: 300, idle: 0.25, keys: { run: 'moving' } })
  })

  it('writes the requested period, dash and reverse speed as literal dash lengths and a bounded offset', () => {
    expect(line({ period: 30, dash: 8, speed: -40 })?.attrs).toMatchObject({ dash: [8, 22], dofs: '=-mod(t*-40,30)' })
    holds('duct', { period: 30, dash: 8, speed: -40 }, { speed: 0 }, { dash: 0 }, { h: 0.5, period: 0.5 })
  })

  it.each([{ x: 0, w: 30000 }, { x: 0, w: 3e38 }, { x: -3e38, w: 3e38 }, { x: -1e30, w: 1 }])(
    'expands any length to two nodes without an origin-based cutoff: %j', over => {
      const e = expansion({ y: 0, h: 4, period: 1, ...over })
      expect(e.exp.nodes.map(n => n.op)).toEqual(['R', 'L'])
      expect(line({ period: 1, ...over })?.attrs.dofs).toBe('=-mod(t*20,1)')
      expect(e.defs).toEqual([])
    })

  it('writes tiny speeds and idle opacity without exponent notation inside expressions', () => {
    expect(printed(instance('duct', { idle: 1e-7, speed: 1e-7 })).join('\n'))
      .toContain('dofs==-mod(t*0.0000001,22) so==0.0000001+0.9999999*clamp($duct1_run,0,1)')
    holds('duct', { idle: 1e-7, speed: 1e-7 })
  })
})
