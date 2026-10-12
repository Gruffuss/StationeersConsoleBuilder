import { describe, expect, it } from 'vitest'
import type { SrcNode } from '../model/scene'
import { node } from '../model/testing'
import { selected, type Selection } from '../model/store'
import order from './commands/order'
import { harness } from './testing'

const nested = (depth: number) => {
  let reads = 0, root: SrcNode[] = []
  for (let d = depth - 1; d >= 0; d--) {
    const r = node('R', { x: 0, y: 0, w: 10, h: 10 })
    Object.defineProperty(r, 'op', { enumerable: true, get: () => { reads++; return 'R' } })
    root = [r, node('R', { x: 100, y: 0, w: 10, h: 10 }), node('G', {}, root)]
  }
  const selection = Array.from({ length: depth }, (_, d) => ({ pageId: 'p1', path: [...new Array<number>(d).fill(2), 0] }))
  const h = harness({ header: { w: 460, h: 460 }, defs: [], root }, { sel: selection.at(-1), also: selection.slice(0, -1) })
  return { h, selection, reads: () => reads }
}

// Count path reads and trie/hash lookups, rather than elapsed time or one previous implementation's string keys.
const applyWork = async (h: ReturnType<typeof harness>, selection: Selection[]) => {
  let work = 0
  const bound = 16 * selection.reduce((n, s) => n + s.path.length, 0)
  const cost = (key: unknown) => {
    work += typeof key === 'number' ? 1 : typeof key === 'string' ? key.length : 0
    if (work >= bound) throw new Error(`bare apply work ${work} exceeds its path-index bound ${bound}`)
  }
  const get = Map.prototype.get, set = Map.prototype.set, has = Map.prototype.has
  // Plain counters keep no call history, even when a regression repeats millions of trie lookups.
  Map.prototype.get = function (key) { cost(key); return get.call(this, key) }
  Map.prototype.set = function (key, value) { cost(key); return set.call(this, key, value) }
  Map.prototype.has = function (key) { cost(key); return has.call(this, key) }
  const tracked = selection.map(s => ({ ...s, path: new Proxy(s.path, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) cost(Number(key))
      return Reflect.get(target, key, receiver)
    },
  }) }))
  try { await h.ctx.apply({ scene: h.scene(), selection: tracked }) }
  finally { Map.prototype.get = get; Map.prototype.set = set; Map.prototype.has = has }
  return work
}

describe('nested selections', () => {
  it('measures sibling bounds once per occurrence, rather than walking the subtree at every level', async () => {
    const { h, reads } = nested(200)
    h.ctx.apply = async () => null // isolate reorder from the store's selection normalization
    await order[0].run(h.ctx)
    expect(reads()).toBeLessThan(2000)
  })

  it('counts bare apply work in the supplied path indices', async () => {
    const { h, selection } = nested(200), pathIndices = 200 * 201 / 2
    const work = await applyWork(h, selection)
    expect(selected(h.state())).toEqual(selection)
    console.log(JSON.stringify({ depth: 200, work, pathIndices }))
    expect(work).toBeLessThan(16 * pathIndices)
  })

  it('counts reorder reads and bare apply work at depths 500 and 2000', async () => {
    for (const depth of [500, 2000]) {
      const { h, selection, reads } = nested(depth)
      const apply = h.ctx.apply
      h.ctx.apply = async () => null
      await order[0].run(h.ctx)
      const boundsReads = reads()
      h.ctx.apply = apply
      const work = await applyWork(h, selection), pathIndices = depth * (depth + 1) / 2
      expect(boundsReads).toBeLessThan(10 * depth)
      expect(selected(h.state())).toEqual(selection)
      expect(work).toBeLessThan(16 * pathIndices)
    }
  }, 30000)
})
