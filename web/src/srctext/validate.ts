// What a scene must satisfy before printSrc writes it: everything src cannot hold, and everything the mod at the pin
// (v0.11.118) would reject or read differently once printed (core/vendor/vector/SceneModel.cs).
// The mod has no depth limit (0.11.85; its src reader since 0.11.86), so neither has this: the written tree, the symbol
// expansion, arrays and colour expressions are walked with explicit stacks, and only symbol cycles and the work budgets stop.
import type { Scene, SrcNode, Value } from '../model/scene'
import { COLOUR_KEYS, DEF_OPS, fieldOf } from '../schema'
import { numberOf, WS, type Issue } from './parse'
import { parsePath } from './path'
import { shortestFloat } from './print'
import { placeholderClose, formatColon } from './placeholders'
import { first, foldKey, textOf } from './props'

// The work one pass of symbol expansion may do, in units: one per character read or written, CALL per node visited, key
// handled, argument merged, lookup or splice, and more where a step costs more a character (a refold, the colour
// checks, parsePath). Numbering's walk gives up past it too, charging nodes and substitutions. ponytail: the worst shapes
// found take about 0.7 s on a desktop; examples 01-19 need under 20,000 (11-symbols).
export const MAX_WORK = 50_000_000
const CALL = 32
/** The ops whose stops the mod reads (ReadStops): the catalogue's. */
export const GRADIENTS: ReadonlySet<string> = new Set(DEF_OPS.filter(op => fieldOf(op, 'stops')))

/** Every string in a value, in order, at any depth. */
export const strings = (v: Value): string[] => {
  if (typeof v === 'string') return [v]
  const out: string[] = []
  if (!Array.isArray(v)) return out
  for (const todo: Value[] = [v]; todo.length;) {
    const x = todo.pop()!
    if (typeof x === 'string') out.push(x)
    else if (Array.isArray(x)) for (let k = x.length - 1; k >= 0; k--) todo.push(x[k])
  }
  return out
}

/** A value as text at any depth, with the arrays still open on a stack: each number or string as `leaf` writes it, an
 *  array's items comma separated between `open` and `close`. (String, '', '') is String(v), (JSON.stringify) is
 *  JSON.stringify(v), whose own walks recurse and overflow the stack on an array some thousands deep. */
export const joined = (v: Value, leaf: (x: number | string) => string, open = '[', close = ']'): string => {
  const out: string[] = [], arrays: { a: Value[]; k: number }[] = []
  for (let x: Value | undefined = v; ;) {
    if (x !== undefined) {
      if (Array.isArray(x)) { out.push(open); arrays.push({ a: x, k: 0 }) }
      else out.push(leaf(x))
    }
    const top = arrays[arrays.length - 1]
    if (!top) return out.join('')
    if (top.k < top.a.length) { if (top.k) out.push(','); x = top.a[top.k++] }
    else { out.push(close); arrays.pop(); x = undefined }
  }
}

// foldKey, once per distinct name or source text: expansion folds the same ones at every instance, and a fold costs up
// to about 25 ns a character (ŉ, ß). Substituted text is folded directly, not kept. ponytail: the cache starts over
// past about 8M characters, so it holds about one scene; per-scene clearing if that ever matters.
const folds = new Map<string, string>()
let foldedChars = 0
const fold = (s: string) => {
  let f = folds.get(s)
  if (f === undefined) {
    if ((foldedChars += s.length + 32) > 8_000_000) { folds.clear(); foldedChars = s.length + 32 }
    folds.set(s, f = foldKey(s))
  }
  return f
}
/** fold(k) === key, without folding a key of another length (a fold keeps the length). */
const is = (k: string, key: string) => k.length === key.length && fold(k) === key
/** The folded name, for the names the checks look for (all at most 8 long); '' for any longer one. */
const short = (k: string) => k.length <= 8 ? fold(k) : ''
const breaks = (s: string) => /[\r\n]/.test(s)

// Symbol arguments, as SceneModel.cs at v0.11.118 builds them (USE :1694-1723, Substitute :1258-1302, Textual :1390-1398).
export type Arg = [string, Value]
// A text-form SYM's defaults are its whole map: op, its attributes, and c (its body) when it has one.
export const own = (n: SrcNode, op: Value, attrs: Arg[]): Arg[] => [['op', op], ...attrs, ...(n.c?.length ? [['c', []] as Arg] : [])]
export const merge = (base: Arg[], patch: Arg[]): Arg[] => {
  const replaced = new Set(patch.map(([k]) => fold(k)))
  return [...base.filter(([k]) => !replaced.has(fold(k))), ...patch]
}
// The first argument of each name, by folded name: built once per argument list (one per instance).
const lookups = new WeakMap<Arg[], Map<string, Value>>()
const lookup = (args: Arg[]) => {
  let m = lookups.get(args)
  if (!m) {
    lookups.set(args, m = new Map())
    for (const [k, v] of args) {
      const f = fold(k)
      if (!m.has(f)) m.set(f, v)
    }
  }
  return m
}
/** Roughly what reading a value costs: its characters and elements, at any depth. */
const weight = (v: Value): number => {
  if (!Array.isArray(v)) return typeof v === 'string' ? v.length + 1 : 1
  let n = 0
  for (const todo: Value[] = [v]; todo.length;) {
    const x = todo.pop()!
    if (Array.isArray(x)) { n++; for (const y of x) todo.push(y) }
    else n += typeof x === 'string' ? x.length + 1 : 1
  }
  return n
}
// One string or number of a value, with its %params in place (substitute's leaves).
const substituteText = (v: string | number, args: Arg[], cost: { units: number }): Value => {
  if (typeof v !== 'string' || v === '') return v
  cost.units += v.length
  const name = v.length > 1 && v[0] === '%' ? fold(v).slice(1) : undefined   // a fold is per code point, and % is one
  if (name !== undefined && lookup(args).has(name)) {
    const x = lookup(args).get(name)!
    cost.units += CALL + weight(x)
    return x
  }
  // Ported from scripted-screens-vector v0.11.118, SceneModel.cs:1332-1388 (MIT).
  const out: string[] = [], S = fold(v), nameChar = /^[\p{L}\p{Nd}_]$/u
  let at = 0
  for (let sigil = v.indexOf('%'); sigil >= 0; sigil = v.indexOf('%', at)) {
    let best: Arg | undefined
    for (const arg of args) {
      const k = arg[0], after = sigil + 1 + k.length
      cost.units += CALL + k.length
      if (cost.units > MAX_WORK) return v
      if (!k || (best && k.length <= best[0].length) || !S.startsWith(fold(k), sigil + 1)) continue
      if (nameChar.test(k.at(-1)!) && nameChar.test(v[after] ?? '')) continue
      best = arg
    }
    const by = best ? textOf(best[1]) ?? '' : '%'
    out.push(v.slice(at, sigil), by)
    cost.units += sigil - at + by.length
    if (cost.units > MAX_WORK) return v
    at = sigil + 1 + (best?.[0].length ?? 0)
  }
  out.push(v.slice(at))
  return out.join('')
}
// `%name` alone takes the argument's value and type; otherwise parameters splice once at name boundaries, longest first.
// Unchanged values come back as the same object; an array is rebuilt only when something in it changed. Arrays of any
// depth, with the arrays still open on a stack. cost.units adds up the work (see MAX_WORK): the value read, a whole value
// taken and the text after each splice (each splice reads the whole text). Past MAX_WORK it stops, so the result is no
// longer the mod's.
export const substitute = (v: Value, args: Arg[], cost = { units: 0 }): Value => {
  if (cost.units > MAX_WORK) return v
  cost.units++
  if (!Array.isArray(v)) return substituteText(v, args, cost)
  const open: { a: Value[]; k: number; out: Value[] | null }[] = [{ a: v, k: 0, out: null }]
  for (;;) {
    const top = open[open.length - 1]
    let x: Value
    if (top.k === top.a.length) {
      open.pop()
      x = top.out ?? top.a
      if (!open.length) return x
    } else {
      const y = top.a[top.k]
      if (cost.units > MAX_WORK) x = y
      else if (cost.units++, Array.isArray(y)) { open.push({ a: y, k: 0, out: null }); continue }
      else x = substituteText(y, args, cost)
    }
    const p = open[open.length - 1]   // x is p's item at p.k
    if (!p.out && x !== p.a[p.k]) p.out = p.a.slice(0, p.k)
    p.out?.push(x)
    p.k++
  }
}

export const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
/** Unity's colour names (ColorUtility, case-insensitive; core/Core/ManagedColour.cs, a drift test holds the two together)
 *  and the mod's own, none and gray (Colours.cs). */
export const COLOUR_NAMES: ReadonlySet<string> = new Set(['red', 'cyan', 'blue', 'darkblue', 'lightblue', 'purple', 'yellow',
  'lime', 'fuchsia', 'white', 'silver', 'grey', 'black', 'orange', 'brown', 'maroon', 'green', 'olive', 'navy', 'teal', 'aqua',
  'magenta', 'transparent', 'none', 'gray'])
/** A literal colour as Colours.TryParse reads it: trimmed, #hex or a name. */
export const isColour = (text: string) => { const t = text.trim(); return HEX.test(t) || COLOUR_NAMES.has(t.toLowerCase()) }
const HINT = 'use #hex, mix(a, b, t) or if(cond, a, b)'
type Slot = { want: 'colour' | 'number'; from: number; items: number; ops: boolean; kind: string }
type Open = { name: string; from: number; args: number; outer: Slot }   // name: mix, if, another call, ( or [
/**
 * Why `text` (an =expression on f or s) is not a colour expression, or null. As the mod checks it since 0.11.84
 * (Expression.IsColour): a colour is a #hex literal, mix(colour, colour, number) or if(number, colour, colour), in
 * brackets or not, every branch checked; anything else is reported and drawn magenta. A colour where a number goes, or a
 * mix there, is reported too. One pass with an explicit stack, so
 * any depth is fine.
 */
export function colourProblem(text: string): { problem: string } | null {
  const p = colourProblemText(text)
  return p === null ? null : { problem: p }
}
const NUMBER_EXPECTED = 'a number is expected where '
function colourProblemText(text: string): string | null {
  const s = text[0] === '=' ? text.slice(1) : text
  const slot = (want: Slot['want'], from: number): Slot => ({ want, from, items: 0, ops: false, kind: '' })
  const wantOf = (o: Open): Slot['want'] => o.name === '(' ? o.outer.want
    : o.outer.want === 'colour' && o.name === 'mix' ? (o.args < 2 ? 'colour' : 'number')
    : o.outer.want === 'colour' && o.name === 'if' ? (o.args === 0 ? 'number' : 'colour')
    : 'number'
  // A slot (the whole text, an argument, a bracket's inside) ends: what it holds must be what it wants. Its text is only
  // cut out when it is read, so a slot that holds a deep expression costs nothing here.
  const done = (x: Slot, to: number): string | null => {
    if (x.want === 'number') return null
    const one = x.items === 1 && !x.ops
    if (one && (x.kind === 'mix' || x.kind === 'if' || x.kind === '(')) return null   // checked inside
    const t = s.slice(x.from, to).trim()
    if (one && x.kind === '#') return HEX.test(t) ? null : `"${t}" is not a colour`
    if (one && x.kind === '$') return `"${t}" is data, not a colour: a colour expression takes #hex colours`
    return `a colour is expected where "${t}" is: ${HINT}`
  }
  const opens: Open[] = []
  let cur = slot('colour', 0), i = 0
  const open = (name: string, from: number) => {
    const o: Open = { name, from, args: 0, outer: cur }
    cur = slot(wantOf(o), i)
    opens.push(o)
  }
  while (i < s.length) {
    const c = s[i], from = i
    if (WS.test(c)) { i++; continue }
    if (c === '#') {
      i++
      while (i < s.length && /[0-9a-z]/i.test(s[i])) i++
      if (cur.want === 'number') return `${NUMBER_EXPECTED}"${s.slice(from, i)}" is`
      cur.items++; cur.kind = '#'
    } else if (/[0-9.]/.test(c)) {
      while (i < s.length && /[0-9.]/.test(s[i])) i++
      cur.items++; cur.kind = 'n'
    } else if (c === '$' || /[\p{L}_]/u.test(c)) {
      i++
      // A name: letters, digits and _ per UTF-16 unit, and a surrogate pair whole (Expression.cs ReadName, 0.11.98)
      for (;;) {
        if (/[\p{L}\p{Nd}_]/u.test(s[i] ?? '')) i++
        else if (/[\uD800-\uDBFF]/.test(s[i] ?? '') && /[\uDC00-\uDFFF]/.test(s[i + 1] ?? '')) i += 2
        else break
      }
      const name = s.slice(from, i)
      let j = i
      while (j < s.length && WS.test(s[j])) j++
      cur.items++; cur.kind = c === '$' ? '$' : name === 'mix' || name === 'if' ? name : 'call'
      if (s[j] === (c === '$' ? '[' : '(')) { i = j + 1; open(c === '$' ? '[' : name, from) }
      else if (c !== '$') cur.kind = 'name'
    } else if (c === '(') {
      i++; cur.items++; cur.kind = '('; open('(', from)
    } else if (c === ',' && opens.length && !'(['.includes(opens[opens.length - 1].name)) {
      const o = opens[opens.length - 1], p = done(cur, i)
      if (p) return p
      i++; o.args++; cur = slot(wantOf(o), i)
    } else if ((c === ')' || c === ']') && opens.length && (opens[opens.length - 1].name === '[') === (c === ']')) {
      const o = opens.pop()!, empty = !o.args && !cur.items && !cur.ops
      if (!empty) { const p = done(cur, i); if (p) return p }
      i++
      if ((o.name === 'mix' || o.name === 'if') && (empty ? 0 : o.args + 1) !== 3) return `${o.name}() takes 3 arguments`
      if (o.name === 'mix' && o.outer.want === 'number') return `${NUMBER_EXPECTED}"${s.slice(o.from, i)}" is`
      cur = o.outer
    } else { i++; cur.ops = true }   // an operator, or something the mod's parser refuses itself
  }
  return opens.length ? `a colour is expected where "${s.trim()}" is: ${HINT}` : done(cur, s.length)
}

/**
 * The colour rules on one attribute of a node of op `op` (folded; 'SCENE' for the header), where the mod reads it
 * (SceneModel.cs at the pin): f (ParseFill, every node, and a default on SCENE), s (ParseStroke, every node, a G too: there
 * only an array is the scale pair; SCENE's s is not read), s_ (a stroke default, read by ParseStyle on SCENE and on a node
 * with children), oc (a T's outline), a shadow's colour and a gradient stop's colour. Each is a warning, never an error: the
 * mod takes the value either way. A paint or an outline colour that is not a colour is reported and drawn magenta
 * (:2032-2040, :1562-1584); a shadow or a stop that is malformed or whose colour does not parse is dropped and reported
 * since 0.11.96 (ParseShadow :2828-2852, Gradient.cs GradientParser.ReadStops); a colour where a colour expression wants a
 * number is reported too. Strict paints still read numeric values as absent: traps.ts says so.
 */
const colourIssue = (f: string, v: Value, op: string, kids: boolean): { value: string; problem: string } | null => {
  if (f === 'F' || (f === 'S' && op !== 'SCENE') || (f === 'S_' && (kids || op === 'SCENE'))) {
    if (typeof v !== 'string' || v === '' || foldKey(v) === 'NONE' || v[0] === '@' || v[0] === '$') return null   // "none" untrimmed (:1908, :2416)
    if (v[0] !== '=') return isColour(v) ? null : { value: v, problem: 'not a colour: the mod reports it and draws the shape magenta; write #hex, none or a colour name' }
    const p = colourProblem(v)
    return p && { value: v, problem: `${p.problem}; the mod reports it and draws the shape magenta` }
  }
  if (f === 'OC') return op === 'T' && typeof v === 'string' && !isColour(v)
    ? { value: v, problem: 'not a colour: the mod reports it; an outline colour is #hex or a colour name, no expression or data' } : null
  if (f === 'SH' && Array.isArray(v) && v.length) {
    for (const e of Array.isArray(v[0]) ? v : [v]) {
      if (!Array.isArray(e)) continue
      if (e.length < 5) return { value: joined(e, JSON.stringify), problem: 'a shadow needs five values [dx, dy, blur, spread, colour]; the mod reports it and drops the shadow' }
      if (typeof e[4] !== 'string' || !isColour(e[4]))
        return { value: joined(e[4], String, '', ''), problem: 'not a colour: the mod reports it and drops this shadow; a shadow colour is #hex or a colour name, no expression or data' }
    }
  }
  if (f === 'STOPS' && GRADIENTS.has(op) && Array.isArray(v))
    for (const e of v) {
      const c = Array.isArray(e) ? e[1] : undefined
      if (typeof c === 'string' && !(c.length > 1 && c[0] === '$') && !isColour(c))
        return { value: c, problem: 'not a colour: the mod reports it and drops this stop; a stop colour is #hex, a colour name or $data' }
    }
  return null
}

// A symbol cycle as it is said: the chain from `from` back to `ref`, naming at most its first and last 8 symbols.
const cycleOf = (chain: string[], from: number, ref: string) => {
  const names = chain.length - from <= 16 ? chain.slice(from) : [...chain.slice(from, from + 8), '…', ...chain.slice(-8)]
  return `SYM "${ref}" uses itself through USE: ${[...names, ref].join(' > ')}`
}

/**
 * errors: what src cannot hold or the mod would reject; printSrc refuses a scene that has any. tooLarge: the first work
 * budget a symbol expansion ran past, when one did. Such a scene is too large to check here, which is not invalid: it
 * has no error for it and still prints; the caller decides what it means.
 */
export function validateScene(scene: Scene): { errors: Issue[]; warnings: Issue[]; tooLarge?: string } {
  const errors: Issue[] = [], warnings: Issue[] = []
  const add = (to: Issue[], message: string, node?: SrcNode, key?: string) => {
    to.push({ message, from: 0, to: 0, line: 0, col: 0, ...(node && { node }), ...(key !== undefined && { key }) })
  }

  // Every number and string of a value, at any depth.
  const check = (v: Value, node: SrcNode | undefined, numericText = false) => {
    for (const todo: Value[] = [v]; todo.length;) {
      const x = todo.pop()!
      if (typeof x === 'number') {
        if (!Number.isFinite(Math.fround(x))) add(errors, `the number ${x} cannot be written: NaN, Infinity and values beyond float32 are not portable`, node)
      } else if (typeof x === 'string') {
        const n = numberOf(x)
        if (n !== undefined && !(numericText && textOf(n) === x)) add(errors, `the text "${x}" would read as the number ${Number.isNaN(n) ? x.trim() : shortestFloat(n)}; src cannot hold it`, node)
        if (x.includes('\r')) add(errors, 'a value cannot hold a carriage return (CR)', node)
      } else for (let k = x.length - 1; k >= 0; k--) todo.push(x[k])
    }
  }

  // inSym: inside a SYM's block, where a value holding %param is checked once substituted (the expansion below).
  const keys = (attrs: Record<string, Value>, node: SrcNode | undefined, inSym = false) => {
    const op = !node ? 'SCENE' : typeof node.op === 'string' ? fold(node.op) : ''
    for (const [k, v] of Object.entries(attrs)) {
      const f = short(k)
      if (k === '') add(errors, 'an attribute name cannot be empty', node)
      if (breaks(k)) add(errors, `the attribute name ${JSON.stringify(k)} holds a line break`, node)
      if (f === 'C' || f === 'OP') add(errors, `reserved attribute "${k}": c and op are not attributes`, node)
      if (/^\d+$/.test(k)) add(errors, `the attribute name "${k}" is a number, which src cannot read as a name`, node)
      if (!node && (f === 'ROOT' || f === 'DEFS' || f === 'SCENE')) add(errors, `SCENE cannot set "${k}": it would hide the scene's own ${k.toLowerCase()}`)
      check(v, node, fieldOf(op, k)?.kind === 'TEXT')
      if (op !== 'USE' && op !== 'SYM' && !(inSym && strings(v).some(s => s.includes('%')))) {
        const colourNumber = (s: string) => {
          if (/#(?:[0-9a-f]+)|\bmix\s*\(/i.test(s.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '')))
            add(warnings, k + ': a colour is used where a number is read; the mod reports it', node, k)
        }
        if (!(op === 'G' && f === 'S' && !Array.isArray(v)) && ['E', 'P', 'L'].includes(fieldOf(op, k)?.kind ?? '')) for (const s of strings(v)) colourNumber(s)
        if (f === 'STOPS' && GRADIENTS.has(op) && Array.isArray(v))
          for (const stop of v) if (Array.isArray(stop) && typeof stop[0] === 'string') colourNumber(stop[0])
        if (f === 'SH' && fieldOf(op, k) && Array.isArray(v)) for (const shadow of Array.isArray(v[0]) ? v : [v]) {
          if (Array.isArray(shadow) && shadow.length >= 5 && shadow.slice(0, 4).some(n => typeof n !== 'number'))
            add(warnings, k + ': shadow offsets, blur and spread need literal numbers; the mod reports it and reads the faulty field as 0', node, k)
        }
        if (op === 'T' && f === 'TEXT') {
          const body = textOf(v)
          if (body && body[0] !== '$') {
            let templated = false
            for (let open = body.indexOf('{'); open >= 0; open = body.indexOf('{', open + 1)) {
              if (body[open + 1] !== '$' && body[open + 1] !== '=') continue
              templated = true
              const close = placeholderClose(body, open)
              if (close < 0) { add(warnings, 'T: text opens a placeholder that is never closed; the mod reports it and prints the literal text', node, k); break }
              const inner = body.slice(open + 2, close), binding = body[open + 1] === '$', colon = formatColon(inner, binding)
              const expression = colon < 0 ? inner : inner.slice(0, colon)
              if (!binding) colourNumber(expression)
              else { const bracket = expression.indexOf('['); if (bracket >= 0) colourNumber(expression.slice(bracket)) }
              open = close
            }
            if (!templated && textOf(first(node!, 'UNIT')))
              add(warnings, 'T: unit follows a value, and this label prints no value; the mod reports it', node, 'unit')
          }
        }
      }
      // A USE's and a SYM's own attributes are symbol arguments, not paints.
      if (COLOUR_KEYS.has(f) && op !== 'FONT' && op !== 'USE' && op !== 'SYM' && !(inSym && strings(v).some(s => s.includes('%')))) {
        const c = colourIssue(f, v, op, !node || !!node.c?.length)
        if (c) add(warnings, `${k}="${c.value}": ${c.problem}`, node, k)
      }
    }
  }

  const comments = (list: string[] | undefined, node?: SrcNode) => {
    for (const t of list ?? []) if (breaks(t)) add(errors, `the comment ${JSON.stringify(t)} holds a line break: write one comment per line`, node)
  }

  // The mod's Symbols table: exact ids; a later SYM replaces an earlier one; one without a body is no symbol.
  const syms = new Map<string, SrcNode>()
  for (const n of scene.defs) {
    const id = typeof n.op === 'string' && is(n.op, 'SYM') ? textOf(first(n, 'ID')) : undefined
    if (typeof id === 'string' && id && n.c?.length) syms.set(id, n)
  }

  // A USE is expanded the way the mod does it, so every %param reaches the path, the expression and the ref it lands in.
  // The mod refuses a symbol that reaches itself (0.11.77) and has no depth limit (0.11.85).
  // - From a real USE outside any symbol (strict; anchor: that USE): every check, on that USE's arguments.
  // - From each symbol's defaults alone (anchor: the SYM): cycles only. A %param without a default is how a symbol
  //   requires an argument, so it is unresolved there by design, and an unused symbol draws nothing.
  // Both passes charge work to MAX_WORK; symbol and node cardinality are unrestricted.
  // The defaults pass's expansions, told apart by ref and arguments. Equal values get the same id. A list of ids (an
  // array's elements, worked out once per array object, or a USE's ref and arguments) gets its id from a trie, so no
  // long key is built: V8 hashes a string past 16,383 characters by its length alone, and those all collide.
  type Trie = { id?: number; kids?: Map<number, Trie> }
  const expanded = new Set<number>(), ids = new Map<string | number, number>(), arrays = new WeakMap<Value[], number>()
  const trie: Trie = {}
  let next = 0
  const listId = (list: number[]) => {
    let t = trie
    for (const k of list) {
      let c = (t.kids ??= new Map()).get(k)
      if (!c) t.kids.set(k, c = {})
      t = c
    }
    return t.id ??= next++
  }
  const scalarId = (v: string | number) => ids.get(v) ?? (ids.set(v, next), next++)
  // An array's id from its elements' ids, the arrays not yet numbered on a stack: any depth.
  const idOf = (v: Value): number => {
    if (!Array.isArray(v)) return scalarId(v)
    const known = arrays.get(v)
    if (known !== undefined) return known
    const open: { a: Value[]; k: number; ids: number[] }[] = [{ a: v, k: 0, ids: [] }]
    for (;;) {
      const top = open[open.length - 1]
      if (top.k === top.a.length) {
        const n = listId(top.ids)
        arrays.set(top.a, n)
        open.pop()
        if (!open.length) return n
        const p = open[open.length - 1]
        p.ids.push(n)
        p.k++
        continue
      }
      const y = top.a[top.k]
      const n = Array.isArray(y) ? arrays.get(y) : scalarId(y)
      if (n === undefined) { open.push({ a: y as Value[], k: 0, ids: [] }); continue }
      top.ids.push(n)
      top.k++
    }
  }
  const spent = { strict: { units: 0 }, defaults: { units: 0 } }
  const TOO_MUCH = `symbols take too much work to expand: more than ${MAX_WORK} steps`
  // Past a budget the scene is too large to check here, which is not invalid: the first such message is kept apart from
  // the errors, and the caller decides what it means.
  let tooLarge: string | undefined
  const over = (strict: boolean, count: number, max: number, message: string) => {
    if (count <= max) return false
    if (strict || message === TOO_MUCH) tooLarge ??= message
    return true
  }
  // A symbol instantiated many times under one anchor repeats its issues: each is said once per anchor.
  const said = new WeakMap<SrcNode, Set<string>>()
  const once = (to: Issue[], message: string, anchor: SrcNode) => {
    const s = said.get(anchor) ?? new Set<string>()
    said.set(anchor, s)
    if (!s.has(message)) { s.add(message); add(to, message, anchor) }
  }

  // One USE's expansion, depth first with an explicit stack: a chain of symbols and a body nest as deep as they like
  // (0.11.85). A frame is a node list being walked with its symbol's arguments; the frame that opens an expansion carries
  // its ref, which is on the chain while the frame is on the stack. Past a budget it stops at once: every later step
  // would stop on the same count.
  type Frame = { nodes: SrcNode[]; k: number; args: Arg[]; ref?: string }
  const expandUse = (op: Value, attrs: Arg[], n: SrcNode, anchor: SrcNode, strict: boolean) => {
    const b = strict ? spent.strict : spent.defaults
    // cycled: the refs whose cycle is said, once each: a chain may be 10,000 symbols long and closed by as many USEs.
    const chain: string[] = [], on = new Set<string>(), cycled = new Set<string>(), frames: Frame[] = []
    // The frame of a USE's expansion; null when there is nothing to expand, 'stop' past a budget.
    const use = (op: Value, attrs: Arg[], n: SrcNode): Frame | null | 'stop' => {
      const ref = textOf(attrs.find(([k]) => is(k, 'REF'))?.[1])
      if (typeof ref !== 'string') return null
      if (chain.length && ref.includes('%')) {
        if (strict) once(errors, `USE ref="${ref}": the symbol reference cannot be resolved`, anchor)
        return null
      }
      if (over(strict, b.units += CALL + ref.length, MAX_WORK, TOO_MUCH)) return 'stop'   // the lookups of ref
      const sym = syms.get(ref)
      if (!sym) return null
      if (on.has(ref)) {
        if (!cycled.has(ref)) { cycled.add(ref); once(errors, cycleOf(chain, 0, ref), anchor) }
        return null
      }
      const args = merge(own(sym, sym.op, Object.entries(sym.attrs)), own(n, op, attrs))
      // Merging, the lookup table and the defaults pass's key each read every argument about once.
      b.units += args.reduce((u, [k, v]) => u + CALL + k.length + weight(v), 0)
      if (over(strict, b.units, MAX_WORK, TOO_MUCH)) return 'stop'
      if (!strict) {
        const key = listId([idOf(ref), ...args.flatMap(([k, v]) => [idOf(k), idOf(v)])])
        if (expanded.has(key)) return null
        expanded.add(key)
      }
      return { nodes: sym.c ?? [], k: 0, args, ref }
    }
    const push = (f: Frame) => {
      frames.push(f)
      if (f.ref !== undefined) { chain.push(f.ref); on.add(f.ref) }
    }
    const start = use(op, attrs, n)
    if (!start || start === 'stop') return
    push(start)
    while (frames.length) {
      const f = frames[frames.length - 1]
      if (f.k >= f.nodes.length) {
        frames.pop()
        if (f.ref !== undefined) { chain.pop(); on.delete(f.ref) }
        continue
      }
      const n = f.nodes[f.k++], sym = chain[chain.length - 1]
      const raws = Object.entries(n.attrs)
      b.units += raws.reduce((u, [k]) => u + CALL + k.length, CALL)   // the node, and the keys the checks below fold
      const op = substitute(n.op, f.args, b), attrs: Arg[] = raws.map(([k, v]) => [k, substitute(v, f.args, b)])
      if (over(strict, b.units, MAX_WORK, TOO_MUCH)) return
      if (strict) {
        // What walk checked unsubstituted is not checked again. The colour checks read a value about 5 times over (a
        // number costs nothing), and parsePath costs about 8 units a character.
        const kind = typeof op === 'string' ? fold(op) : ''
        for (let i = 0; i < attrs.length; i++) {
          const [k, v] = attrs[i], key = short(k)
          // An unchanged value was checked by walk, unless it holds a %param no argument or default supplied.
          if ((v === raws[i][1] && !strings(v).some(s => s.includes('%'))) || !COLOUR_KEYS.has(key) || kind === 'USE' || kind === 'SYM') continue
          if (typeof v !== 'number' && over(strict, b.units += 5 * weight(v), MAX_WORK, TOO_MUCH)) return
          const c = colourIssue(key, v, kind, !!n.c?.length)
          if (c) once(warnings, `${k}="${c.value}" in SYM "${sym}": ${c.problem}`, anchor)
        }
        const d = attrs.find(([k]) => is(k, 'D'))?.[1], raw = first(n, 'D')
        const checked = typeof n.op === 'string' && is(n.op, 'P') && typeof raw === 'string' && !raw.includes('%')
        if (typeof op === 'string' && is(op, 'P') && typeof d === 'string' && !checked) {
          if (over(strict, b.units += 8 * d.length, MAX_WORK, TOO_MUCH)) return
          const r = parsePath(d)
          if ('error' in r) once(errors, `d="${d}" in SYM "${sym}": ${r.error} (at ${r.at})`, anchor)
        }
      }
      // A USE's expansion comes before its own block, as the mod builds them: pushed last, so walked first.
      if (n.c?.length) push({ nodes: n.c, k: 0, args: f.args })
      if (typeof op === 'string' && is(op, 'USE')) {
        const next = use(op, attrs, n)
        if (next === 'stop') return
        if (next) push(next)
      }
    }
  }

  // The written tree, depth first with an explicit stack. top: true for root nodes (DEFS { holds the others).
  // expand: in the root tree, where the mod instantiates every USE outside a symbol.
  const walk = (list: SrcNode[], top: boolean, expand: boolean) => {
    const frames: { nodes: SrcNode[]; k: number; inSym: boolean }[] = [{ nodes: list, k: 0, inSym: false }]
    while (frames.length) {
      const f = frames[frames.length - 1]
      if (f.k === f.nodes.length) { frames.pop(); continue }
      const n = f.nodes[f.k++], inSym = f.inSym
      if (typeof n.op !== 'string' || n.op === '') add(errors, 'a node needs an op', n)
      else if (breaks(n.op)) add(errors, `the op ${JSON.stringify(n.op)} holds a line break`, n)
      if (top && frames.length === 1 && (n.op === 'SCENE' || n.op === 'DEFS')) add(errors, `a root node cannot be ${n.op}: it would be read as the scene's ${n.op} line`, n)
      keys(n.attrs, n, inSym)
      comments(n.comments, n)
      comments(n.tail, n)
      if (n.eol !== undefined) comments([n.eol], n)
      const op = typeof n.op === 'string' ? fold(n.op) : ''
      if (op === 'C') {
        const rx = first(n, 'RX'), ry = first(n, 'RY')
        if ((ry !== undefined && rx === undefined) || (typeof rx === 'number' && rx < 0) || (typeof ry === 'number' && ry < 0))
          add(warnings, 'C: rx is missing or a literal radius is negative; the mod reports it and draws nothing', n)
      }
      if (op === 'FONT') {
        if (top || frames.length !== 1) add(warnings, 'op "FONT" is not supported here: FONT belongs directly in DEFS', n)
        else {
          const src = first(n, 'SRC')
          if (typeof src !== 'string' || src === '') add(warnings, 'FONT: src needs a non-empty string URL', n, 'src')
          for (const k of Object.keys(n.attrs)) if (foldKey(k) !== 'SRC') add(warnings, 'FONT: unknown attribute "' + k + '"', n, k)
          if (n.c !== undefined) add(warnings, 'FONT: unknown attribute "c"', n, 'c')
        }
      }
      const d = op === 'P' ? first(n, 'D') : undefined
      // Inside a SYM body a %param is substituted first; the expansion checks the path it makes.
      if (typeof d === 'string' && !(inSym && d.includes('%'))) {
        const r = parsePath(d)
        if ('error' in r) add(errors, `d: ${r.error} (at ${r.at})`, n)
      }
      if (op === 'USE' && expand) expandUse(n.op, Object.entries(n.attrs), n, n, true)
      if (n.c?.length) frames.push({ nodes: n.c, k: 0, inSym: inSym || op === 'SYM' })
    }
  }

  keys(scene.header, undefined)
  for (const list of Object.values(scene.notes ?? {})) comments(list)
  for (const [id, sym] of syms) {
    expandUse('USE', [['ref', id]], { op: 'USE', attrs: {} }, sym, false)
  }
  if (spent.defaults.units > MAX_WORK) {
    // The cycles through literal refs, found without substituting: depth first over the symbols, explicit stack. A
    // symbol's state is its place on the chain while it is open; each cycle is said once a ref.
    const state = new Map<string, number | 'done'>(), cycled = new Set<string>()
    for (const root of syms.keys()) {
      if (state.has(root)) continue
      const chain = [root], frames: { nodes: SrcNode[]; k: number; ref?: string }[] = [{ nodes: syms.get(root)!.c!, k: 0, ref: root }]
      state.set(root, 0)
      while (frames.length) {
        const f = frames[frames.length - 1]
        if (f.k >= f.nodes.length) {
          frames.pop()
          if (f.ref !== undefined) { state.set(f.ref, 'done'); chain.pop() }
          continue
        }
        const n = f.nodes[f.k++]
        if (n.c?.length) frames.push({ nodes: n.c, k: 0 })
        const ref = typeof n.op === 'string' && is(n.op, 'USE') ? textOf(first(n, 'REF')) : undefined
        if (typeof ref !== 'string' || !syms.has(ref)) continue
        const at = state.get(ref)
        if (typeof at === 'number') {
          if (!cycled.has(ref)) { cycled.add(ref); once(errors, cycleOf(chain, at, ref), syms.get(ref)!) }
        } else if (at === undefined) {
          state.set(ref, chain.length)
          chain.push(ref)
          frames.push({ nodes: syms.get(ref)!.c!, k: 0, ref })
        }
      }
    }
  }
  walk(scene.root, true, true)
  walk(scene.defs, false, false)

  if (!Object.keys(scene.header).length && !scene.defs.length && !scene.root.length) add(errors, 'the scene is empty: src needs a SCENE line or a node')
  return { errors, warnings, ...(tooLarge !== undefined && { tooLarge }) }
}
