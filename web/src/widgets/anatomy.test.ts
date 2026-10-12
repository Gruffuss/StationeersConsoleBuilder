import { expect, it } from 'vitest'
import { THEMES } from '../theme'
import { bracket } from './testing'
const api = () => import('./anatomy')
const diamond = [[[0.5,0],[0,0]], [[1,0],[0.5,0]], [[0.5,0],[1,0]], [[0,0],[0.5,0]]]

it('drops ornament width without stroke with a note', async () => {
  const { sanitizeAnatomy } = await api()
  const result = sanitizeAnatomy({ v: 1, looks: { panel: { add: [{ name: 'a', op: 'rect', fill: 'accent', width: 2 }] } } }, bracket)
  expect(result.anatomy!.looks.panel.add).toEqual([{ name: 'a', op: 'rect', fill: 'accent' }])
  expect(result.notes).toEqual(["looks.panel.add.0.width: width requires stroke"])
})

it('the sanitizer keeps a good theme and provided themes have no anatomy', async () => {
  const { sanitizeAnatomy } = await api(), result = sanitizeAnatomy(JSON.parse(JSON.stringify(bracket.anatomy)), bracket)
  expect(result).toEqual({ anatomy: bracket.anatomy, notes: [] })
  expect(Object.getPrototypeOf(result.anatomy)).toBe(null)
  expect(Object.values(THEMES).every(t => t.anatomy === undefined)).toBe(true)
})
it('the sanitizer drops, by name, the smallest bad item', async () => {
  const { sanitizeAnatomy } = await api()
  const input = { v: 1, looks: {
    panel: { add: [
      { name: 'a', op: 'rect', fill: 'accent', foo: 1 },
      { name: 'bad-role', op: 'rect', fill: 'missing-role' },
      { name: 'mixed', op: 'poly', p: [[[0,0],[0,0]], [[1,0],[0,0]], [[1,2],[1,0]], [[0,0],[1,0]]], fill: 'accent' },
      { name: 'huge', op: 'rect', frame: { l: [0,1e39], t: [0,0], r: [1,0], b: [1,0] }, fill: 'accent' },
      { name: 'anchor', op: 'rect', frame: { l: [1.5,0], t: [0,0], r: [1,0], b: [1,0] }, fill: 'accent' },
      { name: 'dash', op: 'rect', stroke: 'accent', dash: [4] },
      { name: 'filled-line', op: 'line', p: [[[0,0],[0,0]], [[1,0],[1,0]]], fill: 'accent' },
      { name: 'a', op: 'rect', fill: 'accent' },
    ] }, nope: { shape: 'none' }, fill: { shape: 'none' },
    'bar/fill': { shape: { op: 'cut', cut: [1,1,1,1] } }, 'text:value': { shape: 'none' },
  } }
  const { anatomy, notes } = sanitizeAnatomy(input, bracket)
  expect(anatomy!.looks.panel.add).toEqual([{ name: 'a', op: 'rect', fill: 'accent' }])
  expect(anatomy!.looks.nope).toBeUndefined()
  for (const hook of ['fill','bar/fill','text:value']) expect(anatomy!.looks[hook].shape).toBeUndefined()
  for (const path of ['looks.panel.add.0.foo', 'looks.nope', 'looks.fill.shape', 'looks.bar/fill.shape', 'looks.text:value.shape',
    ...Array.from({ length: 7 }, (_, i) => `looks.panel.add.${i+1}`)]) expect(notes.some(n => n.includes(path)), path).toBe(true)
  expect(sanitizeAnatomy({ v: 2 }, bracket)).toEqual({ notes: [expect.any(String)] })
})
it('refuses only a live-size part shape that could not follow its value; ornaments stay free', async () => {
  const { sanitizeAnatomy } = await api()
  const underline = { name: 'underline', op: 'line', p: [[[0,0],[1,2]], [[1,0],[1,2]]], stroke: 'accent', width: 1 }
  const tick = { name: 'tick', op: 'poly', p: [[[0,-6],[0.5,0]], [[0,0],[0,0]], [[0,0],[1,0]]], fill: 'accent' }
  const notch = { name: 'notch', op: 'cut', cut: [2,0,0,0], fill: 'accent' }
  const looks = { 'text:value': { add: [underline, tick, notch] }, 'readout/text:value': { add: [underline] },
    fill: { add: [tick] }, meter: { shape: { op: 'cut', cut: [1,1,1,1] } }, 'bar/fill': { shape: { op: 'rect', radius: 2 } } }
  const { anatomy, notes } = sanitizeAnatomy({ v: 1, looks }, bracket)
  expect(anatomy!.looks['text:value'].add!.map(o => o.name)).toEqual(['underline', 'tick', 'notch'])
  expect(anatomy!.looks['readout/text:value'].add!.map(o => o.name)).toEqual(['underline'])
  expect(anatomy!.looks.fill.add!.map(o => o.name)).toEqual(['tick'])
  expect(anatomy!.looks['bar/fill'].shape).toEqual({ op: 'rect', radius: 2 })
  expect(anatomy!.looks.meter.shape).toBeUndefined()
  expect(notes).toEqual(['looks.meter.shape: live size requires rect or ellipse'])
})
it('hostile anatomy cannot pollute records or emit unknown vector keys', async () => {
  const { sanitizeAnatomy } = await api()
  const raw = JSON.parse('{"v":1,"looks":{"__proto__":{"shape":"none"},"panel":{"add":[{"name":"a","op":"rect","fill":"accent","__proto__":{"x":1}}]}}}')
  const result = sanitizeAnatomy(raw, bracket)
  expect(({} as Record<string, unknown>).shape).toBeUndefined()
  expect(Object.getPrototypeOf(result.anatomy!.looks)).toBe(null)
  expect(Object.getPrototypeOf(result.anatomy!.looks.panel)).toBe(null)
  expect(result.anatomy!.looks.panel.add).toEqual([{ name: 'a', op: 'rect', fill: 'accent' }])
  expect(result.notes).toEqual([expect.stringContaining('looks.__proto__'), expect.stringContaining('looks.panel.add.0.__proto__')])
})
it('a convex polygon stays convex at any box size, and a star is refused', async () => {
  const { sanitizeAnatomy } = await api(), mixed = structuredClone(diamond); mixed[0][0][1] = 4
  const star = [0,2,4,1,3].map(i => [[0.5 + 0.45*Math.cos(i*2*Math.PI/5),0],[0.5 + 0.45*Math.sin(i*2*Math.PI/5),0]])
  const { anatomy, notes } = sanitizeAnatomy({ v: 1, looks: { panel: { add: [
    { name: 'diamond', op: 'poly', p: diamond, fill: 'accent' },
    { name: 'mixed', op: 'poly', p: mixed, fill: 'accent' },
    { name: 'star', op: 'poly', p: star, fill: 'accent' },
  ] } } }, bracket)
  expect(anatomy!.looks.panel.add!.map(o => o.name)).toEqual(['diamond'])
  expect(notes).toHaveLength(2)
})
it('finite float32, known tokens and shape-specific fields are enforced', async () => {
  const { sanitizeAnatomy } = await api()
  for (const bad of [NaN, Infinity, -Infinity, 1e39, -1]) {
    expect(sanitizeAnatomy({ v: 1, looks: { panel: { shape: { op: 'rect', radius: bad } } } }, bracket).notes).toHaveLength(1)
  }
  for (const fields of [{ fill: { gradient: 'missing' } }, { shadow: 'missing' }, { width: -1 }, { under: false },
    { dash: [0,0], stroke: 'accent' }, { cap: 'round' }, { outline: 'bad' }, { name: 'bad~name' }, {}]) {
    const result = sanitizeAnatomy({ v: 1, looks: { panel: { add: [{ name: 'a', op: 'rect', fill: 'accent', ...fields }] } } }, bracket)
    if (Object.keys(fields).length) expect(result.notes.length).toBeGreaterThan(0)
  }
  const good = sanitizeAnatomy({ v: 1, looks: { panel: { shape: { op: 'rect', radius: -0 }, add: [
    { name: 'a', op: 'ellipse', fill: { gradient: 'row' }, stroke: 'accent', width: 0.1 },
  ] } } }, { ...bracket, gradients: { row: ['text','text'] } })
  expect(Object.is((good.anatomy!.looks.panel.shape as { radius: number }).radius, -0)).toBe(false)
  expect(good.notes).toEqual([])
  expect(good.anatomy!.looks.panel.add![0].width).toBe(Math.fround(0.1))
})
it('malformed JSON field values never throw or inherit known keys', async () => {
  const { sanitizeAnatomy } = await api()
  for (const op of [null, { toString: null }, [], 1, true])
    expect(() => sanitizeAnatomy({ v: 1, looks: { panel: { shape: { op } } } }, bracket)).not.toThrow()
  expect(sanitizeAnatomy(Object.create({ v: 1, looks: {} }), bracket).anatomy).toBeUndefined()
  const raw = { v: 1, looks: { panel: { shape: { op: 'rect', frame: { l: [0,0], t: [0,0], r: [1,0], b: [1,0], alien: true } } } } }
  const result = sanitizeAnatomy(raw,bracket)
  expect(result.notes).toEqual([expect.stringContaining('looks.panel.shape.frame.alien')])
  expect(result.anatomy!.looks.panel.shape).toEqual({ op: 'rect', frame: { l: [0,0], t: [0,0], r: [1,0], b: [1,0] } })
})
