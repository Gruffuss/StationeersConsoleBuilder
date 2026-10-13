// The points tool (ruling P4; M1's point-handle gap): the selected line's, polygon's, curve's or path's own points, each a
// handle; a drag moves one point, snapped (Ctrl/Cmd: free), as one undo step. A press off the points selects what it
// hits and stays here for another line, polygon, curve or path (saying why when its points cannot be edited), else goes
// back to Select. Esc goes back to Select.
import { apply, invert } from '../../editor/geometry'
import { nodeAt, type Selection } from '../../model/store'
import type { SrcNode } from '../../model/scene'
import { canvasTargets } from '../select'
import { sceneDrag, snapOn, snapOpts } from '../gesture'
import { Guides } from '../Guides'
import { crossOf, hasPoints, movePoint, noPoints, PointHandles, pointAt, pointsOf, segmentAt, addPoint, editPoint, noteCrossing } from '../points'
import { first } from '../../srctext/props'
import { isPathAnchor, pathAnchorIndexes } from '../../srctext/path'
import { snapPoint, targetsOf, type Guide, type Targets } from '../snap'
import { lockedAt, replaceAt, removeAt } from '../tree'
import type { Command, Ctx, Gesture, Pt, Tool } from '../types'

// Set at the first move. from: the point in design units. seen: what it snaps to. u: the design direction of an H or V
// point's axis (it moves along that line only). only: the design axis that line runs along, so the one that snaps;
// null when the chain turns it off both, and then the point does not snap (rounding a page coordinate there would move
// it off its line).
type Start = { from: Pt; seen: Targets; u?: Pt; only?: 'x' | 'y' | null }

/** The design axis a direction runs along, or null. */
const along = (u: Pt) => Math.abs(u.y) <= 1e-9 * Math.abs(u.x) ? 'x' : Math.abs(u.x) <= 1e-9 * Math.abs(u.y) ? 'y' : null

function drag(ctx: Ctx, sel: Selection, k: number): Gesture {
  const W = ctx.view().world(sel.path), inv = W && invert(W)
  let s: Start | null = null, why = ''
  return sceneDrag<Guide>(ctx, (q, base) => {
    const n = nodeAt(base.root, sel.path)
    if (!n || !W || !inv) return null
    // A locked node (its own `# lock` or one above it) keeps its points, as a move keeps it (units.ts).
    if (lockedAt(base.root, sel.path)) { why = 'locked'; return null }
    if (!s) {
      const pts = pointsOf(n), pt = pts?.[k]
      if (!pts || !pt) return null
      const [x, y] = apply(W, pt.x, pt.y)
      // Every other node's box and the page, and the node's own other points (a vertex lines up with its neighbour); not
      // its own box, which moves with the point, nor the point's own place (nor another point there).
      const seen = targetsOf(canvasTargets({ ...ctx.page(), scene: base }, ctx.theme(), [sel]), ctx.view().size), cross = crossOf(n)
      pts.forEach((o, i) => {
        if (i === k || (o.x === pt.x && o.y === pt.y)) return
        const [ox, oy] = apply(W, o.x, o.y)
        // An H or V point after this one takes its other coordinate from it and moves with it: no target on the page axis
        // that coordinate runs along (on neither when the chain turns it off both).
        const f = cross[i] === k ? along(o.axis === 'x' ? { x: W[2], y: W[3] } : { x: W[0], y: W[1] }) : undefined
        if (f === undefined || f === 'y') seen.x.push({ at: ox, lo: oy, hi: oy })
        if (f === undefined || f === 'x') seen.y.push({ at: oy, lo: ox, hi: ox })
      })
      const u = pt.axis === 'x' ? { x: W[0], y: W[1] } : pt.axis === 'y' ? { x: W[2], y: W[3] } : undefined
      s = { from: { x, y }, seen, ...(u && { u, only: along(u) }) }
    }
    const { from, u } = s, t = { x: q.at.x - q.start.x, y: q.at.y - q.start.y }
    // An H or V point takes the part of the travel along its line (the pointer's nearest place on it).
    const m = u ? (t.x * u.x + t.y * u.y) / (u.x * u.x + u.y * u.y) : 0
    let to = u ? { x: from.x + m * u.x, y: from.y + m * u.y } : { x: from.x + t.x, y: from.y + t.y }, guides: Guide[] = []
    if (snapOn(ctx, q.mods) && s.only !== null) { const r = snapPoint(to, s.seen, snapOpts(ctx), s.only); to = r.p; guides = r.guides }
    const [lx, ly] = apply(inv, to.x, to.y), w = movePoint(n, k, lx, ly)
    why = w.locked ?? ''
    const root = w.node === n ? undefined : replaceAt(base.root, sel.path, w.node)
    // Back where it began: the base itself, so the store's no-op guard leaves no undo step.
    return { scene: root ? { ...base, root } : base, guides }
  }, { onCommit: () => {
    if (why) ctx.note(why)
    const n = nodeAt(ctx.page().scene.root, sel.path)
    if (n) chosen.set(ctx, { sel, node: n, k })
    if (!why) noteCrossing(ctx, sel.path)
  }, overlay: (oc, guides) => <Guides guides={guides} css={oc.view.css} /> })
}

const chosen = new WeakMap<Ctx, { sel: Selection; node: SrcNode; k: number }>()
const chosenSegment = new WeakMap<Ctx, { sel: Selection; node: SrcNode; segment: number }>()
function segmentChoice(ctx: Ctx) {
  const c = chosenSegment.get(ctx), sel = ctx.get().selection
  return c && sel && !sel.inDefs && sel.pageId === ctx.page().id && sel.pageId === c.sel.pageId
    && sel.path.join() === c.sel.path.join() ? c : null
}
async function insertPoint(ctx: Ctx, sel: Selection, node: SrcNode, segment: number, t: number) {
  const page = ctx.page()
  if (nodeAt(page.scene.root, sel.path) !== node) { ctx.note('the segment selection changed; select a segment again'); return }
  if (lockedAt(page.scene.root, sel.path)) { ctx.note('locked'); return }
  const w = addPoint(node, segment, t)
  if (w.locked) { ctx.note(w.locked); return }
  if (w.node === node) return
  const why = await ctx.apply({ scene: { ...page.scene, root: replaceAt(page.scene.root, sel.path, w.node)! } }, { check: true })
  if (!why && ctx.page().id === page.id) { chosenSegment.delete(ctx); noteCrossing(ctx, sel.path) }
}
function choice(ctx: Ctx) {
  const p = chosen.get(ctx), sel = ctx.get().selection
  return p && sel && !sel.inDefs && sel.pageId === ctx.page().id && sel.pageId === p.sel.pageId && sel.path.join() === p.sel.path.join() ? p : null
}
async function change(ctx: Ctx, mode: 'delete' | 'corner' | 'smooth') {
  const c = choice(ctx), page = ctx.page()
  if (!c) return
  const n = nodeAt(page.scene.root, c.sel.path)
  if (!n || n !== c.node) { ctx.note('the point selection changed; select an anchor again'); return }
  if (lockedAt(page.scene.root, c.sel.path)) { ctx.note('locked'); return }
  const w = editPoint(n, c.k, mode)
  if (w.locked) { ctx.note(w.locked); return }
  if (w.node === n) return
  const root = w.node ? replaceAt(page.scene.root, c.sel.path, w.node)! : removeAt(page.scene.root, [c.sel.path])
  const why = await ctx.apply({ scene: { ...page.scene, root }, ...(w.node ? {} : { selection: [] }) }, { check: true })
  if (!why) {
    if (w.node) noteCrossing(ctx, c.sel.path)
    if (mode === 'delete') chosen.delete(ctx)
    else {
      const node = nodeAt(ctx.page().scene.root, c.sel.path)
      const old = pathAnchorIndexes(first(n, 'D') as string)!, indices = node && pathAnchorIndexes(first(node, 'D') as string)
      const k = indices?.[old.indexOf(c.k)]
      if (node && k !== undefined) chosen.set(ctx, { sel: c.sel, node, k })
      else chosen.delete(ctx)
    }
  }
  ctx.redraw()
}
const pointCommands: Command[] = [
  { kind: 'command', id: 'point-delete', label: 'Delete point', menu: 'edit', order: -3, keys: ['Delete', 'Backspace'],
    when: ctx => ctx.tool() === 'points' && !!choice(ctx), run: ctx => change(ctx, 'delete') },
  ...(['corner', 'smooth'] as const).map((mode, i): Command => ({ kind: 'command', id: 'point-'+mode,
    label: mode === 'corner' ? 'Corner' : 'Smooth', menu: 'edit', order: -2+i, keys: [mode === 'corner' ? 'Alt+C' : 'Alt+Shift+S'],
    when: ctx => { const c = choice(ctx), d = c && first(c.node, 'D'); return ctx.tool() === 'points' && !!c && nodeAt(ctx.page().scene.root, c.sel.path) === c.node && typeof d === 'string' && isPathAnchor(d, c.k) },
    run: ctx => change(ctx, mode) })),
]
const addCommand: Command = { kind: 'command', id: 'point-add', label: 'Add point', menu: 'edit', order: -4,
  when: ctx => ctx.tool() === 'points' && !!segmentChoice(ctx),
  run: ctx => { const c = segmentChoice(ctx); if (c) return insertPoint(ctx, c.sel, c.node, c.segment, 0.5) } }

const points: Tool = {
  kind: 'tool', id: 'points', label: 'Points', order: 1, key: 'A',
  down(p, ctx) {
    const page = ctx.page(), sel = ctx.get().selection
    chosenSegment.delete(ctx)
    if (p.mods.alt) {
      chosen.delete(ctx)
      let target = sel && !sel.inDefs && sel.native === undefined && sel.pageId === page.id ? sel : null
      let hit = target && segmentAt(page.scene, target.path, page.size, ctx.view().zoom, p.px)
      if (!hit) {
        const { target: picked, enter } = ctx.pick(p.px, true, { natives: false })
        if (enter) ctx.dispatch(enter)
        if (picked && !picked.inDefs && picked.pageId === page.id) {
          target = picked; hit = segmentAt(page.scene, target.path, page.size, ctx.view().zoom, p.px)
        }
      }
      const n = target && nodeAt(page.scene.root, target.path)
      if (n && lockedAt(page.scene.root, target!.path)) { ctx.note('locked'); return null }
      if (!n || !pointsOf(n)) { if (n) ctx.note(noPoints(n)); return null }
      if (hit) {
        ctx.dispatch({ type: 'select', selection: target })
        void insertPoint(ctx, target!, n, hit.segment, hit.t)
      }
      return null
    }
    const k = sel && !sel.inDefs && sel.native === undefined && sel.pageId === page.id ? pointAt(page.scene, sel.path, page.size, ctx.view().zoom, p.px) : null
    if (sel && k !== null) { chosen.set(ctx, { sel, node: nodeAt(page.scene.root, sel.path)!, k }); ctx.redraw(); return drag(ctx, sel, k) }
    chosen.delete(ctx)
    const segment = sel && !sel.inDefs && sel.native === undefined && sel.pageId === page.id && segmentAt(page.scene, sel.path, page.size, ctx.view().zoom, p.px)
    const { target: hit, enter } = segment ? { target: sel } : ctx.pick(p.px, true, { natives: false })
    if (enter) ctx.dispatch(enter)
    const n = hit && nodeAt(page.scene.root, hit.path)
    ctx.dispatch({ type: 'select', selection: hit })
    if (!n || !hasPoints(n)) ctx.setTool('select')
    else if (!pointsOf(n)) ctx.note(noPoints(n))
    else {
      const segment = segmentAt(page.scene, hit!.path, page.size, ctx.view().zoom, p.px)
      if (segment) {
        chosenSegment.set(ctx, { sel: hit!, node: n, segment: segment.segment })
        ctx.note('Segment selected. Use Edit menu › Add point to split it at its midpoint.')
        ctx.redraw()
      }
    }
    return null
  },
  overlay: (ctx, o) => {
    const c = choice(ctx)
    return <><PointHandles ctx={ctx} o={o} selected={c?.k} />
      {pointCommands[1].when(ctx) && <div onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onPointerMove={e => e.stopPropagation()}
        style={{ pointerEvents: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {pointCommands.slice(1).map(cmd => <button key={cmd.id} type="button" aria-label={cmd.label} onClick={() => { void cmd.run(ctx) }}>{cmd.label} ({cmd.keys![0]})</button>)}
      </div>}
    </>
  },
}
export default [points, addCommand, ...pointCommands]
