import { expect, it } from 'vitest'
import { BUNDLED } from '../editor/fonts'
import { faceLines } from '../editor/testing'
import { faceOf } from './vanillaPlus'

it('names face weights and italics', async () => {
  const { faceName } = await import('./faces')
  for (const [weight, italic, want] of [[400, false, 'Barlow'], [700, false, 'Barlow Bold'], [100, false, 'Barlow Thin'],
    [950, false, 'Barlow Black'], [400, true, 'Barlow Italic'], [700, true, 'Barlow Bold Italic'], [449, false, 'Barlow'],
    [450, false, 'Barlow Medium'], [1, false, 'Barlow Thin']] as const) expect(faceName('Barlow', weight, italic)).toBe(want)
  expect(([400, 500, 600, 700] as const).map(w => faceOf('Barlow', w))).toEqual(['Barlow', 'Barlow Medium', 'Barlow SemiBold', 'Barlow Bold'])
})

it('reads the bundled head and hhea lines', async () => {
  const expected = Object.fromEntries(BUNDLED.map(face => [face, faceLines(face)]))
  await expect(JSON.stringify(expected, null, 2) + '\n').toMatchFileSnapshot('../catalog/faceLines.json')
  const { linesOf } = await import('./faces')
  for (const face of BUNDLED) expect(linesOf(face)).toEqual(expected[face])
  expect(linesOf('')).toEqual(expected['Liberation Sans'])
  expect(linesOf('constructor')).toBeUndefined()
  expect(linesOf('not bundled')).toBeUndefined()
})
