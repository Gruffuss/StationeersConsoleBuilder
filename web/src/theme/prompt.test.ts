import { expect, it } from 'vitest'
import { ROLES, STYLES, THEMES } from './index'
import { HOOKS } from '../widgets/anatomy'

it('accepts links or files and states units for spacing and every length field', async () => {
  const { themePrompt } = await import('./prompt'), prompt = themePrompt()
  expect(prompt).toContain('at the link or in the files I supply')
  expect(prompt).toContain('size > 0 (design units)')
  expect(prompt).toContain('cspace (hundredths of the type size: letter-spacing / size * 100; 1.5px at 36px gives 4.17)')
  expect(prompt).toContain('All lengths are in design units (use CSS px values directly): type size, part width/radius, shadow dx/dy/blur/spread, geometry, metrics, anatomy by/radius/cut/width/dash, and widget dimensions/gaps.')
  expect(prompt).toContain('at is a unitless fraction in 0..1')
  expect(prompt).toContain('pressed is a unitless factor in 0..1')
})

it('states widget angle, flow and data units', async () => {
  const { themePrompt } = await import('./prompt'), prompt = themePrompt()
  expect.soft(prompt.includes('gauge.start and gauge.end are angles in degrees')).toBe(true)
  expect.soft(prompt.includes('duct.period and duct.dash are lengths in design units; duct.speed is design units per second')).toBe(true)
  expect.soft(prompt.includes("widget data values use the widget's displayed unit")).toBe(true)
})

it('describes every theme slot and returns a valid example file', async () => {
  const { themePrompt } = await import('./prompt'), { sanitizeTheme } = await import('./file')
  const prompt = themePrompt()
  for (const name of [...ROLES, ...STYLES, ...Object.keys(THEMES.neutral.parts), ...Object.keys(THEMES.neutral.metrics), ...HOOKS.keys()]) expect(prompt).toContain(name)
  for (const [key, value] of Object.entries(THEMES.neutral.geo)) {
    if (typeof value === 'number') expect(prompt).toContain('geo.' + key)
    else for (const child of Object.keys(value)) expect(prompt).toContain(`geo.${key}.${child}`)
  }
  const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1])
  expect(sanitizeTheme(example, THEMES.neutral, { taken: new Set() }).notes).toEqual([])
  expect(prompt).toContain('JSON alone')
  expect(prompt).toContain('widgetDefaults')
  expect(prompt).toContain('[at, by]')
  expect(prompt).toMatch(/^mark: .*bar/m)
})
