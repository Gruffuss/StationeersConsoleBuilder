import { describe, expect, it } from 'vitest'
import type { Scene, SrcNode, Value } from '../model/scene'
import { node } from '../model/testing'
import { printSrc } from './print'
import { pack, unpack } from './wire'

describe('pack and unpack', () => {
  it('carry a scene of any depth, where structured clone gives up', () => {
    // Comments and an end-of-line comment on the deepest node and on the outermost, notes on the scene.
    let deep: SrcNode = { ...node('R', { p: [1] }), comments: ['deep'], eol: 'deep eol' }
    for (let k = 0; k < 100_000; k++) deep = node('G', {}, [deep])
    deep = { ...deep, comments: ['top', 'two'], eol: 'top eol', tail: ['tail'] }
    let arr: Value = [-0]
    for (let k = 0; k < 100_000; k++) arr = [arr]
    const s: Scene = { header: { w: 1 }, defs: [node('R', { p: arr })], root: [deep],
      notes: { header: ['h'], defs: ['d'], defsTail: ['dt'], tail: ['t'] } }
    expect(() => structuredClone(s)).toThrow()
    const back = unpack(structuredClone(pack(s))) as Scene
    expect(printSrc(back)).toBe(printSrc(s))
    for (const text of ['# deep', 'deep eol', '# top', '# two', 'top eol', '# tail', '# h', '# d', '# dt', '# t']) expect(printSrc(back)).toContain(text)
    let a = back.defs[0].attrs.p
    while (Array.isArray(a)) a = a[0]
    expect(Object.is(a, -0)).toBe(true)
  }, 30_000)   // deep: slow under a loaded machine, as checker.test.ts's 100,000-check test
  it('keep every kind of value, an attribute named __proto__, and undefined', () => {
    const attrs: Record<string, Value> = Object.create(null)
    attrs['__proto__'] = 5
    attrs.s = 'x'
    const s = { header: {}, defs: [], root: [{ op: 'R', attrs, c: [], eol: undefined }] }
    const back = unpack(structuredClone(pack(s))) as typeof s
    expect(Object.keys(back.root[0].attrs)).toEqual(['__proto__', 's'])
    expect(back.root[0].attrs['__proto__']).toBe(5)
    expect('eol' in back.root[0] && back.root[0].eol === undefined).toBe(true)
    expect(back).toEqual(s)
    expect(unpack(pack('a'))).toBe('a')
    expect(unpack(pack([]))).toEqual([])
  })
})
