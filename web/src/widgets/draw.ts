// Drawing primitives: no widget registry or expansion dependencies.
import type { SrcNode, Value } from '../model/scene'
import { shortestFloat } from '../srctext/print'
import { colour } from '../theme'
import type { Paint, Theme } from '../theme/types'

export type At = number | string   // a literal, or an expression '=…' (a position inside an RP)
const FLOAT_MAX = Math.fround(3.4028235e38)
/** A number written inside an expression: the shortest decimal that reads back as the same float32, in plain notation.
 *  The mod's expression lexer reads digits and '.' only (Expression.cs ReadNumber), so there is never an exponent, NaN or
 *  Infinity: NaN writes 0, and ±Infinity the largest float32 (a float32 attribute holds nothing beyond it). */
export function num(v: number): string {
  const f = Math.fround(v)
  if (Number.isNaN(f)) return '0'
  const s = shortestFloat(Number.isFinite(f) ? f : Math.sign(f) * FLOAT_MAX)
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s)   // JS writes an exponent below 1e-6 and from 1e21
  if (!m) return s === '-0' ? '0' : s
  const digits = m[2] + (m[3] ?? ''), e = Number(m[4])
  return m[1] + (e < 0 ? '0.' + '0'.repeat(-e - 1) + digits : digits.padEnd(e + 1, '0'))
}

/** A node. Attributes whose value is undefined are left out. */
export function el(op: string, attrs: Record<string, Value | undefined>, c?: SrcNode[]): SrcNode {
  const a: Record<string, Value> = {}
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) a[k] = v
  return c ? { op, attrs: a, c } : { op, attrs: a }
}
/** `a` moved by `d`: a number stays a number, an expression gains +d or -d. */
export const plus = (a: At, d: number): At =>
  typeof a === 'number' ? a + d : d === 0 ? a : `${a}${d < 0 ? '-' : '+'}${num(Math.abs(d))}`


/** The four-state colour (Q4): 1 ok, 2 warn, 3 crit, else idle. k is `$name` or `$name[i]`. */
export const st4 = (t: Theme, k: string) =>
  `=if(eq(${k},1),${colour(t, 'status-ok')},if(eq(${k},2),${colour(t, 'status-warn')},if(eq(${k},3),${colour(t, 'status-crit')},${colour(t, 'status-idle')})))`

export function paintOf(t: Theme, p: Paint | undefined, state?: string): string | undefined {
  if (p === undefined || p === 'none') return p
  if (typeof p === 'object') return fill(p.gradient)
  if (p === 'state') {
    if (state === undefined) throw new Error('state paint requires a state slot')
    return st4(t, state)
  }
  return colour(t, p)
}
export const fill = (gradient: string) => '@theme_' + gradient

const paint = (t: Theme, c: string) => c[0] === '#' ? c : colour(t, c)
/** A shadow list with its roles resolved: a shadow colour is always a literal. A name the theme lacks throws. */
export function shadow(t: Theme, name: string): Value {
  if (!Object.hasOwn(t.shadows, name)) throw new Error(`the theme "${t.name}" has no shadow "${name}"`)
  return t.shadows[name].map(([dx, dy, b, s, c, inset]) => inset ? [dx, dy, b, s, paint(t, c), inset] : [dx, dy, b, s, paint(t, c)])
}


/** A size inside a stroke or an inset: never negative (a box smaller than its border draws an empty inside, not an error). */
export const pos = (v: number) => Math.max(0, v)
