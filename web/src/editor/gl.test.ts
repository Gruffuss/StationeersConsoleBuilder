import { describe, expect, it } from 'vitest'
import type { Frame } from '../runtime/frame'
import { label } from '../runtime/testing'
import { covers, DECODE, ENCODE, FS, FS_CHECKER, FS_COVER, FS_OUT, makeRenderer, SNAP, startFailure, VS, VS_OUT } from './gl'
import { decode as decode8, flat, store } from './linear'
import { toLabel } from './text'

describe('startFailure', () => {
  it('says WebGL could not start, and why', () => {
    expect(startFailure(new Error('ERROR: 0:7: undeclared identifier'))).toBe('WebGL could not start: ERROR: 0:7: undeclared identifier')
    expect(startFailure('no context')).toBe('WebGL could not start: no context')
  })
})

// A shader function run in JS on one channel: GLSL's mix, step, pow and floor over scalars.
const glsl = (src: string): ((x: number) => number) => {
  const [, arg, body] = /^vec3 \w+\(vec3 (\w+)\) \{ return (.+); \}$/.exec(src)!
  const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t, step = (e: number, x: number) => (x < e ? 0 : 1)
  return new Function('mix', 'step', 'pow', 'floor', 'vec3', `return ${arg} => ${body}`)(mix, step, Math.pow, Math.floor, (x: number) => x)
}
const decode = glsl(DECODE), encode = glsl(ENCODE), snap = glsl(SNAP)

describe('the shaders', () => {
  it('decode and encode with the constants of linear.ts', () => {
    for (const k of ['12.92', '0.04045', '2.4']) expect(DECODE).toContain(k)
    for (const k of ['12.92', '0.0031308', '2.4']) expect(ENCODE).toContain(k)
  })
  it('round the encoded target to whole sRGB levels', () => {
    // Every source byte and the original linear half-level probes round through the encoded target.
    for (let c = 0; c < 256; c++) expect([c, decode(snap(encode(decode(c / 255))))]).toEqual([c, store(decode8(c))])
    for (let k = 0; k < 255; k++) for (const d of [-1e-6, 0, 1e-6]) expect([k, d, decode(snap(encode((k + 0.5 + d) / 255)))]).toEqual([k, d, store((k + 0.5 + d) / 255)])
  })
  it('interpolate float sRGB, decode in the fragment, and encode the canvas once', () => {
    expect(VS).toContain('vStored = stored')
    expect(VS).toContain('v = vec4(snap(decode(c.rgb)), c.a)')
    expect(FS).toContain('vStored.w > 0.5 ? decode(vStored.rgb) : v.rgb')
    expect(FS).toContain('o = color;')
    expect(FS_OUT).toContain('o = vec4(snap(encode(t.rgb + checker() * (1.0 - t.a))), 1.0)')
  })
  it('chained as the passes chain them, show every opaque flat byte as flat() does', () => {
    for (let c = 0; c < 256; c++) expect([c, Math.round(255 * snap(encode(decode(snap(encode(decode(c / 255)))))))]).toEqual([c, flat(c)])
  })
  it('give the cover the colour the canvas shows, with the coverage of what is drawn over the label as its alpha, premultiplied', () => {
    // Premultiplied: the browser filters the canvas when it scales or shifts it (a stage at a half px, a zoom), and
    // straight colour beside clear (0, 0, 0, 0) pixels drew a dark seam round each box (seen in the browser).
    expect(FS_COVER).toContain('vec4 t = texelFetch(target, ivec2(gl_FragCoord.xy), 0); o = vec4(snap(encode(t.rgb)) * t.a, t.a)')
  })
})

// Two quads on a 100 x 100 surface, one after the other: A is vertices 0-3 (indices 0-5), B vertices 4-7 (indices 6-11).
const quads = (text: Frame['text']): Frame => ({
  positions: new Float32Array([0, 0, 50, 0, 50, 50, 0, 50, 20, 20, 90, 20, 90, 90, 20, 90]), coverage: new Float32Array(8).fill(1),
  colours: new Uint8Array(32).fill(255), indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]), spans: new Int32Array(),
  elements: [{ id: 'vb', scene: 'p', x: 0, y: 0, w: 100, h: 100, firstVertex: 0, vertexCount: 8 }], text, problems: [] })
const surface = { w: 100, h: 100 }

describe('covers', () => {
  it.each([
    [0, null, { x0: 48, y0: 26, x1: 60, y1: 50 }],
    [90, null, { x0: 41, y0: 35, x1: 65, y1: 47 }],
    [30, [1, 0.5, 0, 1], { x0: 40, y0: 20, x1: 75, y1: 60 }],
  ] as const)('chooses an earlier shape over ink outside the T box at rotation %s, shear %s', (rotation, shear, ink) => {
    const t = label({ x: 50, y: 30, w: 10, h: 20, rotation, shear: shear ? [...shear] : null, cover: 8, after: 4 })
    const f = quads([t]), box = covers(quads([{ ...t, cover: 4 }]), surface)[0]
    // A shape wholly clear of the drawn box, but in the measured ink region. Its whole shape starts at vertex 4.
    const shape = ink.x0 < box.x0 ? { x0: ink.x0 + 0.1, x1: box.x0 - 0.1, y0: box.y0, y1: box.y1 }
      : { x0: box.x0, x1: box.x1, y0: ink.y0 + 0.1, y1: box.y0 - 0.1 }
    f.positions = new Float32Array([ink.x0, ink.y0, ink.x1, ink.y0, ink.x1, ink.y1, ink.x0, ink.y1,
      shape.x0, shape.y0, shape.x1, shape.y0, shape.x1, shape.y1, shape.x0, shape.y1])
    f.elements = [{ ...f.elements[0], shapes: [{ first: 0, ...ink }, { first: 4, ...shape }] }]
    expect(covers(f, surface)).toEqual([]) // box-only overlap sees no cover
    expect(covers(f, surface, [ink])[0]).toMatchObject({ first: 6, cover: 4, label: 0 })
    expect(covers({ ...f, text: [{ ...t, after: 8 }] }, surface, [ink])).toEqual([]) // ztext=0
    expect(covers({ ...f, text: [{ ...t, fit: 1 }] }, surface, [ink])).toEqual([]) // clipped ink
  })
  it('lists each label something is drawn over, with the first index drawn after it: a shape after a label covers it, one before does not', () => {
    // The core gives a label its cover: B's first vertex when B is drawn after it (ztext), the element's end when nothing
    // is (B before it, or ztext=0, which keeps a label on top of its own shapes).
    expect(covers(quads([label({ cover: 4 })]), surface)).toEqual([{ x0: 10, y0: 20, x1: 40, y1: 60, first: 6, label: 0, cover: 4, layer: 0 }])
    expect(covers(quads([label({ cover: 0 })]), surface)).toEqual([{ x0: 10, y0: 20, x1: 40, y1: 60, first: 0, label: 0, cover: 0, layer: 0 }])
    expect(covers(quads([label({ cover: 8 })]), surface)).toEqual([])
    expect(covers(quads([label()]), surface)).toEqual([])
  })
  it('numbers a cover by the label as the text layer numbers it (drawable labels only), and gives it its cover', () => {
    expect(covers(quads([label({ x: NaN }), label({ cover: 4 })]), surface)).toEqual([{ x0: 10, y0: 20, x1: 40, y1: 60, first: 6, label: 0, cover: 4, layer: 0 }])
  })
  it('stacks the covers in draw order: a label drawn after another\'s cover, where their regions meet, goes over that cover (a layer nearer the top)', () => {
    // The reviewer's case, two covered labels: P under A and B (cover 0), Q under B only (cover 4). In the game P is drawn,
    // then A, then Q, then B: Q's text is over A, so P's cover (A and B) lies under Q's text and Q's cover (B) over it.
    const p = label({ cover: 0, x: 20, y: 30, w: 30, h: 20 }), q = label({ cover: 4 })
    expect(covers(quads([p, q]), surface).map(c => [c.label, c.cover, c.layer])).toEqual([[0, 0, 1], [1, 4, 0]])
    // Regions apart: one layer.
    expect(covers(quads([label({ cover: 0, x: 60, y: 0, w: 20, h: 20 }), q]), surface).map(c => c.layer)).toEqual([0, 0])
    // Equal covers share a layer (one alpha: what is drawn after both); a label drawn after every shape is in none.
    expect(covers(quads([p, label({ cover: 0 }), label({ cover: 8 })]), surface).map(c => [c.label, c.layer])).toEqual([[0, 0], [1, 0]])
  })
  it('grows a region to the text the text layer measured past the box (fit 0), not for an ellipsis label (fit 1, clipped to its box)', () => {
    const wide = { x0: 5, y0: 25, x1: 95, y1: 50 }
    expect(covers(quads([label({ cover: 4 })]), surface, [wide])).toEqual([{ x0: 5, y0: 20, x1: 95, y1: 60, first: 6, label: 0, cover: 4, layer: 0 }])
    expect(covers(quads([label({ cover: 4, outlineWidth: 2 })]), surface, [wide])[0]).toMatchObject({ x0: 3, y0: 18, x1: 97, y1: 62 })
    expect(covers(quads([label({ cover: 4, fit: 1 })]), surface, [wide])[0]).toMatchObject({ x0: 10, y0: 20, x1: 40, y1: 60 })
    expect(covers(quads([label({ cover: 4 })]), surface, [null])[0]).toMatchObject({ x0: 10, y0: 20, x1: 40, y1: 60 })
  })
  it('boxes a label as the text layer draws it: turned and sheared about its centre, grown by its shadows and outline, cut to its clip and the surface', () => {
    const at = (over: Parameters<typeof label>[0]) => Object.fromEntries(Object.entries(covers(quads([label({ cover: 4, ...over })]), surface)[0])
      .map(([k, v]) => [k, Math.round(v * 1e9) / 1e9]))   // cos 90° is not quite 0
    const own = { first: 6, label: 0, cover: 4, layer: 0 }
    expect(at({ rotation: 90 })).toEqual({ x0: 5, y0: 25, x1: 45, y1: 55, ...own })
    expect(at({ shadow: [2, 1, 1, 0, 0, 0, 1], extraShadows: [0, 3, 0, 0, 0, 0, 1], outlineWidth: 1 })).toEqual({ x0: 3, y0: 13, x1: 47, y1: 67, ...own })
    expect(at({ clip: [0, 30, 100, 10] })).toEqual({ x0: 10, y0: 30, x1: 40, y1: 40, ...own })
    expect(at({ x: 80, y: -10 })).toEqual({ x0: 80, y0: 0, x1: 100, y1: 30, ...own })
    // A turned, sheared box: every surface point inside it (by toLabel, the text layer's own map) lies in the cover's
    // box, which is no larger than it must be.
    const t = label({ cover: 4, rotation: 30, shear: [1, 0.5, 0, 1] }), b = covers(quads([t]), surface)[0]
    const inside = (x: number, y: number) => { const [u, v] = toLabel(t, x - 25, y - 40); return Math.abs(u) <= 15 && Math.abs(v) <= 20 }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let y = -40; y <= 140; y += 0.25) for (let x = -40; x <= 140; x += 0.25) if (inside(x, y)) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    expect(x0).toBeGreaterThanOrEqual(b.x0)
    expect(x1).toBeLessThanOrEqual(b.x1)
    expect(y0).toBeGreaterThanOrEqual(b.y0)
    expect(y1).toBeLessThanOrEqual(b.y1)
    expect(Math.max(x0 - b.x0, b.x1 - x1, y0 - b.y0, b.y1 - y1)).toBeLessThan(0.5)
  })
  it('leaves out a label the text layer does not draw: one not finite, or surely off the surface', () => {
    expect(covers(quads([label({ cover: 4, x: NaN }), label({ cover: 4, x: 900 })]), surface)).toEqual([])
  })
  it('leaves non-finite covers on top without searching triangles or entering layering', () => {
    const none = label()
    delete (none as Partial<typeof none>).cover
    const f = quads([none, label({ cover: NaN }), label({ cover: Infinity }), label({ cover: -Infinity }), label({ cover: 4 })])
    let invalid = false
    for (const t of f.text) {
      const value = t.cover
      Object.defineProperty(t, 'cover', { enumerable: true, get() { invalid = !Number.isFinite(value); return value } })
    }
    // A regressed guard throws at its first triangle read, before NaN can reach the synchronous layering loop.
    f.indices = new Proxy(f.indices, { get(target, key) {
      if (invalid && typeof key === 'string' && /^\d+$/.test(key)) throw new Error('non-finite cover reached triangle search')
      return Reflect.get(target, key, target)
    } })
    expect(covers(f, surface).map(c => c.label)).toEqual([4])
  })
})

// A WebGL 2 context that records each call with the state it ran under: constants read as their own names, create* give
// fresh objects, every check passes. Not a rasteriser: it shows what is drawn, where, into what.
function fakeGL(w: number, h: number) {
  const log: { call: string; args: unknown[]; into: 'canvas' | 'target'; scissor: number[] | null; mask: boolean[]; blend: unknown[] | null; stencil: boolean; program: unknown; texture: unknown }[] = []
  let fbo: unknown = null, scissor = [0, 0, w, h], scissoring = false, mask = [true, true, true, true], blending = false, blend: unknown[] = []
  let stencil = false
  let currentProgram: unknown, texture: unknown, object = 0
  const uploads: unknown[][] = [], filters: unknown[][] = [], deleted: unknown[] = []
  const options: unknown[] = [], sources: string[] = []
  const gl = new Proxy({}, { get: (_, k: string) => {
    if (k === 'drawingBufferWidth') return w
    if (k === 'drawingBufferHeight') return h
    if (/^[A-Z0-9_]+$/.test(k)) return k
    return (...args: unknown[]) => {
      if (k === 'getParameter' && args[0] === 'MAX_TEXTURE_SIZE') return 4096
      if (k === 'useProgram') currentProgram = args[0]
      if (k === 'bindTexture') texture = args[1]
      if (k === 'texImage2D') uploads.push([texture, ...args])
      if (k === 'texParameteri') filters.push([texture, ...args])
      if (k === 'deleteTexture') deleted.push(args[0])
      if (k === 'bindFramebuffer') fbo = args[1]
      if (k === 'scissor') scissor = args as number[]
      if (k === 'enable' || k === 'disable') {
        if (args[0] === 'SCISSOR_TEST') scissoring = k === 'enable'
        if (args[0] === 'BLEND') blending = k === 'enable'
        if (args[0] === 'STENCIL_TEST') stencil = k === 'enable'
      }
      if (k === 'colorMask') mask = args as boolean[]
      if (k === 'blendFunc' || k === 'blendFuncSeparate') blend = args
      if (k === 'shaderSource') sources.push(args[1] as string)
      if (['clear', 'drawElements', 'drawArrays', 'clearColor', 'clearStencil', 'stencilFunc', 'readPixels'].includes(k))
        log.push({ call: k, args, into: fbo ? 'target' : 'canvas', scissor: scissoring ? scissor : null, mask, blend: blending ? blend : null, stencil, program: currentProgram, texture })
      if (k === 'checkFramebufferStatus') return 'FRAMEBUFFER_COMPLETE'
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return true
      if (k.startsWith('create') || k === 'getUniformLocation') return { k, object: object++ }
      return k === 'getAttribLocation' ? 0 : undefined
    }
  } })
  const canvas = { getContext: (_: string, o: unknown) => { options.push(o); return gl } } as unknown as HTMLCanvasElement
  return { canvas, log, options, sources, uploads, filters, deleted }
}

describe('picture slices', () => {
  it.each([false, true])('stores the scene and cover in an sRGB target (cover=%s)', cover => {
    const g = fakeGL(100, 100), r = makeRenderer(g.canvas, cover)
    r.draw(quads([label({ cover: 4 })]), surface)
    const targets = g.uploads.filter(u => u.at(-1) === null)
    expect(targets).toHaveLength(1)
    expect(targets[0][3]).toBe('SRGB8_ALPHA8')
    r.dispose()
  })
  const imageFrame = () => ({ ...quads([label({ cover: 4 })]),
    uv: new Float32Array(16), images: [{ element: 0, src: 'point:data:x', first: 3, count: 6 }] })
  const picture = { width: 1, height: 1, pixels: new Uint8Array([128, 64, 32, 128]) }
  it('skips pictures beyond the measured texture limit while drawing surrounding colours', () => {
    const g = fakeGL(100, 100), r = makeRenderer(g.canvas)
    r.draw(imageFrame(), surface, undefined, undefined, undefined, undefined, () => ({ ...picture, width: 4097 }))
    expect(g.uploads.filter(u => u[3] === 'SRGB8_ALPHA8' && u.at(-1) !== null)).toHaveLength(0)
    expect(g.log.filter(e => e.call === 'drawElements').map(e => [e.args[1], e.args[3]])).toEqual([[3, 0], [3, 36]])
    expect(r.maxTextureSize).toBe(4096)
    r.dispose()
  })
  it('draws colour, image, colour in order with sRGB point textures, and frees them', () => {
    const g = fakeGL(100, 100), r = makeRenderer(g.canvas)
    r.draw(imageFrame(), surface, undefined, undefined, undefined, undefined, () => picture)
    const draws = g.log.filter(e => e.call === 'drawElements')
    expect(draws.map(e => [e.args[1], e.args[3]])).toEqual([[3, 0], [6, 12], [3, 36]])
    expect(draws[0].program).toBe(draws[2].program)
    expect(draws[1].program).not.toBe(draws[0].program)
    expect(g.uploads.find(u => u[3] === 'SRGB8_ALPHA8' && u.at(-1) !== null)?.at(-1)).toBe(picture.pixels)
    expect(g.filters).toContainEqual([draws[1].texture, 'TEXTURE_2D', 'TEXTURE_MAG_FILTER', 'NEAREST'])
    expect(g.filters).toContainEqual([draws[1].texture, 'TEXTURE_2D', 'TEXTURE_WRAP_S', 'CLAMP_TO_EDGE'])
    // ApplyImages gives each image its own texture slice. VectorDither multiplies the linear texel by vertex colour,
    // then alpha by coverage, then dithers alpha; SRGB8_ALPHA8 supplies the same sRGB-to-linear texture read as Unity.
    expect(g.sources.some(s => s.includes('v * texture(picture, vUv)') && s.includes('color.a *= edgeCoverage('))).toBe(true)
    r.draw(imageFrame(), surface, undefined, undefined, undefined, undefined, () => picture)
    expect(g.uploads.filter(u => u[3] === 'SRGB8_ALPHA8' && u.at(-1) !== null)).toHaveLength(1)
    r.dispose(); expect(g.deleted).toContain(draws[1].texture)
  })
  it('includes the image alpha in the label cover, and keeps smooth and point textures apart', () => {
    const g = fakeGL(100, 100), r = makeRenderer(g.canvas, true), f = imageFrame()
    f.images.push({ element: 0, src: 'data:x', first: 9, count: 3 })
    r.draw(f, surface, undefined, undefined, undefined, undefined, () => picture)
    const alpha = g.log.filter(e => e.call === 'drawElements' && !e.mask[0])
    expect(alpha.map(e => [e.args[1], e.args[3]])).toEqual([[3, 24], [3, 36]])
    expect(alpha[0].texture).not.toBe(alpha[1].texture)
    expect(g.filters).toContainEqual([alpha[1].texture, 'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'LINEAR'])
    expect(alpha.every(e => e.blend?.join() === 'ZERO,ONE,ONE,ONE_MINUS_SRC_ALPHA')).toBe(true)
    r.dispose()
  })
})

describe('the cover pass', () => {
  it('clips the navigated scene to the page while presenting the whole visible buffer', () => {
    const gl = fakeGL(200, 200)
    makeRenderer(gl.canvas).draw(quads([]), surface, undefined, undefined,
      { zoom: 0.5, pan: { x: 25, y: 25 } }, { w: 100, h: 100 })
    expect(gl.log.find(e => e.call === 'drawElements')?.scissor).toEqual([50, 50, 100, 100])
    expect(gl.log.find(e => e.call === 'drawArrays')?.scissor).toBeNull()
  })

  it('transforms cover regions with zoom and pan and clips deeper buffers to the visible area', () => {
    const gl = fakeGL(200, 200), copied: unknown[][] = []
    const f = quads([label({ cover: 0 }), label({ cover: 4 })])
    makeRenderer(gl.canvas, true).draw(f, surface, covers(f, surface), (...a) => copied.push(a),
      { zoom: 2, pan: { x: 10, y: 20 } }, { w: 100, h: 100 })
    const geometry = gl.log.filter(e => e.call === 'drawElements')
    expect(geometry[0].scissor).toEqual([60, 0, 120, 80])
    expect(copied[0]?.[1]).toEqual([60, 120, 120, 80])
  })

  // A 100 x 100 surface on a 200 x 200 drawing buffer. The label's box, 10..40 by 20..60, is 20..80 by 40..120 in device
  // px: y up, from 80 to 160.
  const box = [20, 80, 60, 80]
  const drawn = (f: Frame) => {
    const gl = fakeGL(200, 200)
    makeRenderer(gl.canvas, true).draw(f, surface)
    return gl
  }

  it('draws over a label the shape drawn after it: its triangles give the alpha in the label box, over the colour the canvas shows', () => {
    const { log, options } = drawn(quads([label({ cover: 4 })]))
    expect(options).toEqual([expect.objectContaining({ alpha: true, premultipliedAlpha: true })])
    const draws = log.filter(e => e.call !== 'clearColor')
    expect(draws.map(e => [e.call, e.into, e.scissor, e.mask.join(), e.args])).toEqual([
      ['clear', 'canvas', null, 'true,true,true,true', ['COLOR_BUFFER_BIT']],   // transparent where no label is covered
      ['clear', 'target', box, 'true,true,true,true', ['COLOR_BUFFER_BIT']],
      ['drawArrays', 'target', box, 'true,true,true,true', ['TRIANGLES', 0, 3]], // checker RGB, alpha 0
      ['drawElements', 'target', box, 'true,true,true,true', ['TRIANGLES', 12, 'UNSIGNED_INT', 0]],   // the whole frame, as the canvas
      ['clear', 'target', box, 'false,false,false,true', ['COLOR_BUFFER_BIT']],
      ['drawElements', 'target', box, 'false,false,false,true', ['TRIANGLES', 6, 'UNSIGNED_INT', 24]],   // B alone: what covers it
      ['drawArrays', 'canvas', box, 'true,true,true,true', ['TRIANGLES', 0, 3]],
    ])
    // Colour blends as the canvas's pass does, alpha untouched; then alpha gathers the coverage of what is drawn over it.
    expect(draws[2].blend).toBeNull() // presentation-only checker initialization
    expect(draws[3].blend).toEqual(['SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'ZERO', 'ONE'])
    expect(draws[5].blend).toEqual(['ZERO', 'ONE', 'ONE', 'ONE_MINUS_SRC_ALPHA'])
    expect(draws[6].blend).toBeNull()
    expect(log.filter(e => e.call === 'clearColor').map(e => e.args[3])).toEqual([0, 0])   // the canvas, then the target's alpha
  })

  it('draws nothing over a label drawn after every shape (a shape before it, or ztext=0): the canvas is only cleared', () => {
    for (const f of [quads([label({ cover: 8 })]), quads([])]) {
      const { log } = drawn(f)
      expect(log.filter(e => e.call !== 'clearColor').map(e => [e.call, e.into, e.scissor])).toEqual([['clear', 'canvas', null]])
    }
  })

  it('gives each covered label its own alpha, in label order, over the union of their boxes', () => {
    const { log } = drawn(quads([label({ cover: 4 }), label({ cover: 0, x: 60, y: 0, w: 20, h: 20 })]))
    const draws = log.filter(e => e.call !== 'clearColor').map(e => [e.call, e.scissor, e.args[1], e.args[3]])
    expect(draws).toEqual([
      ['clear', null, undefined, undefined],
      ['clear', [20, 80, 140, 120], undefined, undefined],
      ['drawArrays', [20, 80, 140, 120], 0, undefined],
      ['drawElements', [20, 80, 140, 120], 12, 0],
      ['clear', box, undefined, undefined],
      ['drawElements', box, 6, 24],
      ['drawArrays', box, 0, undefined],
      ['clear', [120, 160, 40, 40], undefined, undefined],
      ['drawElements', [120, 160, 40, 40], 12, 0],   // drawn after A and B: both cover it
      ['drawArrays', [120, 160, 40, 40], 0, undefined],
    ])
  })

  it('compiles the cover\'s output from FS_COVER (premultiplied) and the canvas\'s from FS_OUT (checker inside the page)', () => {
    const cover = fakeGL(200, 200), plain = fakeGL(200, 200)
    makeRenderer(cover.canvas, true)
    makeRenderer(plain.canvas)
    expect(cover.sources).toEqual([VS, FS, VS_OUT, FS_COVER, VS_OUT, FS_CHECKER])
    expect(plain.sources).toEqual([VS, FS, VS_OUT, FS_OUT])
  })

  it('draws each layer of covers apart, nearest the top last: a deeper layer is handed to `copy` from the canvas, then cleared off it', () => {
    // P (cover 0, under A and B) lies under Q's text (cover 4, under B only): P's cover is layer 1, Q's layer 0.
    const gl = fakeGL(200, 200), copies: unknown[][] = []
    const f = quads([label({ cover: 0, x: 20, y: 30, w: 30, h: 20 }), label({ cover: 4 })])
    makeRenderer(gl.canvas, true).draw(f, surface, covers(f, surface), (...a) => { copies.push(a); gl.log.push({ call: 'copy', args: a } as never) })
    const p = [40, 100, 60, 40]   // 20..50 by 30..50 surface px: 40..100 by 100..140 device px, y up from 100
    const pq = [40, 100, 40, 40]   // where Q's box (layer 0, above) lies over P's
    const draws = gl.log.filter(e => e.call !== 'clearColor').map(e => [e.call, e.into, e.scissor, e.mask?.join(), e.args, e.stencil])
    expect(draws).toEqual([
      ['clear', 'canvas', null, 'true,true,true,true', ['COLOR_BUFFER_BIT'], false],
      ['clear', 'target', [20, 80, 80, 80], 'true,true,true,true', ['COLOR_BUFFER_BIT'], false],
      ['drawArrays', 'target', [20, 80, 80, 80], 'true,true,true,true', ['TRIANGLES', 0, 3], false],
      ['drawElements', 'target', [20, 80, 80, 80], 'true,true,true,true', ['TRIANGLES', 12, 'UNSIGNED_INT', 0], false],
      // Layer 1: P. Where Q's cover (B) lies over it too, P's gathers only A, what is drawn between P and Q: the text
      // shows through both covers by what A and B leave, not through B twice. Elsewhere in its box, A and B.
      ['clear', 'target', p, 'false,false,false,true', ['COLOR_BUFFER_BIT'], false],
      ['clearStencil', 'target', p, 'false,false,false,true', [0], false],
      ['clear', 'target', p, 'false,false,false,true', ['STENCIL_BUFFER_BIT'], false],
      ['stencilFunc', 'target', p, 'false,false,false,true', ['EQUAL', 0, 255], true],
      ['drawElements', 'target', pq, 'false,false,false,true', ['TRIANGLES', 6, 'UNSIGNED_INT', 0], true],
      ['clearStencil', 'target', pq, 'false,false,false,true', [1], true],
      ['clear', 'target', pq, 'false,false,false,true', ['STENCIL_BUFFER_BIT'], true],
      ['drawElements', 'target', p, 'false,false,false,true', ['TRIANGLES', 12, 'UNSIGNED_INT', 0], true],
      ['drawArrays', 'canvas', p, 'true,true,true,true', ['TRIANGLES', 0, 3], false],
      ['copy', undefined, undefined, undefined, [1, [40, 60, 60, 40], [200, 200]], undefined],   // y down for a 2D canvas
      ['clear', 'canvas', p, 'true,true,true,true', ['COLOR_BUFFER_BIT'], false],
      // Layer 0: Q, under B, stays on the canvas; nothing lies over it.
      ['clear', 'target', box, 'false,false,false,true', ['COLOR_BUFFER_BIT'], false],
      ['drawElements', 'target', box, 'false,false,false,true', ['TRIANGLES', 6, 'UNSIGNED_INT', 24], false],
      ['drawArrays', 'canvas', box, 'true,true,true,true', ['TRIANGLES', 0, 3], false],
    ])
    expect(copies).toHaveLength(1)
  })

  it('keeps the full canvas pass unscissored, with transparency outside the page and every label on top', () => {
    const gl = fakeGL(200, 200)
    makeRenderer(gl.canvas).draw(quads([label({ cover: 4 })]), surface)
    expect(gl.options).toEqual([expect.objectContaining({ alpha: true, premultipliedAlpha: true })])
    expect(gl.log.filter(e => e.call !== 'clearColor').map(e => [e.call, e.into, e.scissor, e.args[1]]))
      .toEqual([['clear', 'target', null, undefined], ['drawElements', 'target', null, 12], ['drawArrays', 'canvas', null, 0]])
  })
})
it('uses the tag\'s distance derivatives for the 1.3 px ramp and UV0 band', () => {
  expect(VS).toContain('vEdge = edge')
  expect(FS).toContain('length(vec2(dFdx(vEdge), dFdy(vEdge)))')
  expect(FS).toContain('1.0 - vUv.x')
  expect(FS).toContain('float k = 1.3')
})
it('clears the capture target to transparent and accumulates alpha independently of RGB', () => {
  const g = fakeGL(100, 100), r = makeRenderer(g.canvas)
  r.draw(quads([]), surface)
  expect(g.log.find(e => e.call === 'clearColor')?.args).toEqual([0, 0, 0, 0])
  expect(g.log.find(e => e.call === 'drawElements')?.blend).toEqual(['SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'ONE', 'ONE_MINUS_SRC_ALPHA'])
  r.dispose()
})
it('reads the capture target instead of the checker presentation', () => {
  const g = fakeGL(100, 100), r = makeRenderer(g.canvas)
  r.draw(quads([]), surface); r.readPixels()
  expect(g.log.find(e => e.call === 'readPixels')?.into).toBe('target')
  r.dispose()
})
