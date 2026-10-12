// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Frame } from '../runtime/frame'
import type { Box, Copy, Cover } from './gl'
// No WebGL here: the renderer is a stub that records what it is asked to draw, the cover's draws apart; the covers are
// the test's (`plan`), and the stub hands each deeper layer to `copy` as the renderer does.
type Drawn = { id: string | undefined; w: number; h: number }
const gl = vi.hoisted(() => ({ draws: [] as Drawn[], covers: [] as Drawn[], canvases: [] as (HTMLCanvasElement | null)[],
  plan: [] as Cover[], extents: [] as (Box | null | undefined)[][], copyVisible: true, copyBox: [20, 40, 60, 100] as [number, number, number, number] }))
vi.mock('./gl', async importOriginal => ({
  zIndex: (await importOriginal<typeof import('./gl')>()).zIndex,
  covers: (_f: Frame, _s: unknown, extents: (Box | null | undefined)[]) => { gl.extents.push([...extents]); return gl.plan },
  makeRenderer: (c: HTMLCanvasElement, cover?: boolean) => {
    if (cover) gl.canvases.push(c)
    return { maxTextureSize: 4096, draw: (f: Frame, s: { w: number; h: number }, cs?: Cover[], copy?: Copy, _v?: unknown, _a?: unknown, pictureOf?: (src: string) => unknown) => {
      (cover ? gl.covers : gl.draws).push({ id: f.elements[0]?.id, w: s.w, h: s.h })
      for (const image of f.images ?? []) pictureOf?.(image.src)
      if (gl.copyVisible) for (const k of new Set(cs?.map(c => c.layer).filter(l => l > 0))) copy?.(k, gl.copyBox, [200, 200])
    }, dispose() {} }
  },
  startFailure: String,
}))
import { CoreBridge } from '../runtime/bridge'
import { FakeWorker, label, vbf1 } from '../runtime/testing'
import { mount, run } from '../testing'
import { Canvas, type ViewApi } from './Canvas'
import { importFont, removeFont, registerPageFonts } from './fonts'
import { harness } from '../editing/testing'
import { node } from '../model/testing'
import { NativeLayer } from './NativeLayer'
import { newProject } from '../model/project'
import { vanillaPlus } from '../theme/vanillaPlus'
import { linksOf } from '../theme/links'
import { Pictures } from './pictures'
import { instance } from '../widgets/testing'

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] }))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  gl.draws = []
  gl.covers = []
  gl.canvases = []
  gl.plan = []
  gl.extents = []
  gl.copyVisible = true
  gl.copyBox = [20, 40, 60, 100]
})

const nextFrame = () => run(() => { vi.advanceTimersToNextFrame() })

it('waits for the shell view slot and publishes viewApi only after commit', () => {
  const bridge = new CoreBridge(() => new FakeWorker() as unknown as Worker, { ready() {}, status() {}, halted() {} })
  const api: { current: ViewApi | null } = { current: null }, seen: (ViewApi | null)[] = []
  function ObserveRender() { seen.push(api.current); return null }
  const ui = mount(<><Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} navigate viewApi={api} viewSlot={null} /><ObserveRender /></>)
  try {
    expect(seen[0]).toBeNull()
    expect(api.current).not.toBeNull()
    expect(ui.container.querySelector('[aria-label="Canvas view"]')).toBeNull()
  } finally { ui.unmount(); bridge.dispose() }
})

describe('Canvas', () => {
  it.each(['source width', 'source height', 'region width', 'region height'])('skips a zero %s copy and resumes after a valid resize', async invalid => {
    let resize: (width: number, height: number) => void = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: (e: { contentRect: { width: number; height: number } }[]) => void) { resize = (width, height) => cb([{ contentRect: { width, height } }]) }
      observe() { resize(200, 200) }
      disconnect() {}
    })
    const drawImage = vi.fn((source: HTMLCanvasElement, _x: number, _y: number, w: number, h: number) => {
      if (!source.width || !source.height || !w || !h) throw Error('zero-area drawImage')
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, clearRect() {} } as unknown as CanvasRenderingContext2D)
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    gl.plan = [{ x0: 0, y0: 0, x1: 50, y1: 50, label: 0, cover: 0, first: 0, layer: 1 }]
    const props = { bridge, surface: 'main', size: { w: 100, h: 100 }, tag: false }
    const ui = mount(<Canvas {...props} viewport={{ zoom: 1, pan: { x: 0, y: 0 } }} />)
    try {
      expect(drawImage).toHaveBeenCalled()
      const deeper = ui.container.querySelectorAll<HTMLCanvasElement>('.vb-text canvas')[1]
      drawImage.mockClear()
      if (invalid.startsWith('source')) await run(() => resize(invalid.endsWith('width') ? 0 : 200, invalid.endsWith('height') ? 0 : 200))
      else {
        gl.copyBox[invalid.endsWith('width') ? 2 : 3] = 0
        ui.rerender(<Canvas {...props} viewport={{ zoom: 2, pan: { x: 0, y: 0 } }} />)
      }
      expect(drawImage).not.toHaveBeenCalled()
      expect([deeper.width, deeper.height]).toEqual([0, 0])
      gl.copyBox = [20, 40, 60, 100]
      await run(() => resize(200, 200))
      ui.rerender(<Canvas {...props} viewport={{ zoom: 3, pan: { x: 0, y: 0 } }} />)
      expect(drawImage).toHaveBeenCalled()
      expect([deeper.width, deeper.height]).toEqual([60, 100])
    } finally { ui.unmount() }
  })
  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('keeps the press coordinate space through layout and view changes until %s', async end => {
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge, events: unknown[] = []
    const props = { bridge, size: { w: 460, h: 460 }, tag: false, navigate: true,
      onPointer: (kind: string, x: number, y: number) => { events.push([kind, x, y]) } }
    const ui = mount(<Canvas {...props} surface="main" viewport={{ zoom: 2, pan: { x: 100, y: 50 } }} />)
    const overlay = ui.container.querySelector<HTMLElement>('.vb-overlay')!
    const rect = vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 200 }))
    const pointer = (type: string, x: number, y: number) => run(() => { overlay.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y })) })
    try {
      await pointer('pointerdown', 250, 350)
      rect.mockReturnValue(DOMRect.fromRect({ x: 140, y: 83 }))
      ui.rerender(<Canvas {...props} surface="main" viewport={{ zoom: 4, pan: { x: 40, y: 10 } }} />)
      await pointer('pointermove', 450, 250)
      await pointer(end, 450, 250)
      expect(events).toEqual([['down', 25, 50], ['move', 125, 0], ['up', 125, 0]])
      await pointer('pointermove', 450, 250)
      expect(events.at(-1)).toEqual(['move', 67.5, 39.25])
    } finally { ui.unmount() }
  })

  it('keeps a real shape move in scene units when its canvas shifts and refits', async () => {
    const scene = { header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 200, y: 200, w: 100, h: 100 })] }
    const h = harness(scene, { pick: () => ({ pageId: 'p1', path: [0] }) }), bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    h.ctx.setSettings({ snap: false })
    const props = { bridge, surface: 'main', size: { w: 460, h: 460 }, tag: false, navigate: true,
      onPointer: h.router.pointer, children: h.router.overlay }
    const ui = mount(<Canvas {...props} viewport={{ zoom: 0.8, pan: { x: 0, y: 0 } }} />)
    const overlay = ui.container.querySelector<HTMLElement>('.vb-overlay')!
    const rect = vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 50, y: 300 }))
    const pointer = (type: string, x: number, y: number) => run(() => { overlay.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y })) })
    try {
      await pointer('pointerdown', 230, 480)
      rect.mockReturnValue(DOMRect.fromRect({ x: 50, y: 183 }))
      ui.rerender(<Canvas {...props} viewport={{ zoom: 1, pan: { x: 0, y: 0 } }} />)
      await pointer('pointermove', 330, 480); await pointer('pointerup', 330, 480)
      expect(h.root()[0].attrs).toMatchObject({ x: 325, y: 200 })
      expect(h.state().past).toHaveLength(1)
    } finally { ui.unmount(); h.checker.dispose() }
  })
  it('keeps touch pinch motion independent of a moving canvas origin', async () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() { this.cb([{ contentRect: { width: 800, height: 600 } }]) }
      disconnect() {}
    })
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} navigate />)
    const overlay = ui.container.querySelector<HTMLElement>('.vb-overlay')!
    const rect = vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 200 }))
    const touch = (type: string, id: number, x: number) => run(() => { overlay.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: id, clientX: x, clientY: 400 })) })
    try {
      await touch('pointerdown', 1, 300); await touch('pointerdown', 2, 400)
      rect.mockReturnValue(DOMRect.fromRect({ x: 140, y: 83 }))
      await touch('pointermove', 2, 500)
      expect(ui.container.querySelector<HTMLInputElement>('[aria-label="Zoom percent"]')!.value).toBe('240')
      const pan = ui.container.querySelector<HTMLElement>('.vb-view')!.style.transform.match(/translate\(([^p]+)px, ([^p]+)px\)/)!
      expect(Number(pan[1])).toBeCloseTo(48); expect(Number(pan[2])).toBeCloseTo(-152)
      await touch('pointerup', 2, 500); await touch('pointerup', 1, 300)
    } finally { ui.unmount() }
  })
  it('hands the shown page pending and drawn sources to pictures and supplies textures to both renderers', async () => {
    const pictures = new Pictures(), observe = vi.spyOn(pictures, 'observe'), image = vi.spyOn(pictures, 'image')
      .mockReturnValue({ width: 2, height: 1, pixels: new Uint8Array(8) })
    let arrived!: (f: Frame, timing: unknown, surface: string) => void
    const bridge = { onFrame: (cb: typeof arrived) => { arrived = cb; return () => {} }, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false} pictures={pictures} picturePage="p1" />)
    const f: Frame = { positions: new Float32Array(), coverage: new Float32Array(), colours: new Uint8Array(), indices: new Uint32Array(),
      spans: new Int32Array(), elements: [], text: [], problems: [], images: [{ element: 0, src: 'data:x', first: 0, count: 0 }],
      pending: ['https://example.com/a.png', 'file:///a.bmp'] }
    try {
      await run(() => arrived(f, {}, 'main'))
      expect(observe).toHaveBeenCalledWith('p1', [...f.pending!, 'data:x'])
      expect(pictures.notes('p1').slice(0, 2).map(n => n.message)).toEqual(['Load pictures to preview this picture', "read from the game machine's disk"])
      expect(image.mock.calls.filter(([src]) => src === 'data:x').length).toBeGreaterThanOrEqual(2)
      await run(() => arrived(f, {}, 'other'))
      expect(observe).toHaveBeenCalledOnce()
    } finally { ui.unmount(); pictures.dispose() }
  })
  it('reports a cached drawn picture exceeding the renderer limit even without pending sources', async () => {
    const pictures = new Pictures(), src = 'data:image/png;base64,AA=='
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4097, height: 1, close() {} }))
    pictures.connect({ readPicture: async () => ({ format: 'png', bytes: new Uint8Array([0]), width: 0, height: 0 }),
      readPictureBytes: vi.fn(), setImage: async () => {} })
    pictures.observe('old', [src])
    await vi.waitFor(() => expect(pictures.image(src)).toBeDefined())
    let arrived!: (f: Frame, timing: unknown, surface: string) => void
    const bridge = { onFrame: (cb: typeof arrived) => { arrived = cb; return () => {} }, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false} pictures={pictures} picturePage="p1" />)
    try {
      const f: Frame = { positions: new Float32Array(), coverage: new Float32Array(), colours: new Uint8Array(), indices: new Uint32Array(),
        spans: new Int32Array(), elements: [], text: [], problems: [], images: [{ element: 0, src, first: 0, count: 0 }], pending: [] }
      await run(() => arrived(f, {}, 'main'))
      expect(pictures.notes('p1')).toEqual([{ src, message: 'too large to preview here: 4097×1 pixels exceed this browser\'s maximum texture size of 4096×4096' }])
    } finally { ui.unmount(); pictures.dispose() }
  })
  it('keeps Fit following the stage size after an explicit view', async () => {
    let resize!: (entries: { contentRect: { width: number; height: number } }[]) => void
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: typeof resize) { resize = cb }
      observe() { resize([{ contentRect: { width: 800, height: 600 } }]) }
      disconnect() {}
    })
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} navigate />)
    try {
      await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="100 percent"]')!.click())
      await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Fit page"]')!.click())
      await run(() => resize([{ contentRect: { width: 400, height: 300 } }]))
      expect(ui.container.querySelector<HTMLElement>('.vb-view')!.style.width).toBe('252px')
      const pan = ui.container.querySelector<HTMLElement>('.vb-view')!.style.transform.match(/translate\(([^p]+)px, ([^p]+)px\)/)!
      expect(Number(pan[1])).toBeCloseTo(74); expect(Number(pan[2])).toBeCloseTo(24)
    } finally { ui.unmount() }
  })
  it('ignores Play presses in the margin and keeps captured releases on the surface', async () => {
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge, pointer = vi.fn()
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false}
      viewport={{ zoom: 2, pan: { x: 20, y: 30 } }} onPointer={pointer} />)
    const send = (type: string, x: number) => run(() => { ui.container.querySelector('.vb-overlay')!.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: 50 })) })
    try {
      await send('pointerdown', 10); await send('pointerup', 10)
      await send('pointerdown', 230); await send('pointerup', 230)
      expect(pointer).not.toHaveBeenCalled()
      await send('pointerdown', 40); await send('pointerup', 300)
      expect(pointer.mock.calls.map(([kind, x, y]) => [kind, x, y])).toEqual([['down', 10, 10], ['up', 100, 10]])
    } finally { ui.unmount() }
  })
  it('maps a navigated press through the page and entered group while keeping linked drawing defaults', async () => {
    const scene = { header: { w: 230, h: 230 }, defs: [], root: [node('G', { t: [10, 20], s: [2, 3] },
      [node('R', { x: 10, y: 10, w: 40, h: 40 })])] }
    const pick = vi.fn(p => p.x === 80 && p.y === 130 ? { pageId: 'p1', path: [0, 0] } : null)
    const h = harness(scene, { pick })
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false}
      viewport={{ zoom: 2, pan: { x: 100, y: 50 } }} onPointer={h.router.pointer} children={h.router.overlay} />)
    const pointer = async (type: string, x: number, y: number, ctrlKey = false) => run(() => {
      ui.container.querySelector('.vb-overlay')!.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y, ctrlKey,
      }))
    })
    try {
      // CSS (260,310) -> surface (80,130) -> design (40,65) -> local (15,15).
      await pointer('pointerdown', 260, 310); await pointer('pointerup', 260, 310)
      expect(pick).toHaveBeenCalledWith({ x: 80, y: 130 })
      expect(h.state().selection?.path).toEqual([0])
      await pointer('pointerdown', 260, 310); await pointer('pointerup', 260, 310)
      expect(h.state()).toMatchObject({ entered: { pageId: 'p1', path: [0] }, selection: { path: [0, 0] } })
      expect(h.state().past).toHaveLength(0)
      h.ctx.setDrawDefaults({ R: { attrs: { rx: 3 }, links: { f: { part: 'shape', field: 'fill' } } } })
      h.ctx.setTool('rect')
      await pointer('pointerdown', 504, 502, true); await pointer('pointermove', 664, 622, true); await pointer('pointerup', 664, 622, true)
      expect(h.root()).toHaveLength(1)
      const drawn = h.root()[0].c![1]
      expect(drawn.attrs).toMatchObject({ x: 45.5, y: 31, w: 20, h: 10, rx: 3, f: vanillaPlus.colors['surface-panel'] })
      expect(linksOf(drawn)).toEqual({ f: { part: 'shape', field: 'fill' } })
      expect(h.state()).toMatchObject({ entered: { path: [0] }, selection: { path: [0, 1] } })
      expect(h.state().past).toHaveLength(1)
    } finally { ui.unmount(); h.checker.dispose() }
  })

  it('clears an old deeper cover when that layer is outside the navigated viewport', () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() { this.cb([{ contentRect: { width: 200, height: 200 } }]) }
      disconnect() {}
    })
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    gl.plan = [{ x0: 0, y0: 0, x1: 50, y1: 50, label: 0, cover: 0, first: 0, layer: 1 }]
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false}
      viewport={{ zoom: 2, pan: { x: 0, y: 0 } }} />)
    try {
      const deeper = ui.container.querySelectorAll('.vb-text canvas')[1] as HTMLCanvasElement
      expect(deeper.width).toBe(60)
      gl.copyVisible = false   // the GPU emits no copy for an offscreen layer
      ui.rerender(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false}
        viewport={{ zoom: 2, pan: { x: 200, y: 0 } }} />)
      expect([deeper.width, deeper.height]).toEqual([0, 0])
    } finally { ui.unmount() }
  })

  it('lets a zoom percentage be replaced before committing on Enter', async () => {
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} navigate />)
    const input = ui.container.querySelector<HTMLInputElement>('[aria-label="Zoom percent"]')!
    const type = async (value: string) => run(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    try {
      input.focus()
      await type('')
      expect(input.value).toBe('')
      await type('2'); await type('25')
      await run(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
      expect(input.value).toBe('25')
      expect(ui.container.querySelector<HTMLElement>('.vb-view')!.style.width).toBe('115px')
    } finally { ui.unmount() }
  })

  it('keeps the zoom field valid at fractional percentages', () => {
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} navigate
      viewport={{ zoom: 1.2345, pan: { x: 0, y: 0 } }} />)
    try { expect(ui.container.querySelector<HTMLInputElement>('[aria-label="Zoom percent"]')!.validity.stepMismatch).toBe(false) }
    finally { ui.unmount() }
  })

  it('starts Space-pan on a native placeholder without selecting it', async () => {
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge, select = vi.fn()
    const page = { ...newProject().pages[0], natives: [instance('textinput')] }
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} navigate
      children={({ zoom }) => <NativeLayer page={page} theme={vanillaPlus} zoom={zoom} onSelect={select} />} />)
    try {
      await run(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
      await run(() => { ui.container.querySelector('.vb-native')!.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerId: 1, clientX: 10, clientY: 10,
      })) })
      await run(() => { ui.container.querySelector('.vb-overlay')!.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 1, clientX: 110, clientY: 60,
      })) })
      expect(select).not.toHaveBeenCalled()
      expect(ui.container.querySelector<HTMLElement>('.vb-view')!.style.transform).toBe('translate(97.7px, 47.7px)')
    } finally { ui.unmount() }
  })

  it('pinches at the midpoint, pans with the moving midpoint, and cancels the first touch drawing gesture', async () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() { this.cb([{ contentRect: { width: 800, height: 600 } }]) }
      disconnect() {}
    })
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [] })
    h.ctx.setTool('rect')
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} navigate
      onPointer={h.router.pointer} children={h.router.overlay} />)
    const touch = async (type: string, id: number, x: number) => run(() => { ui.container.querySelector('.vb-overlay')!.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: 200 })) })
    try {
      await touch('pointerdown', 1, 200); await touch('pointerdown', 2, 300); await touch('pointermove', 2, 400)
      expect(ui.container.querySelector<HTMLInputElement>('[aria-label="Zoom percent"]')!.value).toBe('240')
      const translation = ui.container.querySelector<HTMLElement>('.vb-view')!.style.transform.match(/translate\(([^p]+)px, ([^p]+)px\)/)!
      expect(Number(translation[1])).toBeCloseTo(48)
      expect(Number(translation[2])).toBeCloseTo(-152)
      await touch('pointerup', 2, 400); await touch('pointerup', 1, 200)
      expect(h.root()).toEqual([])
      expect(h.state().past).toHaveLength(0)
    } finally { ui.unmount(); h.checker.dispose() }
  })

  it('routes a real panned canvas press to picking, draws and snaps in surface units', async () => {
    const scene = { header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 10, y: 10, w: 40, h: 40 })] }
    const h = harness(scene, { pick: p => p.x === 25 && p.y === 25 ? { pageId: 'p1', path: [0] } : null })
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false}
      viewport={{ zoom: 2, pan: { x: 100, y: 50 } }} onPointer={h.router.pointer} children={h.router.overlay} />)
    const pointer = async (type: string, x: number, y: number) => run(() => { ui.container.querySelector('.vb-overlay')!.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y })) })
    try {
      await pointer('pointerdown', 150, 100); await pointer('pointerup', 150, 100)
      expect(h.state().selection?.path).toEqual([0])
      h.ctx.setTool('rect')
      await pointer('pointerdown', 222, 172); await pointer('pointermove', 322, 272); await pointer('pointerup', 322, 272)
      expect(h.root()[1].attrs).toMatchObject({ x: 61, y: 61, w: 50, h: 50 })
      expect(h.state().past).toHaveLength(1)
    } finally { ui.unmount(); h.checker.dispose() }
  })

  it('pans with Space-drag, cancels pan with Esc, and retains a separate view per page', async () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() { this.cb([{ contentRect: { width: 800, height: 600 } }]) }
      disconnect() {}
    })
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge, presses = vi.fn()
    const props = { bridge, size: { w: 460, h: 460 }, tag: false, navigate: true, onPointer: presses }
    const ui = mount(<Canvas {...props} surface="main" />)
    const key = async (type: string, key: string) => run(() => { document.body.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })) })
    const pointer = async (type: string, x: number, y: number) => run(() => { ui.container.querySelector('.vb-overlay')!.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y })) })
    const pan = () => ui.container.querySelector<HTMLElement>('.vb-view')!.style.transform
    try {
      expect(pan()).toBe('translate(124px, 24px)')
      await key('keydown', ' '); await pointer('pointerdown', 200, 100); await pointer('pointermove', 300, 150)
      expect(pan()).toBe('translate(224px, 74px)')
      await key('keydown', 'Escape')
      expect(pan()).toBe('translate(124px, 24px)')
      await pointer('pointerup', 300, 150)
      await pointer('pointerdown', 200, 100); await pointer('pointermove', 300, 150); await pointer('pointerup', 300, 150)
      await key('keyup', ' ')
      expect(presses).not.toHaveBeenCalled()
      ui.rerender(<Canvas {...props} surface="second" />)
      expect(pan()).toBe('translate(124px, 24px)')
      ui.rerender(<Canvas {...props} surface="main" />)
      expect(pan()).toBe('translate(224px, 74px)')
    } finally { ui.unmount() }
  })

  it('fits the selection with a margin, centres 100 percent, and offers keyboard pan controls', async () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() { this.cb([{ contentRect: { width: 800, height: 600 } }]) }
      disconnect() {}
    })
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false}
      navigate selectionBox={{ x: 100, y: 200, w: 100, h: 50 }} />)
    const click = async (name: string) => run(() => ui.container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click())
    const pan = () => ui.container.querySelector<HTMLElement>('.vb-view')!.style.transform
    try {
      await click('Fit selection')
      expect(Number(ui.container.querySelector<HTMLInputElement>('[aria-label="Zoom percent"]')!.value)).toBe(752)
      expect(pan()).toBe('translate(-728px, -1392px)')
      await click('100 percent')
      expect(pan()).toBe('translate(170px, 70px)')
      await click('Pan right')
      expect(pan()).toBe('translate(210px, 70px)')
      await click('Fit page')
      expect(pan()).toBe('translate(124px, 24px)')
    } finally { ui.unmount() }
  })

  it('keeps backing size bounded by the visible area at zoom 64 and maps a panned press to surface px', async () => {
    vi.stubGlobal('devicePixelRatio', 2)
    vi.stubGlobal('ResizeObserver', class {
      constructor(private cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() { this.cb([{ contentRect: { width: 800, height: 600 } }]) }
      disconnect() {}
    })
    const bridge = { onFrame: () => () => {}, frame: vi.fn() } as unknown as CoreBridge
    const points: number[][] = []
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false}
      navigate viewport={{ zoom: 64, pan: { x: 100, y: 50 } }} onPointer={(_k, x, y) => points.push([x, y])} />)
    try {
      const canvases = ui.container.querySelectorAll('canvas')
      expect(canvases[0].width).toBe(1600)
      expect(canvases[0].height).toBe(1200)
      expect(canvases[1].width).toBe(1600)
      const overlay = ui.container.querySelector('.vb-overlay')!
      await run(() => { overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: 740, clientY: 370, bubbles: true })) })
      expect(points).toEqual([[10, 5]])
      await nextFrame()
      expect(bridge.frame).toHaveBeenCalledWith('main', 128, false)
    } finally { ui.unmount() }
  })

  it('shares pan between labels, covers and overlays, redraws on pan, and keeps fixedZoom deterministic', async () => {
    const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false}
      viewport={{ zoom: 2, pan: { x: 100, y: 50 } }} children={() => <span data-tool="yes" />} />)
    try {
      const view = ui.container.querySelector<HTMLElement>('.vb-view')!
      expect(view?.style.transform).toBe('translate(100px, 50px)')
      expect(view?.querySelector('[data-label], .vb-text')).not.toBeNull()
      expect(view?.querySelector('[data-tool]')).not.toBeNull()
      const draws = gl.draws.length
      ui.rerender(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false}
        viewport={{ zoom: 2, pan: { x: 200, y: 80 } }} />)
      expect(gl.draws.length).toBeGreaterThan(draws)
      ui.rerender(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false} fixedZoom={1}
        viewport={{ zoom: 64, pan: { x: 200, y: 80 } }} />)
      expect(ui.container.querySelector('canvas')!.width).toBe(100)
      expect(ui.container.querySelector<HTMLElement>('.vb-view')!.style.transform).toBe('translate(0px, 0px)')
    } finally { ui.unmount() }
  })

  it('remeasures only labels using the face that finished loading, including rich text and weight slots', async () => {
    const own = Object.getOwnPropertyDescriptor(document, 'fonts'), faces = new EventTarget()
    Object.defineProperty(document, 'fonts', { configurable: true, value: faces })
    const range = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ width: 60, height: 20 }))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({}))
    let receive: (f: Frame) => void = () => {}
    const bridge = { onFrame: (f: Parameters<CoreBridge['onFrame']>[0]) => { receive = frame => f(frame, { roundTripMs: 0, workerMs: 0 }, 'main'); return () => {} }, frame() {} } as unknown as CoreBridge
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 1000, h: 1000 }} tag={false} fixedZoom={1} />)
    try {
      const text = [...Array.from({ length: 200 }, () => label({ font: 'Barlow', text: 'plain' })),
        label({ font: 'Barlow Bold' }), label({ font: 'Barlow', text: '<font="Barlow Bold">tag</font>' }),
        label({ font: 'Barlow', bold: true }), label({ font: 'Barlow', text: '<font-weight=700>weight</font-weight>' }),
        label({ font: 'Barlow', text: '<b><i>italic</i></b>' })]
      await run(() => receive({ positions: new Float32Array(), coverage: new Float32Array(), colours: new Uint8Array(),
        indices: new Uint32Array(), spans: new Int32Array(), elements: [], text, problems: [] }))
      range.mockClear()
      await run(() => { faces.dispatchEvent(new Event('loadingdone')) })
      expect(range).not.toHaveBeenCalled()
      await run(() => { faces.dispatchEvent(Object.assign(new Event('loadingdone'), { fontfaces: [{ family: 'Barlow Bold' }] })) })
      expect(range).toHaveBeenCalledTimes(4)
      range.mockClear()
      await run(() => { faces.dispatchEvent(Object.assign(new Event('loadingdone'), { fontfaces: [{ family: 'Barlow Bold Italic' }] })) })
      expect(range).toHaveBeenCalledTimes(1)
    } finally {
      ui.unmount()
      if (own) Object.defineProperty(document, 'fonts', own)
      else delete (document as { fonts?: unknown }).fonts
    }
  })
  it("redraws the shown surface's own last frame on a switch, never another surface's, and the bare background when it has none", async () => {
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly cb: (e: { contentRect: { width: number; height: number } }[]) => void) {}
      observe() { this.cb([{ contentRect: { width: 1000, height: 1000 } }]) }
      disconnect() {}
    })
    const worker = new FakeWorker()
    const bridge = new CoreBridge(() => worker as unknown as Worker, { ready() {}, status() {}, halted() {} })
    worker.reply({ kind: 'ready' })
    // Answers the frame request in flight with one element named `id`.
    const answer = (id: string) => run(() => {
      const m = worker.last()
      expect(m.kind).toBe('frame')
      worker.reply({ id: m.id, kind: 'frame', workerMs: 0, buf: vbf1(JSON.stringify({ problems: [], text: [],
        elements: [{ id, scene: 's', x: 0, y: 0, w: 1, h: 1, firstVertex: 0, vertexCount: 0 }] })) })
    })
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} />)
    await nextFrame()
    expect(worker.last()).toMatchObject({ kind: 'frame', surface: 'main' })
    await answer('m1')
    expect(gl.draws.at(-1)).toEqual({ id: 'm1', w: 460, h: 460 })
    await nextFrame() // the next frame of main is in flight
    expect(worker.last()).toMatchObject({ kind: 'frame', surface: 'main' })

    ui.rerender(<Canvas bridge={bridge} surface="page2" size={{ w: 1036, h: 460 }} tag={false} />)
    expect(gl.draws.at(-1)).toEqual({ id: undefined, w: 1036, h: 460 })   // page2 has no frame yet: the bare background
    const drawn = gl.draws.length
    await answer('m2')   // main's frame lands after the switch: kept for main, not drawn over page2
    expect(gl.draws).toHaveLength(drawn)

    ui.rerender(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} />)
    expect(gl.draws.at(-1)).toEqual({ id: 'm2', w: 460, h: 460 })
    ui.rerender(<Canvas bridge={bridge} surface="main" size={{ w: 1036, h: 460 }} tag={false} />)   // a new shape
    expect(gl.draws.at(-1)).toEqual({ id: undefined, w: 1036, h: 460 })   // not the old frame stretched
    // The cover over the text layer is drawn with every frame, from the same frame at the same size.
    expect(gl.covers).toEqual(gl.draws)
    const [cover] = gl.canvases
    expect(gl.canvases).toHaveLength(1)
    expect(cover?.parentElement?.className).toBe('vb-text')
    expect([cover?.width, cover?.height]).toEqual([ui.container.querySelector('canvas')!.width, ui.container.querySelector('canvas')!.height])
    ui.unmount()
    bridge.dispose()
  })

  it('stacks each covered label\'s text under its layer\'s cover and over deeper ones; a label nothing is drawn over stays on top', async () => {
    const worker = new FakeWorker()
    const bridge = new CoreBridge(() => worker as unknown as Worker, { ready() {}, status() {}, halted() {} })
    worker.reply({ kind: 'ready' })
    // What the text layer measures: the text layer at (10, 20) on the page, each label's box and text at (30, 40), 60 x 20.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 10, y: 20, width: 0, height: 0 }))
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 30, y: 40, width: 60, height: 20 }))
    const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false} fixedZoom={2} />)
    await nextFrame()
    const answer = (text: object[]) => run(() => worker.reply({ id: worker.last().id, kind: 'frame', workerMs: 0, buf: vbf1(JSON.stringify({ problems: [],
      text, elements: [{ id: 'vb', scene: 's', x: 0, y: 0, w: 100, h: 100, firstVertex: 0, vertexCount: 0 }] })) }))
    // P is drawn first, under A and B; Q after A, under B; R (clipped) after both: on top.
    const at = { x0: 0, y0: 0, x1: 50, y1: 50 }
    gl.plan = [{ ...at, label: 0, cover: 0, first: 0, layer: 1 }, { ...at, label: 1, cover: 4, first: 6, layer: 0 }]
    await answer([label({ text: 'P' }), label({ text: 'Q' }), label({ text: 'R', clip: [0, 0, 50, 50] })])
    const text = ui.container.querySelector<HTMLElement>('.vb-text')!
    const z = () => Array.from(text.querySelectorAll<HTMLElement>('[data-label]'), e => [e.textContent, e.style.zIndex])
    expect(z()).toEqual([['P', '-4'], ['Q', '-2'], ['R', '']])
    expect(text.style.isolation).toBe('isolate')   // the labels' order stays among the labels: the overlays stay above
    const [cover] = gl.canvases
    expect(cover?.parentElement).toBe(text)
    expect(cover?.style.zIndex).toBe('-1')   // layer 0, under the labels nothing is drawn over
    const deeper = Array.from(text.querySelectorAll('canvas')).filter(c => c !== cover)
    expect(deeper.map(c => [c.width, c.height, c.style.zIndex, c.style.left, c.style.top, c.style.width, c.style.height]))
      .toEqual([[60, 100, '-3', '20px', '40px', '60px', '100px']])   // layer 1: over P's text, under Q's
    // The covers were given each label's box and text as measured, surface px (zoom 2).
    expect(gl.extents.at(-1)).toEqual([0, 1, 2].map(() => ({ x0: 10, y0: 10, x1: 40, y1: 20 })))
    // Nothing covered: the deeper canvas goes, and every label is on top again.
    gl.plan = []
    await nextFrame()
    await answer([label({ text: 'P' }), label({ text: 'Q' }), label({ text: 'R', clip: [0, 0, 50, 50] })])
    expect(z()).toEqual([['P', ''], ['Q', ''], ['R', '']])
    expect(text.querySelectorAll('canvas')).toHaveLength(1)
    ui.unmount()
    bridge.dispose()
  })

  it.each(['local', 'page'])('remeasures covers on %s font arrival and load, without pushing a scene', async source => {
    const own = Object.getOwnPropertyDescriptor(document, 'fonts'), faces = Object.assign(new EventTarget(), { add() {}, delete: () => true })
    Object.defineProperty(document, 'fonts', { configurable: true, value: faces })
    let finish!: () => void
    vi.stubGlobal('FontFace', class { loaded = new Promise<void>(r => { finish = r }); load() { return Promise.resolve(this) } })
    vi.stubGlobal('indexedDB', undefined)
    try {
      const worker = new FakeWorker()
      const font = source === 'local' ? 'Zed Display' : 'Zed Page Display'
      const bridge = new CoreBridge(() => worker as unknown as Worker, { ready() {}, status() {}, halted() {} })
      worker.reply({ kind: 'ready' })
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 10, y: 20, width: 0, height: 0 }))
      const range = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 30, y: 40, width: 60, height: 20 }))
      const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 100, h: 100 }} tag={false} fixedZoom={2} />)
      await nextFrame()
      gl.plan = [{ x0: 0, y0: 0, x1: 50, y1: 50, label: 0, cover: 0, first: 0, layer: 0 }]
      await run(() => worker.reply({ id: worker.last().id, kind: 'frame', workerMs: 0, buf: vbf1(JSON.stringify({ problems: [],
        text: [label({ text: 'P', font })], elements: [{ id: 'vb', scene: 's', x: 0, y: 0, w: 100, h: 100, firstVertex: 0, vertexCount: 0 }] })) }))
      expect(gl.extents.at(-1)).toEqual([{ x0: 10, y0: 10, x1: 40, y1: 20 }])
      const drawn = gl.covers.length
      // The same frame, its text laid out wider once a web font arrived.
      range.mockReturnValue(DOMRect.fromRect({ x: 30, y: 40, width: 100, height: 20 }))
      await run(() => { faces.dispatchEvent(Object.assign(new Event('loadingdone'), { fontfaces: [{ family: 'Liberation Sans' }] })) })
      expect(gl.extents.at(-1)).toEqual([{ x0: 10, y0: 10, x1: 60, y1: 20 }])
      expect(gl.covers).toHaveLength(drawn + 1)
      // And wider again in a face imported now.
      range.mockReturnValue(DOMRect.fromRect({ x: 30, y: 40, width: 140, height: 20 }))
      const pushed = worker.posted.filter(m => m.kind !== 'frame').length
      await run(async () => {
        if (source === 'local') await importFont(font, new ArrayBuffer(8), false)
        else registerPageFonts('zed-page', [{ family: 'CSS', style: 'normal', weight: '400', minWeight: 400, maxWeight: 400, representative: 'https://fonts.gstatic.com/zed.woff2', sources: [{ url: 'https://fonts.gstatic.com/zed.woff2', unicodeRange: 'U+0-FF', display: 'swap' }], metadata: { status: 'ok', names: {}, axes: [], faces: [], family: font, style: 'Regular', instances: [] } }])
      })
      expect(gl.extents.at(-1)).toEqual([{ x0: 10, y0: 10, x1: 80, y1: 20 }])
      expect(gl.covers).toHaveLength(drawn + 2)
      if (source === 'page') {
        range.mockReturnValue(DOMRect.fromRect({ x: 30, y: 40, width: 180, height: 20 }))
        await run(async () => { finish(); await Promise.resolve() })
        expect(gl.extents.at(-1)).toEqual([{ x0: 10, y0: 10, x1: 100, y1: 20 }])
        expect(gl.covers).toHaveLength(drawn + 3)
      }
      expect(worker.posted.filter(m => m.kind !== 'frame')).toHaveLength(pushed)
      const off = vi.spyOn(faces, 'removeEventListener')
      ui.unmount()
      bridge.dispose()
      expect(off.mock.calls.map(c => c[0])).toEqual(['loadingdone'])   // unmounted: no listener left behind
    } finally {
      await removeFont('Zed Display')
      if (own) Object.defineProperty(document, 'fonts', own)
      else delete (document as { fonts?: unknown }).fonts
    }
  })
})
it('portals view controls, exposes navigation and reports hover in current surface pixels', async () => {
  vi.stubGlobal('ResizeObserver', class { constructor(private cb: (entries: { contentRect: { width: number; height: number } }[]) => void) {} observe() { this.cb([{ contentRect: { width: 460, height: 460 } }]) } disconnect() {} })
  const bridge = { onFrame: () => () => {}, frame() {} } as unknown as CoreBridge
  const slot = document.createElement('div'); document.body.append(slot)
  const api: { current: ViewApi | null } = { current: null }, hover = vi.fn()
  const ui = mount(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} navigate viewSlot={slot} viewApi={api} onHover={hover} viewport={{ zoom: 2, pan: { x: 10, y: 20 } }} />)
  try {
    expect(slot.querySelector('[aria-label="Canvas view"]')).not.toBeNull()
    expect(ui.container.querySelector('[aria-label="Canvas view"]')).toBeNull()
    expect(slot.textContent).not.toContain('Space-drag')
    expect(api.current).not.toBeNull()
    const overlay = ui.container.querySelector<HTMLElement>('.vb-overlay')!
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 200 }))
    await run(() => { overlay.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 150, clientY: 260 })) })
    expect(hover).toHaveBeenLastCalledWith({ x: 20, y: 20 })
    await run(() => { overlay.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })) })
    expect(hover).toHaveBeenLastCalledWith(null)
    ui.rerender(<Canvas key="replacement" bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} navigate viewSlot={slot} viewApi={api} />)
    expect(api.current).not.toBeNull()
    const percent = () => Number(slot.querySelector<HTMLInputElement>('[aria-label="Zoom percent"]')!.value), fitted = percent()
    await run(() => api.current!.actual()); expect(percent()).toBe(100)
    await run(() => api.current!.fit()); expect(percent()).toBe(fitted)
    ui.rerender(<Canvas bridge={bridge} surface="main" size={{ w: 460, h: 460 }} tag={false} viewApi={api} />)
    expect(api.current).toBeNull()
  } finally { ui.unmount(); slot.remove() }
})
