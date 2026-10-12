import { CHECK_TIMEOUT_MS } from '../srctext/checker'

// Same boot allowance as CoreBridge: downloading/starting .NET is separate from reading untrusted font bytes.
export const METADATA_BOOT_TIMEOUT_MS = 60_000

export type FontAxis = { tag: string; min: number; default: number; max: number; name: string }
export type FontInstance = { family: string; style: string; axes: Record<string, number> }
export type FontFaceMetadata = { family: string; style: string; names: Record<number, string>; axes: FontAxis[]; instances: FontInstance[] }
export type MetadataResult = (({ status: 'ok'; faces: FontFaceMetadata[] } & FontFaceMetadata)
  | { status: 'invalid' | 'failed' | 'read-budget' | 'cancelled'; cause: string }) & { notes?: string[] | null }
export type MetadataRequest = { id: number; kind: 'metadata'; data: ArrayBuffer }
type Job = { id: number; data: ArrayBuffer; done: (result: MetadataResult) => void; signal?: AbortSignal; cancel: () => void }
const cancelled = (): MetadataResult => ({ status: 'cancelled', cause: 'the font metadata request was cancelled' })
const failed = (why: unknown): MetadataResult => ({ status: 'failed', cause: `the font metadata worker failed: ${why instanceof Error ? why.message : String(why)}` })

/** Independent of the chip worker. A killed runtime is created again only when another explicit job is queued.
 *  Callers abort requests when their link/project departs; cancelled promises settle and late replies are ignored. */
export class FontMetadataReader {
  private worker: Worker | null = null
  private ready = false
  private bootTimer: ReturnType<typeof setTimeout> | null = null
  private readonly queue: Job[] = []
  private current: { job: Job; timer: ReturnType<typeof setTimeout> } | null = null
  private nextId = 1
  private disposed = false

  constructor(private readonly makeWorker = () => new Worker(new URL('./fontMetadata.worker.ts', import.meta.url), { type: 'module' }),
    private readonly timeoutMs = CHECK_TIMEOUT_MS) {}

  read(data: ArrayBuffer, signal?: AbortSignal): Promise<MetadataResult> {
    if (this.disposed || signal?.aborted) return Promise.resolve(cancelled())
    const promise = new Promise<MetadataResult>(done => {
      const job: Job = { id: this.nextId++, data, done, signal, cancel: () => this.cancel(job) }
      signal?.addEventListener('abort', job.cancel, { once: true })
      this.queue.push(job)
    })
    this.pump()
    return promise
  }

  dispose() {
    this.disposed = true
    if (this.current) this.finish(cancelled(), true)
    this.kill()
    for (const job of this.queue.splice(0)) this.settle(job, cancelled())
  }

  private settle(job: Job, result: MetadataResult) { job.signal?.removeEventListener('abort', job.cancel); job.done(result) }
  private kill() {
    if (this.bootTimer !== null) clearTimeout(this.bootTimer)
    this.bootTimer = null
    this.worker?.terminate(); this.worker = null; this.ready = false
  }
  private bootFailed(result: MetadataResult) {
    this.kill()
    for (const job of this.queue.splice(0)) this.settle(job, result)
  }
  private crashed(why: unknown) {
    if (this.ready) this.finish(failed(why), true)
    else this.bootFailed(failed(why))
  }
  private cancel(job: Job) {
    if (this.current?.job === job) return this.finish(cancelled(), true)
    const i = this.queue.indexOf(job)
    if (i >= 0) { this.queue.splice(i, 1); this.settle(job, cancelled()) }
  }

  private start() {
    const w = this.makeWorker()
    w.onmessage = (e: MessageEvent<{ id?: number; kind?: string; why?: string; result?: MetadataResult }>) => {
      if (w !== this.worker) return
      if (e.data.kind === 'crashed') return this.crashed(e.data.why)
      if (e.data.kind === 'ready') {
        if (this.bootTimer !== null) clearTimeout(this.bootTimer)
        this.bootTimer = null
        this.ready = true
        this.pump()
        return
      }
      if (e.data.id !== this.current?.job.id || !e.data.result) return
      this.finish(e.data.result, e.data.result.status === 'read-budget')
    }
    w.onerror = e => { e.preventDefault(); if (w === this.worker) this.crashed(e.message) }
    w.onmessageerror = () => { if (w === this.worker) this.crashed('unreadable worker reply') }
    return w
  }

  private pump() {
    if (this.current || this.disposed || !this.queue.length) return
    if (!this.worker) {
      this.bootTimer = setTimeout(() => this.bootFailed(failed(`the metadata runtime did not become ready within ${METADATA_BOOT_TIMEOUT_MS / 1000} s`)), METADATA_BOOT_TIMEOUT_MS)
      try { this.worker = this.start() } catch (e) { this.bootFailed(failed(e)) }
    }
    if (!this.ready) return
    const job = this.queue.shift()!
    const timer = setTimeout(() => this.finish({ status: 'read-budget', cause: `too large to read names from here: reading took longer than ${this.timeoutMs / 1000} s` }, true), this.timeoutMs)
    this.current = { job, timer }
    try {
      // Copy into the worker: the caller still needs its bytes to register/persist a local font.
      this.worker!.postMessage({ id: job.id, kind: 'metadata', data: job.data } satisfies MetadataRequest)
    } catch (e) { this.finish(failed(e), true) }
  }

  private finish(result: MetadataResult, replace: boolean) {
    const now = this.current
    if (now) { clearTimeout(now.timer); this.current = null; this.settle(now.job, result) }
    if (replace) this.kill()
    // A microtask also avoids recursion if a series of worker constructions/posts throws.
    queueMicrotask(() => this.pump())
  }
}

let reader: FontMetadataReader | undefined
/** One async reader for TTF, OTF, collections and WOFF2; no network activity. */
export const readFontMetadata = (data: ArrayBuffer, signal?: AbortSignal): Promise<MetadataResult> => (reader ??= new FontMetadataReader()).read(data, signal)
