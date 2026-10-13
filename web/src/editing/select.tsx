// The select tool's geometry and overlay (spec §4 "Transform", "Space"): where the one selected node's handles sit and
// which one a point hits, what a marquee catches, and the outlines of a multi-selection's other members.
import { SCENE_ELEMENT } from '../codegen/lua'
import { apply, chainTo, groupMatrix, invert, mul, viewbox, type Box, type Handle, type Mat } from '../editor/geometry'
import { HANDLE_SIZE, Handles, handlePoints, widgetBox, widgetBoxes } from '../editor/Handles'
import { spanBounds } from '../editor/hitTest'
import { indexOfPath } from '../model/numbering'
import type { Scene } from '../model/scene'
import type { Page } from '../model/project'
import { nodeAt, selected, type Selection } from '../model/store'
import { foldKey } from '../srctext/props'
import type { Theme } from '../theme'
import { shownOrder } from './ctx'
import { union } from './layout'
import { transformHandles } from './multiTransform'
import { handlesOf } from './transform'
import type { Ctx, OverlayCtx, Pt } from './types'
import { unitsOf, type Unit } from './units'
import type { NativeRef } from '../widgets/types'
import { nativeAt } from '../widgets/core'
import { allBoxes, boundsOf, hidden, worldOf } from './bounds'
import { heldBox, holderOf, nativeTargets, nativeUnitsOf, nativesUnder, shownNatives } from './natives'
import { lockedAt, onPath } from './tree'

/** Where the node's handles sit: its handle box and the chain from that box's frame (a G: its children's) to surface px;
 *  null when it has none or an ancestor is not literal. With the theme, a widget root's (M2b): its params' box, the
 *  handles its module allows (`only`) and a knob; null for the theme: a caller that has drawn a widget root already. */
export function handleFrame(scene: Scene, path: number[], rect: { w: number; h: number }, t: Theme | null, natives: NativeRef[] = []): { box: Box; chain: Mat; resize: boolean; rotate: boolean; only?: Handle[] } | null {
  const w = t && widgetBox(scene, path, t)
  if (w) {
    const parent = chainTo(scene, path, rect), local = groupMatrix(nodeAt(scene.root, path)!.attrs)
    const chain = parent && local && mul(parent, local)
    return chain && invert(chain) ? { box: w.box, chain, resize: w.handles.length > 0, rotate: true, only: w.handles } : null
  }
  const n = nodeAt(scene.root, path)
  let h = n && handlesOf(n)
  if (n && foldKey(n.op) === 'G' && t && natives.length) {
    const W = worldOf(scene, [...path, 0]), inv = W && invert(W), boxes: Box[] = h ? [h.box] : []
    if (inv) for (const ref of nativesUnder(scene, natives, [path], t)) {
      const b = heldBox(scene, [ref], path, t), local = b && boundsOf({ op: 'R', attrs: { ...b } }, inv)
      if (local) boxes.push(local)
    }
    if (boxes.length && groupMatrix(n.attrs)) h = { box: union(boxes), resize: !Object.keys(n.attrs).some(k => foldKey(k) === 'M'), rotate: true }
  }
  if (!n || !h) return null
  const chain = chainTo(scene, foldKey(n.op) === 'G' ? [...path, 0] : path, rect)
  return chain && invert(chain) ? { ...h, chain } : null
}

/** The handle of the one selected node under a surface point (within half a handle and 2 CSS px), or null. */
export function handleAt(scene: Scene, sel: Selection, rect: { w: number; h: number }, zoom: number, px: Pt, t: Theme | null, natives: NativeRef[] = []): Handle | 'rotate' | null {
  const f = sel.native !== undefined ? nativeHandleFrame(scene, natives, sel.native, rect, t) : null
  return hitHandle(sel.native !== undefined ? f?.locked ? null : f : handleFrame(scene, sel.path, rect, t, natives), rect, zoom, px)
}

export function nativeHandleFrame(scene: Scene, natives: NativeRef[], uid: string, rect: { w: number; h: number }, t: Theme | null) {
  const ref = t && nativeAt({ natives }, uid, t)
  if (!ref || !t) return null
  const path = holderOf(scene, ref, t), p = ref.params
  if (ref.hidden || path && onPath(scene.root, path, hidden)) return null
  return { box: { x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) }, chain: viewbox(scene.header, rect),
    resize: true, rotate: false, locked: !!ref.lock || !!(path && lockedAt(scene.root, path)) }
}

/** Canvas selection geometry and gestures only use shown native members. */
export function shownNativeUnitsOf(page: Page, sels: readonly Selection[], t: Theme) {
  const shown = new Set(shownNatives(page, t).map(n => n.uid))
  return nativeUnitsOf(page, sels, t).filter(u => shown.has(u.ref.uid))
}

/** Scene boxes include held natives; moving natives (including those riding a scene member) never snap to themselves. */
export function canvasTargets(page: Page, t: Theme, skip: readonly Selection[] = []): Box[] {
  const units = unitsOf(page.scene, skip, t), own = widgetBoxes(page.scene, t)
  const skipUids = new Set(skip.flatMap(s => s.native === undefined ? [] : [s.native]))
  for (const ref of nativesUnder(page.scene, page.natives ?? [], units.map(u => u.sel.path), t)) skipUids.add(ref.uid)
  const stationary = (page.natives ?? []).filter(n => !skipUids.has(n.uid))
  const held = new Map<Scene['root'][number], Box>()
  const nested: { box: Box; path: number[] }[] = []
  if (stationary.length) {
    const stack = page.scene.root.map((n, k) => ({ n, path: [k] }))
    for (let item = stack.pop(); item; item = stack.pop()) {
      const { n, path } = item
      if (foldKey(n.op) === 'G' && heldBox(page.scene, stationary, path, t)) {
        const b = unitsOf(page.scene, [{ pageId: page.id, path }], t, stationary)[0]?.box
        if (b) {
          if (path.length === 1) held.set(n, b)
          else nested.push({ box: b, path })
        }
      }
      n.c?.forEach((n, k) => stack.push({ n, path: [...path, k] }))
    }
  }
  // A nested group box must not stop allBoxes from walking down to widget params boxes.
  const otherGroups = nested.filter(({ path }) => !units.some(u => path.slice(0, Math.min(path.length, u.sel.path.length))
    .every((k, i) => u.sel.path[i] === k))).map(g => g.box)
  return [...allBoxes(page.scene, new Set(units.map(u => u.node)), (k, n = page.scene.root[k]) => held.get(n) ?? own(k, n)), ...otherGroups,
    ...nativeTargets(page, t, skipUids)]
}
function hitHandle(f: ReturnType<typeof handleFrame>, rect: { w: number; h: number }, zoom: number, px: Pt): Handle | 'rotate' | null {
  if (!f) return null
  let best: Handle | 'rotate' | null = null, reach = HANDLE_SIZE / 2 + 2
  for (const p of handlePoints(f.box, f.chain, zoom, { only: f.resize ? f.only : [], rotate: f.rotate, within: rect })) {
    const d = Math.max(Math.abs(p.x - px.x * zoom), Math.abs(p.y - px.y * zoom))
    if (d <= reach) { reach = d; best = p.h }
  }
  return best
}

/** A set's union in design units, including skipped members with a literal or displayed box. */
export function setFrame(ctx: Ctx, members?: Unit[]) {
  const page = ctx.page(), set = selected(ctx.get()).filter(s => s.pageId === page.id && !s.inDefs)
  const natives = shownNativeUnitsOf(page, set, ctx.theme())
  const boxes = [...(members ?? unitsOf(page.scene, set, ctx.theme(), page.natives)).flatMap(u => { const b = u.box ?? spanBox(ctx, u.sel.path); return b ? [b] : [] }),
    ...natives.map(u => u.box)]
  if (!boxes.length) return null
  const box = union(boxes)
  const handles = transformHandles(page.scene, set, ctx.theme(), box)
  return { box, chain: ctx.view().unit, ...handles, ...(natives.some(u => !u.locked) && { resize: true, only: undefined }) }
}
export const setHandleAt = (ctx: Ctx, px: Pt, frame = setFrame(ctx)) => hitHandle(frame, ctx.page().size, ctx.view().zoom, px)

/** What a marquee `r` catches among root boxes (design units): what it touches, or (enclose) what lies wholly inside;
 *  never a box that wholly holds the marquee (no grabbing the backdrop). */
export function marqueeHits(boxes: readonly (Box | null)[], r: Box, enclose: boolean): number[] {
  const hits: number[] = []
  boxes.forEach((b, k) => {
    if (!b) return
    const inside = b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h
    const touches = b.x <= r.x + r.w && r.x <= b.x + b.w && b.y <= r.y + r.h && r.y <= b.y + b.h
    const around = b.x <= r.x && b.y <= r.y && b.x + b.w >= r.x + r.w && b.y + b.h >= r.y + r.h
    if (enclose ? inside : touches && !around) hits.push(k)
  })
  return hits
}

/** A root node's box from its spans in the frame shown (one with no literal box: USE, RP, an expression position), read
 *  through the numbering of the scene that frame was drawn from (shownOrder): none while it numbers otherwise. */
export function spanBox(ctx: Ctx, path: number | number[]): Box | null {
  const f = ctx.frame(), page = ctx.page(), order = shownOrder(f, page, ctx.order())
  const element = f ? f.elements.findIndex(e => e.id === SCENE_ELEMENT && e.scene === page.id) : -1
  const node = order ? indexOfPath(order, page.scene.root, typeof path === 'number' ? [path] : path) : null
  const b = f && element >= 0 && node !== null ? spanBounds(f, element, node) : null
  if (!b) return null
  const v = ctx.view(), p = v.toUnits({ x: b.x0, y: b.y0 }), q = v.toUnits({ x: b.x1, y: b.y1 })
  return { x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y }
}

/** The node's outline corners in surface px (its handle box through its chain; with the theme, a widget root's params
 *  box), or null. */
export function cornersOf(scene: Scene, path: number[], rect: { w: number; h: number }, t: Theme | null, natives: NativeRef[] = []): [number, number][] | null {
  const f = handleFrame(scene, path, rect, t, natives)
  return f && [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => apply(f.chain, f.box.x + f.box.w * u, f.box.y + f.box.h * v))
}

/** The other members of a multi-selection (Selection.tsx draws the primary), the set's union box, and a padlock saying
 *  "locked" on each member under # lock. A root member with no literal box (a USE, an RP, an expression position) is
 *  outlined and boxed by its spans in the frame shown, as the marquee caught it (spanBox). */
export function SetOutlines({ ctx, o }: { ctx: Ctx; o: OverlayCtx }) {
  const s = ctx.get(), page = ctx.page(), t = ctx.theme(), set = selected(s).filter(x => x.pageId === page.id && !x.inDefs)
  const units = unitsOf(page.scene, set, t, page.natives), nativeUnits = shownNativeUnitsOf(page, set, t)
  const locked = [...units, ...nativeUnits].filter(u => u.locked).map(u => u.sel)
  if (set.length < 2 && !locked.length) return null
  const poly = (c: [number, number][]) => c.map(([x, y]) => `${x * o.zoom},${y * o.zoom}`).join(' ')
  const spans = (x: Selection) => spanBox(ctx, x.path)
  const corners = (x: Selection): [number, number][] | null => {
    if (x.native === undefined) return cornersOf(page.scene, x.path, page.size, t, page.natives)
    const f = nativeHandleFrame(page.scene, page.natives ?? [], x.native, page.size, t)
    return f && [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => apply(f.chain, f.box.x + f.box.w * u, f.box.y + f.box.h * v))
  }
  const f = set.length > 1 ? setFrame(ctx, units) : null, u = f?.box
  const a = u && o.view.css(u), b = u && o.view.css({ x: u.x + u.w, y: u.y + u.h })
  return <svg className="vb-selection" aria-hidden="true">
    {set.map((x, k) => {
      if (x === s.selection) return null
      const c = corners(x)
      if (c) return <g key={k}><polygon className="vb-sel-under" points={poly(c)} /><polygon className="vb-sel-over" points={poly(c)} /></g>
      const b = spans(x), p = b && o.view.css(b), q = b && o.view.css({ x: b.x + b.w, y: b.y + b.h })
      const at = p && q && { x: p.x, y: p.y, width: q.x - p.x, height: q.y - p.y }
      return at && <g key={k}><rect className="vb-sel-under" {...at} /><rect className="vb-sel-over" {...at} /></g>
    })}
    {a && b && <rect className="vb-sel-set" x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} />}
    {f && <Handles box={f.box} chain={f.chain} zoom={o.zoom} only={f.resize ? f.only : []} rotate={f.rotate} within={page.size} />}
    {locked.map((x, k) => {
      const c = corners(x)
      return c && <g key={`lock${k}`} className="vb-lock" transform={`translate(${c[0][0] * o.zoom - 6} ${c[0][1] * o.zoom - 10})`}>
        <title>locked</title><path d="M-3 0v-3a3 3 0 0 1 6 0v3" /><rect x={-5} y={0} width={10} height={8} rx={1} />
      </g>
    })}
  </svg>
}
