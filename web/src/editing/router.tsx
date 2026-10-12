// The canvas's pointer and the document's keys, routed (spec §4): a press goes to the active tool, which may open a
// gesture that gets every move and the release (a multi-click tool: the next clicks too); a key goes to the open gesture
// (Esc cancels it; a Ctrl/Cmd chord it does not use goes on past an open multi-click one), else to the first command
// bound to it whose `when` holds, else it picks the tool with that key.
// Esc's order: the gesture, then the active tool (tool.leave), then the selection (select.parent) (ruling P12).
import type { ReactNode } from 'react'
import { ownsDelete, ownsKeys } from '../keys'
import type { Frame } from '../runtime/frame'
import type { EditorCtx } from './ctx'
import { commandFor, keyName, runCommand, TOOLS } from './registry'
import type { Gesture, Press, Pt, View } from './types'

export type Router = {
  busy(): boolean
  pointer(kind: 'down' | 'move' | 'up', x: number, y: number, ev: PointerEvent): void
  key(e: KeyboardEvent): void
  overlay(o: { zoom: number; pan?: Pt; frame: Frame | null }): ReactNode
}

/** A key without Ctrl/Cmd acts only with the focus on the page itself or in the canvas: a focused button, select or
 *  checkbox keeps its arrows, Space, Enter and letters. */
const plainOk = (t: EventTarget | null, key: string) => !(t instanceof Element) || t === document.body || t.closest('.vb-canvas') !== null
  || t instanceof HTMLButtonElement && t.matches('[aria-expanded="false"]') && t.parentElement?.matches('[role="menubar"]')
    && TOOLS.some(tool => tool.key === key) && !document.querySelector('[role="menu"], dialog[open]')

/** Whether text the page shows is selected outside the canvas (the status line's, say): the browser's own copy and cut of
 *  it keep Mod+C and Mod+X. A selection left in the code pane after it lost the focus is not: there the keys are the
 *  editor's, as with any key outside a text field. */
function textSelected(): boolean {
  const s = typeof getSelection === 'function' ? getSelection() : null
  if (!s || s.isCollapsed || !s.rangeCount) return false
  const at = s.anchorNode, el = at instanceof Element ? at : at?.parentElement
  return !!el && !el.closest('.vb-canvas') && !(el instanceof HTMLElement && el.isContentEditable)
}

/** Faint grid lines every `step` design units, when they are at least 4 CSS px apart. */
function Grid({ view, step }: { view: View; step: number }) {
  const a = view.css({ x: 0, y: 0 }), b = view.css({ x: step, y: step }), w = b.x - a.x, h = b.y - a.y
  if (!(step > 0) || w < 4 || h < 4) return null
  const end = view.css({ x: view.size.w, y: view.size.h })
  return <svg className="vb-grid" aria-hidden="true">
    <defs><pattern id="vb-grid" x={a.x} y={a.y} width={w} height={h} patternUnits="userSpaceOnUse"><path d={`M${w} 0V${h}H0`} /></pattern></defs>
    <rect x={a.x} y={a.y} width={end.x - a.x} height={end.y - a.y} fill="url(#vb-grid)" />
  </svg>
}

const DOUBLE_MS = 500, DOUBLE_PX = 4   // a press this soon after the last one and this close (CSS px) is its double click

export function makeRouter(ctx: EditorCtx): Router {
  let gesture: Gesture | null = null, open = false, pointerId = -1, pointerType = ''
  // The press of the pointer down now: set by every press taken, cleared by its release (null between the clicks of a
  // multi-click gesture), so a release whose press was not taken is not mistaken for one.
  let press: { at: Pt; cx: number; cy: number } | null = null
  let last: { t: number; cx: number; cy: number; n: number } | null = null   // the last press: the click count
  // The active page and the history an open multi-click gesture (a polyline, polygon or curve being drawn) last left,
  // taken after each call into it. A page switch, a load, an undo or redo, or an edit from the code pane or the panel
  // moves one of them without the router; the gesture's own commit ends it. Then its next click would draw on a page it
  // no longer sees: it is cancelled. The history is compared by `past` alone: every edit, undo, redo and load makes a
  // new one (and a new `future`), a transient step keeps it.
  let seen: { page: string; past: unknown } | null = null
  const remember = () => { const s = ctx.get(); seen = gesture && open ? { page: s.activePageId, past: s.past } : null }
  const running = new Set<string>()   // the commands a key ran whose run has not settled (a checked edit in flight)
  const stale = () => { const s = ctx.get(); return !!gesture && open && !!seen && (s.activePageId !== seen.page || s.past !== seen.past) }
  const active = () => TOOLS.find(t => t.id === ctx.tool()) ?? TOOLS.find(t => t.id === 'select')!
  const drop = () => {
    if (open) last = null   // the press that ended a multi-click gesture is no double click's first half
    gesture = null; open = false; press = null; seen = null
  }
  const cancel = () => { const g = gesture; drop(); g?.cancel(); ctx.redraw() }
  ctx.onTool(() => { if (gesture) cancel() })
  const toPress = (x: number, y: number, ev: PointerEvent): Press => {
    const px = { x, y }, at = ctx.view().toUnits(px)
    return { at, px, start: press?.at ?? at, css: press ? Math.hypot(ev.clientX - press.cx, ev.clientY - press.cy) : 0,
      mods: { shift: ev.shiftKey, alt: ev.altKey, mod: ev.ctrlKey || ev.metaKey }, clicks: last?.n ?? 1 }
  }
  return {
    busy: () => press !== null || gesture !== null,
    pointer(kind, x, y, ev) {
      if (stale()) cancel()
      // A point the canvas cannot place (a canvas of no size divides by a zoom of 0) reaches no tool; the release of a
      // press held there cancels its gesture, as a pointercancel does.
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        if (kind === 'up' && gesture && press && ev.pointerId === pointerId) cancel()
        return
      }
      if (kind === 'down') {
        // A second pointer while one is pressed (a second finger, a pen beside the mouse) is ignored, as M1 did. A primary
        // pointer of the pressing one's type is not a second one: a type has one primary pointer at a time, so the
        // pressing one ended without its release reaching here (the canvas stopped reporting mid-press), and its gesture
        // is cancelled below.
        const second = gesture && !open && ev.pointerId !== pointerId && !(ev.isPrimary && ev.pointerType === pointerType)
        if (ev.button !== 0 || second) return
        pointerId = ev.pointerId
        pointerType = ev.pointerType
        const n = last && ev.timeStamp - last.t <= DOUBLE_MS && Math.hypot(ev.clientX - last.cx, ev.clientY - last.cy) <= DOUBLE_PX ? last.n + 1 : 1
        last = { t: ev.timeStamp, cx: ev.clientX, cy: ev.clientY, n }
        press = { at: ctx.view().toUnits({ x, y }), cx: ev.clientX, cy: ev.clientY }
        ctx.note('')
        if (gesture && open) { gesture.down?.(toPress(x, y, ev)); return remember() }
        if (gesture) cancel()   // a gesture whose release never came: its edit goes
        if (ctx.get().dragBase) ctx.dispatch({ type: 'commitDrag' })   // a nudge burst still open keeps its own step
        gesture = active().down(toPress(x, y, ev), ctx)
        open = false
        return
      }
      if (!gesture || ev.pointerId !== pointerId) return   // only the pointer that pressed (M1)
      if (kind === 'move') { gesture.move(toPress(x, y, ev)); return remember() }
      // The release of a press not taken (another button): an open multi-click gesture never hears it (the canvas
      // reports one release for every press it saw).
      if (!press) return
      if (ev.type === 'pointercancel') return cancel()
      if (gesture.up(toPress(x, y, ev))) { open = true; press = null }   // hover moves of a multi-click gesture measure from no press
      else drop()
      remember()
      ctx.redraw()   // an overlay drawn from the gesture's own state changes with it, written or not
    },
    key(e) {
      if (e.target instanceof Element && e.target.closest('.vb-taskbar')) return
      if (stale()) cancel()
      if (e.defaultPrevented || ownsKeys(e.target)) return
      const mod = e.ctrlKey || e.metaKey, name = keyName(e)
      // Plain keys act with the focus on the page or the canvas; Delete wherever M2b T8 lets it (ownsDelete: not in a form
      // control, a button or a panel; a native's placeholder leaves it to the editor).
      if (!mod && !plainOk(e.target, name) && !(name === 'Delete' && !ownsDelete(e.target))) return
      if (gesture) {
        if (name === 'Escape') { e.preventDefault(); return cancel() }
        const used = gesture.key?.(name)
        if (used) e.preventDefault()
        if (used === 'done') { drop(); ctx.redraw() }
        // Every other key waits for the gesture to end, but a Ctrl/Cmd chord goes on past an open multi-click gesture to
        // its command (Redo, Select all…); one that moves the page or the history ends the gesture, as any edit does.
        if (used || !open || !mod) return remember()
      }
      if ((name === 'Mod+C' || name === 'Mod+X') && textSelected()) return
      const c = commandFor(name, ctx)
      if (c) {
        e.preventDefault()
        // A held key's repeat waits for its command's last run to settle: a checked edit still in flight would see the
        // scene its first run changes, and refuse ('the scene changed while this was checked').
        if (e.repeat && (c.once || running.has(c.id))) return
        running.add(c.id)
        void runCommand(c, ctx).finally(() => running.delete(c.id))
        if (stale()) cancel()
        return
      }
      const t = !mod && !e.altKey ? TOOLS.find(x => x.key === name) : undefined
      if (t) {
        e.preventDefault()
        ctx.setTool(t.id)
      }
    },
    overlay(o) {
      ctx.setView({ zoom: o.zoom, pan: o.pan ?? { x: 0, y: 0 } })
      // A render is where a change from outside first shows. The gesture goes now, so nothing of it is drawn; its cancel
      // (a store write, for a gesture that wrote: a drawn shape writes nothing until it ends) waits for the render to end.
      if (stale()) { const g = gesture!; drop(); queueMicrotask(() => { g.cancel(); ctx.redraw() }) }
      const oc = { ...o, view: ctx.view() }
      return <>
        <Grid view={oc.view} step={ctx.settings().grid} />
        {active().overlay?.(ctx, oc)}
        {gesture?.overlay?.(oc)}
      </>
    },
  }
}
