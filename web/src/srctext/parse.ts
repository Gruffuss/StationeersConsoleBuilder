// The src scene text, parsed strictly. Every text this accepts gives the props the mod's SceneText.ToProps gives
// (ScriptedScreensVector v0.11.118, SceneText.cs); anything the mod mis-reads, hangs on or rejects is an error here.
// Grammar and edge cases follow core/vendor/vector/SceneText.cs. The goldens in test/srctext/accept prove the match.
import type { Scene, SrcNode, Value } from '../model/scene'
import { GROUP_PAINT_DEFAULTS } from '../schema'
import { foldKey } from './props'

export type Range = { from: number; to: number }
// node, key: set by validateScene, the node and the attribute (as written) an issue is about.
export type Issue = { message: string; from: number; to: number; line: number; col: number; node?: SrcNode; key?: string }
export type ParseResult = { scene?: Scene; errors: Issue[]; warnings: Issue[]; ranges: Map<SrcNode, Range> }

export const WS = /[\t-\r \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/   // .NET char.IsWhiteSpace, not JS \s
// float.TryParse(NumberStyles.Float, InvariantCulture): white is only U+0009-000D and space, and .NET ignores trailing
// NULs. Written so a long digit run cannot backtrack quadratically.
const NUMBER = /^[\t-\r ]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[\t-\r ]*\0*$/
// Its NaN/Infinity fallback trims with char.IsWhiteSpace (the WS class); NULs are trimmed too, since rejecting more is safe.
const NON_FINITE = new RegExp(`^[${WS.source.slice(1, -1)}\\0]*[+-]?(nan|infinity)[${WS.source.slice(1, -1)}\\0]*$`, 'i')
const FLOAT_MAX = 3.4028235e38

class Failed extends Error { constructor(readonly issue: Issue) { super(issue.message) } }

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer)

/** The decimal `s` rounded straight to float32, as float.Parse does. */
export function toFloat32(s: string): number {
  const d = Number(s), f = Math.fround(d)
  if (f === d) return f
  // Math.fround(Number(s)) rounds twice. That differs from one rounding only when the double lands exactly halfway
  // between two floats; then the exact decimal decides which side it was on.
  f32[0] = f
  u32[0] += Math.abs(d) > Math.abs(f) ? 1 : -1
  const g = f32[0]
  if ((f + g) / 2 !== d) return f
  const [, int, frac, exp] = /^[+-]?(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(s)!
  let a = BigInt(int + frac), m = Math.abs(d), e = 0
  while (!Number.isInteger(m)) { m *= 2; e-- }   // |d| = m·2^e, exactly
  let b = BigInt(m)
  const q = Number(exp ?? 0) - frac.length       // |s| = a·10^q
  if (q >= 0) a *= 10n ** BigInt(q); else b *= 10n ** BigInt(-q)
  if (e < 0) a *= 2n ** BigInt(-e)
  const away = Math.abs(g) > Math.abs(f) ? g : f
  return a > b ? away : a < b ? (away === f ? g : f) : f
}

/**
 * The number a token reads as, quoted or not (quoting never makes a string: whatever float.TryParse reads is a number),
 * or undefined when it stays a string. NaN for a number src cannot carry: NaN, Infinity or beyond float32.
 */
export function numberOf(t: string): number | undefined {
  if (t === '' || '=#@'.includes(t[0])) return undefined
  if (NUMBER.test(t)) {
    const s = t.replace(/[\t-\r \0]/g, '')
    return Math.abs(Number(s)) > FLOAT_MAX ? NaN : toFloat32(s)
  }
  return NON_FINITE.test(t) ? NaN : undefined
}

export function parseSrc(text: string): ParseResult {
  const warnings: Issue[] = []
  const ranges = new Map<SrcNode, Range>()
  let starts: number[] | undefined                  // line starts, built on the first issue
  const at = (message: string, from: number, to: number): Issue => {
    if (!starts) {
      starts = [0]
      for (let k = 0; k < text.length; k++) {
        if (text[k] === '\n' || (text[k] === '\r' && text[k + 1] !== '\n')) starts.push(k + 1)
      }
    }
    let lo = 0, hi = starts.length - 1              // the last line start <= from
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= from) lo = mid; else hi = mid - 1 }
    return { message, from, to, line: lo + 1, col: from - starts[lo] + 1 }
  }
  const fail = (message: string, from: number, to = from + 1): never => {
    throw new Failed(at(message, from, Math.min(to, text.length)))
  }
  const warn = (message: string, from: number, to: number) => { warnings.push(at(message, from, to)) }

  let i = 0
  let anyNode = false
  let pending: string[] = []                        // own-line comments waiting for the line they belong to
  let eol: ((t: string) => void) | null = null      // where a comment goes when a node started on its line
  const header: Record<string, Value> = Object.create(null)
  const headerKeys = new Set<string>()             // folded, shared by every SCENE line
  const defs: SrcNode[] = []
  const notes = { header: [] as string[], defs: [] as string[], defsTail: [] as string[], tail: [] as string[] }
  const take = () => { const t = pending; pending = []; return t }
  const append = <T>(to: T[], from: T[]) => { for (const x of from) to.push(x) }   // no spread: a long list would overflow the stack

  const skipInline = () => { while (text[i] === ' ' || text[i] === '\t') i++ }
  const lineEnd = (k: number) => { while (k < text.length && text[k] !== '\n' && text[k] !== '\r') k++; return k }

  // Whitespace and comments between nodes. A comment runs to \n, as in the mod; "# text" is stored as "text".
  const trivia = () => {
    for (;;) {
      const c = text[i]
      if (c === '\n' || c === '\r') { eol = null; i++ }
      else if (c === '#') {
        let end = text.indexOf('\n', i)
        if (end < 0) end = text.length
        let t = text.slice(i + 1, end)
        i = end
        if (t.endsWith('\r')) t = t.slice(0, -1)
        if (t.startsWith(' ')) t = t.slice(1)
        if (eol) eol(t); else pending.push(t)
      }
      else if (c !== undefined && WS.test(c)) i++
      else return
    }
  }

  // A quoted token, or a bare one up to WS, = { } [ ] , or a # that is not its first char (SceneText.ReadToken).
  const token = (inArray = false): string => {
    if (text[i] === '"') {
      const open = i++
      let s = ''
      for (;;) {
        const c = text[i++]
        if (c === undefined) fail('unterminated " (a quoted value needs its closing ")', open)
        if (c === '"') return s
        if (c === '\\' && i < text.length) {
          const e = text[i++]
          s += e === '"' ? '"' : e === '\\' ? '\\' : e === 'n' ? '\n' : e === 't' ? '\t' : '\\' + e
        } else s += c
      }
    }
    const from = i
    while (i < text.length && !WS.test(text[i]) && !'={}[],'.includes(text[i]) && !(text[i] === '#' && i > from)) i++
    if (!inArray && text[i] === '#' && i > from) warn('"#" ends this value; quote the value to keep the rest', i, lineEnd(i))
    return text.slice(from, i)
  }

  const untilWs = () => { const from = i; while (i < text.length && !WS.test(text[i])) i++; return text.slice(from, i) }

  const typed = (t: string, from: number): Value => {
    const n = numberOf(t)
    if (n === undefined) return t
    if (Number.isNaN(n)) fail('not a portable number: NaN, Infinity and values beyond float32 cannot be written', from, i)
    return n
  }

  // An array, from its [ (SceneText.ReadValue). The arrays still open are on a stack, so any depth reads, as in the mod
  // since 0.11.86. A nested array goes into its parent when its [ opens; nothing reads it before its ] closes.
  const array = (): Value[] => {
    const top: Value[] = [], open: Value[][] = [top]
    i++
    for (;;) {
      skipInline()
      const c = text[i], items = open[open.length - 1]
      if (c === ']') { i++; open.pop(); if (!open.length) return top; continue }
      if (c === ',') { i++; continue }
      if (c === undefined || c === '{' || c === '}' || WS.test(c)) fail('array must close on the same line, with no { or } inside', i)
      if (c === '[') { const inner: Value[] = []; items.push(inner); open.push(inner); i++ }
      else if (c === '=') items.push(untilWs())
      else {
        const from = i
        const t = token(true)
        if (c !== '"' && (text[i] === '[' || text[i] === '=' || text[i] === '#')) fail(`quote this value: "${text[i]}" cannot follow an unquoted item`, from, i + 1)
        items.push(typed(t, from))
      }
    }
  }

  // After `key=`: an array, an =expression or a $binding read to whitespace (a $ since 0.11.93; inside an array a $ item
  // is an ordinary token), or a token (SceneText.ReadValue, ReadScalar).
  const value = (): Value => {
    if (text[i] === '[') return array()
    if (text[i] === '=' || text[i] === '$') return untilWs()
    const sp = i
    skipInline()
    if (i > sp && (text[i] === '[' || text[i] === '=')) fail('no space after = before an array or an expression', i)
    const from = i, quoted = text[i] === '"'
    const t = token()
    if (!quoted && i < text.length && '[],{='.includes(text[i])) fail(`quote this value: "${text[i]}" cannot be part of an unquoted value`, from, i + 1)
    return typed(t, from)
  }

  const attr = (attrs: Record<string, Value>, seen: Set<string>) => {
    const from = i, c = text[i]
    if ('=[],'.includes(c)) fail(`unexpected "${c}": quote this value if it belongs to one`, i)
    if (WS.test(c)) fail(`unexpected U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}: only spaces and tabs separate attributes`, i)
    const key = token()
    if (key === '') fail('an attribute name cannot be empty', from, i)
    if (/^\d+$/.test(key)) fail('attribute names cannot be numbers', from, i)
    const k = foldKey(key)
    if (k === 'C' || k === 'OP') fail(`reserved attribute "${key}": c and op are not attributes`, from, i)
    skipInline()
    let v: Value = 1                                // a bare key is a flag
    if (text[i] === '=') { i++; v = value() }
    // A key that folds like an earlier one is dropped: the mod's PropValue reads the first. A group default's exact,
    // lower-case key is kept after another spelling (F= then f=), as ParseStyle collects it alone (SceneModel.cs
    // :1435-1444 at v0.11.118) and passes it down; seen holds it as =key, which no folded key can be.
    const exact = GROUP_PAINT_DEFAULTS.includes(key)
    if (exact ? seen.has('=' + key) : seen.has(k)) warn(`duplicate attribute "${key}" ignored: the first one wins`, from, i)
    else { seen.add(k); if (exact) seen.add('=' + key); attrs[key] = v }
  }

  // A node whose block is open: its line's start, its {, and its children so far. SCENE and DEFS are folded into the
  // header and defs; their own node is never returned.
  type Block = { n: SrcNode; kind: '' | 'SCENE' | 'DEFS'; from: number; open: number; kids: SrcNode[] }
  const root: SrcNode[] = [], open: Block[] = []

  // A node is complete: its line read and, with a block, its } reached. Only now is anything read from its children:
  // a fold over a list not yet filled reads nothing (upstream's 0.11.85 lesson, fixed in 0.11.87).
  const done = (b: Block, to: number) => {
    if (b.kind === 'DEFS') {
      if (Object.keys(b.n.attrs).length) warn('attributes on DEFS are ignored', b.from, to)
      append(defs, b.n.c ?? [])
    } else if (!b.kind) {
      ranges.set(b.n, { from: b.from, to })
      ;(open.length ? open[open.length - 1].kids : root).push(b.n)
    }
  }

  // One node's line: op {attr}, up to the line's end, a } or a {. Returns the node's block when a { opens one.
  const line = (): Block | null => {
    const from = i
    if (text[i] === '{') fail('{ must be on the same line as its node', i)
    const op = token()
    if (op === '') fail('expected an op (a node name) here', from, i)
    anyNode = true
    const kind = !open.length && (op === 'SCENE' || op === 'DEFS') ? op : ''
    const n: SrcNode = { op, attrs: kind === 'SCENE' ? header : Object.create(null) }
    const keys = kind === 'SCENE' ? headerKeys : new Set<string>()
    const above = take()
    if (kind === 'SCENE') { append(notes.header, above); eol = t => notes.header.push(t) }
    else if (kind === 'DEFS') { append(notes.defs, above); eol = t => notes.defs.push(t) }
    else { if (above.length) n.comments = above; eol = t => { n.eol = t } }
    const b: Block = { n, kind, from, open: -1, kids: [] }
    let to = i
    for (;;) {
      skipInline()
      const c = text[i]
      if (c === undefined || c === '\n' || c === '\r' || c === '#') { done(b, lineEnd(i)); return null }
      if (c === '}') { done(b, to); return null }
      if (c === '{') { b.open = i++; return b }
      attr(n.attrs, keys)
      to = i
    }
  }

  // Every node, with the blocks open on a stack: nothing recurses, so the text nests as deep as it likes (SceneText.cs
  // has no limit since 0.11.86). A block's children are attached to its node when its } closes it, then done() reads them.
  const nodes = () => {
    for (;;) {
      trivia()
      if (i >= text.length) {
        if (open.length) fail('missing } for this {', open[open.length - 1].open)
        return
      }
      if (text[i] === '}') {
        if (!open.length) fail('unmatched }', i)
        i++
        const b = open.pop()!
        if (pending.length) {
          const t = take()
          if (b.kind === 'DEFS') append(notes.defsTail, t)
          else if (!b.kind) b.n.tail = t
        }
        if (b.kind === 'SCENE') warn('SCENE takes no block: what is inside is ignored', b.open, i)
        else b.n.c = b.kids
        done(b, i)
        continue
      }
      const b = line()
      if (b) open.push(b)
    }
  }

  try {
    if (text.charCodeAt(0) === 0xfeff) fail('the text starts with a byte-order mark; save it without one', 0)
    nodes()
    append(notes.tail, take())
    if (!anyNode) fail('the scene text has no nodes', 0, text.length)
    const scene: Scene = { header, defs, root }
    const kept = Object.entries(notes).filter(([, v]) => v.length)
    if (kept.length) scene.notes = Object.fromEntries(kept)
    return { scene, errors: [], warnings, ranges }
  } catch (e) {
    if (e instanceof Failed) return { errors: [e.issue], warnings, ranges: new Map() }
    throw e
  }
}
