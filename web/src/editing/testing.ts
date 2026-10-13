// Test helpers for the editing layer, imported by tests only.
import { SCENE_ELEMENT } from '../codegen/lua'
import { newProject } from '../model/project'
import type { Scene } from '../model/scene'
import { initialState, reducer, type Action, type Selection, type State } from '../model/store'
import { decodeFrame, type Frame } from '../runtime/frame'
import { vbf1 } from '../runtime/testing'
import type { Checked } from '../srctext/check'
import { SceneChecker } from '../srctext/checker'
import { checkWorkers } from '../srctext/testing'
import { makeCtx } from './ctx'
import { makeRouter } from './router'
import type { Pt } from './types'
import type { NativeRef } from '../widgets/types'

/** double: this press comes 100 ms after the previous one (the router counts a double click when it is also at the same
 *  spot); any other press comes 1000 ms later, so two clicks in a test are never a double click by accident. */
type Mods = { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; double?: boolean }

/**
 * The real store with `scene` on page p1 (a 460 x 460 surface: a 460 x 460 header is one design unit per px), a ctx at
 * zoom 1 with default settings, and a router. pick: what a press hits (default nothing); verdict: the fake checker's
 * answer (default the real check); frame: the frame on the canvas (default one that shows every page, drawing nothing).
 * Pointer helpers take surface px, which are also client px here; pointer 1.
 */
export function harness(scene: Scene, o: { pick?: (px: Pt) => Selection | null; sel?: Selection | null; also?: Selection[];
  verdict?: (s: Scene) => Checked; frame?: () => Frame | null; natives?: NativeRef[] } = {}) {
  const p = newProject()
  p.theme = 'vanilla-plus'
  p.pages[0] = { ...p.pages[0], scene, ...(o.natives !== undefined && { natives: o.natives }) }
  let state: State = { ...initialState(p), selection: o.sel ?? null, also: o.also ?? [] }
  const actions: Action[] = [], notes: string[] = []
  let status = '', redraws = 0
  const checker = new SceneChecker(checkWorkers(o.verdict).make)
  const shown = () => decodeFrame(vbf1(JSON.stringify({ elements: state.project.pages.map(p => ({ id: SCENE_ELEMENT, scene: p.id, x: 0, y: 0,
    w: p.size.w, h: p.size.h, firstVertex: 0, vertexCount: 0 })), text: [], problems: [] })))
  const ctx = makeCtx({ get: () => state, dispatch: a => { actions.push(a); state = reducer(state, a) }, checker: () => checker,
    frame: o.frame ?? shown, pick: px => o.pick?.(px) ?? null, redraw: () => { redraws++ }, note: t => { status = t; if (t) notes.push(t) },
    storage: null })
  ctx.setView({ zoom: 1, pan: { x: 0, y: 0 } })
  const router = makeRouter(ctx)
  let now = 0   // the events' timeStamp, ms
  const ev = (type: string, at: Pt, m: Mods = {}) => ({ type, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0,
    clientX: at.x, clientY: at.y, timeStamp: now, shiftKey: !!m.shiftKey, altKey: !!m.altKey, ctrlKey: !!m.ctrlKey,
    metaKey: !!m.metaKey }) as unknown as PointerEvent
  const h = {
    ctx, router, checker, actions, notes,
    /** The status line now ('' once cleared), and how often the ctx asked for a render. */
    status: () => status, redraws: () => redraws,
    state: () => state, scene: () => state.project.pages[0].scene, root: () => state.project.pages[0].scene.root,
    down: (at: Pt, m?: Mods) => { now += m?.double ? 100 : 1000; router.pointer('down', at.x, at.y, ev('pointerdown', at, m)) },
    move: (at: Pt, m?: Mods) => router.pointer('move', at.x, at.y, ev('pointermove', at, m)),
    up: (at: Pt, m?: Mods) => router.pointer('up', at.x, at.y, ev('pointerup', at, m)),
    drag(from: Pt, to: Pt, m?: Mods) { h.down(from, m); h.move(to, m); h.up(to, m) },
    click(at: Pt, m?: Mods) { h.down(at, m); h.up(at, m) },
    /** A keydown through the router; happy-dom tests only (KeyboardEvent). */
    key(init: KeyboardEventInit) { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); router.key(e); return e },
    /** Lets checked applies land: the fake worker answers on a microtask. */
    settle: () => new Promise<void>(r => setTimeout(r, 0)),
  }
  return h
}
