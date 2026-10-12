import { DEFAULT_THEME, THEMES, type Theme } from './index'
import { sanitizeTheme, themeFileOf } from './file'

const KEY = 'vb.themes'
type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined
const local = (): Store => { try { return globalThis.localStorage } catch { return null } }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const reserved = (key: string) => ['__proto__', 'constructor', 'prototype'].includes(key)
function filesOf(store: Store): Record<string, unknown> {
  if (!store) throw Error('browser theme storage is unavailable')
  const raw = store.getItem(KEY), value: unknown = raw ? JSON.parse(raw) : Object.create(null)
  if (!object(value)) throw Error('browser theme library needs a record')
  return Object.assign(Object.create(null), value)
}

export function loadThemeLibrary(store: Store = local()): { themes: Theme[]; notes: string[] } {
  const themes: Theme[] = [], notes: string[] = [], taken = new Set<string>()
  try {
    const files = filesOf(store)
    for (const id of Object.keys(files)) {
      if (reserved(id)) { notes.push(`library.${id}: prototype key dropped`); continue }
      const read = sanitizeTheme(files[id], THEMES[DEFAULT_THEME], { id, taken })
      for (const note of read.notes) notes.push(`library.${id}.${note}`)
      if (read.theme && read.theme.id !== id) notes.push(`library.${id}: invalid imported theme id; record skipped`)
      if (read.theme && read.theme.id === id) { themes.push(read.theme); taken.add(read.theme.id) }
    }
  } catch (e) { notes.push('Browser theme library could not be read: ' + (e instanceof Error ? e.message : String(e))) }
  return { themes, notes }
}

export function saveToThemeLibrary(t: Theme, store: Store = local()): boolean {
  try {
    if (!store || !/^ds-[a-z0-9-]{1,64}$/.test(t.id) || Object.hasOwn(THEMES, t.id)) return false
    const files = filesOf(store)
    files[t.id] = themeFileOf(t)
    store.setItem(KEY, JSON.stringify(files)); return true
  } catch { return false }
}

export function removeFromThemeLibrary(id: string, store: Store = local()): boolean {
  try {
    if (!store || reserved(id)) return false
    const files = filesOf(store)
    delete files[id]
    store.setItem(KEY, JSON.stringify(files)); return true
  } catch { return false }
}
