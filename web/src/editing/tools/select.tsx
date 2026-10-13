// The select tool (spec §4 "Transform", "Snap", "Space"). On the one selected node: a press on a handle resizes it (Shift
// keeps the proportions, Alt works from the centre), on the knob turns it (whole degrees; Shift 15 degree steps; Ctrl/Cmd
// free); a double click on a line, polygon, curve or path opens the points tool. Elsewhere: a press on a node selects it
// and a drag moves the whole selection, snapped (Ctrl/Cmd: free), as one undo step; Shift+click adds or removes a node; a
// press on empty space draws a marquee (Ctrl/Cmd: only what it encloses; Shift: added to the set). A click without a drag
// on a node inside the selection selects that node alone (into a group). A widget root (M2b) moves and resizes by its
// params in whole units, with its module's resize handles and a rotate knob. A set shares one union frame.
import { SCENE_ELEMENT } from '../../codegen/lua'
import { apply, groupMatrix, invert, type Box, type Handle, type Mat } from '../../editor/geometry'
import { widgetBoxes } from '../../editor/Handles'
import { nodeAt, sameSelection, selected, type Selection } from '../../model/store'
import { foldKey } from '../../srctext/props'
import { putWidget, sanitize, widgetAt } from '../../widgets/core'
import { WIDGETS } from '../../widgets/registry'
import type { WidgetRef } from '../../widgets/types'
import { hidden, IDENTITY, similar, worldBox, worldOf } from '../bounds'
import { membersOf } from '../ctx'
import { enterable } from '../depth'
import { sceneDrag, SLOP, snapOn, snapOpts } from '../gesture'
import { Guides } from '../Guides'
import { dragBox, leadOf, travelOf, union } from '../layout'
import { hasPoints } from '../points'
import { canvasTargets, handleAt, handleFrame, marqueeHits, setFrame, setHandleAt, SetOutlines, shownNativeUnitsOf, spanBox } from '../select'
import { transformSet } from '../multiTransform'
import { snapMove, snapResize, targetsOf, type Guide, type Targets } from '../snap'
import { resizeTo, rotate, turnOf } from '../transform'
import { lockedAt, replaceAt } from '../tree'
import type { Ctx, Gesture, OverlayCtx, Press, Tool } from '../types'
import { clipAbove, moveUnits, unitsOf, type Unit } from '../units'
import { holderOf, moveNatives, nativeUnitsOf, nativesUnder, shownNatives, transformNatives, type NativeUnit } from '../natives'

/** a is b, or rides inside b's scene subtree. Native paths are virtual children of their holders. */
const within = (ctx: Ctx, a: Selection, b: Selection) => {
  if (a.pageId !== b.pageId || a.inDefs || b.inDefs) return false
  if (b.native !== undefined) return a.native === b.native
  const ref = a.native === undefined ? null : ctx.page().natives?.find(n => n.uid === a.native)
  const path = ref ? holderOf(ctx.page().scene, ref, ctx.theme()) : a.native === undefined ? a.path : null
  return !!path && b.path.length <= path.length && b.path.every((k, i) => path[i] === k)
}
const choose = (ctx: Ctx, set: Selection[]) => ctx.dispatch({ type: 'select', selection: set[set.length - 1] ?? null, also: set.slice(0, -1) })
const guided = (oc: OverlayCtx, guides: Guide[]) => <Guides guides={guides} css={oc.view.css} />
/** m's linear part has no turn or shear: x maps to x, y to y (a mirror allowed). Relative, so any scale counts. */
const axisAligned = (m: Mat) => Math.abs(m[1]) + Math.abs(m[2]) <= 1e-9 * (Math.abs(m[0]) + Math.abs(m[3]))
const uprightNote = (uids: string[]) => uids.length ? `${[...new Set(uids)].join(', ')} stay upright: natives do not turn` : ''
/** At release: why the last step was refused, and a clip that stayed behind when the node changed (as a move says). */
const said = (ctx: Ctx, why: string, clip: string | null, wrote: boolean, verb: string) => {
  const all = [why, wrote && clip ? `clip ${clip} does not follow a ${verb}` : ''].filter(Boolean)
  if (all.length) ctx.note(all.join('; '))
}

function move(ctx: Ctx, click: Selection | null): Gesture {
  let units: Unit[] = [], nativeUnits: NativeUnit[] = [], box: Box | null = null, seen: Targets | null = null, said: string[] = []
  return sceneDrag<Guide>(ctx, (q, base, natives) => {
    if (!seen) {
      units = unitsOf(base, membersOf(ctx), ctx.theme(), natives)
      nativeUnits = shownNativeUnitsOf({ ...ctx.page(), scene: base, natives }, selected(ctx.get()), ctx.theme())
      const boxes = [...units.flatMap(u => u.box ? [u.box] : []), ...nativeUnits.map(u => u.box)]
      box = boxes.length ? union(boxes) : null
      seen = targetsOf(canvasTargets({ ...ctx.page(), scene: base, natives }, ctx.theme(), [...units, ...nativeUnits].map(u => u.sel)), ctx.view().size)
    }
    let dx = q.at.x - q.start.x, dy = q.at.y - q.start.y, guides: Guide[] = []
    if (snapOn(ctx, q.mods)) {
      if (box) {
        const s = snapMove({ ...box, x: box.x + dx, y: box.y + dy }, seen, snapOpts(ctx))
        dx += s.dx
        dy += s.dy
        guides = s.guides
      } else { dx = Math.round(dx); dy = Math.round(dy) }
    }
    const r = moveUnits(base, units, units.map(() => ({ dx, dy })), ctx.theme())
    const n = moveNatives(natives, nativeUnits, nativeUnits.map(() => ({ dx, dy })), ctx.theme())
    said = [...r.skipped, ...n.skipped, ...r.notes]
    return { scene: r.scene, ...(nativeUnits.length && { natives: n.natives }), guides }
  }, {
    onClick: () => { if (click) ctx.dispatch({ type: 'select', selection: click }) },
    onCommit: () => { if (said.length) ctx.note(said.join('; ')) },
    overlay: guided,
  })
}

/** A widget root's resize (M2b): its params box, edges in whole units, written through putWidget (no G s or t: its clip
 *  outlines would not follow); Shift keeps the ratio only where the module offers corners. The size is held to the
 *  module's range (its min, a fix's one line) and then placed: it stops at the minimum with the edge the drag left where
 *  it was, never crossing over (M2b). Under Shift the axis that leads stops there too and the other follows it, so the
 *  ratio holds (ruling, M2c Wave 3). */
function resizeWidget(ctx: Ctx, w: WidgetRef, h: Handle, path: number[], native = false): Gesture {
  const t = ctx.theme(), m = WIDGETS[w.type], p = w.params as Box, from = { x: p.x, y: p.y, w: p.w, h: p.h }
  const least = sanitize(m, { ...w.params, w: 0, h: 0 }, t) as Box, min = { w: Math.max(1, least.w), h: Math.max(1, least.h) }
  let seen: Targets | null = null
  return sceneDrag<Guide>(ctx, (q, base, natives) => {
    const W = native ? IDENTITY : worldOf(base, [...path, 0]), inv = W && invert([W[0], W[1], W[2], W[3], 0, 0])
    if (!W || !inv) return null
    seen ??= targetsOf(canvasTargets({ ...ctx.page(), scene: base, natives }, t, [{ pageId: ctx.page().id, path, ...(native && { native: w.uid }) }]), ctx.view().size)
    // The snap acts where the pointer is (near: the drag box not held at the module's minimum). Without Shift it keeps a
    // crossing, and axis and sanitize then stop each edge. Under Shift dragBox stops the lead at the minimum and the
    // follower follows it on its own side (a corner's follower dragged past its anchor too: snapping its flipped edge led
    // with it and collapsed the box); the pointer picks the lead, and a lead that crossed (free) snaps nowhere.
    const [dx, dy] = apply(inv, q.at.x - q.start.x, q.at.y - q.start.y), lead = leadOf(from, h, dx, dy, q.mods.alt)
    const ratio = q.mods.shift && m.resize === 'both', mods = { ratio, centre: q.mods.alt, min: ratio ? min : 1, stop: ratio, lead }
    const free = dragBox(from, h, dx, dy, { ...mods, min: 1, stop: false }), near = dragBox(from, h, dx, dy, { ...mods, min: 1 })
    let box = dragBox(from, h, dx, dy, mods), guides: Guide[] = []
    if (axisAligned(W) && snapOn(ctx, q.mods) && !(ratio && (lead === 'x' ? free.w : free.h) < 0)) {   // the snap's offset onto the edges' travel
      const s = snapResize({ x: W[0] * near.x + W[4], y: W[3] * near.y + W[5], w: W[0] * near.w, h: W[3] * near.h }, h, seen, snapOpts(ctx), ratio), d = travelOf(from, near, h)
      guides = s.guides
      box = dragBox(from, h, d.dx + s.dx / W[0], d.dy + s.dy / W[3], { ...mods, lead: s.lead ?? lead })
    }
    const X = axis(box.x, box.w, p.x, p.w, h.includes('w'), h.includes('e'), mods.centre)
    const Y = axis(box.y, box.h, p.y, p.h, h.includes('n'), h.includes('s'), mods.centre)
    const size = sanitize(m, { ...w.params, w: X.l, h: Y.l }, t) as Box
    const params = sanitize(m, { ...size, x: X.at(size.w), y: Y.at(size.h) }, t) as Box
    if (params.x === p.x && params.y === p.y && params.w === p.w && params.h === p.h) return { scene: base, ...(native && { natives }), guides }
    if (native) return { scene: base, natives: natives.map(n => n.uid === w.uid ? { ...n, params } : n), guides }
    return { scene: putWidget(base, { ...w, params }, t), guides }
  }, { overlay: guided })
}

/** One axis of a widget's resize: dragBox's start s and signed length l (below zero the drag crossed over), the start s0
 *  and length l0 at the press, whether the handle drags the low or the high edge, and Alt. l: the length asked for, with
 *  a dragged edge at a whole unit and an edge left exactly where it was (a crossing asks for one unit); at(n): where a
 *  length n the module allows starts, against the edge left (about the centre when both moved). */
function axis(s: number, l: number, s0: number, l0: number, lo: boolean, hi: boolean, centre: boolean): { l: number; at: (n: number) => number } {
  if (s === s0 && l === l0) return { l: l0, at: () => s0 }
  if (hi && !lo && !centre) return { l: Math.max(1, Math.round(s + l) - s0), at: () => s0 }
  // The low edge alone moved (the high one stays), or both did: Alt, or the axis that follows a side handle under Shift.
  const one = lo && !hi && !centre, e0 = s0 + l0, a = Math.round(s), len = (one ? e0 : Math.round(s + l)) - a
  return { l: Math.max(1, len), at: n => n === Math.fround(len) ? a : one ? e0 - n : Math.round(s0 + l0 / 2 - n / 2) }
}

function resize(ctx: Ctx, sel: Selection, h: Handle): Gesture | null {
  if (sel.native !== undefined) {
    const unit = shownNativeUnitsOf(ctx.page(), [sel], ctx.theme())[0]
    if (!unit) return null
    if (unit.locked) { ctx.note(unit.locked); return null }
    return resizeWidget(ctx, unit.ref, h, [], true)
  }
  if (lockedAt(ctx.page().scene.root, sel.path)) { ctx.note('locked'); return null }
  const widget = widgetAt(ctx.page().scene, sel.path, ctx.theme())
  if (widget) return resizeWidget(ctx, widget, h, sel.path)
  const group = foldKey(nodeAt(ctx.page().scene.root, sel.path)!.op) === 'G'
  let from: Box | null = null, W: Mat | null = null, inv: Mat | null = null, seen: Targets | null = null, why = ''
  let clip: string | null = null, wrote = false   // wrote: the step shown changed the node
  return sceneDrag<Guide>(ctx, (q, base, natives) => {
    const n = nodeAt(base.root, sel.path)
    if (!n) return null
    if (!from) {
      const f = handleFrame(base, sel.path, ctx.page().size, ctx.theme(), natives)
      // The handle box's frame (a G: its children's) to design units, and a design-unit delta back into it.
      W = worldOf(base, group ? [...sel.path, 0] : sel.path)
      inv = W && invert([W[0], W[1], W[2], W[3], 0, 0])
      if (!f?.resize || !W || !inv) return null
      from = f.box
      seen = targetsOf(canvasTargets({ ...ctx.page(), scene: base, natives }, ctx.theme(), [sel]), ctx.view().size)
      clip = clipAbove(base.root, sel.path)
    }
    if (!W || !inv) return null
    const [dx, dy] = apply(inv, q.at.x - q.start.x, q.at.y - q.start.y)
    // Ruling R5: a resize snaps only under an axis-aligned chain. The dragged edges are snapped in design units (signed:
    // a flip stays a flip), and the offset is added to the edges' own travel (travelOf), which under the ratio is not the
    // pointer's on the axis that follows.
    const m = { ratio: q.mods.shift, centre: q.mods.alt }
    let box = dragBox(from, h, dx, dy, m), guides: Guide[] = []
    if (axisAligned(W) && snapOn(ctx, q.mods)) {
      const s = snapResize({ x: W[0] * box.x + W[4], y: W[3] * box.y + W[5], w: W[0] * box.w, h: W[3] * box.h }, h, seen!, snapOpts(ctx), m.ratio)
      const t = travelOf(from, box, h)
      guides = s.guides
      box = dragBox(from, h, t.dx + s.dx / W[0], t.dy + s.dy / W[3], { ...m, lead: s.lead })
    }
    const w = resizeTo(n, h, from, box, { centre: m.centre })
    why = w.locked ?? ''
    // Nothing written: a step back to the press shows the scene the drag started from; one refused (a value that left
    // float32, a size the mod draws as nothing) keeps the last step shown.
    if (w.node === n) {
      if (w.locked) return null
      wrote = false
      return { scene: base, guides }
    }
    const root = replaceAt(base.root, sel.path, w.node)
    if (!root) return null
    wrote = true
    return { scene: { ...base, root }, guides }
  }, { onCommit: () => said(ctx, why, clip, wrote, 'resize'), overlay: guided })
}

function turn(ctx: Ctx, sel: Selection, p: Press): Gesture | null {
  const page = ctx.page(), n = nodeAt(page.scene.root, sel.path)!, f = handleFrame(page.scene, sel.path, page.size, ctx.theme(), page.natives)
  if (lockedAt(page.scene.root, sel.path)) { ctx.note('locked'); return null }
  const W = ctx.view().world(sel.path)   // the node's own frame -> design units
  if (!f || !W) return null
  if (!similar(W)) { ctx.note('the group above scales unevenly: turn that group instead'); return null }
  const sign = W[0] * W[3] - W[1] * W[2] < 0 ? -1 : 1   // a mirror above turns the sense
  const c = { x: f.box.x + f.box.w / 2, y: f.box.y + f.box.h / 2 }, g = foldKey(n.op) === 'G' ? groupMatrix(n.attrs) : null
  const [qx, qy] = g ? apply(g, c.x, c.y) : [c.x, c.y]   // the pivot in the node's own frame
  const [cx, cy] = apply(W, qx, qy), a0 = Math.atan2(p.start.y - cy, p.start.x - cx)
  let why = '', clip: string | null = null, r0: number | null = null, wrote = false, first = true
  const held = nativesUnder(page.scene, page.natives ?? [], [sel.path], ctx.theme()).map(n => n.uid)
  return sceneDrag(ctx, (q, base) => {
    if (first) { first = false; clip = clipAbove(base.root, sel.path); r0 = turnOf(base.root, sel.path) }
    let D = ((Math.atan2(q.at.y - cy, q.at.x - cx) - a0) * 180 / Math.PI + 540) % 360 - 180
    // Shift: the r written lands on a multiple of 15 (a mirror above writes -D); points have no r, so they step from
    // the press.
    if (q.mods.shift) D = r0 === null ? Math.round(D / 15) * 15 : sign * (Math.round((r0 + sign * D) / 15) * 15 - r0)
    else if (!q.mods.mod) D = Math.round(D)
    if (!D) { why = ''; wrote = false; return { scene: base, selection: [sel] } }
    const out = rotate(base.root, sel.path, sign * D, { x: qx, y: qy })
    if (typeof out === 'string') { why = out; return null }   // the last step stays shown
    why = ''
    wrote = out.root !== base.root
    return { scene: { ...base, root: out.root }, selection: [{ ...sel, path: out.path }] }
  }, { onCommit: () => said(ctx, [why, wrote ? uprightNote(held) : ''].filter(Boolean).join('; '), clip, wrote, 'turn') })
}

function transformGesture(ctx: Ctx, set: Selection[], p: Press, handle: Handle | 'rotate', f = setFrame(ctx)): Gesture | null {
  if (!f) return null
  const from = f.box, cx = from.x + from.w / 2, cy = from.y + from.h / 2
  const a0 = Math.atan2(p.start.y - cy, p.start.x - cx)
  const seen = targetsOf(canvasTargets(ctx.page(), ctx.theme(), set), ctx.view().size)
  let skipped: string[] = [], upright: string[] = []
  const held = nativesUnder(ctx.page().scene, ctx.page().natives ?? [], set.filter(s => s.native === undefined).map(s => s.path), ctx.theme()).map(n => n.uid)
  return sceneDrag<Guide>(ctx, (q, base, natives) => {
    let m: Mat, guides: Guide[] = []
    if (handle === 'rotate') {
      let D = ((Math.atan2(q.at.y - cy, q.at.x - cx) - a0) * 180 / Math.PI + 540) % 360 - 180
      if (q.mods.shift) D = Math.round(D / 15) * 15
      else if (!q.mods.mod) D = Math.round(D)
      const angle = D * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
      m = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
    } else {
      const mods = { ratio: q.mods.shift, centre: q.mods.alt }
      let box = dragBox(from, handle, q.at.x - q.start.x, q.at.y - q.start.y, mods)
      if (snapOn(ctx, q.mods)) {
        const snap = snapResize(box, handle, seen, snapOpts(ctx), mods.ratio), travel = travelOf(from, box, handle)
        box = dragBox(from, handle, travel.dx + snap.dx, travel.dy + snap.dy, { ...mods, lead: snap.lead })
        guides = snap.guides
      }
      const sx = from.w ? box.w / from.w : 1, sy = from.h ? box.h / from.h : 1
      m = [sx, 0, 0, sy, box.x - from.x * sx, box.y - from.y * sy]
    }
    const out = transformSet(base, set, ctx.theme(), m)
    const units = shownNativeUnitsOf({ ...ctx.page(), scene: base, natives }, set, ctx.theme()), n = transformNatives(natives, units, out.matrix, ctx.theme())
    skipped = [...out.skipped, ...n.skipped]
    upright = handle === 'rotate' ? [...n.upright, ...(out.scene !== base ? held : [])] : []
    if (out.scene === base && n.natives === natives && skipped.length) return null   // a refused step keeps the last valid drawing
    return { scene: out.scene, ...(units.length && { natives: n.natives }), selection: out.selection, guides }
  }, { onCommit: () => { const note = [...skipped, uprightNote(upright)].filter(Boolean).join('; '); if (note) ctx.note(note) }, overlay: guided })
}

function marquee(ctx: Ctx, keep: Selection[]): Gesture {
  const page = ctx.page(), pageId = page.id
  // Locked and hidden roots are skipped here, not by their spans: the frame shown is one frame late, so it still draws a
  // node just hidden. A widget root is boxed by its params, as its outline and handles are.
  const root = page.scene.root, own = widgetBoxes(page.scene, ctx.theme()), entered = ctx.get().entered
  const path = entered?.pageId === pageId ? entered.path : [], children = path.length ? nodeAt(root, path)?.c ?? [] : root
  const boxes = children.map((n, k) => {
    const at = [...path, k]
    return lockedAt(root, at) || hidden(n) ? null : unitsOf(page.scene, [{ pageId, path: at }], ctx.theme(), page.natives)[0]?.box ?? own(k, n) ?? worldBox(page.scene, at) ?? spanBox(ctx, at)
  })
  const shown = new Set(shownNatives(page, ctx.theme()).map(n => n.uid))
  const nativeUnits = nativeUnitsOf(page, (page.natives ?? []).map(n => ({ pageId, path: [], native: n.uid })), ctx.theme())
    .filter(u => !u.locked && shown.has(u.ref.uid) && (holderOf(page.scene, u.ref, ctx.theme()) ?? []).join() === path.join())
  let rect: Box | null = null
  return {
    move(q) {
      if (!rect && q.css < SLOP) return
      rect = { x: Math.min(q.start.x, q.at.x), y: Math.min(q.start.y, q.at.y), w: Math.abs(q.at.x - q.start.x), h: Math.abs(q.at.y - q.start.y) }
      choose(ctx, [...keep, ...marqueeHits(boxes, rect, q.mods.mod).map(k => ({ pageId, path: [...path, k] })),
        ...marqueeHits(nativeUnits.map(u => u.box), rect, q.mods.mod).map(k => nativeUnits[k].sel)])
      ctx.redraw()
    },
    up() {
      if (!rect && ctx.get().entered) { ctx.dispatch({ type: 'enter', pageId, path: [] }); choose(ctx, keep) }
      rect = null
      return false
    },
    cancel() { rect = null; choose(ctx, keep) },
    overlay(o) {
      if (!rect) return null
      const a = o.view.css(rect), b = o.view.css({ x: rect.x + rect.w, y: rect.y + rect.h })
      return <svg className="vb-marquee" aria-hidden="true"><rect x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} /></svg>
    },
  }
}

const select: Tool = {
  kind: 'tool', id: 'select', label: 'Select', order: 0, key: 'V', handles: true,
  down(p, ctx) {
    const pick = (deep = false) => {
      const { target, enter } = ctx.pick(p.px, deep)
      if (enter) ctx.dispatch(enter)
      return target
    }
    const page = ctx.page(), set = selected(ctx.get()).filter(x => x.pageId === page.id)
    const one = set.length === 1 && !set[0].inDefs ? set[0] : null
    if (set.length > 1 && ctx.frame()?.elements.some(e => e.id === SCENE_ELEMENT && e.scene === page.id)) {
      const f = setFrame(ctx), h = setHandleAt(ctx, p.px, f)
      if (h) return transformGesture(ctx, set, p, h, f)
    }
    const deepHit = p.mods.mod ? pick(true) : null
    if (deepHit && !ctx.get().selection) choose(ctx, [deepHit])
    if (one && one.native === undefined && !p.mods.mod && p.clicks >= 2 && enterable(page.scene, one.path, ctx.theme())) {
      const hit = pick()
      if (hit && sameSelection(hit, one)) {
        ctx.dispatch({ type: 'enter', pageId: page.id, path: one.path })
        choose(ctx, [pick()].filter((x): x is Selection => !!x))
        return null
      }
    }
    if (one) {
      // Handles take a press only while Selection draws them: over a frame that shows this page (none before the first
      // frame, nor while another page's frame is still shown).
      const shown = !!ctx.frame()?.elements.some(e => e.id === SCENE_ELEMENT && e.scene === page.id)
      const inside = deepHit && !sameSelection(deepHit, one) && within(ctx, deepHit, one)
      const h = shown && !inside ? handleAt(page.scene, one, page.size, ctx.view().zoom, p.px, ctx.theme(), page.natives) : null
      if (h === 'rotate') return widgetAt(page.scene, one.path, ctx.theme()) ? transformGesture(ctx, [one], p, h) : turn(ctx, one, p)
      if (h) return resize(ctx, one, h)
      const n = one.native === undefined ? nodeAt(page.scene.root, one.path) : null
      if (p.clicks >= 2 && n && hasPoints(n)) { ctx.setTool('points'); return null }
    }
    const hit = p.mods.mod ? deepHit : pick(), member = hit ? set.find(x => p.mods.mod && !(p.mods.shift && hit.native !== undefined) ? sameSelection(hit, x) : within(ctx, hit, x)) : undefined
    if (p.mods.shift) {
      if (!hit) return marquee(ctx, set)
      const rest = set.filter(x => x !== member)
      choose(ctx, member && sameSelection(member, hit) ? rest : [...rest, hit])
      return null
    }
    if (!hit) { choose(ctx, []); return marquee(ctx, []) }
    if (!member || !ctx.get().selection) choose(ctx, [hit])
    return move(ctx, member ? hit : null)
  },
  overlay: (ctx, o) => <SetOutlines ctx={ctx} o={o} />,
}
export default select
