// The property panel's reading of one key: which fx modes it offers, how typed text becomes a src value, and how a node
// takes it. Pure, so the rules are tested without the DOM.
import type { Scene, SrcNode, Value } from '../model/scene'
import { EXPRESSIONS, GROUP_PAINT_DEFAULTS, TEXTS, type Field } from '../schema'
import { numberOf, parseSrc } from '../srctext/parse'
import { item } from '../srctext/print'
import { foldKey } from '../srctext/props'
import { textNames } from '../widgets/paint'

/** literal: a number, a colour, a word, an array…; data: $name; expr: =expression (on a paint, $name[expr]); gradient: @id;
 *  colourExpr: =colour expression. */
export type Mode = 'literal' | 'data' | 'expr' | 'gradient' | 'colourExpr'

// f, s and s_ are paints; oc is a plain colour, and on a G s is the scale pair (type pair).
const isPaint = (f: Field) => f.type === 'paint'
// A name in an expression is char.IsLetterOrDigit or _ (Expression.cs ReadName), or since 0.11.98 any supplementary-plane
// character; a paint's data name is anything before its [ (SplitBinding), and a gradient id anything after its @.
const WORD = /^[\p{L}\p{Nd}_\u{10000}-\u{10FFFF}]+$/u, LOOSE = /^[^\s[\]]+$/
/** `t` with its sigil, when the rest is a name `ok` takes. */
const named = (t: string, sigil: '$' | '@', ok: RegExp) => {
  const name = t[0] === sigil ? t.slice(1) : t
  return ok.test(name) ? sigil + name : null
}

/** The modes a key offers: the paint modes on a paint, the fx modes where the mod reads the whole value as an expression
 *  (kinds E and L). A pair (kind P) reads an expression per element, so it is literal: [=t*10,$b]. */
export const modesOf = (f: Field): Mode[] =>
  isPaint(f) ? ['literal', 'data', 'expr', 'gradient', 'colourExpr']
  : f.kind === 'E' || f.kind === 'L' ? ['literal', 'data', 'expr'] : ['literal']

/** The mode a value is written in, among the ones the key offers (else literal: a T's text=$tank[i] is its text). */
export function modeOf(v: Value | undefined, f: Field): Mode {
  const m: Mode = typeof v !== 'string' ? 'literal'
    : isPaint(f) ? (v[0] === '@' ? 'gradient' : v[0] === '=' ? 'colourExpr' : v[0] === '$' ? (v.includes('[') ? 'expr' : 'data') : 'literal')
    : v[0] === '$' && WORD.test(v.slice(1)) ? 'data' : 'expr'   // the mod reads any other string here as an expression, = or not
  return modesOf(f).includes(m) ? m : 'literal'
}

/** On a G or the SCENE (and, as a G's, on any other node with a block), a key passed down to the children
 *  (GroupPaintDefaults): absent, it is inherited, so a leaf's own default is not its default. It is only a default there,
 *  and ParseStyle collects a default by its exact key, lower case (SceneModel.cs:1435-1444 at v0.11.118): so the panel reads and
 *  writes it by that key, and another spelling (F=) is a key of its own, which does nothing there. */
export const passedDown = (f: Field) => (f.op === 'G' || f.op === 'SCENE') && f.group !== 'scene' && GROUP_PAINT_DEFAULTS.includes(f.key)
/** The default a checkbox shows, when the key has one of its own. */
export const ownDefault = (f: Field) => passedDown(f) ? undefined : f.default
/** What an absent key reads as: its default, the key it takes the value of, what absence means, or (on a group) that it
 *  is inherited; never a made-up 0. Empty when there is nothing to say. */
export const absent = (f: Field): string => passedDown(f) ? (f.op === 'G' ? 'inherited' : "each node's own default")
  : f.default !== undefined ? shown(f.default) : f.defaultFrom ? `same as ${f.defaultFrom}` : f.defaultNote ?? ''

/** What the mod makes of a number the panel keeps as written but the mod reads otherwise: an info note, never an error.
 *  A colour that is not one is the check's warning (validate.ts), as it is in the code pane. */
export function noteOf(f: Field, v: Value | undefined): string | null {
  if (typeof v !== 'number') return null
  if (f.type === 'int' && !Number.isInteger(v)) return 'the mod rounds this to a whole number'
  if (f.range && (v < f.range[0] || v > f.range[1])) return `the mod clamps this to ${f.range[0]}…${f.range[1]}`
  return null
}

/** A src value as typed, read by the real parser (arrays, quoting, float32); undefined unless it is exactly one value. */
const parseValue = (text: string): Value | undefined => {
  const r = parseSrc('R v=' + text), n = r.scene?.root.length === 1 ? r.scene.root[0] : undefined
  return r.errors.length || !n || n.c || Object.keys(n.attrs).length !== 1 ? undefined : n.attrs.v
}

/** Typed text in a mode as the value to set; undefined (empty text) removes the key. A label keeps its spaces, even alone. */
export function read(text: string, mode: Mode, f: Field): { value: Value | undefined } | { error: string } {
  const t = text.trim()
  if (!text || (!t && !(mode === 'literal' && f.type === 'text'))) return { value: undefined }
  switch (mode) {
    case 'data': {
      const v = named(t, '$', isPaint(f) ? LOOSE : WORD)
      return v ? { value: v } : { error: isPaint(f) ? 'a data name has no spaces or brackets' : 'a data name is letters, digits and _' }
    }
    case 'expr': return isPaint(f) ? { value: t[0] === '$' ? t : '$' + t } : { value: t[0] === '=' ? t : '=' + t }
    case 'colourExpr': return { value: t[0] === '=' ? t : '=' + t }   // its grammar is the checker's (colourProblem)
    case 'gradient': {
      const v = named(t, '@', LOOSE)
      return v ? { value: v } : { error: 'a gradient id has no spaces or brackets' }
    }
  }
  if (foldKey(f.key) === 'DASH') {
    const parts = t.split(/\s*,\s*|\s+/)
    const value = t.startsWith('[') ? parseValue(t) : parts.map(numberOf)
    return Array.isArray(value) && value.every((x): x is number => typeof x === 'number' && Number.isFinite(x))
      ? { value } : { error: 'Dash entries must be finite numbers, separated by commas or spaces' }
  }
  // A word or a number, each as itself (weight: bold or 700); NaN or Infinity is a number src cannot carry, as on a num.
  const either = f.kind === 'SN' ? numberOf(t) : undefined
  if (either !== undefined) return Number.isFinite(either) ? { value: either } : { error: 'a number is expected' }
  switch (f.type) {
    case 'num': case 'int': {
      if (t[0] === '[') {   // rx takes its four corners
        const v = parseValue(t)
        return v === undefined ? { error: 'not a value src can read' } : { value: v }
      }
      if (f.kind === 'E' && (t === 'true' || t === 'false')) return { value: t }
      const n = numberOf(t)   // as the mod reads it: one rounding to float32; its rounding and clamping is noteOf's
      return n === undefined || !Number.isFinite(n) ? { error: 'a number is expected' } : { value: n }
    }
    case 'flag': return { value: t === '1' || t === 'true' ? 1 : 0 }
    // Any word, a malformed #hex too: the mod reads it (one that is not a colour is reported and drawn magenta: the
    // check's warning says so).
    case 'colour': case 'paint': return { value: t }
    case 'enum': return { value: t }   // a word the mod does not know is a trap warning, not an input error
    case 'pair': case 'numlist': case 'shadow': case 'stops': {
      const v = parseValue(t)
      return v === undefined ? { error: 'not a value src can read' } : { value: v }
    }
    case 'map': case 'array': return { value: parseValue(t) ?? t }   // a key the catalogue does not know: a value src reads, else the text
    case 'text': return { value: text }   // a label keeps its spaces
    default: return { value: t }   // ids, paths, font names (spec 5.3: any name)
  }
}

/** A value as the panel shows it: numbers and arrays as src prints them (item), strings as they are. */
export const shown = (v: Value | undefined): string => v === undefined ? '' : typeof v === 'string' ? v : item(v)

/** n with `key` set to `value` (undefined removes it): an existing key keeps its spelling and place; a new one goes last.
 *  The key is found as the mod compares keys (the first that folds alike), or, `exact`, by its own spelling only (a group
 *  default, passedDown). */
export function withAttr(n: SrcNode, key: string, value: Value | undefined, exact = false): SrcNode {
  const at = exact ? (Object.hasOwn(n.attrs, key) ? key : undefined) : Object.keys(n.attrs).find(x => foldKey(x) === foldKey(key))
  const attrs: Record<string, Value> = Object.create(null)   // as the parser makes them: __proto__ is just a key
  for (const [x, v] of Object.entries(n.attrs)) {
    if (x !== at) attrs[x] = v
    else if (value !== undefined) attrs[x] = value
  }
  if (at === undefined && value !== undefined) attrs[key] = value
  return { ...n, attrs }
}

// A name an expression reads (Expression.cs ReadName: letters, digits, _; since 0.11.98 supplementary-plane characters).
const EXPR_NAME = /\$([\p{L}\p{Nd}_\u{10000}-\u{10FFFF}]+)/gu
const exprNames = (s: string) => [...s.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '').matchAll(EXPR_NAME)].map(m => m[1])
// The paints that bind or compute: f, s and s_. oc, a shadow's colour and fl's are literal colours (REFERENCE.md, Expressions).
const BOUND_PAINTS: ReadonlySet<string> = new Set(['F', 'S', 'S_'])
/** The data names one string value of key K (folded) binds, as the mod reads it (SceneModel.cs): a T's text by its binding
 *  or its placeholders (textNames: `$room kPa` reads "room kPa", `Price $5` nothing); on a key the mod parses as an
 *  expression (EXPRESSIONS: kinds E, P, L and the filter keys), every name it reads, its leading `=` optional
 *  (`1+$a`, `sqrt($b)`); on a paint, a `$` binding whole, up to a trailing [index] (SplitBinding: `$my-colour` reads
 *  "my-colour"), or the names of an `=` colour expression. unit, missing, fmt, oc, ids, RP's n and the rest are literal. */
function namesIn(K: string, s: string): string[] {
  if (TEXTS.has(K)) return K === 'TEXT' ? textNames(s) : []
  if (EXPRESSIONS.has(K)) return exprNames(s)
  if (BOUND_PAINTS.has(K)) return s[0] === '$' ? textNames(s) : s[0] === '=' ? exprNames(s) : []
  return []
}
/** The data names a value of key K (folded) binds: namesIn for each string in it, but for a G's scale pair (an expression
 *  per element, Pair) and a gradient's stops (ReadStops: a string position is an expression, a `$` colour binds the rest
 *  whole, and a stop whose colour is not a string is dropped). */
function valueNames(K: string, v: Value): string[] {
  const out: string[] = []
  if (K === 'STOPS' && Array.isArray(v)) {
    for (const stop of v) {
      if (!Array.isArray(stop) || stop.length < 2) continue
      const [at, colour] = stop
      if (typeof colour !== 'string') continue
      if (typeof at === 'string') for (const name of exprNames(at)) out.push(name)
      if (colour.length > 1 && colour[0] === '$') out.push(colour.slice(1))
    }
    return out
  }
  const of = K === 'S' && Array.isArray(v) ? exprNames : (s: string) => namesIn(K, s), values: Value[] = [v]
  for (let x = values.pop(); x !== undefined; x = values.pop()) {
    if (typeof x === 'string') { for (const name of of(x)) out.push(name) }   // no spread: any number of names
    else if (Array.isArray(x)) for (const y of x) values.push(y)
  }
  return out
}
/** Every data name the scene's values bind (valueNames), sorted, once each. Explicit stacks: a scene may be deep. */
export function dataNames(scene: Scene): string[] {
  const names = new Set<string>(), nodes = [...scene.root, ...scene.defs]
  const read = (k: string, v: Value) => { for (const name of valueNames(foldKey(k), v)) if (name) names.add(name) }   // a bare `$` binds "", no name to send
  for (const [k, v] of Object.entries(scene.header)) if (!['W', 'H'].includes(foldKey(k))) read(k, v)
  for (let n = nodes.pop(); n; n = nodes.pop()) {
    for (const [k, v] of Object.entries(n.attrs)) read(k, v)
    for (const c of n.c ?? []) nodes.push(c)
  }
  return [...names].sort()
}
