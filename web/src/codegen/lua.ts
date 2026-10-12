// Lua 5.2 literals and preview data shared by the exporter and editor.
import type { Page } from '../model/project'
import { shortestFloat } from '../srctext/print'
import type { Theme } from '../theme/types'
import { previewName, slotsOf, widgetsIn } from '../widgets/core'
import { nodeAt } from '../model/tree'

/** Lua with comments blanked and every string literal (quoted or long) replaced by `$<n>`, its body at strs[n]. */
export function lex(lua: string) {
  const strs: string[] = [], lineComments: string[] = []
  const code = lua.replace(/--\[(=*)\[[^]*?\]\1\]|--[^\n]*|\[(=*)\[[^]*?\]\2\]|"(?:\\[^]|[^"\\\n])*"|'(?:\\[^]|[^'\\\n])*'/g,
    (m, _commentLevel, _stringLevel, at: number) => {
      if (!m.startsWith('--')) return `$${strs.push(m.replace(/^\[=*\[|\]=*\]$|^["']|["']$/g, '')) - 1}`
      if (!/^--\[=*\[/.test(m) && /^\s*$/.test(lua.slice(lua.lastIndexOf('\n', at - 1) + 1, at))) lineComments.push(m)
      return ' '
    })
  return { code, strs, lineComments }
}

/** Lexical global writes: strings/comments are opaque, constructor keys are fields, and locals stay in their block. */
export function globalsWritten(lua: string): Set<string> {
  const tokens = lex(lua).code.match(/0[xX][0-9a-fA-F.]+(?:[pP][+-]?\d+)?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|\$\d+|==|~=|<=|>=|\.\.\.|\.\.|[^\s]/g) ?? []
  const writes = new Set<string>(), scopes: { kind: string; names: Set<string>; braces: number; loop?: string[] }[] = [
    { kind: 'root', names: new Set(), braces: 0 },
  ]
  let braces = 0
  const name = (s: string | undefined) => !!s && /^[A-Za-z_]\w*$/.test(s)
  const local = (s: string) => scopes.some(scope => scope.names.has(s))
  const write = (s: string) => { if (!local(s)) writes.add(s) }
  const push = (kind: string) => scopes.push({ kind, names: new Set(), braces })
  const pop = () => { if (scopes.length > 1) braces = scopes.pop()!.braces }
  // Skip one expression to find a local initializer's end or an until condition's end, without recursion.
  const binary = new Set(['+', '-', '*', '/', '%', '^', '..', '<', '>', '<=', '>=', '==', '~=', 'and', 'or'])
  const expressionEnd = (start: number, list = false) => {
    let i = start
    const brackets = () => {
      let depth = 0
      do {
        if ('([{'.includes(tokens[i])) depth++
        else if (')]}'.includes(tokens[i])) depth--
        i++
      } while (i < tokens.length && depth > 0)
    }
    while (i < tokens.length) {
      while (['-', '#', 'not'].includes(tokens[i])) i++
      if (tokens[i] === 'function') {
        let depth = 1
        while (++i < tokens.length && depth) {
          if (['function', 'if', 'do', 'repeat'].includes(tokens[i])) depth++
          else if (tokens[i] === 'end' || tokens[i] === 'until') depth--
        }
      } else if ('([{'.includes(tokens[i] ?? ' ')) brackets()
      else if (name(tokens[i]) || /^(?:\d|\$)/.test(tokens[i] ?? '')) i++
      else break
      while (i < tokens.length) {
        if (tokens[i] === '(' || tokens[i] === '[' || tokens[i] === '{') brackets()
        else if (tokens[i] === '.' || tokens[i] === ':') i += 2
        else if (tokens[i].startsWith('$')) i++
        else break
      }
      if (!binary.has(tokens[i]) && !(list && tokens[i] === ',')) break
      i++
    }
    return i
  }
  const at = new Map<number, (() => void)[]>()
  const later = (i: number, f: () => void) => { const list = at.get(i); if (list) list.push(f); else at.set(i, [f]) }
  for (let i = 0; i <= tokens.length; i++) {
    for (const f of at.get(i) ?? []) f()
    if (i === tokens.length) break
    const t = tokens[i], prev = tokens[i - 1]
    if (t === 'local') {
      if (tokens[i + 1] === 'function') {
        scopes.at(-1)!.names.add(tokens[i + 2])
      } else {
        const scope = scopes.at(-1)!, names: string[] = []
        do { names.push(tokens[++i]) } while (tokens[i + 1] === ',' && (++i, true))
        const bind = () => { for (const n of names) scope.names.add(n) }
        if (tokens[i + 1] === '=') { i++; later(expressionEnd(i + 1, true), bind) }
        else bind()
      }
    } else if (t === 'function') {
      if (name(tokens[i + 1]) && tokens[i + 2] === '(' && prev !== 'local') write(tokens[i + 1])
      push('function')
      braces = 0 // A function body inside a constructor still contains statements.
      while (i < tokens.length && tokens[i] !== '(') i++
      while (++i < tokens.length && tokens[i] !== ')') if (name(tokens[i])) scopes.at(-1)!.names.add(tokens[i])
    } else if (t === 'for') {
      push('for')
      const names: string[] = []
      do { names.push(tokens[++i]) } while (tokens[i + 1] === ',' && (++i, true))
      scopes.at(-1)!.loop = names
      if (tokens[i + 1] === '=') i++
    } else if (t === 'do') {
      const scope = scopes.at(-1)!
      if (scope.loop) { for (const n of scope.loop) scope.names.add(n); delete scope.loop }
      else push('do')
    } else if (t === 'then' || t === 'repeat') push(t)
    else if (t === 'else' || t === 'elseif') { pop(); if (t === 'else') push('then') }
    else if (t === 'end') pop()
    else if (t === 'until') later(expressionEnd(i + 1), pop)
    else if (t === '{') braces++
    else if (t === '}') braces--
    else if (t === '=' && braces === 0) {
      // Each bare name in the LHS list is a write; a member/index write keeps its owning global.
      let j = i - 1
      while (j >= 0) {
        let member = false, base = ''
        while (j >= 0) {
          if (tokens[j] === ']' || tokens[j] === ')') {
            const close = tokens[j], open = close === ']' ? '[' : '('
            let depth = 1
            while (--j >= 0 && depth) { if (tokens[j] === close) depth++; else if (tokens[j] === open) depth-- }
            member = true
          }
          if (!name(tokens[j])) break
          base = tokens[j--]
          if (tokens[j] !== '.' && tokens[j] !== ':') break
          member = true; j--
        }
        if (!base) break
        if (!member) write(base)
        if (tokens[j] !== ',') break
        j--
      }
    }
  }
  return writes
}

export const SCENE_ELEMENT = 'scene'
export const BACKGROUND_ELEMENT = 'bg'
// Upstream's two-element pattern: a second vector element holding only `data` for the scene element's structure, parked
// at a 1 × 1 rect off the surface.
export const DATA_ELEMENT = 'data'
export const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/   // #rrggbb[aa], the forms a theme writes: stricter than validate.ts's HEX on purpose
export const colourOr = (c: unknown, fallback: string) => typeof c === 'string' && HEX.test(c) ? c : fallback

// A Lua 5.2 string literal: no \u escapes (5.3+); control characters as three-digit decimal escapes.
export const quote = (s: string) =>
  '"' + s.replace(/[\\"\x00-\x1f\x7f]/g, c => c === '\\' || c === '"' ? '\\' + c : '\\' + String(c.charCodeAt(0)).padStart(3, '0')) + '"'

// A long string at the smallest level n >= 2 whose closer the text does not hold. Lua drops the newline after the
// opener, and the printer ends the text with LF, so the closer cannot merge with a trailing `]=`.
export function long(text: string) {
  let eq = '=='
  while (text.includes(`]${eq}]`)) eq += '='
  return `[${eq}[\n${text}]${eq}]`
}

export type Datum = number | string | number[] | string[]
export const f32 = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(Math.fround(x))
/** A value the data element can carry, else undefined: a finite float32, a string, or a non-empty list of one of them
 *  (src arrays take their type from the first item). A project may come from outside: nothing else reaches the Lua. */
export const datum = (v: unknown): Datum | undefined =>
  f32(v) || typeof v === 'string' ? v
  : Array.isArray(v) && v.length && v.every(f32) ? v as number[]
  : Array.isArray(v) && v.length && v.every(x => typeof x === 'string') ? v as string[] : undefined
/** What a page's data element sends: each widget slot's sample, then the page's own preview values. */
export function previewData(page: Page, t: Theme): Record<string, Datum> {
  const out: Record<string, Datum> = Object.create(null)   // a data name "__proto__" stays a name
  for (const { path } of widgetsIn(page.scene, t)) for (const s of slotsOf(nodeAt(page.scene.root, path)!, t)) { const d = datum(s.sample); if (d !== undefined) out[s.key] = d }
  for (const [k, v] of Object.entries(page.preview ?? {})) { const d = datum(v); if (d !== undefined && previewName(k)) out[k] = d }
  return out
}
export const item = (x: number | string) => typeof x === 'number' ? shortestFloat(x) : quote(x)

/** A double as Lua reads it back: JS's shortest round-trip form; never -0, never NaN or Infinity (sanitized before). */
export const num = (v: number) => !Number.isFinite(v) ? '0' : Object.is(v, -0) ? '0' : String(v)
/** A Lua literal: a number, a string, a boolean, a list of them; anything else nil. */
export function lit(v: unknown): string {
  if (typeof v === 'number') return num(v)
  if (typeof v === 'string') return quote(v)
  if (typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `{ ${v.map(lit).join(', ')} }`
  return 'nil'
}
