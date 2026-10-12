// Test helpers, imported by tests only: DOM ones (happy-dom) and a fake IndexedDB.
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Renders `ui` into a fresh container in the document, effects flushed. */
export function mount(ui: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(ui))
  return {
    container,
    rerender: (next: ReactNode) => act(() => root.render(next)),
    unmount: () => { act(() => root.unmount()); container.remove() },
  }
}

/** Runs `f` (an event, a worker reply) inside act, so React has rendered and run its effects when this resolves. */
export const run = async (f: () => void | Promise<void>) => { await act(async () => { await f() }) }

/**
 * Just enough IndexedDB for fonts.ts: one database of one store keyed by name. Each request succeeds and its
 * transaction completes a task later; with `fail`, each request succeeds and its transaction then aborts (a full disk,
 * blocked storage), undoing its writes.
 */
export function idb(fail = false) {
  const records = new Map<string, { name: string; data: ArrayBuffer }>()
  const later = (f: () => void) => setTimeout(f)
  type Handlers = { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void; oncomplete?: () => void; onabort?: () => void }
  const db = {
    createObjectStore() {},
    close() {},
    transaction() {
      const tx: Handlers & { objectStore(): unknown } = {
        objectStore: () => ({
          put: (v: { name: string; data: ArrayBuffer }) => request(() => { records.set(v.name, v); return v.name }),
          delete: (k: string) => request(() => { records.delete(k) }),
          getAll: () => request(() => [...records.values()]),
        }),
      }
      const request = (run: () => unknown) => {
        const r: Handlers = {}
        // A request can succeed and its transaction still abort (a full disk at commit): fail mode does that, and rolls back.
        later(() => {
          const before = new Map(records)
          r.result = run()
          r.onsuccess?.()
          if (!fail) return tx.oncomplete?.()
          records.clear()
          for (const [k, v] of before) records.set(k, v)
          tx.onabort?.()
        })
        return r
      }
      return tx
    },
  }
  const open = () => { const req: Handlers = {}; later(() => { req.result = db; req.onupgradeneeded?.(); req.onsuccess?.() }); return req }
  return { records, factory: { open } }
}

/** Project storage fake: requests run in tasks, writes commit atomically, and overlapping transactions serialize. */
export function projectDb(options: {
  abort?: boolean; holdCommit?: boolean; holdOpen?: boolean; blocked?: boolean
  openError?: DOMException; requestError?: DOMException; putError?: DOMException
} = {}) {
  const records = new Map<string, unknown>()
  const opens: [string, number | undefined][] = [], stores: string[] = []
  const connections: { closed: boolean }[] = []
  const later = (f: () => void) => setTimeout(f)
  type Handlers = {
    result?: unknown; error?: DOMException | null
    onsuccess?: () => void; onupgradeneeded?: () => void; onblocked?: () => void
    oncomplete?: () => void; onabort?: () => void; onerror?: (event: { target: Handlers }) => void
  }
  const transactions: { start(): void }[] = []
  const heldOpens: (() => void)[] = [], heldCommits: (() => void)[] = []
  let upgraded = false, aborts = 0
  function transaction(mode: IDBTransactionMode) {
    let active = false, done = false, pending = 0, local: Map<string, unknown>
    const jobs: (() => void)[] = []
    const end = () => {
      const index = transactions.indexOf(tx)
      transactions.splice(index, 1)
      if (index === 0) transactions[0]?.start()
    }
    const tx: Handlers & { objectStore(name: string): unknown; abort(): void; start(): void } = {
      start() {
        if (done) return
        active = true; local = new Map(records)
        for (const job of jobs) later(job)
      },
      abort() {
        if (done) throw new DOMException('Transaction finished', 'InvalidStateError')
        done = true; aborts++
        later(() => { tx.onabort?.(); end() })
      },
      objectStore(name) {
        if (name !== 'projects' || !upgraded) throw new Error('Unknown project store')
        return {
          get: (key: string) => request(() => structuredClone(local.get(key))),
          put: (value: unknown, key: string) => {
            if (mode !== 'readwrite') throw new DOMException('Read only', 'ReadOnlyError')
            if (key === 'current' && options.putError) throw options.putError
            const copy = structuredClone(value)
            return request(() => { local.set(key, copy); return key })
          },
        }
      },
    }
    const commit = () => {
      if (done || pending) return
      if (options.abort) { tx.error = new DOMException('Commit refused', 'AbortError'); tx.abort(); return }
      done = true
      if (mode === 'readwrite') {
        records.clear()
        for (const [key, value] of local) records.set(key, value)
      }
      tx.oncomplete?.()
      end()
    }
    const request = (run: () => unknown) => {
      if (done) throw new DOMException('Transaction finished', 'TransactionInactiveError')
      const req: Handlers = {}; pending++
      const job = () => {
        if (done) return
        if (options.requestError) {
          req.error = options.requestError
          req.onerror?.({ target: req }); tx.onerror?.({ target: req })
          tx.error = options.requestError
          if (!done) tx.abort()
          return
        }
        req.result = run()
        req.onsuccess?.()
        if (--pending === 0) later(() => {
          if (done || pending) return
          if (options.holdCommit) heldCommits.push(commit)
          else commit()
        })
      }
      if (active) later(job)
      else jobs.push(job)
      return req
    }
    transactions.push(tx)
    if (transactions.length === 1) tx.start()
    return tx
  }
  const open = (name: string, version?: number) => {
    opens.push([name, version])
    const req: Handlers = {}
    const succeed = () => {
      const connection = { closed: false }; connections.push(connection)
      req.result = {
        createObjectStore(name: string, config?: IDBObjectStoreParameters) {
          if (name !== 'projects' || config?.keyPath) throw new Error('Expected out-of-line project keys')
          stores.push(name)
        },
        close() { connection.closed = true },
        transaction(name: string, mode: IDBTransactionMode) {
          if (name !== 'projects' || connection.closed) throw new Error('Unavailable project store')
          return transaction(mode)
        },
      }
      if (!upgraded) { req.onupgradeneeded?.(); upgraded = true }
      req.onsuccess?.()
    }
    later(() => {
      if (options.openError) { req.error = options.openError; req.onerror?.({ target: req }) }
      else if (options.blocked || options.holdOpen) { heldOpens.push(succeed); if (options.blocked) req.onblocked?.() }
      else succeed()
    })
    return req
  }
  return {
    records, factory: { open }, opens, stores, connections,
    get aborts() { return aborts },
    releaseOpens() { for (const f of heldOpens.splice(0)) f() },
    releaseCommits() { for (const f of heldCommits.splice(0)) f() },
  }
}
