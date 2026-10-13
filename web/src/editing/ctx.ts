// The one context every tool and command gets, over App's store, checker, frame and status line. It also keeps each
// page's numbering (orderOf) and withholds it while a structural edit waits for its check, so a pick or a span outline
// never pairs a new tree with an old numbering (sameNumbering below). The frame shown can still be of an older shape (App
// sends nothing while any page is not clean, and a sent patch shows from the next frame asked for): App also withholds it
// then, for the pick, the outline and the marquee's spans, by the scene each frame was drawn from (shownOrder, pick.ts).
import { apply, designSize, unview, viewbox } from '../editor/geometry'
import type { Order } from '../model/numbering'
import type { Page } from '../model/project'
import type { Scene, SrcNode, Value } from '../model/scene'
import { nodeAt, sameData, selected, snap, type Action, type Selection, type State } from '../model/store'
import type { Frame } from '../runtime/frame'
import { orderOf, type SceneChecker } from '../srctext/checker'
import { first, foldKey } from '../srctext/props'
import { themeOf } from '../theme'
import { widgetAt } from '../widgets/core'
import { worldOf } from './bounds'
import { enterable, enterablePath, nativeTarget, pickAt } from './depth'
import { holderOf, nativeHitAt } from './natives'
import { loadDrawDefaults, loadSettings, saveDrawDefaults, saveSettings, withSettings } from './settings'
import type { Ctx, Pt } from './types'
import type { Viewport } from './view'

export type CtxDeps = {
  get(): State
  dispatch(a: Action): void
  checker(): SceneChecker | null
  frame(): Frame | null
  /** The node under a surface point: App's is pickNode (pick.ts) over the frame shown; tests hand in their own. */
  pick(px: Pt): Selection | null
  redraw(): void
  note(text: string): void
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null   // settings; absent: localStorage
}
/** What the router needs beyond Ctx. */
export type EditorCtx = Ctx & { setView(v: Viewport): void; onTool(f: (id: string) => void): void }

/**
 * What the numbering hangs on is the same: the ops and child counts at every level, each USE's ref and each SYM's id
 * (what a USE expands) and, where `reads` names an argument a %param reads (paramsOf), that attribute of each USE (an
 * argument) and SYM (a default). Identical objects are skipped, so a drag step costs its path; a drag moves no ref, no
 * id and, unless a symbol reads its offset, no argument. Explicit stack.
 */
export function sameShape(a: readonly SrcNode[], b: readonly SrcNode[], reads?: (key: string) => boolean): boolean {
  const args = (n: SrcNode) => Object.entries(n.attrs).filter(([k]) => reads!(k))
  const stack: [readonly SrcNode[], readonly SrcNode[]][] = [[a, b]]
  for (let top = stack.pop(); top; top = stack.pop()) {
    const [x, y] = top
    if (x === y) continue
    if (x.length !== y.length) return false
    for (let i = 0; i < x.length; i++) {
      const m = x[i], n = y[i]
      if (m === n) continue
      if (m.op !== n.op || !m.c !== !n.c) return false
      const op = foldKey(m.op), key = op === 'USE' ? 'REF' : op === 'SYM' ? 'ID' : null
      if (key && (!sameData(first(m, key), first(n, key)) || reads && !sameData(args(m), args(n)))) return false
      if (m.c && n.c) stack.push([m.c, n.c])
    }
  }
  return true
}

/** Whether a numbering made for scene `a` numbers scene `b` too: the root and DEFS keep their shape (sameShape, reading
 *  the arguments b's %params name). False without `a`. */
export function sameNumbering(a: Scene | undefined, b: Scene): boolean {
  const reads = paramsOf(b.defs)
  return !!a && sameShape(a.root, b.root, reads) && sameShape(a.defs, b.defs, reads)
}

// Which arguments can change what the mod parses: those a %param in DEFS names, as validate.ts's substitute reads them
// (`%name`, any case, alone or spliced into text). Only an op and a USE's attributes are substituted, and only an op, a
// USE's ref and a nested USE's arguments (its attributes) change the parse, so those are the texts read. Undefined when
// none holds a %. Kept per DEFS list, which an edit elsewhere leaves as it was. Explicit stacks.
const params = new WeakMap<readonly SrcNode[], ((key: string) => boolean) | undefined>()
export function paramsOf(defs: readonly SrcNode[]): ((key: string) => boolean) | undefined {
  if (params.has(defs)) return params.get(defs)
  const texts: string[] = []
  for (const todo = [...defs]; todo.length;) {
    const n = todo.pop()!, values: Value[] = [n.op, ...(foldKey(n.op) === 'USE' ? Object.values(n.attrs) : [])]
    while (values.length) {
      const v = values.pop()!
      if (Array.isArray(v)) for (const x of v) values.push(x)
      else if (typeof v === 'string' && v.includes('%')) texts.push(foldKey(v))
    }
    for (const c of n.c ?? []) todo.push(c)
  }
  const reads = texts.length ? (key: string) => { const k = '%' + foldKey(key); return texts.some(t => t.includes(k)) } : undefined
  params.set(defs, reads)
  return reads
}

/** The numbering a frame of page p is read through (the pick, the selection's outline, the marquee's spans): `o`,
 *  ctx.order(), only while the scene the frame was drawn from numbers alike (Frame.drawnFrom, the bridge's: what p's
 *  surface was last loaded or patched with when the frame was asked for). Otherwise a structural edit's numbering would
 *  name nodes of a tree the frame was not drawn from (editing/pick.ts): while any page is not clean (an error, too large
 *  to check here, a check pending) nothing is sent, and after an edit, an undo or a load is sent, the frames asked for
 *  before it show the old tree. */
export const shownOrder = (f: Frame | null, p: Page, o: Order | undefined) =>
  o && sameNumbering(f?.drawnFrom as Scene | undefined, p.scene) ? o : undefined

/** An Edit's selection as the store's action fields. */
export const selectionOf = (s?: readonly Selection[]) =>
  s === undefined ? {} : { selection: s[s.length - 1] ?? null, also: s.slice(0, -1) }

/** The set's members a multi-node command acts on: on the active page, in the root tree (a DEFS node is none, nor a
 *  native widget, M2b T9: it lives in the page, not the scene). Delete, which takes DEFS nodes and natives too, and the
 *  set's own readers (the outlines, Esc, ungroup's when) filter selected() themselves. Missing paths are not members. */
export const membersOf = (ctx: Ctx): Selection[] => selected(ctx.get()).filter(x => x.pageId === ctx.page().id && !x.inDefs && x.native === undefined
  && nodeAt(ctx.page().scene.root, x.path))

/** The active page's selected native uids; scene readers keep using membersOf. */
export const nativeMembersOf = (ctx: Ctx): Selection[] => {
  const page = ctx.page(), uids = new Set((page.natives ?? []).map(n => n.uid))
  return selected(ctx.get()).filter(x => x.pageId === page.id && !x.inDefs && x.native !== undefined && uids.has(x.native))
}

const SNAP_PX = 8   // CSS px: the object-snap distance (spec §4)

export function makeCtx(d: CtxDeps): EditorCtx {
  let viewport: Viewport = { zoom: 1, pan: { x: 0, y: 0 } }, tool = 'select', settings = loadSettings(d.storage), drawDefaults = loadDrawDefaults(d.storage)
  // The numbering, and the scene it was made for, per page. ponytail: an entry stays after its page is removed (a few
  // per project); prune them if projects ever hold hundreds of pages.
  const orders = new Map<string, Order>(), clean = new Map<string, Scene>(), hooks: ((id: string) => void)[] = []
  const ctx: EditorCtx = {
    get: d.get, dispatch: d.dispatch, checker: d.checker, frame: d.frame, redraw: d.redraw, note: d.note,
    page() { const s = d.get(); return s.project.pages.find(p => p.id === s.activePageId) ?? s.project.pages[0] },
    theme: () => themeOf(d.get().project),
    view() {
      const { zoom, pan } = viewport
      const page = ctx.page(), unit = viewbox(page.scene.header, page.size), inv = unview(unit)
      const k = zoom * Math.min(Math.abs(unit[0]), Math.abs(unit[3]))
      return {
        zoom, pan, size: designSize(page.scene.header), unit,
        toUnits: p => { const [x, y] = apply(inv, p.x, p.y); return { x, y } },
        css: u => { const [x, y] = apply(unit, u.x, u.y); return { x: x * zoom, y: y * zoom } },
        world: path => worldOf(page.scene, path),
        threshold: k > 0 ? SNAP_PX / k : 0,
      }
    },
    pick(px, deep = false, o = {}) {
      const state = d.get(), page = ctx.page(), t = ctx.theme(), native = o.natives === false ? null : nativeHitAt(page, t, px)
      if (native) {
        const P = holderOf(page.scene, native, t) ?? [], E = state.entered?.pageId === page.id ? state.entered.path : []
        let target: Selection = { pageId: page.id, ...nativeTarget(native.uid, P, E, deep) }
        if (!deep) {
          const own = selected(state).find(x => x.pageId === page.id && !x.inDefs && x.native === native.uid)
          const depth = target.native === undefined ? target.path.length : P.length + 1
          const member = selected(state).find(x => x.pageId === page.id && !x.inDefs && x.native === undefined
            && x.path.length > depth && x.path.every((k, i) => P[i] === k))
          if (own || member) target = own ?? member!
        }
        const path = deep ? enterablePath(page.scene, P, t) : E.every((k, i) => P[i] === k) ? E : []
        return { target, ...(path.join() !== E.join() && { enter: { type: 'enter' as const, pageId: page.id, path } }) }
      }
      const s = d.get(), hit = snap(s, d.pick(px))
      if (o.natives === false && hit?.native !== undefined) return { target: null }
      if (!hit || hit.inDefs || hit.native !== undefined) return { target: hit }
      const entered = s.entered?.pageId === hit.pageId ? s.entered.path : []
      const picked = pickAt(hit, entered, deep, ctx.page().scene, ctx.theme())
      // A panel or restored selection can be deeper than the entered group; a plain press keeps that member.
      if (!deep && !(entered.length && widgetAt(ctx.page().scene, entered, ctx.theme()))) {
        const member = selected(s).find(x => x.pageId === hit.pageId && !x.inDefs && x.native === undefined
          && x.path.every((k, i) => hit.path[i] === k))
        if (member && member.path.length > picked.path.length) return { target: member }
      }
      let path = entered
      if (deep) {
        path = hit.path.slice(0, -1)
        while (path.length && !enterable(ctx.page().scene, path, ctx.theme())) path = path.slice(0, -1)
      } else if (!entered.every((k, i) => hit.path[i] === k) || hit.path.length <= entered.length) path = []
      return { target: picked, ...(path.join() !== entered.join() && { enter: { type: 'enter' as const, pageId: hit.pageId, path } }) }
    },
    // Valid while the root and DEFS keep the shape of the last clean scene (sameShape): the numbering counts root nodes
    // and what each USE expands from DEFS. A loaded project's page of the same id and shape gets the same numbering,
    // which is right.
    order() {
      const page = ctx.page(), c = d.checker()?.get(page.scene), order = orderOf(orders, page.id, c)
      if (c?.src != null) clean.set(page.id, page.scene)
      return order && sameNumbering(clean.get(page.id), page.scene) ? order : undefined
    },
    settings: () => settings,
    drawDefaults: () => drawDefaults,
    setDrawDefaults(s) {
      drawDefaults = s
      const saved = saveDrawDefaults(s, d.storage)
      if (!saved) d.note('draw defaults kept for this session only: browser storage is unavailable')
      return saved
    },
    setSettings(s) {
      settings = withSettings(settings, s)   // held to what loading reads back: a grid of 7.6 is 8 now, not after a reload
      saveSettings(settings, d.storage)
      d.redraw()
    },
    async apply(e, o = {}) {
      const page = ctx.page(), base = page.scene
      const land = () => { d.dispatch({ type: 'editScene', pageId: page.id, scene: e.scene, ...(e.natives !== undefined && { natives: e.natives }), ...selectionOf(e.selection) }); return null }
      if (!o.check) return land()
      const say = (why: string) => { d.note(why); return why }
      const checker = d.checker()
      if (!checker) return say('the checker is not ready; not applied')
      const c = await checker.check(e.scene)
      // A scene of the same content is no change: a nudge burst that nets to nothing hands back the project it began from.
      const now = ctx.page()
      if (now.id !== page.id || now.scene !== base && !sameData(now.scene, base)) return say('the scene changed while this was checked; not applied')
      if (e.natives !== undefined && now.natives !== page.natives && !sameData(now.natives ?? [], page.natives ?? [])) return say('the natives changed while this was checked; not applied')
      // Too large to check here is no verdict on the scene: it lands, its reason said as information (M2b final-wave
      // ruling 1); the preview keeps the last scene it showed.
      if (c.tooLarge) d.note(c.errors[0].message)
      else if (c.errors.length) return say(c.errors[0].message)
      return land()   // the checked object: the checker's cache keeps its hit
    },
    clip: { text: null, page: '', pasted: 0, at: [], style: null },
    tool: () => tool,
    setTool(id) {
      if (id === tool) return
      tool = id
      for (const f of hooks) f(id)
      d.redraw()
    },
    setView(v) { viewport = v },
    onTool(f) { hooks.push(f) },
  }
  return ctx
}
