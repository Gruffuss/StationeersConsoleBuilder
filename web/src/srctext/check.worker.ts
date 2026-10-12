// check.worker.ts — one scene per message, packed (wire.ts), answered with its id (check.ts's `answer`).
import { answer, type CheckRequest } from './check'
self.onmessage = (e: MessageEvent<CheckRequest>) => self.postMessage(answer(e.data))
export {}
