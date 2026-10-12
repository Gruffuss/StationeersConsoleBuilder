import { boxOf } from '../editor/geometry'
import { isStyle } from '../editing/style'
import { moveBy, pairOf } from '../editing/transform'
import type { SrcNode } from '../model/scene'
import { sameData } from '../model/same'
import { first, foldKey } from '../srctext/props'
import type { Theme } from '../theme'
import { expandRoot } from './core'
import { sanitizeEdit } from './editData'
import type { PartEdit, WidgetRef } from './types'

export { applyEdit, sanitizeEdit } from './editData'
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(Math.fround(v))
const offsets = ['dx', 'dy', 'dw', 'dh'] as const
const structure = "a widget's structure changes through Detach"
const geom: Record<string, string[]> = { R: ['X', 'Y', 'W', 'H'], T: ['X', 'Y', 'W', 'H'], C: ['CX', 'CY', 'RX', 'RY'], L: ['P'], Y: ['P'], G: ['T'] }
export function editFrom(w: WidgetRef, t: Theme, before: SrcNode, after: SrcNode): { ref: WidgetRef } | { refused: string } {
  const expansion = expandRoot(w, t), names = new Map(Object.entries(expansion.exp.parts!).map(([name, p]) => [p.join(','), name]))
  let own: ReturnType<typeof expandRoot> | undefined
  const parts: Record<string, PartEdit> = Object.create(null)
  for (const [name, p] of Object.entries(w.edit?.parts ?? {})) parts[name] = { ...p, ...(p.attrs ? { attrs: { ...p.attrs } } : {}) }
  const moved = new Set<string>(), frames = new Set<string>(), root = { ...w.edit?.root }, stack = [{ a: before, b: after, path: [] as number[] }]
  while (stack.length) {
    const { a, b, path } = stack.pop()!
    if (a === b) continue
    if (a.op !== b.op || !!a.c !== !!b.c || a.c?.length !== b.c?.length) return { refused: structure }
    const changes = [...new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])].filter(k => !sameData(a.attrs[k], b.attrs[k]))
    const comments = (n: SrcNode) => n.comments?.filter(c => !c.startsWith('style '))
    if (path.length && (!sameData(comments(a), comments(b)) || a.eol !== b.eol || !sameData(a.tail, b.tail))) return { refused: structure }
    if (changes.length) {
      if (!path.length) {
        for (const k of changes) {
          const K = foldKey(k), v = b.attrs[k]
          if (!['V', 'O', 'R', 'A'].includes(K) || v !== undefined && (K === 'V' ? v !== 0 && v !== 1 : K === 'A' ? !Array.isArray(v) || v.length !== 2 || !v.every(finite) : !finite(v))) return { refused: structure }
          if (v === undefined) delete root[K.toLowerCase() as keyof typeof root]
          else Object.assign(root, { [K.toLowerCase()]: v })
        }
      } else {
        const name = names.get(path.join(',')), op = foldKey(a.op)
        if (!name) return { refused: structure }
        const p = parts[name] ?? (parts[name] = {}), geometry: string[] = []
        for (const k of changes) {
          const K = foldKey(k)
          if (isStyle(op, k) || K === 'V') {
            const attrs = p.attrs ??= Object.create(null)
            if (b.attrs[k] === undefined) {
              own ??= expandRoot({ ...w, edit: undefined }, t)
              let baseline: SrcNode | undefined, list = own.exp.nodes
              for (const i of own.exp.parts![name] ?? []) { baseline = list[i]; list = baseline?.c ?? [] }
              if (!baseline || first(baseline, K) === undefined) delete attrs[k]
              else attrs[k] = null
            } else attrs[k] = b.attrs[k]
          }
          else if (geom[op]?.includes(K)) geometry.push(k)
          else return { refused: structure }
        }
        if (geometry.length) {
          if (name.includes('~')) return { refused: "an ornament's place follows its part" }
          moved.add(name)
          let dx = 0, dy = 0, dw = 0, dh = 0
          if (['R', 'T', 'C'].includes(op)) {
            const x = boxOf(a), y = boxOf(b)
            if (!x || !y) return { refused: 'widget geometry expressions stay unchanged' }
            dx = y.x - x.x; dy = y.y - x.y; dw = y.w - x.w; dh = y.h - x.h
          } else {
            const x = pairOf(first(a, op === 'G' ? 'T' : 'P'), 0), y = pairOf(first(b, op === 'G' ? 'T' : 'P'), 0)
            if (!x || !y) return { refused: 'widget geometry expressions stay unchanged' }
            dx = y[0] - x[0]; dy = y[1] - x[1]
            const wrote = moveBy(a, dx, dy), key = op === 'G' ? 'T' : 'P'
            if (wrote.locked || !sameData(first(wrote.node, key), first(b, key))) return { refused: 'widget geometry or paint cannot be represented as an override' }
          }
          let ancestor = before
          for (let i = 0; i < path.length-1; i++) {
            ancestor = ancestor.c![path[i]]
            if (foldKey(ancestor.op) === 'G' && first(ancestor, 'T') !== undefined) frames.add(path.slice(0, i+1).join(','))
          }
          for (const [k, d] of Object.entries({ dx, dy, dw, dh }) as [typeof offsets[number], number][]) if (d) p[k] = (p[k] ?? 0) + d
        }
      }
    }
    a.c?.forEach((c, i) => stack.push({ a: c, b: b.c![i], path: [...path, i] }))
  }
  const ref = { ...w, edit: sanitizeEdit({ v: 1, parts, root }) }, pairs = [{ a: expandRoot(ref, t).root, b: after, path: [] as number[] }]
  while (pairs.length) {
    const { a, b, path } = pairs.pop()!, name = names.get(path.join(','))
    // Ornaments' geometry is regenerated from their moved part, not the submitted scene.
    const follows = name && (moved.has(name) && ['L', 'Y', 'G'].includes(foldKey(a.op)) || name.includes('~') && moved.has(name.split('~')[0]))
    const geometry = follows ? geom[foldKey(a.op)] : frames.has(path.join(',')) ? ['T'] : []
    const attrs = (n: SrcNode) => Object.fromEntries(Object.entries(n.attrs).filter(([k]) => !geometry?.includes(foldKey(k))))
    if (a.op !== b.op || a.c?.length !== b.c?.length) return { refused: 'widget geometry or paint cannot be represented as an override' }
    if (!sameData(attrs(a), attrs(b))) return { refused: 'widget geometry or paint cannot be represented as an override' }
    a.c?.forEach((c, i) => pairs.push({ a: c, b: b.c![i], path: [...path, i] }))
  }
  return { ref }
}
export function resetPart(w: WidgetRef, name: string): WidgetRef {
  const parts = { ...w.edit?.parts }; delete parts[name]
  return { ...w, edit: sanitizeEdit({ ...w.edit, parts }) }
}
