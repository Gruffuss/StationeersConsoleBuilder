import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
beforeEach(() => { let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 1_000_000) })
afterEach(() => vi.restoreAllMocks())
import { stringWork } from '../../test/work'
import type { Scene, SrcNode, Value } from '../model/scene'
import { parseSrc } from './parse'
import { firstWins, propsEqual, toProps, type Pairs, type Uv } from './props'

const dir = (d: string) => new URL(`../../test/srctext/${d}/`, import.meta.url)
const read = (d: string, f: string) => readFileSync(new URL(f, dir(d)), 'utf8')
const names = (d: string, ext: string) => readdirSync(dir(d)).filter(f => f.endsWith(ext)).map(f => f.slice(0, -ext.length)).sort()
const parsed = (name: string) => {
  const r = parseSrc(read('accept', `${name}.src`))
  expect(r.errors).toEqual([])
  return { ...r, scene: r.scene! }
}

describe('accept corpus: props equal the mod\'s ToProps', () => {
  const accept = names('accept', '.src')
  it('has every case and its golden', () => {
    expect(accept).toHaveLength(24)
    expect(names('accept', '.props.json')).toEqual(accept)
  })
  it.each(accept)('%s', name => {
    const golden: Pairs = JSON.parse(read('accept', `${name}.props.json`))
    expect(propsEqual(firstWins(toProps(parsed(name).scene)), firstWins(golden))).toBe(true)
  })
})

describe('reject corpus', () => {
  const reject = names('reject', '.src')
  it('has every case and its expectation', () => {
    expect(reject.length).toBeGreaterThanOrEqual(30)
    expect(names('reject', '.expect.json')).toEqual(reject)
  })
  it.each(reject)('%s', name => {
    const expected: { line: number; phrase: string } = JSON.parse(read('reject', `${name}.expect.json`))
    const r = parseSrc(read('reject', `${name}.src`))
    expect(r.scene).toBeUndefined()
    expect(r.errors[0].line).toBe(expected.line)
    expect(r.errors[0].message).toContain(expected.phrase)
  })
})

describe('parseSrc', () => {
  it('attaches own-line and end-of-line comments to their nodes (a11)', () => {
    const { scene, warnings } = parsed('a11')
    const [r1, t, r2, g] = scene.root
    expect(r1).toMatchObject({ comments: ['own-line before the first node'], eol: 'end of line' })
    expect(t).toMatchObject({ comments: ['no space'], eol: 'c', attrs: { text: 'a#b c', r: [1, 2] } })
    expect(r2).toMatchObject({ eol: 'c d=1', attrs: { a: 'b' } })
    expect(r2.attrs).not.toHaveProperty('d')
    expect(g).toMatchObject({ eol: 'on the G line', tail: ["before G's }"] })
    expect(g.c![0]).toMatchObject({ comments: ['before the child'], attrs: { y: 2 } })
    expect(scene.notes).toEqual({ tail: ['at the end'] })
    expect(warnings.map(w => w.message)).toEqual(['"#" ends this value; quote the value to keep the rest'])
    expect(warnings[0].line).toBe(5)
  })

  it('ends an unquoted value where the mod does (SceneText.ReadToken, 0.11.94)', () => {
    // A # past a value's first character ends it and starts a comment: the mod reads text=ab with no report.
    const hash = parseSrc('T text=ab#cd')
    expect(hash.scene!.root[0]).toMatchObject({ attrs: { text: 'ab' }, eol: 'cd' })
    expect(hash.warnings.map(w => w.message)).toEqual(['"#" ends this value; quote the value to keep the rest'])
    // A comma rejects the whole scene in the mod, which names the comma since 0.11.97, as ours does. A { opens a block
    // there, which the mod refuses unclosed since 0.11.97 (reject corpus: text-comma, text-brace, bare-brace; the C# suite
    // runs the mod on the first two).
    expect(parseSrc('T text=one,two').errors.map(e => e.message)).toEqual(['quote this value: "," cannot be part of an unquoted value'])
    expect(parseSrc('T text=ab{cd').errors.map(e => e.message)).toEqual(['quote this value: "{" cannot be part of an unquoted value'])
  })

  it('files SCENE and DEFS comments in notes, in text order (a14)', () => {
    const { scene } = parsed('a14')
    expect(scene.notes).toEqual({ header: ['h1', 'h2', 'h2 eol'], defs: ['d1', 'd2'], defsTail: ['dt1', 'dt2'], tail: ['t1'] })
    expect(scene.header).toEqual({ w: 200, h: 100, fit: 'contain' })
    expect(scene.defs.map(n => n.op)).toEqual(['GL', 'CP'])
    expect(scene.root.map(n => n.op)).toEqual(['R', 'C'])
  })

  it('keeps the first of duplicate keys, with a warning (a15)', () => {
    const { scene, warnings } = parsed('a15')
    expect(scene.root[0].attrs).toEqual({ x: 1 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toBe('duplicate attribute "X" ignored: the first one wins')
  })

  it("keeps a group default's exact key after another spelling, which the mod's ParseStyle alone passes down", () => {
    // G F=#0f0 f=#f00 { R } draws the R red, in either order (SchemaTests.cs); PropValue reads the first spelling.
    const both = parseSrc('G F=#0f0 f=#f00 S_=#fff s_=#000 {\n    R\n}')
    expect(both.scene!.root[0].attrs).toEqual({ F: '#0f0', f: '#f00', S_: '#fff', s_: '#000' })
    expect(both.warnings).toEqual([])
    // the exact key first, then another spelling, or the exact key twice: the later one is dropped, as before
    for (const [text, kept, dropped] of [['G f=#f00 F=#0f0', { f: '#f00' }, 'F'], ['G f=#f00 f=#0f0', { f: '#f00' }, 'f'],
      ['G F=#0f0 f=#f00 F=#00f', { F: '#0f0', f: '#f00' }, 'F'], ['R X=1 x=2', { X: 1 }, 'x']] as const) {
      const r = parseSrc(text)
      expect(r.scene!.root[0].attrs, text).toEqual(kept)
      expect(r.warnings.map(w => w.message), text).toEqual([`duplicate attribute "${dropped}" ignored: the first one wins`])
    }
  })

  it('stores numbers as float32, rounded once like float.Parse (a09)', () => {
    const { attrs } = parsed('a09').scene.root[0]
    expect(attrs.k).toBe(16777216)
    expect(attrs.m).toBe(16777218)
    expect(Object.is(attrs.a, -0)).toBe(true)
  })

  it('gives a block node a range up to its closing } (a12)', () => {
    const text = read('accept', 'a12.src')
    const { scene, ranges } = parsed('a12')
    const [g, r] = scene.root
    expect(ranges.get(g)).toEqual({ from: 0, to: text.indexOf('}') + 1 })
    expect(ranges.get(g.c![0])!.from).toBe(text.indexOf('R x'))
    expect(ranges.get(r)).toEqual({ from: text.indexOf('R y'), to: text.indexOf('\n') })
  })
})

describe('parseSrc on large input', () => {
  it('stays linear: a 100,000-digit value, 10,000 attributes, 20,000 nodes, 200,000 comments', () => {
    const text = [
      '# c\n'.repeat(200_000) + 'SCENE w=1',
      'R x=' + '1'.repeat(100_000) + 'x',
      'R ' + Array.from({ length: 10_000 }, (_, k) => `a${k % 5000}=${k}`).join(' '),
      ...Array.from({ length: 20_000 }, (_, k) => `R x=${k}`),
    ].join('\n')
    const r = stringWork(() => parseSrc(text), 16 * text.length)
    expect(r.errors).toEqual([])
    expect(r.scene!.notes!.header).toHaveLength(200_000)
    expect(r.scene!.root).toHaveLength(20_002)
    expect(r.scene!.root[0].attrs.x).toBe('1'.repeat(100_000) + 'x')
    expect(Object.keys(r.scene!.root[1].attrs)).toHaveLength(5000)
    expect(r.warnings).toHaveLength(5000)
    expect(r.warnings[4999].line).toBe(200_003)
  })
})

describe('propsEqual', () => {
  it('compares numbers as float32 and tells -0 from 0', () => {
    expect(propsEqual([['x', 0.1]], [['x', Math.fround(0.1)]])).toBe(true)
    expect(propsEqual([['x', 0.1]], [['x', 0.2]])).toBe(false)
    expect(propsEqual([['x', -0]], [['x', 0]])).toBe(false)
    expect(propsEqual([['x', { a: [1, 'a'] }]], [['x', { a: [1, 'b'] }]])).toBe(false)
    expect(propsEqual([['x', 1]], [['x', 1], ['y', 1]])).toBe(false)
  })
  it('firstWins drops later duplicates case-insensitively, inside node maps too', () => {
    const p: Pairs = [['W', 1], ['w', 2], ['root', { a: [{ m: [['op', 'R'], ['x', 1], ['X', 3]] }] }]]
    expect(firstWins(p)).toEqual([['W', 1], ['root', { a: [{ m: [['op', 'R'], ['x', 1]] }] }]])
  })
  it('converts, dedupes and compares 100,000 nested nodes and a list 100,000 deep, with no recursion', () => {
    const n = 100_000
    const build = (bottom: number): Scene => {
      let list: Value = bottom
      for (let k = 0; k < n; k++) list = [list]
      let g: SrcNode = { op: 'R', attrs: { p: list, x: 1, X: 2 } }
      for (let k = 0; k < n; k++) g = { op: 'G', attrs: {}, c: [g] }
      return { header: { w: 10, h: 10 }, defs: [], root: [g] }
    }
    const p = firstWins(toProps(build(1)))
    let r = (p[2][1] as { a: Uv[] }).a[0] as { m: Pairs }, levels = 0
    while (r.m[0][1] === 'G') { r = (r.m[1][1] as { a: Uv[] }).a[0] as { m: Pairs }; levels++ }
    expect([levels, r.m.map(([k]) => k)]).toEqual([n, ['op', 'p', 'x']])   // the bottom map's X is dropped
    let list = r.m[1][1], depth = 0
    while (typeof list === 'object' && 'a' in list) { list = list.a[0]; depth++ }
    expect([depth, list]).toEqual([n, 1])
    expect(propsEqual(p, firstWins(toProps(build(1))))).toBe(true)
    expect(propsEqual(p, firstWins(toProps(build(2))))).toBe(false)   // a difference at the bottom is seen
  }, 20_000) // measured: 0.688 s alone, 1.466-4.310 s full suite; concurrent suites exceeded 5 s
})

describe('parseSrc at any depth (SceneText.cs has no limit since 0.11.86)', () => {
  it('reads 100,000 nested blocks and an array 100,000 deep', () => {
    const n = 100_000
    const r = parseSrc('G {\n'.repeat(n) + 'R p=' + '['.repeat(n) + '1' + ']'.repeat(n) + '\n' + '}\n'.repeat(n))
    expect(r.errors).toEqual([])
    let g = r.scene!.root[0], depth = 0
    while (g.c) { g = g.c[0]; depth++ }
    expect([depth, g.op]).toEqual([n, 'R'])
    let p = g.attrs.p, levels = 0
    while (Array.isArray(p)) { p = p[0]; levels++ }
    expect([levels, p]).toEqual([n, 1])
  })
  it('reads a block\'s children only once its } has attached them: DEFS, c, tails and ranges', () => {
    const text = 'DEFS {\n    GL id=g\n    SYM id=s {\n        G {\n            R x=1\n        }\n    }\n    # tail of DEFS\n}\n' +
      'G {\n    G {\n        C\n        # tail of the inner G\n    }\n}\n'
    const r = parseSrc(text), s = r.scene!
    expect(r.errors).toEqual([])
    expect(s.defs.map(n => n.op)).toEqual(['GL', 'SYM'])   // DEFS' children reach defs when its } closes it
    expect(s.defs[1].c![0].c![0].attrs).toEqual({ x: 1 })
    expect(s.notes).toEqual({ defsTail: ['tail of DEFS'] })
    const g = s.root[0], inner = g.c![0]
    expect(inner.c!.map(n => n.op)).toEqual(['C'])
    expect(inner.tail).toEqual(['tail of the inner G'])
    expect(r.ranges.get(g)).toEqual({ from: text.lastIndexOf('G {\n    G'), to: text.length - 1 })
    expect(r.ranges.get(inner)!.to).toBe(text.lastIndexOf('}', text.length - 3) + 1)
  })
})
