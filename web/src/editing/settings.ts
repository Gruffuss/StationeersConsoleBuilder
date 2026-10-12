// The editing settings, kept per browser (ruling R9): not scene data, not undoable. Storage may be missing or refuse (a
// private window, blocked site data): the defaults hold then, and a change lasts for the session.
import type { Settings } from './types'
import type { SrcNode, Value } from '../model/scene'
import { isStyle, styleOf } from './style'
import { isStyleLink, linksOf, resolveLinks, type StyleLink } from '../theme/links'
import type { Theme } from '../theme'
import { fieldOf } from '../schema'
import { modeOf } from '../editor/fields'
import { first, foldKey } from '../srctext/props'

export const DEFAULTS: Settings = { grid: 0, snap: true }
const KEY = 'vb.editing'
type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined
const local = (): Store => { try { return globalThis.localStorage } catch { return null } }
const whole = (v: unknown, min: number, d: number) => typeof v === 'number' && Number.isFinite(v) && Math.round(v) >= min ? Math.round(v) : d

/** `s` with each valid field of `change`, as loading reads one: the grid a whole number of units, at least 0; snap a
 *  boolean. Anything else keeps what `s` has, so what a session uses is what a reload reads back. */
export const withSettings = (s: Settings, change: { grid?: unknown; snap?: unknown }): Settings =>
  ({ grid: whole(change.grid, 0, s.grid), snap: typeof change.snap === 'boolean' ? change.snap : s.snap })

export function loadSettings(store: Store = local()): Settings {
  let v: Record<string, unknown> = {}
  try {
    const raw = store?.getItem(KEY), parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') v = parsed as Record<string, unknown>
  } catch { /* unreadable: the defaults */ }
  return withSettings(DEFAULTS, v)
}

export function saveSettings(s: Settings, store: Store = local()) {
  try { store?.setItem(KEY, JSON.stringify(s)) } catch { /* refused: kept for this session only */ }
}

export type DrawDefault = { attrs: Record<string, Value>; links: Record<string, StyleLink> }
export type DrawDefaults = Record<string, DrawDefault>
const DRAW_KEY = 'vb.drawDefaults'
const DRAW_OPS = new Set(['R', 'C', 'Y', 'L', 'SP', 'T', 'P', 'SC', 'IMG', 'G'])
export const defaultKey = (n: SrcNode) => foldKey(n.op) === 'SP' && typeof first(n, 'CLOSE') === 'number' && (first(n, 'CLOSE') as number) > 0.5 ? 'SPclosed' : foldKey(n.op)
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const validValue = (v: unknown): v is Value => {
  const stack = [v]
  while (stack.length) {
    const x = stack.pop()
    if (Array.isArray(x)) { for (const v of x) stack.push(v) }
    else if (typeof x === 'number' ? !Number.isFinite(Math.fround(x)) : typeof x !== 'string' || x.includes('\r') || /^[=$]/.test(x)) return false
  }
  return true
}
const literalStyle = (op: string, key: string, value: unknown): value is Value => {
  const field = fieldOf(op, key)
  if (!field || !validValue(value)) return false
  const mode = modeOf(value, field)
  return mode === 'literal' || mode === 'gradient'
}
/** Stored defaults contain style only; outside records never supply node structure or browser settings. */
export function loadDrawDefaults(store: Store = local()): DrawDefaults {
  try {
    const raw: unknown = JSON.parse(store?.getItem(DRAW_KEY) ?? '{}'), out: DrawDefaults = {}
    if (!object(raw)) return out
    for (const [key, v] of Object.entries(raw)) {
      const op = key === 'SPclosed' ? 'SP' : key
      if (!DRAW_OPS.has(op) || !object(v) || !object(v.attrs)) continue
      const attrs = Object.fromEntries(Object.entries(v.attrs).filter(([k, x]) => isStyle(op, k) && literalStyle(op, k, x))) as Record<string, Value>
      const links = object(v.links) ? Object.fromEntries(Object.entries(v.links).filter(([k, l]) => isStyle(op, k) && isStyleLink(l) && (!Object.hasOwn(v.attrs as object, k) || Object.hasOwn(attrs, k)))) as Record<string, StyleLink> : {}
      out[key] = { attrs, links }
    }
    return out
  } catch { return {} }
}
export function saveDrawDefaults(s: DrawDefaults, store: Store = local()): boolean {
  try { if (!store) return false; store.setItem(DRAW_KEY, JSON.stringify(s)); return true } catch { return false }
}
export function defaultOf(n: SrcNode, t: Theme): DrawDefault {
  const attrs = Object.fromEntries(Object.entries(styleOf(n)).filter(([k, v]) => literalStyle(n.op, k, v)))
  const links = Object.fromEntries(Object.entries(linksOf(resolveLinks(n, t, t).node)).filter(([k]) => !Object.hasOwn(n.attrs, k) || Object.hasOwn(attrs, k)))
  return { attrs, links }
}
