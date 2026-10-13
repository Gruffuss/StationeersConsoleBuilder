import { apply, groupMatrix, invert, mul, round, type Box, type Handle, type Mat } from '../editor/geometry'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt } from '../model/tree'
import { sameData } from '../model/same'
import type { Selection } from '../model/store'
import type { Theme } from '../theme'
import { expandRoot, mergeDefs, sanitize, widgetAt, widgetRootOf } from '../widgets/core'
import { editFrom } from '../widgets/edits'
import { WIDGETS } from '../widgets/registry'
import { worldOf } from './bounds'
import { editAt, first, lockedAt } from './tree'
import { handlesOf, isTurnWrapper, resizeTo, rotate } from './transform'

const axis = (m: Mat) => Math.abs(m[1]) + Math.abs(m[2]) <= 1e-9 * (Math.abs(m[0]) + Math.abs(m[3]))
const rotation = (m: Mat) => Math.abs(m[0] - m[3]) + Math.abs(m[1] + m[2]) < 1e-9 && Math.abs(Math.hypot(m[0], m[1]) - 1) < 1e-9
const mapped = (b: Box, m: Mat): Box => {
  const [x, y] = apply(m, b.x, b.y)
  return { x, y, w: b.w * m[0], h: b.h * m[3] }
}

/** Apply the set's design-space scale or turn in each member's frame. Widgets carry their centres even when a
 * dimension or orientation must stay; skipped names both those constraints and members that cannot be written. */
export function transformSet(scene: Scene, sels: Selection[], t: Theme, m: Mat): { scene: Scene; selection: Selection[]; skipped: string[]; matrix: Mat } {
  const matrices = [m], out = transforms(scene, sels, t, matrices, false)
  // Natives in the gesture use the same effective scale when a widget minimum holds the set.
  return { scene: out.scene, selection: out.selection, skipped: out.skipped, matrix: matrices[0] }
}

/** Test handles in one pass, stopping after support is found; never rebuild a scene to display its frame. */
export function transformHandles(scene: Scene, sels: Selection[], t: Theme, box: Box) {
  const x = box.x + box.w / 2, y = box.y + box.h / 2
  const { supported: [full, horizontal, vertical, rotate] } = transforms(scene, sels, t,
    [[1.5, 0, 0, 1.5, -0.5 * x, -0.5 * y], [1.5, 0, 0, 1, -0.5 * x, 0],
      [1, 0, 0, 1.5, 0, -0.5 * y], [0, 1, -1, 0, x + y, y - x]], true)
  const only: Handle[] | undefined = full || horizontal && vertical ? undefined : horizontal ? ['e', 'w'] : ['n', 's']
  return { resize: (full || horizontal || vertical) && (box.w !== 0 || box.h !== 0), rotate, only }
}

function selectedAncestors(sels: Selection[]): boolean[] {
  type Path = { selected: boolean; kids: Map<number, Path> }
  const pages = new Map<string, Path>(), branch = (): Path => ({ selected: false, kids: new Map() })
  for (const sel of sels) {
    if (sel.inDefs || sel.native !== undefined) continue
    let p: Path = pages.get(sel.pageId) ?? branch()
    pages.set(sel.pageId, p)
    for (const k of sel.path) {
      let child: Path | undefined = p.kids.get(k)
      if (!child) p.kids.set(k, child = branch())
      p = child
    }
    p.selected = true
  }
  return sels.map(sel => {
    let p = pages.get(sel.pageId)
    for (const k of sel.path) {
      if (p?.selected) return true
      p = p?.kids.get(k)
    }
    return false
  })
}

function transforms(scene: Scene, sels: Selection[], t: Theme, matrices: Mat[], probe: boolean) {
  const skipped: string[] = [], selection = probe ? sels : sels.map(s => ({ ...s, path: [...s.path] }))
  const supported = matrices.map(() => false)
  let m = matrices[0]
  if (m.every((v, i) => v === [1, 0, 0, 1, 0, 0][i])) return { scene, selection, skipped, supported }
  const ancestors = selectedAncestors(sels)
  const turning = rotation(m) && (Math.abs(m[1]) > 1e-9 || m[0] < 0)
  // Hold the entire set at the most restrictive widget minimum, rather than clamp widgets after scaling the others.
  if (!probe && !turning && axis(m) && m.every(Number.isFinite) && invert(m)) {
    let sx = m[0], sy = m[3]
    const uniform = Math.abs(sx - sy) <= 1e-9 * Math.max(Math.abs(sx), Math.abs(sy))
    for (const [i, sel] of sels.entries()) {
      if (sel.inDefs || sel.native !== undefined || lockedAt(scene.root, sel.path) || ancestors[i]) continue
      const w = widgetAt(scene, sel.path, t), W = worldOf(scene, [...sel.path, 0])
      if (!w || !W) continue
      const swapped = Math.abs(W[0]) + Math.abs(W[3]) <= 1e-9 * (Math.abs(W[1]) + Math.abs(W[2]))
      if (!uniform && !axis(W) && !swapped) continue
      const mod = WIDGETS[w.type], p = w.params as unknown as Box
      if (mod.resize === 'none') continue
      const min = sanitize(mod, { ...w.params, w: 0, h: 0 }, t) as unknown as Box
      if (m[0] < 0 || m[3] < 0) continue   // widgets cannot mirror; they must not clamp other members
      const wx = p.w ? Math.ceil(min.w) / p.w : 0, hy = mod.resize === 'both' && p.h ? Math.ceil(min.h) / p.h : 0
      sx = Math.max(sx, swapped ? hy : wx); sy = Math.max(sy, swapped ? wx : hy)
    }
    if (uniform) sx = sy = Math.max(sx, sy)
    const e = m[0] === 1 ? m[4] : m[4] / (1 - m[0]) * (1 - sx)
    const f = m[3] === 1 ? m[5] : m[5] / (1 - m[3]) * (1 - sy)
    m = [sx, 0, 0, sy, e, f]
    matrices[0] = m
  }
  const paths: number[][] = [], nodes: SrcNode[] = []
  const widgetDefs: SrcNode[] = [], widgetUids = new Set<string>()
  let cur = scene
  let changed = false
  const member = (sel: Selection, i: number, m: Mat) => {
    const turning = rotation(m) && (Math.abs(m[1]) > 1e-9 || m[0] < 0)
    const original = nodeAt(scene.root, sel.path), label = sel.native ?? (original && first(original, 'ID')) ?? `${original?.op ?? 'node'} ${sel.path.map(k => k + 1).join('.')}`
    const skip = (why: string) => { if (!probe) skipped.push(`${label} skipped: ${why}`) }
    const accept = (path: number[], next: SrcNode) => {
      const root = widgetRootOf(scene, path, t)
      if (root && root.length < path.length) {
        const before = nodeAt(scene.root, root)!, after = editAt([before], [[0, ...path.slice(root.length)]], () => next)[0]
        const check = editFrom(widgetAt(scene, root, t)!, t, before, after)
        if ('refused' in check) { skip(check.refused); return false }
      }
      changed = true
      if (!probe) { paths.push(path); nodes.push(next) }
      return true
    }
    if (sel.native !== undefined) return   // the gesture transforms natives separately, preserving this selection
    if (!m.every(Number.isFinite) || !invert(m)) return skip('the transform is singular or non-finite')
    if (sel.inDefs || !original) return skip('not a scene member')
    if (ancestors[i]) return
    if (lockedAt(scene.root, sel.path)) return skip('locked')
    const widget = widgetAt(scene, sel.path, t)
    let path = sel.path, n = original
    const parent = nodeAt(scene.root, path.slice(0, -1))
    // Reuse a leaf's existing turn wrapper, as single-node rotation does.
    if (turning && !widget && parent && isTurnWrapper(parent)) { path = path.slice(0, -1); n = parent }
    const W = worldOf(scene, path), inv = W && invert(W), h = handlesOf(n)
    if (!inv) return skip('a parent transform is singular, non-finite or an expression')
    const local = mul(inv, mul(m, W!))
    if (!local.every(Number.isFinite)) return skip('the value left float32')
    if (!h) return skip('geometry is an expression or has no literal box')
    if (widget) {
      const p = widget.params as unknown as Box, B = groupMatrix(n.attrs)!, mod = WIDGETS[widget.type]
      const [cx, cy] = apply(mul(local, B), p.x + p.w / 2, p.y + p.h / 2)
      const name = [widget.params.name, widget.params.caption, widget.params.title].find(v => typeof v === 'string' && v.trim())
      const note = (why: string) => { if (!probe) skipped.push(`${name ? `${name} (${widget.uid})` : `${mod.label} (${widget.uid})`}: ${why}`) }
      const whole = (v: number, was: number) => Math.abs(v - was) <= 4 * Number.EPSILON * (Math.abs(v) + Math.abs(was)) ? was : Math.round(v)
      // Keep the widget's own turn while placing its centre at the set's transformed centre.
      const centred = (w: number, h: number) => {
        const [x, y] = apply(invert(B)!, cx, cy)
        return { ...widget, params: { ...widget.params, x: whole(x - w / 2, p.x), y: whole(y - h / 2, p.y), w, h } }
      }
      let ref = widget
      if (turning) {
        if (!rotation(local)) {
          ref = centred(p.w, p.h)
          note('size and turn kept (the parent scales unevenly: a turn would skew)')
        } else {
          const r = (round((widget.edit?.root?.r ?? 0) + Math.atan2(local[1], local[0]) * 180 / Math.PI) % 360 + 360) % 360
          const x = round(cx - p.w / 2), y = round(cy - p.h / 2)
          ref = { ...widget, params: { ...widget.params, x, y }, edit: { v: 1, parts: widget.edit?.parts ?? {}, root: { ...widget.edit?.root, r, a: [round(x + p.w / 2), round(y + p.h / 2)] } } }
          if (!r) {
            delete ref.edit!.root!.r; delete ref.edit!.root!.a
            if (!Object.keys(ref.edit!.root!).length) delete ref.edit!.root
            if (!ref.edit!.root && !Object.keys(ref.edit!.parts).length) delete ref.edit
          }
        }
      } else {
        const inBox = mul(invert(B)!, mul(local, B))
        if (!axis(inBox)) {
          ref = centred(p.w, p.h)
          note('size and turn kept (the resize would skew the widget)')
        } else {
          const box = mapped(p, inBox)
          const w = mod.resize === 'none' ? p.w : whole(Math.abs(box.w), p.w)
          const hh = mod.resize === 'both' ? whole(Math.abs(box.h), p.h) : p.h
          const mirror = inBox[0] < 0 || inBox[3] < 0
          const x = whole(box.x, p.x), y = whole(box.y, p.y)
          if (![x, y, w, hh].every(v => Number.isFinite(Math.fround(v)))) return skip('the value left float32')
          const params = sanitize(mod, { ...widget.params, x, y, w, h: hh }, t)
          ref = mirror || mod.resize !== 'both' ? centred(params.w as number, params.h as number) : { ...widget, params }
          if (mirror) note('orientation kept (the widget cannot mirror)')
          if (mod.resize === 'none' && (Math.abs(inBox[0]) !== 1 || Math.abs(inBox[3]) !== 1)) note('size kept (no resize handles)')
          if (mod.resize === 'width' && Math.abs(Math.abs(inBox[3]) - 1) > 1e-9) note('height kept (width only)')
        }
      }
      const values = [ref.params.x, ref.params.y, ref.params.w, ref.params.h, ref.edit?.root?.r ?? 0, ...ref.edit?.root?.a ?? []]
      if (!values.every(v => typeof v === 'number' && Number.isFinite(Math.fround(v)))) return skip('the value left float32')
      if (!sameData(ref.params, widget.params) || !sameData(ref.edit, widget.edit)) {
        changed = true
        if (!probe) {
          const { root, defs } = expandRoot(ref, t)
          paths.push(sel.path); nodes.push({ ...root, comments: [...original.comments!.slice(0, -1), ...root.comments!] })
          widgetDefs.push(...defs); widgetUids.add(ref.uid)
        }
      }
      return
    }
    if (turning) {
      if (!rotation(local)) return skip('the parent scales unevenly: a turn would skew')
      const pivot = invert([1 - local[0], -local[1], -local[2], 1 - local[3], 0, 0])
      if (!pivot) return
      const [x, y] = apply(pivot, local[4], local[5])
      const out = rotate([n], [0], Math.atan2(local[1], local[0]) * 180 / Math.PI, { x, y })
      if (typeof out === 'string') return skip(out)
      if (out.root[0] === n) return
      if (accept(path, out.root[0]) && !probe && path === sel.path && out.path.length > 1) selection[i].path.push(0)
    } else {
      if (!h.resize) return skip('the node has no resize handles')
      const B = n.op.toUpperCase() === 'G' ? groupMatrix(n.attrs) : null, invB = B && invert(B)
      const inBox = B && invB ? mul(invB, mul(local, B)) : local
      if (!axis(inBox)) return skip('the resize would skew: resize the enclosing group')
      const out = resizeTo(n, 'e', h.box, mapped(h.box, inBox))
      if (out.locked) return skip(out.locked)
      if (out.node !== n) accept(path, out.node)
    }
  }
  sels.some((sel, i) => {
    matrices.forEach((matrix, j) => {
      if (probe && (supported[j] || j > 0 && j < 3 && supported[0])) return
      changed = false
      member(sel, i, matrix)
      supported[j] ||= changed
    })
    return probe && (supported[0] && supported[3] || supported.every(Boolean))
  })
  if (paths.length) cur = { ...cur, root: editAt(cur.root, paths, (_, i) => nodes[i]) }
  if (widgetUids.size) cur = { ...cur, defs: mergeDefs(cur.defs, widgetDefs, widgetUids) }
  return { scene: cur, selection, skipped, supported }
}
