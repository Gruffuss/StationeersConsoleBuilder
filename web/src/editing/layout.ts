// Layout over boxes in design units (spec §4 "Space"), pure: one delta per box, in input order. And the
// box a resize handle makes. Boxes are geometric (no stroke, shadow or feather): Vanilla + outlines sit inside the box.
import type { Box, Handle } from '../editor/geometry'

export type AlignMode = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'
export type Delta = { dx: number; dy: number }

/** Two coordinates closer than this are one (half of M1's 0.001 write step, above float32 storage noise). */
export const EPS = 5e-4
/** A signed box (dragBox's, flipped) as its extent: w, h >= 0. Every function here takes signed boxes through it; a
 *  delta is a translation, so it applies to the signed box as it is. */
export const norm = (b: Box): Box => ({ x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) })

export function union(boxes: readonly Box[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const s of boxes) {
    const b = norm(s)
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
/** A shared area (touching edges are not). */
export function overlaps(s: Box, t: Box) {
  const a = norm(s), b = norm(t)
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Two or more boxes to their union's edge or centre; one box to `page`. */
export function align(boxes: readonly Box[], mode: AlignMode, page: Box): Delta[] {
  const to = boxes.length > 1 ? union(boxes) : norm(page)
  return boxes.map(s => {
    const b = norm(s)
    switch (mode) {
      case 'left': return { dx: to.x - b.x, dy: 0 }
      case 'centre': return { dx: to.x + to.w / 2 - (b.x + b.w / 2), dy: 0 }
      case 'right': return { dx: to.x + to.w - (b.x + b.w), dy: 0 }
      case 'top': return { dx: 0, dy: to.y - b.y }
      case 'middle': return { dx: 0, dy: to.y + to.h / 2 - (b.y + b.h / 2) }
      case 'bottom': return { dx: 0, dy: to.y + to.h - (b.y + b.h) }
    }
  })
}

const along = (s: Box, axis: 'x' | 'y') => { const b = norm(s); return axis === 'x' ? { p: b.x, s: b.w } : { p: b.y, s: b.h } }
const delta = (axis: 'x' | 'y', d: number): Delta => axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d }

/** Three or more: ordered by centre, the outer two fixed, equal gaps between neighbours. When the free space is whole the
 *  gaps are whole, the earlier ones a unit wider where it does not divide. Fewer than three: no move. The outer two are
 *  the first and last by centre, not by edge: a large box whose centre lies inside the others still counts as an end, so
 *  the selection can grow past its first extent. */
export function distribute(boxes: readonly Box[], axis: 'x' | 'y'): Delta[] {
  const out = boxes.map(() => delta(axis, 0))
  if (boxes.length < 3) return out
  const order = boxes.map((b, i) => ({ i, ...along(b, axis) })).sort((a, b) => (a.p + a.s / 2) - (b.p + b.s / 2))
  const first = order[0], last = order[order.length - 1], n = order.length - 1
  const free = last.p + last.s - first.p - order.reduce((t, b) => t + b.s, 0)
  const whole = Math.abs(free - Math.round(free)) < EPS, base = whole ? Math.floor(Math.round(free) / n) : free / n
  let extra = whole ? Math.round(free) - base * n : 0, at = first.p + first.s
  for (const b of order.slice(1, -1)) {
    const gap = base + (extra > 0 ? 1 : 0)
    extra--
    out[b.i] = delta(axis, at + gap - b.p)
    at += gap + b.s
  }
  return out
}

/** Two or more, ordered by start: the first stays, each next starts `gap` after the previous end. */
export function gapOf(boxes: readonly Box[], axis: 'x' | 'y', gap: number): Delta[] {
  const out = boxes.map(() => delta(axis, 0))
  const order = boxes.map((b, i) => ({ i, ...along(b, axis) })).sort((a, b) => a.p - b.p)
  let at = order[0] ? order[0].p + order[0].s : 0
  for (const b of order.slice(1)) {
    out[b.i] = delta(axis, at + gap - b.p)
    at += gap + b.s
  }
  return out
}

export type DragMods = { ratio?: boolean; centre?: boolean; min?: number | { w: number; h: number }; lead?: 'x' | 'y'; stop?: boolean }
/** The box after its handle `h` moved by (dx, dy), in the box's own units. The opposite side stays (centre: the centre
 *  stays and both sides move); ratio keeps w/h of `b` (a side handle: the other axis follows about its middle; a corner:
 *  `lead`, else the axis that changed more relative to its size, x on a tie); w and h keep their sign (flipped past the
 *  opposite side; stop, for a box of positive size: no flip, a size past it is as small as allowed); |w|, |h| are at
 *  least `min` (one for both, or each its own; with ratio the lead is floored so that the follower is too, and the
 *  follower follows the floored lead). */
export function dragBox(b: Box, h: Handle, dx: number, dy: number, m: DragMods = {}): Box {
  const xs = h.includes('w'), xe = h.includes('e'), ys = h.includes('n'), ye = h.includes('s')
  const size = (s: number, lo: boolean, hi: boolean, d: number) => !lo && !hi ? s : s + (hi ? d : -d) * (m.centre ? 2 : 1)
  const mw = typeof m.min === 'object' ? m.min.w : m.min ?? 0, mh = typeof m.min === 'object' ? m.min.h : mw
  const floor = (s: number, f: number) => Math.abs(s) >= f ? s : s < 0 ? -f : f, stop = (s: number) => m.stop ? Math.max(s, 0) : s
  let w = size(b.w, xs, xe, dx), hh = size(b.h, ys, ye, dy)
  if (m.ratio && b.w && b.h) {
    const r = Math.abs(b.h / b.w)
    const xLeads = (h.length > 1 && m.lead || leads(b, h, w, hh)) === 'x'
    w = stop(w); hh = stop(hh)   // after the lead is chosen: a corner dragged far past one side still leads with that side
    if (xLeads) { w = floor(w, Math.max(mw, mh / r)); hh = Math.sign(hh || b.h) * Math.abs(w) * r }
    else { hh = floor(hh, Math.max(mh, mw * r)); w = Math.sign(w || b.w) * Math.abs(hh) / r }
  } else { w = floor(stop(w), mw); hh = floor(stop(hh), mh) }
  // Where the new size sits: against the side that stays, or about the centre.
  const place = (p: number, s: number, lo: boolean, hi: boolean, n: number) => m.centre || (!lo && !hi) ? p + s / 2 - n / 2 : lo ? p + s - n : p
  return { x: place(b.x, b.w, xs, xe, w), y: place(b.y, b.h, ys, ye, hh), w, h: hh }
}

/** The axis a ratio drag leads with: a side handle's own; a corner's that changed more relative to its size (w, hh: the
 *  sizes as dragged), x on a tie. */
const leads = (b: Box, h: Handle, w: number, hh: number): 'x' | 'y' => h.length === 1 ? (h === 'e' || h === 'w' ? 'x' : 'y')
  : Math.abs(w - b.w) / Math.abs(b.w) >= Math.abs(hh - b.h) / Math.abs(b.h) ? 'x' : 'y'
/** The axis dragBox with ratio leads with when handle `h` moves by (dx, dy) and no `lead` is given. */
export function leadOf(b: Box, h: Handle, dx: number, dy: number, centre = false): 'x' | 'y' {
  const d = dragBox(b, h, dx, dy, { centre })   // each axis as dragged
  return leads(b, h, d.w, d.h)
}

/** The travel of the edges `h` drags, from `from` (the box at the press) to `to` (a box dragBox made from it): the dx, dy
 *  that give `to` again, with or without Alt. A resize snap's offset is added to this, not to the pointer's travel: under
 *  the ratio the following axis's edge did not travel with the pointer. */
export function travelOf(from: Box, to: Box, h: Handle): Delta {
  return {
    dx: h.includes('w') ? to.x - from.x : h.includes('e') ? to.x + to.w - (from.x + from.w) : 0,
    dy: h.includes('n') ? to.y - from.y : h.includes('s') ? to.y + to.h - (from.y + from.h) : 0,
  }
}
