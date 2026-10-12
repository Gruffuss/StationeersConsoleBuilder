import { beforeEach, expect, it, vi } from 'vitest'
import type { PageFontRecord } from './pageFonts'
const records = vi.hoisted(() => new Map<string, PageFontRecord>())
vi.mock('./pageFonts', async original => ({ ...await original<typeof import('./pageFonts')>(), getPageFontRecord: (link: string) => records.get(link) }))
import { previewFontWarning, sceneFontNames } from './fontWarnings'
import { parseSrc } from '../srctext/parse'
const scene = parseSrc('DEFS {\nFONT src="one"\nFONT src="two"\n}\nT font=Missing').scene!
beforeEach(() => records.clear())
it('reads first-line faces with quoted/unquoted values, exact keys and last font wins', () => {
  const styles = ["size=12 font='Display Face'", 'font="Double Face" weight=bold', 'font=Plain',
    'font=Ignored font=Last', 'font=Cleared font=', "font='Open Quote", "weight='font=NotAName' FONT=NotAKey"]
  const names = sceneFontNames({ header: {}, defs: [], root: styles.map(fl => ({ op: 'T', attrs: { FL: fl } })) })
  expect(names.attributes).toEqual(['Display Face', 'Double Face', 'Plain', 'Last', 'Open Quote'])
  expect(names.tags).toEqual([])
})
it('distinguishes unrequested, pending, settled and late subset failures, in link/name order', () => {
  expect(previewFontWarning(scene, ['Missing'], [])).toContain("Load this page's fonts to preview them")
  records.set('one', { link: 'one', state: 'pending', names: [], notice: '', subsetFailures: [] })
  expect(previewFontWarning(scene, ['Missing'], [])).toContain('Page fonts loading')
  records.set('one', { link: 'one', state: 'loaded', names: ['Z', 'A', 'Z'], notice: '', subsetFailures: [{ url: 'subset', cause: 'decode' }] })
  records.set('two', { link: 'two', state: 'failed', names: [], notice: '', subsetFailures: [], cause: 'HTTP 400' })
  const note = previewFontWarning(scene, ['Missing'], ['Tag'])
  expect(note).toContain('Delivered face names: Z, A.')
  expect(note).toContain('HTTP 400')
  expect(note).toContain('subset: decode')
  expect(note).toContain('Unknown font tags shown as text: Tag.')
})
it('explains attribute fallback separately from literal tags without declarations', () => {
  const note = previewFontWarning({ header: {}, defs: [], root: [] }, ['Missing'], ['Tag'])
  expect(note).toContain('game uses its fallback')
  expect(note).toContain('tag shows as text in game')
  expect(note).toContain('reports it. font tag')
  expect(note).toContain('text in game. Import them under Fonts.')
})
