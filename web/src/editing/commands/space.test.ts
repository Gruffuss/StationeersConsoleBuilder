import { describe, expect, it } from 'vitest'
import type { SrcNode } from '../../model/scene'
import { node } from '../../model/testing'
import { worldBox } from '../bounds'
import { COMMANDS } from '../registry'
import { harness } from '../testing'

const page = (root: SrcNode[], sel: number[][]) => {
  const at = sel.map(path => ({ pageId: 'p1', path }))
  return harness({ header: { w: 480, h: 480 }, defs: [], root }, { sel: at.at(-1) ?? null, also: at.slice(0, -1) })
}
const run = (h: ReturnType<typeof harness>, id: string, arg?: string) => COMMANDS.find(c => c.id === id)!.run(h.ctx, arg)
const R = (x: number, w = 10, more = {}) => node('R', { x, y: 0, w, h: 10, ...more })

describe('align, distribute, gap', () => {
  it('aligns two or more to their union; one to the page', async () => {
    const h = page([R(0), R(30, 20)], [[0], [1]])
    await run(h, 'align.right')
    expect(h.root().map(n => n.attrs.x)).toEqual([40, 30])
    expect(h.state().past).toHaveLength(1)
    const one = page([R(10, 20)], [[0]])
    await run(one, 'align.centre')
    expect(one.root()[0].attrs.x).toBe(230)
  })
  it('distributes three or more with equal whole gaps; sets an exact gap from an argument', async () => {
    const h = page([R(0), R(13), R(50)], [[0], [1], [2]])
    await run(h, 'distribute.x')
    expect(h.root().map(n => n.attrs.x)).toEqual([0, 25, 50])
    const g = page([R(0), R(30), R(13, 5)], [[0], [1], [2]])
    await run(g, 'gap.x', '4')
    expect(g.root().map(n => n.attrs.x)).toEqual([0, 23, 14])
    await run(g, 'gap.x', 'wide')
    expect(g.notes).toContain('a gap is a number of design units')
  })
  it('skips a member it cannot measure or move, and says so', async () => {
    const h = page([R(0), node('USE', { ref: 's' }), R('$x' as never)], [[0], [1], [2]])
    await run(h, 'align.left')
    expect(h.notes.at(-1)).toBe('2 skipped: no box')
  })
  it('aligns several to their union even when one alone has a box (it stays), and keeps a locked member as it is', async () => {
    const h = page([R(10), node('USE', { ref: 's' })], [[0], [1]])
    await run(h, 'align.left')
    expect(h.root()[0].attrs.x).toBe(10)
    expect(h.state().past).toHaveLength(0)
    const l = page([{ ...R(0), comments: ['lock'] }, R(30, 20)], [[0], [1]])
    await run(l, 'align.right')
    expect(l.root().map(n => n.attrs.x)).toEqual([0, 30])
    expect(l.notes.at(-1)).toBe('1 skipped: locked')
    expect(l.state().past).toHaveLength(0)
  })
  it('says what it needs when too few members have a box', async () => {
    const h = page([R(0), R(20), node('USE', { ref: 's' })], [[0], [1], [2]])
    await run(h, 'distribute.x')
    expect(h.notes.at(-1)).toBe('this needs 3 or more nodes with a box; 1 skipped: no box')
    expect(h.state().past).toHaveLength(0)
  })
  it('aligns top, middle and bottom, and distributes and sets a gap down, leaving x alone', async () => {
    const V = (y: number, h = 10) => node('R', { x: 0, y, w: 10, h })
    const ys = async (id: string, nodes: SrcNode[], arg?: string) => {
      const h = page(nodes, nodes.map((_, k) => [k]))
      await run(h, id, arg)
      expect(h.root().map(n => n.attrs.x)).toEqual(nodes.map(() => 0))
      return h.root().map(n => n.attrs.y)
    }
    expect(await ys('align.top', [V(5), V(20, 30)])).toEqual([5, 5])
    expect(await ys('align.middle', [V(0), V(20, 30)])).toEqual([20, 10])
    expect(await ys('align.bottom', [V(0), V(20, 30)])).toEqual([40, 20])
    expect(await ys('distribute.y', [V(0), V(13), V(50)])).toEqual([0, 25, 50])
    expect(await ys('gap.y', [V(0), V(30), V(13, 5)], '4')).toEqual([0, 23, 14])
  })
  it('overlaps the members by a negative gap, and reads a gap as people type it', async () => {
    const gap = async (arg: string) => {
      const h = page([R(0), R(30)], [[0], [1]])
      await run(h, 'gap.x', arg)
      return h.root()[1].attrs.x
    }
    expect(await gap('-2')).toBe(8)
    expect(await Promise.all(['4,5', ' +4 ', '4.', '.5', '1e1'].map(gap))).toEqual([14.5, 14, 14, 10.5, 20])
    expect(await Promise.all(['0x10', '0b11', '1e999', '4 5', ''].map(gap))).toEqual([30, 30, 30, 30, 30])
  })
  it('skips a hidden member, or one under a hidden group, and does not line up with it', async () => {
    const h = page([R(0), R(50), node('G', { v: 0 }, [R(-1000)]), R(20, 10, { v: 0 })], [[0], [1], [2, 0], [3]])
    await run(h, 'align.left')
    expect(h.root().map(n => n.attrs.x)).toEqual([0, 0, undefined, 20])
    expect(h.root()[2].c![0].attrs.x).toBe(-1000)
    expect(h.notes.at(-1)).toBe('2 skipped: hidden')
  })
  it('aligns a member through a scaled and turned group to the others', async () => {
    const h = page([R(0), node('G', { t: [100, 40], s: [2, 2], r: 90 }, [R(0)])], [[0], [1, 0]])
    await run(h, 'align.left')
    expect(worldBox(h.scene(), [1, 0])!.x).toBeCloseTo(0, 6)
    await run(h, 'align.top')
    expect(worldBox(h.scene(), [1, 0])!.y).toBeCloseTo(0, 6)
    expect(h.root()[0].attrs).toMatchObject({ x: 0, y: 0 })
  })
  it('moves nothing when distribute or gap would have to move a locked member, and says so', async () => {
    const locked = (x: number) => ({ ...R(x), comments: ['lock'] })
    const g = page([R(0), locked(30), R(100)], [[0], [1], [2]])
    await run(g, 'gap.x', '4')
    expect(g.root().map(n => n.attrs.x)).toEqual([0, 30, 100])
    expect(g.notes.at(-1)).toBe('1 skipped: locked; nothing moved: the spacing needs every one of them to move')
    expect(g.state().past).toHaveLength(0)
    const d = page([R(0), locked(30), R(50), R(100)], [[0], [1], [2], [3]])
    await run(d, 'distribute.x')
    expect(d.root().map(n => n.attrs.x)).toEqual([0, 30, 50, 100])
    expect(d.state().past).toHaveLength(0)
    const end = page([locked(0), R(13), R(50)], [[0], [1], [2]])   // an outer member stays anyway
    await run(end, 'distribute.x')
    expect(end.root().map(n => n.attrs.x)).toEqual([0, 25, 50])
  })
})

describe('select all', () => {
  it('selects every visible, unlocked root node', () => {
    const h = page([R(0), R(1, 10, { v: 0 }), { ...R(2), comments: ['lock'] }, node('G', {}, [R(3)])], [])
    void run(h, 'selectAll')
    expect([...h.state().also, h.state().selection].map(x => x!.path)).toEqual([[0], [3]])
  })
  it('leaves the selection alone when every root node is hidden or locked', () => {
    const h = page([{ ...R(0), comments: ['lock'] }, R(1, 10, { v: 0 })], [[0]])
    expect(COMMANDS.find(c => c.id === 'selectAll')!.when(h.ctx)).toBe(false)
    void run(h, 'selectAll')
    expect(h.state().selection?.path).toEqual([0])
  })
})

describe('bindings', () => {
  it('puts each command on its key', () => {
    const ids = ['align.left', 'align.centre', 'align.right', 'align.top', 'align.middle', 'align.bottom', 'distribute.x', 'distribute.y',
      'gap.x', 'gap.y', 'selectAll', 'style.copy', 'style.paste']
    expect(ids.map(id => COMMANDS.find(c => c.id === id)!.keys?.join(' ') ?? '')).toEqual(['Alt+A', 'Alt+H', 'Alt+D', 'Alt+W', 'Alt+V', 'Alt+S',
      'Alt+Shift+H', 'Alt+Shift+V', '', '', 'Mod+A', 'Mod+Alt+C', 'Mod+Alt+V'])
    expect(['gap.x', 'gap.y'].map(id => COMMANDS.find(c => c.id === id)!.ask)).toEqual([undefined, undefined])
  })
})
