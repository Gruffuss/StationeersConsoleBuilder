// The main thread's side of scene checks (check.worker.ts). One request at a time; each has CHECK_TIMEOUT_MS from when
// it is posted, after which the worker is replaced and the scene is reported as too large to check here (never as
// invalid), so no scene can freeze the editor. Results are cached per Scene object: the store never mutates one. A
// scene is posted packed (wire.ts), so its depth never meets structured clone's.
// ponytail: first in, first out: every scene asked for is checked, a drag's intermediate ones included. On a
// 2,000-node page in the browser there was no backlog at release (docs/m2c.md); in a harness whose check takes longer
// than a pointer step it grows, and the frames App patches meanwhile trail by it. Drop superseded scenes (a page's
// scenes nobody awaits but App) if a browser drag ever shows one.
import type { Order } from '../model/numbering'
import type { Scene } from '../model/scene'
import { invalid, tooLarge, type Checked, type CheckRequest } from './check'
import { pack } from './wire'

export const CHECK_TIMEOUT_MS = 5000
/** Workers in a row that fail with no answer before the checker stops: a script that never loads is not respawned forever. */
export const MAX_FAILURES = 3
const STOPPED = 'the checker was stopped'
const failed = (e: unknown) => `the scene could not be checked: ${e instanceof Error ? e.message : String(e)}`

type Job = { id: number; scene: Scene; done: (c: Checked) => void }

export class SceneChecker {
  private worker: Worker
  private readonly results = new WeakMap<Scene, Checked>()
  private readonly asked = new WeakMap<Scene, Promise<Checked>>()
  private readonly queue: Job[] = []
  private current: { job: Job; timer: ReturnType<typeof setTimeout> } | null = null
  private nextId = 1
  private stopped: string | null = null   // why the checker stopped, once it has
  private failures = 0   // workers in a row that failed before answering anything
  private readonly listeners = new Set<() => void>()
  version = 0

  constructor(private readonly makeWorker: () => Worker, private readonly timeoutMs = CHECK_TIMEOUT_MS) {
    this.worker = this.start()
  }

  get(scene: Scene) { return this.results.get(scene) }

  check(scene: Scene): Promise<Checked> {
    if (this.stopped !== null) return Promise.resolve(invalid(this.stopped))
    const known = this.asked.get(scene)
    if (known) return known
    const p = new Promise<Checked>(done => this.queue.push({ id: this.nextId++, scene, done }))
    this.asked.set(scene, p)
    this.pump()
    return p
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  /** Stops the worker. Every check still waiting resolves as invalid, so no caller waits forever; disposed, nothing is
   *  cached or announced (no one is listening). */
  dispose() { this.stop(STOPPED, false) }

  // A checker that stops by itself (no worker can be made, or none loads) caches and announces every waiting scene's
  // verdict, so the page says why instead of waiting.
  private stop(why: string, announce = true) {
    this.stopped = why
    if (this.current) clearTimeout(this.current.timer)
    this.worker.terminate()
    const jobs = [...(this.current ? [this.current.job] : []), ...this.queue]
    this.current = null
    this.queue.length = 0
    for (const job of jobs) {
      if (announce) this.results.set(job.scene, invalid(why))
      job.done(invalid(why))
    }
    if (announce && jobs.length) { this.version++; for (const f of this.listeners) f() }
  }

  private start() {
    const w = this.makeWorker()
    w.onmessage = (e: MessageEvent<{ id: number; checked: Checked }>) => {
      if (w === this.worker) this.failures = 0
      if (w === this.worker && this.current?.job.id === e.data.id) this.finish(e.data.checked, false)
    }
    // A failure with no scene in flight (a script that does not load) replaces the worker too, so the next scene is not
    // posted to a dead one and timed out as too large; MAX_FAILURES in a row with no answer between stop the checker.
    w.onerror = e => {
      e.preventDefault()
      if (w !== this.worker) return
      const why = failed(e.message || 'the checker failed')
      if (++this.failures >= MAX_FAILURES) return this.stop(why)
      this.finish(invalid(why), true)
    }
    return w
  }

  // Posts the next scene while none is in flight. A post that throws (out of memory) settles its scene as invalid, not
  // the editor stuck, and the loop goes on to the next.
  private pump() {
    while (!this.current && this.queue.length && this.stopped === null) {
      const job = this.queue.shift()!
      const timer = setTimeout(() => this.finish(tooLarge(`checking took longer than ${this.timeoutMs / 1000} s`), true), this.timeoutMs)
      this.current = { job, timer }
      try {
        this.worker.postMessage({ id: job.id, scene: pack(job.scene) } satisfies CheckRequest)
      } catch (e) {
        this.settle(invalid(failed(e)))
      }
    }
  }

  // The scene in flight gets `c`: cached, its caller answered and the listeners told.
  private settle(c: Checked) {
    const now = this.current
    if (!now) return
    clearTimeout(now.timer)
    this.current = null
    this.results.set(now.job.scene, c)
    now.job.done(c)
    this.version++
    for (const f of this.listeners) f()
  }

  // Settles the scene in flight first, so a worker that cannot be replaced still answers its caller; then, if `replace`,
  // a new worker (one that cannot be made stops the checker); then the next scene.
  private finish(c: Checked, replace: boolean) {
    this.settle(c)
    if (replace) {
      this.worker.terminate()
      try { this.worker = this.start() } catch (e) { return this.stop(failed(e)) }
    }
    this.pump()
  }
}

/**
 * The numbering to read a page's parse indices with; `memory` keeps each page's last clean one. It is the page scene's
 * own once its check landed clean, else (pending, too large to check here, invalid) the last clean one: a drag only
 * moves numbers, so that numbering still holds while its steps are checked, and the frame on the canvas is of a scene
 * that checked clean.
 */
export function orderOf(memory: Map<string, Order>, pageId: string, c: Checked | undefined): Order | undefined {
  if (c?.src != null) memory.set(pageId, c.order)
  return memory.get(pageId)
}
