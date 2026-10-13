// One gesture = one undo step (spec §4): transient editScene steps, then commitDrag on release, or cancelDrag
// on Esc or a cancelled pointer. Each step is rebuilt from the scene at the first move with the total travel, so nothing
// drifts. Nothing is written before the slop; a release before it is a click.
import type { ReactNode } from 'react'
import type { Scene } from '../model/scene'
import { sameData } from '../model/same'
import type { NativeRef } from '../widgets/types'
import { selectionOf } from './ctx'
import type { Ctx, Edit, Gesture, Mods, OverlayCtx, Press } from './types'

export const SLOP = 3   // CSS px a press travels before it drags (M1)

/** Whether a gesture snaps now: snapping on in the settings and Ctrl/Cmd not held (ruling R5). */
export const snapOn = (ctx: Ctx, mods: Mods) => ctx.settings().snap && !mods.mod
/** snap.ts's options for this view: the threshold (8 CSS px) and the grid step, in design units. */
export const snapOpts = (ctx: Ctx) => ({ threshold: ctx.view().threshold, grid: ctx.settings().grid })

/**
 * A press-drag-release gesture over the active page. `build` gets the scene and natives at the first move past the slop
 * and the press's total travel; null writes nothing. If the page's scene or natives are no longer the ones this gesture
 * last wrote, or before its first write the ones it started from (a code-pane flush, an undo), it commits
 * what it wrote and stops (M1's rule). A drag that ends where it began leaves no undo step (the store's commitDrag).
 * G: the guide type `build` returns and `overlay` draws.
 */
export function sceneDrag<G = never>(ctx: Ctx, build: (p: Press, base: Scene, natives: NativeRef[]) => (Edit & { guides?: G[] }) | null,
  o: { onClick?: (p: Press) => void; onCommit?: () => void; overlay?: (oc: OverlayCtx, guides: G[]) => ReactNode } = {}): Gesture {
  const pageId = ctx.page().id
  let base: Scene | null = null, last: Scene | null = null, guides: G[] = [], done = false
  let baseNatives: NativeRef[] | undefined, lastNatives: NativeRef[] | undefined
  const empty: NativeRef[] = []
  const stop = (type: 'commitDrag' | 'cancelDrag') => {
    if (done) return
    done = true
    guides = []
    if (last) ctx.dispatch({ type })
    if (type === 'commitDrag' && base) o.onCommit?.()   // a release after a drag, written or not (a locked handle says why)
  }
  return {
    move(p) {
      if (done || (!base && p.css < SLOP)) return
      // The scene it last wrote, or before its first write the one it started from: anything else is another edit.
      const page = ctx.page(), seen = last ?? base
      if (page.id !== pageId || (seen && (page.scene !== seen || page.natives !== (last ? lastNatives : baseNatives)))) return stop('commitDrag')
      if (!base) { base = page.scene; baseNatives = page.natives }
      const e = build(p, base, baseNatives ?? empty)
      if (!e) return   // a step refused: the last one shown stays, with its guides
      if (!last && e.scene === base && (e.natives === undefined || sameData(e.natives, baseNatives ?? empty))) {   // no write yet: a snap's guides show
        const g = e.guides ?? []
        if (g.length || guides.length) { guides = g; ctx.redraw() }
        return
      }
      guides = e.guides ?? []
      ctx.dispatch({ type: 'editScene', pageId, scene: e.scene, ...(e.natives !== undefined && { natives: e.natives }), ...selectionOf(e.selection), transient: true })
      last = ctx.page().scene
      lastNatives = ctx.page().natives
    },
    up(p) {
      if (!base && !done) o.onClick?.(p)
      stop('commitDrag')
      return false
    },
    cancel: () => stop('cancelDrag'),
    overlay: oc => !done && guides.length > 0 && o.overlay ? o.overlay(oc, guides) : null,
  }
}
