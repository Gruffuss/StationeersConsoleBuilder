// Widget test helpers, imported by tests only. The checker is reached through srctext/testing.ts (M2a's boundary test reads
// this file too, and only srctext/ may name the checker).
import { expect } from 'vitest'
import { boxOf } from '../editor/geometry'
import type { Scene, SrcNode, Value } from '../model/scene'
import { printChecked } from '../srctext/print'
import { first } from '../srctext/props'
import { problemsOf } from '../srctext/testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { THEMES } from '../theme'
import type { Theme } from '../theme/types'
import { expandRoot, sanitize } from './core'
import { el, textNames } from './paint'
import { WIDGETS } from './registry'
import type { Box, Ctx, Expansion, Params, WidgetModule, WidgetRef } from './types'
import { HOOKS } from './anatomy'

/** Full-box ornaments expose draw ordering between labels that share a style. */
export const allHooks: Theme = { ...THEMES.neutral, id: 'all-hooks', anatomy: { v: 1, looks:
  Object.fromEntries([...HOOKS.keys()].map(hook => [hook, { add: [{ name: 'box', op: 'rect', fill: 'accent' }] }])) } }

// An owned-def probe keeps generic copy/delete coverage independent of the duct's production anatomy.
export const clipProbe: WidgetModule = { ...WIDGETS.duct, type: 'clipprobe',
  expand(p, t, uid) {
    const e = WIDGETS.duct.expand(p, t, uid), { x, y, w, h } = p as Box
    return { ...e, nodes: [el('G', { clip: `${uid}_clip` }, e.nodes)],
      defs: [el('CP', { id: `${uid}_clip` }, [el('R', { x, y, w, h })])] }
  },
}

export const TEST_CTX: Ctx = { pages: [{ id: 'p1', name: 'Main' }, { id: 'p2', name: 'Power' }], page: 'p1', size: { w: 480, h: 480 } }
/** A widget of `type`: its defaults (TEST_CTX), `over` laid on top, sanitized; uid prefix + 1 unless given. */
export function instance(type: string, over: Params = {}, uid?: string): WidgetRef {
  const m = WIDGETS[type]
  return { type, uid: uid ?? m.prefix + '1', params: sanitize(m, { ...m.defaults(vanillaPlus, TEST_CTX), ...over }, vanillaPlus) }
}
/** Every variant named by a module's params, including legacy fixture inks. */
export function variants(type: string): Params[] {
  const m = WIDGETS[type], d = instance(type).params, out: Params[] = [{}]
  for (const p of m.params) {
    if (p.type === 'enum') for (const v of type === 'glyph' && p.key === 'ink' ? Object.keys(vanillaPlus.colors) : p.enum) out.push({ [p.key]: v })
    if (p.type === 'flag') out.push({ [p.key]: true })
    if (p.type === 'list') { const l = d[p.key] as Params[]; out.push({ [p.key]: [l[0], l[0], l[0]] }) }
  }
  return out
}

export const bracket: Theme & { anatomy: NonNullable<Theme['anatomy']> } = { ...THEMES.neutral, id: 'bracket', anatomy: { v: 1, looks: {
  panel: { add: [
    { name: 'mark-tl', op: 'line', p: [[[0,-4],[0,12]], [[0,-4],[0,-4]], [[0,12],[0,-4]]], stroke: 'border-strong', width: 2, cap: 'square' },
    { name: 'mark-tr', op: 'line', p: [[[1,-12],[0,-4]], [[1,4],[0,-4]], [[1,4],[0,12]]], stroke: 'border-strong', width: 2, cap: 'square' },
    { name: 'mark-br', op: 'line', p: [[[1,4],[1,-12]], [[1,4],[1,4]], [[1,-12],[1,4]]], stroke: 'border-strong', width: 2, cap: 'square' },
    { name: 'mark-bl', op: 'line', p: [[[0,12],[1,4]], [[0,-4],[1,4]], [[0,-4],[1,-12]]], stroke: 'border-strong', width: 2, cap: 'square' },
  ] },
  'button.primary': { shape: { op: 'cut', cut: [8,0,8,0] } },
  'button.secondary': { add: [{ name: 'notch', op: 'poly', p: [[[1,-10],[0,0]], [[1,0],[0,0]], [[1,0],[0,10]]], fill: 'accent' }] },
  row: { add: [{ name: 'accent', op: 'rect', frame: { l: [0,0], t: [0,0], r: [0,3], b: [1,0] }, fill: 'accent' }] },
  'eventlog/row': { shape: { op: 'cut', cut: [6,6,6,6] } },
  'light.idle': { shape: { op: 'rect', radius: 2 } }, 'light.ok': { shape: { op: 'rect', radius: 2 } },
  'light.warn': { shape: { op: 'rect', radius: 2 } }, 'light.crit': { shape: { op: 'rect', radius: 2 } },
  chip: { shape: { op: 'rect', radius: 9999 } },
  header: { shape: 'none', add: [{ name: 'rule', op: 'rect', frame: { l: [0,0], t: [1,-2], r: [1,0], b: [1,0] }, fill: 'accent' }] },
  fill: { shape: { op: 'rect', radius: [0,4,4,0] }, add: [{ name: 'cap', op: 'rect', frame: { l: [1,-2], t: [0,0], r: [1,0], b: [1,0] }, fill: 'text' }] },
  knob: { shape: { op: 'cut', cut: [4,4,4,4] } },
  'duct.flow': { shape: 'none' },
  'gauge.needle': { add: [{ name: 'tail', op: 'line', p: [[[0.5,0],[1,0]], [[0.5,0],[1,12]]], stroke: 'accent', width: 3 }] },
  'text:panel-title': { add: [{ name: 'rule', op: 'rect', frame: { l: [0,0], t: [1,-2], r: [1,0], b: [1,0] }, fill: 'border' }] },
  glyph: { add: [{ name: 'disc', op: 'ellipse', fill: 'surface-row', under: true }] },
} } }
export function sceneOf(w: WidgetRef, t = vanillaPlus): Scene {
  const { root, defs } = expandRoot(w, t)
  return { header: { w: 480, h: 480, fit: 'contain' }, defs, root: [root] }
}
/** The widget's scene printed, one trimmed line each. */
export const printed = (w: WidgetRef, t = vanillaPlus) => printChecked(sceneOf(w, t)).split('\n').map(l => l.trim())
/** What the checker (M2a T4 and T13) says about the widget's scene: errors, then warnings. */
export const checked = (w: WidgetRef, t = vanillaPlus) => problemsOf(sceneOf(w, t))
/** Widgets can move through parent frames only because none owns a scene-coordinate clip. */
export function noClip(nodes: SrcNode[]) {
  const stack = [...nodes]
  for (let n = stack.pop(); n; n = stack.pop()) {
    expect(n.op.toUpperCase()).not.toBe('CP')
    expect(Object.keys(n.attrs).some(k => k.toLowerCase() === 'clip')).toBe(false)
    for (const child of n.c ?? []) stack.push(child)
  }
}
export const rules = (w: WidgetRef, t = vanillaPlus) => {
  const r = expandRoot(w, t), own = expandRoot(w, { ...t, anatomy: undefined }).root
  return rulesOf(r.root, r.defs, r.exp, w.uid, own)
}
/** Every variant (defaults when none) breaks no rule and draws no word from the checker. */
export function holds(type: string, ...variants: Params[]) {
  for (const variant of variants.length ? variants : [{}]) {
    const w = instance(type, variant)
    expect({ variant, problems: [...rules(w), ...checked(w)] }).toEqual({ variant, problems: [] })
  }
}

const SHAPES = new Set(['R', 'C', 'L', 'Y', 'P', 'SP', 'LS', 'YS'])
const TEXTS = new Set(['TEXT', 'FMT', 'UNIT', 'MISSING'])
const strings = (v: Value): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : []
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
/** The data names a value reads: in text, textNames' (a whole $name, {$name…}, a $name inside {=…}); elsewhere any $name
 *  of an expression or a $ value. */
const reads = (K: string, s: string) => TEXTS.has(K) ? textNames(s)
  : s[0] === '=' || s[0] === '$' ? [...s.matchAll(/\$([\p{L}\p{Nd}_\u{10000}-\u{10FFFF}]+)/gu)].map(m => m[1]) : []   // ReadName's names

/** Every rule an expansion breaks, as messages; [] when it keeps them all. The rules E1-E16 are those of the M2b
 *  plan's Task 2. */
export function rulesOf(root: SrcNode, defs: SrcNode[], exp: Expansion, uid: string, own?: SrcNode): string[] {
  const out: string[] = [], keys = new Set(exp.slots.map(s => s.key)), read = new Set<string>()
  const eased = exp.slots.filter(s => !s.snap).map(s => s.key), defIds = new Set(defs.map(d => String(first(d, 'ID'))))
  for (const id of defIds) if (!id.startsWith(uid + '_') && !id.startsWith('theme_')) out.push(`E2: def ${id} is not ${uid}_… or theme_…`)
  for (const d of defs) if (/^(SYM|USE)$/i.test(d.op)) out.push(`E1: ${d.op} in defs`)
  const clickable = (n: SrcNode) => Number(first(n, 'CLICK') ?? 0) > 0.5 || Number(first(n, 'PRESS') ?? 0) > 0.5
  const painted = (n: SrcNode) => first(n, 'F') !== undefined || first(n, 'S') !== undefined
  type F = { n: SrcNode; ids: string[]; depth: number; parent: SrcNode | null }
  const walk = (visit: (f: F) => void, from = root) => {
    const stack: F[] = [{ n: from, ids: [], depth: 0, parent: null }]
    for (let f = stack.pop(); f; f = stack.pop()) {
      visit(f)
      const id = first(f.n, 'ID'), ids = typeof id === 'string' ? [...f.ids, id] : f.ids, kids = f.n.c ?? []
      for (let k = kids.length - 1; k >= 0; k--) stack.push({ n: kids[k], ids, depth: f.depth + 1, parent: f.n })
    }
  }
  const scopes = new Set<string>(), plates: string[] = []
  walk(({ n, ids }) => {
    if (!clickable(n)) return
    const id = String(first(n, 'ID') ?? '')
    plates.push(id)
    for (const x of [...ids, id]) scopes.add(x)
  })
  const labels: Box[] = []
  walk(({ n, ids, depth, parent }) => {
    const op = n.op.toUpperCase(), id = first(n, 'ID'), own = typeof id === 'string', where = own ? `${n.op} ${id}` : n.op
    if (depth > 6) out.push(`E15: ${where} is ${depth} levels deep`)
    if (op === 'SYM' || op === 'USE') out.push(`E1: ${where}`)
    if (n !== root && own && !id.startsWith(uid + '_')) out.push(`E2: id ${id} is not ${uid}_…`)
    for (const [k, v] of Object.entries(n.attrs)) {
      const K = k.toUpperCase()
      for (const s of strings(v)) {
        for (const name of reads(K, s)) { read.add(name); if (!keys.has(name)) out.push(`E2: $${name} is no slot key`) }
        if ((K === 'F' || K === 'S') && s[0] === '@' && !defIds.has(s.slice(1))) out.push(`E16: ${s} has no def`)
        if ((K === 'F' || K === 'S') && /^\$\w+\[/.test(s)) out.push(`E12: ${k} on ${where} reads a colour array`)
        if (s[0] === '=' && /\b(hover|down)\b/.test(s) && !clickable(n) && (own || !scopes.has(ids[ids.length - 1])))
          out.push(`E4: ${k} on ${where} reads hover/down outside its button`)
        for (const e of eased) if (s.includes(`eq($${e}`) || (K === 'V' && s.includes('$' + e))) out.push(`E7: ${where} reads eased $${e} as a state`)
        if ((K === 'W' || K === 'H') && s.includes('$') && !s.includes('clamp(')) out.push(`E8: ${k} on ${where} is not clamped`)
      }
    }
    if (clickable(n) && (op !== 'R' || !own || painted(n))) out.push(`E3: ${where} is clickable but not an unpainted R with an id`)
    if (first(n, 'CLIP') !== undefined && !(op === 'G' && parent === root)) out.push(`E13: clip on ${where}`)
    if (op === 'T') {
      const text = String(first(n, 'TEXT') ?? ''), size = Number(first(n, 'SIZE')), h = first(n, 'H')
      const ellipsis = String(first(n, 'FIT') ?? '').toLowerCase() === 'ellipsis'
      const font = first(n, 'FONT'), weight = first(n, 'WEIGHT')
      if (weight !== undefined && (font !== undefined || weight !== 'bold')) out.push(`E10: weight on ${where}`)
      if (ellipsis && typeof h === 'number' && h < 1.4 * size - 1e-3) out.push(`E9: ${where} ellipsis box ${h} < 1.4 × ${size}`)
      if (/^\$\w+(\[.*\])?$/.test(text) && !ellipsis) out.push(`E9: ${where} shows a data string without fit=ellipsis`)
      if (/^\$\w+\[/.test(text) && first(n, 'MISSING') !== '') out.push(`E12: ${where} reads a text array without missing=""`)
      const b = boxOf(n)
      if (b) labels.push(b)
    } else if (SHAPES.has(op) && painted(n)) {
      const b = boxOf(n)
      if (b && labels.some(l => overlap(l, b))) out.push(`E5: ${where} is drawn over an earlier label`)
    }
  })
  const used = own ? new Set<string>() : read
  // Anatomy may remove a slot's sole reader; declarations still belong to the module's own drawing.
  if (own) walk(({ n }) => {
    for (const [k, v] of Object.entries(n.attrs)) for (const s of strings(v))
      for (const name of reads(k.toUpperCase(), s)) used.add(name)
  }, own)
  for (const k of keys) if (!used.has(k)) out.push(`E2: slot key ${k} is never read`)
  const listed = (exp.clicks ?? []).map(c => c.id)
  for (const p of plates) if (!listed.includes(p)) out.push(`clicks: ${p} is not listed`)
  for (const c of listed) if (!plates.includes(c)) out.push(`clicks: ${c} has no plate`)
  return out
}
