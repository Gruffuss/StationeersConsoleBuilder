import type { Pt } from './types'

/** CSS px per surface px, and the surface origin in the visible area's CSS px. Editor state only. */
export type Viewport = { zoom: number; pan: Pt }

export const toSurface = (v: Viewport, client: Pt): Pt =>
  ({ x: (client.x - v.pan.x) / v.zoom, y: (client.y - v.pan.y) / v.zoom })

export function zoomAt(v: Viewport, anchor: Pt, factor: number): Viewport {
  if (![anchor.x, anchor.y, factor].every(Number.isFinite) || factor <= 0) return v
  const zoom = Math.max(0.01, Math.min(64, v.zoom * factor)), p = toSurface(v, anchor)
  return { zoom, pan: { x: anchor.x - p.x * zoom, y: anchor.y - p.y * zoom } }
}

export function fitView(page: { w: number; h: number }, avail: { w: number; h: number }, margin = 24): Viewport {
  const zoom = Math.max(0.01, Math.min(64, (avail.w - 2 * margin) / page.w, (avail.h - 2 * margin) / page.h))
  return { zoom, pan: { x: (avail.w - page.w * zoom) / 2, y: (avail.h - page.h * zoom) / 2 } }
}
