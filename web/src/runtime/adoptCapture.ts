import { readCapture, type Capture } from '../project/adopt'

/** A disposable runtime: it never executes the source on the preview's chip. */
export function captureScript(makeWorker: () => Worker, req: { lua: string; size: { w: number; h: number } }, signal?: AbortSignal): Promise<Capture | { incomplete: string }> {
  if (signal?.aborted) return Promise.resolve({ incomplete: 'Script capture cancelled; the current project is kept.' })
  return new Promise(resolve => {
    let worker: Worker | undefined, done = false, ready = false, timer: ReturnType<typeof setTimeout> | undefined
    const finish = (report: Capture | { incomplete: string }) => {
      if (done) return
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel)
      if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate() }
      resolve(report)
    }
    const fail = (why: unknown) => finish({ incomplete: 'Script capture could not complete: ' + String(why) + '; the current project is kept.' })
    const cancel = () => finish({ incomplete: 'Script capture cancelled; the current project is kept.' })
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      const message = { id: 1, kind: 'captureScript', lua: req.lua, w: req.size.w, h: req.size.h, host: '', allowanceMs: 10000 }
      timer = setTimeout(() => fail('the runtime did not become ready within the 60-second boot allowance'), 60000)
      worker = makeWorker()
      if (done) { worker.terminate(); return }
      worker.onmessage = (e: MessageEvent<unknown>) => {
        if (!e.data || typeof e.data !== 'object' || Array.isArray(e.data)) return fail('unreadable worker reply')
        const m = e.data as Record<string, unknown>
        if (m.kind === 'crashed') return fail(m.why ?? 'runtime crashed')
        if (m.kind === 'ready') {
          if (ready) return
          ready = true; clearTimeout(timer)
          timer = setTimeout(() => fail('capture exceeded its 60-second watchdog'), 60000)
          try { worker!.postMessage(message) } catch (e) { fail(e) }
          return
        }
        if (!ready || m.id !== 1 || m.kind !== 'captureReport') return fail('malformed capture reply')
        try { finish(readCapture(m.report)) } catch (e) { fail(e) }
      }
      worker.onerror = e => { e.preventDefault(); fail(e.message) }
      worker.onmessageerror = () => fail('unreadable worker reply')
    } catch (e) { fail(e) }
  })
}
