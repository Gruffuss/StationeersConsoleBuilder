import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
beforeEach(() => { let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 1_000_000) })
afterEach(() => vi.restoreAllMocks())
import { stringWork } from '../../test/work'
import type { Scene, SrcNode, Value } from '../model/scene'
import { numberOf, parseSrc } from './parse'
import { printSrc, shortestFloat } from './print'
import { COLOUR_NAMES, joined, validateScene } from './validate'
import { readFileSync } from 'node:fs'
import { parseOrder } from '../model/numbering'
import { foldKey } from './props'

// foldKey as it is, counting the characters it folds.
const folded = vi.hoisted(() => ({ chars: 0 }))
vi.mock('./props', async importOriginal => {
  const props = await importOriginal<typeof import('./props')>()
  return { ...props, foldKey: (k: string) => { folded.chars += k.length; return props.foldKey(k) } }
})
// The production symbol-work allowance is 50 million steps; bound submitted/copied text as well.
const tripwire = (f: () => void) => stringWork(f, 16 * 50_000_000)

const node = (op: string, attrs: Record<string, Value> = {}, more: Partial<SrcNode> = {}): SrcNode => ({ op, attrs, ...more })
const scene = (root: SrcNode[], more: Partial<Scene> = {}): Scene => ({ header: {}, defs: [], root, ...more })
const reparse = (text: string) => {
  const r = parseSrc(text)
  expect(r.errors).toEqual([])
  return r.scene!
}

describe('shortestFloat', () => {
  it('prints the shortest decimal that reads back as the same float32', () => {
    expect(shortestFloat(0.1)).toBe('0.1')
    expect(shortestFloat(-0)).toBe('-0')
    expect(shortestFloat(16777216)).toBe('16777216')
    const third = shortestFloat(1 / 3)
    expect(Math.fround(Number(third))).toBe(Math.fround(1 / 3))
    expect(third).toBe('0.33333334')
  })
})

describe('printSrc quoting', () => {
  const printed = (v: Value) => printSrc(scene([node('T', { text: v })])).trimEnd()
  it.each([
    ['a b', 'T text="a b"'],
    ['a,b', 'T text="a,b"'],
    ['a#b', 'T text="a#b"'],
    ['#fff', 'T text=#fff'],
    ['=1+2', 'T text==1+2'],
    ['=1 + 2', 'T text="=1 + 2"'],
    ['', 'T text=""'],
    ['say "hi"\\\n\t', 'T text="say \\"hi\\"\\\\\\n\\t"'],
  ])('%j', (v, want) => {
    expect(printed(v)).toBe(want)
    expect(reparse(printed(v)).root[0].attrs.text).toBe(v)
  })
  it('quotes expressions inside arrays', () => {
    expect(printed(['=1+2', 3, ['#fff', 'a b']])).toBe('T text=["=1+2",3,[#fff,"a b"]]')
  })
  it('rejects a string that would read as a number', () => {
    const s = scene([node('FONT', { src: '12' })])
    expect(validateScene(s).errors.map(e => e.message)).toEqual(['the text "12" would read as the number 12; src cannot hold it'])
    expect(validateScene(s).errors[0].node).toBe(s.root[0])
    expect(() => printSrc(s)).toThrow(/would read as the number 12/)
  })
  it('rejects an integer-like key; prints and reads back an array 100,000 deep', () => {
    let deep: Value = [1]
    for (let k = 1; k < 100_000; k++) deep = [deep]
    const s = scene([node('R', { 12: 5 })])
    expect(validateScene(s).errors).toHaveLength(1)
    expect(() => printSrc(s)).toThrow()
    const text = printSrc(scene([node('R', { p: deep })]))
    expect(printSrc(reparse(text))).toBe(text)
    expect(text.startsWith('R p=' + '['.repeat(100_000) + '1]')).toBe(true)
  })
})

describe('foldKey', () => {
  // The fold before it was made fast: one code point at a time, kept when its upper case is longer.
  const slow = (k: string) => Array.from(k, ch => { const u = ch.toUpperCase(); return u.length === ch.length ? u : ch }).join('')
  it('folds every code point, and mixes of them, as the per-code-point fold does', () => {
    const bad: (number | string)[] = []
    for (let c = 0; c < 0x110000; c++) {
      const ch = String.fromCodePoint(c), u = ch.toUpperCase()
      // Nothing shrinks and only BMP code points grow, which the fast fold relies on.
      if (u.length < ch.length || (c >= 0x10000 && u.length > 2) || foldKey(ch) !== slow(ch)) bad.push(c)
    }
    const pool = [...'aß ŉǰΐﬀﬃᾳﬓıſKİéяω%', '\u{10428}', '\u{1E922}', '\ud800', '\udc00', '\u{10400}']
    let seed = 1
    const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n
    for (let t = 0; t < 20000; t++) {
      const s = Array.from({ length: rnd(12) }, () => pool[rnd(pool.length)]).join('')
      if (foldKey(s) !== slow(s)) bad.push(s)
    }
    expect(bad).toEqual([])
  })
})

describe('validateScene', () => {
  const messages = (s: Scene) => validateScene(s).errors.map(e => e.message)
  // A scene whose expansion runs past a work budget is too large to check here: not invalid, so no error.
  const verdict = (s: Scene) => { const r = validateScene(s); return { errors: r.errors.map(e => e.message), tooLarge: r.tooLarge } }
  const tooLarge = (message: string, errors: string[] = []) => ({ errors, tooLarge: message })
  it('flags what src cannot hold', () => {
    expect(messages(scene([node('R', { x: Infinity })]))).toHaveLength(1)
    expect(messages(scene([node('R', { x: 1e39 })]))).toHaveLength(1)
    expect(messages(scene([node('R', { C: 1 })]))).toHaveLength(1)
    expect(messages(scene([node('R', { op: 'G' })]))).toHaveLength(1)
    expect(messages(scene([node('R', { '': 1 })]))).toHaveLength(1)
    expect(messages(scene([], { header: { 7: 1 } }))).toHaveLength(1)
    expect(messages(scene([], { header: { Root: 1 } }))).toHaveLength(1)
    expect(messages(scene([node('SCENE')]))).toHaveLength(1)
    expect(messages(scene([node('R', { t: 'a\rb' })]))).toHaveLength(1)
    expect(messages(scene([node('P', { d: 'M0 0 Z 5' })]))).toHaveLength(1)
    expect(messages(scene([]))).toHaveLength(1)
  })
  // Colours the mod takes with a report (drawn magenta) or drops in silence are warnings: never refused (spec §4).
  const colours = (s: Scene) => { const r = validateScene(s); expect(r.errors).toEqual([]); return r.warnings.map(e => e.message) }
  const magenta = '; the mod reports it and draws the shape magenta', silent = '; the mod reports it and draws the shape magenta'
  it('has no expression nesting limit: a colour expression of any depth is read with a stack (0.11.85)', () => {
    const deep = 200_000, f = (v: string) => colours(scene([node('R', { f: v })]))
    expect(f('=' + '('.repeat(deep) + '#000' + ')'.repeat(deep))).toEqual([])
    expect(f('=' + 'mix('.repeat(deep) + '#000' + ',#fff,t)'.repeat(deep))).toEqual([])
    expect(f('=' + 'if(1,'.repeat(deep) + '#000' + ',#fff)'.repeat(deep))).toEqual([])
    for (const o of ['(', '-(', 'abs(', '2^(']) expect(f('=mix(#000,#fff,' + o.repeat(deep) + 't' + ')'.repeat(deep) + ')')).toEqual([])
    expect(f('=mix(#000,#fff,' + '$a['.repeat(deep) + '0' + ']'.repeat(deep) + ')')).toEqual([])
    expect(f('=mix(#000,#fff,' + '-'.repeat(deep) + 't)')).toEqual([])
    // if's condition, the other numeric argument of a colour node (the mod recursed on both until 0.11.95)
    expect(f('=if(' + '-'.repeat(deep) + '1,#000,#fff)')).toEqual([])
    for (const o of ['(', '-(', 'abs(']) expect(f('=if(' + o.repeat(deep) + '1' + ')'.repeat(deep) + ',#000,#fff)')).toEqual([])
    expect(f('=' + '-('.repeat(deep) + '#000' + ')'.repeat(deep))).toHaveLength(1)   // a colour is not negated
    expect(f('=' + 'mix('.repeat(deep) + '#000' + ',5,t)'.repeat(deep))).toHaveLength(1)   // the innermost mix ends in a number
    const sym = node('SYM', { id: 'a', q: 1 }, { c: [node('R', { f: '=mix(#000,#fff,%q)' })] })
    expect(colours(scene([node('USE', { ref: 'a', q: '-'.repeat(deep) + '1' })], { defs: [sym] }))).toEqual([])
  }, 20_000) // measured: 1.887 s focused, 3.052-5.764 s full suite; at least 3x headroom
  it('checks the colour-expression grammar on f, s_ and s, every branch (0.11.84), as warnings with their key', () => {
    const f = (v: string, op = 'R', key = 'f') => colours(scene([node(op, { [key]: v })]))
    const hint = 'use #hex, mix(a, b, t) or if(cond, a, b)'
    expect(f('=if(hover,#2E8B6E,if(down,#6FE3B6,#5FD9A8))')).toEqual([])
    expect(f('=mix(#000,(#FFF),t)')).toEqual([])
    expect(f('=mix(#24405A,#3A6E8B,hover)', 'R', 's')).toEqual([])
    expect(f('=if(down,#AAA,5)')).toEqual([`f="=if(down,#AAA,5)": a colour is expected where "5" is: ${hint}${magenta}`])
    expect(f('=mix(#AAA,1,t)')).toEqual([`f="=mix(#AAA,1,t)": a colour is expected where "1" is: ${hint}${magenta}`])
    expect(f('=mix(#AAA,#BBB,#CCC)')).toEqual([`f="=mix(#AAA,#BBB,#CCC)": a number is expected where "#CCC" is${silent}`])
    expect(f('=if(mix(#A,#B,t),#C,#D)')).toEqual([`f="=if(mix(#A,#B,t),#C,#D)": a number is expected where "#A" is${silent}`])
    expect(f('=mix(#AAA,#BBB)')).toEqual([`f="=mix(#AAA,#BBB)": mix() takes 3 arguments${magenta}`])
    expect(f('=$c')).toEqual([`f="=$c": "$c" is data, not a colour: a colour expression takes #hex colours${magenta}`])
    // a name takes a supplementary-plane character whole since 0.11.98 (Expression.cs ReadName), as a BMP letter
    expect(f('=$𝒳c')).toEqual([`f="=$𝒳c": "$𝒳c" is data, not a colour: a colour expression takes #hex colours${magenta}`])
    expect(f('=mix(#000,#fff,$𝒳[0])')).toEqual([])
    expect(f('=#12')).toEqual([`f="=#12": "#12" is not a colour${magenta}`])
    expect(f('=-#fff')).toEqual([`f="=-#fff": a colour is expected where "-#fff" is: ${hint}${magenta}`])
    expect(validateScene(scene([node('R', { F: '=5' })])).warnings.map(w => w.key)).toEqual(['F'])
    expect(colours({ header: { w: 100, h: 100, f: '=if(1,#fff,2)' }, defs: [], root: [] })).toHaveLength(1)
  })
  it('accepts an empty shadow list while warning on non-empty malformed shadows', () => {
    for (const op of ['R', 'T']) expect(colours(scene([node(op, { sh: [] })]))).toEqual([])
    expect(colours(scene([node('R', { sh: [0, 0, 2] })]))).toHaveLength(1)
    expect(colours(scene([node('T', { sh: [[]] })]))).toHaveLength(1)
  })
  it('warns on a literal that is not a colour, in a paint, an outline, a shadow or a stop', () => {
    const f = (v: Value, op = 'R', key = 'f') => colours(scene([node(op, { [key]: v })]))
    expect(f('#zz')).toEqual(['f="#zz": not a colour: the mod reports it and draws the shape magenta; write #hex, none or a colour name'])
    expect(f('reds', 'R', 's')).toHaveLength(1)
    for (const ok of ['Navy', ' #fff ', 'gray', 'transparent', 'none', '', '@g', '$c[i]']) expect(f(ok)).toEqual([])
    const oc = 'not a colour: the mod reports it; an outline colour is #hex or a colour name, no expression or data'
    expect([f('=#fff', 'T', 'oc'), f('foo', 'T', 'oc'), f('red', 'T', 'oc')]).toEqual([[`oc="=#fff": ${oc}`], [`oc="foo": ${oc}`], []])
    const shadow = 'not a colour: the mod reports it and drops this shadow; a shadow colour is #hex or a colour name, no expression or data'
    expect(f([[0, 0, 2, 0, '=#000']], 'R', 'sh')).toEqual([`sh="=#000": ${shadow}`])
    expect(f([0, 0, 2, 0, '#zz'], 'R', 'sh')).toEqual([`sh="#zz": ${shadow}`])
    expect(f([0, 0, 2], 'R', 'sh')).toEqual(['sh="[0,0,2]": a shadow needs five values [dx, dy, blur, spread, colour]; the mod reports it and drops the shadow'])
    expect(f([[0, 0, 2, 0, 'black', 'inset']], 'R', 'sh')).toEqual([])
  })
  it('writes a shadow value 100,000 deep in its warning as String and JSON.stringify write a shallow one', () => {
    const shallow: Value[] = [5, 'x', [], [[]], [[], []], [1, [2, [3, []]], 'a"b\\c\n\u0001', -0, NaN, Infinity, 1e21, 0.1, '\ud800']]
    for (const v of shallow) expect([joined(v, String, '', ''), joined(v, JSON.stringify)]).toEqual([String(v), JSON.stringify(v)])
    let deep: Value = [1]
    for (let k = 0; k < 100_000; k++) deep = [deep]
    const shadow = 'not a colour: the mod reports it and drops this shadow; a shadow colour is #hex or a colour name, no expression or data'
    expect(colours(scene([node('R', { sh: [deep] })]))).toEqual([
      `sh="${'['.repeat(100_001)}1${']'.repeat(100_001)}": a shadow needs five values [dx, dy, blur, spread, colour]; the mod reports it and drops the shadow`])
    expect(colours(scene([node('R', { sh: [0, 0, 2, 0, deep] })]))).toEqual([`sh="1": ${shadow}`])
  })
  it('checks each colour key only where the mod reads it (SceneModel.cs at the pin)', () => {
    const bad = '=if(1,#fff,2)', kids = { c: [node('R')] }
    const at = (op: string, attrs: Record<string, Value>, more: Partial<SrcNode> = {}) => colours(scene([node(op, attrs, more)])).length
    // s_ is a group default (ParseStyle), read on a node with children and on SCENE; a leaf never reads it.
    expect([at('G', { s_: bad }, kids), at('R', { s_: bad }, kids), at('G', { s_: bad }), at('R', { s_: bad })]).toEqual([1, 1, 0, 0])
    expect(colours({ header: { w: 100, s_: bad }, defs: [], root: [node('R')] })).toHaveLength(1)
    expect(colours({ header: { w: 100, s: bad }, defs: [], root: [node('R')] })).toEqual([])   // SCENE's s is not read
    // oc is a T's outline colour only; stops belong to the gradients GL, GR and GC.
    expect([at('T', { oc: '=#fff' }), at('R', { oc: '=#fff' })]).toEqual([1, 0])
    const stops = { stops: [['=t', '#000'], [1, '=#fff'], [1, '$c']] }
    expect(['GL', 'GR', 'GC', 'R'].map(op => colours(scene([node('R')], { defs: [node(op, { id: 'g', ...stops })] })))).toEqual([
      ...Array(3).fill(['stops="=#fff": not a colour: the mod reports it and drops this stop; a stop colour is #hex, a colour name or $data']), []])
    // s on a G: an array is the scale pair (Pair), a string the stroke colour (ParseStroke runs for every node).
    expect([at('G', { s: ['=t*2', 1] }), at('G', { s: '=t*2' }), at('G', { s: '=mix(#000,#fff,t)' })]).toEqual([0, 1, 0])
  })
  it('checks a colour expression in a symbol once its %params are in place, at the USE', () => {
    const sym = node('SYM', { id: 'b', a: '#000', b: '#fff' }, { c: [node('R', { f: '=if(hover,%a,%b)' })] })
    expect(colours(scene([node('USE', { ref: 'b' })], { defs: [sym] }))).toEqual([])
    const bad = node('USE', { ref: 'b', b: 5 })
    const r = validateScene(scene([bad], { defs: [sym] }))
    expect(r.warnings.map(e => e.message)).toEqual([`f="=if(hover,#000,5)" in SYM "b": a colour is expected where "5" is: use #hex, mix(a, b, t) or if(cond, a, b)${magenta}`])
    expect(r.warnings[0].node).toBe(bad)
    // a %param nothing supplies stays in the text, which is no colour
    const bare = node('SYM', { id: 'c' }, { c: [node('R', { f: '=if(hover,%a,#fff)' })] })
    expect(colours(scene([node('USE', { ref: 'c' })], { defs: [bare] }))).toHaveLength(1)
  })
  it('knows the colour names core/Core/ManagedColour.cs knows, and the mod\'s none and gray', () => {
    const cs = readFileSync(new URL('../../../core/Core/ManagedColour.cs', import.meta.url), 'utf8')
    const unity = [...cs.matchAll(/\["(\w+)"\] = "[0-9a-f]+"/g)].map(m => m[1])
    expect(unity).toHaveLength(23)
    expect([...COLOUR_NAMES].sort()).toEqual([...unity, 'none', 'gray'].sort())
  })
  it('no longer warns about colours older mods reject (spec D15: the floor is the pin)', () => {
    const warned = (attrs: Record<string, Value>) => validateScene(scene([node('R', attrs)])).warnings
    expect(warned({ f: 'gray' })).toEqual([])
    expect(warned({ s: ' #fff ' })).toEqual([])
  })
  it('flags what would print as other lines or not parse: ops, keys and comments', () => {
    expect(messages(scene([node('')]))).toHaveLength(1)
    expect(messages(scene([node(5 as unknown as string)]))).toHaveLength(1)
    expect(messages(scene([node('R\nG')]))).toHaveLength(1)
    expect(messages(scene([node('R', { 'a\rb': 1 })]))).toHaveLength(1)
    expect(messages(scene([node('R', {}, { comments: ['a\nR y=2'] })]))).toHaveLength(1)
    expect(messages(scene([node('R', {}, { eol: 'a\rb' })]))).toHaveLength(1)
    expect(messages(scene([node('G', {}, { c: [], tail: ['a\nb'] })]))).toHaveLength(1)
    for (const k of ['header', 'defs', 'defsTail', 'tail'] as const) {
      const s = scene([node('R')], { header: { w: 1 }, defs: [node('GL')], notes: { [k]: ['x\ny'] } })
      expect(messages(s)).toHaveLength(1)
      expect(() => printSrc(s)).toThrow()
    }
  })
  it('prints and reads back 100,000 nested blocks, in the root and in DEFS', () => {
    const chain = (n: number) => {
      let g: SrcNode = node('G', {}, { c: [] })
      for (let k = 1; k < n; k++) g = node('G', {}, { c: [g] })
      return g
    }
    for (const s of [scene([chain(100_000)]), scene([node('R')], { defs: [chain(100_000)] })]) {
      expect(messages(s)).toEqual([])
      const text = printSrc(s)
      expect(printSrc(reparse(text))).toBe(text)
    }
  }, 120_000)   // 8 s alone on a loaded machine (2026-10-07), 14 s beside the other files: past the default 5 s
  it('indents 4 spaces a level up to 32 levels, then holds the indent', () => {
    let g: SrcNode = node('R')
    for (let k = 0; k < 40; k++) g = node('G', {}, { c: [g] })
    const pad = (depth: number) => ' '.repeat(4 * Math.min(depth, 32))
    const root = printSrc(scene([g])).split('\n')
    for (let d = 0; d < 40; d++) expect([root[d], root[80 - d]]).toEqual([pad(d) + 'G {', pad(d) + '}'])
    expect(root[40]).toBe(pad(40) + 'R')
    const defs = printSrc(scene([node('C')], { defs: [g] })).split('\n')   // DEFS { is a level
    for (let d = 0; d < 40; d++) expect([defs[1 + d], defs[81 - d]]).toEqual([pad(d + 1) + 'G {', pad(d + 1) + '}'])
    expect([defs[0], defs[41], defs[82], defs[83]]).toEqual(['DEFS {', pad(41) + 'R', '}', 'C'])
  })
  it('finds SYM cycles through USE', () => {
    const sym = (id: string, ref: string) => node('SYM', { id }, { c: [node('G', {}, { c: [node('USE', { ref })] })] })
    expect(messages(scene([], { defs: [sym('a', 'a')] }))).toHaveLength(1)
    expect(messages(scene([], { defs: [sym('a', 'b'), sym('b', 'a')] }))).toEqual(['SYM "a" uses itself through USE: a > b > a'])
    expect(messages(scene([], { defs: [sym('a', 'b'), sym('b', 'c')] }))).toEqual([])
  })
  it('expands USE with the mod\'s %param substitution before checking paths and refs', () => {
    const use = (attrs: Record<string, Value>) => node('USE', attrs)
    const bad = use({ ref: 'a', path: 'M0 0 Z 5' })
    const paths = validateScene(scene([use({ ref: 'a' }), bad], { defs: [node('SYM', { id: 'a', path: 'M0 0 L1 1' }, { c: [node('P', { d: '%path' })] })] }))
    expect(paths.errors.map(e => e.message)).toEqual(['d="M0 0 Z 5" in SYM "a": no numbers may follow Z (at 7)'])
    expect(paths.errors[0].node).toBe(bad)
    const spliced = scene([use({ ref: 'a', x0: '?' })], { defs: [node('SYM', { id: 'a', x0: 5 }, { c: [node('G', {}, { c: [node('P', { d: 'M%x0 0 L1 1' })] })] })] })
    expect(messages(spliced)).toEqual(['d="M? 0 L1 1" in SYM "a": unexpected "?" in the path (at 1)'])
    expect(messages(scene([use({ ref: 'a' })], { defs: [node('SYM', { id: 'a', r: 'a' }, { c: [node('USE', { ref: '%r' })] })] }))[0]).toMatch(/uses itself/)
    expect(messages(scene([use({ ref: 'a' })], { defs: [node('SYM', { id: 'a' }, { c: [node('USE', { ref: '%id' })] })] }))[0]).toMatch(/uses itself/)
    expect(messages(scene([use({ ref: 'b' })], { defs: [node('SYM', { id: 'b', r: 'a' }, { c: [node('USE', { ref: '%r' })] }), node('SYM', { id: 'a' }, { c: [node('R')] })] }))).toEqual([])
    expect(messages(scene([use({ ref: 'a' })], { defs: [node('SYM', { id: 'a' }, { c: [node('USE', { ref: '%q' })] })] })))
      .toEqual(['USE ref="%q": the symbol reference cannot be resolved'])
  })
  it('lets a %param without a default be required: only a real USE is checked beyond cycles', () => {
    const path = node('SYM', { id: 'a' }, { c: [node('P', { d: '%path' })] })
    expect(messages(scene([node('USE', { ref: 'a', path: 'M0 0 L1 1' })], { defs: [path] }))).toEqual([])
    expect(messages(scene([node('R')], { defs: [path] }))).toEqual([])
    const wrapper = node('SYM', { id: 'w' }, { c: [node('USE', { ref: '%inner' })] })
    expect(messages(scene([node('USE', { ref: 'w', inner: 'a' })], { defs: [wrapper, node('SYM', { id: 'a' }, { c: [node('R')] })] }))).toEqual([])
    expect(messages(scene([node('USE', { ref: 'w' })], { defs: [wrapper] }))).toEqual(['USE ref="%inner": the symbol reference cannot be resolved'])
  })
  it('expands arrays nested 100,000 deep in a symbol: in its body, as a default and as an argument', () => {
    let deep: Value = [1]
    for (let k = 0; k < 100_000; k++) deep = [deep]
    const inBody = scene([node('USE', { ref: 'a' })], { defs: [node('SYM', { id: 'a' }, { c: [node('R', { p: deep, x: '%p' })] })] })
    expect(messages(inBody)).toEqual([])
    const asDefault = scene([node('USE', { ref: 'a' })], { defs: [node('SYM', { id: 'a', p: deep }, { c: [node('R', { x: '%p', t: ['%p', 0] })] })] })
    expect(messages(asDefault)).toEqual([])
    const asArgument = scene([node('USE', { ref: 'a', p: deep })], { defs: [node('SYM', { id: 'a', p: 1 }, { c: [node('R', { x: '%p' })] })] })
    expect(messages(asArgument)).toEqual([])
  })
  it('follows a symbol argument that %params nest past 32 levels: the cycle and the fan-out behind it are found', () => {
    const deep = '['.repeat(32) + ']'.repeat(32)
    // A cycle through parameterised refs (the mod refuses it), behind an argument that grows a level per expansion.
    const cycle = reparse(`DEFS {\n    SYM id=A {\n        USE ref=%next back=%back next=%next arr=[%arr]\n    }\n    SYM id=B {\n        USE ref=%back back=%back next=%next arr=[%arr]\n    }\n}\nUSE ref=A next=B back=A arr=${deep}\nG\n`)
    expect(messages(cycle)).toEqual(['SYM "A" uses itself through USE: A > B > A'])
    // 9 levels of 10 USEs behind it: 10^9 nodes.
    const levels = Array.from({ length: 9 }, (_, k) => `    SYM id=l${k + 1} {\n${`        USE ref=l${k + 2}\n`.repeat(10)}    }\n`).join('')
    const fan = reparse(`DEFS {\n${levels}    SYM id=l10 {\n        G\n    }\n    SYM id=outer arr=1 {\n        USE ref=l1 a=[%arr]\n    }\n}\nUSE ref=outer arr=${deep}\nG\n`)
    expect(verdict(fan)).toEqual(tooLarge(TOO_MUCH))
  })
  it('finds SYM cycles when the defaults pass runs out of work, and reports that it ran out', () => {
    const s = reparse(`DEFS {\n    SYM id=h big="${'x'.repeat(100_000)}" {\n${'        USE ref=t x=%big\n'.repeat(260)}    }\n` +
      `    SYM id=t x=0 {\n        R w=1\n    }\n    SYM id=cyc {\n        USE ref=cyc\n    }\n}\nR w=1\n`)
    expect(verdict(s)).toEqual(tooLarge('symbols take too much work to expand: more than 50000000 steps', ['SYM "cyc" uses itself through USE: cyc > cyc']))
    expect(() => printSrc(s)).toThrow(/uses itself/)   // the cycle is wrong input; running out of work is not
  })
  it('stays bounded on deep symbol bodies; a long USE chain is fine', () => {
    let deep: SrcNode = node('USE', { ref: 'a' })
    for (let k = 0; k < 20000; k++) deep = node('G', {}, { c: [deep] })
    expect(messages(scene([node('USE', { ref: 'a' })], { defs: [node('SYM', { id: 'a' }, { c: [deep] })] }))).toEqual(Array(2).fill('SYM "a" uses itself through USE: a > a'))
    const chain = Array.from({ length: 100 }, (_, k) => node('SYM', { id: `s${k}` }, { c: [node('USE', { ref: `s${k + 1}` })] }))
    expect(messages(scene([], { defs: chain }))).toEqual([])
  })
  it('says a cycle once per symbol, naming at most 16 of its chain, however many USEs close it', () => {
    // 9,000 symbols in a chain; the last one holds 90,000 USEs back to the first. Within every budget.
    const L = 9000, chain = Array.from({ length: L }, (_, k) => node('SYM', { id: `s${k}` },
      { c: k < L - 1 ? [node('USE', { ref: `s${k + 1}` })] : Array.from({ length: 90_000 }, () => node('USE', { ref: 's0' })) }))
    const names = (from: number) => Array.from({ length: 8 }, (_, k) => `s${from + k}`)
    const said = `SYM "s0" uses itself through USE: ${[...names(0), '…', ...names(L - 8), 's0'].join(' > ')}`
    tripwire(() => expect(verdict(scene([node('USE', { ref: 's0' })], { defs: chain }))).toEqual({ errors: [said, said] }))
    // The same when the defaults pass runs out of work and the cycles are found without substituting.
    const burn = reparse(`DEFS {\n    SYM id=h big="${'x'.repeat(100_000)}" {\n${'        USE ref=t x=%big\n'.repeat(260)}    }\n    SYM id=t x=0 {\n        R w=1\n    }\n}\nR w=1\n`)
    tripwire(() => expect(verdict({ ...burn, defs: [...burn.defs, ...chain] })).toEqual(tooLarge(TOO_MUCH, [said])))
    // A short chain is named whole.
    expect(messages(scene([], { defs: [node('SYM', { id: 'a' }, { c: [node('USE', { ref: 'b' })] }), node('SYM', { id: 'b' }, { c: [node('USE', { ref: 'a' })] })] })))
      .toEqual(['SYM "a" uses itself through USE: a > b > a'])
  })
  it('counts every USE instance the mod builds, not every distinct one', () => {
    // 2 KB of text that the mod expands into 2^40 nodes.
    const syms = Array.from({ length: 40 }, (_, k) => `    SYM id=s${k} {\n        USE ref=s${k + 1}\n        USE ref=s${k + 1}\n    }\n`)
    const fanOut = reparse(`DEFS {\n${syms.join('')}    SYM id=s40 {\n        R w=1 h=1\n    }\n}\nUSE ref=s0\n`)
    expect(verdict(fanOut)).toEqual(tooLarge(TOO_MUCH))
    // Too large to check is not invalid: it prints, and the text reads back as the same scene. Each printSrc validates
    // to the work budget first (about a quarter second), so the scene is compared, not printed a second time.
    expect(reparse(printSrc(fanOut))).toEqual(fanOut)
    // Each instance is walked, but an error repeated under one USE is said once.
    const twice = node('SYM', { id: 'a' }, { c: [node('USE', { ref: 'b' }), node('USE', { ref: 'b' })] })
    const bad = node('SYM', { id: 'b', d: 'M0 0 Q' }, { c: [node('P', { d: '%d' })] })
    expect(messages(scene([node('USE', { ref: 'a' })], { defs: [twice, bad] }))).toHaveLength(1)
  })
  it('bounds the nodes symbols expand to, not only the instances', () => {
    // levels doubling symbols over a 100-line leaf: 2^levels leaf instances of 100 nodes each.
    const fan = (levels: number) => {
      const syms = Array.from({ length: levels }, (_, k) => node('SYM', { id: `s${k}` }, { c: [node('USE', { ref: `s${k + 1}` }), node('USE', { ref: `s${k + 1}` })] }))
      const leaf = node('SYM', { id: `s${levels}` }, { c: Array.from({ length: 100 }, (_, j) => node('R', { x: j, y: '%q', w: 1, h: 1, f: '#fff' })) })
      return scene([node('USE', { ref: 's0', q: 3 })], { defs: [...syms, leaf] })
    }
    tripwire(() => expect(verdict(fan(13))).toEqual(tooLarge(TOO_MUCH)))
    expect(verdict(fan(12))).toEqual(tooLarge(TOO_MUCH))   // 4,095 instances, 400k nodes
  })
  it.each([
    // 12 levels of USE pairs over a leaf (4,096 instances of it), with 300 arguments: a few KB of src, seconds of work.
    ['a long text spliced once per argument', 'T text="' + 'x'.repeat(5000) + ' %a299"', true],
    ['whole-value %params', 'R ' + Array.from({ length: 300 }, (_, k) => `k${k}=%a299`).join(' '), true],
    ['one-character "%" values', 'R ' + Array.from({ length: 300 }, (_, k) => `k${k}="%"`).join(' '), true],
    ['300 arguments merged at every level', 'R w=1 h=1', false],
  ])('bounds the work symbols take to expand: %s', (_, leaf, inLeaf) => {
    const ps = (p: string) => Array.from({ length: 300 }, (_, k) => `${p}${k}=${k}`).join(' ')
    const levels = Array.from({ length: 12 }, (_, k) => `    SYM id=s${k} ${inLeaf ? '' : ps('p')} {\n` +
      `        USE ref=s${k + 1} ${inLeaf ? '' : ps('q')}\n        USE ref=s${k + 1} ${inLeaf ? '' : ps('q')}\n    }\n`)
    const s = reparse(`DEFS {\n${levels.join('')}    SYM id=s12 ${inLeaf ? ps('a') : ''} {\n        ${leaf}\n    }\n}\nUSE ref=s0\n`)
    tripwire(() => expect(verdict(s)).toEqual(tooLarge('symbols take too much work to expand: more than 50000000 steps')))
  })
  const TOO_MUCH = 'symbols take too much work to expand: more than 50000000 steps'
  it('folds each name and source text once, whatever its characters', () => {
    // ŉ upper-cases to ʼN, which is longer, so the fold keeps it, at about 25 ns a character.
    const long = 'ŉa'.repeat(25_000), params = Array.from({ length: 700 }, (_, k) => `p${k}=1`).join(' ')
    for (const [src, want] of [
      [`DEFS {\n    SYM id=s p=1 ${long}=1 {\n        G x=%p\n    }\n}\n${'USE ref=s\n'.repeat(1000)}`, tooLarge(TOO_MUCH)],   // a name
      [`DEFS {\n    SYM id=s ${long}=1 {\n        G v=%${long}\n    }\n}\n${'USE ref=s\n'.repeat(1000)}`, tooLarge(TOO_MUCH)],   // a whole %name
      [`DEFS {\n    SYM id=s p=0 {\n        R ${'é'.repeat(100_000)}=%p\n    }\n}\n${'USE ref=s p=1\n'.repeat(450)}`, { errors: [] }],   // a body key
      [`DEFS {\n    SYM id=s ${params} {\n        T text="${'ω'.repeat(100_000)}%"\n    }\n}\nUSE ref=s\n`, { errors: [], tooLarge: undefined }],   // a text
    ] as const) {
      const s = reparse(src)
      folded.chars = 0
      expect(verdict(s)).toEqual(want)
      expect(folded.chars).toBeLessThan(2 * src.length)   // was 100-600x the source, once per instance or argument
    }
  })
  it('charges the % signs of a symbol, each compared with every name, to the work', () => {
    const params = Array.from({ length: 1000 }, (_, k) => `p${k}=1`).join(' ')
    expect(verdict(reparse(`DEFS {\n    SYM id=s ${params} {\n        T text="${'%'.repeat(185_000)}"\n    }\n}\nR w=1\n`))).toEqual(tooLarge(TOO_MUCH))
  })
  it('tells the expansions of the defaults pass apart without building long keys', () => {
    // V8 hashes a string longer than 16,383 characters by its length alone, so a map of many such keys is quadratic.
    type Methods = Record<string, (...a: unknown[]) => unknown>
    const longest = (f: () => void) => {
      let max = 0
      const saved: [Methods, string, (...a: unknown[]) => unknown][] = []
      for (const o of [Map.prototype, Set.prototype] as unknown as Methods[]) {
        for (const m of ['get', 'set', 'has', 'add']) {
          const was = o[m]
          if (!was) continue
          saved.push([o, m, was])
          o[m] = function (this: unknown, k: unknown, ...more: unknown[]) {
            if (typeof k === 'string') max = Math.max(max, k.length)
            return was.call(this, k, ...more)
          }
        }
      }
      try { f() } finally { for (const [o, m, was] of saved) o[m] = was }
      return max
    }
    // 50 distinct USEs of a symbol whose default holds 20,000 numbers: one array object.
    const shared = reparse(`DEFS {\n    SYM id=b arr=[${Array(20_000).fill('.1').join(' ')}] {\n        R x=1\n    }\n    SYM id=a {\n` +
      `${Array.from({ length: 50 }, (_, i) => `        USE ref=b k=${i}\n`).join('')}    }\n}\n`)
    // 50 distinct arrays of 9,000 elements, a new object at each expansion.
    const distinct = reparse(`DEFS {\n    SYM id=g k=0 {\n        USE ref=t arr=[${'"1" '.repeat(8999)}%k]\n    }\n    SYM id=t arr=0 {\n        R w=1\n    }\n` +
      `    SYM id=h {\n${Array.from({ length: 50 }, (_, i) => `        USE ref=g k=${1000 + i}\n`).join('')}    }\n}\n`)
    for (const s of [shared, distinct]) {
      let m: string[] = []
      expect(longest(() => { m = messages(s) })).toBeLessThanOrEqual(16_383)
      expect(m).toEqual([])
    }
  })
  it('charges the checks of a substituted value by what they read: paths and colours', () => {
    // A path of 6.4M characters (parsePath: about 8 units a character), over the work before it is parsed.
    const path = scene([node('USE', { ref: 's' })], { defs: [node('SYM', { id: 's', a: 'M0 0 ' + 'H1'.repeat(3_200_000) }, { c: [node('P', { d: '%a' })] })] })
    expect(verdict(path)).toEqual(tooLarge(TOO_MUCH))
    // 30,000 colours checked at each of 300 nodes.
    expect(verdict(reparse(`DEFS {\n    SYM id=s a=[${'""'.repeat(30_000)}] {\n${'        R f=%a\n'.repeat(300)}    }\n}\nUSE ref=s\n`))).toEqual(tooLarge(TOO_MUCH))
  })
  it('counts the strict and the defaults pass apart', () => {
    const big = (id: string) => node('SYM', { id }, { c: Array.from({ length: 60_000 }, (_, j) => node('R', { x: j, y: 0, w: 1, h: 1 })) })
    // 60,000 nodes built from the root, walked again from the symbol's defaults: under the charged work budget each.
    expect(messages(scene([node('USE', { ref: 'a' })], { defs: [big('a')] }))).toEqual([])
    // An unused symbol is not charged to what the root builds.
    expect(messages(scene([node('USE', { ref: 'a' })], { defs: [big('a'), big('unused')] }))).toEqual([])
  })
  it('follows a USE chain of any depth: 5,000 symbols check clean and number to the end, 20,000 are also unrestricted', () => {
    const chain = (n: number) => Array.from({ length: n }, (_, k) => node('SYM', { id: `s${k}` }, { c: [k === n - 1 ? node('R') : node('USE', { ref: `s${k + 1}` })] }))
    const at = (n: number) => scene([node('USE', { ref: 's0' })], { defs: chain(n).reverse() })
    expect(messages(at(5000))).toEqual([])
    const order = parseOrder(at(5000))
    expect(order.ops).toHaveLength(5001)
    expect(order.ops.at(-1)).toBe('R')
    expect(messages(at(20_000))).toEqual([])
  })
  it('does not warn about parameter names with a shared prefix after boundary matching', () => {
    const sym = node('SYM', { id: 'dot', cx: 10, opacity: 1 }, { c: [node('C', { cx: '=%cx+2', o: '=%opacity/2' })] })
    expect(validateScene(scene([node('USE', { ref: 'dot', cx: 50 })], { defs: [sym] })).warnings).toEqual([])
  })
})

describe('printSrc comments', () => {
  it('places comments, eol, tail and every note', () => {
    const s: Scene = {
      header: { w: 100 },
      defs: [node('GL', { id: 'g' }, { comments: ['def'] })],
      root: [
        node('G', {}, { comments: ['above G'], eol: 'on G', tail: ['before }'], c: [node('R', {}, { comments: ['child'], eol: 'R eol' })] }),
      ],
      notes: { header: ['h'], defs: ['d'], defsTail: ['dt'], tail: ['t'] },
    }
    const text = printSrc(s)
    expect(text).toBe([
      '# h', 'SCENE w=100', '# d', 'DEFS {', '    # def', '    GL id=g', '    # dt', '}',
      '# above G', 'G {  # on G', '    # child', '    R  # R eol', '    # before }', '}', '# t', '',
    ].join('\n'))
    expect(reparse(text)).toEqual(s)
  })
  it('prints every note even with no SCENE or DEFS line, in order', () => {
    const s = scene([node('R', { x: 1 })], { notes: { header: ['h'], defs: ['d'], defsTail: ['dt'], tail: ['t'] } })
    expect(printSrc(s)).toBe('# h\n# d\n# dt\nR x=1\n# t\n')
    const back = reparse(printSrc(s))
    expect(back.root[0].comments).toEqual(['h', 'd', 'dt'])
    expect(back.notes).toEqual({ tail: ['t'] })
  })
})

// A seeded generator: mulberry32.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('printSrc round trip', () => {
  it('print then parse gives the scene back, for 200 random scenes', () => {
    const r = rng(7)
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
    const OPS = ['R', 'C', 'G', 'T', 'P', 'L', 'Y', 'SP', 'RP', 'YS', 'LS', 'SC', 'IMG', 'USE', 'GL', 'GR', 'GC', 'CP']
    const KEYS = ['x', 'y', 'w', 'h', 'f', 's', 'text', 'Id', 'a b', '#k', 'k=v', 'é', 'x,y', '"q', 'fat', 'sh']
    const CHARS = ['a', 'Z', ' ', '"', '\\', '#', '=', '[', ']', '{', '}', ',', '\n', '\t', '@', '$', '%', 'é', ' ', '1', '.', '-', 'e']
    const text = (): string => {
      for (;;) {
        let s = r() < 0.2 ? '=' : ''
        for (let k = Math.floor(r() * 8); k > 0; k--) s += pick(CHARS)
        if (numberOf(s) === undefined) return s
      }
    }
    const num = () => Math.fround(pick([0, -0, 1, -1, 1e-45, 3.4028234663852886e38, 16777216, (r() - 0.5) * 10 ** Math.floor(r() * 12 - 6)]))
    const value = (depth: number): Value => {
      const k = r()
      if (k < 0.4) return num()
      if (k < 0.8 || depth > 3) return text()
      return Array.from({ length: Math.floor(r() * 4) }, () => value(depth + 1))
    }
    // An =text in a colour key would be a colour expression, which this generator does not write.
    const plain = (v: Value): Value => typeof v === 'string' ? v.replace(/^=/, '#') : Array.isArray(v) ? v.map(plain) : v
    const comment = () => Array.from({ length: Math.floor(r() * 6) }, () => pick(['a', ' ', '#', 'x y', '"', '{', '}'])).join('')
    const comments = () => (r() < 0.25 ? Array.from({ length: 1 + Math.floor(r() * 2) }, comment) : undefined)
    const attrs = () => {
      const a: Record<string, Value> = Object.create(null)
      for (let k = Math.floor(r() * 4); k > 0; k--) {
        const key = pick(KEYS)
        if (!Object.keys(a).some(x => x.toUpperCase() === key.toUpperCase())) a[key] = /^(f|s|sh)$/i.test(key) ? plain(value(0)) : value(0)
      }
      return a
    }
    const make = (depth: number): SrcNode => {
      const n: SrcNode = { op: pick(OPS), attrs: attrs() }
      const above = comments()
      if (above) n.comments = above
      if (r() < 0.2) n.eol = comment()
      if (depth < 3 && r() < 0.3) {
        n.c = Array.from({ length: Math.floor(r() * 3) }, () => make(depth + 1))
        const tail = comments()
        if (tail) n.tail = tail
      }
      return n
    }
    let all = '', broken = 0
    for (let round = 0; round < 200; round++) {
      const s: Scene = { header: Object.create(null), defs: [], root: [] }
      if (r() < 0.5) Object.assign(s.header, { w: num(), fit: text() })
      if (r() < 0.4) s.defs = Array.from({ length: 1 + Math.floor(r() * 2) }, () => make(1))
      s.root = Array.from({ length: (Object.keys(s.header).length ? 0 : 1) + Math.floor(r() * 4) }, () => make(0))
      const notes: NonNullable<Scene['notes']> = {}
      if (Object.keys(s.header).length && r() < 0.4) notes.header = comments() ?? ['h']
      if (s.defs.length && r() < 0.4) notes.defs = comments() ?? ['d']
      if (s.defs.length && r() < 0.4) notes.defsTail = comments() ?? ['dt']
      if (r() < 0.4) notes.tail = comments() ?? ['t']
      if (Object.keys(notes).length) s.notes = notes
      expect(validateScene(s).errors).toEqual([])
      const printed = printSrc(s)
      expect(reparse(printed)).toEqual(s)
      all += printed

      // A line break in any comment would print as more lines (here, an extra node): validateScene refuses it.
      const slots: [Record<string | number, unknown>, string | number][] = []
      const visit = (n: SrcNode) => {
        for (const list of [n.comments, n.tail]) if (list) slots.push([list as never, 0])
        if (n.eol !== undefined) slots.push([n as never, 'eol'])
        n.c?.forEach(visit)
      }
      for (const n of [...s.defs, ...s.root]) visit(n)
      for (const list of Object.values(s.notes ?? {})) slots.push([list as never, 0])
      if (slots.length) {
        const [at, k] = pick(slots)
        at[k] = `${at[k]}${pick(['\n', '\r', '\r\n'])}R y=2`
        expect(validateScene(s).errors.map(e => e.message)).toEqual([expect.stringMatching(/holds a line break/)])
        expect(() => printSrc(s)).toThrow(/line break/)
        broken++
      }
    }
    expect(broken).toBeGreaterThan(50)
    // the generator reaches every printing rule: escapes, bare and quoted expressions, blocks, eol and tail comments, DEFS
    for (const seen of ['\\n', '\\"', '\\\\', '\\t', '==', '="=', '[[', ' {\n', '  # ', '    # ', 'DEFS {', 'SCENE ', '=-0', '"#k"']) {
      expect(all).toContain(seen)
    }
  })
})
