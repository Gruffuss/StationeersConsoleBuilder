import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
beforeEach(() => { let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 1_000_000) })
afterEach(() => vi.restoreAllMocks())
import { node } from '../model/testing'
import { indexedReads } from '../../test/work'
import { parseSrc } from '../srctext/parse'
import { defClosure, editAt, editList, fresh, freshIds, IMAGE, idsFrom, idsOf, isLock, laterFirst, LOCK, lockedAt, mapTree, pathsOf, removeAt,
  renameIds, replaceAt } from './tree'

describe('tree edits', () => {
  const R = node('R'), C = node('C'), deep = [node('G', {}, [node('G', {}, [R, C])])]
  it('replaces one node, copying only the lists on its path', () => {
    const out = replaceAt(deep, [0, 0, 1], R)!
    expect(out[0].c![0].c).toEqual([R, R])
    expect(deep[0].c![0].c![1]).toBe(C)
    expect(replaceAt(deep, [0, 5], R)).toBeUndefined()
    expect(replaceAt(deep, [], R)).toBeUndefined()
  })
  it('edits many paths in one pass: f at each, children first, each list on the way copied once; a stray path is passed over', () => {
    const tag = (n: typeof R) => ({ ...n, attrs: { ...n.attrs, k: (n.c?.length ?? 0) } })
    const out = editAt(deep, [[0, 0, 1], [0], [0, 0, 7], [], [0, 0, 1]], tag)
    expect(out).toEqual([node('G', { k: 1 }, [node('G', {}, [R, node('C', { k: 0 })])])])
    expect(out[0].c![0].c![0]).toBe(R)
    expect(deep[0].c![0].c![1]).toBe(C)
    const flat = Array.from({ length: 200000 }, (_, x) => node('R', { x }))
    expect(editAt(flat, flat.map((_, i) => [i]), tag).every(n => n.attrs.k === 0)).toBe(true)   // one replaceAt per path: 4e10 copies
  })
  it('edits a child list; undefined for a path that does not reach a block', () => {
    expect(editList(deep, [0, 0], l => [...l, C])![0].c![0].c).toEqual([R, C, C])
    expect(editList(deep, [0, 0, 0], l => l)).toBeUndefined()
  })
  it('reads # lock on the node or above it', () => {
    const root = parseSrc('# lock\nG {\n  R x=1\n}\nR x=2\n').scene!.root
    expect(lockedAt(root, [0, 0])).toBe(true)
    expect(lockedAt(root, [1])).toBe(false)
    expect(lockedAt(root, [7])).toBe(false)
  })
  it('reads # lock loosely (case, spaces around it), but not another word', () => {
    const root = parseSrc('# lock \nR x=1\n# LOCK\nR x=2\n#  Lock\nR x=3\n# locked\nR x=4\n').scene!.root
    expect([0, 1, 2, 3].map(k => lockedAt(root, [k]))).toEqual([true, true, true, false])
    expect([isLock(' Lock '), isLock('unlock'), LOCK, IMAGE]).toEqual([true, false, 'lock', 'image'])
  })
})

describe('structure edits', () => {
  const R = node('R'), C = node('C'), T = node('T')
  it('removes at any depth; sorts paths later first, a child before its parent', () => {
    const tree = [node('G', {}, [R, C]), T]
    expect(removeAt(tree, [[0, 0], [1], [0, 9]])).toEqual([node('G', {}, [C])])
    expect([[0], [1], [0, 5]].sort(laterFirst)).toEqual([[1], [0, 5], [0]])
  })
  it('removes with one filter per parent list, nested parents too (one filter per path copied a long list per path)', () => {
    expect(removeAt([node('G', {}, [node('G', {}, [R, C, T]), C, T])], [[0, 0, 1], [0, 1], [0, 0, 1]])).toEqual([node('G', {}, [node('G', {}, [R, T]), T])])
    const tracked = indexedReads(Array.from({ length: 200_000 }, (_, x) => node('R', { x })), 400_000)
    const paths = tracked.values.map((_, i) => [i]).filter((_, i) => i % 2)
    tracked.reset()
    const out = removeAt(tracked.values, paths) // one filter per path: 2e10 reads
    expect([out.length, out[1].attrs.x]).toEqual([100_000, 2])
    expect(tracked.count()).toBe(200_000)
  })
  it('maps every node bottom-up and finds nodes by identity', () => {
    const tree = [node('G', {}, [R]), C]
    const up = mapTree(tree, n => ({ ...n, attrs: { ...n.attrs, k: 1 } }))
    expect(up).toEqual([node('G', { k: 1 }, [node('R', { k: 1 })]), node('C', { k: 1 })])
    expect([...pathsOf(tree, new Set([R, C])).values()]).toEqual([[0, 0], [1]])
  })
  it('collects the defs nodes reach, in DEFS order, through defs that reach others', () => {
    const defs = [node('GL', { id: 'g' }), node('CP', { id: 'c' }, [node('R', { f: '@g2' })]), node('GL', { id: 'g2' }), node('GL', { id: 'x' })]
    expect(defClosure([node('G', { clip: 'c' }, [node('R', { f: '@g' })])], defs).map(d => d.attrs.id)).toEqual(['g', 'c', 'g2'])
  })
  it('makes ids fresh against the project, references inside following; renames ids and their references', () => {
    const taken = new Set(['btn', 'btn2', 'g', 'r1']), ids = idsFrom(taken)
    expect(fresh('btn', ids)).toBe('btn3')
    expect(taken.has('btn3')).toBe(true)
    const out = freshIds([node('G', { id: 'g' }, [node('R', { id: 'r1', f: '@g' })])], ids)
    expect(out.nodes).toEqual([node('G', { id: 'g2' }, [node('R', { id: 'r2', f: '@g2' })])])
    expect(renameIds([node('USE', { ref: 's', clip: 'c' })], new Map([['s', 's2'], ['c', 'c2']]))).toEqual([node('USE', { ref: 's2', clip: 'c2' })])
    // a mask names its gradient as @id, the only form the mod reads
    expect(renameIds([node('G', { mask: '@m', f: '@m' })], new Map([['m', 'm2']]))).toEqual([node('G', { mask: '@m2', f: '@m2' })])
    expect(idsOf([{ header: {}, defs: [node('GL', { id: 'g' })], root: [node('G', {}, [node('R', { id: 'a' })])] }])).toEqual(new Set(['g', 'a']))
  })
})

describe('fix round 1: references', () => {
  it('leaves a label\'s text alone: an @ there is text, not a reference', () => {
    const map = new Map([['btn', 'btn2']])
    expect(renameIds([node('T', { text: '@btn', FMT: '@btn', unit: '@btn', missing: '@btn', f: '@btn' })], map))
      .toEqual([node('T', { text: '@btn', FMT: '@btn', unit: '@btn', missing: '@btn', f: '@btn2' })])
    expect(defClosure([node('T', { text: '@g' })], [node('GL', { id: 'g' })])).toEqual([])
  })
  it('makes an id fresh in time linear in its length (the digits it ends with are a loop, not a regex)', () => {
    const long = '1'.repeat(200000) + 'a'
    expect(fresh(long, idsFrom(new Set()))).toBe(long + '2')
    expect(fresh('x9a12', idsFrom(new Set(['x9a2'])))).toBe('x9a3')
  })
  it('names N copies of one stem in time linear in N: each stem counts on from where it stopped in the command', () => {
    const n = 50_000, nodes = Array.from({ length: n }, (_, k) => node('R', { id: 'r' + (k + 1) }))
    const out = freshIds(nodes, idsFrom(new Set(nodes.map(x => x.attrs.id as string))))   // from 2 on every call: ~4e9 lookups
    expect([out.map.size, new Set(out.nodes.map(x => x.attrs.id)).size, out.map.get('r1'), out.map.get('r50000')]).toEqual([n, n, 'r100000', 'r50001'])
  })
})
