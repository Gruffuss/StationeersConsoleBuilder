// Imported by tests only. Every key of the catalogue on each op that takes it, the SCENE header's host keys and a key no op
// reads, each in turn holding a list 100,000 deep, through every function that reads a scene's values: none may throw,
// and above all none may overflow the stack. The list d sits bare or as a shadow's colour ([0, 0, 2, 0, d]), with a number
// or a string at the bottom (a list holding d is d one level deeper): four shapes, one test file each (shape0 … shape3),
// so vitest runs them in parallel. A shape took about 16 s alone when the probe was written; shape0 took 263 s alone on a
// loaded machine on 2026-10-07 (131 s of CPU).
import { expect, it } from 'vitest'
import { absent, dataNames, modeOf, noteOf, shown, withAttr } from '../../editor/fields'
import { boxOf, chainTo } from '../../editor/geometry'
import { allBoxes, rootBoxes, worldBox } from '../../editing/bounds'
import { clipsOf, copyText, pasteText } from '../../editing/clipboard'
import { sameNumbering, sameShape } from '../../editing/ctx'
import { hollowAt, pairLabel } from '../../editing/pick'
import { movePoint, pointsOf } from '../../editing/points'
import { applyStyle, fits, namedOf, pasteStyle, styleOf } from '../../editing/style'
import { handlesOf, moveBy, resizeTo, rotate, stays } from '../../editing/transform'
import { defClosure, freshIds, idsFrom, idsOf } from '../../editing/tree'
import { moveUnits, unitsOf } from '../../editing/units'
import { parseOrder } from '../../model/numbering'
import type { Scene, SrcNode, Value } from '../../model/scene'
import { node } from '../../model/testing'
import { label } from '../../runtime/testing'
import { DEF_OPS, fieldOf, ROWS, SCENE_KEYS } from '../../schema'
import { trapsOf } from '../../schema/traps'
import { checkScene } from '../check'
import { fromProps } from '../fromProps'
import { parseSrc } from '../parse'
import { printChecked } from '../print'
import { firstWins, propsEqual, toProps } from '../props'
import { validateScene } from '../validate'
import { pack, unpack } from '../wire'
import { vanillaPlus as t } from '../../theme/vanillaPlus'

const deep = (leaf: Value): Value => {
  let d: Value = [leaf]
  for (let k = 0; k < 100_000; k++) d = [d]
  return d
}
const SHAPES: [string, () => Value][] = [1, 'x'].flatMap(leaf => [
  [`d(${leaf})`, () => deep(leaf)], [`[0,0,2,0,d(${leaf})]`, () => [0, 0, 2, 0, deep(leaf)]]] as [string, () => Value][])
// op, key: the catalogue's, then the host's keys on the header (the mod's SceneKeys, upper case there), then a key no op reads.
const KEYS: [string, string][] = [...ROWS.flatMap(r => r.ops.map(op => [op, r.key] as [string, string])),
  ...[...SCENE_KEYS].map(k => ['SCENE', k.toLowerCase()] as [string, string]), ['R', 'zz']]

// The scene, and the node holding the key (none for the header). A def is used: a symbol by a USE, a clip by a G, a
// gradient as a fill.
function placed(op: string, key: string, v: Value): { s: Scene; n?: SrcNode } {
  if (op === 'SCENE') return { s: { header: { w: 10, h: 10, [key]: v }, defs: [], root: [node('R')] } }
  const isDef = DEF_OPS.includes(op), n = node(op, isDef ? { id: 'd', [key]: v } : { [key]: v })
  if (!isDef) return { s: { header: {}, defs: [], root: [n] }, n }
  const user = op === 'SYM' ? node('USE', { ref: 'd' }) : op === 'CP' ? node('G', { clip: 'd' }, [node('R')]) : node('R', { f: '@d' })
  return { s: { header: {}, defs: [n], root: [user] }, n }
}

/** Each call that throws, as `op key shape: function: error`. checkScene prints and numbers only a valid scene, so the
 *  text parsed back is printed here when it does not. */
function throwing(op: string, key: string, shape: string, v: Value): string[] {
  const out: string[] = [], { s, n } = placed(op, key, v), f = fieldOf(op, key)
  const run = (name: string, call: () => unknown) => {
    try { call() } catch (e) { out.push(`${op} ${key} ${shape}: ${name}: ${e instanceof Error ? e.name : String(e)}`) }
  }
  run('validateScene', () => validateScene(s))
  run('trapsOf', () => trapsOf(s))
  run('checkScene, then parseSrc of the text', () => parseSrc(checkScene(s).src ?? printChecked(s)))
  run('parseOrder', () => parseOrder(s))
  run('toProps, firstWins, propsEqual, fromProps', () => {
    const p = toProps(s, 'scene')
    return [propsEqual(firstWins(p), p), fromProps(p)]
  })
  run('pack, unpack', () => unpack(pack(s)))
  run('dataNames', () => dataNames(s))
  run('chainTo', () => chainTo(s, [0], { w: 100, h: 100 }))
  // The canvas's own readers and writers (M2c): the transforms, points, styles, units, boxes, picking, the clipboard and
  // the numbering's shape test.
  run('unitsOf, moveUnits', () => moveUnits(s, unitsOf(s, [{ pageId: 'p1', path: [0] }], t), [{ dx: 1, dy: 1 }], t))
  run('allBoxes, rootBoxes, worldBox', () => [allBoxes(s, new Set()), rootBoxes(s), worldBox(s, [0])])
  run('hollowAt, pairLabel', () => [hollowAt(s, { x: 1, y: 1 }), pairLabel(s, { w: 100, h: 100 }, label(), [0])])
  run('copyText, pasteText', () => pasteText(s, copyText(s, s.root, t), idsFrom(idsOf([s])), 10, 10, t, prefix => prefix + '9'))
  run('clipsOf, defClosure, freshIds', () => [clipsOf(s.root), defClosure(s.root, s.defs), freshIds(s.root, idsFrom(idsOf([s])))])
  run('sameShape, sameNumbering', () => [sameShape(s.root, s.root.map(x => ({ ...x }))), sameNumbering(s, { ...s, root: s.root.map(x => ({ ...x })) })])
  if (n) {
    run('boxOf', () => boxOf(n))
    run('moveBy, resizeTo, rotate, handlesOf, stays', () => {
      const b = handlesOf(n)?.box ?? { x: 0, y: 0, w: 1, h: 1 }
      return [moveBy(n, 1, 1), resizeTo(n, 'se', b, { ...b, w: b.w + 1, h: b.h + 1 }), rotate([n], [0], 30, { x: 0, y: 0 }), stays(n)]
    })
    run('pointsOf, movePoint', () => [pointsOf(n), movePoint(n, 0, 1, 1)])
    run('styleOf, pasteStyle, applyStyle, fits', () => [pasteStyle(node(n.op), { op: n.op, attrs: styleOf(n) }), pasteStyle(n, { op: 'R', attrs: { f: '#f00' } }),
      namedOf(t).map(x => fits(x, n, t) && applyStyle(n, x.attrs(t)))])
    run('withAttr', () => [withAttr(n, key, v), withAttr(n, key, undefined), withAttr(n, key, 5, true)])
  }
  if (f) run('modeOf, noteOf, absent', () => [modeOf(v, f), noteOf(f, v), absent(f)])
  return out
}

/** The test for SHAPES[k]: shown takes the value alone, so it runs once. */
export function probe(k: number) {
  const [shape, make] = SHAPES[k]
  it(`throws for no key holding ${shape}, a list 100,000 deep`, () => {
    const v = make(), out = KEYS.flatMap(([op, key]) => throwing(op, key, shape, v))
    try { shown(v) } catch (e) { out.push(`${shape}: shown: ${e instanceof Error ? e.name : String(e)}`) }
    expect(out).toEqual([])
  }, 1_800_000)   // 263 s alone on a loaded machine (2026-10-07), 319 to 434 s with the four shapes and the other files in parallel
}
