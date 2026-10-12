import { expect, it } from 'vitest'
import { fieldOf, HEADER } from '.'
import { fromProps } from '../srctext/fromProps'
import { parseSrc } from '../srctext/parse'
import { trapsOf } from './traps'
import { validateScene } from '../srctext/validate'

const scene = (src: string) => parseSrc(src).scene!
it('117: exposes nopixeledges as a literal scene flag', () => {
  expect(HEADER.has('NOPIXELEDGES')).toBe(true)
  expect(fieldOf('SCENE', 'nopixeledges')).toMatchObject({ type: 'flag', kind: 'N', default: 0 })
})
it('116: accepts lowercase booleans and leaves literal-word reports to the mod', () => {
  for (const src of ['SCENE w=true h=10 nofill=false\nR', 'L p=[0,false,10,true] s=#fff', 'T text=a kern=true'])
    expect(trapsOf(scene(src)).filter(t => t.id === 'literal-only'), src).toEqual([])
  for (const word of ['word', "''", "'%arg'"]) for (const src of [
    `SCENE w=${word}\nR`, `SP p=[0,0,10,1] seg=${word}`, `L p=[0,0,10,1] dash=[4,${word}] s=#fff`])
    expect(trapsOf(scene(src)).filter(t => t.id === 'literal-only'), src).toEqual([])
})
it('116: fromProps turns only literal numeric true/false into numbers', () => {
  const r = fromProps([['nofill', 'true'], ['root', { a: [{ m: [['op', 'T'], ['text', 'true'], ['kern', 'false']] },
    { m: [['op', 'L'], ['p', { a: [0, 'true', 10, 'false'] }]] }] }]])
  expect(r.scene.header.nofill).toBe(1)
  expect(r.scene.root[0].attrs).toMatchObject({ text: 'true', kern: 0 })
  expect(r.scene.root[1].attrs.p).toEqual([0, 1, 10, 0])
  expect(r.warnings).toEqual([])
})
it('116: unread endpoints are reported, while GL endpoints and YS y2 stay valid', () => {
  for (const key of ['x1', 'y1', 'x2', 'y2'])
    expect(trapsOf(scene(`R ${key}=10`)).some(t => t.message.includes('the mod reports it')), key).toBe(true)
  expect(trapsOf(scene('DEFS { GL id=g x1=0 y1=0 x2=1 y2=1 stops=[[0,#000],[1,#fff]] }\nYS n=2 y2=5'))
    .filter(t => ['x1', 'y1', 'x2', 'y2'].includes(t.key ?? ''))).toEqual([])
})
it('116: numeric mix without a colour literal is reported', () => {
  expect(validateScene(scene('R x==mix($a,$b,t)')).warnings.map(w => w.message))
    .toContain('x: a colour is used where a number is read; the mod reports it')
  expect(validateScene(scene('R f==mix(#000,#fff,t)')).warnings).toEqual([])
})
it('116: bbox gradients on dashed/clipped strokes need no scene-units warning', () => {
  const s = scene('DEFS { GL id=g units=bbox stops=[[0,#000],[1,#fff]] }\nG t=["=t",0] { L p=[0,0,10,1] dash=[2,2] s=@g }')
  expect(trapsOf(s).filter(t => t.id === 'gradient-units')).toEqual([])
})
