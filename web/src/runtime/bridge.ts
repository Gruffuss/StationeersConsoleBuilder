import { px } from '../model/shapes'
import { decodeFrame, type Frame } from './frame'

/** A double from the core: NaN and the infinities arrive as named literals (core/Wasm/Exports.cs, ruling P20). */
export type Num = number | 'NaN' | 'Infinity' | '-Infinity'
export type DeviceWrite = { ref: number; lt: number; slot: number; value: Num; stored: boolean }
// active: the surface the chip last activated; persist and memory: the chip's stores, only when they changed; writes: device
// writes since the last status (the Sim panel's log).
export type Status = { state: 'Running' | 'Halted'; error: string | null; instructions: number; output: string[]; active?: string
  persist?: Record<string, string>; memory?: Num[]; writes?: DeviceWrite[] }
export type Kind = 'boot' | 'load' | 'tick' | 'frame' | 'patch' | 'pointer' | 'visit' | 'sim' | 'readPicture' | 'readPictureBytes' | 'setImage'
/** A core picture read. `bytes`: a PNG or JPEG file for the browser to decode; `rgba`: BMP or GIF pixels, bottom row
 *  first. `error`: why the game would fail to load it; `note`: why only the preview does not show it. */
export type PictureResult = { format?: 'png' | 'jpeg' | 'bmp' | 'gif'; width: number; height: number; bytes?: Uint8Array<ArrayBuffer>; rgba?: Uint8Array<ArrayBuffer>
  error?: string; note?: string }
type PictureJob = { kind: 'readPicture' | 'readPictureBytes' | 'setImage'; message: object;
  resolve: (result?: PictureResult) => void; reject: (why: Error) => void }
export type PointerKind = 'down' | 'up' | 'move' | 'leave' | 'wheel'
type Op = { kind: 'pointer'; surface: string; x: number; y: number; type: PointerKind; dy: number; pointer: number }
  | { kind: 'visit'; page: string } | { kind: 'sim'; json: string }
// status: the reply to a load, a tick or a patch, and which of them it answers.
export type BridgeEvents = { ready(ms: number): void; status(s: Status, request: Kind, loadedFrom?: unknown): void; halted(why: string): void }
export type FrameTiming = { roundTripMs: number; workerMs: number }   // workerMs: measured by the worker around its Frame call

type Reply = { kind: 'ready' } | { kind: 'crashed'; why?: string } | { id: number; kind: 'status'; status: Status }
  | { id: number; kind: 'frame'; buf: ArrayBuffer; workerMs: number }
  | { id: number; kind: 'picture'; result: PictureResult } | { id: number; kind: 'imageSet' }

// The watchdog. Instruction metering cannot stop one long call (a huge string.rep, gsub backtracking, table.sort),
// a collectgarbage loop, a stack overflow or a wasm OOM, and a timer inside the busy worker never fires. So every
// request gets a timer here, on the main thread; a late reply or a crashed worker replaces the worker (a new runtime
// and an empty chip). The worker serves one request at a time, so a timer must not count time spent queued: nothing is
// sent while another request is in flight.
const LIMITS: Record<Kind, number> = { boot: 60_000, load: 10_000, tick: 2_000, frame: 2_000, patch: 2_000, pointer: 2_000, visit: 2_000, sim: 2_000,
  readPicture: 10_000, readPictureBytes: 10_000, setImage: 2_000 }
const TICK_MS = 500

// drawnFrom: the caller's own note of what the patch shows (App's: the page's scene), handed back with each frame.
type Patch = { surface: string; element: string; src: string; drawnFrom?: unknown }

const crash = (why?: string) => why ? `worker crashed: ${why}` : 'worker crashed'

// App callbacks must not break the bridge: one that throws is logged, and the bridge carries on.
function safely(f: () => void) {
  try { f() } catch (e) { console.error('CoreBridge: a callback threw', e) }
}

// What listeners get when the core's bytes do not decode: no geometry and one problem, as when the core's Frame fails.
// A restart would not help: the next frame would come from the same code.
const failedFrame = (message: string): Frame => ({ positions: new Float32Array(), coverage: new Float32Array(),
  colours: new Uint8Array(), indices: new Uint32Array(), spans: new Int32Array(), elements: [], text: [],
  problems: [{ element: -1, message }] })

export class CoreBridge {
  private worker: Worker | null = null
  private readonly limits: Record<Kind, number>
  // id 0 is the boot; `surface`: a frame's, so its listeners know which surface it shows
  private readonly pending = new Map<number, { kind: Kind; sent: number; timer: ReturnType<typeof setTimeout>; surface?: string;
    drawnFrom?: unknown; loadedFrom?: unknown }>()
  private nextId = 1
  private queuedLoad: { lua: string; w: number; h: number; sizes: string; host: string | (() => string) } | null = null
  private queuedLoadFrom: unknown
  private sentLoadFrom: unknown
  private queuedFrom: Record<string, unknown> = {}   // the queued load's drawnFrom, per surface
  // What each surface was last loaded or patched with, as the caller noted it (drawnFrom), as sent. The worker serves one
  // request at a time and a frame goes only when nothing is in flight, so a frame shows exactly what was sent before it
  // was asked for: it carries its surface's note (Frame.drawnFrom), whatever was queued meanwhile. A new chip holds nothing.
  private sentFrom = new Map<string, unknown>()
  private readonly patches = new Map<string, Patch>()  // by (surface, element), latest wins
  private ops: Op[] = []
  private pictureJobs: PictureJob[] = []
  private pictureReplies = new Map<number, PictureJob>()
  private tickDue = false
  private readonly listeners = new Set<(f: Frame, t: FrameTiming, surface: string) => void>()
  private readonly ticker: ReturnType<typeof setInterval>
  private everReady = false
  private retried = false  // a boot after a restart failed once and was retried
  private isReady = false
  private isRunning = false  // the chip has a program and has not halted, so it gets ticks
  private lastPatchMs: number | null = null
  // A frame asked for while one could not go, and whether the last reply was a patch's: patches go before frames, so
  // during a drag whose patch round trip is longer than an animation frame, one frame goes between two patches.
  private wanted: { surface: string; scale: number; tag: boolean } | null = null
  private afterPatch = false
  private disposed = false

  constructor(private readonly makeWorker: () => Worker, private readonly events: BridgeEvents,
              limits: Partial<Record<Kind, number>> = {}) {
    this.limits = { ...LIMITS, ...limits }
    this.ticker = setInterval(() => { if (this.isRunning) { this.tickDue = true; this.pump() } }, TICK_MS)
    this.start()
  }

  get ready() { return this.isReady }
  get running() { return this.isRunning }
  get patchMs() { return this.lastPatchMs }

  /** `size`: what ui:size() answers for a surface not in `sizes` (each surface's own, in px); `drawnFrom`: what each
   *  surface shows, as the caller notes it (kept here, never sent), handed back with its frames until a patch says else.
   *  loadedFrom: the loaded program's note (for example its line map), carried with every status from that program.
   *  A host callback runs just before sending, after the preceding status has delivered the chip's latest stores. */
  load(lua: string, size: { w: number; h: number }, sizes: Record<string, { w: number; h: number }> = {}, drawnFrom: Record<string, unknown> = {}, host: string | (() => string) = '', loadedFrom?: unknown) {
    const each = JSON.stringify(Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, [px(v.w), px(v.h)]])))
    this.queuedLoad = { lua, w: size.w, h: size.h, sizes: each, host }
    this.queuedFrom = drawnFrom
    this.queuedLoadFrom = loadedFrom
    this.ops = []
    this.patches.clear()  // the load carries the latest scenes: an older patch sent after it would undo an edit
    this.pump()
  }

  frame(surface: string, scale: number, tag: boolean) {
    if (this.isReady && this.pending.size === 0 && this.patches.size === 0) this.send('frame', { surface, scale, tag })
    else this.wanted = { surface, scale, tag }
  }

  /** `drawnFrom`: what the surface shows once this patch lands, as the caller notes it (kept here, never sent); without
   *  one, the surface keeps its note. */
  patch(surface: string, element: string, src: string, drawnFrom?: unknown) {
    this.patches.set(JSON.stringify([surface, element]), { surface, element, src, drawnFrom })
    this.pump()
  }

  /** Play mode's pointer, in surface px; dy: wheel notches, up positive. A move replaces a queued move of the same pointer. */
  pointer(surface: string, x: number, y: number, type: PointerKind, dy = 0, pointer = 0) {
    const op: Op = { kind: 'pointer', surface, x, y, type, dy, pointer }, last = this.ops[this.ops.length - 1]
    if (type === 'move' && last?.kind === 'pointer' && last.type === 'move' && last.surface === surface && last.pointer === pointer) this.ops[this.ops.length - 1] = op
    else this.ops.push(op)
    this.pump()
  }
  /** The builder visits a page (edit-mode page selection): the chip builds and shows it in its next tick. */
  visit(page: string) { this.ops.push({ kind: 'visit', page }); this.pump() }
  /** A live change of simulated values (core/Core/HostConfig.cs SimJson), with no reload. */
  sim(json: string) { this.ops.push({ kind: 'sim', json }); this.pump() }

  readPicture(src: string): Promise<PictureResult> { return this.picture('readPicture', { src }) as Promise<PictureResult> }
  readPictureBytes(bytes: Uint8Array): Promise<PictureResult> { return this.picture('readPictureBytes', { bytes }) as Promise<PictureResult> }
  async setImage(src: string, width: number, height: number, error: string | null) { await this.picture('setImage', { src, width, height, error }) }
  private picture(kind: PictureJob['kind'], message: object) {
    return new Promise<PictureResult | undefined>((resolve, reject) => {
      if (this.disposed) { reject(new Error('bridge disposed')); return }
      this.pictureJobs.push({ kind, message, resolve, reject }); this.pump()
    })
  }

  /** `surface`: the surface the frame was asked for. */
  onFrame(cb: (f: Frame, t: FrameTiming, surface: string) => void) {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  dispose() {
    this.disposed = true
    clearInterval(this.ticker)
    this.stop()
    this.listeners.clear()
  }

  private start() {
    if (this.disposed) return
    const started = performance.now()
    const w = this.makeWorker()
    this.worker = w
    this.watch(0, 'boot')
    // Every handler ignores a replaced worker: a second crash signal (onAbort and onExit both post one, and an error
    // event can follow) or a late reply must not touch the new worker.
    w.onmessage = (e: MessageEvent<Reply>) => {
      if (w !== this.worker) return
      const m = e.data
      if (m.kind === 'crashed') return this.restart(crash(m.why))
      if (m.kind === 'ready') {
        this.answered(0)
        this.isReady = this.everReady = true
        this.retried = false
        this.pump()
        safely(() => this.events.ready(performance.now() - started))
        return
      }
      const { kind, surface = '', drawnFrom, loadedFrom } = this.pending.get(m.id)!
      if (m.kind === 'status') {
        this.isRunning = m.status.state === 'Running'
        // Keep the request pending during the callback: its frames cannot overtake queued work.
        safely(() => loadedFrom === undefined ? this.events.status(m.status, kind) : this.events.status(m.status, kind, loadedFrom))
      }
      const ms = this.answered(m.id)
      if (m.kind === 'picture' || m.kind === 'imageSet') {
        this.pictureReplies.get(m.id)?.resolve(m.kind === 'picture' ? m.result : undefined)
        this.pictureReplies.delete(m.id)
        this.pump()
        return
      }
      if (kind === 'patch') this.lastPatchMs = ms
      this.afterPatch = kind === 'patch'
      this.pump()  // before the listeners, so a frame() they make cannot overtake a pending patch or a due tick
      if (m.kind === 'status') return
      let f: Frame
      try { f = decodeFrame(m.buf) }
      catch (e) { f = failedFrame(`frame decode failed: ${e instanceof Error ? e.message : e}`) }
      f.drawnFrom = drawnFrom
      for (const cb of this.listeners) safely(() => cb(f, { roundTripMs: ms, workerMs: m.workerMs }, surface))
    }
    w.onerror = (e: ErrorEvent) => { if (w === this.worker) this.restart(crash(e.message)) }
    w.onmessageerror = () => { if (w === this.worker) this.restart(crash('a reply could not be read')) }
  }

  // Sends what is waiting, one request at a time: a queued load, then pending patches (after a patch, a frame asked for
  // since goes first), then a due tick, then pointer, visit and sim operations in order.
  private pump() {
    if (this.disposed || !this.isReady || this.pending.size > 0) return
    if (this.queuedLoad) {
      this.sentLoadFrom = this.queuedLoadFrom
      const { host, ...load } = this.queuedLoad
      let prepared: string
      try { prepared = typeof host === 'function' ? host() : host }
      catch (e) {
        this.queuedLoad = null
        safely(() => this.events.halted('CoreBridge: load host could not be prepared: ' + (e instanceof Error ? e.message : String(e))))
        return
      }
      this.send('load', { ...load, host: prepared })
      this.sentFrom = new Map(Object.entries(this.queuedFrom))
      this.queuedLoad = null
      this.tickDue = this.isRunning = false  // the old chip is gone: its ticks are not the new chip's
      return
    }
    if (this.afterPatch && this.wanted) {
      this.send('frame', this.wanted)
      return
    }
    const [key] = this.patches.keys()
    if (key !== undefined) {
      const { drawnFrom, ...p } = this.patches.get(key)!
      this.send('patch', p)
      if (drawnFrom !== undefined) this.sentFrom.set(p.surface, drawnFrom)
      this.patches.delete(key)
      return
    }
    const picture = this.pictureJobs.shift()
    if (picture) {
      this.pictureReplies.set(this.send(picture.kind, picture.message), picture)
      return
    }
    if (this.tickDue) {
      this.tickDue = false
      if (this.isRunning) { this.send('tick', {}); return }
    }
    const op = this.ops.shift()
    if (op) {
      const { kind, ...message } = op
      this.send(kind, message)
      return
    }
  }

  private send(kind: Exclude<Kind, 'boot'>, message: object) {
    const id = this.nextId++
    if (kind === 'frame') this.wanted = null
    this.watch(id, kind, kind === 'frame' ? (message as { surface: string }).surface : undefined)
    this.worker!.postMessage({ id, kind, ...message })
    return id
  }

  private watch(id: number, kind: Kind, surface?: string) {
    this.pending.set(id, { kind, sent: performance.now(), timer: setTimeout(() => this.restart('timeout'), this.limits[kind]), surface,
      drawnFrom: surface === undefined ? undefined : this.sentFrom.get(surface), loadedFrom: this.sentLoadFrom })
  }

  /** Clears the request's timer and returns its round trip in ms. */
  private answered(id: number) {
    const p = this.pending.get(id)!
    clearTimeout(p.timer)
    this.pending.delete(id)
    return performance.now() - p.sent
  }

  private stop(why = 'bridge disposed') {
    for (const p of [...this.pictureJobs, ...this.pictureReplies.values()]) p.reject(new Error(why))
    this.pictureJobs = []
    this.pictureReplies.clear()
    this.worker?.terminate()
    this.worker = null
    this.sentFrom.clear()
    this.sentLoadFrom = undefined
    for (const p of this.pending.values()) clearTimeout(p.timer)
    this.pending.clear()
    this.isReady = this.isRunning = false
  }

  // The request that caused the restart is not re-sent; a load still queued behind it survives, with the patches made
  // after it. Without one, the new chip is empty and there is nothing to patch.
  private restart(why: string) {
    if (this.disposed) return
    const wasReady = this.isReady
    this.stop(why)
    if (!this.queuedLoad) this.patches.clear()
    if (!this.queuedLoad) this.ops = []
    if (wasReady) {
      safely(() => this.events.halted(why))
      this.start()
    }
    // A core that never came up would fail the same way again: say so instead of restarting in a loop.
    else if (!this.everReady) safely(() => this.events.halted(`the core failed to start (${why})`))
    else if (!this.retried) {
      this.retried = true
      this.start()
    }
    else safely(() => this.events.halted(`the core failed to restart (${why})`))
  }
}
