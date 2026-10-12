import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
beforeEach(() => { let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 1_000_000) })
afterEach(() => vi.restoreAllMocks())
import type { Scene, SrcNode } from '../../model/scene'
import { node } from '../../model/testing'
import { indexedReads } from '../../../test/work'
import { invalid, tooLarge, type Checked } from '../../srctext/check'
import { membersOf } from '../ctx'
import { COMMANDS } from '../registry'
import { harness } from '../testing'

const ok = (): Checked => ({ errors: [], warnings: [], src: 'R', order: { ops: [], nodes: [] } })
const page = (root: SrcNode[], sel: number[][] = [], defs: SrcNode[] = []) => {
  const at = sel.map(path => ({ pageId: 'p1', path }))
  return harness({ header: { w: 460, h: 460 }, defs, root } as Scene, { sel: at.at(-1) ?? null, also: at.slice(0, -1), verdict: ok })
}
const run = (h: ReturnType<typeof harness>, id: string) => COMMANDS.find(c => c.id === id)!.run(h.ctx)
const sel = (h: ReturnType<typeof harness>) => [...h.state().also, h.state().selection].filter(Boolean).map(x => x!.path)
const R = (x: number, more = {}) => node('R', { x, y: 0, w: 10, h: 10, ...more })

describe('delete, duplicate, copy, paste', () => {
  it('deletes every member and what is under it, in one undo step', async () => {
    const h = page([R(0), node('G', {}, [R(1)]), R(2)], [[0], [1, 0]])
    await run(h, 'delete')
    expect(h.root()).toEqual([node('G', {}, []), R(2)])
    expect(h.state().selection).toBeNull()
    expect(h.state().past).toHaveLength(1)
  })
  it('deletes a selected native widget (M2b T9: it lives in the page, not the scene) in one undo step', async () => {
    const h = page([R(0)])
    h.ctx.dispatch({ type: 'insertWidget', pageId: 'p1', widget: 'icon' })   // selects it
    expect(h.state().selection).toMatchObject({ path: [], native: 'ico1' })
    const before = h.state().past.length
    await run(h, 'delete')
    expect(h.ctx.page().natives ?? []).toEqual([])
    expect(h.root()).toEqual([R(0)])
    expect([h.state().selection, h.state().past.length]).toEqual([null, before + 1])
  })
  it('offers no command that acts on members while a native widget is selected: it is no member (membersOf)', () => {
    const h = page([R(0)])
    h.ctx.dispatch({ type: 'insertWidget', pageId: 'p1', widget: 'icon' })
    expect(membersOf(h.ctx)).toEqual([])
    const offered = ['duplicate', 'copy', 'cut', 'hide', 'lock', 'nudge.ArrowLeft'].filter(id => COMMANDS.find(c => c.id === id)!.when(h.ctx))
    expect(offered).toEqual([])
  })
  it('duplicates each member +10 units right after it, with a fresh id, the copies selected', async () => {
    const h = page([R(0, { id: 'btn' }), node('G', { s: [2, 2] }, [R(0)])], [[0], [1, 0]])
    await run(h, 'duplicate')
    expect(h.root()[1].attrs).toMatchObject({ id: 'btn2', x: 10, y: 10 })
    expect(h.root()[2].c![1].attrs).toMatchObject({ x: 5, y: 5 })
    expect(sel(h)).toEqual([[1], [2, 1]])
  })
  it('duplicates on a page too large to check here (M2b final-wave ruling 1): the copy lands, the reason is information', async () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [R(0)] } as Scene, { sel: { pageId: 'p1', path: [0] }, verdict: () => tooLarge('x') })
    await run(h, 'duplicate')
    expect(h.root().map(n => n.attrs.x)).toEqual([0, 10])
    expect([sel(h), h.state().past.length]).toEqual([[[1]], 1])
    expect(h.status()).toContain('too large to check here (x)')
  })
  it('copies, then pastes +10 per paste on the same page and in place on another; cut removes', async () => {
    const h = page([R(0, { id: 'a' })], [[0]])
    await run(h, 'copy')
    await run(h, 'paste')
    await run(h, 'paste')
    expect(h.root().map(n => [n.attrs.id, n.attrs.x])).toEqual([['a', 0], ['a2', 10], ['a3', 20]])
    h.ctx.dispatch({ type: 'addPage' })
    await run(h, 'paste')
    expect(h.ctx.page().scene.root.map(n => n.attrs.x)).toEqual([0])
    const c = page([R(0), R(5)], [[1]])
    await run(c, 'cut')
    expect(c.root()).toEqual([R(0)])
    expect(c.ctx.clip.text).toContain('R x=5')
  })
  // The undo kept the copy's path, which then named the neighbour that moved into its slot.
  it('undo gives back the set from before a duplicate or a paste, redo the one after; never a neighbour at the copy\'s path', async () => {
    const scene = () => [R(0, { id: 'btn' }), R(20, { f: '@g1' }), node('G', {}, [R(40)])]
    const one = page(scene(), [[0]])
    await run(one, 'duplicate')
    expect(sel(one)).toEqual([[1]])
    await run(one, 'undo')
    expect(one.root()).toEqual(scene())
    expect(sel(one)).toEqual([[0]])   // btn, not the R now at [1]
    await run(one, 'redo')
    expect(one.root()[1].attrs.id).toBe('btn2')
    expect(sel(one)).toEqual([[1]])
    const set = page(scene(), [[0], [2, 0]])
    await run(set, 'duplicate')
    expect(sel(set)).toEqual([[1], [3, 1]])
    await run(set, 'undo')
    expect(sel(set)).toEqual([[0], [2, 0]])
    await run(set, 'redo')
    expect(sel(set)).toEqual([[1], [3, 1]])
    const p = page(scene(), [[0]])
    await run(p, 'copy')
    await run(p, 'paste')
    expect(sel(p)).toEqual([[3]])
    await run(p, 'undo')
    expect(sel(p)).toEqual([[0]])
    await run(p, 'redo')
    expect(sel(p)).toEqual([[3]])
  })
})

describe('group and ungroup', () => {
  it('groups members of one parent at the topmost member\'s slot, in their order; refuses two parents', async () => {
    const h = page([R(0), R(1), R(2)], [[2], [0]])
    await run(h, 'group')
    expect(h.root()).toEqual([R(1), node('G', {}, [R(0), R(2)])])
    expect(sel(h)).toEqual([[1]])
    const two = page([node('G', {}, [R(0)]), R(1)], [[0, 0], [1]])
    await run(two, 'group')
    expect(two.notes).toContain('group: the nodes must share one parent')
  })
  it('ungroups a translating, painting group losslessly: t into each child, paint defaults onto those that lack them', async () => {
    const h = page([node('G', { id: 'g', t: [10, 0], f: '#fff', s_: '#f00' }, [R(0), node('C', { cx: 0, cy: 0, rx: 1, f: '#000' })])], [[0]])
    await run(h, 'ungroup')
    expect(h.root()).toEqual([R(10, { f: '#fff', s: '#f00' }), node('C', { cx: 10, cy: 0, rx: 1, f: '#000', s: '#f00' })])
    expect(sel(h)).toEqual([[0], [1]])
  })
  it('refuses what has no equal on the children, naming the key; unwraps a turn wrapper at r 0', async () => {
    const h = page([node('G', { r: 30 }, [R(0)])], [[0]])
    await run(h, 'ungroup')
    expect(h.notes).toContain('r on the group has no equal on its children')
    const w = page([node('G', { a: [5, 5], r: 0 }, [R(0)])], [[0]])
    await run(w, 'ungroup')
    expect(w.root()).toEqual([R(0)])
  })
})

describe('z-order', () => {
  const A = R(0), B = R(100), C = R(5)
  it('one step goes past the nearest overlapping sibling, else one slot; front and back go to the ends', async () => {
    const f = page([A, B, C], [[0]])
    await run(f, 'forward')
    expect(f.root()).toEqual([B, C, A])
    expect(sel(f)).toEqual([[2]])
    const b = page([A, B, C], [[2]])
    await run(b, 'backward')
    expect(b.root()).toEqual([C, A, B])
    const one = page([B, A], [[0]])
    await run(one, 'forward')
    expect(one.root()).toEqual([A, B])
    const front = page([A, B, C], [[0], [1]])
    await run(front, 'front')
    expect(front.root()).toEqual([C, A, B])
    expect(sel(front)).toEqual([[1], [2]])
    await run(front, 'back')
    expect(front.root()).toEqual([A, B, C])
  })
})

describe('z-order across levels', () => {
  it('reorders a nested list and its ancestor list in one step, each member followed to its new path', async () => {
    const h = page([node('G', {}, [R(0), R(50)]), R(200)], [[1], [0, 0]])
    await run(h, 'back')
    expect(h.root()).toEqual([R(200), node('G', {}, [R(0), R(50)])])
    await run(h, 'front')
    expect(h.root()).toEqual([node('G', {}, [R(50), R(0)]), R(200)])
    expect(sel(h)).toEqual([[1], [0, 1]])
    expect(h.root()[0].c![1]).toEqual(R(0))
  })
  it('keeps a subtree box when an SC viewport is not literal, and indexes reused nodes through each transform', async () => {
    const clipped = node('G', {}, [node('SC', { x: '=x', y: 0, w: 10, h: 10 }, [R(0)])])
    const h = page([R(0), R(100), clipped], [[0]])
    await run(h, 'forward')
    expect(h.root()).toEqual([R(100), clipped, R(0)])
    const shared = R(0), near = node('G', { t: [0, 0] }, [shared]), far = node('G', { t: [100, 0] }, [shared])
    const reused = page([shared, far, near], [[0]])
    await run(reused, 'forward')
    expect(reused.root()).toEqual([far, near, shared])
  })
  it('moves the chosen slot when one node object sits in two places', async () => {
    const A = R(0), h = page([A, R(100), A], [[2]])
    await run(h, 'back')
    expect(h.root().map(n => n.attrs.x)).toEqual([0, 0, 100])
    expect(sel(h)).toEqual([[0]])
  })
})

describe('ungroup keeps what the children inherited', () => {
  it('a block child gets the group form, its own form where its op reads it; a USE child refuses', async () => {
    const h = page([node('G', { f: '#fff', s_: '#f00' }, [node('G', {}, [R(0)]), node('SC', { x: 0, y: 0, w: 9, h: 9 }, [R(1)])])], [[0]])
    await run(h, 'ungroup')
    expect(h.root().map(n => n.attrs)).toEqual([{ f: '#fff', s_: '#f00' }, { x: 0, y: 0, w: 9, h: 9, f: '#fff', s_: '#f00' }])
    const use = page([node('G', { f: '#fff' }, [node('USE', { ref: 'b' })])], [[0]])
    await run(use, 'ungroup')
    expect(use.notes).toContain('f on the group reaches the symbol child 1 draws, and a USE cannot carry it')
  })
  it('passes down only the defaults the mod matches (case and all)', async () => {
    const h = page([node('G', { F: '#fff' }, [R(0)])], [[0]])
    await run(h, 'ungroup')
    expect(h.notes).toContain('F on the group has no equal on its children')
  })
  it('locks every child of a locked group, and keeps the group\'s comments above its first child', async () => {
    const g = { ...node('G', {}, [R(0), { ...R(1), comments: ['mine'] }]), comments: ['Lock', 'note'], eol: 'end', tail: ['last', ' lock'] }
    const h = page([g], [[0]])
    await run(h, 'ungroup')
    expect(h.root().map(n => n.comments)).toEqual([['lock', 'note', 'end', 'last'], ['lock', 'mine']])
  })
})

// Count root reads instead of CPU time; a per-member whole-list copy exhausts the bound promptly.
describe('a command on a set of every root takes one pass (one write per member copied the root list each time: 4e10 copies)', () => {
  const N = 200_000, all = Array.from({ length: N }, (_, k) => [k]), big = () => {
    const reads = indexedReads(Array.from({ length: N }, (_, k) => R(k)), 64 * N)
    return { h: page(reads.values, all), reads }
  }
  it('hides, locks, duplicates and deletes 200,000 members', async () => {
    const cases = [big(), big(), big(), big()], [hide, lock, dup, del] = cases.map(c => c.h)
    for (const [i, id] of ['hide', 'lock', 'duplicate', 'delete'].entries()) {
      const { h, reads } = cases[i]; reads.reset(); await run(h, id)
      expect(reads.count()).toBeLessThanOrEqual(64 * N)
    }
    expect(hide.root().every(n => n.attrs.v === 0)).toBe(true)
    expect(lock.root().every(n => n.comments?.[0] === 'lock')).toBe(true)
    expect([dup.root().length, dup.root()[1].attrs.x, dup.root()[3].attrs.x, sel(dup).length]).toEqual([2 * N, 10, 11, N])
    expect(del.root()).toEqual([])
  }, 60_000)
})

describe('duplicate and paste, beyond the offset', () => {
  it('makes every node of a copy its own object', async () => {
    const h = page([node('G', {}, [R(0)])], [[0]])
    await run(h, 'duplicate')
    expect(h.root()[1].c![0]).toEqual(h.root()[0].c![0])
    expect(h.root()[1].c![0]).not.toBe(h.root()[0].c![0])
  })
  it('says why a copy stays in place, or moved on one axis only', async () => {
    const h = page([R(0, { x: '=t' })], [[0]])
    await run(h, 'duplicate')
    expect(h.notes).toEqual(['a copy moved only in part: x is an expression'])
    expect(h.root()[1].attrs).toMatchObject({ x: '=t', y: 10 })
    const both = page([R(0, { x: '=t', y: '=t' })], [[0]])
    await run(both, 'duplicate')
    expect(both.notes).toEqual(['a copy stays in place: x is an expression; y is an expression'])
  })
  it('says why a copy stays in place under a group that is not literal or is singular', async () => {
    for (const g of [node('G', { t: ['=t', 0] }, [R(0)]), node('G', { s: [0, 1] }, [R(0)])]) {
      const h = page([g], [[0, 0]])
      await run(h, 'duplicate')
      expect(h.notes).toEqual(['a copy stays in place: a group above it is not literal or is singular'])
      expect(h.root()[0].c![1]).toEqual(R(0))
    }
  })
})

describe('fix round 1: ungroup keeps what the group\'s id gives', () => {
  const refused = 'id on the group is what hover and down inside it answer to'
  const button = () => node('G', { id: 'save', t: [5, 5] },
    [R(0, { click: 1, id: 'save_box', fo: '=0.8+0.2*hover' }), node('T', { text: 'SAVE', fo: '=1-0.3*down' })])
  it('refuses, naming id, when a node that answers to the group\'s id reads hover or down', async () => {
    const h = page([button()], [[0]])
    await run(h, 'ungroup')
    expect(h.notes).toEqual([refused])
    expect(h.root()).toEqual([button()])
  })
  it('looks below nodes without an id, through defaults it pushes and into the symbol a USE draws', async () => {
    const deep = page([node('G', { id: 'b' }, [node('G', {}, [node('T', { text: 'x {=down}' })])])], [[0]])
    await run(deep, 'ungroup')
    expect(deep.notes).toEqual([refused])
    const pushed = page([node('G', { id: 'b', f: '=if(hover,#fff,#000)' }, [R(0)])], [[0]])
    await run(pushed, 'ungroup')
    expect(pushed.notes).toEqual([refused])
    const sym = page([node('G', { id: 'b' }, [node('USE', { ref: 's' })])], [[0]], [node('SYM', { id: 's' }, [R(0, { fo: '=hover' })])])
    await run(sym, 'ungroup')
    expect(sym.notes).toEqual([refused])
  })
  it('ungroups when nothing answers to it (a node with its own id answers to that), and says the id is dropped', async () => {
    const kids = [node('G', { id: 'inner' }, [R(0, { fo: '=hover' })]), R(1, { f: '$hover', fo: '=downs' })]
    const h = page([node('G', { id: 'b' }, kids)], [[0]])
    await run(h, 'ungroup')
    expect(h.root()).toEqual(kids)
    expect(h.notes).toEqual(['id b is dropped with the group'])
  })
})

describe('fix round 1: ungroup refuses an so an SC would not pass on; takes identity keys; drops a lock that locked nothing', () => {
  it('refuses so over an SC child (an SC keeps its own so: SceneModel.cs, v0.11.92 on)', async () => {
    const h = page([node('G', { so: 0.5 }, [R(0), node('SC', { x: 0, y: 0, w: 9, h: 9 }, [R(1)])])], [[0]])
    await run(h, 'ungroup')
    expect(h.notes).toEqual(["so on the group reaches what SC child 2 holds, and an SC's own so does not"])
    const f = page([node('G', { f: '#fff' }, [node('SC', { x: 0, y: 0, w: 9, h: 9 }, [R(1)])])], [[0]])
    await run(f, 'ungroup')
    expect(f.root()[0].attrs).toEqual({ x: 0, y: 0, w: 9, h: 9, f: '#fff' })
  })
  it('takes o 1, a v that shows and an identity m; refuses an o that fades', async () => {
    const h = page([node('G', { o: 1, v: 1, m: [1, 0, 0, 1, 0, 0] }, [R(0)])], [[0]])
    await run(h, 'ungroup')
    expect(h.root()).toEqual([R(0)])
    const o = page([node('G', { o: 0.5 }, [R(0)])], [[0]])
    await run(o, 'ungroup')
    expect(o.notes).toEqual(['o on the group has no equal on its children'])
  })
  it('drops a # lock that ended the group\'s line or closed its block: above a child it would lock it', async () => {
    const g = { ...node('G', {}, [R(0)]), eol: ' lock', tail: ['LOCK', 'kept'] }
    const h = page([g], [[0]])
    await run(h, 'ungroup')
    expect(h.root()[0].comments).toEqual(['kept'])
  })
})

describe('fix round 1: a copy takes its clip along', () => {
  const CP = (id: string, at = 0) => node('CP', { id }, [node('R', { x: at, y: at, w: 10, h: 10 })])
  it('duplicate gives a copy clipped on itself or under it a copy of the CP, moved with it, one per CP', async () => {
    const h = page([node('G', { clip: 'c' }, [R(0)]), node('G', {}, [node('G', { clip: 'c' }, [R(0)])])], [[0], [1]], [CP('c')])
    await run(h, 'duplicate')
    expect(h.root()[1].attrs).toEqual({ clip: 'c2', t: [10, 10] })
    expect(h.root()[3].c![0].attrs).toEqual({ clip: 'c2' })
    expect(h.root()[2].c![0].attrs).toEqual({ clip: 'c' })
    expect(h.scene().defs).toEqual([CP('c'), CP('c2', 10)])
    expect(h.notes).toEqual([])
  })
  it('paste does the same at its offset', async () => {
    const h = page([node('G', { clip: 'c' }, [R(0)])], [[0]], [CP('c')])
    await run(h, 'copy')
    await run(h, 'paste')
    await run(h, 'paste')
    expect(h.root().map(n => n.attrs)).toEqual([{ clip: 'c' }, { clip: 'c2', t: [10, 10] }, { clip: 'c3', t: [20, 20] }])
    expect(h.scene().defs).toEqual([CP('c'), CP('c2', 10), CP('c3', 20)])
  })
  it('says so when the CP\'s outline cannot move', async () => {
    const stuck = node('CP', { id: 'c' }, [node('R', { x: '$x', y: 0, w: 10, h: 10 })])
    const h = page([node('G', { clip: 'c' }, [R(0)])], [[0]], [stuck])
    await run(h, 'duplicate')
    expect(h.notes).toEqual(['clip c does not follow the copy'])
    expect(h.root()[1].attrs).toEqual({ clip: 'c', t: [10, 10] })
    expect(h.scene().defs).toEqual([stuck])
  })
})

describe('fix round 1: paste', () => {
  const nested = "pasted at the page's top level: what the group it was copied from gave it (transform, paint, opacity, scope) stays behind"
  it('says so when a copied node sat in a group', async () => {
    const h = page([node('G', { t: [50, 40] }, [R(10, { y: 10 })])], [[0, 0]])
    await run(h, 'copy')
    await run(h, 'paste')
    expect(h.notes).toEqual([nested])
    const top = page([R(0)], [[0]])
    await run(top, 'copy')
    await run(top, 'paste')
    expect(top.notes).toEqual([])
  })
  it('an undone paste no longer counts: the next lands where it did, +10, not +20', async () => {
    const h = page([R(0)], [[0]])
    await run(h, 'copy')
    await run(h, 'paste')
    await run(h, 'paste')
    h.ctx.dispatch({ type: 'undo' })
    h.ctx.dispatch({ type: 'undo' })
    await run(h, 'paste')
    await run(h, 'paste')
    expect(h.root().map(n => n.attrs.x)).toEqual([0, 10, 20])
  })
  it('says why a pasted node stays where it was copied', async () => {
    const h = page([R(0, { x: '=t', y: '=t' })], [[0]])
    await run(h, 'copy')
    await run(h, 'paste')
    expect(h.notes).toEqual(['a pasted node stays where it was copied: x is an expression; y is an expression'])
  })
  it('moves the next paste on only when one lands', async () => {
    let fail = false
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [R(0, { id: 'a' })] } as Scene,
      { sel: { pageId: 'p1', path: [0] }, verdict: () => fail ? invalid('no') : ok() })
    await run(h, 'copy')
    fail = true
    await run(h, 'paste')
    fail = false
    await run(h, 'paste')
    expect(h.root().map(n => [n.attrs.id, n.attrs.x])).toEqual([['a', 0], ['a2', 10]])
  })
})

describe('fix round 1: z-order at any depth', () => {
  it('steps the deepest node of a scene 100 000 groups deep (linear in depth)', async () => {
    const N = 100000
    let g: SrcNode = node('G', {}, [R(0), R(5)])
    for (let k = 1; k < N; k++) g = node('G', {}, [g])
    const h = page([g], [new Array<number>(N + 1).fill(0)])
    await run(h, 'forward')
    let at = h.root()[0]
    for (let k = 1; k < N; k++) at = at.c![0]
    expect(at.c).toEqual([R(5), R(0)])
    const p = sel(h)[0]
    expect([p.length, p[N - 1], p[N]]).toEqual([N + 1, 0, 1])
  })
})

describe('fix round 1: the gaps', () => {
  it('deletes a DEFS node from DEFS', async () => {
    const defs = [node('GL', { id: 'g' }), node('CP', { id: 'c' }, [R(0)])]
    const h = harness({ header: { w: 460, h: 460 }, defs, root: [R(0)] } as Scene, { sel: { pageId: 'p1', path: [1], inDefs: true }, verdict: ok })
    await run(h, 'delete')
    expect(h.scene().defs).toEqual([defs[0]])
    expect(h.root()).toEqual([R(0)])
  })
  it('groups inside a nested parent', async () => {
    const h = page([R(9), node('G', {}, [R(0), R(1), R(2)])], [[1, 2], [1, 0]])
    await run(h, 'group')
    expect(h.root()).toEqual([R(9), node('G', {}, [R(1), node('G', {}, [R(0), R(2)])])])
    expect(sel(h)).toEqual([[1, 1]])
  })
  it('says nothing of the marker when the hide changed nothing', async () => {
    const h = page([node('G', { v: 0 }, [R(0, { v: '=t' })])], [[0, 0]])
    await run(h, 'hide')
    expect(h.notes).toEqual(['1 skipped: v is an expression'])
  })
  it('puts both hide notes on one status line', async () => {
    const h = page([R(0), node('G', { v: 0 }, [R(1, { v: '=t' })])], [[0], [1, 0]])
    await run(h, 'hide')
    expect(h.notes).toEqual(['1 skipped: v is an expression; nothing on this page is shown now: the mod draws its magenta empty-scene marker'])
  })
})

describe('hide and lock', () => {
  it('says so when nothing on the page is shown any more, and hides anyway', async () => {
    const h = page([R(0), node('G', { v: 0 }, [R(1)])], [[0]])
    await run(h, 'hide')
    expect(h.root()[0].attrs.v).toBe(0)
    expect(h.notes).toContain('nothing on this page is shown now: the mod draws its magenta empty-scene marker')
  })
  it('show all and unlock all with nothing to do leave no undo step', async () => {
    const h = page([R(0)], [[0]])
    await run(h, 'showAll')
    await run(h, 'unlockAll')
    expect(h.state().past).toHaveLength(0)
  })
  it('hides with v=0 and shows again; skips an expression v; show all brings back every hidden node', async () => {
    const h = page([R(0), R(1, { v: '=t' }), node('G', { v: 0 }, [R(2, { V: 0.2 })])], [[0], [1]])
    await run(h, 'hide')
    expect(h.root()[0].attrs.v).toBe(0)
    expect(h.root()[1].attrs.v).toBe('=t')
    expect(h.notes).toContain('1 skipped: v is an expression')
    await run(h, 'hide')
    expect(h.root()[0].attrs).not.toHaveProperty('v')
    await run(h, 'showAll')
    expect(h.root()[2]).toEqual(node('G', {}, [R(2)]))
  })
  it('locks with # lock first (any member unlocked: all lock), unlocks, and unlock all clears the page', async () => {
    const h = page([{ ...R(0), comments: ['note'] }, { ...R(1), comments: ['lock'] }], [[0], [1]])
    await run(h, 'lock')
    expect(h.root().map(n => n.comments)).toEqual([['lock', 'note'], ['lock']])
    await run(h, 'lock')
    expect(h.root().map(n => n.comments)).toEqual([['note'], undefined])
    await run(h, 'lock')
    await run(h, 'unlockAll')
    expect(h.root()[1]).toEqual(R(1))
  })
})
