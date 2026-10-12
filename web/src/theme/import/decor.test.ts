import { expect, it } from 'vitest'
import { THEMES } from '../index'
import { sanitizeAnatomy } from '../../widgets/anatomy'
import { decorate } from './decor'

const values = (entries: Record<string,string>) => new Map(Object.entries(entries))
const colour = () => 'accent'

it('per-corner radii, 45 degree cuts, round boxes and hidden parts become shapes', () => {
  expect(decorate('panel','.panel',values({ 'border-radius': '4px 8px 12px 16px' }),colour,{}).look.shape).toEqual({ op: 'rect', radius: [4,8,12,16] })
  const clip = 'polygon(8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px), 0 8px)'
  expect(decorate('button.primary','.button',values({ 'clip-path': clip }),colour,{}).look.shape).toEqual({ op: 'cut', cut: [8,8,8,8] })
  expect(decorate('panel','.panel',values({ 'border-radius': '50%' }),colour,{}).look.shape).toEqual({ op: 'ellipse' })
  expect(decorate('light.ok','.light',values({ 'border-radius': '50%' }),colour,{}).look).toEqual({})
  expect(decorate('header','.header',values({ display: 'none' }),colour,{}).look.shape).toBe('none')
})

it('one-side borders and positioned decorations keep their exact edge frames', () => {
  const border = decorate('row','.row',values({ 'border-left': '3px solid #fff' }),colour,{})
  expect(border.look.add).toEqual([{ name: 'border-left', op: 'rect', frame: { l: [0,0], t: [0,0], r: [0,3], b: [1,0] }, fill: 'accent' }])
  const child = decorate('panel','.panel::before',values({ content: '""', left: '25%', top: '2px', right: '3px', bottom: '10%' }),colour,{ fill: 'accent' },true)
  expect(child.look.add?.[0]).toMatchObject({ op: 'rect', frame: { l: [.25,0], t: [0,2], r: [1,-3], b: [.9,0] }, fill: 'accent' })
  expect(decorate('panel','.hidden',values({ display: 'none' }),colour,{ fill: 'accent' },true).look).toEqual({})
})

it('a rotated square is a fixed convex polygon kept by the anatomy sanitizer', () => {
  const result = decorate('chip','.chip::before',values({ content: '""', left: '4px', top: '6px', width: '10px', height: '10px', transform: 'rotate(45deg)' }),colour,{ fill: 'accent' },true)
  const poly = result.look.add?.[0]
  expect(poly?.op).toBe('poly')
  const clean = sanitizeAnatomy({ v: 1, looks: { chip: result.look } },THEMES.neutral)
  expect(clean.notes).toEqual([])
  expect(clean.anatomy?.looks.chip.add).toHaveLength(1)
  if (poly?.op === 'poly') expect(poly.p[0][1][1]).toBeCloseTo(11 - Math.SQRT1_2 * 10)
})

it('unsupported shapes, moving decorations and text are reported, never approximated silently', () => {
  for (const input of [{ 'border-radius': '20%' }, { 'border-radius': '50% 75%' }, { 'clip-path': 'polygon(0 0, 80% 0, 100% 100%)' }] as Record<string,string>[]) {
    expect(decorate('panel','.panel',values(input),colour,{}).cannotDraw.join('\n')).toContain('.panel')
  }
  for (const input of [{ content: '"text"' }, { width: 'var(--live)', height: '10px' }, { transform: 'rotate(30deg)' }] as Record<string,string>[]) {
    expect(decorate('panel','.decoration',values({ left: '0', top: '0', width: '10px', height: '10px', ...input }),colour,{ fill: 'accent' },true).look.add).toBeUndefined()
  }
  const hidden = decorate('fill','.fill',values({ display: 'none' }),colour,{})
  expect(sanitizeAnatomy({ v: 1, looks: { fill: hidden.look } },THEMES.neutral).notes.join('\n')).toContain('shape not allowed')
})

it('individual corner declarations override the radius shorthand', () => {
  const result = decorate('panel','.panel',values({ 'border-radius': '4px', 'border-top-right-radius': '8px' }),colour,{})
  expect(result.look.shape).toEqual({ op: 'rect', radius: [4,8,4,4] })
})
