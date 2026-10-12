// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { projectDb } from '../testing'
import { readAutosave, writeAutosave } from './autosave'

const at = '2026-10-11T00:00:00.000Z'
const saved = (revision: number, text: string) => ({ revision, text, updatedAt: at })

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('reads an empty database without creating a project', async () => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  expect(await readAutosave()).toEqual({ kind: 'ready', current: null, recovery: null })
  expect(db.records.size).toBe(0)
  expect(db.opens).toEqual([['vectorbuilder-projects', 1]])
  expect(db.stores).toEqual(['projects'])
  expect(db.connections.every(c => c.closed)).toBe(true)
})

it('rotates only on replacement and keeps recovery across edits', async () => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  expect(await writeAutosave('A', 0, at, false)).toEqual({ kind: 'saved', record: saved(1, 'A') })
  expect((await writeAutosave('F', 1, at, true)).kind).toBe('saved')
  expect((await writeAutosave('F edit 1', 2, at, false)).kind).toBe('saved')
  expect((await writeAutosave('F edit 2', 3, at, false)).kind).toBe('saved')
  expect(await writeAutosave('stale', 1, at, true)).toEqual({ kind: 'conflict', record: saved(4, 'F edit 2') })
  expect(await readAutosave()).toEqual({ kind: 'ready', current: saved(4, 'F edit 2'), recovery: saved(1, 'A') })
  expect((await writeAutosave('B', 4, at, true)).kind).toBe('saved')
  expect(await readAutosave()).toEqual({ kind: 'ready', current: saved(5, 'B'), recovery: saved(4, 'F edit 2') })
})

it('does not promise durability when requests succeed but commit aborts', async () => {
  const db = projectDb({ abort: true }); vi.stubGlobal('indexedDB', db.factory)
  expect((await writeAutosave('new', 0, at, true)).kind).toBe('unavailable')
  expect(db.records.size).toBe(0)
  expect(db.connections.every(c => c.closed)).toBe(true)
})

it('rolls back current and recovery together after a three-request replacement aborts', async () => {
  const db = projectDb({ abort: true }); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', saved(2, 'A')); db.records.set('recovery', saved(1, 'older'))
  expect((await writeAutosave('B', 2, at, true)).kind).toBe('unavailable')
  expect([...db.records]).toEqual([['current', saved(2, 'A')], ['recovery', saved(1, 'older')]])
})

it('waits for transaction completion after all replacement requests succeed', async () => {
  vi.useFakeTimers()
  const db = projectDb({ holdCommit: true }); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', saved(1, 'A'))
  let result: unknown
  const pending = writeAutosave('B', 1, at, true).then(r => { result = r; return r })
  await vi.advanceTimersByTimeAsync(50)
  expect(result).toBeUndefined()
  expect([...db.records]).toEqual([['current', saved(1, 'A')]])
  db.releaseCommits()
  expect(await pending).toEqual({ kind: 'saved', record: saved(2, 'B') })
  const read = readAutosave()
  await vi.advanceTimersByTimeAsync(50)
  db.releaseCommits()
  expect(await read).toEqual({ kind: 'ready', current: saved(2, 'B'), recovery: saved(1, 'A') })
})

it('serializes concurrent writers so an identical expected revision saves only once', async () => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', saved(1, 'A'))
  const results = await Promise.all([writeAutosave('B', 1, at, true), writeAutosave('C', 1, at, true)])
  expect(results.map(r => r.kind).sort()).toEqual(['conflict', 'saved'])
  const winner = results.find(r => r.kind === 'saved')!
  expect(results.find(r => r.kind === 'conflict')).toEqual({ kind: 'conflict', record: winner.record })
  expect(await readAutosave()).toEqual({ kind: 'ready', current: winner.record, recovery: saved(1, 'A') })
})

it.each([
  null, 7, {}, { ...saved(1, 'A'), revision: 0 }, { ...saved(1, 'A'), revision: -1 },
  { ...saved(1, 'A'), revision: 1.5 }, { ...saved(1, 'A'), revision: NaN },
  { ...saved(1, 'A'), revision: Number.MAX_SAFE_INTEGER + 1 },
  { ...saved(1, 'A'), text: [] }, { ...saved(1, 'A'), updatedAt: 42 },
])('refuses corrupt current %j and exposes valid recovery without overwriting either slot', async corrupt => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', corrupt); db.records.set('recovery', saved(1, 'rescue'))
  expect(await readAutosave()).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/current/i), recovery: saved(1, 'rescue') })
  expect(await writeAutosave('replacement', 0, at, true)).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/current/i) })
  expect(db.records.get('current')).toEqual(corrupt)
  expect(db.records.get('recovery')).toEqual(saved(1, 'rescue'))
})

it('restores valid current with a notice when recovery is corrupt', async () => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', saved(1, 'A')); db.records.set('recovery', null)
  expect(await readAutosave()).toEqual({ kind: 'ready', current: saved(1, 'A'), recovery: null, notice: expect.stringMatching(/corrupt recovery/i) })
  expect(db.records.get('current')).toEqual(saved(1, 'A'))
  expect(db.records.get('recovery')).toBeNull()
})

it('does not expose a corrupt recovery when current is corrupt too', async () => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', {}); db.records.set('recovery', {})
  const result = await readAutosave()
  expect(result).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/current/i) })
  expect(result).not.toHaveProperty('recovery')
})

it('refuses revision overflow without displacing recovery', async () => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', saved(Number.MAX_SAFE_INTEGER, 'A')); db.records.set('recovery', saved(1, 'rescue'))
  expect(await writeAutosave('B', Number.MAX_SAFE_INTEGER, at, true)).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/revision/i) })
  expect(db.records.get('current')).toEqual(saved(Number.MAX_SAFE_INTEGER, 'A'))
  expect(db.records.get('recovery')).toEqual(saved(1, 'rescue'))
})

it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid expected revision %s', async revision => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', saved(1, 'A'))
  expect(await writeAutosave('B', revision, at, false)).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/revision/i) })
  expect(db.records.get('current')).toEqual(saved(1, 'A'))
})

it('reports a missing current when the caller expected a saved revision', async () => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  expect(await writeAutosave('B', 1, at, true)).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/revision/i) })
  expect(db.records.size).toBe(0)
})

it.each(['read', 'write'] as const)('reports unavailable when IndexedDB is absent during %s', async operation => {
  vi.stubGlobal('indexedDB', undefined)
  expect(await (operation === 'read' ? readAutosave() : writeAutosave('A', 0, at, false))).toMatchObject({ kind: 'unavailable', reason: expect.any(String) })
})

it.each(['read', 'write'] as const)('surfaces open errors during %s and leaves caller JSON usable', async operation => {
  const db = projectDb({ openError: new DOMException('Storage denied', 'SecurityError') }); vi.stubGlobal('indexedDB', db.factory)
  const text = '{"version":1,"name":"JSON rescue 🛟","customLua":"broken Lua"}'
  expect(await (operation === 'read' ? readAutosave() : writeAutosave(text, 0, at, false))).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('Storage denied') })
  expect(JSON.parse(text).name).toBe('JSON rescue 🛟')
  expect(db.records.size).toBe(0)
})

it.each(['read', 'write'] as const)('surfaces request errors during %s without replacing either slot', async operation => {
  const db = projectDb({ requestError: new DOMException('Disk full', 'QuotaExceededError') }); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', saved(1, 'A')); db.records.set('recovery', saved(1, 'rescue'))
  expect(await (operation === 'read' ? readAutosave() : writeAutosave('B', 1, at, true))).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('Disk full') })
  expect([...db.records]).toEqual([['current', saved(1, 'A')], ['recovery', saved(1, 'rescue')]])
  expect(db.connections.every(c => c.closed)).toBe(true)
})

it.each(['read', 'write'] as const)('reports a blocked %s and closes the eventual connection', async operation => {
  vi.useFakeTimers()
  const db = projectDb({ blocked: true }); vi.stubGlobal('indexedDB', db.factory)
  let result: unknown
  const pending = (operation === 'read' ? readAutosave() : writeAutosave('B', 0, at, true)).then(r => { result = r; return r })
  await vi.advanceTimersByTimeAsync(50)
  expect(result).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/blocked/i) })
  db.releaseOpens()
  await vi.advanceTimersByTimeAsync(50)
  expect(db.connections.every(c => c.closed)).toBe(true)
  expect(db.records.size).toBe(0)
  expect(await pending).toEqual(result)
})

it.each(['read', 'write'] as const)('times out a silent %s open after 5000 ms and ignores late success', async operation => {
  vi.useFakeTimers()
  const db = projectDb({ holdOpen: true }); vi.stubGlobal('indexedDB', db.factory)
  let result: unknown
  const pending = (operation === 'read' ? readAutosave() : writeAutosave('B', 0, at, true)).then(r => { result = r; return r })
  await vi.advanceTimersByTimeAsync(4999)
  expect(result).toBeUndefined()
  await vi.advanceTimersByTimeAsync(1)
  expect(result).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/timed out/i) })
  db.releaseOpens()
  await vi.advanceTimersByTimeAsync(50)
  expect(db.connections.every(c => c.closed)).toBe(true)
  expect(db.records.size).toBe(0)
  expect(await pending).toEqual(result)
})

it.each(['read', 'write'] as const)('aborts a held %s transaction at timeout and ignores late completion', async operation => {
  vi.useFakeTimers()
  const db = projectDb({ holdCommit: true }); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', saved(1, 'A')); db.records.set('recovery', saved(1, 'rescue'))
  let result: unknown
  const pending = (operation === 'read' ? readAutosave() : writeAutosave('B', 1, at, true)).then(r => { result = r; return r })
  await vi.advanceTimersByTimeAsync(5000)
  expect(result).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/timed out/i) })
  expect(db.aborts).toBe(1)
  db.releaseCommits()
  await vi.advanceTimersByTimeAsync(50)
  expect([...db.records]).toEqual([['current', saved(1, 'A')], ['recovery', saved(1, 'rescue')]])
  expect(db.connections.every(c => c.closed)).toBe(true)
  expect(await pending).toEqual(result)
})

it('preserves exact large Unicode text without truncation', async () => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  const text = JSON.stringify({ customLua: 'λ\u0000🛟\r\n'.repeat(200_000), name: 'exact' })
  expect(await writeAutosave(text, 0, at, true)).toEqual({ kind: 'saved', record: saved(1, text) })
  expect(await readAutosave()).toEqual({ kind: 'ready', current: saved(1, text), recovery: null })
})

it('stores serialized text of a project with 100000 nested groups without cloning its tree', async () => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  const text = '{"version":1,"pages":[{"scene":{"root":[' + '{"op":"G","attrs":{},"c":['.repeat(100_000)
    + '{"op":"T","attrs":{"text":"deep"}}' + ']}'.repeat(100_000) + ']}}]}'
  expect((await writeAutosave(text, 0, at, false)).kind).toBe('saved')
  expect(await readAutosave()).toEqual({ kind: 'ready', current: saved(1, text), recovery: null })
})

it.each([
  null, 7, {}, { ...saved(1, 'A'), revision: 0 }, { ...saved(1, 'A'), revision: -1 },
  { ...saved(1, 'A'), revision: 1.5 }, { ...saved(1, 'A'), revision: NaN },
  { ...saved(1, 'A'), revision: Number.MAX_SAFE_INTEGER + 1 },
  { ...saved(1, 'A'), text: [] }, { ...saved(1, 'A'), updatedAt: 42 },
])('validates corrupt current %j before comparing revisions or writing', async corrupt => {
  const db = projectDb(); vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', corrupt); db.records.set('recovery', saved(1, 'rescue'))
  expect(await writeAutosave('replacement', 1, at, true)).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/current/i) })
  expect(db.records.get('current')).toEqual(corrupt)
  expect(db.records.get('recovery')).toEqual(saved(1, 'rescue'))
})

it('reports upgrade creation errors promptly without leaving an open connection', async () => {
  vi.useFakeTimers()
  let closed = false, aborted = false
  const request: {
    result: { createObjectStore(): void; close(): void }
    transaction: { abort(): void }
    onupgradeneeded?: () => void
  } = {
    result: {
      createObjectStore() { throw new DOMException('Cannot create store', 'QuotaExceededError') },
      close() { closed = true },
    },
    transaction: { abort() { aborted = true } },
  }
  vi.stubGlobal('indexedDB', { open() { return request } })
  let result: unknown
  const pending = readAutosave().then(r => { result = r; return r })
  expect(() => request.onupgradeneeded?.()).not.toThrow()
  await Promise.resolve()
  expect(result).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('Cannot create store') })
  expect(closed).toBe(true)
  expect(aborted).toBe(true)
  expect(await pending).toEqual(result)
})

it('aborts a replacement when put throws after recovery has already been queued', async () => {
  const db = projectDb({ putError: new DOMException('Cannot write current', 'QuotaExceededError') })
  vi.stubGlobal('indexedDB', db.factory)
  db.records.set('current', saved(1, 'A')); db.records.set('recovery', saved(1, 'rescue'))
  expect(await writeAutosave('B', 1, at, true)).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('Cannot write current') })
  expect([...db.records]).toEqual([['current', saved(1, 'A')], ['recovery', saved(1, 'rescue')]])
  expect(db.connections.every(c => c.closed)).toBe(true)
})

it('keeps queued writers serialized when an earlier delayed open times out behind them', async () => {
  vi.useFakeTimers()
  const options = { holdOpen: true, holdCommit: true }
  const db = projectDb(options); vi.stubGlobal('indexedDB', db.factory)
  const delayed = writeAutosave('late', 0, at, false)
  await vi.advanceTimersByTimeAsync(1000)
  options.holdOpen = false
  const first = writeAutosave('A', 0, at, false)
  await vi.advanceTimersByTimeAsync(50)
  const second = writeAutosave('B', 1, at, true)
  await vi.advanceTimersByTimeAsync(50)
  db.releaseOpens()
  await vi.advanceTimersByTimeAsync(3900)
  expect(await delayed).toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/timed out/i) })
  await vi.advanceTimersByTimeAsync(1)
  db.releaseCommits()
  expect(await first).toEqual({ kind: 'saved', record: saved(1, 'A') })
  await vi.advanceTimersByTimeAsync(50)
  db.releaseCommits()
  expect(await second).toEqual({ kind: 'saved', record: saved(2, 'B') })
  expect([...db.records]).toEqual([['current', saved(2, 'B')], ['recovery', saved(1, 'A')]])
})
