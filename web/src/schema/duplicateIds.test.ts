import { describe, expect, it } from 'vitest'
import type { Scene } from '../model/scene'
import { node } from '../model/testing'
import { checkScene } from '../srctext/check'
import { defKey, duplicateIds } from './duplicateIds'

const ROOT = (id: string) => `id "${id}" is used twice in this scene: both nodes report the same clicks and hover`
const BODY = (id: string, sym: string) => `id "${id}" in symbol "${sym}" is drawn more than once in this scene: every copy reports the same clicks and hover`

describe('duplicate-id', () => {
  it('flags the second node of one id in the root, and of one kind in DEFS, but not a gradient and a clip that share one', () => {
    const scene: Scene = { header: {}, defs: [node('CP', { id: 'k' }), node('GL', { id: 'k' }), node('GR', { id: 'k' })],
      root: [node('R', { id: 'a', x: 0, y: 0, w: 1, h: 1 }), node('G', {}, [node('R', { id: 'a', x: 0, y: 0, w: 1, h: 1 })]), node('R', { id: 'k' })] }
    const dups = duplicateIds(scene)
    expect(dups.map(t => [t.id, t.message])).toEqual([['duplicate-id', ROOT('a')],
      ['duplicate-id', 'gradient "k" is defined twice in DEFS: only one of them is used']])
    expect(dups[0].node).toBe(scene.root[1].c![0])
    expect(dups[1].node).toBe(scene.defs[2])
  })
  it('counts a symbol body as often as USE draws it, and only then', () => {
    const scene: Scene = { header: {}, root: [node('R', { id: 'a' }), node('R', { id: 'c' }), node('USE', { ref: 's' }), node('USE', { ref: 's' }), node('USE', { ref: 'u' })],
      defs: [node('SYM', { id: 's' }, [node('R', { id: 'b' }), node('R', { id: '%n%_x' })]),
        node('SYM', { id: 't' }, [node('R', { id: 'c' }), node('R', { id: 'c' })]),
        node('SYM', { id: 'u' }, [node('R', { id: 'a' })])] }
    const dups = duplicateIds(scene)
    expect(dups.map(t => t.message)).toEqual([BODY('b', 's'), BODY('a', 'u')])   // t is never drawn; %n% differs per USE
    expect(dups[0].node).toBe(scene.defs[0].c![0])
    expect(dups[1].node).toBe(scene.defs[2].c![0])
  })
  it('follows USE through symbols, cycles included', () => {
    const chain = (uses: number): Scene => ({ header: {}, root: Array.from({ length: uses }, () => node('USE', { ref: 'a' })),
      defs: [node('SYM', { id: 'a' }, [node('USE', { ref: 'b' })]), node('SYM', { id: 'b' }, [node('R', { id: 'z' }), node('USE', { ref: 'b' })])] })
    expect(duplicateIds(chain(0))).toEqual([])
    expect(duplicateIds(chain(1)).map(t => t.message)).toEqual([BODY('z', 'b')])   // b uses itself: drawn more than once
  })
  it('keys DEFS by table and id', () => {
    expect([node('GL', { id: 'k' }), node('GC', { id: 'k' }), node('CP', { id: 'k' }), node('FOO', { id: 'k' }), node('GL', {})].map(defKey))
      .toEqual(['gradient k', 'gradient k', 'clip k', 'FOO k', undefined])
  })
  it('walks 100,000 nested G nodes without throwing', () => {
    let deep = node('R', { id: 'a' })
    for (let k = 0; k < 100_000; k++) deep = node('G', {}, [deep])
    expect(duplicateIds({ header: {}, defs: [], root: [deep] })).toEqual([])
  })
  it('reaches the checker as a warning, never an error', () => {
    const r = node('R', { id: 'a', x: 0, y: 0, w: 1, h: 1, f: '#FFFFFF' })
    const c = checkScene({ header: {}, defs: [], root: [r, { ...r }] })
    expect([c.errors, c.warnings]).toEqual([[], [{ message: ROOT('a'), ref: { inDefs: false, path: [1] } }]])
  })
})
