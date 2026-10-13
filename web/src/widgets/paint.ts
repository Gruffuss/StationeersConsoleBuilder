// Theme tokens resolved to src literals, and the pieces several widgets draw alike (Vanilla + anatomy). Pure.
import { placeholderClose, formatColon } from '../srctext/placeholders'
import type { SrcNode, Value } from '../model/scene'
import { numberOf } from '../srctext/parse'
import { colour } from '../theme'
import type { PartName, StyleName, Theme } from '../theme/types'
import type { Param } from './types'
import { el, num, paintOf, plus, pos, shadow, st4, type At } from './draw'
export { el, num, paintOf, plus, pos, shadow, st4, fill, type At } from './draw'
import { dress, namedParts } from './dress'

const tags = new WeakMap<SrcNode, string>()
/** A semantic name kept outside src, on the module's fresh node. */
export function tag<T extends SrcNode>(name: string, n: T): T { namedParts(n, name, (part, key) => tags.set(part, key)); return n }
export const tagOf = (n: SrcNode): string | undefined => tags.get(n)

/** Keep list keys unique after a removal or a legacy marker without keys. */
export function keyed<T extends { key: number }>(rows: T[]): T[] {
  const seen = new Set<number>()
  let top = -1
  return rows.map(r => {
    let key = r.key
    if (seen.has(key)) {
      key = Math.fround(top + 1)
      // At large float32 keys, +1 repeats or overflows; take the first unused integer instead.
      if (!Number.isFinite(key) || seen.has(key)) { key = 0; while (seen.has(key)) key++ }
    }
    seen.add(key)
    top = Math.max(top, key)
    return key === r.key ? r : { ...r, key }
  })
}

export const pressedOf = (t: Theme) => '=1-' + num(t.pressed) + '*down'

/** x y w h, the four params every module starts with: any size the mod draws, 0 included (ruling 13). A module whose
 *  fit=ellipsis labels need a height gets it in its fix, from its theme's type sizes (oneLine). */
export const box = (): Param[] =>
  [{ key: 'x', name: 'X position', type: 'num' }, { key: 'y', name: 'Y position', type: 'num' }, { key: 'w', name: 'Width', type: 'num', min: 0 },
    { key: 'h', name: 'Height', type: 'num', min: 0 }]
/** The height a fit=ellipsis label in any of `styles` needs to draw its line: 1.4 × the style's size, TMP's limit (ruling
 *  13), read from the theme so a preset with other sizes keeps it (E9). */
export const oneLine = (t: Theme, ...styles: StyleName[]) => Math.max(0, ...styles.map(s => 1.4 * t.type[s].size))
export const KEYS: Param = { key: 'keys', name: 'Data names', type: 'keys' }
/** A module's slotName from a table of its slot keys. */
export const named = (names: Record<string, string>) => (slot: string): string | undefined => Object.hasOwn(names, slot) ? names[slot] : undefined
/** How labels alone read a slot's data name: the label text written for a name (`$name`, `{$name:%.1f}`, `$name[i]`). */
export type LabelText = (name: string) => string
/** Whether `name`, written where the slot reads it, reads back as that one name: in an expression (no `text`) a name of
 *  letters, digits, _ and supplementary-plane characters (DATA_NAME); in labels alone, whatever the mod's text binding
 *  reads back whole (textNames: no `}`, no `:` or `[` where a format or an index follows, no trailing `[index]`, and so
 *  on), never a CR (src cannot hold one). */
export function readsBack(name: string, text?: LabelText): boolean {
  if (!text) return DATA_NAME.test(name)
  if (name === '' || name.includes('\r')) return false
  const n = textNames(text(name))
  return n.length === 1 && n[0] === name
}
/** A slot's data name: the player's rename when it reads back where the slot is read (readsBack), else <uid>_<slot>.
 *  `text`: how labels alone read the slot; without it an expression reads it. Read by Object.hasOwn: a rename of a slot
 *  named like an Object.prototype member is never confused with one. */
export function keyOf(p: { keys?: unknown }, uid: string, slot: string, text?: LabelText): string {
  const keys = p.keys, r = typeof keys === 'object' && keys !== null && Object.hasOwn(keys, slot) ? (keys as Record<string, unknown>)[slot] : undefined
  return typeof r === 'string' && readsBack(r, text) ? r : `${uid}_${slot}`
}
/** How each label text form reads a slot: the whole text, a placeholder with a format, an item of a list. */
export const WHOLE: LabelText = n => '$' + n
export const placeholder = (fmt: string): LabelText => n => `{$${n}:${fmt}}`
export const ITEM: LabelText = n => `$${n}[i]`
export const itemPlaceholder = (fmt: string): LabelText => n => `{$${n}[i]:${fmt}}`

/** `base` unless the state is warn or crit: a reading out of range (ok stays white, not green). */
export const ink = (t: Theme, k: string, base: string) =>
  `=if(eq(${k},2),${colour(t, 'status-warn')},if(eq(${k},3),${colour(t, 'status-crit')},${base}))`
export const inkOf = (t: Theme, style: StyleName) => colour(t, t.type[style].ink)
export const levelPaint = (t: Theme, lvl: string, critBelow: number, warnBelow: number) =>
  `=if(lt(${lvl},${num(critBelow)}),${colour(t, 'status-crit')},if(lt(${lvl},${num(warnBelow)}),${colour(t, 'status-warn')},${colour(t, 'status-ok')}))`
/** Whether the theme has the gradient `name` (a `@theme_<name>` reference names one only when this holds). */
export const hasGradient = (t: Theme, name: string) => Object.hasOwn(t.gradients, name)
/** The `theme_<name>` def; a name the theme lacks throws, as colour() does for a role. */
export function gradientDef(t: Theme, name: string): SrcNode {
  if (!hasGradient(t, name)) throw new Error(`the theme "${t.name}" has no gradient "${name}"`)
  const [top, bottom] = t.gradients[name]
  return el('GL', { id: 'theme_' + name, units: 'bbox', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, colour(t, top)], [1, colour(t, bottom)]] })
}
// What an expression name reads (the mod's Expression.ReadName): char.IsLetterOrDigit or _, any script, and since vector
// 0.11.98 a surrogate pair whole, a letter or not (an unpaired half ends the name). A name labels alone read is whatever
// their binding reads (readsBack).
export const DATA_NAME = /^[\p{L}\p{Nd}_\u{10000}-\u{10FFFF}]+$/u
/** A name a preview value may be kept under: any non-empty text. Every consumer keys by Map, an Object.create(null) record
 *  or Object.hasOwn, so `constructor` or `__proto__` is a name like any other (final-wave ruling 2). The one check of a
 *  preview key, for the store's load and setPreview and the shell's data element. */
export const previewName = (k: unknown): k is string => typeof k === 'string' && k !== ''

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/
/** Why `s` cannot be a label's literal text, or null. Only what the mod would not print as written: a text starting with `$`
 *  binds data, and a placeholder (`{$` or `{=` with a `}` after it) reads data or computes. Every other text prints as
 *  written: one src reads as a number through literal's template; a leading `=` and a placeholder never closed as they stand
 *  (measured through the mod: labels.json, FrameTests). */
export function plainTextProblem(s: string): string | null {
  if (s[0] === '$') return 'a label cannot start with $: use a Text widget for data'
  const bound = s.indexOf('{$'), computed = s.indexOf('{=')
  const open = bound < 0 ? computed : computed < 0 ? bound : Math.min(bound, computed)
  if (open >= 0 && placeholderClose(s, open) >= 0) return 'a label cannot hold {$ or {=: use a Text widget for data'
  return null
}
// One UTF-16 unit of a name, as the expression lexer reads one (Expression.cs ReadName: char.IsLetterOrDigit or '_'), and
// since vector 0.11.98 a surrogate pair, taken whole.
const NAME_CHAR = /^[\p{L}\p{Nd}_]$/u, HIGH = /^[\uD800-\uDBFF]$/, LOW = /^[\uDC00-\uDFFF]$/
/** The `$name`s an expression reads, in order. A `$` with no name after it reads nothing. */
function exprNames(e: string): string[] {
  const out: string[] = []
  for (let i = e.indexOf('$'); i >= 0; i = e.indexOf('$', i)) {
    let j = ++i
    for (;;) {
      if (j < e.length && NAME_CHAR.test(e[j])) j++
      else if (j + 1 < e.length && HIGH.test(e[j]) && LOW.test(e[j + 1])) j += 2
      else break
    }
    if (j > i) out.push(e.slice(i, j))
    i = j
  }
  return out
}
/** How a text reads a name: in an expression (an index or a `{=…}` placeholder: letters, digits, _ and surrogate pairs),
 *  whole as text (`$name`, `{$name…}`), or as a list item (`$name[…]`, `{$name[…]…}`). */
export type Read = { name: string; via: 'expr' | 'text' | 'item' }
/** A binding's name and index, as SceneModel.SplitBinding splits it: `rows[i]` is rows and i; anything else is all name. */
function bindingReads(b: string, out: Read[]) {
  const open = b.indexOf('[')
  if (open <= 0 || b.length < 3 || b[b.length - 1] !== ']' || open === b.length - 2) { out.push({ name: b, via: 'text' }); return }
  out.push({ name: b.slice(0, open), via: 'item' })
  for (const name of exprNames(b.slice(open + 1, -1))) out.push({ name, via: 'expr' })   // no spread: any number of names
}
/** The data names a T's text reads, in order, as the mod reads them (SceneModel.cs: the T's text, TextTemplate,
 *  SplitBinding). A text whose first character is `$` binds everything after it as one name (`$5.00` reads "5.00"), up to a
 *  trailing `[index]`. Else each `{$name…}` placeholder and each `$name` in a `{=…}` one, plus any `$name` an index reads;
 *  a placeholder runs to its first `}`, and one never closed is literal text, as is everything after it. Names are returned
 *  as the mod reads them, whatever their characters (`$room kPa` reads "room kPa"). Linear time. */
export const textNames = (s: string): string[] => textReads(s).map(r => r.name)
/** textNames, with how each name is read. */
export function textReads(s: string): Read[] {
  const out: Read[] = []
  if (s[0] === '$') { bindingReads(s.slice(1), out); return out }
  // The next {$ and {=, each searched again only once the scan has passed it, so no stretch of text is searched twice.
  let at = 0, bound = s.indexOf('{$'), computed = s.indexOf('{=')
  for (;;) {
    if (bound >= 0 && bound < at) bound = s.indexOf('{$', at)
    if (computed >= 0 && computed < at) computed = s.indexOf('{=', at)
    const open = bound < 0 ? computed : computed < 0 ? bound : Math.min(bound, computed), close = open < 0 ? -1 : placeholderClose(s, open)
    if (close < 0) return out
    const inner = s.slice(open + 2, close)
    if (s[open + 1] === '=') {
      const format = formatColon(inner, false)
      for (const name of exprNames(format < 0 ? inner : inner.slice(0, format))) out.push({ name, via: 'expr' })   // no spread: any number of names
    } else {
      // The format follows the first ':' outside the index (TextTemplate since vector 0.11.97; before, the first after the
      // last ]), so a ] or [ in the format is literal: the index's ] is the first after its [.
      const format = formatColon(inner, true)
      bindingReads(format < 0 ? inner : inner.slice(0, format), out)
    }
    at = close + 1
  }
}
/** A label's text: uppercased when its style says so; then, when src would read it as a number (and draw nothing), a
 *  template that prints it as written. Plain digits a float32 prints exactly become `{=12:%.0f}`. Any other such text keeps
 *  its characters as literal text but one, which goes into a placeholder that prints it: the last digit through `%.0f`,
 *  else (NaN, Infinity) the last hex letter through `%x` or `%X`; every number src reads holds one or the other. So `007`
 *  (the mod drops printf width and flags), `-0`, more than 7 digits (beyond a float32), `1e5` and `NaN` print as written. */
export function literal(t: Theme, style: StyleName, s: string): string {
  const u = t.type[style].upper ? s.toUpperCase() : s
  if (numberOf(u) === undefined) return u
  const d = u.split('.')[1]?.length ?? 0
  if (PLAIN_NUMBER.test(u) && u.replace(/\D/g, '').length <= 7 && Math.fround(Number(u)).toFixed(d) === u) return `{=${u}:%.${d}f}`
  let i = u.length - 1
  while (i > 0 && !/[\dA-Fa-f]/.test(u[i])) i--
  const c = u[i], one = c <= '9' ? `{=${c}:%.0f}` : `{=${parseInt(c, 16)}:%${c >= 'a' ? 'x' : 'X'}}`
  return u.slice(0, i) + one + u.slice(i + 1)
}

type LabelOptions = { tag?: string; align?: 'center' | 'right'; fit?: boolean; f?: string; v?: string; missing?: boolean; size?: number; unit?: string }
/** One T in a style: its size, face, spacing, ink (or `f`) and shadow; valign middle. `text` is final (see literal). */
export function label(t: Theme, style: StyleName, b: { x: At; y: At; w: At; h: number }, text: string, o: LabelOptions = {}): SrcNode {
  const s = t.type[style]
  const n = dress(t, 'text:' + style, b, el('T', { v: o.v, x: b.x, y: b.y, w: b.w, h: b.h, text, size: o.size ?? s.size, font: s.font || undefined, weight: s.weight, cspace: s.cspace || undefined,
    f: o.f ?? inkOf(t, style), sh: s.shadow && Object.hasOwn(t.shadows, s.shadow) ? shadow(t, s.shadow) : undefined, align: o.align, valign: 'middle',
    fit: o.fit ? 'ellipsis' : undefined, missing: o.missing ? '' : undefined, unit: o.unit }))
  return o.tag === undefined ? n : tag(o.tag, n)
}
/** One rectangle, with its part's stroke inside, centred on, or outside the given box. */
export function partRect(t: Theme, name: PartName, x: At, y: At, w: number, h: number,
  o: { tag?: string; v?: string; state?: string; extra?: Record<string, Value> } = {}): SrcNode {
  const p = t.parts[name], stroke = paintOf(t, p.stroke, o.state), width = stroke === undefined || stroke === 'none' ? undefined : p.width
  const d = (width ?? 0) / 2 * (p.outline === 'inside' ? 1 : p.outline === 'outside' ? -1 : 0)
  const attrs = { v: o.v, x: plus(x, d), y: plus(y, d), w: pos(w - 2 * d), h: pos(h - 2 * d),
    rx: p.radius ? pos(p.radius - d) : undefined, f: Object.hasOwn(o.extra ?? {}, 'f') ? o.extra!.f : paintOf(t, p.fill, o.state), s: stroke, sw: width,
    sh: p.shadow ? shadow(t, p.shadow) : undefined, ...o.extra }
  if (attrs.rx === 0) attrs.rx = undefined
  const n = dress(t, name === 'switch.off' || name === 'switch.on' ? 'switch' : name,
    { x: o.extra?.x as At ?? x, y: o.extra?.y as At ?? y, w: o.extra?.w as At ?? w, h: o.extra?.h as At ?? h }, el('R', attrs),
    name === 'switch.on' ? { ...o, ornaments: false } : o)
  return o.tag === undefined ? n : tag(o.tag, n)
}
export function partCircle(t: Theme, name: PartName, cx: At, cy: At, rx: number, ry: number, v?: string, semantic?: string): SrcNode {
  const p = t.parts[name]
  const n = dress(t, name, { x: plus(cx, -rx), y: plus(cy, -ry), w: 2*rx, h: 2*ry },
    el('C', { v, cx, cy, rx, ry, f: paintOf(t, p.fill), sh: p.shadow ? shadow(t, p.shadow) : undefined }))
  return semantic === undefined ? n : tag(semantic, n)
}
/** A raised row: the row gradient, a hairline border inside the box, radius md. */
export const raised = (t: Theme, x: At, y: At, w: number, h: number, extra: Record<string, Value> = {}, name?: string): SrcNode =>
  partRect(t, 'row', x, y, w, h, { extra, tag: name })
/** A sunk track (Bar): surface-well, a hairline border inside the box, radius sm. */
export const well = (t: Theme, x: At, y: At, w: number, h: number, name?: string): SrcNode =>
  partRect(t, 'track', x, y, w, h, { tag: name })
/** The focus ring: accent, outside the box (Vanilla + focus-ring). `v` shows it by state. */
export function ring(t: Theme, x: number, y: number, w: number, h: number, v?: string, name?: string): SrcNode {
  return partRect(t, 'focus', x, y, w, h, { v, tag: name })
}
/** A button body: secondary, primary or danger, with the theme's pressed opacity.
 *  Any other variant throws: a module's enum names only these three, so it can only be a typo in the module. */
export function body(t: Theme, variant: string, x: number, y: number, w: number, h: number, name?: string): SrcNode {
  if (variant === 'secondary' || variant === 'danger' || variant === 'primary')
    return partRect(t, `button.${variant}`, x, y, w, h, { tag: name, extra: { fo: pressedOf(t) } })
  throw new Error(`no button body "${variant}": primary, secondary or danger`)
}
/** A status light: one C per state, ok/warn/crit glowing (a shadow colour cannot be an expression, Q4). Any state but 1, 2
 *  and 3 shows the idle light, as st4 paints it idle: a light and the ink beside it never disagree, and a state out of
 *  range still draws a light. */
export function lights(t: Theme, cx: At, cy: At, rx: number, ry: number, k: string, prefix?: string): SrcNode[] {
  return (['idle', 'ok', 'warn', 'crit'] as const).map((state, i) => partCircle(t, `light.${state}`, cx, cy, rx, ry,
    i === 0 ? `=1-eq(${k},1)-eq(${k},2)-eq(${k},3)` : `=eq(${k},${i})`,
    prefix === undefined ? undefined : prefix ? `${prefix}.${state}` : state))
}
/** An unpainted R over a widget's box, outside anything that hides: it draws nothing and records no hit region, but a
 *  scene holding it is never empty, so the mod draws no magenta empty-scene marker on a page whose widgets all hide
 *  (an Alert at state 0, an Event log with no entry, a Repeater at n 0: measured upstream, the ref sweep B18). */
export const holder = (b: { x: number; y: number; w: number; h: number }): SrcNode => el('R', { x: b.x, y: b.y, w: b.w, h: b.h })
/** A status chip (Vanilla + Alert): the R in the state colour and its three words, one shown per state. */
export function chip(t: Theme, x: At, y: At, k: string, name?: string): SrcNode[] {
  const { w, h } = t.geo.chip
  return [partRect(t, 'chip', x, y, w, h, { state: k, tag: name }),
    ...t.stateWords.map((word, n) => label(t, 'chip-label', { x, y, w, h }, word, { align: 'center', v: `=eq(${k},${n + 1})`, tag: name === undefined ? undefined : `${name}.${['ok', 'warn', 'crit'][n]}` }))]
}
