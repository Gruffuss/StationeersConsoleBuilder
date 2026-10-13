// The draw tools' shared part (spec §4 "Draw", ruling R12): a new node's look (the theme's tokens as literals: src holds
// literals, spec §5.2), the box a drag makes, and two gestures: a box dragged or clicked (rectangle, ellipse, text,
// image) and points clicked (line, polygon, curve). Each tool file only names its op. A new node goes on top of the page
// root or entered group, selected, without an id; then the tool hands back to Select.
import { apply, childMatrix, invert, outline, round, type Box } from '../editor/geometry'
import type { Scene, SrcNode, Value } from '../model/scene'
import { nodeAt } from '../model/store'
import { colour, type Theme } from '../theme'
import { linked, unlinked, type StyleLink } from '../theme/links'
import { foldKey } from '../srctext/props'
import { themeDefs } from '../widgets/core'
import { defKey } from '../schema/duplicateIds'
import { worldBox, worldOf } from './bounds'
import { canvasTargets } from './select'
import { sceneDrag, SLOP, snapOn, snapOpts } from './gesture'
import { Guides } from './Guides'
import { snapPoint, targetsOf, type Guide, type Targets } from './snap'
import { isStyle, partLinks, typeLinks } from './style'
import type { DrawDefaults } from './settings'
import { editList, onPath } from './tree'
import type { Ctx, Edit, Mods, Press, Pt, Tool, View } from './types'

export type Kind = 'R' | 'C' | 'L' | 'Y' | 'SP' | 'SPclosed' | 'P' | 'Pclosed' | 'T' | 'image'

/** A new node's look from the theme's tokens, as literals: its colours, edges, the rectangle's radius and the text's
 *  message style. An open shape never gets a fill (an open SP's fill fills its chord) nor a shadow (the sp-shadow trap);
 *  a text always gets f (absent, it draws white). */
export function lookOf(kind: Kind, t: Theme): Record<string, Value> {
  if (kind === 'image') return { f: colour(t, 'border') + '33', s: colour(t, 'border-strong'), sw: t.geo.edge.strong, dash: [8, 6] }
  return drawLook(kind, t).attrs
}
function drawLook(kind: Exclude<Kind, 'image'>, t: Theme): SrcNode {
  const op = kind === 'SPclosed' ? 'SP' : kind === 'Pclosed' ? 'P' : kind
  const links: Record<string, StyleLink> = kind === 'T' ? typeLinks(t.drawText) : kind === 'L' || kind.startsWith('SP') || kind === 'P' ? partLinks('line') : partLinks('shape')
  const keys = kind === 'T' ? Object.keys(links) : kind === 'R' ? ['f', 's', 'sw', 'rx'] : kind === 'L' || kind === 'SP' || kind === 'P' ? ['s', 'sw'] : ['f', 's', 'sw']
  if (kind === 'SPclosed') links.f = { part: 'shape', field: 'fill' }
  let n: SrcNode = { op, attrs: {} }
  for (const k of keys) n = linked(n, k, links[k], t)
  return n
}
/** Browser defaults replace the whole authored look, and resolve their retained links in this theme. */
export function dressed(n: SrcNode, kind: Kind, t: Theme, defaults: DrawDefaults): SrcNode {
  if (kind === 'image') return n
  const key = kind === 'SPclosed' ? kind : n.op
  const saved = Object.hasOwn(defaults, key) ? defaults[key] : undefined
  let look: SrcNode = saved ? { op: n.op, attrs: saved.attrs } : drawLook(kind, t)
  if (saved) for (const [key, link] of Object.entries(saved.links)) look = linked(look, key, link, t)
  if (kind === 'P' || kind === 'SP') look = unlinked({ ...look, attrs: Object.fromEntries(Object.entries(look.attrs).filter(([k]) => !['F', 'SH'].includes(foldKey(k)))) }, ['f', 'sh'])
  const attrs = Object.fromEntries(Object.entries(n.attrs).filter(([k]) => !isStyle(n.op, k)))
  return { ...n, attrs: { ...attrs, ...look.attrs }, ...(look.comments && { comments: [...n.comments ?? [], ...look.comments] }) }
}

/** A node: the geometry keys first, then the look; numbers as M1 writes them (3 decimals, float32). */
export function newNode(op: string, geometry: Record<string, Value>, look: Record<string, Value>, comments?: string[]): SrcNode {
  const v = (x: Value): Value => typeof x === 'number' ? round(x) : Array.isArray(x) ? x.map(y => typeof y === 'number' ? round(y) : y) : x
  const attrs: Record<string, Value> = {}
  for (const [k, x] of [...Object.entries(geometry), ...Object.entries(look)]) attrs[k] = v(x)
  return comments?.length ? { op, attrs, comments } : { op, attrs }
}

/** The box two points make: Shift a square on the longer side, Alt with `a` as the centre; at least `least` each way. */
export function cornerBox(a: Pt, b: Pt, mods: Pick<Mods, 'shift' | 'alt'>, least = 1): Box {
  let w = b.x - a.x, h = b.y - a.y
  if (mods.shift) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s }
  const [x0, y0, ww, hh] = mods.alt ? [a.x - w, a.y - h, 2 * w, 2 * h] : [a.x, a.y, w, h]
  return { x: Math.min(x0, x0 + ww), y: Math.min(y0, y0 + hh), w: Math.max(least, Math.abs(ww)), h: Math.max(least, Math.abs(hh)) }
}

/** The smallest side a drag writes: 1 unit when it snaps (to whole units), else 1 CSS px at this zoom, so a free drag in
 *  a scene of small units (SCENE w=10, or 0..1) keeps what it drew. */
function leastSide(ctx: Ctx, mods: Mods): number {
  const v = ctx.view(), k = v.zoom * Math.min(Math.abs(v.unit[0]), Math.abs(v.unit[3]))   // CSS px per unit
  return snapOn(ctx, mods) || !(k > 0) ? 1 : 1 / k
}

/** Whether two points are one once written (3 decimals, float32). */
const same = (a: Pt, b: Pt) => round(a.x) === round(b.x) && round(a.y) === round(b.y)

// Snap targets: every node on the page and the page itself; a point snaps unless Ctrl/Cmd is held.
const targets = (ctx: Ctx, base: Scene): Targets => targetsOf(canvasTargets({ ...ctx.page(), scene: base }, ctx.theme()), ctx.view().size)
const snapper = (ctx: Ctx, seen: Targets) => (q: Pt, mods: Mods) => snapOn(ctx, mods) ? snapPoint(q, seen, snapOpts(ctx)) : { p: q, guides: [] as Guide[] }

type BoxKind = 'R' | 'C' | 'T' | 'image'
/** The box a click without a drag makes, top-left at the click. */
const CLICK: Record<BoxKind, (t: Theme) => { w: number; h: number }> = {
  R: () => ({ w: 120, h: 80 }), C: () => ({ w: 120, h: 80 }), image: () => ({ w: 120, h: 80 }),
  T: t => ({ w: 240, h: Math.ceil(1.4 * (lookOf('T', t).size as number)) }),   // TMP shows nothing in a box under ~1.4 sizes
}

// Keep snapping in design units; only the geometry written into the entered group is local.
export function drawingFrame(ctx: Ctx, start: Pt) {
  const page = ctx.page(), entered = ctx.get().entered, path = entered?.pageId === page.id ? entered.path : []
  const W = worldOf(page.scene, [...path, 0]), inv = W && invert(W)
  if (!inv) {
    const expression = onPath(page.scene.root, path, n => !childMatrix(n))
    ctx.note(expression ? 'cannot draw: a group transform is an expression' : 'cannot draw: a group transform is singular or non-finite')
    return null
  }
  const box = path.length ? worldBox(page.scene, path) : null
  if (box && (start.x < box.x || start.y < box.y || start.x > box.x + box.w || start.y > box.y + box.h))
    ctx.note('The entered group is the drawing destination. Use Select and click empty canvas to leave it before drawing.')
  const local = (p: Pt): Pt => { const [x, y] = apply(inv, p.x, p.y); return { x, y } }
  const insert = (base: Scene, node: SrcNode): Edit | null => {
    const values = Object.values(node.attrs)
    while (values.length) {
      const v = values.pop()!
      if (Array.isArray(v)) for (const x of v) values.push(x)
      else if (typeof v === 'number' && !Number.isFinite(Math.fround(v))) {
        ctx.note('cannot draw: the local geometry leaves float32')
        return null
      }
    }
    const list = path.length ? nodeAt(base.root, path)?.c : base.root
    if (!list) return null
    const root = editList(base.root, path, c => [...c, node])
    const fresh = themeDefs([node], ctx.theme()).filter(d => !base.defs.some(old => defKey(old) === defKey(d)))
    return root ? { scene: { ...base, root, defs: fresh.length ? [...base.defs, ...fresh] : base.defs }, selection: [{ pageId: page.id, path: [...path, list.length] }] } : null
  }
  return { local, insert, scale: { x: Math.hypot(W[0], W[1]), y: Math.hypot(W[2], W[3]) } }
}

/** A tool that draws one node in a box: drag it (Shift square, Alt from the centre), or click for the default box (Shift
 *  a square from the click, Alt centred on it). A drag that comes back within the slop of its press, or whose two ends
 *  snap to one point, is a click too. */
export function boxTool(o: { id: string; label: string; order: number; key: string; kind: BoxKind; make: (b: Box, t: Theme, mods: Mods) => SrcNode }): Tool {
  return {
    kind: 'tool', id: o.id, label: o.label, order: o.order, key: o.key, cursor: 'crosshair',
    down(p, ctx) {
      const frame = drawingFrame(ctx, p.at)
      if (!frame) return null
      const { local } = frame, t = ctx.theme(), at = snapper(ctx, targets(ctx, ctx.page().scene))
      const insert = (base: Scene, node: SrcNode) => frame.insert(base, dressed(node, o.kind, t, ctx.drawDefaults()))
      const click = (q: Press) => {
        const a = local(at(q.start, q.mods).p), d = CLICK[o.kind](t), k = q.mods.alt ? 0.5 : 1
        const edit = insert(ctx.page().scene, o.make(cornerBox(a, { x: a.x + k * d.w, y: a.y + k * d.h }, q.mods), t, q.mods))
        if (edit) void ctx.apply(edit)
      }
      const g = sceneDrag(ctx, (q, base) => {
        const b = at(q.at, q.mods)
        const box = cornerBox(local(at(q.start, q.mods).p), local(b.p), q.mods, 0), least = leastSide(ctx, q.mods)
        const edit = insert(base, o.make({ ...box, w: Math.max(box.w, least / frame.scale.x), h: Math.max(box.h, least / frame.scale.y) }, t, q.mods))
        return edit && { ...edit, guides: b.guides }
      }, { onClick: click, overlay: (oc, guides) => <Guides guides={guides} css={oc.view.css} /> })
      return {
        ...g,
        up(q) {
          if (q.css < SLOP || same(at(q.start, q.mods).p, at(q.at, q.mods).p)) { g.cancel(); click(q) } else g.up(q)
          ctx.setTool('select')
          return false
        },
      }
    },
  }
}

/** The shape being drawn, in CSS px: the outline the mod draws for it (an SP's curve, a Y closed) and the points clicked.
 *  Styled in app.css (.vb-band); it never takes the pointer. */
function Band({ shape, points, css }: { shape: SrcNode; points: readonly Pt[]; css: View['css'] }) {
  const xy = outline(shape)?.[0] ?? [], line: string[] = []
  for (let k = 0; k + 1 < xy.length; k += 2) { const c = css({ x: xy[k], y: xy[k + 1] }); line.push(`${c.x},${c.y}`) }
  return <svg className="vb-band" aria-hidden="true">
    {line.length > 1 && (shape.op === 'Y' ? <polygon points={line.join(' ')} /> : <polyline points={line.join(' ')} />)}
    {points.map((p, i) => { const c = css(p); return <circle key={i} cx={c.x} cy={c.y} r={3} /> })}
  </svg>
}

/** A tool that draws a line (L), polygon (Y) or curve (SP) by its points. A drag makes the first segment (a line is then
 *  done); each click adds a point (a click on the last point adds none: the mod drops a repeated point, Stroke.cs), with a
 *  rubber band to the pointer; Enter or a double click ends; a click on the first point closes (SP gains close=1 and a
 *  fill); Backspace or Mod+Z drops the last point (past the first, the tool is left); Esc drops the shape. A point snaps
 *  to the page's nodes, the page and the shape's earlier points; Shift: 45 degree steps from the last point, by where
 *  the pointer snapped (the point itself lies on no guide, so none shows).
 *  The shape is the overlay's until it ends, then written once, on top of its page as that page is then: nothing else
 *  (an undo, a page switch, the code pane, the panel) ever meets it half drawn, and the router ends it when the page or
 *  the history moves under it. A shape with too few points (L and SP 2, Y 3) is never written. */
export function pointsTool(o: { id: string; label: string; order: number; key: string; kind: 'L' | 'Y' | 'SP' }): Tool {
  return {
    kind: 'tool', id: o.id, label: o.label, order: o.order, key: o.key, cursor: 'crosshair',
    down(p, ctx) {
      const frame = drawingFrame(ctx, p.at)
      if (!frame) return null
      const pageId = ctx.page().id, t = ctx.theme(), least = o.kind === 'Y' ? 3 : 2
      const boxes = canvasTargets(ctx.page(), t), size = ctx.view().size
      const shape = (list: readonly Pt[], close: boolean) => dressed(newNode(o.kind, { p: list.flatMap(q => [q.x, q.y]), ...(o.kind === 'SP' && close ? { close: 1 } : {}) }, {}),
        o.kind === 'SP' && close ? 'SPclosed' : o.kind, t, ctx.drawDefaults())
      // The next point after `fixed`: snapped to the nodes, the page and every point of `fixed` but its last, the one it
      // goes on from (Shift lines up with that one). `on`: where the pointer snapped, Shift or not (a closing click).
      const next = (q: { at: Pt; mods: Mods }, fixed: readonly Pt[]) => {
        const from = fixed[fixed.length - 1], own = fixed.slice(0, -1).map(v => ({ ...v, w: 0, h: 0 }))
        const s = snapper(ctx, targetsOf([...boxes, ...own], size))(q.at, q.mods)
        if (!q.mods.shift || !from) return { p: s.p, on: s.p, guides: s.guides }
        const d = Math.hypot(s.p.x - from.x, s.p.y - from.y), th = Math.round(Math.atan2(s.p.y - from.y, s.p.x - from.x) / (Math.PI / 4)) * Math.PI / 4
        return { p: { x: from.x + d * Math.cos(th), y: from.y + d * Math.sin(th) }, on: s.p, guides: [] as Guide[] }
      }
      const pts: Pt[] = [next(p, []).p]
      let held = true, dragged = false, done = false, band: Pt | null = null, guides: Guide[] = []
      const finish = (close: boolean): 'done' => {
        if (done) return 'done'
        done = true
        const page = ctx.page()
        if (page.id === pageId && pts.length >= least) {
          const edit = frame.insert(page.scene, shape(pts.map(frame.local), close))
          if (edit) void ctx.apply(edit)
        }
        ctx.setTool('select')
        return 'done'
      }
      return {
        move(q) {
          if (done || (held && !dragged && q.css < SLOP)) return
          if (held) dragged = true
          const n = next(q, pts)
          band = n.p
          guides = n.guides
          ctx.redraw()
        },
        up(q) {
          if (done) return false
          // The first press's drag adds its end, unless it came back within the slop of its press or snapped onto it (a
          // click then). A later press adds its point at the press; its release adds none, however far it drifted.
          const end = held && dragged && q.css >= SLOP ? next(q, pts).p : null
          held = false
          band = null
          guides = []
          if (end && !same(end, pts[0])) {
            pts.push(end)
            if (o.kind === 'L') { finish(false); return false }
          }
          return true
        },
        down(q) {
          if (done) return
          if (q.clicks >= 2) { finish(false); return }   // a Y is closed by its op
          const n = next(q, pts)
          if (o.kind !== 'L' && pts.length >= 3 && Math.hypot(n.on.x - pts[0].x, n.on.y - pts[0].y) <= ctx.view().threshold) { finish(true); return }
          if (!same(n.p, pts[pts.length - 1])) pts.push(n.p)
          band = null
          guides = n.guides
          ctx.redraw()
        },
        key(k) {
          if (done) return false
          if (k === 'Enter') return finish(false)
          if (k !== 'Backspace' && k !== 'Mod+Z') return false
          pts.pop()
          if (!pts.length) return finish(false)
          band = null
          ctx.redraw()
          return true
        },
        cancel() { done = true },
        overlay: oc => done ? null : <>
          <Band shape={shape(band ? [...pts, band] : pts, false)} points={pts} css={oc.view.css} />
          {guides.length > 0 && <Guides guides={guides} css={oc.view.css} />}
        </>,
      }
    },
  }
}
