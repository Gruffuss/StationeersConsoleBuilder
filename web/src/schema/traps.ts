// traps.ts — warnings for what the mod accepts but ignores, or reads in a way that surprises where it is written. One
// walk of the written tree (the SCENE header, the root, then the defs) with an explicit stack; the catalogue says which op
// reads which key, and with what, checked against v0.11.118. Line anchors below are at v0.11.118.
import type { Scene, SrcNode, Value } from '../model/scene'
import { numberOf } from '../srctext/parse'
import { shortestFloat } from '../srctext/print'
import { flattenPath } from '../srctext/path'
import { placeholderClose, formatColon } from '../srctext/placeholders'
import { foldKey, textOf } from '../srctext/props'
import { GRADIENTS, MAX_WORK, strings } from '../srctext/validate'
import { DEF_OPS, EXPRESSIONS, type Field, fieldOf, GROUP_PAINT_DEFAULTS, KNOWN_KEYS, NODE_OPS, PAINTS, passesDown, SCENE_KEYS, TEXTS, LITERAL_KEYS, SCENE_LITERAL_KEYS } from '.'

export type TrapId = 'gradient-units' | 'bare-pi' | 'y-crosses' | 'y-unchecked' | 'p-crosses' | 'p-unchecked' | 'sp-shadow' | 'index-n' | 'literal-only'
  | 'pair-scalar' | 'needs-key' | 'enum-word' | 'not-read' | 'unknown-key' | 'not-text' | 'clip-extra' | 'undeclared'
  | 'scene-size' | 'default-case' | 'p-odd' | 'p-few'
/** node: none for the SCENE header and for what is said of the whole scene. key: the attribute it is about, as written. */
export type Trap = { id: TrapId; message: string; node?: SrcNode; key?: string }

const OPS = new Set([...NODE_OPS, ...DEF_OPS].map(foldKey)), SHAPES = new Set(NODE_OPS.map(foldKey))
// A name in an expression is a letter, a digit or _ (Expression.cs ReadName), any script, and since 0.11.98 any
// supplementary-plane character, a letter or not.
const PI = /(^|[^\p{L}\p{Nd}_\u{10000}-\u{10FFFF}$.])(pi|tau)(?![\p{L}\p{Nd}_\u{10000}-\u{10FFFF}])(?!\s*\()/u
const INDEX = /\$([\p{L}\p{Nd}_\u{10000}-\u{10FFFF}]+)\s*\[\s*(n|i\s*\+\s*1)\s*\]/gu
// The same array read at i or before it ([i], [i-1]): beside one, [i+1] is a neighbour (a slope, a central difference).
const NEAR_I = /\$([\p{L}\p{Nd}_\u{10000}-\u{10FFFF}]+)\s*\[\s*i\s*(?:-\s*\d+\s*)?\]/gu
// What changes while a scene is shown: time, data, the pointer, scrolling. Not i or n: an instance or a sample is laid out
// once. Not a constant like "=10" either.
const MOTION = /\$|(^|[^\p{L}\p{Nd}_\u{10000}-\u{10FFFF}])(t|sy|hover|down)(?![\p{L}\p{Nd}_\u{10000}-\u{10FFFF}])|(^|[^\p{L}\p{Nd}_\u{10000}-\u{10FFFF}])since\s*\(/u
// The types a key is read as text only (PropString): a number there is ignored, and src reads a quoted number as a number
// too (confirmed upstream, 0.11.94).
const TEXTUAL = new Set<Field['type']>(['string', 'text', 'id', 'idref', 'font', 'enum', 'paint', 'colour', 'path'])
/** A node's attribute by its exact key, as ParseStyle collects a group default. */
const exact = (attrs: Record<string, Value>, k: string) => Object.hasOwn(attrs, k) ? attrs[k] : undefined
/** Each group default by its folded key (no two fold alike): built once, read for every key of a node with a block. */
const DEFAULT_OF: ReadonlyMap<string, string> = new Map(GROUP_PAINT_DEFAULTS.map(g => [foldKey(g), g]))

const unquoted = (s: string) => {
  const out: string[] = []
  let quote = '', start = 0
  for (let i = 0; i < s.length; i++) {
    if (quote) {
      if (s[i] === '\\') i++
      else if (s[i] === quote) { quote = ''; start = i + 1 }
    } else if (s[i] === '"' || s[i] === "'") {
      out.push(s.slice(start, i), ' '); quote = s[i]
    }
  }
  if (!quote) out.push(s.slice(start))
  return out.join('')
}
const motion = (v: Value | undefined) => v !== undefined && strings(v).some(s => MOTION.test(unquoted(s)))
// A paint is parsed when it is an expression (0.11.79+ colour expressions) or a `$name[index]` binding.
const paint = (v: Value) => strings(v).filter(s => s[0] === '=' || s[0] === '$')
// Text is literal except a whole `$name[index]` binding and its `{=expr}` / `{$name[index]}` placeholders (TextTemplate).
// A `{$…}` keeps its `$`: it is a data name, and only its index is an expression.
const placeholders = (s: string) => {
  const out = s[0] === '$' ? [s] : []
  for (let open = s.indexOf('{'); open >= 0; open = s.indexOf('{', open + 1)) {   // one scan: each `{` is looked at once
    if (s[open + 1] !== '$' && s[open + 1] !== '=') continue
    const close = placeholderClose(s, open)
    if (close < 0) break
    const inner = s.slice(open + 2, close), colon = formatColon(inner, s[open + 1] === '$')
    out.push((s[open + 1] === '$' ? '$' : '') + (colon < 0 ? inner : inner.slice(0, colon)))
    open = close
  }
  return out
}
/** The parts of an attribute value (K folded) that the mod hands to Expression.Parse. */
const parsed = (K: string, v: Value): string[] => {
  if (EXPRESSIONS.has(K) || (K === 'S' && Array.isArray(v))) return strings(v)   // s on a G is a scale pair
  if (PAINTS.has(K) && K !== 'OC') return paint(v)
  if (K === 'STOPS') return Array.isArray(v) ? v.flatMap(s => Array.isArray(s) ? [...strings(s[0] ?? []), ...paint(s.slice(1))] : []) : []
  if (TEXTS.has(K)) return strings(v).flatMap(placeholders)
  return []
}

// Non-adjacent ring edges; sampled P curves include contacts at vertices. O(n²) pairs, charged to the caller's budget.
const crosses = (p: number[], sampled = false) => {
  const n = p.length >> 1
  const x = (i: number) => p[2 * (i % n)], y = (i: number) => p[2 * (i % n) + 1]
  const side = (a: number, b: number, c: number) => Math.sign((x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a)))
  const on = (a: number, b: number, c: number) => x(c) >= Math.min(x(a), x(b)) && x(c) <= Math.max(x(a), x(b))
    && y(c) >= Math.min(y(a), y(b)) && y(c) <= Math.max(y(a), y(b))
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue   // neighbours through the closing edge
      const a = side(i, i+1, j), b = side(i, i+1, j+1), c = side(j, j+1, i), d = side(j, j+1, i+1)
      if (a*b < 0 && c*d < 0 || sampled && (!a && on(i, i+1, j) || !b && on(i, i+1, j+1) || !c && on(j, j+1, i) || !d && on(j, j+1, i+1))) return true
    }
  return false
}

/** A node's attributes by folded key, the first of each (the mod's PropValue). */
const own = (attrs: Record<string, Value>) => {
  const m = new Map<string, Value>()
  for (const [k, v] of Object.entries(attrs)) if (!m.has(foldKey(k))) m.set(foldKey(k), v)
  return m
}
/** What an absent key reads as: its default, the key it takes it from, or what absence means. */
const shown = (f: Field) => f.default !== undefined ? (Array.isArray(f.default) ? JSON.stringify(f.default) : String(f.default))
  : f.defaultFrom ? `the value of "${f.defaultFrom}"` : f.defaultNote ?? 'its default'
const or = (words: readonly string[]) => words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`
/**
 * A paint as ParseFill and ParseStroke take it (PropString, so a number is none): none (absent, a number, empty or
 * "none": nothing drawn), a gradient, any other. " none" is a transparent paint: the mod's "none" test does not trim, and
 * Colours.TryParse does, so the shape has a fill and reads fo (SceneModel.cs:2374-2375).
 */
type Paint = '' | '@' | 'c'
const paintOf = (v: Value | undefined): Paint => typeof v !== 'string' || v === '' || foldKey(v) === 'NONE' ? '' : v[0] === '@' ? '@' : 'c'
/** A shape that draws a paint passed down to it (a G's s is its scale; a group's own paint is a default). */
const drawsPaint = (op: string, K: 'F' | 'S') => op !== 'G' && op !== 'SCENE' && fieldOf(op, K)?.type === 'paint'

/**
 * What the enclosing nodes and the SCENE header give the nodes of one list, as flags, so nothing is copied per level.
 * - f, s: the fill and the stroke colour passed down (an s_; a G's s is its scale). A default is passed down only by its
 *   exact key, lower case (ParseStyle, :1435-1444). A so passed down is stroke opacity only: since 0.11.98 an SC reads its
 *   scroll offset from its own map (:1832-1836), so only a stroke reads a waiting so.
 * - clip: the list is a CP's, of which the first shape (a node op: ParseNode refuses any other) is the clip (ClipOutline,
 *   :2815-2879); taken once that one is seen. Since 0.11.96 the mod validates the clip's shape on the scene, as it does the
 *   header (:646) and every node and def, and reports how many further shapes it ignored, and since 0.11.99 how many def
 *   ops the list holds besides. unread: the list is the clip shape's own, which the mod never parses (ParseNode queues it,
 *   and ParseNodes clears the queue before the root, :1148-1149): unreported.
 * - defs: the list is DEFS itself. silent: the mod draws nothing of these nodes, so a reference they hold to a def DEFS
 *   lacks is not reported (a def op's own node, a CP's shapes, the SCENE header).
 * - gotF / gotS: a node of the list or below gives a fill / a stroke colour of its own, or draws one passed down to it (a
 *   USE counts: its symbol may), so the defaults the owner of the list passes down are read after all; waiting holds the
 *   owner's needs-key traps until that is known.
 */
type Frame = { nodes: SrcNode[]; k: number; inSym: boolean; defs: boolean; silent: boolean; clip: boolean; taken: boolean
  unread: boolean; f: Paint; s: Paint; gotF: boolean; gotS: boolean; waiting: { need: 'f' | 's'; trap: Trap }[] }

/**
 * The traps in the written tree: the SCENE header (read as op SCENE; its traps have no node), the root, then the defs. A
 * SYM's attributes are its parameters, and a USE's are its symbol's arguments except the keys a USE reads itself; a node
 * of an op the mod does not know is skipped. Inside a SYM body a value holding % is substituted first, so the value rules
 * skip it, and needs-key does not fire (the USE may give what is required). The self-crossing test is charged to MAX_WORK:
 * a ring it has no budget left for is not tested, and one warning says how many were not.
 */
export function trapsOf(scene: Scene): Trap[] {
  const traps: Trap[] = [], head = own(scene.header)
  let work = 0, unchecked = 0, pathsUnchecked = 0
  // gradient id -> how its ramp is placed; a later definition replaces an earlier one (scene.Gradients[id], :2769). A ramp
  // whose own coordinates move follows the shape on purpose.
  const placed = new Map<string, 'bbox' | 'live' | 'fixed'>()
  // What DEFS declares, by table (exact ids): clips (CP), and symbols with a body (a SYM without one is no symbol).
  const clips = new Set<string>(), symbols = new Set<string>()
  for (const n of scene.defs) {
    const a = own(n.attrs), id = textOf(a.get('ID')), units = a.get('UNITS'), op = typeof n.op === 'string' ? foldKey(n.op) : ''
    if (typeof id === 'string' && op === 'CP') clips.add(id)
    if (typeof id === 'string' && op === 'SYM' && n.c?.length) symbols.add(id)
    if (!GRADIENTS.has(op) || typeof id !== 'string') continue
    placed.set(id, typeof units === 'string' && foldKey(units) === 'BBOX' ? 'bbox'
      : [...a].some(([K, v]) => fieldOf(n.op, K)?.kind === 'L' && motion(v)) ? 'live' : 'fixed')
  }
  // The header as a node: its children are the root, which reads its paint defaults (Parse, :666).
  const top: SrcNode = { op: 'SCENE', attrs: scene.header, c: scene.root }

  /** The node's traps. */
  const visit = (n: SrcNode, op: string, a: Map<string, Value>, fr: Frame, waiting: Frame['waiting']) => {
    if (op === 'FONT') return   // validateScene owns its syntax, placement and reports
    const kids = !!n.c?.length, said = new Set<string>(), parts: string[] = []
    const trap = (id: TrapId, message: string, key?: string): Trap | null => {
      if (said.has(message)) return null
      said.add(message)
      return { id, message, ...(n !== top && { node: n }), ...(key !== undefined && { key }) }
    }
    const add = (id: TrapId, message: string, key?: string) => { const t = trap(id, message, key); if (t) traps.push(t) }
    const subst = (v: Value | undefined) => fr.inSym && v !== undefined && strings(v).some(s => s.includes('%'))
    // A requirement (lower case, as the catalogue spells it) is met by the node's own key or else the one passed down; a
    // paint only when it draws, and for fat and sat only when it is a gradient, which they sample (:2412, :2937); an id
    // only when it is text that is not empty (a hit region needs one, Tessellator.cs:2378, :2847; inside an RP each
    // instance records its own, id:0, id:1, …). On a G or the header a group default is met only by its exact key, as
    // ParseStyle collects it.
    const byDefault = op === 'G' || op === 'SCENE'
    const met = (req: string, above: string | undefined, gradient: boolean) => {
      const R = foldKey(req), own = byDefault && GROUP_PAINT_DEFAULTS.includes(req) ? exact(n.attrs, req) : a.get(R)
      if (R === 'ID') return !!textOf(own)
      if (R !== 'F' && R !== 'S' && R !== 'S_') return own !== undefined
      const p = own !== undefined ? paintOf(own) : above === 'f' ? fr.f : above === 's_' ? fr.s : ''
      return gradient ? p === '@' : p !== ''
    }

    for (const [k, v] of Object.entries(n.attrs)) {
      if (k === '') continue
      const K = foldKey(k), field = fieldOf(op, K)
      const literalSlot = op !== 'USE' && (op === 'SCENE' ? SCENE_LITERAL_KEYS : LITERAL_KEYS).has(K)
      const literal = literalSlot
        && (typeof v === 'string' ? [v] : Array.isArray(v) ? v : []).some(x => typeof x === 'string' && (x[0] === '=' || x[0] === '$'))
      if (literal && !subst(v)) add('literal-only', '"' + k + '" is read as a plain number and is not evaluated; the mod reports it: write a number', k)
      if (op === 'USE' && !field) continue   // a symbol argument
      if (!KNOWN_KEYS.has(K) && !field) {
        // Validate reports it (:1606-1659), on the header too since 0.11.96, except the header's SceneKeys: there the host's
        // keys pass without a report, and on the SCENE line of src they reach nothing (the host reads the element's props).
        if (op === 'SCENE' && SCENE_KEYS.has(K)) add('not-read', `"${k}" does nothing on SCENE: remove it`, k)
        else add('unknown-key', `"${k}" is not a vector attribute: the mod reports it and draws the magenta border; fix its name or remove it`, k)
        continue
      }
      // ParseStyle takes a group default by its exact key, lower case (:1435-1444): written in another case it is not
      // passed down, and where it is only a default (on a G or the header) or not the op's own key, it does nothing.
      const lower = kids ? DEFAULT_OF.get(K) : undefined, asDefault = lower === k ? undefined : lower
      if (asDefault && passesDown(op, asDefault) && (!field || (byDefault && field.group !== 'scene'))) {
        add('default-case', `"${k}" does nothing on ${op}: the mod passes a group default down only as written in lower case: write ${asDefault}`, k)
        continue
      }
      if (!field && !(kids && passesDown(op, k))) { add('not-read', `"${k}" does nothing on ${op}${K === 'O' && ['SCENE', ...NODE_OPS, 'GL', 'GR', 'GC', 'CP'].includes(op) ? ': the mod reports it' : ''}: remove it`, k); continue }
      if (subst(v)) continue
      parts.push(...parsed(K, v).map(unquoted))
      if (!field) continue
      if (!literal && !literalSlot && (field.kind === 'N' || field.kind === 'NL') && typeof v === 'string' && !(field.kind === 'N' && (v === 'true' || v === 'false')))
        add('literal-only', field.kind === 'N' ? `"${k}" takes a number here; text or an expression is ignored and ${shown(field)} is used: write a number`
          : `"${k}" takes a list of numbers here; text or an expression is ignored and ${shown(field)} is used: write [a, b, …]`, k)
      // Numbers (:3013-3025) reads anything but a list as none; Scalar (:3714-3724) reads a boolean as 1/0 and other
      // non-numbers as 0, in silence. A single number: m, uv, slice and bw the mod reports for their length, and p-few speaks for p, which leaves dash.
      if (field.kind === 'NL' && typeof v === 'number' && K === 'DASH')
        add('literal-only', `"${k}" takes a list of numbers here; a single number is ignored and ${shown(field)} is used: write [a, b, …]`, k)
      if (!literal && field.kind === 'NL' && Array.isArray(v) && v.some(x => typeof x !== 'number' && x !== 'true' && x !== 'false' && (!literalSlot || typeof x !== 'string')))
        add('literal-only', `"${k}" takes a list of numbers here; an entry that is not a number (text, an expression or a list) reads as 0: write numbers only`, k)
      // A key read as text only (PropString, :3654) takes a number as absent; weight (kind SN) takes either since 0.11.94.
      if (field.kind === 'S' && TEXTUAL.has(field.type) && typeof v === 'number')
        add('not-text', `"${k}" reads text only: the number ${shortestFloat(v)} is ignored (src reads a number as a number, quoted or not)${
          K === 'TEXT' ? ', so the label has no text' : K === 'ID' ? ', so the node has no id' : ` and ${shown(field)} is used`}`, k)
      // The view box is 1 by 1 at least: Parse raises a smaller w or h to 1 without a report (Mathf.Max, :629-630).
      if (op === 'SCENE' && (K === 'W' || K === 'H') && typeof v === 'number' && v < 1)
        add('scene-size', `"${k}" below 1 is raised to 1 without a report, so the scene is 1 unit ${K === 'W' ? 'wide' : 'high'}: write 1 or more`, k)
      if (field.kind === 'P' && K !== 'TILE' && (typeof v === 'number' || (typeof v === 'string' && v[0] !== '[' && !(K === 'TILE' && /^(contain|cover)$/i.test(v)))))
        add('pair-scalar', `"${k}" takes a pair [x, y]; a single value is ignored: write [x, y]`, k)   // a tile fit word is read (:1693)
      // rep and srep are left out: the mod reports a word it does not know (RepeatMode). A G's fit is a default for its T
      // and IMG children alike (both read it from the merged map), so its row holds either's words.
      const words = field.enum ?? (K === 'WEIGHT' && (op === 'T' || op === 'G') ? ['bold', 'normal']
        : K === 'TILE' && op === 'IMG' ? ['contain', 'cover'] : undefined)
      if (words && typeof v === 'string' && !(op === 'IMG' && (K === 'REP' || K === 'SREP'))
        && v !== '' && ![...words, ...Object.keys(field.alias ?? {})].some(w => foldKey(w) === foldKey(v)))
        add('enum-word', `"${k}" does not take "${v}", the mod reports it, and ${op === 'G' && K === 'FIT' ? 'each child takes its own default' : `${shown(field)} is used`}: write ${or(words)}`, k)
      const gradient = K === 'FAT' || K === 'SAT'
      if (field.requires && !(field.requires === 'id' && !(typeof v === 'number' && v > 0.5)) && !fr.inSym && !met(field.requires, field.requiresAbove, gradient)) {
        const t = trap('needs-key', gradient ? `"${k}" is read only when "${field.requires}" is a gradient: make "${field.requires}" an @gradient or remove "${k}"`
          : `"${k}" is read only with "${field.requires}"${field.requires === 'id' ? ': the mod reports it' : ''}: add "${field.requires}" or remove "${k}"`, k)
        // A default this node passes down is read by every child that meets the requirement itself.
        if (t && kids && passesDown(op, k)) waiting.push({ need: field.requiresAbove === 'f' ? 'f' : 's', trap: t })
        else if (t) traps.push(t)
      }
    }

    // A reference DEFS does not declare (REFERENCE.md "Diagnostics", Tessellator.cs:1067, :1327, :4504; SceneModel.cs USE):
    // the mod reports it, and draws the group unclipped, the shape magenta, no mask, or nothing for the USE. Not in the
    // defs' own nodes or a clip's shapes, which draw nothing, nor a value a symbol substitutes.
    if (!fr.silent && !(fr.defs && op !== 'SYM')) {
      const as = (K: string) => Object.keys(n.attrs).find(k => foldKey(k) === K)
      const ref = (K: string) => { const v = fieldOf(op, K)?.kind === 'TEXT' ? textOf(a.get(K)) : a.get(K); return typeof v === 'string' && v !== '' && !subst(v) ? v : undefined }
      const clip = fieldOf(op, 'CLIP') ? ref('CLIP') : undefined, use = op === 'USE' ? ref('REF') : undefined, mask = fieldOf(op, 'MASK') ? ref('MASK') : undefined
      if (clip !== undefined && !clips.has(clip))
        add('undeclared', `clip "${clip}" is not declared in DEFS: the mod reports it and draws this ${op === 'USE' ? 'symbol' : 'group'} unclipped`, as('CLIP'))
      if (use !== undefined && !symbols.has(use)) add('undeclared', `symbol "${use}" is not declared in DEFS: the mod reports it and draws nothing here`, as('REF'))
      if (mask?.[0] === '@' && !placed.has(mask.slice(1)))
        add('undeclared', `mask="${mask}": gradient "${mask.slice(1)}" is not declared in DEFS: the mod reports it and masks nothing`, as('MASK'))
      for (const K of ['F', 'S']) {
        const v = drawsPaint(op, K as 'F' | 'S') ? ref(K) : undefined
        if (v?.[0] === '@' && !placed.has(v.slice(1)))
          add('undeclared', `${K.toLowerCase()}="${v}": gradient "${v.slice(1)}" is not declared in DEFS: the mod reports it and draws the shape magenta`, as(K))
      }
    }

    // [i+1] beside [i] (or [i-1]) of the same array is a neighbour (a slope, the next sample), not a 1-based index.
    const near = new Set(parts.flatMap(s => [...s.matchAll(NEAR_I)].map(m => m[1])))
    for (const s of parts) {
      const pi = PI.exec(s)
      if (pi) add('bare-pi', `"${pi[2]}" is a function in expressions: write ${pi[2]}()`)
      for (const [, name, at] of s.matchAll(INDEX))
        if (at === 'n') add('index-n', `"$${name}[n]" is past the end: arrays count from 0, so write $${name}[n-1] for the last`)
        else if (!near.has(name)) add('index-n', `"$${name}[i+1]" looks 1-based: arrays and i count from 0, so this skips the first item and reads past the end on the last; write $${name}[i]`)
    }
    if (op === 'USE') return

    // The colour is sampled where the point is in the shape's own frame (Tessellator.cs:3988), so a ramp in scene units
    // moves with every enclosing transform: only the shape's own position can slide under it. A band's and a sampled
    // line's x and y are per sample, which is their shape, not its motion.
    if (op !== 'YS' && op !== 'LS' && ['X', 'Y', 'CX', 'CY'].some(K => fieldOf(op, K) && motion(a.get(K))))
      for (const K of ['F', 'S']) {
        const v = a.get(K)
        if (fieldOf(op, K) && typeof v === 'string' && v[0] === '@' && placed.get(v.slice(1)) === 'fixed')
          add('gradient-units', `${K.toLowerCase()}="${v}" on a moving shape: gradient "${v.slice(1)}" is in scene units, so the shape slides under it; give "${v.slice(1)}" units=bbox`, K.toLowerCase())
      }
    // Only shadows need a closed ring: an open SP fills as if closed (Tessellator.cs:2400-2403), the code's reading,
    // confirmed upstream at 0.11.94 (REFERENCE.md is to follow).
    const sh = a.get('SH'), close = a.get('CLOSE')
    if (op === 'SP' && sh !== undefined && !(typeof close === 'number' && close > 0.5) && ![sh, close].some(subst))
      add('sp-shadow', 'SP casts no shadow without close=1: add close=1 or remove "sh"', 'sh')
    // p is read in x, y pairs (FromFlat, Tessellator.cs:4813-4820), so a last odd value is dropped; a p that is not a
    // list is no point, and an entry that is not a number reads as 0 (Numbers, SceneModel.cs:3013-3025). An L, Y or SP
    // with fewer than two points draws nothing (EmitPath, Tessellator.cs:2785), nor does one whose points are all at one place (a
    // stroke drops a point that repeats the one before it, Stroke.Clean; a fill there has no area). The minimum is per
    // paint: a stroke takes two points, a fill and a shadow three (FanShared, Tessellator.cs:3982; EmitShadows, :2647). With two, a
    // stroke draws the line between them and a fill encloses nothing: a Y's fill and shadow draw nothing (with three,
    // two of them one, its fill is none but its shadow draws), an L's fill nothing, and an SP's fill, whose points are
    // its curve's samples, at most its feathered edge, a hairline, and nothing where the two are (nearly) level or one
    // above the other, open or closed (Stroke.cs:381-383 leaves a ring of two open); a closed SP's shadow draws, as a
    // blurred line. A fill counts as an L's or an SP's only when it is its own: one passed down to a line under a filled
    // group is taken as not meant for it, though from three points the mod fills it (provisional, for the owner to rule). All without a report (measured at 0.11.97 to
    // 0.11.101, seen on a console at 0.11.101). Points closer than 0.01 apart, which Clean merges too, are not judged.
    // A clip's shape with too few points the mod reports (no usable shape); fr.clip here is only ever that shape.
    const p = a.get('P'), fills = (a.has('F') ? paintOf(a.get('F')) : fr.f) !== '' || sh !== undefined
    const filled = op === 'Y' ? fills : a.has('F') && paintOf(a.get('F')) !== ''
    if ((op === 'L' || op === 'Y' || op === 'SP') && !subst(p) && (p === undefined || Array.isArray(p) || typeof p === 'number')) {
      const xs = Array.isArray(p) ? p.map(x => typeof x === 'number' ? x : x === 'true' ? 1 : 0) : [], len = xs.length, points = len >> 1
      const pk = Object.keys(n.attrs).find(k => foldKey(k) === 'P')
      let distinct = 0
      for (let i = 0; i + 1 < len; i += 2) if (i === 0 || xs[i] !== xs[i - 2] || xs[i + 1] !== xs[i - 1]) distinct++
      if (len % 2) add('p-odd', `"p" has ${len} values, an odd number: the mod reads x, y pairs and ignores the last value, without a report: add its pair or remove it`, pk)
      if (!fr.clip && distinct < 2)
        add('p-few', `this ${op} has ${typeof p === 'number' ? 'no point ("p" is a number, not a list)' : points > 1 ? `${points} points, all at one place` : points ? 'one point' : 'no point'
        }, so the mod draws nothing, without a report: give "p" ${filled ? 'three points (six numbers)' : 'two points (four numbers)'} or more`, pk)
      else if (!fr.clip && points === 2 && filled)
        add('p-few', `this ${op} has two points, which enclose nothing, so its ${op === 'Y' ? 'fill and shadow draw nothing' : op === 'L' ? 'fill draws nothing'
          : 'fill draws at most its feathered edge, a hairline, and nothing where the two are (nearly) level or one above the other'}, without a report (a stroke draws the line between them): give "p" three points (six numbers) or more`, pk)
    }
    // A crossing ring is a problem only where the mod triangulates it: a fill, a shadow, a clip (REFERENCE.md "self-
    // intersecting fills"); a stroke draws it as it is. Past the work budget a ring is not tested.
    if (op === 'Y' && (fills || fr.clip) && Array.isArray(p) && p.length >= 8 && p.every(x => typeof x === 'number')) {
      const cost = (p.length >> 1) ** 2 / 2
      if (work + cost > MAX_WORK) unchecked++
      else if ((work += cost), crosses(p as number[])) add('y-crosses', 'this Y crosses itself, which the mod cannot fill, shadow or clip: uncross the ring or split it')
    }
    if (op === 'P' && (fills || fr.clip) && typeof a.get('D') === 'string') {
      for (const contour of flattenPath(a.get('D') as string) ?? []) {
        const ring: number[] = []
        for (let k = 0; k < contour.length; k += 2)
          if (!ring.length || contour[k] !== ring.at(-2) || contour[k+1] !== ring.at(-1)) ring.push(contour[k], contour[k+1])
        if (ring.at(-2) === ring[0] && ring.at(-1) === ring[1]) ring.splice(-2)
        if (ring.length < 8) continue
        const cost = (ring.length >> 1) ** 2 / 2
        if (work + cost > MAX_WORK) pathsUnchecked++
        else if ((work += cost), crosses(ring, true)) add('p-crosses', 'this P crosses itself, which the mod cannot fill, shadow or clip: uncross the ring or split it')
      }
    }
  }

  const rootWaiting: Frame['waiting'] = []
  visit(top, 'SCENE', head, { nodes: [], k: 0, inSym: false, defs: false, silent: true, clip: false, taken: false, unread: false,
    f: '', s: '', gotF: false, gotS: false, waiting: [] }, rootWaiting)
  for (const [list, defs] of [[scene.root, false], [scene.defs, true]] as const) {
    // The header's defaults by their exact keys, as a G's (ParseStyle on the props, :666).
    const frames: Frame[] = [{ nodes: list, k: 0, inSym: false, defs, silent: false, clip: false, taken: false, unread: false,
      f: paintOf(exact(scene.header, 'f')), s: paintOf(exact(scene.header, 's_')),
      gotF: false, gotS: false, waiting: defs ? [] : rootWaiting }]
    while (frames.length) {
      const fr = frames[frames.length - 1]
      if (fr.k === fr.nodes.length) {
        frames.pop()
        for (const w of fr.waiting) if (!(w.need === 'f' ? fr.gotF : fr.gotS)) traps.push(w.trap)
        const up = frames[frames.length - 1]
        if (up) { up.gotF ||= fr.gotF; up.gotS ||= fr.gotS }
        continue
      }
      const n = fr.nodes[fr.k++], op = typeof n.op === 'string' ? foldKey(n.op) : '', a = own(n.attrs), waiting: Frame['waiting'] = []
      const known = OPS.has(op) && op !== 'SYM'
      // After a clip's shape the rest is read by nothing, blocks included. The mod reports how many further shapes it
      // ignored (0.11.96), and how many def ops (0.11.99).
      if (fr.clip && fr.taken && OPS.has(op)) continue
      if (fr.unread) {
        if (OPS.has(op)) traps.push({ id: 'clip-extra', message: `this ${op} is inside the clip's shape, and the mod never reads it, without a report: a clip path takes its first shape alone, not its children`, node: n })
        continue
      }
      const shape = fr.clip && !fr.taken && SHAPES.has(op)
      fr.taken ||= shape
      // What the node passes down: its own f and s_ by their exact keys replace what it inherited (Merge, :1235, :1456);
      // written in another case they are not collected, and what it inherited passes on (ParseStyle, :1435-1454).
      const f = exact(n.attrs, 'f'), s_ = exact(n.attrs, 's_')
      const F = f !== undefined ? paintOf(f) : fr.f, S = s_ !== undefined ? paintOf(s_) : fr.s
      // Its own fill counts where it draws it (read in any case, PropValue) or passes it down.
      fr.gotF ||= (a.has('F') ? paintOf(a.get('F')) !== '' && (drawsPaint(op, 'F') || f !== undefined) : fr.f !== '' && drawsPaint(op, 'F')) || op === 'USE'
      fr.gotS ||= paintOf(s_) !== '' || (op !== 'G' && paintOf(a.get('S')) !== '') || (fr.s !== '' && !a.has('S') && drawsPaint(op, 'S')) || op === 'USE'
      if (known) visit(n, op, a, fr, waiting)
      if (n.c?.length) frames.push({ nodes: n.c, k: 0, inSym: fr.inSym || op === 'SYM', defs: false, silent: fr.silent || op === 'CP',
        clip: op === 'CP', taken: false, unread: shape, f: F, s: S, gotF: false, gotS: false, waiting })
    }
  }
  if (unchecked) traps.push({ id: 'y-unchecked', message: `whether ${unchecked === 1 ? 'one Y crosses itself' : `${unchecked} Y shapes cross themselves`} is not checked: the crossing checks ran out of work (more than ${MAX_WORK} steps)` })
  if (pathsUnchecked) traps.push({ id: 'p-unchecked', message: `whether ${pathsUnchecked === 1 ? 'one P contour crosses itself' : `${pathsUnchecked} P contours cross themselves`} is not checked: the crossing checks ran out of work (more than ${MAX_WORK} steps)` })
  return traps
}
