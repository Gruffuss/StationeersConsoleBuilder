import { describe, expect, it } from 'vitest'
import type { Scene } from '../model/scene'
import { node } from '../model/testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { expandRoot, putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { enterable, pickAt as pickDepth } from './depth'
const pickAt = (hit: import('../model/store').Selection, entered: number[], deep: boolean) => pickDepth(hit, entered, deep, scene([]), vanillaPlus)

const at = (...path: number[]) => ({ pageId: 'p1', path })
const scene = (root: Scene['root']): Scene => ({ header: {}, defs: [], root })

describe('picking at the entered depth', () => {
  it('picks named parts under Button states and Repeater structure, with the plate promoted to the root', () => {
    for (const [w, name] of [[instance('button', { states: [{ label: 'A', variant: 'secondary', key: 3 }, { label: 'B', variant: 'primary', key: 8 }] }), 'state.8.body'], [instance('repeater'), 'row']] as const) {
      const s = putWidget(scene([]), w, vanillaPlus), path = [0, ...expandRoot(w, vanillaPlus).exp.parts![name]]
      expect(pickDepth(at(...path), [0], false, s, vanillaPlus)).toEqual(at(...path))
      expect(pickDepth(at(0, 0), [0], false, s, vanillaPlus)).toEqual(at(0))
    }
  })
  it('promotes the raw hit to a child of the entered group, or the page root outside it', () => {
    expect(pickAt(at(0, 1, 2), [], false)).toEqual(at(0))
    expect(pickAt(at(0, 1, 2), [0], false)).toEqual(at(0, 1))
    expect(pickAt(at(0, 1, 2), [0, 1], false)).toEqual(at(0, 1, 2))
    expect(pickAt(at(1, 0, 2), [0, 1], false)).toEqual(at(1))
    expect(pickAt(at(0), [0, 1], false)).toEqual(at(0))
  })
  it('keeps the innermost hit for deep picking, and keeps DEFS and native selections', () => {
    expect(pickAt(at(0, 1, 2), [], true)).toEqual(at(0, 1, 2))
    const def = { ...at(0, 1), inDefs: true }, native = { ...at(), native: 'ico1' }
    expect(pickAt(def, [], false)).toBe(def)
    expect(pickAt(native, [], false)).toBe(native)
  })
})

describe('enterable', () => {
  const child = node('G', {}, [node('R')])
  it('enters only a nonempty G at a resolving path', () => {
    const s = scene([child, node('G', {}, []), node('RP', {}, [child])])
    expect([[], [0], [1], [2], [99]].map(p => enterable(s, p, vanillaPlus))).toEqual([false, true, false, false, false])
  })
  it('refuses a hidden or locked node or ancestor', () => {
    const attributes: Scene['header'][] = [{ v: 0 }, {}]
    for (const attrs of attributes) {
      const blocked = { ...node('G', attrs, [child]), ...(attrs.v === undefined ? { comments: ['lock'] } : {}) }
      expect(enterable(scene([blocked]), [0], vanillaPlus)).toBe(false)
      expect(enterable(scene([blocked]), [0, 0], vanillaPlus)).toBe(false)
    }
  })
  it('enters a widget root, but not its structural groups', () => {
    const s = putWidget(scene([]), { uid: 'pan1', type: 'panel', params: {} }, vanillaPlus)
    expect(enterable(s, [0], vanillaPlus)).toBe(true)
    expect(enterable(s, [0, 0], vanillaPlus)).toBe(false)
  })
})
