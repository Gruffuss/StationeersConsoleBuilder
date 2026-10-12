import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromProps, sceneOfProps } from './fromProps'
import { parseSrc } from './parse'
import { printSrc } from './print'
import { firstWins, propsEqual, toProps, type Pairs, type Uv } from './props'
import { validateScene } from './validate'

// The props of every vector structure element of examples 01-19, captured from the C# host (core/Core.Tests/FixtureTests.cs).
// The printed src is a committed snapshot; the C# oracle then proves it draws what the example draws.
const dir = new URL('../../test/fixtures/examples/', import.meta.url)
const fixtures = readdirSync(dir).filter(f => f.endsWith('.props.json')).map(f => f.slice(0, -'.props.json'.length)).sort()

const parsed = (text: string) => {
  const r = parseSrc(text)
  expect(r.errors.map(e => e.message)).toEqual([])
  return r.scene!
}

describe('examples round trip', () => {
  it('has 21 structure elements from all 19 examples', () => {
    expect(fixtures).toHaveLength(21)
    expect(new Set(fixtures.map(f => f.slice(0, 2))).size).toBe(19)
  })

  it('retains the web-font declaration in both table props and printed src', () => {
    const props: Pairs = JSON.parse(readFileSync(new URL('19-webfonts.webfonts.props.json', dir), 'utf8'))
    const scene = sceneOfProps(props)
    const defs = [{ op: 'FONT', attrs: { src: 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700' } }]
    expect(scene.defs).toEqual(defs)
    expect(sceneOfProps(toProps(scene)).defs).toEqual(defs)
    expect(parsed(printSrc(scene)).defs).toEqual(defs)
  })

  it.each(fixtures)('%s', async name => {
    const props: Pairs = JSON.parse(readFileSync(new URL(`${name}.props.json`, dir), 'utf8'))
    const scene = sceneOfProps(props)
    expect(validateScene(scene).errors.map(e => e.message)).toEqual([])
    const printed = printSrc(scene)
    await expect(printed).toMatchFileSnapshot(`../../test/fixtures/examples/${name}.src`)
    const back = parsed(printed)
    expect(validateScene(back).errors.map(e => e.message)).toEqual([])
    expect(propsEqual(firstWins(toProps(back)), firstWins(toProps(scene)))).toBe(true)
  })

  it('validates every text of the parser\'s accept corpus with no errors', () => {
    const accept = new URL('../../test/srctext/accept/', import.meta.url)
    const texts = readdirSync(accept).filter(f => f.endsWith('.src'))
    expect(texts).toHaveLength(24)
    for (const f of texts) expect([f, validateScene(parsed(readFileSync(new URL(f, accept), 'utf8'))).errors.map(e => e.message)]).toEqual([f, []])
  })
})

describe('fromProps', () => {
  it('rewrites the map forms src cannot write, and warns about what it drops', () => {
    const { scene, warnings } = fromProps([
      ['scene', 'x'], ['w', 100], ['visible', 1],
      ['defs', { a: [{ m: [['op', 'SYM'], ['id', 'lamp'], ['params', { m: [['r', 4], ['col', '#fff'], ['ID', 'x']] }], ['c', { a: [{ m: [['op', 'C'], ['rx', '%r']] }] }]] }] }],
      ['root', { a: [
        { m: [['op', 'G'], ['f', '#000'], ['style', { m: [['s', '#fff'], ['bg', '#000'], ['f', 'none']] }], ['c', { a: [
          { m: [['op', 'R'], ['sh', { a: [{ a: [0, 0, 2, 0, '#000', { b: true }] }] }], ['click', { b: true }], ['text', '12'],
            ['f', { m: [['grad', 'g']] }], ['s', { m: [['grad', 'h'], ['at', '=t']] }]] },
          5,
          { m: [['x', 1]] },
        ] }]] },
      ] }],
    ])
    expect(scene.header).toEqual({ w: 100 })
    expect(scene.defs[0]).toEqual({ op: 'SYM', attrs: { id: 'lamp', r: 4, col: '#fff' }, c: [{ op: 'C', attrs: { rx: '%r' } }] })
    const g = scene.root[0]
    expect(g.attrs).toEqual({ f: 'none', s_: '#fff' })
    expect(g.c).toEqual([{ op: 'R', attrs: { sh: [[0, 0, 2, 0, '#000', 'inset']], click: 1, text: '12', f: '@g', fat: 0, s: '@h', sat: '=t' } }])
    // in the order they are met: a node's children where its c comes, before the keys after it
    expect(warnings).toEqual(["defs[0].params.ID: a parameter named ID clashes with the SYM's own ID in src; dropped",
      'root[0].c[0].text: the text "12" would read as a number in src; kept as a string',
      'root[0].c[1]: not a node map; skipped', 'root[0].c[2]: not a node map; skipped', 'style.bg cannot be written in src; dropped'])
  })

  it('reads nodes nested 100,000 deep and a list 100,000 deep, with no recursion', () => {
    const n = 100_000
    let list: Uv = { a: [1, { b: true }] }
    for (let k = 0; k < n; k++) list = { a: [list] }
    let g: Uv = { m: [['op', 'R'], ['sh', list], ['click', { b: true }]] }
    for (let k = 0; k < n; k++) g = { m: [['op', 'G'], ['c', { a: [g] }], ['x', 1]] }
    const { scene, warnings } = fromProps([['root', { a: [g] }]])
    let r = scene.root[0], levels = 0
    while (r.op === 'G' && r.attrs.x === 1) { r = r.c![0]; levels++ }
    let sh = r.attrs.sh, depth = 0
    while (Array.isArray(sh) && sh.length === 1) { sh = sh[0]; depth++ }
    expect([levels, r.op, depth, sh]).toEqual([n, 'R', n, [1, 1]])
    expect(r.attrs.click).toBe(1)
    expect(warnings).toEqual([])
  })

  it("keeps the scene's root paint defaults on the header, its style winning, s spelled s_", () => {
    const { scene, warnings } = fromProps([['w', 100], ['f', '#fff'], ['s_', '#000'], ['size', 12], ['type', 'vector'],
      ['style', { m: [['s', '#f00'], ['font', 'Barlow'], ['fit', 'shrink'], ['bg', 1]] }], ['root', { a: [] }]])
    expect(scene.header).toEqual({ w: 100, f: '#fff', s_: '#f00', size: 12, font: 'Barlow' })
    expect(warnings).toEqual(['style.fit cannot be written in src; dropped', 'style.bg cannot be written in src; dropped'])
  })
})
