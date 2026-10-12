export type ExportPage = { id: string; surface: string; src: string; empty: boolean; w: number; h: number }
export type ExportIssue = { level: 'error' | 'warning' | 'info'; message: string; page?: string | null; node?: number | null; key?: string | null }
export type ExportReport = { complete: boolean; issues: ExportIssue[]; loadInstructions: number; worstTickInstructions: number; ticks: number; visited: string[] }

const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const count = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
const optionalText = (x: unknown) => x == null || typeof x === 'string'
function isReport(x: unknown): x is ExportReport {
  return object(x) && typeof x.complete === 'boolean' && count(x.loadInstructions) && count(x.worstTickInstructions) && count(x.ticks)
    && Array.isArray(x.visited) && x.visited.every(p => typeof p === 'string')
    && Array.isArray(x.issues) && x.issues.every(i => object(i) && ['error', 'warning', 'info'].includes(i.level as string)
      && typeof i.message === 'string' && optionalText(i.page) && optionalText(i.key) && (i.node == null || count(i.node)))
}
const incomplete = (reason: string): ExportReport => ({ complete: false, issues: [{ level: 'info', message: reason }],
  loadInstructions: 0, worstTickInstructions: 0, ticks: 0, visited: [] })

/** One disposable runtime, independent of CoreBridge's preview and the reusable metadata runtime. */
export function checkExport(makeWorker: () => Worker, request: { lua: string; host: string; pages: ExportPage[] }, signal?: AbortSignal): Promise<ExportReport> {
  if (signal?.aborted) return Promise.resolve(incomplete('Export checking cancelled'))
  return new Promise(resolve => {
    let worker: Worker | undefined, done = false, ready = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (report: ExportReport) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate() }
      resolve(report)
    }
    const fail = (why: unknown) => finish(incomplete(`Export check could not complete: ${why instanceof Error ? why.message : String(why)}`))
    const cancel = () => finish(incomplete('Export checking cancelled'))
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      // Capture the artifact before boot; edits while the worker starts cannot change these bytes.
      const message = { id: 1, kind: 'checkExport', lua: request.lua, host: request.host, pages: JSON.stringify(request.pages) }
      const checkMs = 10_000 + 2_000 * Math.max(20, 2 * request.pages.length)
      timer = setTimeout(() => fail('the export runtime did not become ready within the 60-second boot allowance'), 60_000)
      worker = makeWorker()
      if (done) { worker.terminate(); return }
      worker.onmessage = (e: MessageEvent<unknown>) => {
        if (done) return
        const m = e.data
        if (!object(m)) return fail('unreadable worker reply')
        if (m.kind === 'crashed') return fail(m.why ?? 'the runtime crashed')
        if (m.kind === 'ready') {
          if (ready) return
          ready = true
          clearTimeout(timer)
          timer = setTimeout(() => fail(`export checking took longer than the ${checkMs / 1000}-second check allowance`), checkMs)
          try { worker!.postMessage(message) } catch (e) { fail(e) }
          return
        }
        if (!ready || m.kind !== 'exportReport' || m.id !== message.id || !isReport(m.report)) return fail('malformed export report reply')
        finish(m.report)
      }
      worker.onerror = e => { e.preventDefault(); fail(e.message) }
      worker.onmessageerror = () => fail('unreadable worker reply')
    } catch (e) { fail(e) }
  })
}
