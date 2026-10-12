// A node's style (spec §4 "Style"): its fill, stroke, text and effects keys in the catalogue (M2a T12), less content and
// structure; a box's corner radius too. Copy and paste of it, and the named styles from the theme's tokens. Pure.
import { modeOf, passedDown, withAttr } from '../editor/fields'
import type { SrcNode, Value } from '../model/scene'
import { sameData } from '../model/same'
import { fieldOf, fieldsFor, PASSED_DOWN, type Field } from '../schema'
import { foldKey } from '../srctext/props'
import { colour, type Theme } from '../theme'
import type { PartName, StyleName } from '../theme/types'
import { shadow } from '../widgets/paint'
import { linked, linkValue, unlinked, type StyleLink } from '../theme/links'
import { first } from './tree'
import { isStyle } from './styleKeys'
export { isStyle } from './styleKeys'

// A group default passed down is read only by its exact key (passedDown: ParseStyle collects it so, and `F=` on a G is a
// dead key of its own, the default-case trap's); any other key as the mod folds it, and withAttr writes each so (exact
// where passedDown). live: whether key k on op is read; held: the value n holds for field f.
const live = (op: string, k: string) => { const f = fieldOf(op, k); return !f || !passedDown(f) || k === f.key }
const held = (n: SrcNode, f: Field): Value | undefined =>
  passedDown(f) ? (Object.hasOwn(n.attrs, f.key) ? n.attrs[f.key] : undefined) : first(n, foldKey(f.key))   // first wants the folded key

/** The style attributes of n, keys as written (a group's dead default spelling is none). */
export const styleOf = (n: SrcNode): Record<string, Value> =>
  Object.fromEntries(Object.entries(n.attrs).filter(([k]) => isStyle(n.op, k) && live(n.op, k)))

// An open SP casts no shadow (only a closed ring does: the sp-shadow trap), so a style's sh is not for it; a close that is
// an expression or data may be closed. Its fill fills as if closed (Tessellator, the trap's reading), so f is.
const openSP = (n: SrcNode) => { const c = first(n, 'CLOSE'); return foldKey(n.op) === 'SP' && (c === undefined || typeof c === 'number' && c <= 0.5) }
/** Whether n reads `key` as style: isStyle, less an open SP's sh. */
const reads = (n: SrcNode, key: string) => isStyle(n.op, key) && !(foldKey(key) === 'SH' && openSP(n))

// Among node ops only a G passes paints down to its children (the SCENE header does too, but it is never a member).
const isGroup = (op: string) => foldKey(op) === 'G'
// The key `to` reads for `from`'s `key`: a group spells a paint it passes down as PASSED_DOWN says (a shape's s is a
// group's s_, f stays f), and back.
function across(key: string, from: string, to: string): string {
  if (isGroup(from) === isGroup(to)) return key
  const K = foldKey(key)
  for (const [own, down] of PASSED_DOWN) {
    if (K === foldKey(isGroup(from) ? down : own)) return isGroup(from) ? own : down
  }
  return key
}

// Whether `key` on `op` and `other` on `on` are one style: both style, in one catalogue group (a shape's sat samples its
// stroke gradient, a G's sat is a saturation filter: the same name, two things).
const sameStyle = (op: string, key: string, on: string, other: string) =>
  isStyle(op, key) && isStyle(on, other) && fieldOf(op, key)?.group === fieldOf(on, other)?.group

/** How many expressions and $data values `v` holds where `f` reads it: the whole value by its mode (modeOf: a literal and
 *  a gradient @id are none), and in a list or pair every item that is a string starting = or $ (the mod reads an
 *  expression per item). Lists may nest deep: an explicit stack. */
function bound(v: Value | undefined, f: Field): number {
  if (!Array.isArray(v)) { const m = modeOf(v, f); return m === 'data' || m === 'expr' || m === 'colourExpr' ? 1 : 0 }
  let k = 0
  const stack: Value[] = [v]
  for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
    if (Array.isArray(x)) { for (const y of x) stack.push(y) }
    else if (typeof x === 'string' && /^[=$]/.test(x)) k++
  }
  return k
}

/** `target` with `source`'s style: every style key both ops read set to the source's value, or removed where the source
 *  has none; keys only the target's op reads are left alone, and so is a source key that is not style on its op (a G's s
 *  is its scale). overwrote: the expressions and $data values it replaced. */
export function pasteStyle(target: SrcNode, source: { op: string; attrs: Record<string, Value>; links?: Record<string, StyleLink> }, t?: Theme): { node: SrcNode; overwrote: number } {
  const from = new Map(Object.entries(source.attrs).filter(([k]) => isStyle(source.op, k) && live(source.op, k))
    .map(([k, v]) => [foldKey(across(k, source.op, target.op)), v]))
  let node = target, overwrote = 0
  for (const f of fieldsFor(target.op)) {
    if (!sameStyle(target.op, f.key, source.op, across(f.key, target.op, source.op)) || !reads(target, f.key)) continue
    const v = from.get(foldKey(f.key)), was = held(node, f)
    const sourceKey = Object.keys(source.attrs).find(k => foldKey(across(k, source.op, target.op)) === foldKey(f.key))
    node = unlinked(node, [f.key])
    if (!sameData(was, v)) { overwrote += bound(was, f); node = withAttr(node, f.key, v, passedDown(f)) }
    const link = sourceKey && source.links?.[sourceKey]
    if (link && t && !linkValue(link, t).missing && sameData(linkValue(link, t).value, v)) node = linked(node, f.key, link, t)
  }
  return { node, overwrote }
}

/** A text style's attributes, as M2b's label() writes them less the box and alignment: size, face, spacing, ink, drop. */
export function textLook(t: Theme, name: StyleName): Record<string, Value> {
  const s = t.type[name]
  return { size: s.size, ...(s.font ? { font: s.font } : {}), ...(s.cspace ? { cspace: s.cspace } : {}), f: colour(t, s.ink),
    ...(s.shadow ? { sh: shadow(t, s.shadow) } : {}), ...(s.weight !== undefined ? { weight: s.weight } : {}) }
}

/** A named style (spec §4 "named styles from the theme tokens", §5.2): literal values from the theme at the moment it is
 *  applied; undefined removes the key. fits: text styles on T (and G, as its children's defaults); surface styles on
 *  anything but T; the rest on any. A text style is the whole text look: a spacing, drop, weight, kerning, outline or
 *  first-line override it has none of goes (label() writes none of the last four); the layout (align, wrap, lh, fit) stays. */
export type Named = { id: string; label: string; fits: 'text' | 'shape' | 'any'; attrs(t: Theme): Record<string, Value | undefined>; links: Record<string, StyleLink> }
const status = ['ok', 'warn', 'crit', 'idle'] as const, glows = [['ok', 'glowOk'], ['warn', 'glowWarn'], ['crit', 'glowCrit']] as const
const wholeText = (look: Record<string, Value>): Record<string, Value | undefined> =>
  ({ ...look, cspace: look.cspace, sh: look.sh, weight: look.weight, kern: undefined, ow: undefined, oc: undefined, fl: undefined })
const PART_FIELDS = { f: 'fill', s: 'stroke', sw: 'width', rx: 'radius', sh: 'shadow' } as const
const TYPE_FIELDS = { size: 'size', font: 'font', cspace: 'cspace', f: 'ink', sh: 'shadow', weight: 'weight' } as const
export const partLinks = (part: PartName): Record<string, StyleLink> => Object.fromEntries(Object.entries(PART_FIELDS).map(([key, field]) => [key, { part, field }]))
export const typeLinks = (type: StyleName): Record<string, StyleLink> => Object.fromEntries(Object.entries(TYPE_FIELDS).map(([key, field]) => [key, { type, field }]))
/** One style per theme part, type, status and light glow; unsupported state paints are omitted. */
export function namedOf(t: Theme): Named[] {
  const make = (id: string, label: string, fits: Named['fits'], links: Record<string, StyleLink>, text = false): Named | null => {
    const available = Object.fromEntries(Object.entries(links).filter(([, link]) => !linkValue(link, t).missing))
    const values = Object.fromEntries(Object.entries(available).map(([k, l]) => [k, linkValue(l, t).value]))
    if (!Object.values(values).some(v => v !== undefined)) return null
    return { id, label, fits, links: available, attrs: () => text ? { ...wholeText(values as Record<string, Value>), font: values.font, weight: values.weight } : values }
  }
  return [
    ...(Object.keys(t.type) as StyleName[]).map(name => make(`text.${name}`, `Text: ${name}`, 'text', typeLinks(name), true)),
    ...(Object.keys(t.parts) as PartName[]).map(name => make(name, `Part: ${name}`, 'shape', partLinks(name))),
    ...status.map(k => make(`status.${k}`, `Status: ${k}`, 'any', { f: { role: `status-${k}` } })),
    ...glows.map(([k, name]) => make(`glow.${k}`, `Glow: ${k}`, 'any', { sh: { shadow: name } })),
  ].filter((s): s is Named => s !== null)
}
export function applyNamed(target: SrcNode, s: Named, t: Theme): { node: SrcNode; overwrote: number } {
  const r = applyStyle(target, s.attrs(t))
  for (const [key, link] of Object.entries(s.links)) {
    const k = across(key, 'R', target.op)
    if (reads(target, k)) r.node = linked(r.node, k, link, t)
  }
  return r
}
/** Whether a named style fits node n: a text style a T and a G, a surface style anything but a T, the rest any; and n
 *  reads at least one of its keys as style (a status colour on a USE paints nothing, a glow on an open SP casts nothing). */
export function fits(s: Named, n: SrcNode, t: Theme): boolean {
  const O = foldKey(n.op)
  return (s.fits === 'any' || (s.fits === 'text' ? O === 'T' || O === 'G' : O !== 'T'))
    && Object.keys(s.attrs(t)).some(k => reads(n, across(k, 'R', n.op)))
}

/** target with a named style's attributes: each key it reads as style set, or removed where the value is undefined (a
 *  group takes a shape's s as s_, and a default by its exact key); nothing else, so the geometry stays. overwrote: the
 *  expressions and $data values it replaced or removed, as pasteStyle counts them. */
export function applyStyle(target: SrcNode, attrs: Record<string, Value | undefined>): { node: SrcNode; overwrote: number } {
  let node = target, overwrote = 0
  for (const [k, v] of Object.entries(attrs)) {
    const key = across(k, 'R', target.op), f = fieldOf(target.op, key)
    if (!f || !reads(target, key)) continue
    const was = held(node, f)
    node = unlinked(node, [f.key])
    if (sameData(was, v)) continue
    overwrote += bound(was, f)
    node = withAttr(node, f.key, v, passedDown(f))
  }
  return { node, overwrote }
}
