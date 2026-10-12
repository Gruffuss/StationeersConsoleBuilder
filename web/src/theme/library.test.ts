import { expect, it } from 'vitest'
import { imported } from './testing'
import { themeFileOf } from './file'
const api = () => import('./library')
const memory = () => {
  let value: string | null = null
  return { getItem: (_: string) => value, setItem: (_: string, text: string) => { value = text } }
}

it('saves, loads and removes theme files in the browser library', async () => {
  const { loadThemeLibrary, saveToThemeLibrary, removeFromThemeLibrary } = await api(), store = memory()
  expect(saveToThemeLibrary(imported, store)).toBe(true)
  expect(JSON.parse(store.getItem('')!)[imported.id]).toEqual(themeFileOf(imported))
  expect(loadThemeLibrary(store)).toEqual({ themes: [imported], notes: [] })
  expect(removeFromThemeLibrary(imported.id, store)).toBe(true)
  expect(loadThemeLibrary(store)).toEqual({ themes: [], notes: [] })
})

it('skips corrupt and prototype records with their causes', async () => {
  const { loadThemeLibrary } = await api(), store = memory()
  store.setItem('', JSON.stringify({ [imported.id]: themeFileOf(imported), broken: { v: 9 }, constructor: null }))
  const result = loadThemeLibrary(store)
  expect(result.themes).toEqual([imported])
  expect(result.notes.join('; ')).toContain('broken')
  expect(result.notes.join('; ')).toContain('constructor')
})

it('reports throwing storage and does not overwrite unreadable data', async () => {
  const { loadThemeLibrary, saveToThemeLibrary, removeFromThemeLibrary } = await api()
  const throwing = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } }
  expect(loadThemeLibrary(throwing).notes.join('; ')).toContain('blocked')
  expect(saveToThemeLibrary(imported, throwing)).toBe(false)
  expect(removeFromThemeLibrary(imported.id, throwing)).toBe(false)
  const store = memory(); store.setItem('', '{broken')
  expect(saveToThemeLibrary(imported, store)).toBe(false)
  expect(store.getItem('')).toBe('{broken')
})

it('skips invalid browser keys so listed themes can be removed by their ids', async () => {
  const { loadThemeLibrary } = await api(), store = memory()
  store.setItem('', JSON.stringify({ neutral: themeFileOf(imported) }))
  const read = loadThemeLibrary(store)
  expect(read.themes).toEqual([])
  expect(read.notes.join('; ')).toContain('library.neutral')
})
