// Native membership and page-space boxes. Pure: no store, clipboard or command dependencies.
import { apply, invert, keep, mul, unview, viewbox, type Box, type Mat } from '../editor/geometry'
import { withAttr } from '../editor/fields'
import { nodeAt, replaceAt } from '../model/tree'
import { first, foldKey, textOf } from '../srctext/props'
import { nativesOf, sanitize, takenUids, widgetOf, widgetsIn } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import { hidden, IDENTITY, worldOf } from './bounds'
import { answersTo, readsPointer } from './scope'
import type { Page, Project } from '../model/project'
import type { Scene, SrcNode } from '../model/scene'
import type { Selection } from '../model/store'
import type { Theme } from '../theme'
import type { NativeEl, NativeRef } from '../widgets/types'
import type { Pt } from './types'
import { idsFrom, idsOf, lockedAt, named, onPath, type Ids } from './tree'
import { FLOAT32 } from './transform'
export function holders(scene: Scene, ids: Iterable<string>, t: Theme): Map<string, number[]> {
  const pending = new Set(ids), found = new Map<string, number[]>(), path: number[] = []
  const stack = [{ list: scene.root, k: 0, ordinary: true }]
  while (stack.length && pending.size) {
    const f = stack[stack.length - 1]
    if (f.k === f.list.length) { stack.pop(); path.pop(); continue }
    const n = f.list[f.k], id = textOf(first(n, 'ID'))
    path.push(f.k++)
    const ordinary = f.ordinary && foldKey(n.op) === 'G' && !widgetOf(n, t)
    if (id !== undefined && pending.delete(id) && ordinary) found.set(id, [...path])
    if (n.c?.length) stack.push({ list: n.c, k: 0, ordinary })
    else path.pop()
  }
  return found
}
/** Only ordinary G chains, including the node itself, hold natives. */
export function canHold(scene: Scene, path: number[], t: Theme): boolean {
  if (!path.length) return false
  let list: SrcNode[] | undefined = scene.root
  for (const k of path) {
    const n: SrcNode | undefined = list?.[k]
    if (!n || foldKey(n.op) !== 'G' || widgetOf(n, t)) return false
    list = n.c
  }
  return true
}
export const holderOf = (scene: Scene, native: NativeRef, t: Theme): number[] | null =>
  native.group ? holders(scene, [native.group], t).get(native.group) ?? null : null
/** The holder's child frame, even for an empty group. */
export function innerFrame(scene: Scene, path: number[]): Mat | null {
  if (!nodeAt(scene.root, path)) return null
  const frame = worldOf(scene, [...path, 0])
  return frame && invert(frame) ? frame : null
}
/** Carry the centre and column lengths, retaining the upright box and no-op identity. */
export function carry(ref: NativeRef, from: Mat, to: Mat, t: Theme): NativeRef {
  const inv = invert(from), mod = WIDGETS[ref.type]
  if (!inv || !invert(to) || !mod?.native) return ref
  const m = mul(to, inv)
  if (m.every((v, i) => Math.abs(v - IDENTITY[i]) <= 1e-9 * Math.max(1, Math.abs(v)))) return ref
  const p = sanitize(mod, ref.params, t), x = Number(p.x), y = Number(p.y), w = Number(p.w), h = Number(p.h)
  const [cx, cy] = apply(m, x + w / 2, y + h / 2), sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3])
  const box = { x: keep(x, cx - w * sx / 2), y: keep(y, cy - h * sy / 2), w: keep(w, w * sx), h: keep(h, h * sy),
    ...(ref.type === 'textinput' && { fontSize: keep(Number(p.fontSize), Number(p.fontSize) * sy) }) }
  if (Object.entries(box).every(([k, v]) => v === ref.params[k])) return ref
  return { ...ref, params: sanitize(mod, { ...ref.params, ...box }, t) }
}
export function followNatives(before: Scene, after: Scene, natives: NativeRef[], t: Theme): { natives: NativeRef[]; lost: string[] } {
  if (!natives.some(n => n.group)) return { natives, lost: [] }
  const ids = natives.flatMap(n => n.group ? [n.group] : []), was = holders(before, ids, t), now = holders(after, ids, t)
  const lost: string[] = [], frames = new Map<string, [Mat | null, Mat | null]>()
  const next = natives.map(n => {
    if (!n.group) return n
    const path = now.get(n.group)
    if (!path) { lost.push(n.uid); const { group: _, ...rest } = n; return rest }
    let pair = frames.get(n.group)
    if (!pair) { const old = was.get(n.group); frames.set(n.group, pair = [old ? innerFrame(before, old) : null, innerFrame(after, path)]) }
    return pair[0] && pair[1] ? carry(n, pair[0], pair[1], t) : n
  })
  return { natives: next.every((n, i) => n === natives[i]) ? natives : next, lost }
}
/** Declaration order is retained here for export; drawOrder serves the editor. */
export function shownNatives(page: Page, t: Theme): { uid: string; el: NativeEl }[] {
  return nativesOf({ natives: shownRefs(page.scene, page.natives ?? [], t) }, t)
}
function shownRefs(scene: Scene, natives: NativeRef[], t: Theme): NativeRef[] {
  const found = holders(scene, natives.flatMap(n => n.group ? [n.group] : []), t)
  return natives.filter(n => {
    const path = n.group && found.get(n.group)
    return !n.hidden && !(path && onPath(scene.root, path, hidden))
  })
}
export function drawOrder(natives: NativeRef[], t: Theme): NativeRef[] {
  const z = new Map(nativesOf({ natives }, t).map(({ uid, el }) => [uid, Number(el.props.z_index) || 0]))
  return [...natives].sort((a, b) => (z.get(a.uid) ?? 0) - (z.get(b.uid) ?? 0))
}
export function nativesUnder(scene: Scene, natives: NativeRef[], paths: readonly number[][], t: Theme): NativeRef[] {
  const found = holders(scene, natives.flatMap(n => n.group ? [n.group] : []), t)
  return natives.filter(n => { const p = n.group && found.get(n.group); return p && paths.some(path => path.every((k, i) => p[i] === k)) })
}
/** Surface px, before the canvas's group-first promotion. */
export function nativeHitAt(page: Page, t: Theme, px: Pt): NativeRef | null {
  const shown = new Map(shownNatives(page, t).map(n => [n.uid, n.el]))
  const refs: NativeRef[] = page.natives ?? [], found = holders(page.scene, refs.flatMap(n => n.group ? [n.group] : []), t)
  const [x, y] = apply(unview(viewbox(page.scene.header, page.size)), px.x, px.y)
  for (const ref of drawOrder(refs, t).reverse()) {
    const el = shown.get(ref.uid), path = ref.group && found.get(ref.group)
    if (!el || ref.lock || path && lockedAt(page.scene.root, path)) continue
    const b = el.box
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return ref
  }
  return null
}
export function withFlag(natives: NativeRef[], uids: Iterable<string>, key: 'hidden' | 'lock', on: boolean): NativeRef[] {
  const ids = new Set(uids), next = natives.map(n => {
    if (!ids.has(n.uid) || !!n[key] === on) return n
    if (on) return { ...n, [key]: true as const }
    const { [key]: _, ...rest } = n
    return rest
  })
  return next.every((n, i) => n === natives[i]) ? natives : next
}
export function holderFor(project: Project, pageId: string, scene: Scene, path: number[], t: Theme): { scene: Scene; id: string } | { refused: string } {
  if (onPath(scene.root, path, n => !!widgetOf(n, t))) return { refused: 'a native never sits inside a widget' }
  if (!canHold(scene, path, t)) return { refused: 'a native cannot follow scrolling or repeating' }
  const n = nodeAt(scene.root, path)!, existing = textOf(first(n, 'ID'))
  if (existing) {
    const first = holders(scene, [existing], t).get(existing)
    return first?.join() === path.join() ? { scene, id: existing }
      : { refused: `this group is not the first with id ${existing}; rename it before adding a native` }
  }
  if (readsPointer(n.attrs) || answersTo(n.c ?? [], scene.defs)) return { refused: 'this group has no id, and giving it one would change what hover and down inside it answer to; name the group yourself if that is meant' }
  const id = named('group_1', idsIn({ ...project, pages: project.pages.map(p => p.id === pageId ? { ...p, scene } : p) }, t))
  return { scene: { ...scene, root: replaceAt(scene.root, path, withAttr(n, 'id', id))! }, id }
}
/** The copy rules' ids and uid stems, without clipboard's store dependency. */
export function idsIn(project: Project, t: Theme): Ids {
  const taken = idsOf(project.pages.map(p => p.scene)), uids = new Set<string>()
  for (const u of takenUids(project)) taken.add(u)
  for (const p of project.pages) {
    for (const n of p.natives ?? []) uids.add(n.uid)
    for (const { ref } of widgetsIn(p.scene, t)) uids.add(ref.uid)
  }
  return idsFrom(taken, uids)
}

/** A native selected itself, with a design-unit box and the same lock reason as a scene unit. */
export type NativeUnit = { sel: Selection; ref: NativeRef; box: Box; locked: string | null }
export function nativeUnitsOf(page: Page, sels: readonly Selection[], t: Theme): NativeUnit[] {
  const refs = new Map((page.natives ?? []).map(n => [n.uid, n])), last = new Map<string, number>()
  sels.forEach((s, i) => { if (s.pageId === page.id && !s.inDefs && s.native !== undefined && refs.has(s.native)) last.set(s.native, i) })
  const found = holders(page.scene, [...last.keys()].flatMap(uid => { const group = refs.get(uid)!.group; return group ? [group] : [] }), t)
  return sels.flatMap((sel, i) => {
    if (sel.native === undefined || last.get(sel.native) !== i) return []
    const ref = refs.get(sel.native)!, mod = WIDGETS[ref.type]
    if (!mod?.native) return []
    const p = sanitize(mod, ref.params, t), path = ref.group && found.get(ref.group)
    return [{ sel, ref, box: { x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) },
      locked: ref.lock || path && lockedAt(page.scene.root, path) ? 'locked' : null }]
  })
}

const counted = (reasons: string[]): string[] => {
  const counts = new Map<string, number>()
  for (const why of reasons) counts.set(why, (counts.get(why) ?? 0) + 1)
  return [...counts].map(([why, n]) => `${n} skipped: ${why}`)
}
const whole = (n: number) => { const v = Math.round(n); return v === 0 ? 0 : v }
const withMoved = (natives: NativeRef[], moved: ReadonlyMap<string, NativeRef>): NativeRef[] => {
  const next = natives.map(n => moved.get(n.uid) ?? n)
  return next.every((n, i) => n === natives[i]) ? natives : next
}

/** Per-unit design deltas. Only axes that move are rounded, as for widget-root moves. */
export function moveNatives(natives: NativeRef[], units: readonly NativeUnit[], deltas: readonly { dx: number; dy: number }[], t: Theme): { natives: NativeRef[]; skipped: string[] } {
  const moved = new Map<string, NativeRef>(), why: string[] = [], present = new Set(natives.map(n => n.uid))
  units.forEach((u, i) => {
    const { dx, dy } = deltas[i] ?? { dx: 0, dy: 0 }
    if (!present.has(u.ref.uid)) return
    if (dx === 0 && dy === 0) return
    if (u.locked) { why.push(u.locked); return }
    if (![dx, dy].every(Number.isFinite)) { why.push(FLOAT32); return }
    const x = dx ? whole(u.box.x + dx) : u.box.x, y = dy ? whole(u.box.y + dy) : u.box.y
    if (![x, y].every(v => Number.isFinite(Math.fround(v)))) { why.push(FLOAT32); return }
    if (x === u.box.x && y === u.box.y) return
    moved.set(u.ref.uid, { ...u.ref, params: sanitize(WIDGETS[u.ref.type], { ...u.ref.params, x, y }, t) })
  })
  return { natives: withMoved(natives, moved), skipped: counted(why) }
}

/** Set transforms carry centres and column lengths; game natives stay upright. */
export function transformNatives(natives: NativeRef[], units: readonly NativeUnit[], m: Mat, t: Theme): { natives: NativeRef[]; skipped: string[]; upright: string[] } {
  if (m.every(Number.isFinite) && m.every((v, i) => Math.abs(v - IDENTITY[i]) <= 1e-9 * Math.max(1, Math.abs(v)))) return { natives, skipped: [], upright: [] }
  const moved = new Map<string, NativeRef>(), why: string[] = [], upright: string[] = [], present = new Set(natives.map(n => n.uid))
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3])
  const turns = Math.abs(m[1]) + Math.abs(m[2]) > 1e-9 * (sx + sy) || m[0] < 0 && m[3] < 0
  for (const u of units) {
    if (!present.has(u.ref.uid)) continue
    if (u.locked) { why.push(u.locked); continue }
    const b = u.box, [cx, cy] = apply(m, b.x + b.w / 2, b.y + b.h / 2)
    const w = Math.max(1, whole(b.w * sx)), h = Math.max(1, whole(b.h * sy))
    const box = { x: whole(cx - w / 2), y: whole(cy - h / 2), w, h,
      ...(u.ref.type === 'textinput' && { fontSize: keep(Number(u.ref.params.fontSize), Number(u.ref.params.fontSize) * sy) }) }
    if (!Object.values(box).every(v => Number.isFinite(Math.fround(v)))) { why.push(FLOAT32); continue }
    if (turns) upright.push(u.ref.uid)
    if (Object.entries(box).every(([k, v]) => u.ref.params[k] === v)) continue
    moved.set(u.ref.uid, { ...u.ref, params: sanitize(WIDGETS[u.ref.type], { ...u.ref.params, ...box }, t) })
  }
  return { natives: withMoved(natives, moved), skipped: counted(why), upright }
}

/** The shown native portion of a group's world box, including deeper holders. */
export function heldBox(scene: Scene, natives: NativeRef[], path: number[], t: Theme): Box | null {
  const refs = nativesUnder(scene, shownRefs(scene, natives, t), [path], t)
  let box: Box | null = null
  for (const { el: { box: b } } of nativesOf({ natives: refs }, t)) {
    if (!box) { box = b; continue }
    const x = Math.min(box.x, b.x), y = Math.min(box.y, b.y)
    box = { x, y, w: Math.max(box.x + box.w, b.x + b.w) - x, h: Math.max(box.y + box.h, b.y + b.h) - y }
  }
  return box
}

/** Snapping uses every shown native, including locked ones, except those being moved. */
export const nativeTargets = (page: Page, t: Theme, skip: ReadonlySet<string>): Box[] =>
  shownNatives(page, t).filter(n => !skip.has(n.uid)).map(n => n.el.box)
