import type { Project } from '../model/project'
import { pack, unpack, type Wire } from '../srctext/wire'
import { PROJECT_KEYS } from './codec'
import type { Body, ForeignLua, Request, Sources } from './transfer.worker'

const INCOMPLETE = 'Project transfer could not complete here; use the original JSON file'
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const badReply = () => new Error('Project transfer returned an unreadable reply; use the original JSON file')
type Job = { request: Request; resolve: (v: unknown) => void; reject: (e: Error) => void; cleanup?: () => void }
const aborted = () => new DOMException('Project read was aborted', 'AbortError')

/** Validate the flat grammar before unpack can allocate or read it. There is no size/depth budget here. */
function wire(v: unknown): v is Wire {
  if (!object(v) || !Array.isArray(v.shape) || !Array.isArray(v.atoms)) return false
  let s = 0, a = 0, pending = 1
  while (pending && s < v.shape.length) {
    const code = v.shape[s++]
    pending--
    if (code === 0) {
      if (a === v.atoms.length) return false
      const atom = v.atoms[a++]
      if (atom !== null && atom !== undefined && !['string', 'number', 'boolean'].includes(typeof atom)) return false
    } else if (code === 1 || code === 2) {
      const n = v.shape[s++]
      if (!Number.isSafeInteger(n) || n < 0) return false
      pending += n
      if (!Number.isSafeInteger(pending)) return false
      if (code === 2) {
        if (a + n > v.atoms.length) return false
        const keys = new Set<string>()
        for (let k = 0; k < n; k++) {
          const key = v.atoms[a++]
          if (typeof key !== 'string' || keys.has(key)) return false
          keys.add(key)
        }
      }
    } else return false
  }
  return pending === 0 && s === v.shape.length && a === v.atoms.length
}

// pack accepts plain acyclic data. Check its trust boundary first so a wrong model cannot hang its iterative walk.
function projectWire(p: Project): Wire {
  const root = Object.fromEntries(PROJECT_KEYS.filter(k => Object.hasOwn(p, k)).map(k => [k, p[k]]))
  const active = new Set<object>(), todo: { value?: unknown; exit?: object }[] = [{ value: root }]
  while (todo.length) {
    const f = todo.pop()!
    if (f.exit) { active.delete(f.exit); continue }
    const v = f.value
    if (v !== null && typeof v === 'object') {
      if (active.has(v)) throw new Error('Project contains a cycle')
      active.add(v)
      todo.push({ exit: v })
      for (const x of Array.isArray(v) ? v : Object.values(v)) todo.push({ value: x })
    } else if (!['undefined', 'string', 'number', 'boolean'].includes(typeof v) && v !== null)
      throw new Error('Project contains non-data values')
  }
  return pack(root)
}

export class ProjectTransfer {
  private worker: Worker | null = null
  private current: { job: Job; timer: ReturnType<typeof setTimeout> } | null = null
  private queue: Job[] = []
  private nextId = 1
  private disposed = false

  constructor(private readonly makeWorker: () => Worker, private readonly timeoutMs = 10_000) {}

  async text(p: Project): Promise<string> { return this.ask({ kind: 'text', project: projectWire(p) }) }
  async compress(p: Project): Promise<string> { return this.ask({ kind: 'compress', project: projectWire(p) }) }
  async sources(p: Project): Promise<Sources> { return this.ask({ kind: 'sources', project: projectWire(p) }) }
  read(input: string | Blob, kind: 'json' | 'token', signal?: AbortSignal): Promise<{ project: Project; notice: string }>
  read(input: string | Blob, kind: 'json' | 'token' | 'lua', signal?: AbortSignal): Promise<{ project: Project; notice: string } | ForeignLua>
  read(input: string | Blob, kind: 'json' | 'token' | 'lua', signal?: AbortSignal): Promise<{ project: Project; notice: string } | ForeignLua> {
    return this.ask({ kind: 'read', format: kind, text: input }, signal)
  }
  dispose(): void { this.disposed = true; this.fail(new Error('Project transfer was stopped')) }

  private ask<T>(body: Body, signal?: AbortSignal): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Project transfer was disposed'))
    if (signal?.aborted) return Promise.reject(aborted())
    return new Promise((resolve, reject) => {
      const job: Job = { request: { ...body, id: this.nextId++ }, resolve: resolve as (v: unknown) => void, reject }
      if (signal) {
        const abort = () => this.cancel(job)
        signal.addEventListener('abort', abort, { once: true })
        job.cleanup = () => signal.removeEventListener('abort', abort)
      }
      this.queue.push(job)
      this.pump()
    })
  }

  private cancel(job: Job): void {
    if (this.current?.job === job) {
      const worker = this.worker
      this.worker = null
      worker?.terminate()
      this.finish(undefined, aborted())
    } else {
      const i = this.queue.indexOf(job)
      if (i < 0) return
      this.queue.splice(i, 1)
      job.cleanup?.()
      job.reject(aborted())
    }
  }

  private start(): Worker {
    const w = this.makeWorker()
    w.onmessage = event => {
      if (w !== this.worker || !this.current) return
      const reply: unknown = event.data
      if (!object(reply) || !Number.isSafeInteger(reply.id)) return this.fail(badReply())
      if (reply.id !== this.current.job.request.id) return
      if (reply.ok === false && typeof reply.message === 'string') return this.finish(undefined, new Error(reply.message))
      if (reply.ok !== true) return this.fail(badReply())
      const kind = this.current.job.request.kind, value = reply.value
      if (kind === 'text' || kind === 'compress') {
        if (typeof value !== 'string') return this.fail(badReply())
        this.finish(value)
      } else if (kind === 'sources') {
        if (!Array.isArray(value) || value.some(x => !object(x) || typeof x.page !== 'string' || typeof x.src !== 'string')) return this.fail(badReply())
        this.finish(value)
      } else {
        if (this.current.job.request.kind === 'read' && this.current.job.request.format === 'lua' && object(value) && value.kind === 'foreign') {
          if (typeof value.lua !== 'string') return this.fail(badReply())
          return this.finish({ kind: 'foreign', lua: value.lua })
        }
        if (!object(value) || typeof value.notice !== 'string' || !wire(value.project)) return this.fail(badReply())
        const project = unpack(value.project)
        if (!object(project) || project.version !== 1 || typeof project.name !== 'string' || !Array.isArray(project.pages) || !project.pages.length)
          return this.fail(badReply())
        this.finish({ project, notice: value.notice })
      }
    }
    w.onerror = event => {
      event.preventDefault()
      if (w === this.worker) this.fail(new Error('Project transfer failed: ' + (event.message || 'worker error')))
    }
    w.onmessageerror = () => { if (w === this.worker) this.fail(new Error('Project transfer failed to receive a worker message')) }
    return w
  }

  private pump(): void {
    if (this.current || !this.queue.length || this.disposed) return
    try { this.worker ??= this.start() } catch (e) { this.fail(new Error('Project transfer failed: ' + message(e))); return }
    const job = this.queue.shift()!
    this.current = { job, timer: setTimeout(() => this.fail(new Error(INCOMPLETE)), this.timeoutMs) }
    try { this.worker.postMessage(job.request) } catch (e) { this.fail(new Error('Project transfer failed: ' + message(e))) }
  }

  private finish(value?: unknown, error?: Error): void {
    const now = this.current!
    clearTimeout(now.timer)
    this.current = null
    now.job.cleanup?.()
    if (error) now.job.reject(error)
    else now.job.resolve(value)
    this.pump()
  }

  private fail(error: Error): void {
    if (this.current) clearTimeout(this.current.timer)
    this.worker?.terminate()
    this.worker = null
    const jobs = this.current ? [this.current.job, ...this.queue] : this.queue
    this.current = null
    this.queue = []
    for (const job of jobs) { job.cleanup?.(); job.reject(error) }
  }
}

const message = (e: unknown) => e instanceof Error ? e.message : String(e)
