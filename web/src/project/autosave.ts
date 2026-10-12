export type SavedProject = { revision: number; text: string; updatedAt: string }
type Unavailable = { kind: 'unavailable'; reason: string; recovery?: SavedProject }
export type SaveResult = { kind: 'saved'; record: SavedProject } | { kind: 'conflict'; record: SavedProject } | { kind: 'unavailable'; reason: string }
type ReadResult = { kind: 'ready'; current: SavedProject | null; recovery: SavedProject | null; notice?: string } | Unavailable

const DB = 'vectorbuilder-projects', STORE = 'projects'

function validRecord(value: unknown): value is SavedProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<SavedProject>
  return Number.isSafeInteger(record.revision) && (record.revision ?? 0) > 0
    && typeof record.text === 'string' && typeof record.updatedAt === 'string'
}

function stored<T>(mode: IDBTransactionMode, work: (
  store: IDBObjectStore, result: (value: T) => void, fail: (error: unknown) => void,
) => void): Promise<T | Unavailable> {
  return new Promise(resolve => {
    let db: IDBDatabase | undefined, tx: IDBTransaction | undefined, settled = false, result: T | undefined
    const finish = (value: T | Unavailable, abort = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (abort && tx) { try { tx.abort() } catch { /* A finished transaction cannot be aborted. */ } }
      db?.close()
      resolve(value)
    }
    const fail = (error: unknown) => finish({ kind: 'unavailable', reason: String(error) }, true)
    const timer = setTimeout(() => fail('Project storage timed out after 5000 ms'), 5000)
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(STORE) }
        catch (error) { req.transaction?.abort(); req.result.close(); fail(error) }
      }
      req.onblocked = () => fail('Project storage is blocked by another tab')
      req.onerror = () => fail(req.error ?? 'Project storage could not open')
      req.onsuccess = () => {
        db = req.result
        if (settled) { db.close(); return }
        try {
          tx = db.transaction(STORE, mode)
          tx.oncomplete = () => finish(result ?? { kind: 'unavailable', reason: 'Project storage returned no result' })
          tx.onabort = () => fail(tx?.error ?? 'Project storage transaction aborted')
          tx.onerror = event => fail((event.target as IDBRequest | null)?.error ?? tx?.error ?? 'Project storage transaction failed')
          work(tx.objectStore(STORE), value => { result = value }, fail)
        } catch (error) { fail(error) }
      }
    } catch (error) { fail(error) }
  })
}

export function readAutosave(): Promise<ReadResult> {
  return stored<ReadResult>('readonly', (store, result) => {
    const current = store.get('current'), recovery = store.get('recovery')
    let pending = 2
    const read = () => {
      if (--pending !== 0) return
      const c: unknown = current.result, r: unknown = recovery.result
      if (c !== undefined && !validRecord(c)) {
        result({ kind: 'unavailable', reason: 'Corrupt current project record', ...(validRecord(r) ? { recovery: r } : {}) })
      } else if (r !== undefined && !validRecord(r)) {
        result({ kind: 'ready', current: c ?? null, recovery: null, notice: 'Corrupt recovery project record; recovery is unavailable' })
      } else result({ kind: 'ready', current: c ?? null, recovery: r ?? null })
    }
    current.onsuccess = read
    recovery.onsuccess = read
  })
}

export function writeAutosave(text: string, expectedRevision: number, at: string, rotateRecovery: boolean): Promise<SaveResult> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return Promise.resolve({ kind: 'unavailable', reason: 'Invalid expected project revision' })
  }
  return stored('readwrite', (store, result, fail) => {
    const req = store.get('current')
    req.onsuccess = () => {
      try {
        const current: unknown = req.result
        if (current !== undefined && !validRecord(current)) { fail('Corrupt current project record'); return }
        if ((current?.revision ?? 0) !== expectedRevision) {
          if (current) result({ kind: 'conflict', record: current })
          else fail('No saved project at the expected revision')
          return
        }
        if (expectedRevision === Number.MAX_SAFE_INTEGER) { fail('Project revision overflow'); return }
        const record = { revision: expectedRevision + 1, text, updatedAt: at }
        if (rotateRecovery && current) store.put(current, 'recovery')
        store.put(record, 'current')
        result({ kind: 'saved', record })
      } catch (error) { fail(error) }
    }
  })
}
