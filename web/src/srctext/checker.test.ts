import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scene } from '../model/scene'
import { node } from '../model/testing'
import { FakeWorker } from '../runtime/testing'
import type { Checked } from './check'
import { MAX_FAILURES, orderOf, SceneChecker } from './checker'
import { pack } from './wire'

const scene = (x: number): Scene => ({ header: {}, defs: [], root: [node('R', { x })] })
const clean = (src: string): Checked => ({ errors: [], warnings: [], src, order: { ops: ['R'], nodes: [0] } })
const TOO_LARGE = 'this scene is too large to check here (checking took longer than 5 s); it is not sent to the preview'

let workers: FakeWorker[]
let checker: SceneChecker
const posted = () => workers.flatMap(w => w.posted) as unknown as { id: number; scene: unknown }[]
const answer = (w: FakeWorker, checked: Checked) => w.reply({ id: (w.last() as unknown as { id: number }).id, checked })

beforeEach(() => {
  vi.useFakeTimers()
  workers = []
  checker = new SceneChecker(() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker })
})
afterEach(() => { vi.useRealTimers() })

describe('SceneChecker', () => {
  it('posts a scene packed, resolves with the answer and keeps it', async () => {
    const s = scene(1), c = clean('R x=1\n')
    const p = checker.check(s)
    expect(posted()).toEqual([{ id: posted()[0].id, scene: pack(s) }])
    expect(checker.get(s)).toBeUndefined()
    answer(workers[0], c)
    expect(await p).toBe(c)
    expect(checker.get(s)).toBe(c)
  })

  it('posts a scene object once', async () => {
    const s = scene(1)
    const p = checker.check(s)
    expect(checker.check(s)).toBe(p)
    answer(workers[0], clean(''))
    await p
    await checker.check(s)
    expect(posted()).toHaveLength(1)
  })

  it('posts one scene at a time, in order', async () => {
    const a = scene(1), b = scene(2)
    const pa = checker.check(a), pb = checker.check(b)
    expect(posted()).toHaveLength(1)
    answer(workers[0], clean('a'))
    expect((await pa).src).toBe('a')
    expect(posted()).toHaveLength(2)
    expect(posted()[1].scene).toEqual(pack(b))
    answer(workers[0], clean('b'))
    expect((await pb).src).toBe('b')
  })

  it('calls a scene not answered in time too large to check here, not invalid, and starts a new worker', async () => {
    const a = scene(1), b = scene(2)
    const pa = checker.check(a), pb = checker.check(b)
    vi.advanceTimersByTime(4999)
    expect(workers).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(await pa).toEqual({ errors: [{ message: TOO_LARGE }], warnings: [], src: null, order: { ops: [], nodes: [] }, tooLarge: true })
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(workers[1].posted).toHaveLength(1)
    expect(workers[1].posted[0]).toMatchObject({ scene: pack(b) })
    // A late answer for a, on the worker b is in flight on, is dropped: b is not answered with it.
    const settled = vi.fn()
    void pb.then(settled)
    workers[1].reply({ id: (workers[0].posted[0] as unknown as { id: number }).id, checked: clean('late') })
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(checker.get(a)!.tooLarge).toBe(true)
    answer(workers[1], clean('b'))
    expect((await pb).src).toBe('b')
  })

  it('reports a worker error on the scene in flight and replaces the worker', async () => {
    const p = checker.check(scene(1))
    workers[0].onerror!({ message: 'boom', preventDefault() {} } as ErrorEvent)
    const c = await p
    expect(c.errors).toEqual([{ message: 'the scene could not be checked: boom' }])
    expect(c.src).toBeNull()
    expect(c.tooLarge).toBeUndefined()
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
  })

  it('stops after MAX_FAILURES workers in a row fail with no answer, and says why on the scenes that wait', async () => {
    const told = vi.fn()
    checker.subscribe(told)
    for (let k = 0; k < MAX_FAILURES - 1; k++) workers[k].onerror!({ message: 'script failed to load', preventDefault() {} } as ErrorEvent)
    expect(workers).toHaveLength(MAX_FAILURES)
    const s = scene(1), p = checker.check(s)
    workers.at(-1)!.onerror!({ message: 'script failed to load', preventDefault() {} } as ErrorEvent)
    expect(workers).toHaveLength(MAX_FAILURES)   // no more
    expect((await p).errors).toEqual([{ message: 'the scene could not be checked: script failed to load' }])
    expect(checker.get(s)!.errors).toEqual([{ message: 'the scene could not be checked: script failed to load' }])
    expect(told).toHaveBeenCalled()
  })

  it('replaces a worker that fails with no scene in flight, so the next scene goes to a live one', async () => {
    workers[0].onerror!({ message: 'script failed to load', preventDefault() {} } as ErrorEvent)
    expect(workers[0].terminated).toBe(true)
    expect(workers).toHaveLength(2)
    const p = checker.check(scene(1))
    expect(workers[1].posted).toHaveLength(1)
    answer(workers[1], clean('x'))
    expect((await p).src).toBe('x')
  })

  it('settles a scene whose post throws as invalid, and goes on with the next, without recursing', async () => {
    const first = checker.check(scene(-1))
    workers[0].postMessage = () => { throw new Error('out of memory') }
    const N = 100_000, queued = Array.from({ length: N }, (_, k) => checker.check(scene(k)))
    answer(workers[0], clean('first'))   // the queue then drains through posts that all throw
    expect((await first).src).toBe('first')
    const all = await Promise.all(queued)
    expect(all.every(c => c.errors[0].message === 'the scene could not be checked: out of memory' && c.src === null)).toBe(true)
    expect(checker.version).toBe(N + 1)
    expect(workers).toHaveLength(1)
  }, 300_000)   // 100k checks: about 3 s alone on an idle machine, 32 s alone on a loaded one (2026-10-07), 102 s beside the other files

  it('still answers the scene in flight and its listeners when no new worker can be made, then stops', async () => {
    let fail = false
    const made: FakeWorker[] = []
    const c = new SceneChecker(() => {
      if (fail) throw new Error('no workers left')
      const w = new FakeWorker(); made.push(w); return w as unknown as Worker
    })
    const heard = vi.fn()
    c.subscribe(heard)
    const scene2 = scene(2), pa = c.check(scene(1)), pb = c.check(scene2)
    fail = true
    vi.advanceTimersByTime(5000)
    expect((await pa).tooLarge).toBe(true)
    expect(heard).toHaveBeenCalledTimes(2)   // a's verdict, then the stop's on b, which is kept
    expect((await pb).errors).toEqual([{ message: 'the scene could not be checked: no workers left' }])
    expect(c.get(scene2)!.errors).toEqual([{ message: 'the scene could not be checked: no workers left' }])
    expect((await c.check(scene(3))).errors).toEqual([{ message: 'the scene could not be checked: no workers left' }])
    expect(made[0].posted).toHaveLength(1)
  })

  it('tells its listeners once per result and bumps its version', async () => {
    const heard = vi.fn()
    const off = checker.subscribe(heard)
    const p = checker.check(scene(1))
    expect(heard).not.toHaveBeenCalled()
    answer(workers[0], clean(''))
    await p
    expect(heard).toHaveBeenCalledTimes(1)
    expect(checker.version).toBe(1)
    off()
    const q = checker.check(scene(2))
    answer(workers[0], clean(''))
    await q
    expect(heard).toHaveBeenCalledTimes(1)
    expect(checker.version).toBe(2)
  })

  it('settles every waiting check when stopped, and answers later ones at once without posting', async () => {
    const pa = checker.check(scene(1)), pb = checker.check(scene(2))
    checker.dispose()
    const stopped = [{ message: 'the checker was stopped' }]
    expect((await pa).errors).toEqual(stopped)
    expect((await pb).errors).toEqual(stopped)
    expect(workers[0].terminated).toBe(true)
    expect((await checker.check(scene(3))).errors).toEqual(stopped)
    expect(posted()).toHaveLength(1)
    vi.advanceTimersByTime(10_000)
    expect(workers).toHaveLength(1)
  })
})

describe('orderOf', () => {
  const order = (n: number) => ({ ops: ['R'], nodes: [n] })
  const checked = (n: number): Checked => ({ ...clean('R\n'), order: order(n) })
  const bad: Checked = { errors: [{ message: 'x' }], warnings: [], src: null, order: { ops: [], nodes: [] } }

  it("takes a page scene's own numbering once it checked clean, else the page's last clean one", () => {
    const memory = new Map()
    expect(orderOf(memory, 'p1', undefined)).toBeUndefined()            // nothing landed yet
    expect(orderOf(memory, 'p1', checked(1))).toEqual(order(1))
    expect(orderOf(memory, 'p1', undefined)).toEqual(order(1))          // the next scene's check is pending
    expect(orderOf(memory, 'p1', { ...bad, tooLarge: true })).toEqual(order(1))
    expect(orderOf(memory, 'p1', bad)).toEqual(order(1))
    expect(orderOf(memory, 'p2', undefined)).toBeUndefined()            // per page
    expect(orderOf(memory, 'p1', checked(2))).toEqual(order(2))
  })
})
