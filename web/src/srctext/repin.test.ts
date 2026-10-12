import { expect, it } from 'vitest'
import { DEF_OPS, NODE_OPS, fieldOf, fieldsFor } from '../schema'
import { trapsOf } from '../schema/traps'
import { duplicateIds } from '../schema/duplicateIds'
import { parseOrder } from '../model/numbering'
import { parseSrc } from './parse'
import { validateScene, substitute } from './validate'
import { printSrc } from './print'
import { fromProps } from './fromProps'
import { textReads } from '../widgets/paint'
import { textOf } from './props'
import { checkScene } from './check'
import type { Scene } from '../model/scene'
import { clickTargets } from '../codegen/clicks'
import { newProject } from '../model/project'
import { vanillaPlus } from '../theme/vanillaPlus'
import { generate } from '../codegen/generate'

const scene = (src: string): Scene => {
  const parsed = parseSrc(src)
  expect(parsed.errors).toEqual([])
  return parsed.scene!
}
const reports = (s: Scene) => [...validateScene(s).warnings, ...trapsOf(s)].map(p => p.message)

it('exposes FONT only as a direct definition with one strict src field', () => {
  expect(DEF_OPS).toContain('FONT')
  expect(NODE_OPS).not.toContain('FONT')
  expect(fieldsFor('font').map(f => f.key)).toEqual(['src'])
  expect(fieldOf('font', 'SRC')).toMatchObject({ kind: 'S', type: 'string' })
  for (const src of ['https://example.invalid/font.ttf', '   ']) {
    const s = scene(`DEFS {\n font SRC="${src}"\n}\nR`)
    expect(reports(s)).toEqual([])
    expect(scene(printSrc(s)).defs[0].attrs.SRC).toBe(src)
  }
  for (const src of ['', 'src=""', 'src=123']) {
    const s = scene(`DEFS {\n FONT ${src}\n}\nR`)
    expect(validateScene(s).errors).toEqual([])
    expect(reports(s)).toContain('FONT: src needs a non-empty string URL')
  }
  for (const key of ['id', 'font', 'f', 'o', 'c', 'style']) {
    const s = scene('DEFS {\n FONT src=url\n}\nR')
    if (key === 'c') s.defs[0].c = [{ op: 'R', attrs: {} }]
    else s.defs[0].attrs[key] = 'x'
    expect(reports(s).some(m => m.includes('unknown attribute') && m.includes(key))).toBe(true)
  }
  for (const src of ['FONT src=url', 'G {\n FONT src=url\n}', 'DEFS {\n SYM id=s {\n FONT src=url\n }\n}\nUSE ref=s']) {
    const s = scene(src)
    expect(reports(s).some(m => /FONT.*not supported|not supported.*FONT/.test(m))).toBe(true)
    expect(parseOrder(s).ops).not.toContain('FONT')
  }
})

it('reads numeric free text consistently for symbols, ids and their diagnostics', () => {
  const s = scene('DEFS {\n SYM id=12 {\n T text=42\n }\n}\nUSE ref=12\nR id=42\nR ID=42')
  expect(validateScene(s).errors).toEqual([])
  expect(parseOrder(s).ops).toEqual(['USE', 'T', 'R', 'R'])
  expect(duplicateIds(s)).toHaveLength(1)
  expect(trapsOf(s).filter(t => t.id === 'not-text' || t.id === 'undeclared')).toEqual([])
  expect(duplicateIds(scene('DEFS {\n SYM id=12345678 {\n R id=1\n }\n}\nUSE ref=12345678\nUSE ref=12345678'))).toHaveLength(1)
})

it('splices the longest parameter at a name boundary, independent of argument order', () => {
  const args: [string, number][] = [['i', 3], ['idx', 7], ['w', 10], ['opacity', 2], ['Ω', 9]]
  for (const a of [args, [...args].reverse()])
    expect(substitute('i=%i idx=%idx %wpx %opacity %Ω %Ωx', a, { units: 0 })).toBe('i=3 idx=7 %wpx 2 9 %Ωx')
})

it('keeps more than 10000 instances and 100000 expanded nodes while rejecting cycles', () => {
  const s: Scene = { header: {}, defs: [{ op: 'SYM', attrs: { id: 's' }, c: Array.from({ length: 10 }, () => ({ op: 'R', attrs: {} })) }],
    root: Array.from({ length: 10001 }, () => ({ op: 'USE', attrs: { ref: 's' } })) }
  expect(validateScene(s)).toMatchObject({ errors: [], warnings: [] })
  expect(validateScene(s).tooLarge).toBeUndefined()
  expect(parseOrder(s).ops).toHaveLength(110011)
  expect(validateScene(scene('DEFS {\n SYM id=1 {\n USE ref=1\n }\n}\nUSE ref=1')).errors.some(p => p.message.includes('uses itself'))).toBe(true)
})

it('handles the final placeholder escapes and first expression colon in binding discovery', () => {
  expect(textReads('{=$first:%d:$notData} {$v:{0:F1}} {$x:x{{y} {$last}')).toEqual([
    { name: 'first', via: 'expr' }, { name: 'v', via: 'text' }, { name: 'x', via: 'text' }, { name: 'last', via: 'text' }])
})

it('converts numeric-readable booleans and numeric text strings but preserves strict FONT src', () => {
  const r = fromProps([['root', { a: [{ m: [['op', 'T'], ['text', '123'], ['wrap', { b: true }], ['v', { b: false }]] }] }],
    ['defs', { a: [{ m: [['op', 'FONT'], ['src', '123']] }] }]])
  expect(r.scene.root[0].attrs).toEqual({ text: 123, wrap: 1, v: 0 })
  expect(r.scene.defs[0].attrs.src).toBe('123')
  expect(r.warnings).toHaveLength(1)
})

it('retains numeric-looking strings in strict numeric lists instead of changing their values', () => {
  const r = fromProps([['root', { a: [{ m: [['op', 'L'], ['p', { a: ['2', { b: true }, 4, 5] }]] }] }]])
  expect(r.scene.root[0].attrs.p).toEqual(['2', 1, 4, 5])
  expect(r.warnings).toHaveLength(1)
})

it('uses numeric text for click ids and font requirements, preserving builder page ids', () => {
  const p = newProject()
  p.pages[0].scene = scene('R ID=12345678 click=1\nT FONT=12345678 text=42')
  expect(clickTargets(p.pages[0], vanillaPlus)).toEqual([
    { id: '12345680', page: 'p1', step: '', press: false, inRepeat: false }])
  expect(generate(p, page => printSrc(page.scene)).problems.some(p => p.message.includes('font "12345680"'))).toBe(true)
})

it('matches the invariant float text measured through the tagged parser', () => {
  for (const [value, text] of [[0, '0'], [-0, '-0'], [0.000001, '0'], [-0.000001, '-0'], [0.000005, '0.00001'],
    [0.000015, '0.00002'], [1.23456789, '1.23457'], [12345678, '12345680'], [1e21, '1000000000000000000000'],
    [3.4028235e38, '340282300000000000000000000000000000000'], [9.999995, '10']] as const)
    expect(textOf(value), String(value)).toBe(text)
})

it('reports authored unit, unclosed placeholders, negative radii and colours in numeric slots as warnings', () => {
  for (const src of ['T text=literal unit=kPa', 'T text="{$v"', 'T text="{$v:{0:F1}"', 'C ry=4', 'C rx=-4', 'R x="=mix(#000,#fff,t)"',
    'T text="{=if(1,#000,2)}"', 'T text="{$v[if(1,#000,2)]}"', 'GL id=g stops=[["=if(1,#000,2)",#fff]]', 'R sh=["=t",0,2,0,#000]']) {
    const s = scene(src.startsWith('GL') ? `DEFS {\n${src}\n}\nR` : src)
    expect(validateScene(s).errors, src).toEqual([])
    expect(reports(s).some(m => m.includes('the mod reports')), src).toBe(true)
  }
  for (const src of ['T unit=kPa', 'C rx=0', 'C rx="=t"', 'R click=0', 'G fit=stretch {\nT text=a\n}'])
    expect(reports(scene(src)), src).toEqual([])
})

it('checks FONT exactly once and retains declarations in checked source without requests', () => {
  const c = checkScene(scene('DEFS {\nFONT src=1 id=2\n}\nR'))
  expect(c.errors).toEqual([])
  expect(c.warnings).toHaveLength(2)
  expect(c.src).toContain('FONT src=1 id=2')
})

it('reports only the tagged literal-only key sets and skips USE parameters', () => {
  for (const src of ['SCENE w=$w\nR', 'SP p=[0,0,1,1] seg==t', 'G m=[1,0,0,1,"=t",0] {\nR\n}', 'DEFS {\nGL id=g n=$n\n}\nR'])
    expect(reports(scene(src)).some(m => m.includes('not evaluated') && m.includes('the mod reports')), src).toBe(true)
  expect(reports(scene('DEFS {\nSYM id=s {\nR x=%n\n}\n}\nUSE ref=s n==t')).some(m => m.includes('not evaluated'))).toBe(false)
})

it('reports unknown weight and tile words but accepts their defaults and aliases', () => {
  for (const src of ['T text=a weight=heavy', 'IMG src=a tile=squash'])
    expect(reports(scene(src)).some(m => m.includes('the mod reports')), src).toBe(true)
  for (const src of ['T text=a weight=normal', 'T text=a weight=700', 'IMG src=a tile=contain', 'G fit=stretch {\nT text=a align=centre\n}'])
    expect(reports(scene(src)), src).toEqual([])
})
