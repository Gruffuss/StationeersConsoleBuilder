// Test helpers, imported by tests only.
import type { Scene } from '../model/scene'
import { answer, checkScene, type Checked, type CheckRequest } from './check'
import { unpack } from './wire'

/** What the checker says about a scene, as messages: its errors, then its warnings (the traps among them). */
export const problemsOf = (scene: Scene): string[] => { const c = checkScene(scene); return [...c.errors, ...c.warnings].map(i => i.message) }

/**
 * A check worker that answers as check.worker.ts does (its `answer`), or with `verdict` in place of the check, on the next
 * microtask. While `held`, scenes wait for `release()`. Hand it over as `w as unknown as Worker`.
 */
export class FakeCheckWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  terminated = false
  held = false
  readonly waiting: CheckRequest[] = []
  constructor(public verdict?: (s: Scene) => Checked) {}
  postMessage(m: CheckRequest) {
    this.waiting.push(m)
    queueMicrotask(() => { if (!this.held) this.release() })
  }
  /** Answers every scene waiting. */
  release() {
    for (const m of this.waiting.splice(0)) {
      this.onmessage?.({ data: this.verdict ? { id: m.id, checked: this.verdict(unpack(m.scene) as Scene) } : answer(m) } as MessageEvent)
    }
  }
  terminate() { this.terminated = true }
}

/** A makeCheckWorker that keeps every worker it makes in `made`; `verdict` as FakeCheckWorker's. */
export function checkWorkers(verdict?: (s: Scene) => Checked) {
  const made: FakeCheckWorker[] = []
  return { made, make: () => { const w = new FakeCheckWorker(verdict); made.push(w); return w as unknown as Worker } }
}
