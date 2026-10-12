// Vector v0.11.118: interpolate float sRGB, decode per fragment, blend opacity in linear light into an sRGB8 target.
// Pixel coverage and alpha dither follow VectorDither.shader. Positions are surface px, y down; no face culling;
// 32-bit indices, WebGL 2. The display pass reads the target as linear light and encodes once for the canvas.
import type { Frame } from '../runtime/frame'
import type { Viewport } from '../editing/view'
import { CLEAR } from './linear'
import { chunks, drawable, shearMatrix } from './text'
import type { Picture } from './pictures'

const DITHER = 4  // the mod's default, in 255ths
// Transfer curves match the tag; snap retains the legacy byte-linear colour path for native UI and pictures.
export const DECODE = 'vec3 decode(vec3 s) { return mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), step(0.04045, s)); }'
export const ENCODE = 'vec3 encode(vec3 l) { return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)); }'
export const SNAP = 'vec3 snap(vec3 x) { return floor(x * 255.0 + 0.5) / 255.0; }'
export const VS = `#version 300 es
layout(location=0) in vec2 p; layout(location=1) in vec4 c; layout(location=2) in float cov; uniform vec2 size; uniform vec3 view; out vec4 v; out float vCov; layout(location=3) in vec2 uv; layout(location=4) in float edge; out vec2 vUv; out float vEdge; layout(location=5) in vec4 stored; out vec4 vStored;
${DECODE}
${SNAP}
void main() { vStored = stored; v = vec4(snap(decode(c.rgb)), c.a); vCov = cov; vUv = uv; vEdge = edge; vec2 q = p * view.z + view.xy; gl_Position = vec4(q.x / size.x * 2.0 - 1.0, 1.0 - q.y / size.y * 2.0, 0.0, 1.0); }`
// highp keeps the tag's per-pixel noise precise. Vector RGB stays float until the target writes it.
export const EDGE = `float edgeCoverage(float y, float g, float x, float band) {
  if (g <= 1e-20) return clamp(x, 0.0, 1.0);
  float featurePx = 1.0 / g;
  float distPx = abs(y) / g;
  float k = 1.3;
  float t = clamp((featurePx / k - 1.0) * 0.5, 0.0, 1.0);
  float kEff = y < 0.0 ? min(k, featurePx) : k * t * t * (3.0 - 2.0 * t);
  float ramp = kEff > 0.0 ? clamp(1.0 - distPx / kEff, 0.0, 1.0) : (distPx <= 0.0 ? 1.0 : 0.0);
  return min(clamp(band, 0.0, 1.0), ramp);
}`
export const FS = `#version 300 es
precision highp float; in vec4 v; in float vCov; in vec2 vUv; in float vEdge; in vec4 vStored; uniform float dither; out vec4 o;
${DECODE}
${EDGE}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec4 color = vec4(vStored.w > 0.5 ? decode(vStored.rgb) : v.rgb, v.a);
  color.a *= edgeCoverage(vEdge, length(vec2(dFdx(vEdge), dFdy(vEdge))), vCov, 1.0 - vUv.x);
  float amp = min(dither / 255.0, 2.0 * color.a);
  color.a = clamp(color.a + (ign(gl_FragCoord.xy) - 0.5) * amp, 0.0, 1.0);
  o = color;
}`
const VS_IMAGE = VS
const FS_IMAGE = FS.replace('in vec4 v;', 'precision highp sampler2D; uniform sampler2D picture; in vec4 v;')
  .replace('vec4 color = vec4(vStored.w > 0.5 ? decode(vStored.rgb) : v.rgb, v.a);', 'vec4 color = v * texture(picture, vUv);')
// The output pass: one triangle over the canvas, blending the transparent scene over the page checker. highp
// sampler: ES 3.00 defaults it to lowp, which may drop the dark levels this pass exists to show.
export const VS_OUT = `#version 300 es
void main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0, 0.0, 1.0); }`
// Screen-space cells: density converts drawing-buffer pixels to CSS pixels, independent of scene zoom.
export const CHECKER = `uniform vec2 density;
${DECODE}
vec3 checker() {
  vec2 cell = floor(gl_FragCoord.xy / density / 8.0);
  return decode(vec3(mix(40.0, 48.0, mod(cell.x + cell.y, 2.0)) / 255.0));
}`
export const FS_CHECKER = `#version 300 es
precision highp float; out vec4 o;
${CHECKER}
void main() { o = vec4(checker(), 0.0); }`
export const FS_OUT = `#version 300 es
precision highp float; precision highp sampler2D; uniform sampler2D target; uniform vec4 page; out vec4 o;
${CHECKER}
${ENCODE}
${SNAP}
void main() {
  vec2 p = gl_FragCoord.xy / density;
  if (any(lessThan(p, page.xy)) || any(greaterThanEqual(p, page.xy + page.zw))) { o = vec4(0.0); return; }
  vec4 t = texelFetch(target, ivec2(gl_FragCoord.xy), 0);
  o = vec4(snap(encode(t.rgb + checker() * (1.0 - t.a))), 1.0);
}`
// The cover's output: the colour the canvas shows there, at the target's alpha (what is drawn over the label),
// premultiplied: the browser filters a canvas it scales or shifts, and straight colour beside clear pixels seams.
export const FS_COVER = `#version 300 es
precision highp float; precision highp sampler2D; uniform sampler2D target; out vec4 o;
${ENCODE}
${SNAP}
void main() { vec4 t = texelFetch(target, ivec2(gl_FragCoord.xy), 0); o = vec4(snap(encode(t.rgb)) * t.a, t.a); }`

/** What the page shows in place of the canvas when makeRenderer throws. */
export const startFailure = (e: unknown) => `WebGL could not start: ${e instanceof Error ? e.message : String(e)}`

/** A box in surface px. */
export type Box = { x0: number; y0: number; x1: number; y1: number }
/**
 * A label something is drawn over: the region its text may ink, in surface px; the label, numbered as the text layer
 * numbers it (among the drawable labels); its `cover`, and the first index of the triangles drawn after it; and its
 * layer, 0 nearest the top.
 */
export type Cover = Box & { label: number; cover: number; first: number; layer: number }
/** Where a layer's cover sits among the labels (CSS z-index in the text layer): a covered label's text just under its
 *  layer's cover, a deeper layer under the text of the labels drawn after it. A label nothing is drawn over has none. */
export const zIndex = { text: (layer: number) => -2 * layer - 2, cover: (layer: number) => -2 * layer - 1 }
/** Hands a deeper layer's cover from the cover canvas to its own: device px, y down, and the canvas's size. */
export type Copy = (layer: number, box: [x: number, y: number, w: number, h: number], size: [w: number, h: number]) => void

/**
 * The labels the text layer draws (drawable) that geometry is drawn over, in label order. The frame's triangles are in
 * draw order and in vertex order (a shape's triangles use only its own vertices, and shapes follow each other), so those
 * drawn after a label are the ones from its cut: the core's `cover`, moved earlier if an eligible later shape meets
 * measured ink outside the T box. Shape starts/bounds and the label's `after` come from the core. The region is the box as the
 * text layer draws it (turned and sheared about its centre), joined with `extents[label]`, the box and text the text
 * layer measured (text past its box under fit 0 or 2; fit 1 clips its text to the box), grown by its shadows and outline
 * and cut to its clip box and the surface.
 *
 * Layers order the covers among the labels' text as the game draws them. A cover lies over the text of every label
 * drawn before its geometry and under that of every label drawn after it, so where two regions meet, the cover of the
 * label drawn first (the smaller `cover`) goes a layer deeper than the other's, under that label's text. Labels with
 * one `cover` share a layer (one alpha: what is drawn after both). ponytail: every pair of covered labels is compared,
 * covered labels squared (40,000 box tests for 200); a grid over the regions if a page carries thousands.
 */
export function covers(f: Frame, size: { w: number; h: number }, extents: readonly (Box | null | undefined)[] = []): Cover[] {
  const out: Cover[] = [], ix = f.indices, triangles = Math.floor(ix.length / 3)
  const meet = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  f.text.filter(drawable).forEach((t, label) => {
    if (!Number.isFinite(t.cover)) return   // none (a core from before `cover`): on top, as every label was before covers
    // The box's half extents through toLabel's inverse: turned back by the rotation, after the shear.
    const r = t.rotation * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), [a, b, cc, d] = shearMatrix(t) ?? [1, 0, 0, 1]
    const shadows = [...(t.shadow ? [t.shadow] : []), ...chunks(t.extraShadows ?? [], 7), ...(t.insetShadow ? [t.insetShadow] : [])]
    const grow = shadows.reduce((g, x) => Math.max(g, Math.abs(x[0]) + Math.abs(x[1]) + 3 * Math.abs(x[2])), 0) + Math.max(0, t.outlineWidth)
    const hx = Math.abs(c * a + s * b) * t.w / 2 + Math.abs(c * cc + s * d) * t.h / 2
    const hy = Math.abs(c * b - s * a) * t.w / 2 + Math.abs(c * d - s * cc) * t.h / 2
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2, k = t.clip ?? [0, 0, size.w, size.h], e = t.fit === 1 ? null : extents[label]
    const x0 = Math.max(Math.min(cx - hx, e?.x0 ?? Infinity) - grow, k[0], 0), y0 = Math.max(Math.min(cy - hy, e?.y0 ?? Infinity) - grow, k[1], 0)
    const x1 = Math.min(Math.max(cx + hx, e?.x1 ?? -Infinity) + grow, k[0] + k[2], size.w)
    const y1 = Math.min(Math.max(cy + hy, e?.y1 ?? -Infinity) + grow, k[1] + k[3], size.h)
    if (!(x0 < x1 && y0 < y1)) return
    const region = { x0, y0, x1, y1 }, shapes = f.elements[t.element]?.shapes ?? [], after = t.after ?? -1
    let cut = t.cover, lo = 0, hi = shapes.length
    if (Number.isFinite(after) && after >= 0) {
      while (lo < hi) { const m = (lo + hi) >>> 1; if (shapes[m].first < after) lo = m + 1; else hi = m }
      for (let i = lo; i < shapes.length && shapes[i].first < cut; i++)
        if (meet(region, shapes[i])) { cut = shapes[i].first; break }
    }
    lo = 0; hi = triangles
    while (lo < hi) { const m = (lo + hi) >>> 1; if (ix[3 * m] < cut) lo = m + 1; else hi = m }
    if (lo < triangles) out.push({ ...region, label, cover: cut, first: 3 * lo, layer: 0 })
  })
  // From the label drawn last down: each group of one cover goes under every layer it meets that was drawn after it.
  const order = out.map((_, i) => i).sort((i, j) => out[j].cover - out[i].cover)
  for (let start = 0, end = 0; start < order.length; start = end) {
    while (end < order.length && out[order[end]].cover === out[order[start]].cover) end++
    let layer = 0
    for (let i = start; i < end; i++) for (let j = 0; j < start; j++)
      if (meet(out[order[i]], out[order[j]])) layer = Math.max(layer, out[order[j]].layer + 1)
    for (let i = start; i < end; i++) out[order[i]].layer = layer
  }
  return out
}

/**
 * Draws a frame onto `canvas`. With `cover`, it draws instead the covers over the text layer: in each covered label's
 * region (`covers`), the colour the frame canvas shows there, at the coverage of the geometry drawn after the label as
 * alpha, and clear elsewhere. Layer 0 stays on `canvas`; each deeper layer is drawn alone and handed to `copy`, which
 * shows it at its own place among the labels (zIndex). Over a label's text that is the game's order: exact where the
 * covering geometry is opaque, and where no glyph is (the colour is the canvas's own); under a translucent cover the text
 * shows through by what the cover leaves, blended by the browser in sRGB, which is approximate.
 */
export function makeRenderer(canvas: HTMLCanvasElement, cover = false) {
  // preserveDrawingBuffer: readPixels after the browser composites must not read a cleared buffer.
  // No antialias: the mod feathers its own edges, and multisampling on top would change edge pixels against the game.
  // The display is transparent outside the page; the cover also has premultiplied alpha (FS_COVER).
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false })
  if (!gl) throw new Error('WebGL 2 is not available')
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const program = (vs: string, fs: string) => {
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader failed to compile')
      return s
    }
    const p = gl.createProgram(), v = shader(gl.VERTEX_SHADER, vs), f = shader(gl.FRAGMENT_SHADER, fs)
    gl.attachShader(p, v)
    gl.attachShader(p, f)
    gl.linkProgram(p)
    gl.deleteShader(v)  // the shaders go with the program
    gl.deleteShader(f)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program failed to link')
    return p
  }
  const scene = program(VS, FS), out = program(VS_OUT, cover ? FS_COVER : FS_OUT)
  const background = cover ? program(VS_OUT, FS_CHECKER) : null
  let imageProgram: WebGLProgram | null = null
  const textures = new Map<string, WebGLTexture>()
  gl.useProgram(scene)
  gl.uniform1f(gl.getUniformLocation(scene, 'dither'), DITHER)
  const size = gl.getUniformLocation(scene, 'size')
  const view = gl.getUniformLocation(scene, 'view')
  gl.useProgram(out)
  gl.uniform1i(gl.getUniformLocation(out, 'target'), 0)

  // The frame's attributes live in their own vertex array, so the output pass draws with none enabled.
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const attribute = (name: string, n: number, type: number, normalised: boolean) => {
    const b = gl.createBuffer(), at = gl.getAttribLocation(scene, name)
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.enableVertexAttribArray(at)
    gl.vertexAttribPointer(at, n, type, normalised, 0, 0)
    return b
  }
  const positions = attribute('p', 2, gl.FLOAT, false), colours = attribute('c', 4, gl.UNSIGNED_BYTE, true)
  const stored = attribute('stored', 4, gl.FLOAT, false)
  const coverage = attribute('cov', 1, gl.FLOAT, false), edges = attribute('edge', 1, gl.FLOAT, false), indices = gl.createBuffer()
  const uv = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, uv)
  gl.enableVertexAttribArray(3)
  gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices)
  gl.bindVertexArray(null)

  // The sRGB8 target decodes the destination for linear blending and encodes the result. NEAREST: without mipmaps
  // the default filter leaves it incomplete. The cover's has a stencil too (where a cover above lies over a label).
  const target = gl.createTexture(), fbo = gl.createFramebuffer(), stencil = cover ? gl.createRenderbuffer() : null
  let tw = 0, th = 0, complete = false
  const fit = () => {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    if (w === tw && h === th) return
    ;[tw, th] = [w, h]
    gl.bindTexture(gl.TEXTURE_2D, target)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
    if (stencil) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, stencil)
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, tw, th)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencil)
    }
    // 0x0 is never complete and is simply not drawn; any other size that fails is said once.
    complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    if (!complete && tw && th) console.error(`WebGL: the ${tw}x${th} linear target is incomplete; the canvas is not drawn`)
  }

  // The target encoded to sRGB once, onto the canvas (within the scissor, when one is on).
  const show = () => {
    gl.bindVertexArray(null)
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, tw, th)
    gl.useProgram(out)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, target)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  return {
    maxTextureSize,
    /** With `cover`: `cs` is covers(f, surface, …) (computed here when not given), and `copy` takes each deeper layer. */
    draw(f: Frame, surface: { w: number; h: number }, cs?: Cover[], copy?: Copy,
      v: Viewport = { zoom: 1, pan: { x: 0, y: 0 } }, avail = surface, pictureOf?: (src: string) => Picture | undefined) {
      fit()
      if (!complete) return
      gl.useProgram(out)
      gl.uniform2f(gl.getUniformLocation(out, 'density'), tw / avail.w, th / avail.h)
      gl.uniform4f(gl.getUniformLocation(out, 'page'), v.pan.x, avail.h - v.pan.y - surface.h * v.zoom, surface.w * v.zoom, surface.h * v.zoom)
      // The cover: clear, then each label something is drawn over, as a box in device px (y up), its first index and layer.
      const boxes: number[][] = []
      if (cover) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.disable(gl.SCISSOR_TEST)
        gl.colorMask(true, true, true, true)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        const sx = tw / avail.w, sy = th / avail.h
        for (const c of cs ?? covers(f, surface)) {
          const x = Math.max(0, Math.floor((c.x0 * v.zoom + v.pan.x) * sx))
          const y = Math.max(0, th - Math.ceil((c.y1 * v.zoom + v.pan.y) * sy))
          const x1 = Math.min(tw, Math.ceil((c.x1 * v.zoom + v.pan.x) * sx))
          const y1 = Math.min(th, th - Math.floor((c.y0 * v.zoom + v.pan.y) * sy))
          if (x < x1 && y < y1) boxes.push([x, y, x1 - x, y1 - y, c.first, c.layer])
        }
        if (!boxes.length) return
      }
      // 1: the frame blends in linear light into the sRGB8 target. The cover needs it only in its boxes,
      // and keeps alpha 0 there: alpha is what covers a label.
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.viewport(0, 0, tw, th)
      if (cover) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const [x, y, w, h] of boxes) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + w), Math.max(y1, y + h)]
        gl.enable(gl.SCISSOR_TEST)
        gl.scissor(x0, y0, x1 - x0, y1 - y0)
      }
      gl.clearColor(...CLEAR)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (background) {
        // Cover RGB reconstructs the displayed scene over the checker, in linear light. Its alpha remains
        // reserved for geometry after each label. This presentation-only fill never enters the scene target.
        gl.bindVertexArray(null)
        gl.disable(gl.BLEND)
        gl.useProgram(background)
        gl.uniform2f(gl.getUniformLocation(background, 'density'), tw / avail.w, th / avail.h)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      if (!cover && (v.pan.x > 0 || v.pan.y > 0 || v.pan.x + surface.w * v.zoom < avail.w || v.pan.y + surface.h * v.zoom < avail.h)) {
        const sx = tw / avail.w, sy = th / avail.h
        const x0 = Math.max(0, Math.floor(v.pan.x * sx)), y0 = Math.max(0, Math.floor(v.pan.y * sy))
        const x1 = Math.min(tw, Math.ceil((v.pan.x + surface.w * v.zoom) * sx))
        const y1 = Math.min(th, Math.ceil((v.pan.y + surface.h * v.zoom) * sy))
        gl.enable(gl.SCISSOR_TEST)
        gl.scissor(x0, th - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0))
      }
      gl.useProgram(scene)
      gl.uniform2f(size, avail.w, avail.h)
      gl.uniform3f(view, v.pan.x, v.pan.y, v.zoom)
      gl.bindVertexArray(vao)
      for (const [b, data] of [[positions, f.positions], [colours, f.colours], [coverage, f.coverage], [edges, f.edge ?? new Float32Array(f.positions.length / 2)], [uv, f.uv ?? new Float32Array(f.positions.length)], [stored, f.storedColours ?? new Float32Array(f.positions.length * 2)]] as const) {
        gl.bindBuffer(gl.ARRAY_BUFFER, b)
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
      }
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, f.indices, gl.DYNAMIC_DRAW)
      const drawRange = (first: number, count: number) => {
        const end = first + count
        let at = first
        const colour = (until: number) => {
          if (until > at) { gl.useProgram(scene); gl.drawElements(gl.TRIANGLES, until - at, gl.UNSIGNED_INT, 4 * at) }
          at = until
        }
        for (const image of f.images ?? []) {
          if (image.first + image.count <= at) continue
          if (image.first >= end) break
          colour(Math.max(at, image.first))
          const until = Math.min(end, image.first + image.count), picture = pictureOf?.(image.src)
          if (picture && picture.width <= maxTextureSize && picture.height <= maxTextureSize) {
            let texture = textures.get(image.src)
            if (!texture) {
              texture = gl.createTexture()!
              textures.set(image.src, texture)
              gl.activeTexture(gl.TEXTURE0)
              gl.bindTexture(gl.TEXTURE_2D, texture)
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
              gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
              gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
              if (picture.pixels instanceof Uint8Array)
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, picture.width, picture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, picture.pixels)
              else gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, picture.pixels)
              const filter = image.src.startsWith('point:') ? gl.NEAREST : gl.LINEAR
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            }
            if (!imageProgram) {
              imageProgram = program(VS_IMAGE, FS_IMAGE)
              gl.useProgram(imageProgram)
              gl.uniform1f(gl.getUniformLocation(imageProgram, 'dither'), DITHER)
              gl.uniform1i(gl.getUniformLocation(imageProgram, 'picture'), 0)
            }
            gl.useProgram(imageProgram)
            gl.uniform2f(gl.getUniformLocation(imageProgram, 'size'), avail.w, avail.h)
            gl.uniform3f(gl.getUniformLocation(imageProgram, 'view'), v.pan.x, v.pan.y, v.zoom)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, texture)
            gl.drawElements(gl.TRIANGLES, until - at, gl.UNSIGNED_INT, 4 * at)
          }
          at = until
        }
        colour(end)
      }
      gl.enable(gl.BLEND)
      if (cover) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      drawRange(0, f.indices.length)
      // 2: encoded to sRGB once, onto the canvas.
      if (!cover) { gl.disable(gl.SCISSOR_TEST); return show() }
      // 2, the cover, deepest layer first: per label, in its box, the alpha of the triangles drawn after it (alpha over
      // alpha, colour kept), then onto the canvas. Boxes that overlap within a layer have one cover, so one alpha. A
      // deeper layer goes to `copy` and off the canvas; layer 0 stays.
      // Where covers above (a nearer layer, drawn after this label's) lie over the label too, the label's text shows
      // through each of them: this one gathers only what is drawn up to the first of them there, so the alphas multiply
      // to what the game's geometry leaves, not counting that geometry twice. The stencil marks where one already did.
      // (Device px round boxes out, so a box may touch one it does not meet in surface px: only covers drawn later count.)
      const meet = (a: number[], b: number[]) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
      let layers = 0
      for (const b of boxes) layers = Math.max(layers, b[5] + 1)
      for (let k = layers - 1; k >= 0; k--) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const box of boxes) {
          const [x, y, w, h, first, layer] = box
          if (layer !== k) continue
          ;[x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + w), Math.max(y1, y + h)]
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
          gl.useProgram(scene)
          gl.bindVertexArray(vao)
          gl.enable(gl.BLEND)
          gl.scissor(x, y, w, h)
          gl.colorMask(false, false, false, true)
          gl.clear(gl.COLOR_BUFFER_BIT)
          gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
          const above = k ? boxes.filter(b => b[5] < k && b[4] > first && meet(b, box)).sort((a, b) => a[4] - b[4]) : []
          if (above.length) {
            gl.clearStencil(0)
            gl.clear(gl.STENCIL_BUFFER_BIT)
            gl.enable(gl.STENCIL_TEST)
            gl.stencilFunc(gl.EQUAL, 0, 0xff)
          }
          for (const [ax, ay, aw, ah, until] of above) {
            const sx = Math.max(x, ax), sy = Math.max(y, ay)
            gl.scissor(sx, sy, Math.min(x + w, ax + aw) - sx, Math.min(y + h, ay + ah) - sy)
            drawRange(first, until - first)
            gl.clearStencil(1)
            gl.clear(gl.STENCIL_BUFFER_BIT)
          }
          gl.scissor(x, y, w, h)
          drawRange(first, f.indices.length - first)
          gl.disable(gl.STENCIL_TEST)
          gl.colorMask(true, true, true, true)
          show()
        }
        if (k === 0 || !copy || x0 > x1) continue
        copy(k, [x0, th - y1, x1 - x0, y1 - y0], [tw, th])
        gl.scissor(x0, y0, x1 - x0, y1 - y0)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
      gl.disable(gl.SCISSOR_TEST)
    },
    /** Captured scene target RGBA (sRGB-encoded linear premultiplied RGB), top row first; no display checker. */
    readPixels() {
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, row = w * 4
      const up = new Uint8Array(row * h), down = new Uint8Array(row * h)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, up)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      for (let y = 0; y < h; y++) down.set(up.subarray((h - 1 - y) * row, (h - y) * row), y * row)
      return down
    },
    /** Frees every GL object this renderer made; the context stays with the canvas. */
    dispose() {
      gl.deleteProgram(scene)
      gl.deleteProgram(out)
      gl.deleteProgram(background)
      gl.deleteProgram(imageProgram)
      gl.deleteVertexArray(vao)
      for (const b of [positions, colours, coverage, edges, indices, uv, stored]) gl.deleteBuffer(b)
      for (const texture of textures.values()) gl.deleteTexture(texture)
      gl.deleteTexture(target)
      gl.deleteFramebuffer(fbo)
      gl.deleteRenderbuffer(stencil)
    },
  }
}
