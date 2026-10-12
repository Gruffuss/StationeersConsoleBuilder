import { describe, expect, it } from 'vitest'
import { parseOrder } from '../model/numbering'
import type { Scene, SrcNode } from '../model/scene'
import { node } from '../model/testing'
import { checkScene } from './check'
import { parseSrc } from './parse'
import { printSrc } from './print'

const scene = (root: SrcNode[], defs: SrcNode[] = []): Scene => ({ header: { w: 10, h: 10 }, defs, root })

describe('checkScene', () => {
  it('keeps a self-crossing filled P valid and exposes its crossing as an anchored warning', () => {
    const c = checkScene(scene([node('G', { f: '#fff' }, [node('P', { d: 'M0 0 L10 10 L10 0 L0 10 Z' })])]))
    expect(c.errors).toEqual([]); expect(c.src).not.toBeNull()
    expect(c.warnings).toContainEqual({ message: 'this P crosses itself, which the mod cannot fill, shadow or clip: uncross the ring or split it', ref: { inDefs: false, path: [0, 0] } })
  })
  it('anchors issues by path, in the root and in DEFS', () => {
    const bad = node('R', { x: Infinity })
    const sym = node('SYM', { id: 's' }, [node('USE', { ref: 's' })])
    const c = checkScene(scene([node('R'), node('G', {}, [bad])], [sym]))
    expect(c.errors.map(e => e.ref)).toEqual([{ inDefs: true, path: [0] }, { inDefs: false, path: [1, 0] }])
    expect(c.src).toBeNull()
    expect(c.order).toEqual({ ops: [], nodes: [] })
  })
  it('gives a valid scene its text and its numbering', () => {
    const s = scene([node('R'), node('G', {}, [node('C')])])
    const c = checkScene(s)
    expect(c.errors).toEqual([])
    expect(c.src).toBe(printSrc(s))
    expect(c.order).toEqual(parseOrder(s))
  })
  it('checks 100,000 nested G nodes clean, with no path per node', () => {
    let deep: SrcNode = node('R')
    for (let k = 0; k < 100_000; k++) deep = node('G', {}, [deep])
    const c = checkScene(scene([deep]))
    expect(c.errors).toEqual([])
    expect(c.order.ops).toHaveLength(100_001)
    expect(parseSrc(c.src!).errors).toEqual([])
  }, 10_000) // measured: 1.220 s focused, 2.118 s full suite; at least 3x headroom
  it('anchors an issue 100,000 levels down', () => {
    let deep: SrcNode = node('R', { x: NaN })
    for (let k = 0; k < 100_000; k++) deep = node('G', {}, [deep])
    const c = checkScene(scene([deep]))
    expect(c.errors).toHaveLength(1)
    expect(c.errors[0].ref!.path).toHaveLength(100_001)
  })
  it('calls a scene past a work budget too large to check here, not invalid, and gives it no text', () => {
    // 20 levels of symbols, each using the one below twice: 2^20 instances, past the instance budget.
    const defs = [node('SYM', { id: 's0' }, [node('R')])]
    for (let k = 1; k <= 20; k++) defs.push(node('SYM', { id: `s${k}` }, [node('USE', { ref: `s${k - 1}` }), node('USE', { ref: `s${k - 1}` })]))
    const c = checkScene(scene([node('USE', { ref: 's20' })], defs))
    expect(c.tooLarge).toBe(true)
    expect(c.errors).toEqual([{ message: 'this scene is too large to check here (symbols take too much work to expand: more than 50000000 steps); it is not sent to the preview' }])
    expect(c.src).toBeNull()
    expect(c.order).toEqual({ ops: [], nodes: [] })
  })
  it('walks no further for duplicate ids once the validator ran out of budget, on an invalid scene too', () => {
    const defs = [node('SYM', { id: 's0' }, [node('R')])]
    for (let k = 1; k <= 20; k++) defs.push(node('SYM', { id: `s${k}` }, [node('USE', { ref: `s${k - 1}` }), node('USE', { ref: `s${k - 1}` })]))
    const twins = [node('R', { id: 'a' }), node('R', { id: 'a' })]
    const c = checkScene(scene([node('USE', { ref: 's20' }), node('R', { x: Infinity }), ...twins], defs))
    expect(c.errors.length).toBeGreaterThan(0)
    expect(c.warnings.filter(w => w.message.includes('used twice'))).toEqual([])
    expect(checkScene(scene(twins)).warnings.map(w => w.message)).toEqual(['id "a" is used twice in this scene: both nodes report the same clicks and hover'])
  })
  it('lists the trap warnings on their nodes', () => {
    const c = checkScene(scene([node('R', { x: 1, y: 1, w: 1, h: 1, o: 0.5 })]))
    expect(c.warnings).toEqual([{ message: '"o" does nothing on R: the mod reports it: remove it', ref: { inDefs: false, path: [0] }, key: 'o' }])
    expect(c.src).not.toBeNull()
  })
  it('lists the traps of a scene with errors too', () => {
    const c = checkScene(scene([node('G', {}, [node('R', { x: Infinity, o: 0.5 })])]))
    expect(c.errors).toHaveLength(1)
    expect(c.warnings).toEqual([{ message: '"o" does nothing on R: the mod reports it: remove it', ref: { inDefs: false, path: [0, 0] }, key: 'o' }])
  })
  it('lists the header traps and a colour that is not one as warnings: the scene stays valid', () => {
    const c = checkScene({ header: { w: 10, h: 10, fit: 'bogus' }, defs: [], root: [node('R', { f: '=5' })] })
    expect(c.errors).toEqual([])
    expect(c.src).not.toBeNull()
    expect(c.warnings.map(w => [w.key, w.ref])).toEqual([['f', { inDefs: false, path: [0] }], ['fit', undefined]])
  })
  it('gives a scene whose crossing checks run out of work its text: a budget on a warning is no verdict', () => {
    const p = [0, 0, 10, 10, 10, 0, 0, 10, ...Array.from({ length: 1992 }, (_, k) => k)]   // 101 rings of 1000 points: a map
    const c = checkScene(scene(Array.from({ length: 101 }, () => node('Y', { p, f: '#fff' }))))
    expect(c.tooLarge).toBeUndefined()
    expect(c.errors).toEqual([])
    expect(c.src).not.toBeNull()
    expect(c.warnings.at(-1)).toEqual({ message: 'whether one Y crosses itself is not checked: the crossing checks ran out of work (more than 50000000 steps)' })
  })
  it('keeps a symbol cycle an error', () => {
    const c = checkScene(scene([node('USE', { ref: 'c' })], [node('SYM', { id: 'c' }, [node('USE', { ref: 'c' })])]))
    expect(c.tooLarge).toBeUndefined()
    expect(new Set(c.errors.map(e => e.message))).toEqual(new Set(['SYM "c" uses itself through USE: c > c']))
  })
})
