import type { Scene, SrcNode, Value } from '../model/scene'

// The JSON shape both languages write for SS.UiValue: a Map is an ordered list of pairs that may repeat a key.
export type Uv = number | string | { a: Uv[] } | { m: [string, Uv][] } | { b: boolean }
export type Pairs = [string, Uv][]

let grows: Uint8Array | undefined
/**
 * The renderer's key comparison, `OrdinalIgnoreCase`: simple upper-casing, one code point at a time; a code point whose
 * upper case is longer (ß → SS) stays as it is.
 */
export const foldKey = (k: string) => {
  const u = k.toUpperCase()   // per code point: JS upper-casing has no context
  if (u.length === k.length) return u   // nothing grew, and nothing shrinks (props differential in print.test.ts)
  // How many more units each BMP unit's upper case has; only BMP code points grow (same test).
  grows ??= Uint8Array.from({ length: 0x10000 }, (_, c) => String.fromCharCode(c).toUpperCase().length - 1)
  let out = '', from = 0
  for (let i = 0, j = 0; i < k.length; i++, j++) {   // j: the same place in u
    const g = grows[k.charCodeAt(i)]
    if (g) { out += u.slice(from, j) + k[i]; j += g; from = j + 1 }
  }
  return out + u.slice(from)
}

/** The value of n's first attribute whose name folds to `key` (upper case), as the mod's PropValue finds it. */
export const first = (n: SrcNode, key: string) => Object.entries(n.attrs).find(([k]) => k.length === key.length && foldKey(k) === key)?.[1]

// Ported from scripted-screens-vector v0.11.118, SceneModel.cs:1390-1398, 3677-3686 (MIT).
// PropText keeps strings and reads float32 numbers with invariant custom format 0.##### (seven significant digits).
export function textOf(v: Value | undefined): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v !== 'number') return undefined
  const f = Math.fround(v)
  if (!Number.isFinite(f)) return String(f)
  const [mantissa, exponent = '0'] = Math.abs(f).toExponential(6).split('e')
  let digits = BigInt(mantissa.replace('.', '')), power = Number(exponent) - 1
  if (power >= 0) digits *= 10n ** BigInt(power)
  else {
    const divisor = 10n ** BigInt(-power)
    digits = (digits + divisor / 2n) / divisor
  }
  const whole = digits / 100000n, fraction = String(digits % 100000n).padStart(5, '0').replace(/0+$/, '')
  return (f < 0 || Object.is(f, -0) ? '-' : '') + whole + (fraction ? '.' + fraction : '')
}

// Every walk here keeps an explicit stack, so a list or a tree of any depth converts and compares (the mod has no depth
// limit since 0.11.85): each output list or map is made empty, placed, and filled when its turn comes off the stack.

/** A value with its lists as { a }. */
const uv = (v: Value): Uv => {
  if (!Array.isArray(v)) return v
  const top: Uv[] = [], stack: [Value[], Uv[]][] = [[v, top]]
  for (let s = stack.pop(); s; s = stack.pop())
    for (const x of s[0]) if (Array.isArray(x)) { const a: Uv[] = []; s[1].push({ a }); stack.push([x, a]) } else s[1].push(x)
  return { a: top }
}

/** A node as its map: op, its attributes, then c when it has children. */
const node = (n: SrcNode): Uv => {
  const map = (n: SrcNode): Pairs => [['op', n.op], ...Object.entries(n.attrs).map(([k, v]): [string, Uv] => [k, uv(v)])]
  const top = map(n), stack: [SrcNode, Pairs][] = [[n, top]]
  for (let s = stack.pop(); s; s = stack.pop()) {
    if (!s[0].c?.length) continue
    const a: Uv[] = []
    s[1].push(['c', { a }])
    for (const c of s[0].c) { const m = map(c); a.push({ m }); stack.push([c, m]) }
  }
  return { m: top }
}

/** Same order and typing as `SceneText.ToProps`: scene, SCENE pairs, root, then defs when there are any. */
export function toProps(scene: Scene, sceneId?: string): Pairs {
  const p: Pairs = sceneId ? [['scene', sceneId]] : []
  for (const [k, v] of Object.entries(scene.header)) p.push([k, uv(v)])
  p.push(['root', { a: scene.root.map(node) }])
  if (scene.defs.length) p.push(['defs', { a: scene.defs.map(node) }])
  return p
}

/** Drops later case-insensitive duplicate keys, as the renderer's first-match lookup sees them, in node maps at any depth. */
export function firstWins(p: Pairs): Pairs {
  const top: Pairs = [], stack: ({ m: Pairs; to: Pairs } | { a: Uv[]; to: Uv[] })[] = [{ m: p, to: top }]
  const copy = (v: Uv): Uv => {
    if (typeof v !== 'object' || 'b' in v) return v
    if ('a' in v) { const to: Uv[] = []; stack.push({ a: v.a, to }); return { a: to } }
    const to: Pairs = []
    stack.push({ m: v.m, to })
    return { m: to }
  }
  for (let s = stack.pop(); s; s = stack.pop()) {
    if ('a' in s) { for (const x of s.a) s.to.push(copy(x)); continue }
    const seen = new Set<string>()
    for (const [k, v] of s.m) {
      const f = foldKey(k)
      if (!seen.has(f)) { seen.add(f); s.to.push([k, copy(v)]) }
    }
  }
  return top
}

/** Structural equality; numbers compare as float32. */
export function propsEqual(a: Pairs, b: Pairs): boolean {
  const stack: [Uv, Uv][] = [[{ m: a }, { m: b }]]
  for (let s = stack.pop(); s; s = stack.pop()) {
    const [x, y] = s
    if (typeof x === 'number' || typeof y === 'number') {
      if (typeof x !== typeof y || !Object.is(Math.fround(x as number), Math.fround(y as number))) return false
    } else if (typeof x === 'string' || typeof y === 'string') {
      if (x !== y) return false
    } else if ('a' in x) {
      if (!('a' in y) || x.a.length !== y.a.length) return false
      x.a.forEach((v, k) => stack.push([v, y.a[k]]))
    } else if ('m' in x) {
      if (!('m' in y) || x.m.length !== y.m.length) return false
      for (let k = 0; k < x.m.length; k++) {
        if (x.m[k][0] !== y.m[k][0]) return false
        stack.push([x.m[k][1], y.m[k][1]])
      }
    } else if (!('b' in y) || x.b !== y.b) return false
  }
  return true
}
