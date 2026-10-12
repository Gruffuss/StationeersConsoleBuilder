import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
beforeEach(() => { let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 1_000_000) })
afterEach(() => vi.restoreAllMocks())
import { stringWork } from '../../test/work'
import type { Scene, SrcNode, Value } from '../model/scene'
import { node } from '../model/testing'
import { sceneOfProps } from '../srctext/fromProps'
import { MAX_WORK } from '../srctext/validate'
import { trapsOf, type TrapId } from './traps'

const scene = (root: SrcNode[], defs: SrcNode[] = [], header: Record<string, Value> = { w: 10, h: 10 }): Scene => ({ header, defs, root })
const said = (s: Scene) => trapsOf(s).map(t => t.message)
const ids = (s: Scene) => trapsOf(s).map(t => t.id)
const lacks = (id: TrapId, s: Scene) => expect(ids(s)).not.toContain(id)

const grad = (attrs: Record<string, Value> = {}) => node('GL', { id: 'g', stops: [[0, '#000'], [1, '#fff']], ...attrs })
const bowtie = [0, 0, 10, 10, 10, 0, 0, 10]

describe('trapsOf', () => {
  it.each(['fill', 'inherited', 'shadow', 'clip'])('warns about a self-crossing filled P contour (%s)', paint => {
    const p = node('P', { d: 'M0 0 L10 10 L10 0 L0 10 Z', ...(paint === 'fill' ? { f: '#fff' } : paint === 'shadow' ? { sh: [0, 2, 4, 0, '#000'] } : {}) })
    const s = paint === 'inherited' ? scene([node('G', { f: '#fff' }, [p])]) : paint === 'clip' ? scene([], [node('CP', { id: 'c' }, [p])]) : scene([p])
    expect(ids(s)).toContain('p-crosses')
    expect(said(s).join(' ')).toContain('this P crosses itself')
    expect(ids(scene([node('P', { d: p.attrs.d, s: '#fff' })]))).not.toContain('p-crosses')
    expect(ids(scene([node('P', { d: 'M0 0 L10 0 L10 10 L0 10 Z M2 2 L2 8 L8 8 L8 2 Z', f: '#fff' })]))).not.toContain('p-crosses')
  })
  it('charges P contour crossings to the shared work budget and leaves a warning when unchecked', () => {
    const d = 'M0 0 ' + Array.from({ length: 11000 }, (_, i) => `L${i+1} 1`).join(' ') + ' Z'
    expect(ids(scene([node('P', { d, f: '#fff' })]))).toContain('p-unchecked')
  })
  it('detects a curved P crossing even at a sampled vertex, without flagging repeated adjacent samples', () => {
    const d = 'M0 0 C0 0 100 100 100 100 L100 0 C100 0 0 100 0 100 Z'
    expect(ids(scene([node('P', { d, f: '#fff' })]))).toContain('p-crosses')
    const simple = 'M0 0 C0 0 0 0 0 0 L100 0 L100 100 L0 100 Z'
    expect(ids(scene([node('P', { d: simple, f: '#fff' })]))).not.toContain('p-crosses')
  })
  it('ignores names, time and index syntax inside quoted expression strings', () => {
    const attrs = { x: '=\"$word[n] pi t\"', y: "='tau $next[i+1]'", f: '@g' }
    expect(said(scene([node('R', attrs)], [grad()]))).toEqual([])
    expect(ids(scene([node('R', { x: '=$v[i+1] + \"$v[i]\"' })]))).toEqual(['index-n'])
    expect(ids(scene([node('R', { x: '=p\"text\"i' })]))).not.toContain('bare-pi')
  })
  it('gradient-units: a scene-units gradient on a shape that moves', () => {
    const slides = (k: string) => `${k}="@g" on a moving shape: gradient "g" is in scene units, so the shape slides under it; give "g" units=bbox`
    expect(said(scene([node('R', { x: '=t*10', w: 5, h: 5, f: '@g' })], [grad()]))).toEqual([slides('f')])
    expect(said(scene([node('C', { cx: '$pos', rx: 5, s: '@g' })], [grad()]))).toEqual([slides('s')])   // moved by data
    lacks('gradient-units', scene([node('R', { x: '=t*10', f: '@g' })], [grad({ units: 'bbox' })]))
    lacks('gradient-units', scene([node('R', { x: '=t*10', f: '@g' })], [grad({ x1: '=t*10' })]))   // the ramp follows
    lacks('gradient-units', scene([node('R', { x: '=10', f: '@g' })], [grad()]))   // a constant
    lacks('gradient-units', scene([node('RP', { n: 4 }, [node('R', { x: '=i*10', f: '@g' })])], [grad()]))   // laid out once
    lacks('gradient-units', scene([node('YS', { n: 8, x: '=i*4', y: '=$h[i]', f: '@g' })], [grad()]))   // a band's samples
    // the ramp is sampled in the shape's own frame, so it moves with an enclosing transform
    lacks('gradient-units', scene([node('G', { t: ['=t', 0] }, [node('L', { p: [0, 0, 1, 1], s: '@g' })])], [grad()]))
  })

  it('bare-pi: pi and tau are functions', () => {
    expect(said(scene([node('R', { x: '=pi*2', y: '=1+tau' })]))).toEqual(
      ['"pi" is a function in expressions: write pi()', '"tau" is a function in expressions: write tau()'])
    expect(said(scene([node('T', { text: 'a {=pi*2}' })]))).toEqual(['"pi" is a function in expressions: write pi()'])
    lacks('bare-pi', scene([node('R', { x: '=pi()*2', y: '=tau ()' })]))
    lacks('bare-pi', scene([node('T', { text: 'pi' })]))   // plain text is not an expression
    lacks('bare-pi', scene([node('T', { text: 'tc {$tau}s {$pi:%.2f} {$pi[0]}' })]))   // data names
  })

  it('y-crosses: a self-intersecting Y the mod fills, shadows or clips', () => {
    const crossing = 'this Y crosses itself, which the mod cannot fill, shadow or clip: uncross the ring or split it'
    expect(said(scene([node('Y', { p: bowtie, f: '#fff' })]))).toEqual([crossing])
    expect(said(scene([node('G', { f: '#fff' }, [node('Y', { p: bowtie, s: '#000' })])]))).toEqual([crossing])   // an inherited fill
    expect(said(scene([node('Y', { p: bowtie, sh: [0, 2, 4, 0, '#000'] })]))).toEqual([crossing])
    expect(said(scene([], [node('CP', { id: 'c' }, [node('Y', { p: bowtie })])]))).toEqual([crossing])
    lacks('y-crosses', scene([node('Y', { p: bowtie, s: '#fff' })]))   // a stroke draws it as it is
    lacks('y-crosses', scene([node('Y', { p: bowtie, s: '#fff', f: 'none' })], [], { w: 10, h: 10, f: '#fff' }))
    lacks('y-crosses', scene([node('Y', { p: [0, 0, 10, 0, 10, 10, 0, 10], f: '#fff' })]))
  })

  it('tests a ring of any size, within the work budget', () => {
    const p = [...bowtie, ...Array.from({ length: 2992 }, (_, k) => k)]   // 1500 points, crossing at once
    expect(ids(scene([node('Y', { p, f: '#fff' })]))).toEqual(['y-crosses'])
  })

  it('charges the crossing tests to a work budget: past it, one warning says how many rings were not tested', () => {
    const p = [...bowtie, ...Array.from({ length: 1992 }, (_, k) => k)]   // 1000 points: 500,000 steps each
    const map = scene([...Array.from({ length: 102 }, () => node('Y', { p, f: '#fff' })), node('R', { o: 1 })])
    const traps = trapsOf(map)
    expect(traps.filter(t => t.id === 'y-crosses')).toHaveLength(100)
    expect(traps.slice(100).map(t => [t.id, t.message, t.node])).toEqual([   // the walk goes on
      ['not-read', '"o" does nothing on R: the mod reports it: remove it', map.root[102]],
      ['y-unchecked', `whether 2 Y shapes cross themselves is not checked: the crossing checks ran out of work (more than ${MAX_WORK} steps)`, undefined]])
    lacks('y-unchecked', scene(Array.from({ length: 100 }, () => node('Y', { p, f: '#fff' }))))
  })

  it('p-odd, p-few: the mod reads p in x, y pairs, and each paint takes a number of points: a stroke two, a fill three', () => {
    // Measured in the headless core at 0.11.97 to 0.11.101 (FromFlat, EmitPath), and seen on a console at 0.11.101: a last
    // odd value is dropped (five values are a two-point line, three are one point); an L, Y or SP with fewer than two
    // points draws nothing, and the advice names what its paints need. With two, a stroke draws the line between them and a
    // fill encloses nothing: a Y's fill and shadow draw nothing, an L's fill nothing, and an SP's fill (its points are its
    // curve's samples) at most its feathered edge, a hairline. None of it is reported.
    const odd = (n: number) => `"p" has ${n} values, an odd number: the mod reads x, y pairs and ignores the last value, without a report: add its pair or remove it`
    const few = (op: string, what: string, need: string) => `this ${op} has ${what}, so the mod draws nothing, without a report: give "p" ${need} or more`
    const two = 'two points (four numbers)', three = 'three points (six numbers)'
    const zero = '"p" takes a list of numbers here; an entry that is not a number (text, an expression or a list) reads as 0: write numbers only'
    expect(said(scene([node('L', { p: [0, 0, 10, 10, 5], s: '#fff' }), node('SP', { p: [0, 0, 5, 5, 10, 0, '=t'], s: '#fff' })]))).toEqual([odd(5), '"p" is read as a plain number and is not evaluated; the mod reports it: write a number', odd(7)])
    expect(said(scene([node('L', { p: [0, 0], s: '#fff' }), node('SP', { s: '#fff' }), node('Y', { p: [], f: '#fff' }), node('Y', { p: [1, 1], s: '#fff' })])))
      .toEqual([few('L', 'one point', two), few('SP', 'no point', two), few('Y', 'no point', three), few('Y', 'one point', two)])
    // a fill needs three: an L or an SP that fills, by its own f; a Y that fills, its f passed down too, or casts a shadow
    expect(said(scene([node('L', { p: [0, 0], f: '#fff', s: '#000' }), node('SP', { p: [], f: '#fff' }), node('G', { f: '#fff' }, [node('L', { s: '#000' })]),
      node('Y', { sh: [0, 2, 4, 0, '#000'] }), node('G', { f: '#fff' }, [node('Y', { p: [1, 1], s: '#000' })])])))
      .toEqual([few('L', 'one point', three), few('SP', 'no point', three), few('L', 'no point', two), few('Y', 'no point', three), few('Y', 'one point', three)])
    expect(said(scene([node('L', { p: [0, 0, 5], s: '#fff' })]))).toEqual([odd(3), few('L', 'one point', two)])
    const enclose = `this Y has two points, which enclose nothing, so its fill and shadow draw nothing, without a report (a stroke draws the line between them): give "p" ${three} or more`
    expect(said(scene([node('Y', { p: [0, 0, 10, 0], f: '#fff' }), node('G', { f: '#fff' }, [node('Y', { p: [0, 0, 10, 0], s: '#000' })]),
      node('Y', { p: [0, 0, 10, 0], sh: [0, 2, 4, 0, '#000'] })]))).toEqual([enclose, enclose, enclose])
    // an L with two points and a fill of its own fills nothing; an SP's fill, open or closed, draws at most its feathered edge
    const line = `this L has two points, which enclose nothing, so its fill draws nothing, without a report (a stroke draws the line between them): give "p" ${three} or more`
    const curve = `this SP has two points, which enclose nothing, so its fill draws at most its feathered edge, a hairline, and nothing where the two are (nearly) level or one above the other, without a report (a stroke draws the line between them): give "p" ${three} or more`
    expect(said(scene([node('L', { p: [0, 0, 10, 10], f: '#fff', s: '#000' }), node('SP', { p: [0, 0, 10, 10], f: '#fff' }),
      node('SP', { p: [0, 0, 10, 10], close: 1, f: '#fff', sh: [0, 2, 4, 0, '#000'] })]))).toEqual([line, curve, curve])
    // p as the mod reads it (Numbers): a number is no list; an entry that is not a number, a list too, reads as 0; and a
    // stroke drops a point that repeats the one before it (Stroke.Clean), so points all at one place draw nothing (the C#
    // suite draws each, fill and shadow too)
    expect(said(scene([node('L', { p: 5, s: '#fff' })]))).toEqual([few('L', 'no point ("p" is a number, not a list)', two)])
    expect(said(scene([node('L', { p: [10, 10, 10, 10], s: '#fff' }), node('Y', { p: [1, 1, 1, 1, 1, 1], f: '#fff' }),
      node('SP', { p: [3, 3, 3, 3], close: 1, f: '#fff' })])))
      .toEqual([few('L', '2 points, all at one place', two), few('Y', '3 points, all at one place', three), few('SP', '2 points, all at one place', three)])
    expect(said(scene([node('L', { p: [[0, 0], [1, 1]], s: '#fff' })]))).toEqual([zero, few('L', 'one point', two)])
    // a stroked Y with two points draws its line, a closed SP with two casts its shadow (a blurred line), a fill passed
    // down to an L or an SP with two (a line under a filled group) is not called theirs (provisional, for the owner), a Y whose last point is its first
    // is kept as written, and a Y whose three points are two still casts its shadow (a blurred line)
    for (const n of [node('Y', { p: [0, 0, 10, 0], s: '#fff' }), node('Y', { p: [0, 0, 10, 0], s: '#fff', f: 'none' }),
      node('SP', { p: [0, 0, 10, 10], close: 1, sh: [0, 2, 4, 0, '#000'] }), node('G', { f: '#fff' }, [node('L', { p: [0, 0, 10, 10], s: '#000' }), node('SP', { p: [0, 0, 10, 10], s: '#000' })]),
      node('Y', { p: [0, 0, 10, 0, 10, 10, 0, 0], f: '#fff' }), node('L', { p: [0, 0, 1, 1] }), node('L', { p: [0, 0, 10, 10, 20, 0], f: '#fff' }),
      node('Y', { p: [0, 0, 10, 0, 0, 0], sh: [0, 2, 4, 0, '#000'] }), node('L', { p: [0, 0, 0, 0, 1, 1], s: '#fff' })])
      expect(said(scene([n])), JSON.stringify(n.attrs)).toEqual([])
    // a clip's shape with too few points the mod reports (no usable shape); in a SYM body a substituted p may be any
    expect(said(scene([], [node('CP', { id: 'c' }, [node('Y', { p: [0, 0, 10, 0] })])]))).toEqual([])
    expect(said(scene([], [node('SYM', { id: 's' }, [node('L', { p: '%pts', s: '#fff' }), node('Y', { p: [0, 0, '%x'], f: '#fff' })])]))).toEqual([])
  })

  it('sp-shadow: an SP casts a shadow only when closed', () => {
    expect(said(scene([node('SP', { p: [0, 0, 5, 5, 10, 0], sh: [0, 2, 4, 0, '#000'] })]))).toEqual(['SP casts no shadow without close=1: add close=1 or remove "sh"'])
    lacks('sp-shadow', scene([node('SP', { p: [0, 0, 5, 5, 10, 0], f: '#fff' })]))   // an open SP fills as if closed
    lacks('sp-shadow', scene([node('SP', { p: [0, 0, 5, 5, 10, 0], close: 1, sh: [0, 2, 4, 0, '#000'] })]))
  })

  it('index-n: a 1-based index', () => {
    const past = (n: string) => `"$${n}[n]" is past the end: arrays count from 0, so write $${n}[n-1] for the last`
    expect(said(scene([node('R', { x: '=$a[n]' })]))).toEqual([past('a')])
    expect(said(scene([node('T', { text: 'row {$rows[n]}' })]))).toEqual([past('rows')])
    expect(said(scene([node('R', { x: '=$a[ i + 1 ]' })]))).toEqual(
      ['"$a[i+1]" looks 1-based: arrays and i count from 0, so this skips the first item and reads past the end on the last; write $a[i]'])
    lacks('index-n', scene([node('R', { x: '=$a[n-1]', y: '=$a[i]' })]))
    // the next sample beside this one is a neighbour, not a 1-based index
    lacks('index-n', scene([node('YS', { n: 8, x: '=i*4', y: '=$v[i]', y2: '=$v[i+1]' })]))
    lacks('index-n', scene([node('RP', { n: 7 }, [node('R', { h: '=$v[i+1]-$v[i]' })])]))
  })

  it('literal-only: N and NL keys take no text', () => {
    expect(said(scene([node('SP', { p: [0, 0, 1, 1], seg: '=4' })]))).toEqual(['"seg" is read as a plain number and is not evaluated; the mod reports it: write a number'])
    expect(said(scene([node('IMG', { src: 'a', uv: '$uv' })]))).toEqual(['"uv" is read as a plain number and is not evaluated; the mod reports it: write a number'])
    // a key with no default says what absence means, or which key it follows
    expect(said(scene([node('G', { m: '=1' })]))).toEqual(['"m" is read as a plain number and is not evaluated; the mod reports it: write a number'])
    expect(said(scene([node('IMG', { src: 'a', slice: [1, 1, 1, 1], bw: '2' })]))).toEqual([]) // the tag reports this; decisions:77 forbids a second trap
    lacks('literal-only', scene([node('SP', { p: [0, 0, 1, 1], seg: 8 })]))
    // a list key reads a single number as no list: dash then draws a solid stroke, in silence (the C# suite draws it); m, uv,
    // slice and bw the mod reports for their length, and p-few speaks for p
    expect(said(scene([node('L', { p: [0, 0, 1, 1], s: '#fff', dash: 5 })]))).toEqual(['"dash" takes a list of numbers here; a single number is ignored and its default is used: write [a, b, …]'])
    lacks('literal-only', scene([node('G', { m: 5 }), node('IMG', { src: 'a', uv: 1 })]))
    // an entry that is not a number reads as 0 (Numbers), a nested list too
    const zero = (k: string) => `"${k}" takes a list of numbers here; an entry that is not a number (text, an expression or a list) reads as 0: write numbers only`
    expect(said(scene([node('L', { p: [10, 10, [90, 90], 5], s: '#fff', dash: [5, '=t'] })]))).toEqual([zero('p'), '"dash" is read as a plain number and is not evaluated; the mod reports it: write a number'])
    lacks('literal-only', scene([], [node('SYM', { id: 's' }, [node('L', { p: [0, 0, '%x', 5], s: '#fff' })])]))
  })

  it('pair-scalar: a pair given one value', () => {
    expect(said(scene([node('G', { t: 5 })]))).toEqual(['"t" takes a pair [x, y]; a single value is ignored: write [x, y]'])
    lacks('pair-scalar', scene([node('G', { t: [1, 2] })]))
    lacks('pair-scalar', scene([node('IMG', { src: 'a', tile: 'Contain' })]))   // a tile fit word
  })

  it('needs-key: a key read only with another', () => {
    expect(said(scene([node('R', { fo: 0.5, sw: 2 })]))).toEqual(['"fo" is read only with "f": add "f" or remove "fo"', '"sw" is read only with "s": add "s" or remove "sw"'])
    expect(said(scene([node('R', { f: 'none', fo: 0.5 })], [], { w: 10, h: 10, f: '#fff' }))).toEqual(['"fo" is read only with "f": add "f" or remove "fo"'])
    // a G's s is its scale pair, never a stroke colour
    expect(said(scene([node('G', { s: [2, 2], sw: 1 })]))).toEqual(['"sw" is read only with "s_": add "s_" or remove "sw"'])
    expect(said(scene([node('SC', { id: 'l', sov: 1 })]))).toEqual(['"sov" is read only with "so": add "so" or remove "sov"'])
    lacks('needs-key', scene([node('G', { f: '#fff' }, [node('R', { fo: 0.5 })])]))   // fo with f on an enclosing G
    lacks('needs-key', scene([node('G', {}, [node('G', { s_: '#fff' }, [node('R', { sw: 2, cap: 'round' })])])]))
    lacks('needs-key', scene([node('R', { fo: 0.5 })], [], { w: 10, h: 10, f: '#fff' }))
    lacks('needs-key', scene([], [node('SYM', { id: 's' }, [node('R', { fo: 0.5 })])]))   // the USE may give f
  })

  it('needs-key: fea needs nothing (0.11.91 reads it on every node)', () => {
    lacks('needs-key', scene([node('R', { s: '#fff', fea: 0 })]))
    lacks('needs-key', scene([node('G', { s_: '#fff', fea: 0 }, [node('R')])]))
    lacks('needs-key', scene([node('YS', { n: 2, fea_edge: 0 })]))
  })

  it('needs-key: a default a node passes down is read by the children that meet it themselves', () => {
    lacks('needs-key', scene([node('G', { fo: 0.5, sw: 2 }, [node('R', { f: '#f00' }), node('L', { s: '#fff' })])]))
    lacks('needs-key', scene([node('G', { fo: 0.5 }, [node('G', {}, [node('USE', { ref: 's' })])])]))   // a symbol may
    expect(said(scene([node('G', { fo: 0.5 }, [node('R', { s: '#fff' })])]))).toEqual(['"fo" is read only with "f": add "f" or remove "fo"'])
    expect(said(scene([node('G', { fo: 0.5 }, [node('R', { f: 'none' })])]))).toEqual(['"fo" is read only with "f": add "f" or remove "fo"'])
    // a G's scale is no stroke colour below it either
    expect(said(scene([node('G', { sw: 2 }, [node('G', { s: [2, 2] })])]))).toEqual(['"sw" is read only with "s_": add "s_" or remove "sw"'])
    lacks('needs-key', scene([node('G', { sw: 3 }, [node('R', { s: '#fff' })])]))
    // a shape with a block passes its defaults on too; its sov is its own
    expect(said(scene([node('R', { sw: 3 }, [node('L', { p: [0, 0, 1, 1], s: '#fff' })])]))).toEqual([])
    expect(said(scene([node('SC', { id: 'l', sov: 1 }, [node('R', { so: 1, s: '#fff' })])]))).toEqual(['"sov" is read only with "so": add "so" or remove "sov"'])
  })

  it('needs-key: so and an SC', () => {
    // Since 0.11.98 an SC reads its scroll offset from its own map: a so passed down to it, from a G or the SCENE header,
    // is not its offset, so its sov still needs its own so, and nothing but a stroke reads the passed so (until 0.11.97
    // an SC with sov took it as its offset).
    const sov = '"sov" is read only with "so": add "so" or remove "sov"', stroke = '"so" is read only with "s_": add "s_" or remove "so"'
    expect(said(scene([node('G', { s_: '#fff', so: 0.5 }, [node('SC', { id: 'l', sov: 1 })])]))).toEqual([sov])
    // the header's so, and a G's so two levels up, past a G that passes it on
    expect(said(scene([node('SC', { id: 'l', sov: 1 })], [], { w: 10, h: 10, so: 0.5 }))).toEqual([sov, stroke])
    expect(said(scene([node('G', { so: 0.5 }, [node('G', {}, [node('SC', { id: 'l', sov: 1 })])])]))).toEqual([sov, stroke])
    // an SC passes on a so it inherits (only its own stays with it), and a stroke inside reads it
    expect(said(scene([node('G', { so: 0.5 }, [node('SC', { id: 'a' }, [node('SC', { id: 'b', sov: 1 })])])]))).toEqual([sov, stroke])
    lacks('needs-key', scene([node('G', { so: 0.5 }, [node('SC', { id: 'a', so: 0.3, sov: 1 }, [node('R', { s: '#fff' })])])]))
    // an SC without sov, or with its own so, does not read the one passed down
    expect(said(scene([node('G', { so: 0.5 }, [node('SC', { id: 'l' })])]))).toEqual([stroke])
    expect(said(scene([node('G', { so: 0.5 }, [node('SC', { id: 'l', so: 0.3, sov: 1 })])]))).toEqual([stroke])
    // a so beside the SC is not passed to it
    expect(said(scene([node('G', { so: 0.5 }), node('SC', { id: 'l', sov: 1 })]))).toEqual([stroke, sov])
    // an SC keeps its own so, its scroll offset, since 0.11.92: it is no stroke opacity for its children, whatever they
    // stroke with
    const so = '"so" is read only with "sov": add "sov" or remove "so"'
    expect(said(scene([node('SC', { id: 'l', so: 0.3 }, [node('R', { s: '#fff' })])]))).toEqual([so])
    expect(said(scene([node('SC', { id: 'l', so: 0.3 }, [node('R', { f: '#fff' })])]))).toEqual([so])
    expect(said(scene([node('G', { s_: '#fff' }, [node('SC', { id: 'l', so: 0.3 }, [node('R', { f: '#fff' })])])]))).toEqual([so])
    lacks('needs-key', scene([node('SC', { id: 'l', so: 0.3, sov: 1 }, [node('R', { s: '#fff' })])]))
  })

  it('default-case: a group default passes down only as written, in lower case', () => {
    // ParseStyle searches GroupPaintDefaults ordinally, so SO=, F= or S_= on a G or the header is not passed down, and
    // there it is read for nothing else; the children then lack it as if it were absent.
    const lower = (k: string, op = 'G') => `"${k}" does nothing on ${op}: the mod passes a group default down only as written in lower case: write ${k.toLowerCase()}`
    expect(said(scene([node('G', { SO: 0.5 }, [node('SC', { id: 'l', SOV: 1 })])]))).toEqual([lower('SO'), '"SOV" is read only with "so": add "so" or remove "SOV"'])
    expect(said(scene([node('G', { F: '#fff', fo: 0.5 }, [node('R')])]))).toEqual([lower('F'), '"fo" is read only with "f": add "f" or remove "fo"'])
    expect(said(scene([node('G', { S_: '#fff', sw: 2 }, [node('L', { p: [0, 0, 1, 1] })])]))).toEqual([lower('S_'), '"sw" is read only with "s_": add "s_" or remove "sw"'])
    expect(said(scene([node('G', { Fea_Edge: 2 }, [node('YS', { n: 2 })])]))).toEqual([lower('Fea_Edge')])
    // the header's too, and a node with a block whose op does not read the key (RP)
    expect(trapsOf(scene([node('R', { fo: 0.5 })], [], { w: 10, h: 10, F: '#fff' })).map(t => [t.id, t.node])).toEqual([['default-case', undefined], ['needs-key', expect.anything()]])
    expect(said(scene([node('RP', { n: 2, FO: 0.5 }, [node('R', { f: '#fff' })])]))).toEqual([lower('FO', 'RP')])
    // a G passes on what it inherited past its own F, which it does not collect
    lacks('needs-key', scene([node('G', { f: '#fff' }, [node('G', { F: '#000' }, [node('R', { fo: 0.5 })])])]))
    // read in any case where the op reads the key itself: an SC's own so, a shape's own fill, the header's fit; and the
    // lower case passes down
    expect(said(scene([node('SC', { id: 'l', SO: 0.3, SOV: 1 }, [node('R', { s: '#fff' })])]))).toEqual([])
    expect(said(scene([node('R', { F: '#fff', fo: 0.5 }, [node('L', { p: [0, 0, 1, 1], s: '#fff' })])]))).toEqual([])
    expect(said(scene([node('R')], [], { w: 10, h: 10, FIT: 'contain' }))).toEqual([])
    expect(said(scene([node('G', { so: 0.5, f: '#fff', s_: '#fff' }, [node('SC', { id: 'l', so: 0.3, sov: 1 }), node('R', { fo: 0.5, sw: 1 })])]))).toEqual([])
  })

  it('needs-key: a text outline colour needs its width', () => {
    expect(said(scene([node('T', { text: 'a', oc: '#fff' })]))).toEqual(['"oc" is read only with "ow": add "ow" or remove "oc"'])
    lacks('needs-key', scene([node('T', { text: 'a', oc: '#fff', ow: 1 })]))
  })

  it('needs-key: fat and sat need a gradient', () => {
    expect(said(scene([node('R', { f: '#fff', fat: 0.5 }), node('L', { p: [0, 0, 1, 1], s: '=mix(#000, #fff, t)', sat: 0.5 })]))).toEqual([
      '"fat" is read only when "f" is a gradient: make "f" an @gradient or remove "fat"',
      '"sat" is read only when "s" is a gradient: make "s" an @gradient or remove "sat"'])
    lacks('needs-key', scene([node('R', { f: '@g', fat: 0.5 }), node('G', { s_: '@g' }, [node('L', { sat: '=t' })])], [grad()]))
    // a node's own paint replaces the one passed down
    expect(ids(scene([node('G', { f: '@g' }, [node('R', { f: '#fff', fat: 0.5 })])], [grad()]))).toEqual(['needs-key'])
  })

  it('enum-word: a word the mod does not know', () => {
    expect(said(scene([node('T', { text: 'a', align: 'middle' })]))).toEqual(['"align" does not take "middle", the mod reports it, and left is used: write left, center, right or justified'])
    expect(said(scene([], [grad({ units: 'user' })]))).toEqual(['"units" does not take "user", the mod reports it, and scene units is used: write bbox'])
    lacks('enum-word', scene([node('T', { text: 'a', align: 'centre', valign: 'Center', font: 'code' })]))
    // a G's fit is a default for its texts and its images
    lacks('enum-word', scene([node('G', { fit: 'contain' }, [node('IMG', { src: 'a' }), node('T', { text: 'a' })])]))
    expect(said(scene([node('G', { fit: 'squash' }, [node('IMG', { src: 'a' })])]))).toEqual(
      ['"fit" does not take "squash", the mod reports it, and each child takes its own default: write stretch, none, ellipsis, shrink, fill, contain, cover or scale-down'])
    lacks('enum-word', scene([node('IMG', { src: 'a', tile: [1, 1], rep: 'tiles', slice: [1, 1, 1, 1], srep: 'tiles' })]))   // the mod reports these
  })

  it('not-read: a real key on an op that does not read it', () => {
    expect(said(scene([node('R', { o: 0.5 })]))).toEqual(['"o" does nothing on R: the mod reports it: remove it'])
    expect(said(scene([node('RP', { n: 2, f: '#fff' })]))).toEqual(['"f" does nothing on RP: remove it'])
    lacks('not-read', scene([node('R', { f: '#fff' })]))
    lacks('not-read', scene([node('RP', { n: 2, f: '#fff' }, [node('R')])]))   // a default for its children
    // a label has no edge to soften; on a G fea is a default for its shapes
    expect(said(scene([node('T', { text: 'a', fea: 0 })]))).toEqual(['"fea" does nothing on T: remove it'])
    expect(said(scene([node('G', { fea: 0 }, [node('T', { text: 'a' })])]))).toEqual([])
    // an open line fills as if closed
    expect(said(scene([node('L', { p: [0, 0, 5, 5], s: '#fff', f: 'none' }), node('LS', { n: 2, f: '#fff', fo: 0.5, fea: 1 })]))).toEqual([])
  })

  it('not-read: a band records no hit area; sd and sdo are gone, so the mod reports them (0.11.96)', () => {
    expect(said(scene([node('YS', { n: 2, click: 1 }), node('R', { s: '#fff', sd: 1, sdo: 2 })]))).toEqual(['"click" does nothing on YS: remove it',
      '"sd" is not a vector attribute: the mod reports it and draws the magenta border; fix its name or remove it',
      '"sdo" is not a vector attribute: the mod reports it and draws the magenta border; fix its name or remove it'])
    lacks('not-read', scene([node('LS', { n: 2, click: 1 }), node('T', { id: 't', click: 1 }), node('IMG', { src: 'a', id: 'i', click: 1 })]))
  })

  it('says nothing of a mask without its @: the mod reports it (0.11.96)', () => {
    expect(said(scene([node('G', { mask: 'g' }, [node('R')])], [grad()]))).toEqual([])
    expect(said(scene([node('G', { mask: '@g', clip: 'c' }, [node('R')])], [grad(), node('CP', { id: 'c' }, [node('R')])]))).toEqual([])
  })

  it('unknown-key: not a vector attribute', () => {
    expect(said(scene([node('R', { fille: '#fff' })]))).toEqual(['"fille" is not a vector attribute: the mod reports it and draws the magenta border; fix its name or remove it'])
    // a def's own keys are validated since 0.11.94, a clip's shape since 0.11.96
    const loud = '"colour" is not a vector attribute: the mod reports it and draws the magenta border; fix its name or remove it'
    expect(said(scene([], [grad({ colour: 'red' }), node('CP', { id: 'c', colour: 1 }, [node('R', { w: 1, h: 1, colour: 1 })])])))
      .toEqual([loud, loud, loud])
    // a symbol's body is validated where it is used
    expect(said(scene([], [node('SYM', { id: 's' }, [node('R', { fille: 1 })])]))).toEqual(
      ['"fille" is not a vector attribute: the mod reports it and draws the magenta border; fix its name or remove it'])
    lacks('unknown-key', scene([node('USE', { ref: 's', colour: '#f00', w: 3 })], [node('SYM', { id: 's', colour: '#fff' }, [node('R', { f: '%colour' })])]))
  })

  it('carries the key each trap is about, as written', () => {
    expect(trapsOf(scene([node('T', { text: 'a', ALIGN: 'middle', o: 1 }), node('R', { x: '=pi' })])).map(t => t.key)).toEqual(['ALIGN', 'o', undefined])
  })

  it('checks the SCENE header as op SCENE: its traps have no node', () => {
    // Since 0.11.96 the mod checks the header's keys, passing the host's own (z_index …), which the src text never reaches.
    const traps = trapsOf(scene([node('R')], [], { w: '$size', h: 100, fit: 'contian', zzz: 1, sw: 2, x: 1, z_index: 2, Visible: 1 }))
    expect(traps.map(t => t.message)).toEqual([
      '"w" is read as a plain number and is not evaluated; the mod reports it: write a number',
      '"fit" does not take "contian", the mod reports it, and stretch is used: write stretch, contain or cover',
      '"zzz" is not a vector attribute: the mod reports it and draws the magenta border; fix its name or remove it',
      '"x" does nothing on SCENE: remove it',
      '"z_index" does nothing on SCENE: remove it',
      '"Visible" does nothing on SCENE: remove it',
      '"sw" is read only with "s_": add "s_" or remove "sw"'])   // nothing below strokes
    expect(traps.every(t => t.node === undefined)).toBe(true)
    lacks('needs-key', scene([node('G', {}, [node('R', { s: '#fff' })])], [], { w: 10, h: 10, sw: 2 }))
  })

  it('not-text keeps strict strings and accepts PropText numeric values', () => {
    const traps = trapsOf(scene([node('T', { text: 42, font: 42, id: 42 }), node('P', { d: 12 })]))
    expect(traps.map(t => t.key)).toEqual(['d'])
    expect(traps[0].id).toBe('not-text')
  })

  it('needs-key: a pointer key needs an id, or the mod makes no hit region', () => {
    expect(said(scene([node('R', { click: 1 }), node('P', { d: 'M0 0', id: '', drag: 1 })]))).toEqual([
      '"click" is read only with "id": the mod reports it: add "id" or remove "click"', '"drag" is read only with "id": the mod reports it: add "id" or remove "drag"'])
    lacks('needs-key', scene([node('R', { id: 'b', click: 1 })]))
    // inside an RP each instance records its own hit region, btn:0..btn:2 (measured at 0.11.94)
    expect(said(scene([node('RP', { n: 3 }, [node('R', { id: 'btn', click: 1 })])]))).toEqual([])
  })

  it('scene-size: a SCENE w or h below 1 is raised to 1 without a report', () => {
    expect(trapsOf(scene([node('R')], [], { w: 0.5, h: 0 })).map(t => [t.id, t.message, t.key, t.node])).toEqual([
      ['scene-size', '"w" below 1 is raised to 1 without a report, so the scene is 1 unit wide: write 1 or more', 'w', undefined],
      ['scene-size', '"h" below 1 is raised to 1 without a report, so the scene is 1 unit high: write 1 or more', 'h', undefined]])
    expect(said(scene([node('R')], [], { W: -3 }))).toEqual(['"W" below 1 is raised to 1 without a report, so the scene is 1 unit wide: write 1 or more'])
    lacks('scene-size', scene([node('R')], [], { w: 1, h: 1e9 }))   // no upper bound
    lacks('scene-size', scene([node('R')], [], {}))   // 100 by 100
    lacks('scene-size', scene([node('R', { w: 0.5, h: 0 })]))   // a node's own size is no scene size
  })

  it('says nothing of a fmt the mod reports (0.11.100): one that prints itself, and one no number takes', () => {
    // The specs in printf.json, which the C# suite holds to the mod's Printf.ToNet and its report. unread: Translate hands
    // them back unchanged (no %, a lone % or %% first, no letter after the %, a letter it has no conversion for: it is
    // case-sensitive, %D is none), so they print as written. read: a conversion, with flags, width and precision before the
    // letter and text around. composite: unread, but a brace makes them a format string.Format reads, and they print the
    // number. reported: the specs the mod reports, formatting a sample through each (CheckFormat): every unread one and the
    // empty one, which print themselves, and each one string.Format refuses for a float and for a long, which prints the
    // missing text: a brace it cannot read, or a format no number takes ({0:Z}).
    const specs: Record<'unread' | 'read' | 'composite' | 'reported', string[]> = JSON.parse(readFileSync(new URL('../../test/fixtures/printf.json', import.meta.url), 'utf8'))
    expect(specs.reported).toEqual(expect.arrayContaining(['%q', 'nonsense', '{', '%.1f{', '{0:Z}', 'x{{y']))
    expect(specs.reported).not.toContain('')
    expect(specs.reported).not.toContain('%')
    for (const fmt of specs.reported) for (const text of ['$v', 'set {$v} kPa']) expect(said(scene([node('T', { text, fmt })])), `${text} ${fmt}`).toEqual([])
    expect(said(scene([node('T', { text: '$v', FMT: '' })]))).toEqual([])
    for (const fmt of [...specs.read, ...specs.composite]) for (const text of ['$v', 'set {$v} kPa'])
      expect(said(scene([node('T', { text, fmt })])), `${text} ${fmt}`).toEqual([])
  })

  it("retires fmt-brace: conversion attempts are the mod's reports, punctuation stays silent", () => {
    const specs = JSON.parse(readFileSync(new URL('../../test/fixtures/printf.json', import.meta.url), 'utf8'))
    for (const fmt of Object.keys({ ...specs.braced, ...specs.formatted }))
      for (const text of ['$v', 'set {$v} kPa', '{$v:{0:F1}}', '{$v:x{{y}'])
        expect(said(scene([node('T', { text, fmt })])), fmt).toEqual([])
  })

  it('a format only a whole number takes prints the number through a long, whole or in a placeholder (0.11.101)', () => {
    // printf.json's integer specs, which the C# suite draws in a placeholder as a whole binding prints them: a format a
    // float refuses is retried with the number rounded to a long (B by the runtime: not judged). At 0.11.99 a placeholder
    // printed the missing text; at 0.11.101 an X first prints as the whole binding does, the fmt one conversion or not
    // (the C# suite draws `%x {0:D2}` as <8 08>), and a format no number takes is the mod's to report.
    const { integer }: { integer: string[] } = JSON.parse(readFileSync(new URL('../../test/fixtures/printf.json', import.meta.url), 'utf8'))
    expect(integer).toEqual(expect.arrayContaining(['{0:D3}', '{0:B}']))
    for (const fmt of [...integer, '{0:X4}', '%x', '%x {0:D2}', '%x {0:F1}', '%X {0:X}', '%x {0:Z}']) for (const text of ['$v', 'at {$v}'])
      expect(ids(scene([node('T', { text, fmt })])), `${text} ${fmt}`).toEqual([])
  })

  it('clip-extra: a clip path takes its first shape only; the mod reports further shapes (0.11.96) and a def op (0.11.99)', () => {
    // A further shape is read by nothing (no y-crosses) and the mod reports it; a def op there, before or after the shape,
    // it reports too since 0.11.99 ("a def belongs in DEFS"; before 0.11.99 it dropped one after the shape in silence).
    expect(said(scene([], [node('CP', { id: 'c' }, [node('R', { w: 1, h: 1 }), node('Y', { p: bowtie }), node('GL', { id: 'g' }),
      node('SYM', { id: 's' }, [node('R', { fille: 1 })])])]))).toEqual([])
    // A def op before the shape is reported by the mod, and the shape after it is the clip.
    expect(ids(scene([], [node('CP', { id: 'c' }, [node('GR', { id: 'g' }), node('Y', { p: bowtie })])]))).toEqual(['y-crosses'])
    // The clip's shape is read without its children, which the mod never parses: no unknown key or bowtie of theirs is
    // reported, by the mod or here; only that they are read by nothing (a G there the mod reports as no usable shape).
    const inside = (op: string) => `this ${op} is inside the clip's shape, and the mod never reads it, without a report: a clip path takes its first shape alone, not its children`
    expect(said(scene([], [node('CP', { id: 'c' }, [node('G', {}, [node('R', { fille: 1 }, [node('C', { r: 1 })]), node('Y', { p: bowtie })])])])))
      .toEqual([inside('R'), inside('Y')])
    expect(said(scene([], [node('CP', { id: 'c' }, [node('R', { w: 1, h: 1 }, [node('GL', { id: 'g' })]), node('R', { w: 2, h: 2 }, [node('C', { r: 1 })])])])))
      .toEqual([inside('GL')])
  })

  it('index-n: a central difference reads neighbours; names in any script', () => {
    lacks('index-n', scene([node('R', { x: '=($v[i+1]-$v[i-1])/2' })]))
    expect(ids(scene([node('R', { x: '=$données[n]', y: '=épi+1' })]))).toEqual(['index-n'])
    // Ids and the bindings that are not expressions take any Unicode, supplementary-plane characters included: text=$name,
    // a {$name} placeholder and a paint's $name[i] (measured at 0.11.94). Inside an = expression or a {=…} placeholder a
    // name takes a supplementary-plane character whole since 0.11.98, a letter or not (Expression.cs ReadName; until then
    // it was reported and the default used).
    expect(said(scene([node('T', { id: '𝒳', click: 1, text: 'row {$𝒴[n]}' }), node('T', { text: '$𝒴name' }),
      node('R', { f: '$𝒵[0]', s: '$𝒵' })]))).toEqual(['"$𝒴[n]" is past the end: arrays count from 0, so write $𝒴[n-1] for the last'])
    expect(said(scene([node('R', { x: '=$😀[n]', y: '=$a😀b[i+1]' })]))).toEqual(['"$😀[n]" is past the end: arrays count from 0, so write $😀[n-1] for the last',
      '"$a😀b[i+1]" looks 1-based: arrays and i count from 0, so this skips the first item and reads past the end on the last; write $a😀b[i]'])
  })

  it('checks the keys a USE reads itself', () => {
    expect(ids(scene([node('USE', { ref: 's', x: '=pi*2', y: '=$a[n]', colour: 'pi' })], [node('SYM', { id: 's' }, [node('R')])]))).toEqual(['bare-pi', 'index-n'])
  })

  it('warns of a clip, a symbol, a mask or a gradient DEFS does not declare: the mod reports each (the final review)', () => {
    const defs = [node('CP', { id: 'c' }, [node('R')]), node('GL', { id: 'g', stops: [[0, '#000000'], [1, '#FFFFFF']] }), node('SYM', { id: 's' }, [node('R')]),
      node('SYM', { id: 'empty' })]
    expect(said(scene([node('G', { clip: 'c', mask: '@g' }, [node('R', { f: '@g', s: '@g' })]), node('USE', { ref: 's', clip: 'c' })], defs))).toEqual([])
    expect(said(scene([node('G', { clip: 'duct1_clip', mask: '@m' }, [node('R', { f: '@x', s: '@y' })]), node('USE', { ref: 'empty', clip: 'k' })], defs))).toEqual([
      'clip "duct1_clip" is not declared in DEFS: the mod reports it and draws this group unclipped',
      'mask="@m": gradient "m" is not declared in DEFS: the mod reports it and masks nothing',
      'f="@x": gradient "x" is not declared in DEFS: the mod reports it and draws the shape magenta',
      's="@y": gradient "y" is not declared in DEFS: the mod reports it and draws the shape magenta',
      'clip "k" is not declared in DEFS: the mod reports it and draws this symbol unclipped',
      'symbol "empty" is not declared in DEFS: the mod reports it and draws nothing here'])
    // Not in a symbol's substituted values, nor in the defs' own nodes (a clip's shapes draw nothing).
    expect(said(scene([], [node('SYM', { id: 's2' }, [node('G', { clip: '%c' }, [node('R', { f: '@%g' })])]), node('CP', { id: 'k' }, [node('R', { f: '@nope' })])]))).toEqual([])
  })

  it('skips a %param value inside a SYM body', () => {
    expect(said(scene([], [node('SYM', { id: 's', n: 4 }, [node('SP', { p: [0, 0, 1, 1], seg: '%n', sh: '%sh', x: '=pi*%k' })])]))).toEqual(['"x" does nothing on SP: remove it'])
  })

  it('scans a 100 KB escaped, unterminated quote with linear string work', () => {
    const expression = '=' + '"\\'.repeat(50_000)
    expect(stringWork(() => trapsOf(scene([node('R', { x: expression })])), 16 * expression.length)).toEqual([])
  }, 20_000)

  it('walks 100,000 nested G nodes', () => {
    let deep: SrcNode = node('R')
    for (let k = 0; k < 100_000; k++) deep = node('G', {}, [deep])
    expect(trapsOf(scene([deep]))).toEqual([])
  })

  it('carries the requirement down as a flag: 100,000 nested G with fo under a SCENE f', () => {
    let deep: SrcNode = node('R')
    for (let k = 0; k < 100_000; k++) deep = node('G', { fo: 0.5 }, [deep])
    expect(ids(scene([deep], [], { w: 10, h: 10, f: '#fff' }))).not.toContain('needs-key')
    // and with no f anywhere, every level says so
    expect(ids(scene([deep]))).toHaveLength(100_000)
  })

  describe('the examples', () => {
    const dir = new URL('../../test/fixtures/examples/', import.meta.url)
    const sceneOf = (name: string) => sceneOfProps(JSON.parse(readFileSync(new URL(`${name}.props.json`, dir), 'utf8')))
    it('reads press on an IMG', () => expect(said(sceneOf('17-pictures.pic_s')).filter(m => m.includes('"press"'))).toEqual([]))
    it('takes any font', () => expect(said(sceneOf('10-text.text_s')).filter(m => m.includes('"font"'))).toEqual([]))
    it('takes web-font declarations without traps', () => expect(said(sceneOf('19-webfonts.webfonts'))).toEqual([]))
    // Only these: fo on an IMG, which the mod draws with o only (17); missing on a C and an R, read on T only (16).
    const justified: Record<string, string[]> = {
      '16-pointer.ptr_s': ['"missing" does nothing on C: remove it', '"missing" does nothing on R: remove it'],
      '17-pictures.pic_s': ['"fo" does nothing on IMG: remove it'],
    }
    it.each(readdirSync(dir).filter(f => f.endsWith('.props.json')).map(f => f.slice(0, -'.props.json'.length)).sort())('%s', name => {
      expect(said(sceneOf(name))).toEqual(justified[name] ?? [])
    })
  })
})
