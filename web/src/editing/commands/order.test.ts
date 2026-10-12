// Z-order's cost, counted (not timed): the root lists the tree writers copy, and the elements array splices shift and
// indexOf scans.
import { describe, expect, it, vi } from 'vitest'
import type { Scene, SrcNode } from '../../model/scene'
import { node } from '../../model/testing'
import type { Checked } from '../../srctext/check'
import { COMMANDS } from '../registry'
import { harness } from '../testing'

// Each call of a tree writer copies the list it is handed (the page root here) at least once.
const copied = vi.hoisted(() => ({ n: 0 }))
vi.mock('../tree', async importOriginal => {
  const m = await importOriginal<typeof import('../tree')>()
  return { ...m,
    editList: (...a: Parameters<typeof m.editList>) => { copied.n += a[0].length; return m.editList(...a) },
    editAt: (...a: Parameters<typeof m.editAt>) => { copied.n += a[0].length; return m.editAt(...a) },
    removeAt: (...a: Parameters<typeof m.removeAt>) => { copied.n += a[0].length; return m.removeAt(...a) } }
})

const ok = (): Checked => ({ errors: [], warnings: [], src: 'R', order: { ops: [], nodes: [] } })
const page = (root: SrcNode[], sel: number[][]) => {
  const at = sel.map(path => ({ pageId: 'p1', path }))
  return harness({ header: { w: 460, h: 460 }, defs: [], root } as Scene, { sel: at.at(-1) ?? null, also: at.slice(0, -1), verdict: ok })
}
const run = (h: ReturnType<typeof harness>, id: string) => COMMANDS.find(c => c.id === id)!.run(h.ctx)
const sel = (h: ReturnType<typeof harness>) => [...h.state().also, h.state().selection].filter(Boolean).map(x => x!.path)
const R = (x: number) => node('R', { x, y: 0, w: 10, h: 10 })
const N = 2000

describe('z-order across many parents copies the page root once (one write per parent list copied it per list)', () => {
  // N root groups, each holding two overlapping rectangles; the first of each selected.
  const groups = () => Array.from({ length: N }, (_, k) => node('G', {}, [R(20 * k), R(20 * k + 5)]))
  for (const [id, moved] of [['forward', true], ['backward', false], ['front', true], ['back', false]] as const) {
    it(id, async () => {
      const h = page(groups(), Array.from({ length: N }, (_, k) => [k, 0]))
      copied.n = 0
      await run(h, id)
      expect(copied.n).toBeLessThanOrEqual(2 * N)   // N × N = 4,000,000 with one write per parent
      expect(h.root().every((g, k) => g.c![moved ? 1 : 0].attrs.x === 20 * k)).toBe(true)
      expect(sel(h).every((p, k) => p[0] === k && p[1] === (moved ? 1 : 0))).toBe(true)
    })
  }
})

describe('one step of many runs in one list shifts no element per run (a splice and an indexOf per run: quadratic)', () => {
  it('forward and backward over 2N siblings, every other one selected', async () => {
    const { splice, indexOf } = Array.prototype, work = { n: 0 }
    const count = async (h: ReturnType<typeof harness>, id: string) => {
      const spies = [
        vi.spyOn(Array.prototype, 'splice').mockImplementation(function (this: unknown[], start: number, ...rest: unknown[]) {
          work.n += Math.max(0, this.length - start)
          return splice.apply(this, [start, ...rest] as [number, number, ...unknown[]])
        }),
        vi.spyOn(Array.prototype, 'indexOf').mockImplementation(function (this: unknown[], x: unknown, from?: number) {
          const r = indexOf.call(this, x, from)
          work.n += r < 0 ? this.length : r + 1
          return r
        }),
      ]
      work.n = 0
      try { await run(h, id) } finally { spies.forEach(s => s.mockRestore()) }
      return work.n
    }
    const list = () => Array.from({ length: 2 * N }, (_, k) => R(20 * k))   // no two overlap: each run moves one slot
    const f = page(list(), Array.from({ length: N }, (_, k) => [2 * k]))
    expect(await count(f, 'forward')).toBeLessThanOrEqual(2 * N)   // about 2N^2 with a splice and an indexOf per run
    expect(f.root().map(n => n.attrs.x)).toEqual(Array.from({ length: 2 * N }, (_, k) => 20 * (k ^ 1)))
    expect(sel(f).map(p => p[0])).toEqual(Array.from({ length: N }, (_, k) => 2 * k + 1))
    const b = page(list(), Array.from({ length: N }, (_, k) => [2 * k + 1]))
    expect(await count(b, 'backward')).toBeLessThanOrEqual(2 * N)
    expect(b.root().map(n => n.attrs.x)).toEqual(Array.from({ length: 2 * N }, (_, k) => 20 * (k ^ 1)))
  })
})
