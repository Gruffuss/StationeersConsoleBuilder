import { expect, it, vi } from 'vitest'
import { newProject, newPage } from '../model/project'
import { printSrc } from '../srctext/print'
import { generate } from './generate'
import { fixtureProjects } from './testing'
const gen = (p: ReturnType<typeof newProject>) => generate(p, pg => printSrc(pg.scene))
it.each([48, 49])('warns only above 48 distinct links: %i, without blocking export', count => {
  const p = newProject()
  p.pages[0].scene.defs = Array.from({ length: count }, (_, i) => ({ op: 'FONT', attrs: { src: `https://fonts.googleapis.com/css2?family=Face${i}` } }))
  p.pages.push(newPage(p))
  p.pages[1].scene.defs = [p.pages[0].scene.defs[0]]
  const result = gen(p)
  expect(result.problems.filter(x => x.level === 'warning' && x.message.includes('exceed the game'))).toEqual(count === 49
    ? [{ level: 'warning', message: "This project's 49 distinct FONT links exceed the game's shared 48-link process limit; source and export remain available." }] : [])
  expect(result.problems.filter(x => x.level === 'error')).toEqual([])
  expect(result.lua).toContain(`This project: ${count} distinct FONT links`)
})
it('includes a first-line face in requirements and unknown-face warnings', () => {
  const p = newProject()
  p.pages[0].scene.root = [{ op: 'T', attrs: { text: 'line', fl: "size=12 font='First Line Face'" } }]
  const result = gen(p)
  expect(result.lua.split('\n')[1]).toContain('ScriptedScreens Fonts (First Line Face)')
  expect(result.problems).toContainEqual({ level: 'warning', owner: 'page p1',
    message: 'page p1: font "First Line Face": unless the player has this face, the game uses its fallback and reports it.' })
})
it('requires both Fonts capabilities from declarations alone, ordered and deduplicated across pages', () => {
  const p = newProject()
  p.pages.push(newPage(p))
  p.pages[0].scene.defs = [{ op: 'font', attrs: { SRC: 'https://fonts.googleapis.com/css2?family=Inter' } }]
  p.pages[1].scene.defs = [...p.pages[0].scene.defs, { op: 'FONT', attrs: { src: 'https://fonts.gstatic.com/font.ttf' } }]
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('no export request') }))
  try {
    const result = gen(p)
    expect(result.lua).toContain('FontApi.RequestFontWithReason (from 0.3.0)')
    expect(result.lua).toContain('FontApi.Registrations (from 0.4.0)')
    expect(result.lua).toContain('This project: 2 distinct FONT links')
    expect(result.lua).toContain('48 distinct links per process; 48 page faces per session')
    expect(result.problems.some(x => x.level === 'warning' && x.message.includes('per player'))).toBe(true)
    expect(result.lua.indexOf('-- FONT link: https://fonts.googleapis.com')).toBeLessThan(result.lua.indexOf('-- FONT link: https://fonts.gstatic.com'))
    expect(fetch).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
it('keeps more than 48 links exportable and safely formats model face names and links', () => {
  const p = newProject(), name = 'Quoted"\\face\nnext'
  p.pages[0].scene.defs = Array.from({ length: 49 }, (_, i) => ({ op: 'FONT', attrs: { src: `https://fonts.googleapis.com/css2?family=Face${i}` } }))
  p.pages[0].scene.root = [{ op: 't', attrs: { FONT: name, TEXT: '<font="Inline">x</font>' } }]
  const result = gen(p)
  expect(result.problems.filter(x => x.level === 'error')).toEqual([])
  expect(result.lua).toContain('49 distinct FONT links')
  expect(result.lua.split('\n')[1]).toContain('Quoted"\\face\\nnext, Inline')
  expect(result.lua).toContain('floor = 11118')
  expect(result.lua).toContain('G v==lt(ver,11118)')
})
it('requires Fonts even for invalid FONT declarations with no text, and keeps CR rejection', () => {
  const p = newProject()
  p.pages[0].scene.defs.push({ op: 'FONT', attrs: { src: 5 } })
  expect(gen(p).lua.split('\n')[1]).toContain('ScriptedScreens Fonts')
  for (const name of ['a\rb', 'a\r\nb']) {
    p.pages[0].scene.root = [{ op: 'T', attrs: { font: name } }]
    const result = gen(p)
    expect(result.lua).toBe('')
    expect(result.problems.some(x => x.level === 'error')).toBe(true)
  }
})
it('keeps a scene carrier for FONT-only pages that also contain native elements', () => {
  const p = fixtureProjects().natives
  p.pages[0].scene.defs.push({ op: 'FONT', attrs: { src: 'https://fonts.gstatic.com/only.otf' } })
  const result = gen(p)
  expect(result.lua).toContain('empty = false')
  expect(result.lua).toContain('FONT src=https://fonts.gstatic.com/only.otf')
})
