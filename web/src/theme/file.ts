import { sameData } from '../model/same'
import { sanitizeAnatomy } from '../widgets/anatomy'
import { NO_CTX, sanitize } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import type { Json } from '../widgets/types'
import { gasColours, ROLES, STYLES, THEMES } from './index'
import { linesOf } from './faces'
import { metricsFor } from './metrics'
import type { Paint, PaintPart, ShadowSpec, Theme, TypeStyle } from './types'

export const THEME_FILE = 'vectorbuilder-theme'
export type ThemeFile = { format: typeof THEME_FILE; v: 1; theme: { name: string } & Partial<Omit<Theme, 'id' | 'name'>> }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const own = (v: Record<string, unknown>, k: string): unknown => Object.hasOwn(v, k) ? v[k] : undefined
const record = <T>(): Record<string, T> => Object.create(null)
const reserved = (k: string) => k === '__proto__' || k === 'constructor' || k === 'prototype'
const token = (k: string) => !reserved(k) && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(k)
const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(v)
const text = (v: unknown): v is string => typeof v === 'string' && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v)
// Validate float32 range without changing the authored decimals of the provided themes.
const number = (v: unknown, min = -Infinity, max = Infinity): v is number =>
  typeof v === 'number' && Number.isFinite(Math.fround(v)) && v >= min && v <= max
const THEME_KEYS = ['name', 'colors', 'gradients', 'shadows', 'type', 'geo', 'parts', 'metrics', 'stateWords', 'pressed', 'drawText', 'anatomy', 'widgetDefaults']

/** Copy known, sanitized data without retaining mutable records from the base or the input. */
function copy<T>(v: T): T {
  if (typeof v !== 'object' || v === null) return v
  const out = Array.isArray(v) ? [] : record<unknown>()
  const stack: { from: object; to: Record<string, unknown> }[] = [{ from: v, to: out as Record<string, unknown> }]
  while (stack.length) {
    const { from, to } = stack.pop()!
    for (const [k, x] of Object.entries(from)) {
      if (typeof x !== 'object' || x === null) to[k] = x
      else {
        const child = Array.isArray(x) ? [] : record<unknown>()
        to[k] = child; stack.push({ from: x, to: child as Record<string, unknown> })
      }
    }
  }
  return out as T
}

export function importedId(name: string, taken: ReadonlySet<string>): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'imported'
  let id = 'ds-' + slug, n = 2
  while (taken.has(id) || Object.hasOwn(THEMES, id)) {
    const suffix = '-' + n++; id = 'ds-' + slug.slice(0, 64 - suffix.length) + suffix
  }
  return id
}

export function themeFileOf(t: Theme): ThemeFile {
  const theme = record<unknown>()
  for (const k of THEME_KEYS) if (Object.hasOwn(t, k)) theme[k] = copy(t[k as keyof Theme])
  const colors = theme.colors as Theme['colors']
  for (const k of Object.keys(colors)) if (Object.hasOwn(gasColours, k)) delete colors[k]
  return { format: THEME_FILE, v: 1, theme: theme as ThemeFile['theme'] }
}

/** The one reader of a theme file, including project and browser storage. */
export function sanitizeTheme(v: unknown, base: Theme, o: { id?: string; taken: ReadonlySet<string> }): { theme?: Theme; notes: string[] } {
  if (!object(v) || own(v, 'format') !== THEME_FILE || own(v, 'v') !== 1 || !object(own(v, 'theme'))) {
    return { notes: ['theme: expected a vectorbuilder-theme file at version 1'] }
  }
  const notes: string[] = [], note = (path: string, why: string) => { notes.push(`${path}: ${why}`) }
  const keys = (raw: Record<string, unknown>, allowed: readonly string[] | undefined, path: string) => {
    for (const k of Object.keys(raw)) if (reserved(k) || allowed && !allowed.includes(k)) note(path ? path + '.' + k : k, 'unknown key dropped')
  }
  const input = own(v, 'theme') as Record<string, unknown>
  keys(v, ['format', 'v', 'theme'], ''); keys(input, THEME_KEYS, 'theme')
  const section = (raw: unknown, path: string, allowed?: readonly string[]): Record<string, unknown> => {
    if (!object(raw)) { if (raw !== undefined) note(path, 'expected a record'); return record<unknown>() }
    keys(raw, allowed, path); return raw
  }
  const field = <T>(raw: Record<string, unknown>, k: string, path: string, fallback: T, valid: (x: unknown) => x is T): T => {
    const x = own(raw, k)
    if (valid(x)) return copy(x)
    note(path + '.' + k, x === undefined ? 'filled from ' + base.name : 'invalid value; filled from ' + base.name)
    return copy(fallback)
  }
  const rawName = own(input, 'name')
  let name = typeof rawName === 'string' ? rawName.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '') : ''
  if (!name.trim()) name = 'Imported theme'
  if (name !== rawName) note('theme.name', 'invalid or empty name; using ' + JSON.stringify(name))
  const id = o.id && /^ds-[a-z0-9-]{1,64}$/.test(o.id) && !o.taken.has(o.id) && !Object.hasOwn(THEMES, o.id) ? o.id : importedId(name, o.taken)
  if (o.id !== undefined && id !== o.id) note('theme.id', 'replaced with ' + id)
  const colors = record<string>(), rawColors = section(own(input, 'colors'), 'theme.colors')
  for (const k of Object.keys(rawColors)) {
    const x = own(rawColors, k)
    if (reserved(k)) continue
    if (Object.hasOwn(gasColours, k)) note('theme.colors.' + k, 'shared gas colour dropped')
    else if (!token(k) || !hex(x)) note('theme.colors.' + k, 'expected a token name and #rrggbb or #rrggbbaa')
    else colors[k] = x.toUpperCase()
  }
  for (const k of ROLES) if (!Object.hasOwn(colors, k)) { colors[k] = base.colors[k]; note('theme.colors.' + k, 'filled from ' + base.name) }
  Object.assign(colors, gasColours)
  const color = (x: unknown): x is string => typeof x === 'string' && Object.hasOwn(colors, x)
  const gradients = record<[string, string]>(), rawGradients = section(own(input, 'gradients'), 'theme.gradients')
  for (const k of Object.keys(rawGradients)) {
    if (reserved(k)) continue
    const x = own(rawGradients, k)
    if (!Array.isArray(x) || x.length !== 2 || ![0, 1].every(i => Object.hasOwn(x, i) && color(x[i]))) note('theme.gradients.' + k, 'expected two own colour keys')
    else gradients[k] = [x[0], x[1]]
  }
  const shadows = record<ShadowSpec[]>(), rawShadows = section(own(input, 'shadows'), 'theme.shadows')
  for (const k of Object.keys(rawShadows)) {
    if (reserved(k)) continue
    const x = own(rawShadows, k), path = 'theme.shadows.' + k
    if (!Array.isArray(x)) { note(path, 'expected a shadow list'); continue }
    shadows[k] = []
    for (let i = 0; i < x.length; i++) {
      const s: unknown = Object.hasOwn(x, i) ? x[i] : undefined
      if (!Array.isArray(s) || (s.length !== 5 && s.length !== 6) || ![0, 1, 2, 3].every(i => Object.hasOwn(s, i) && number(s[i])) || !number(s[2], 0)
        || !Object.hasOwn(s, 4) || !(color(s[4]) || hex(s[4])) || s.length === 6 && (!Object.hasOwn(s, 5) || s[5] !== 'inset')) note(path + '.' + i, 'invalid shadow dropped')
      else shadows[k].push([s[0], s[1], s[2], s[3], hex(s[4]) ? s[4].toUpperCase() : s[4], ...s.length === 6 ? ['inset' as const] : []] as ShadowSpec)
    }
  }
  // A filled base part/style also needs its base's referenced tokens and effects.
  const baseColor = (k: string) => {
    if (!Object.hasOwn(colors, k)) { colors[k] = base.colors[k]; note('theme.colors.' + k, 'filled from ' + base.name) }
  }
  const baseShadow = (k: string) => {
    if (Object.hasOwn(shadows, k)) return
    shadows[k] = copy(base.shadows[k]); note('theme.shadows.' + k, 'filled from ' + base.name)
    for (const s of shadows[k]) if (!hex(s[4])) baseColor(s[4])
  }
  const basePaint = (p: Paint | undefined) => {
    if (typeof p === 'string' && p !== 'none' && p !== 'state') baseColor(p)
    else if (typeof p === 'object' && !Object.hasOwn(gradients, p.gradient)) {
      gradients[p.gradient] = copy(base.gradients[p.gradient]); note('theme.gradients.' + p.gradient, 'filled from ' + base.name)
      for (const c of gradients[p.gradient]) baseColor(c)
    }
  }
  const type = record<TypeStyle>() as Theme['type'], rawType = section(own(input, 'type'), 'theme.type', STYLES)
  for (const k of STYLES) {
    const path = 'theme.type.' + k, source = own(rawType, k), raw = section(source, path, ['font', 'size', 'cspace', 'upper', 'ink', 'shadow', 'weight'])
    const d = base.type[k]
    if (!Object.hasOwn(rawType, k)) note(path, 'filled from ' + base.name)
    const ink = field(raw, 'ink', path, d.ink, color)
    baseColor(ink)
    type[k] = Object.assign(record<unknown>(), {
      font: field(raw, 'font', path, d.font, text), size: field(raw, 'size', path, d.size, (x): x is number => number(x) && x > 0),
      cspace: field(raw, 'cspace', path, d.cspace, number), upper: field(raw, 'upper', path, d.upper, (x): x is boolean => typeof x === 'boolean'), ink,
    }) as TypeStyle
    for (const key of ['shadow', 'weight'] as const) {
      const x = own(raw, key)
      if (x === undefined && !Object.hasOwn(raw, key)) {
        if (!object(source) && d[key] !== undefined) {
          if (key === 'shadow') { baseShadow(d.shadow!); type[k].shadow = d.shadow }
          else type[k].weight = d.weight
        }
      } else if (key === 'shadow' && typeof x === 'string' && Object.hasOwn(shadows, x)) type[k].shadow = x
      else if (key === 'weight' && x === 'bold') type[k].weight = x
      else note(path + '.' + key, 'invalid ' + key + ' dropped')
    }
    if (!linesOf(type[k].font)) note(path + '.font', 'unknown face lines; using Liberation Sans for derived metrics')
  }
  const geo = record<unknown>(), rawGeo = section(own(input, 'geo'), 'theme.geo', Object.keys(base.geo))
  const geoStack = [{ raw: rawGeo, out: geo, defaults: base.geo as unknown as Record<string, unknown>, path: 'theme.geo' }]
  while (geoStack.length) {
    const { raw, out, defaults, path } = geoStack.pop()!
    for (const k of Object.keys(defaults)) {
      const d = defaults[k]
      if (object(d)) {
        const child = record<unknown>(); out[k] = child
        geoStack.push({ raw: section(own(raw, k), path + '.' + k, Object.keys(d)), out: child, defaults: d, path: path + '.' + k })
      } else out[k] = field(raw, k, path, d as number, (x): x is number => number(x, 0))
    }
  }
  const parts = record<PaintPart>() as Theme['parts'], rawParts = section(own(input, 'parts'), 'theme.parts', Object.keys(base.parts))
  const paint = (x: unknown, path: string): Paint | undefined => {
    if (color(x) || x === 'state' || x === 'none') return x
    if (object(x)) {
      keys(x, ['gradient'], path)
      const g = own(x, 'gradient')
      if (typeof g === 'string' && Object.hasOwn(gradients, g)) return Object.assign(record<string>(), { gradient: g })
    }
    note(path, 'unknown paint dropped'); return undefined
  }
  for (const k of Object.keys(base.parts) as (keyof Theme['parts'])[]) {
    const path = 'theme.parts.' + k, x = own(rawParts, k), d = base.parts[k]
    if (!object(x)) {
      if (x !== undefined) note(path, 'expected a record')
      note(path, 'filled from ' + base.name); parts[k] = copy(d)
      basePaint(d.fill); basePaint(d.stroke); if (d.ink) baseColor(d.ink); if (d.shadow) baseShadow(d.shadow)
      continue
    }
    keys(x, ['fill', 'stroke', 'width', 'radius', 'outline', 'shadow', 'ink'], path)
    const p: Record<string, unknown> = record<unknown>(); parts[k] = p as PaintPart
    for (const key of ['fill', 'stroke', 'width', 'radius', 'outline', 'shadow', 'ink']) if (Object.hasOwn(x, key)) {
      const value = own(x, key)
      if (key === 'fill' || key === 'stroke') { const v = paint(value, path + '.' + key); if (v !== undefined) p[key] = v }
      else if ((key === 'width' || key === 'radius') && number(value, 0)
        || key === 'outline' && ['inside', 'centre', 'outside'].includes(value as string)
        || key === 'shadow' && typeof value === 'string' && Object.hasOwn(shadows, value)
        || key === 'ink' && color(value)) p[key] = value
      else note(path + '.' + key, 'invalid ' + key + ' dropped')
    }
  }
  const theme = Object.assign(record<unknown>(), { id, name, colors, gradients, shadows, type, geo, parts }) as unknown as Theme
  const derived = metricsFor(type, theme.geo, linesOf), metrics = record<number>() as Theme['metrics']
  const rawMetrics = section(own(input, 'metrics'), 'theme.metrics', Object.keys(derived))
  for (const k of Object.keys(derived) as (keyof Theme['metrics'])[]) {
    const x = own(rawMetrics, k)
    if (number(x)) metrics[k] = x
    else {
      if (x !== undefined) note('theme.metrics.' + k, 'invalid number dropped')
      if (number(derived[k])) { metrics[k] = derived[k]; note('theme.metrics.' + k, 'filled from type and geo rules') }
      else { metrics[k] = base.metrics[k]; note('theme.metrics.' + k, 'derived value exceeds float32; filled from ' + base.name) }
    }
  }
  theme.metrics = metrics
  const words = own(input, 'stateWords')
  // A tab is kept (whitespace the label draws); every other control character and line break is refused.
  if (Array.isArray(words) && words.length === 3 && [0, 1, 2].every(i => Object.hasOwn(words, i) && typeof words[i] === 'string' && !/[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/.test(words[i]))) theme.stateWords = [words[0], words[1], words[2]]
  else { theme.stateWords = copy(base.stateWords); note('theme.stateWords', 'expected three strings without line breaks or control characters other than tab; filled from ' + base.name) }
  theme.pressed = field(input, 'pressed', 'theme', base.pressed, (x): x is number => number(x, 0, 1))
  theme.drawText = field(input, 'drawText', 'theme', base.drawText, (x): x is Theme['drawText'] => typeof x === 'string' && STYLES.includes(x as Theme['drawText']))
  if (Object.hasOwn(input, 'anatomy')) {
    const result = sanitizeAnatomy(own(input, 'anatomy'), theme)
    if (result.anatomy) theme.anatomy = result.anatomy
    for (const n of result.notes) notes.push('theme.anatomy.' + n)
  }
  if (Object.hasOwn(input, 'widgetDefaults')) {
    const raw = section(own(input, 'widgetDefaults'), 'theme.widgetDefaults'), defaults = record<Record<string, Json>>()
    theme.widgetDefaults = defaults
    for (const k of Object.keys(raw)) {
      if (reserved(k)) continue
      const path = 'theme.widgetDefaults.' + k
      if (!Object.hasOwn(WIDGETS, k)) { note(path, 'unknown widget dropped'); continue }
      const m = WIDGETS[k], d = m.defaults(theme, NO_CTX), given = section(own(raw, k), path), allowed = Object.keys(d).filter(key => key !== 'x' && key !== 'y')
      const candidate = record<unknown>()
      for (const key of Object.keys(given)) {
        if (reserved(key)) continue
        if (!allowed.includes(key)) note(path + '.' + key, 'unknown or placement parameter dropped')
        else candidate[key] = own(given, key)
      }
      const clean = sanitize(m, { ...d, ...candidate }, theme), kept = record<Json>()
      for (const key of Object.keys(candidate)) {
        if (!Object.hasOwn(clean, key) || !sameData(candidate[key], clean[key])) { note(path + '.' + key, 'widget sanitizer changes this value; dropped'); continue }
        let safe = true
        const stack = [{ value: clean[key], path: path + '.' + key }]
        while (stack.length) {
          const item = stack.pop()!
          if (typeof item.value !== 'object' || item.value === null) continue
          for (const [k, value] of Object.entries(item.value)) {
            if (reserved(k)) { note(item.path + '.' + k, 'prototype key dropped'); safe = false }
            else stack.push({ value, path: item.path + '.' + k })
          }
        }
        if (safe) kept[key] = copy(clean[key])
        else note(path + '.' + key, 'contains prototype keys; dropped')
      }
      defaults[k] = kept
    }
  }
  return { theme, notes }
}
