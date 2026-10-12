import { describe, expect, it } from 'vitest'
import { newProject } from '../model/project'
import { px } from '../model/shapes'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { datum, lit, num, previewData, quote } from './lua'

describe('the preview data element', () => {
  it('sends only what src data can carry, under any non-empty name', () => {
    const p = newProject()
    const page = { ...p.pages[0], scene: putWidget(p.pages[0].scene, instance('light'), vanillaPlus),
      preview: { a: NaN, b: {}, c: [1, 'x'], d: [], 'e f': 1, g: true, température: 2, '': 3, constructor: 4 } as never }
    expect(previewData(page, vanillaPlus)).toEqual({ lt1_st: 1, 'e f': 1, température: 2, constructor: 4 })
    expect(previewData({ ...page, preview: { lt1_st: 3 } }, vanillaPlus)).toEqual({ lt1_st: 3 })
    expect([datum(NaN), datum(Infinity), datum(1e50), datum([]), datum([1, 'x']), datum(true)])
      .toEqual(Array(6).fill(undefined))
    expect([datum(1), datum('x'), datum([1, 2]), datum(['x'])]).toEqual([1, 'x', [1, 2], ['x']])
  })
  it('reads a size only from a number or a non-blank string', () => {
    for (const v of [null, '', [], {}, '  ']) expect(px(v)).toBe(460)
    expect(px('12')).toBe(12)
  })
  it('quotes names as Lua 5.2 strings', () => {
    expect(quote('a"b\\c\n1')).toBe('"a\\"b\\\\c\\0101"')
  })
})

describe('num and lit', () => {
  it('write doubles and literals as Lua reads them', () => {
    expect([num(1), num(-0), num(0.1), num(1e21), num(NaN)]).toEqual(['1', '0', '0.1', '1e+21', '0'])
    expect(lit([1, 'a"b', true])).toBe('{ 1, "a\\"b", true }')
    expect(lit({})).toBe('nil')
  })
})
