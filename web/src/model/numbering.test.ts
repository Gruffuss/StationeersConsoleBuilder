import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sceneOfProps } from '../srctext/fromProps'
import { foldKey } from '../srctext/props'
import { indexOfNode, indexToPath, KNOWN_OPS, parseOrder, pathOfIndex, pathToIndex } from './numbering'
import type { Scene, SrcNode, Value } from './scene'
import { node } from './testing'

// The VecOp each source op parses as: the VecOp enum and the cases of SceneParser.ParseNode (SceneModel.cs, v0.11.94).
const VEC_OP: Record<string, string> = { G: 'Group', USE: 'Group', RP: 'Repeat', R: 'Rect', C: 'Ellipse', YS: 'Band',
  L: 'Polyline', Y: 'Polyline', LS: 'SampledLine', SP: 'Spline', P: 'Path', T: 'Text', SC: 'Scroll', IMG: 'Image' }

const dir = new URL('../../test/fixtures/examples/', import.meta.url)
const fixtures = readdirSync(dir).filter(f => f.endsWith('.nodes.json')).map(f => f.slice(0, -'.nodes.json'.length)).sort()

const sceneOf = (name: string) => sceneOfProps(JSON.parse(readFileSync(new URL(`${name}.props.json`, dir), 'utf8')))
const at = (scene: Scene, path: number[]) => path.reduce<SrcNode | undefined>((n, k) => (n ? n.c : scene.root)?.[k], undefined)!

const scene = (root: SrcNode[], defs: SrcNode[] = []): Scene => ({ header: {}, defs, root })
const ops = (s: Scene) => parseOrder(s).ops
const paths = (s: Scene) => { const o = parseOrder(s); return o.nodes.map(w => pathOfIndex(s.root, w)) }

describe('numbering', () => {
  it('numbers all 21 example structures, including web fonts', () => {
    expect(fixtures).toHaveLength(21)
    expect(fixtures).toContain('19-webfonts.webfonts')
  })

  it('knows the ops ParseNode parses', () => {
    expect([...KNOWN_OPS].sort()).toEqual(Object.keys(VEC_OP).sort())
  })

  it.each(fixtures)('%s: indexToPath walks the nodes in the mod\'s parse order', name => {
    const expected: string[] = JSON.parse(readFileSync(new URL(`${name}.nodes.json`, dir), 'utf8'))
    const s = sceneOf(name), order = parseOrder(s)
    expect(order.ops.map(op => VEC_OP[foldKey(op)])).toEqual(expected)
    const seen = new Set<string>()
    expected.forEach((vecOp, i) => {
      const path = indexToPath(s, i)!
      expect(path).toEqual(pathOfIndex(s.root, order.nodes[i]))
      if (seen.has(path.join())) expect(foldKey(at(s, path).op)).toBe('USE')   // in a USE's expansion: maps back to the USE
      else {
        expect(VEC_OP[foldKey(at(s, path).op)]).toBe(vecOp)   // the node at the path parses as that op
        expect(pathToIndex(s, path)).toBe(i)
      }
      seen.add(path.join())
    })
    expect(indexToPath(s, expected.length)).toBeNull()
    expect(indexToPath(s, -1)).toBeNull()
  })

  it('expands each USE in place, and maps its expansion back to the USE', () => {
    const s = sceneOf('11-symbols.sym_s')
    expect(paths(s).slice(0, 7)).toEqual([[0], [1], [1], [1], [1], [1], [2]])
    expect(pathToIndex(s, [2])).toBe(6)
    expect(pathToIndex(s, [9, 0])).toBe(34)
  })

  it('skips an unknown op with its whole subtree', () => {
    const s = scene([node('R'), node('SYM', {}, [node('R')]), node('G', {}, [node('X', {}, [node('C')]), node('c')])])
    expect(paths(s)).toEqual([[0], [2], [2, 1]])
    expect(pathToIndex(s, [1])).toBeNull()
    expect(pathToIndex(s, [1, 0])).toBeNull()
    expect(pathToIndex(s, [2, 0, 0])).toBeNull()
    expect(pathToIndex(s, [2, 1])).toBe(2)
    expect(pathToIndex(s, [5])).toBeNull()
    expect(indexToPath(s, 3)).toBeNull()
  })

  // Not in the fixtures; read from ParseNode's USE case and ParseDefs at v0.11.94.
  it('follows the mod for symbols the fixtures do not cover', () => {
    const sym = (id: string, c: SrcNode[], attrs: Record<string, Value> = {}) => node('SYM', { id, ...attrs }, c)
    // An unknown symbol is still a Group, with nothing in it; the USE's own block comes after the expansion.
    expect(ops(scene([node('USE', { ref: 'nope' }, [node('R')])]))).toEqual(['USE', 'R'])
    expect(paths(scene([node('USE', { ref: 's' }, [node('R')])], [sym('s', [node('G', {}, [node('C')])])]))).toEqual([[0], [0], [0], [0, 0]])
    // The last SYM of an id wins; ids are exact; a SYM without a body is no symbol.
    expect(ops(scene([node('USE', { ref: 's' })], [sym('s', [node('C')]), sym('s', [node('T'), node('R')])]))).toEqual(['USE', 'T', 'R'])
    expect(ops(scene([node('USE', { ref: 'S' })], [sym('s', [node('C')])]))).toEqual(['USE'])
    expect(ops(scene([node('USE', { ref: 's' })], [sym('s', [])]))).toEqual(['USE'])
    // %params reach the body's ops and the refs of nested USEs.
    const lib = [sym('box', [node('%kind'), node('USE', { ref: '%inner' })], { kind: 'C', inner: 'dot' }), sym('dot', [node('T')])]
    expect(ops(scene([node('USE', { ref: 'box' })], lib))).toEqual(['USE', 'C', 'USE', 'T'])
    expect(ops(scene([node('USE', { ref: 'box', kind: 'R', inner: 'none' })], lib))).toEqual(['USE', 'R', 'USE'])
    expect(ops(scene([node('%kind')], lib))).toEqual([])   // outside a symbol nothing is substituted
  })

  it('stops at a symbol cycle; a USE chain has no depth limit (0.11.85)', () => {
    const loop = scene([node('USE', { ref: 'a' })], [node('SYM', { id: 'a' }, [node('USE', { ref: 'b' })]), node('SYM', { id: 'b' }, [node('R'), node('USE', { ref: 'a' })])])
    expect(ops(loop)).toEqual(['USE', 'USE', 'R', 'USE'])
    const chain = Array.from({ length: 100 }, (_, k) => node('SYM', { id: `s${k}` }, [node('USE', { ref: `s${k + 1}` })]))
    expect(ops(scene([node('USE', { ref: 's0' })], chain)).length).toBe(101)
    const long = Array.from({ length: 20_000 }, (_, k) => node('SYM', { id: `s${k}` }, [node('USE', { ref: `s${k + 1}` })]))
    expect(ops(scene([node('USE', { ref: 's0' })], long)).length).toBe(20_001)   // no stack overflow
  })

  it('numbers 100,000 nested nodes with no path per node, and maps counts and paths both ways', () => {
    let deep: SrcNode = node('R')
    for (let k = 0; k < 100_000; k++) deep = node('G', {}, [deep])
    const s = scene([node('C'), deep]), o = parseOrder(s)
    expect(o.ops).toHaveLength(100_002)
    expect(o.ops.at(-1)).toBe('R')
    expect(o.nodes.at(-1)).toBe(100_001)
    const path = pathOfIndex(s.root, 100_001)!
    expect(path).toHaveLength(100_001)
    expect(path.slice(0, 3)).toEqual([1, 0, 0])
    expect(indexOfNode(s.root, path)).toBe(100_001)
    expect(pathToIndex(s, path)).toBe(100_001)
    expect(indexOfNode(s.root, [2])).toBeNull()
    expect(pathOfIndex(s.root, 100_002)).toBeNull()
  })

  it('maps one index or path without numbering the rest of the scene', () => {
    // The node after the one asked about throws when its op is read: the walk stops before it, both ways.
    const after = { attrs: {}, get op(): string { throw new Error('walked past the node asked about') } } as SrcNode
    const s = scene([node('R'), node('G', {}, [node('C')]), after])
    expect(indexToPath(s, 2)).toEqual([1, 0])
    expect(pathToIndex(s, [1, 0])).toBe(2)
    expect(pathToIndex(s, [1])).toBe(1)
  })

  it('gives up where the validator\'s work budget does: substituting is charged to one count per walk', () => {
    // 90,000 USEs, each taking a 1,000-deep default whole: 9·10⁷ units of substitution, past the budget of 5·10⁷.
    let deep: Value = [1]
    for (let k = 0; k < 1000; k++) deep = [deep]
    const sym = node('SYM', { id: 'a', p: deep }, Array.from({ length: 90_000 }, () => node('USE', { ref: 'none', q: '%p' })))
    const o = parseOrder(scene([node('USE', { ref: 'a' })], [sym]))
    expect(o.ops.length).toBeGreaterThan(40_000)
    expect(o.ops.length).toBeLessThan(60_000)
  })

  it('bounds the walk when expansions fan out', () => {
    const fan = Array.from({ length: 40 }, (_, k) => node('SYM', { id: `s${k}` }, [node('USE', { ref: `s${k + 1}` }), node('USE', { ref: `s${k + 1}` })]))
    const s = scene([node('USE', { ref: 's0' }), node('R')], fan)
    expect(pathToIndex(s, [1])).toBeNull()   // 2^41 nodes come first: given up, not hung
  })
})
