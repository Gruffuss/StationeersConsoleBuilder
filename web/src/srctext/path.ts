// Strict SVG path data for P's `d`, the grammar of the mod's PathData.Parse (core/vendor/vector/PathData.cs).
// Everything the mod hangs on, aborts at or mis-reads is an error here.
import { numberOf, WS } from './parse'
import { shortestFloat } from './print'

export type PathSeg = { cmd: string; args: number[] }   // cmd as written (case kept)

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, T: 2, C: 6, S: 4, A: 7, Z: 0 }
const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y

/** One segment per argument set: extra sets repeat the command, M as L and m as l. */
export function parsePath(d: string): { segs: PathSeg[] } | { error: string; at: number } {
  const toks: { cmd?: string; n: number; text: string; at: number }[] = []
  for (let i = 0; i < d.length;) {
    const c = d[i]
    if (c === ',' || WS.test(c)) { i++; continue }
    if ('MmLlHhVvQqTtCcSsAaZz'.includes(c)) { toks.push({ cmd: c, n: 0, text: c, at: i++ }); continue }
    // A second `.` ends a number, so `60.5.5` is 60.5 and .5, as in SVG and the mod since 0.11.94.
    NUM.lastIndex = i
    const m = NUM.exec(d)
    if (!m) return { error: `unexpected "${c}" in the path`, at: i }
    if (Number.isNaN(numberOf(m[0]))) return { error: 'a number beyond float32', at: i }
    toks.push({ n: Number(m[0]), text: m[0], at: i })
    i = NUM.lastIndex
  }
  if (!toks.length) return { error: 'the path is empty', at: 0 }

  const segs: PathSeg[] = []
  for (let k = 0; k < toks.length;) {
    const op = toks[k++]
    if (op.cmd === undefined) return { error: 'a number before the first command', at: op.at }
    const count = ARGS[op.cmd.toUpperCase()]
    if (count === 0) {
      if (k < toks.length && toks[k].cmd === undefined) return { error: `no numbers may follow ${op.cmd}`, at: toks[k].at }
      segs.push({ cmd: op.cmd, args: [] })
      continue
    }
    let cmd = op.cmd
    do {
      const args: number[] = []
      while (args.length < count && k < toks.length && toks[k].cmd === undefined) {
        const t = toks[k]
        // An arc flag is one character, so a minifier packs them: `011 40` is 0, 1, then 1 40 (PathData.Flag, 0.11.94).
        if (count === 7 && (args.length === 3 || args.length === 4)) {
          if (t.text[0] !== '0' && t.text[0] !== '1') return { error: 'an arc flag must be 0 or 1', at: t.at }
          args.push(+t.text[0])
          const rest = t.text.slice(1)
          NUM.lastIndex = 0
          if (!rest) k++
          else if (NUM.exec(rest)?.[0] === rest) toks[k] = { n: Number(rest), text: rest, at: t.at + 1 }
          else return { error: `unexpected "${rest[0]}" after an arc flag`, at: t.at + 1 }
          continue
        }
        args.push(t.n)
        k++
      }
      if (args.length < count) return { error: `${op.cmd} takes ${count} numbers per set`, at: k < toks.length ? toks[k].at : d.length }
      segs.push({ cmd, args })
      if (cmd === 'M') cmd = 'L'
      else if (cmd === 'm') cmd = 'l'
    } while (k < toks.length && toks[k].cmd === undefined)
  }
  return { segs }
}

export function printPath(segs: PathSeg[]): string {
  return segs.map(s => s.cmd + s.args.map(shortestFloat).join(' ')).join(' ')
}

// Absolute, explicit controls for calculation; only commands reached by an edit are written in this form.
function explicit(segs: readonly PathSeg[]): PathSeg[] {
  const abs = absArgs(segs), from = starts(segs, abs)
  let prev = '', control = [0, 0]
  return segs.map(({ cmd }, i) => {
    const C = cmd.toUpperCase(), a = abs[i], [x, y] = from[i]
    let out: PathSeg = { cmd: C, args: a }
    if (C === 'H' || C === 'V') out = { cmd: 'L', args: C === 'H' ? [a[0], y] : [x, a[0]] }
    if (C === 'S') out = { cmd: 'C', args: [...(prev === 'C' || prev === 'S' ? [2*x-control[0], 2*y-control[1]] : [x, y]), ...a] }
    if (C === 'T') out = { cmd: 'Q', args: [...(prev === 'Q' || prev === 'T' ? [2*x-control[0], 2*y-control[1]] : [x, y]), ...a] }
    if (out.cmd === 'C') control = out.args.slice(2, 4)
    if (out.cmd === 'Q') control = out.args.slice(0, 2)
    prev = C
    return out
  })
}

// Splice absolute replacements, adjusting only relative commands whose cursor changed. Untouched numbers stay literal.
function splicePath(segs: PathSeg[], edits: Map<number, PathSeg[]>): string | null {
  const abs = absArgs(segs), before = starts(segs, abs), out: PathSeg[] = [], values: number[][] = [], source: number[] = []
  segs.forEach((s, i) => {
    if (edits.has(i)) for (const n of edits.get(i)!) { out.push(n); values.push(n.args); source.push(-1) }
    else { out.push(s); values.push(abs[i]); source.push(i) }
  })
  if (!out.length) return null
  const after = starts(out, values), written = relArgs(out, values), was = explicit(segs)
  let prev = '', control = [0, 0]
  return printPath(written.map((s, i) => {
    const k = source[i], C = s.cmd.toUpperCase(), from = after[i]
    let a = values[i], result = k >= 0 && (out[i].cmd === out[i].cmd.toUpperCase() || from.every((v, j) => v === before[k][j])) ? out[i] : s
    if (C === 'S' || C === 'T') {
      const reflect = (C === 'S' ? ['C', 'S'] : ['Q', 'T']).includes(prev) ? from.map((v, j) => 2*v-control[j]) : from
      // Preserve the curve whose reflected control an edit reached, without rewriting the rest of the chain.
      if (k >= 0 && was[k].args.slice(0, 2).some((v, j) => v !== reflect[j])) { result = was[k]; a = was[k].args }
      else a = [...reflect, ...a]
    }
    prev = result.cmd.toUpperCase()
    if (C === 'C' || C === 'S') control = a.slice(2, 4)
    if (C === 'Q' || C === 'T') control = a.slice(0, 2)
    return result
  }))
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]-v)*t)

function arcCentre(from: number[], a: readonly number[]) {
  let rx = Math.abs(a[0]), ry = Math.abs(a[1])
  const [, , rot, large, sweep, x1, y1] = a, [x0, y0] = from
  if (!rx || !ry || x0 === x1 && y0 === y1) return null
  const phi = rot*Math.PI/180, cos = Math.cos(phi), sin = Math.sin(phi)
  const px = cos*(x0-x1)/2 + sin*(y0-y1)/2, py = -sin*(x0-x1)/2 + cos*(y0-y1)/2
  const lambda = px*px/(rx*rx) + py*py/(ry*ry)
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda) }
  const den = rx*rx*py*py + ry*ry*px*px
  let f = den === 0 ? 0 : Math.sqrt(Math.max(0, (rx*rx*ry*ry-den)/den))
  if ((large > 0.5) === (sweep > 0.5)) f = -f
  const cx1 = f*rx*py/ry, cy1 = -f*ry*px/rx
  const cx = cos*cx1-sin*cy1+(x0+x1)/2, cy = sin*cx1+cos*cy1+(y0+y1)/2
  const start = Math.atan2((py-cy1)/ry, (px-cx1)/rx), end = Math.atan2((-py-cy1)/ry, (-px-cx1)/rx)
  let span = end-start
  if (!sweep && span > 0) span -= 2*Math.PI
  if (sweep && span < 0) span += 2*Math.PI
  return { rx, ry, span, at: (t: number) => {
    const th = start+span*t
    return [cx+cos*rx*Math.cos(th)-sin*ry*Math.sin(th), cy+sin*rx*Math.cos(th)+cos*ry*Math.sin(th)]
  } }
}

/** Parametric segments for point-tool hit testing; closing edges are included. */
export function pathSegments(d: string): { segment: number; at(t: number): Point }[] | null {
  const p = parsePath(d)
  if ('error' in p) return null
  const segs = explicit(p.segs), abs = absArgs(p.segs), from = starts(p.segs, abs)
  let home = [0, 0]
  return segs.flatMap((s, i) => {
    if (s.cmd === 'M') { home = s.args; return [] }
    const pts = [from[i], ...Array.from({ length: s.args.length/2 }, (_, j) => s.args.slice(j*2, j*2+2))]
    const ellipse = s.cmd === 'A' ? arcCentre(from[i], s.args) : null
    const end = s.cmd === 'Z' ? home : s.args.slice(-2)
    return [{ segment: i, at(t: number): Point {
      let xy: number[]
      if (s.cmd === 'A') xy = ellipse?.at(t) ?? mix(from[i], end, t)
      else if (s.cmd === 'Z') xy = mix(from[i], end, t)
      else { let row = pts; while (row.length > 1) row = row.slice(0, -1).map((v, j) => mix(v, row[j+1], t)); xy = row[0] }
      return { x: xy[0], y: xy[1] }
    } }]
  })
}

/** Split one parsed segment, preserving its geometry and every untouched command. */
export function splitPathSegment(d: string, segment: number, t: number): string | null {
  const p = parsePath(d)
  if ('error' in p || !Number.isFinite(t) || t <= 0 || t >= 1 || !p.segs[segment]) return null
  const s = explicit(p.segs)[segment], from = starts(p.segs, absArgs(p.segs))[segment]
  if (s.cmd === 'M') return null
  let parts: PathSeg[]
  if (s.cmd === 'A') {
    const e = arcCentre(from, s.args)
    if (!e) parts = [{ cmd: 'L', args: mix(from, s.args.slice(-2), t) }, { cmd: 'L', args: s.args.slice(-2) }]
    else parts = [t, 1-t].map((fraction, i) => ({ cmd: 'A', args: [e.rx, e.ry, s.args[2], Math.abs(e.span*fraction) > Math.PI ? 1 : 0, s.args[4], ...(i ? s.args.slice(-2) : e.at(t))] }))
  } else if (s.cmd === 'Z') {
    const mid = pathSegments(d)!.find(x => x.segment === segment)!.at(t)
    parts = [{ cmd: 'L', args: [mid.x, mid.y] }, s]
  } else {
    let row = [from, ...Array.from({ length: s.args.length/2 }, (_, j) => s.args.slice(j*2, j*2+2))]
    const left = [row[0]], right = [row[row.length-1]]
    while (row.length > 1) { row = row.slice(0, -1).map((v, j) => mix(v, row[j+1], t)); left.push(row[0]); right.unshift(row[row.length-1]) }
    parts = [{ cmd: s.cmd, args: left.slice(1).flat() }, { cmd: s.cmd, args: right.slice(1).flat() }]
  }
  return splicePath(p.segs, new Map([[segment, parts]]))
}

const asCubic = (s: PathSeg, from: number[]): PathSeg | null => s.cmd === 'C' ? s : s.cmd === 'L'
  ? { cmd: 'C', args: [...from, ...s.args, ...s.args] } : s.cmd === 'Q'
    ? { cmd: 'C', args: [...mix(from, s.args.slice(0, 2), 2/3), ...mix(s.args.slice(2), s.args.slice(0, 2), 2/3), ...s.args.slice(2)] } : null

// Anchor indexes use pathHandles' numbering; control handles cannot be deleted or converted as anchors.
function anchor(d: string, point: number) {
  const p = parsePath(d)
  if ('error' in p) return null
  const abs = absArgs(p.segs), ref = own(p.segs, abs)[point]
  if (!ref) return null
  const [i, slot] = ref, s = p.segs[i], C = s.cmd.toUpperCase()
  if (slot !== (C === 'H' || C === 'V' ? 0 : abs[i].length-2)) return null
  return { segs: p.segs, abs, i, explicit: explicit(p.segs), from: starts(p.segs, abs) }
}

export const isPathAnchor = (d: string, point: number): boolean => !!anchor(d, point)

export function pathAnchorIndexes(d: string): number[] | null {
  const p = parsePath(d)
  if ('error' in p) return null
  const abs = absArgs(p.segs)
  return own(p.segs, abs).flatMap(([j, i], k) => i === (['H', 'V'].includes(p.segs[j].cmd.toUpperCase()) ? 0 : abs[j].length-2) ? [k] : [])
}

/** Delete an anchor, joining its neighbours with the outer curve controls. */
export function deletePathPoint(d: string, point: number): string | null {
  const r = anchor(d, point)
  if (!r) return null
  const { segs, explicit: ex, from } = r
  let i = r.i
  let lo = i, hi = i+1
  while (lo > 0 && segs[lo].cmd.toUpperCase() !== 'M' && segs[lo-1].cmd.toUpperCase() !== 'Z') lo--
  while (hi < segs.length && !['M', 'Z'].includes(segs[hi].cmd.toUpperCase())) hi++
  const end = hi < segs.length && segs[hi].cmd.toUpperCase() === 'Z' ? hi+1 : hi
  const duplicate = end > hi && ex[lo].cmd === 'M' && hi > lo+1 && ex[hi-1].args.slice(-2).every((v, j) => v === ex[lo].args[j])
  if (duplicate && i === hi-1) i = lo
  const edits = new Map<number, PathSeg[]>()
  if (hi-lo-(duplicate ? 1 : 0) <= 2) { for (let k = lo; k < end; k++) edits.set(k, []); return splicePath(segs, edits) }
  edits.set(i, [])
  if (i === lo) {
    const b = asCubic(ex[i+1], from[i+1]), start = ex[i+1].args.slice(-2)
    edits.set(i+1, [{ cmd: 'M', args: start }])
    if (duplicate) {
      const a = asCubic(ex[hi-1], from[hi-1])
      edits.set(hi-1, [])
      if (a && b && (ex[hi-1].cmd !== 'L' || ex[i+1].cmd !== 'L'))
        edits.set(hi, [{ cmd: 'C', args: [...a.args.slice(0, 2), ...b.args.slice(2)] }, ex[hi]])
    } else if (end > hi && b && ex[i+1].cmd !== 'L') edits.set(hi, [{ cmd: 'C', args: [...ex[hi-1].args.slice(-2), ...b.args.slice(2)] }, ex[hi]])
  } else if (i+1 < hi) {
    const a = asCubic(ex[i], from[i]), b = asCubic(ex[i+1], from[i+1])
    edits.set(i+1, [a && b && (ex[i].cmd !== 'L' || ex[i+1].cmd !== 'L')
      ? { cmd: 'C', args: [...a.args.slice(0, 2), ...b.args.slice(2)] } : { cmd: 'L', args: ex[i+1].args.slice(-2) }])
  } else if (end > hi) {
    const a = asCubic(ex[i], from[i]), home = ex[lo].args.slice(-2)
    if (a && ex[i].cmd !== 'L') edits.set(hi, [{ cmd: 'C', args: [...a.args.slice(0, 2), ...home, ...home] }, ex[hi]])
  }
  return splicePath(segs, edits)
}

/** Collapse adjacent handles for a corner, or mirror them through a smooth anchor. */
export function setPointMode(d: string, point: number, mode: 'corner' | 'smooth'): string | null {
  const r = anchor(d, point)
  if (!r) return null
  const { segs, i, explicit: ex, from } = r, at = ex[i].args.slice(-2)
  let lo = i, hi = i+1
  while (lo > 0 && ex[lo].cmd !== 'M' && ex[lo-1].cmd !== 'Z') lo--
  while (hi < ex.length && !['M', 'Z'].includes(ex[hi].cmd)) hi++
  const closed = ex[hi]?.cmd === 'Z'
  const beforeIndex = ex[i].cmd === 'M' && closed ? hi : i
  const afterIndex = ex[i+1]?.cmd === 'Z' ? hi : i+1
  const incoming = beforeIndex === hi ? { cmd: 'L', args: at } : ex[i]
  const beforeFrom = beforeIndex === hi ? ex[hi-1].args.slice(-2) : from[i]
  const next = afterIndex === hi && closed ? { cmd: 'L', args: ex[lo].args.slice(-2) } : ex[i+1]
  const before = incoming.cmd === 'M' ? null : asCubic(incoming, beforeFrom)
  const after = next && !['M', 'Z'].includes(next.cmd) ? asCubic(next, at) : null
  if (!before && !after) return null
  if (ex[i].cmd !== 'M' && !before || next && !['M', 'Z'].includes(next.cmd) && !after) return null
  let handle = [...at]
  if (mode === 'smooth') {
    if (before && incoming.cmd !== 'L' && before.args.slice(2, 4).some((v, j) => v !== at[j])) handle = before.args.slice(2, 4)
    else if (after && next.cmd !== 'L' && after.args.slice(0, 2).some((v, j) => v !== at[j])) handle = mix(at, after.args.slice(0, 2), -1)
    else {
      const prev = before ? beforeFrom : at, end = after ? after.args.slice(-2) : at, len = Math.hypot(end[0]-prev[0], end[1]-prev[1])
      const reach = Math.min(before ? Math.hypot(at[0]-prev[0], at[1]-prev[1]) : Infinity, after ? Math.hypot(end[0]-at[0], end[1]-at[1]) : Infinity)/3
      if (len) handle = [at[0]-(end[0]-prev[0])/len*reach, at[1]-(end[1]-prev[1])/len*reach]
    }
  }
  const edits = new Map<number, PathSeg[]>()
  if (before) edits.set(beforeIndex, [{ cmd: 'C', args: [...before.args.slice(0, 2), ...handle, ...at] }, ...(beforeIndex === hi ? [ex[hi]] : [])])
  if (after) edits.set(afterIndex, [{ cmd: 'C', args: [2*at[0]-handle[0], 2*at[1]-handle[1], ...after.args.slice(2)] }, ...(afterIndex === hi ? [ex[hi]] : [])])
  return splicePath(segs, edits)
}

/**
 * Moves a path by (dx, dy), changing only absolute coordinates: the first M/m (absolute from (0,0)), every uppercase
 * command's points (H x only, V y only, A its end point only). Lowercase arguments stay. A path that does not start
 * with M/m starts from the mod's cursor at (0,0), so `M dx dy` is put in front. Null if `d` does not parse.
 */
export function translatePath(d: string, dx: number, dy: number): string | null {
  const r = parsePath(d)
  if ('error' in r) return null
  const start: PathSeg[] = r.segs[0].cmd.toUpperCase() === 'M' ? [] : [{ cmd: 'M', args: [dx, dy] }]
  return printPath([...start, ...r.segs.map((s, k) => {
    const C = s.cmd.toUpperCase()
    if (s.cmd !== C && !(k === 0 && C === 'M')) return s
    const a = [...s.args]
    if (C === 'H') a[0] += dx
    else if (C === 'V') a[0] += dy
    else if (C === 'A') { a[5] += dx; a[6] += dy }
    else for (let j = 0; j < a.length; j += 2) { a[j] += dx; a[j + 1] += dy }
    return { cmd: s.cmd, args: a }
  })])
}

// The cursor after a segment of upper-case command C whose arguments are absolute (absArgs' shape).
const endOf = (C: string, a: readonly number[], x: number, y: number, sx: number, sy: number): [number, number] =>
  C === 'Z' ? [sx, sy] : C === 'H' ? [a[0], y] : C === 'V' ? [x, a[0]] : [a[a.length - 2], a[a.length - 1]]

/** Each segment's arguments made absolute: a relative one from the cursor before it (after Z, the subpath's start). H
 *  keeps [x], V [y], A [rx, ry, rot, large, sweep, x, y], Z []; the others their points. */
export function absArgs(segs: readonly PathSeg[]): number[][] {
  let x = 0, y = 0, sx = 0, sy = 0
  return segs.map(({ cmd, args }) => {
    const C = cmd.toUpperCase(), rel = cmd !== C
    const a = C === 'H' ? [args[0] + (rel ? x : 0)] : C === 'V' ? [args[0] + (rel ? y : 0)]
      : C === 'A' ? [...args.slice(0, 5), args[5] + (rel ? x : 0), args[6] + (rel ? y : 0)]
      : args.map((v, i) => v + (rel ? (i % 2 ? y : x) : 0))
    ;[x, y] = endOf(C, a, x, y, sx, sy)
    if (C === 'M') [sx, sy] = [x, y]
    return a
  })
}

/** `segs` with their arguments set from absolute ones (absArgs' shape), each command keeping its letter: a relative one
 *  is written from the cursor before it. */
export function relArgs(segs: readonly PathSeg[], abs: readonly number[][]): PathSeg[] {
  let x = 0, y = 0, sx = 0, sy = 0
  return segs.map(({ cmd }, k) => {
    const C = cmd.toUpperCase(), rel = cmd !== C, a = abs[k]
    const args = C === 'H' ? [a[0] - (rel ? x : 0)] : C === 'V' ? [a[0] - (rel ? y : 0)]
      : C === 'A' ? [...a.slice(0, 5), a[5] - (rel ? x : 0), a[6] - (rel ? y : 0)]
      : a.map((v, i) => v - (rel ? (i % 2 ? y : x) : 0))
    ;[x, y] = endOf(C, a, x, y, sx, sy)
    if (C === 'M') [sx, sy] = [x, y]
    return { cmd, args }
  })
}

const STEPS = 16   // samples per curve; the extremes are added too, so a box is exact whatever this is

/** An affine map [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (geometry.ts's Mat). */
export type Affine = readonly [number, number, number, number, number, number]
const ID: Affine = [1, 0, 0, 1, 0, 0]
const map = (m: Affine, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

// Points of a quadratic (p: 6 numbers) or cubic (8) Bézier after its start: STEPS samples plus each t in (0, 1) where x
// or y turns. An affine image of a Bézier is the Bézier of the mapped controls, so p may be mapped already.
function bezier(p: number[]): number[] {
  const cubic = p.length === 8
  const at = (t: number, d: number) => cubic
    ? (1 - t) ** 3 * p[d] + 3 * (1 - t) ** 2 * t * p[2 + d] + 3 * (1 - t) * t * t * p[4 + d] + t ** 3 * p[6 + d]
    : (1 - t) ** 2 * p[d] + 2 * (1 - t) * t * p[2 + d] + t * t * p[4 + d]
  const ts = Array.from({ length: STEPS }, (_, i) => (i + 1) / STEPS)
  for (const d of [0, 1]) {
    if (!cubic) {
      const den = p[d] - 2 * p[2 + d] + p[4 + d]
      if (den) ts.push((p[d] - p[2 + d]) / den)
      continue
    }
    // B'(t)/3 = a t² + b t + c
    const a = -p[d] + 3 * p[2 + d] - 3 * p[4 + d] + p[6 + d], b = 2 * (p[d] - 2 * p[2 + d] + p[4 + d]), c = p[2 + d] - p[d]
    if (Math.abs(a) < 1e-12) { if (b) ts.push(-c / b) }
    else {
      const disc = b * b - 4 * a * c
      if (disc >= 0) ts.push((-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a))
    }
  }
  return ts.filter(t => t > 0 && t <= 1).sort((u, v) => u - v).flatMap(t => [at(t, 0), at(t, 1)])
}

// The mod's arc (PathData.cs FlattenArc) from (x0, y0) with a = [rx, ry, rot, large, sweep, x1, y1]: endpoint form to
// centre form, radii scaled up to span the chord; STEPS samples plus the angles where x or y turns, all through m (the
// turning angles are m's x and y, so the box stays exact under a turn). Degenerate radii or end points: a line to the end.
function arc(x0: number, y0: number, a: readonly number[], m: Affine): number[] {
  let rx = Math.abs(a[0]), ry = Math.abs(a[1])
  const [, , rot, large, sweep, x1, y1] = a
  if (rx < 1e-4 || ry < 1e-4 || (x0 - x1) ** 2 + (y0 - y1) ** 2 < 1e-6) return map(m, x1, y1)
  const phi = rot * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi)
  const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2, px = cos * dx + sin * dy, py = -sin * dx + cos * dy
  const lambda = px * px / (rx * rx) + py * py / (ry * ry)
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda) }
  const num = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px, den = rx * rx * py * py + ry * ry * px * px
  let f = den < 1e-4 ? 0 : Math.sqrt(Math.max(0, num / den))
  if ((large > 0.5) === (sweep > 0.5)) f = -f
  const cx1 = f * rx * py / ry, cy1 = -f * ry * px / rx
  const cx = cos * cx1 - sin * cy1 + (x0 + x1) / 2, cy = sin * cx1 + cos * cy1 + (y0 + y1) / 2
  const start = Math.atan2((py - cy1) / ry, (px - cx1) / rx), end = Math.atan2((-py - cy1) / ry, (-px - cx1) / rx)
  let span = end - start
  if (!(sweep > 0.5) && span > 0) span -= 2 * Math.PI
  else if (sweep > 0.5 && span < 0) span += 2 * Math.PI
  // The ellipse is centre + U cos θ + V sin θ; through m's linear part, x turns where tan θ = V'x / U'x, y likewise.
  const ux = cos * rx, uy = sin * rx, vx = -sin * ry, vy = cos * ry
  const Ux = m[0] * ux + m[2] * uy, Uy = m[1] * ux + m[3] * uy, Vx = m[0] * vx + m[2] * vy, Vy = m[1] * vx + m[3] * vy
  const ts = Array.from({ length: STEPS }, (_, i) => (i + 1) / STEPS)
  for (const base of [Math.atan2(Vx, Ux), Math.atan2(Vy, Uy)])   // dx/dθ = 0, dy/dθ = 0
    for (let k = -4; k <= 4; k++) { const t = (base + k * Math.PI - start) / span; if (t > 0 && t < 1) ts.push(t) }
  const [CX, CY] = map(m, cx, cy)
  return ts.sort((u, v) => u - v).flatMap(t => {
    const th = start + span * t, co = Math.cos(th), si = Math.sin(th)
    return [CX + Ux * co + Vx * si, CY + Uy * co + Vy * si]
  })
}

/** The path as the mod flattens it (PathData.cs), absolute, one flat x, y list per subpath (a subpath of one point
 *  dropped, as the mod drops it): curves sampled with their x and y extremes, arcs through the mod's centre conversion
 *  with theirs, so the lists' bounds are the path's exact box. Every point is mapped through m (default: none), and the
 *  extremes are m's x and y, so the box stays exact through a turn or a skew. Null when `d` does not parse. */
export function flattenPath(d: string, m: Affine = ID): number[][] | null {
  const r = parsePath(d)
  if ('error' in r) return null
  const abs = absArgs(r.segs), out: number[][] = []
  let cur: number[] | null = null, x = 0, y = 0, sx = 0, sy = 0, prev = ''
  let q = [0, 0], c = [0, 0]   // the last quadratic and cubic control, which T and S reflect
  const add = (pts: number[]) => {
    if (!cur) out.push(cur = map(m, x, y))
    for (const v of pts) cur.push(v)
  }
  const ctrl = (...xy: number[]) => xy.flatMap((v, i) => i % 2 ? [] : map(m, v, xy[i + 1]))
  r.segs.forEach(({ cmd }, k) => {
    const C = cmd.toUpperCase(), a = abs[k]
    if (C === 'M') { out.push(cur = map(m, a[0], a[1])); sx = x = a[0]; sy = y = a[1] }
    else if (C === 'Z') { cur = null; [x, y] = [sx, sy] }
    else if (C === 'L' || C === 'H' || C === 'V') {
      // A subpath after Z begins at the cursor before the line (PathData.cs: Begin(subpaths, cursor), then the move).
      const [ex, ey] = endOf(C, a, x, y, sx, sy)
      add(map(m, ex, ey))
      ;[x, y] = [ex, ey]
    }
    else if (C === 'Q' || C === 'T') {
      const ctl = C === 'Q' ? [a[0], a[1]] : prev === 'Q' || prev === 'T' ? [2 * x - q[0], 2 * y - q[1]] : [x, y]
      const [ex, ey] = a.slice(-2)
      add(bezier(ctrl(x, y, ctl[0], ctl[1], ex, ey)))
      q = ctl
      ;[x, y] = [ex, ey]
    } else if (C === 'C' || C === 'S') {
      const c1 = C === 'C' ? [a[0], a[1]] : prev === 'C' || prev === 'S' ? [2 * x - c[0], 2 * y - c[1]] : [x, y]
      const c2 = C === 'C' ? [a[2], a[3]] : [a[0], a[1]], [ex, ey] = a.slice(-2)
      add(bezier(ctrl(x, y, c1[0], c1[1], c2[0], c2[1], ex, ey)))
      c = c2
      ;[x, y] = [ex, ey]
    } else {
      add(arc(x, y, a, m))
      ;[x, y] = [a[5], a[6]]
    }
    prev = C
  })
  return out.filter(s => s.length >= 4)
}

// An ellipse with radii rx, ry turned rot degrees, under the axis scale diag(kx, ky): the image is an ellipse again (any
// linear map takes one to one). Its radii and turn are the square roots of the eigenvalues, and the major eigenvector's
// angle, of M Mᵀ, where M = diag(kx, ky) · R(rot) · diag(rx, ry).
function scaledEllipse(rx: number, ry: number, rot: number, kx: number, ky: number): [number, number, number] {
  const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180)
  const m00 = kx * c * rx, m01 = -kx * s * ry, m10 = ky * s * rx, m11 = ky * c * ry
  const p = m00 * m00 + m01 * m01, q = m00 * m10 + m01 * m11, w = m10 * m10 + m11 * m11
  const mid = (p + w) / 2, half = Math.hypot((p - w) / 2, q)
  const deg = Math.atan2(2 * q, p - w) / 2 * 180 / Math.PI
  return [Math.sqrt(mid + half), Math.sqrt(Math.max(0, mid - half)), deg < 0 ? deg + 180 : deg]
}

/**
 * The path under x -> to + (x - from) * k per axis (a scale about a fixed point; a negative k mirrors), each command
 * keeping its letter: points mapped, relative steps scaled, an arc's radii by |k| (swapped for a quarter-turned ellipse;
 * an ellipse turned by other than a quarter under an uneven scale takes the image ellipse's exact radii and turn), its
 * sweep flipped and its rotation negated by a mirror. Every new number goes through `r(v, was)` (the writer's rounding;
 * `was` is the value there, so a value that rounds the same can stay as written). A path that does not start with M
 * starts at the mod's cursor (0, 0), which an M in front keeps in place. `d` itself when no number changes; null when
 * `d` does not parse.
 */
export function scalePath(d: string, k: [number, number], from: [number, number], to: [number, number],
  r: (v: number, was: number) => number = v => v): string | null {
  const p = parsePath(d)
  if ('error' in p) return null
  const segs: PathSeg[] = p.segs[0].cmd.toUpperCase() === 'M' ? p.segs : [{ cmd: 'M', args: [0, 0] }, ...p.segs]
  const at = (v: number, i: number) => r(to[i] + (v - from[i]) * k[i], v), mirror = k[0] * k[1] < 0
  // Even up to float noise: a proportional drag's two factors come from two divisions.
  const ax = Math.abs(k[0]), ay = Math.abs(k[1]), even = Math.abs(ax - ay) <= 1e-9 * Math.max(ax, ay), abs = absArgs(segs)
  for (let j = 0; j < abs.length; j++) {
    const C = segs[j].cmd.toUpperCase(), a = abs[j]
    if (C === 'H') abs[j] = [at(a[0], 0)]
    else if (C === 'V') abs[j] = [at(a[0], 1)]
    else if (C === 'A') {
      const turn = ((a[2] % 180) + 180) % 180, circle = Math.abs(a[0]) === Math.abs(a[1])
      let radii: [number, number], rot: number
      if (!even && !circle && turn !== 0 && turn !== 90) {
        const [Rx, Ry, deg] = scaledEllipse(Math.abs(a[0]), Math.abs(a[1]), a[2], k[0], k[1])
        radii = [r(Rx, a[0]), r(Ry, a[1])]
        rot = r(deg, a[2])
      } else {
        const [kx, ky] = !even && !circle && turn === 90 ? [k[1], k[0]] : k
        radii = [r(a[0] * Math.abs(kx), a[0]), r(a[1] * Math.abs(ky), a[1])]
        rot = !even && circle ? 0 : mirror && a[2] ? -a[2] : a[2]
      }
      abs[j] = [...radii, rot, a[3], mirror ? 1 - a[4] : a[4], at(a[5], 0), at(a[6], 1)]
    } else abs[j] = a.map((v, i) => at(v, i % 2))
  }
  const out = printPath(relArgs(segs, abs))
  return out === printPath(segs) ? d : out
}

/** One of a node's own points (a path's, a line's, a polygon's or a curve's), in its local units; an H or V point moves
 *  along its axis only. */
export type Point = { x: number; y: number; axis?: 'x' | 'y' }

// The argument indexes of a segment's own points in absArgs' shape: H and V their one coordinate, A its end, Z none.
const slots = (C: string, n: number) => C === 'H' || C === 'V' ? [0] : C === 'A' ? [5] : C === 'Z' ? [] : Array.from({ length: n / 2 }, (_, i) => 2 * i)
// Each own point's segment and argument index, in pathHandles' order.
const own = (segs: readonly PathSeg[], abs: readonly number[][]) =>
  segs.flatMap(({ cmd }, j) => slots(cmd.toUpperCase(), abs[j].length).map(i => [j, i] as const))

// The cursor before each segment, from absolute arguments (absArgs' shape).
function starts(segs: readonly PathSeg[], abs: readonly number[][]): [number, number][] {
  let x = 0, y = 0, sx = 0, sy = 0
  return segs.map(({ cmd }, j) => {
    const at: [number, number] = [x, y], C = cmd.toUpperCase()
    ;[x, y] = endOf(C, abs[j], x, y, sx, sy)
    if (C === 'M') [sx, sy] = [x, y]
    return at
  })
}

/** The path's own points, absolute, in order: each command's explicit control points and its end; H and V points move
 *  along their axis only. Null when `d` does not parse. */
export function pathHandles(d: string): Point[] | null {
  const r = parsePath(d)
  if ('error' in r) return null
  const abs = absArgs(r.segs), from = starts(r.segs, abs)
  return own(r.segs, abs).map(([j, i]): Point => {
    const C = r.segs[j].cmd.toUpperCase(), a = abs[j]
    return C === 'H' ? { x: a[0], y: from[j][1], axis: 'x' } : C === 'V' ? { x: from[j][0], y: a[0], axis: 'y' } : { x: a[i], y: a[i + 1] }
  })
}

/** For each of pathHandles' points, the one an H or V point takes its other coordinate from (an H's y, a V's x: the
 *  cursor's, from the last point that set it), so it moves with that one; -1 for none (any other point, or the mod's
 *  start cursor). Null when `d` does not parse. */
export function pathCross(d: string): number[] | null {
  const r = parsePath(d)
  if ('error' in r) return null
  const out: number[] = []
  let ox = -1, oy = -1, sx = -1, sy = -1   // the points that set the cursor's x and y, and the subpath start's
  for (const { cmd, args } of r.segs) {
    const C = cmd.toUpperCase(), n = slots(C, args.length).length, end = out.length + n - 1
    if (C === 'Z') [ox, oy] = [sx, sy]
    for (let i = 0; i < n; i++) out.push(C === 'H' ? oy : C === 'V' ? ox : -1)
    if (n && C !== 'V') ox = end
    if (n && C !== 'H') oy = end
    if (C === 'M') [sx, sy] = [end, end]
  }
  return out
}

/** `d` with its point k (pathHandles' numbering) at (x, y), absolute; H and V take their own axis only. Every other
 *  explicit point stays where it is (an H or V end after it keeps its x or y, its other coordinate is the cursor's, and a
 *  reflected S or T control follows the point it reflects, as in the mod): a relative command whose start moved gets new
 *  deltas, and every command the move does not reach keeps its numbers as written (no rounding noise from the round trip
 *  through absolute); each command keeps its letter. A new relative number is the difference of two float32 values and
 *  may print as noise (10 - 12.346 is -2.3459997), so it is written as `r` rounds it (the writer's 3 decimals) when that
 *  lands on the same float32 coordinate, else exactly. `d` itself when no number changes; null when `d` does not parse
 *  or there is no point k. */
export function movePathPoint(d: string, k: number, x: number, y: number, r: (v: number) => number = v => v): string | null {
  const p = parsePath(d)
  if ('error' in p) return null
  const was = absArgs(p.segs), slot = own(p.segs, was)[k]
  if (!slot) return null
  const [at, i] = slot, C0 = p.segs[at].cmd.toUpperCase(), abs = was.map(a => [...a])
  if (C0 === 'H') abs[at][0] = x
  else if (C0 === 'V') abs[at][0] = y
  else { abs[at][i] = x; abs[at][i + 1] = y }
  const before = starts(p.segs, was), after = starts(p.segs, abs), rel = relArgs(p.segs, abs)
  const segs = p.segs.map((s, j) => {
    const C = s.cmd.toUpperCase(), [x0, y0] = before[j], [x1, y1] = after[j]
    const moved = C === 'H' ? x0 !== x1 : C === 'V' ? y0 !== y1 : x0 !== x1 || y0 !== y1
    if (j !== at && !(s.cmd !== C && moved)) return s
    if (s.cmd === C) return rel[j]
    return { cmd: s.cmd, args: rel[j].args.map((v, n) => {
      if (C === 'A' && n < 5) return v   // radii, turn and flags: not relative
      const o = C === 'V' || (C === 'A' ? n === 6 : C !== 'H' && n % 2 === 1) ? y1 : x1, c = r(v)
      return Math.fround(o + c) === Math.fround(abs[j][n]) ? c : v
    }) }
  })
  const out = printPath(segs)
  return out === printPath(p.segs) ? d : out
}
