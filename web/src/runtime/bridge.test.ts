import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoreBridge, type BridgeEvents, type FrameTiming } from './bridge'
import type { Frame } from './frame'
import { FakeWorker, vbf1 } from './testing'

const spies = () => ({ ready: vi.fn<BridgeEvents['ready']>(), status: vi.fn<BridgeEvents['status']>(), halted: vi.fn<BridgeEvents['halted']>() })
let workers: FakeWorker[]
let events: ReturnType<typeof spies>

function make() {
  workers = []
  events = spies()
  return new CoreBridge(() => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker }, events)
}

function booted() {
  const bridge = make()
  workers[0].reply({ kind: 'ready' })
  return bridge
}

// A booted bridge with a running chip and nothing in flight.
function running() {
  const bridge = booted()
  bridge.load('lua', { w: 460, h: 460 })
  workers[0].status(workers[0].last())
  return bridge
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CoreBridge', () => {
  it('queues picture reads and image delivery with the worker watchdog', async () => {
    const b = booted(), w = workers[0]
    b.frame('main', 1, false)
    const read = b.readPicture('data:x')
    const bytes = b.readPictureBytes(new Uint8Array([66, 77]))
    const set = b.setImage('data:x', 2, 3, null)
    expect(w.last().kind).toBe('frame')
    w.reply({ id: w.last().id, kind: 'frame', buf: vbf1(), workerMs: 1 })
    expect(w.last()).toMatchObject({ kind: 'readPicture', src: 'data:x' })
    w.reply({ id: w.last().id, kind: 'picture', result: { format: 'png', bytes: 'AA==' } })
    await expect(read).resolves.toEqual({ format: 'png', bytes: 'AA==' })
    expect(w.last()).toMatchObject({ kind: 'readPictureBytes', bytes: new Uint8Array([66, 77]) })
    w.reply({ id: w.last().id, kind: 'picture', result: { error: 'bad bytes' } })
    await expect(bytes).resolves.toEqual({ error: 'bad bytes' })
    expect(w.last()).toMatchObject({ kind: 'setImage', src: 'data:x', width: 2, height: 3, error: null })
    w.reply({ id: w.last().id, kind: 'imageSet' })
    await expect(set).resolves.toBeUndefined()
    b.dispose()
  })
  it('rejects a picture read when its worker times out', async () => {
    const b = booted(), read = b.readPicture('data:x')
    const rejected = expect(read).rejects.toThrow('timeout')
    vi.advanceTimersByTime(10_001)
    await rejected
    b.dispose()
  })
  it('drops a load whose host preparation throws and reports it without poisoning later requests', () => {
    const bridge=booted(), host=vi.fn(()=>{throw new Error('host failed')})
    expect(()=>bridge.load('lua',{w:460,h:460},{},{},host)).not.toThrow()
    expect(events.halted).toHaveBeenCalledWith(expect.stringContaining('host failed'))
    bridge.frame('main',1,false)
    expect(workers[0].last().kind).toBe('frame')
    expect(host).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it('delivers stores before preparing a queued load, without letting listener frames overtake it', () => {
    const bridge = running(), old = { persist: {} as Record<string, string>, memory: [] as number[] }
    bridge.pointer('main', 1, 1, 'down')
    const pointer = workers[0].last()
    events.status.mockImplementation(s => {
      if (s.persist) old.persist = s.persist
      if (s.memory) old.memory = s.memory as number[]
      bridge.frame('main', 1, false)
    })
    bridge.load('new', { w: 460, h: 460 }, {}, {}, () => JSON.stringify(old))
    expect(workers[0].last()).toBe(pointer)
    const memory = Array(512).fill(7)
    workers[0].reply({ id: pointer.id, kind: 'status', status: { state: 'Running', error: null, instructions: 1, output: [], persist: { k: 'v' }, memory } })
    expect(workers[0].last().kind).toBe('load')
    expect(JSON.parse(String(workers[0].last().host))).toEqual({ persist: { k: 'v' }, memory })
    bridge.dispose()
  })
  it('runs due ticks within one reply during a faster stream of pointer events', () => {
    const bridge = running(), w = workers[0], ticks: number[] = []
    const replied = new Set<number>([w.last().id])
    const stream = setInterval(() => bridge.pointer('main', 1, 1, 'down'), 10)
    const replies = setInterval(() => {
      const m = w.last()
      if (replied.has(m.id)) return
      replied.add(m.id)
      if (m.kind === 'tick') ticks.push(Date.now())
      w.status(m)
    }, 20)
    const start = Date.now()
    vi.advanceTimersByTime(2020)
    expect(ticks.map(t => t - start)).toEqual([520, 1020, 1520, 2020])
    clearInterval(stream); clearInterval(replies); bridge.dispose()
  })
  it('fires ready after the worker says so', () => {
    const bridge = make()
    expect(bridge.ready).toBe(false)
    expect(events.ready).not.toHaveBeenCalled()
    workers[0].reply({ kind: 'ready' })
    expect(bridge.ready).toBe(true)
    expect(events.ready).toHaveBeenCalledOnce()
  })

  it('sends a load made while booting after ready, and its timer starts then', () => {
    const bridge = make()
    bridge.load('lua', { w: 460, h: 460 })
    expect(workers[0].posted).toEqual([])
    vi.advanceTimersByTime(30_000)
    workers[0].reply({ kind: 'ready' })
    expect(workers[0].posted).toEqual([{ id: expect.any(Number), kind: 'load', lua: 'lua', w: 460, h: 460, sizes: '{}', host: '' }])
    vi.advanceTimersByTime(9_999)
    expect(events.halted).not.toHaveBeenCalled()
    expect(bridge.ready).toBe(true)
  })

  it('sends each surface\'s size with a load, as JSON of whole px', () => {
    booted().load('lua', { w: 460, h: 460 }, { main: { w: 1036, h: 460 } })
    expect(workers[0].posted).toEqual([{ id: expect.any(Number), kind: 'load', lua: 'lua', w: 460, h: 460, sizes: '{"main":[1036,460]}', host: '' }])
    booted().load('lua', { w: 460, h: 460 }, { a: { w: 1035.6, h: 9000 }, b: { w: -5, h: NaN }, c: { w: '7' as unknown as number, h: null as unknown as number } })
    expect(workers[0].last().sizes).toBe('{"a":[1036,8192],"b":[1,460],"c":[7,460]}')
  })

  it('does not send a frame while a load is pending', () => {
    const bridge = booted()
    bridge.load('lua', { w: 460, h: 460 })
    bridge.frame('main', 1, false)
    expect(workers[0].kinds()).toEqual(['load'])
    workers[0].status(workers[0].last())
    bridge.frame('main', 1, false)
    expect(workers[0].last()).toMatchObject({ kind: 'frame', surface: 'main', scale: 1, tag: false })
  })

  it('replaces the worker when a load runs past 10 s', () => {
    const bridge = booted()
    bridge.load('lua', { w: 460, h: 460 })
    vi.advanceTimersByTime(9_999)
    expect(workers).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(workers[0].terminated).toBe(true)
    expect(events.halted).toHaveBeenCalledWith('timeout')
    expect(workers).toHaveLength(2)
    expect(bridge.ready).toBe(false)
  })

  it('sends a queued load to the new worker after its ready', () => {
    const bridge = booted()
    bridge.load('first', { w: 460, h: 460 })
    bridge.load('second', { w: 460, h: 460 })
    vi.advanceTimersByTime(10_000)
    expect(workers[1].posted).toEqual([])
    workers[1].reply({ kind: 'ready' })
    expect(workers[1].posted).toEqual([{ id: expect.any(Number), kind: 'load', lua: 'second', w: 460, h: 460, sizes: '{}', host: '' }])
  })

  it('does not re-send the load that timed out', () => {
    const bridge = booted()
    bridge.load('loops', { w: 460, h: 460 })
    vi.advanceTimersByTime(10_000)
    workers[1].reply({ kind: 'ready' })
    expect(bridge.ready).toBe(true)
    expect(workers[1].posted).toEqual([])
  })

  it('ignores a replaced worker', () => {
    const bridge = booted()
    bridge.load('lua', { w: 460, h: 460 })
    const load = workers[0].last()
    vi.advanceTimersByTime(10_000)
    workers[0].status(load)
    workers[0].reply({ kind: 'crashed' })
    workers[0].onerror?.({ message: 'late' } as ErrorEvent)
    expect(events.status).not.toHaveBeenCalled()
    expect(events.halted).toHaveBeenCalledOnce()
    expect(workers).toHaveLength(2)
    expect(bridge.running).toBe(false)
  })

  it('retries a failed boot after a restart once, then reports it', () => {
    const bridge = booted()
    bridge.load('lua', { w: 460, h: 460 })
    vi.advanceTimersByTime(10_000)
    expect(workers).toHaveLength(2)
    vi.advanceTimersByTime(60_000)
    expect(workers).toHaveLength(3)
    expect(events.halted).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(60_000)
    expect(events.halted).toHaveBeenLastCalledWith('the core failed to restart (timeout)')
    expect(workers).toHaveLength(3)
    expect(workers[2].terminated).toBe(true)
    vi.advanceTimersByTime(600_000)
    expect(workers).toHaveLength(3)
  })

  it('ticks every 500 ms only while running', () => {
    const bridge = booted()
    vi.advanceTimersByTime(1_000)
    expect(workers[0].kinds()).toEqual([])
    bridge.load('lua', { w: 460, h: 460 })
    workers[0].status(workers[0].last())
    const ticks = () => workers[0].kinds().filter(k => k === 'tick').length
    expect(bridge.running).toBe(true)
    vi.advanceTimersByTime(499)
    expect(ticks()).toBe(0)
    vi.advanceTimersByTime(1)
    expect(ticks()).toBe(1)
    workers[0].status(workers[0].last())
    vi.advanceTimersByTime(500)
    expect(ticks()).toBe(2)
    vi.advanceTimersByTime(500)  // due while a tick is in flight, then the chip halts
    expect(ticks()).toBe(2)
    workers[0].status(workers[0].last(), 'Halted')
    expect(bridge.running).toBe(false)
    vi.advanceTimersByTime(1_500)
    expect(ticks()).toBe(2)
  })

  it('sends a tick that falls due during a frame after the frame', () => {
    const bridge = running()
    const seen = vi.fn<(f: Frame, t: FrameTiming, surface: string) => void>()
    bridge.onFrame(seen)
    bridge.frame('wide', 1, true)
    const frame = workers[0].last()
    vi.advanceTimersByTime(500)
    expect(workers[0].last()).toBe(frame)
    workers[0].reply({ id: frame.id, kind: 'frame', buf: vbf1(), workerMs: 3 })
    expect(workers[0].last().kind).toBe('tick')
    expect(seen).toHaveBeenCalledOnce()
    expect(seen.mock.calls[0][0].elements).toEqual([])
    expect(seen.mock.calls[0][1]).toMatchObject({ workerMs: 3, roundTripMs: expect.any(Number) })
    expect(seen.mock.calls[0][2]).toBe('wide')   // the surface the frame was asked for
  })

  it('coalesces patches per element and sends them only when idle', () => {
    const bridge = running()
    const sent = () => workers[0].posted.length
    bridge.frame('main', 1, true)
    const frame = workers[0].last(), before = sent()
    bridge.patch('main', 'a', 'one')
    bridge.patch('main', 'b', 'other')
    bridge.patch('main', 'a', 'two')
    bridge.patch('main', 'a', 'three')
    expect(sent()).toBe(before)
    expect(bridge.patchMs).toBeNull()
    workers[0].reply({ id: frame.id, kind: 'frame', buf: vbf1(), workerMs: 1 })
    expect(sent()).toBe(before + 1)
    const a = workers[0].last()
    expect(a).toMatchObject({ kind: 'patch', surface: 'main', element: 'a', src: 'three' })
    bridge.frame('main', 1, true)
    expect(sent()).toBe(before + 1)
    workers[0].status(a)
    expect(bridge.patchMs).not.toBeNull()
    const between = workers[0].last()   // the frame asked for during a goes before b
    expect(between.kind).toBe('frame')
    workers[0].reply({ id: between.id, kind: 'frame', buf: vbf1(), workerMs: 1 })
    expect(sent()).toBe(before + 3)
    const b = workers[0].last()
    expect(b).toMatchObject({ kind: 'patch', surface: 'main', element: 'b', src: 'other' })
    workers[0].status(b)
    expect(sent()).toBe(before + 3)
    bridge.frame('main', 1, true)
    expect(workers[0].last().kind).toBe('frame')
  })

  it('lets the latest frame asked for during a patch through before the next patch', () => {
    const bridge = running()
    bridge.patch('main', 'scene', 'one')   // a drag: one patch per animation frame, each round trip longer than a frame
    const one = workers[0].last()
    bridge.frame('main', 1, true)
    bridge.frame('main', 2, true)
    bridge.patch('main', 'scene', 'two')
    expect(workers[0].last()).toBe(one)
    workers[0].status(one)
    const frame = workers[0].last()
    expect(frame).toMatchObject({ kind: 'frame', scale: 2 })
    workers[0].reply({ id: frame.id, kind: 'frame', buf: vbf1(), workerMs: 1 })
    const two = workers[0].last()
    expect(two).toMatchObject({ kind: 'patch', src: 'two' })
    bridge.patch('main', 'scene', 'three')
    workers[0].status(two)
    expect(workers[0].last()).toMatchObject({ kind: 'patch', src: 'three' })   // no frame asked for since the last one
  })

  it('says which request each status answers, so a patch error can outlive the ticks after it', () => {
    const bridge = running()
    expect(events.status).toHaveBeenLastCalledWith(expect.anything(), 'load')
    bridge.patch('main', 'scene', 'x')
    workers[0].reply({ id: workers[0].last().id, kind: 'status', status: { state: 'Running', error: 'bad', instructions: 1, output: [] } })
    expect(events.status).toHaveBeenLastCalledWith(expect.objectContaining({ error: 'bad' }), 'patch')
    vi.advanceTimersByTime(500)
    workers[0].status(workers[0].last())
    expect(events.status).toHaveBeenLastCalledWith(expect.anything(), 'tick')
  })

  it('drops patches older than a load, and patches left for a chip a restart emptied', () => {
    const bridge = running()
    bridge.frame('main', 1, true)
    const frame = workers[0].last()
    bridge.patch('main', 'a', 'older than the load')
    bridge.load('new', { w: 460, h: 460 })
    bridge.patch('main', 'b', 'newer than the load')
    workers[0].reply({ id: frame.id, kind: 'frame', buf: vbf1(), workerMs: 1 })
    const load = workers[0].last()
    expect(load).toMatchObject({ kind: 'load', lua: 'new' })
    workers[0].status(load)
    expect(workers[0].last()).toMatchObject({ kind: 'patch', element: 'b' })
    bridge.patch('main', 'c', 'pending')
    vi.advanceTimersByTime(2_000)
    expect(events.halted).toHaveBeenCalledWith('timeout')
    workers[1].reply({ kind: 'ready' })
    expect(workers[1].posted).toEqual([])
  })

  it('halts with the reason the worker gives', () => {
    booted()
    workers[0].reply({ kind: 'crashed', why: 'boom' })
    expect(events.halted).toHaveBeenLastCalledWith(expect.stringContaining('boom'))
    workers[1].reply({ kind: 'ready' })
    workers[1].onerror?.({ message: 'bad script' } as ErrorEvent)
    expect(events.halted).toHaveBeenLastCalledWith(expect.stringContaining('bad script'))
  })

  it('isolates app callbacks that throw', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bridge = make()
    for (const f of [events.ready, events.status, events.halted]) f.mockImplementation(() => { throw new Error('app') })
    const second = vi.fn<(f: Frame, t: FrameTiming) => void>()
    bridge.onFrame(() => { throw new Error('listener') })
    bridge.onFrame(second)
    bridge.load('lua', { w: 460, h: 460 })
    workers[0].reply({ kind: 'ready' })
    expect(workers[0].last()).toMatchObject({ kind: 'load' })
    workers[0].status(workers[0].last())
    bridge.frame('main', 1, true)
    workers[0].reply({ id: workers[0].last().id, kind: 'frame', buf: vbf1(), workerMs: 1 })
    expect(second).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(500 + 2_000)  // a tick, which times out
    expect(events.halted).toHaveBeenCalledWith('timeout')
    expect(workers).toHaveLength(2)
    expect(logged).toHaveBeenCalledTimes(4)
  })

  it('delivers a frame that fails to decode as an empty frame with a problem', () => {
    const bridge = running()
    const seen = vi.fn<(f: Frame, t: FrameTiming) => void>()
    bridge.onFrame(seen)
    bridge.frame('main', 1, true)
    workers[0].reply({ id: workers[0].last().id, kind: 'frame', buf: new ArrayBuffer(8), workerMs: 1 })
    const f = seen.mock.calls[0][0]
    expect(f).toMatchObject({ elements: [], text: [], problems: [{ element: -1, message: expect.stringContaining('frame decode failed: ') }] })
    expect(f.positions.length + f.indices.length + f.spans.length).toBe(0)
    const sent = workers[0].posted.length
    bridge.frame('main', 1, true)
    expect(workers[0].posted).toHaveLength(sent + 1)
    expect(workers).toHaveLength(1)
  })

  // App read a frame through the numbering of the scene it had queued, not of the one the frame showed.
  it('hands each frame its surface\'s drawnFrom as sent before the frame was asked for, never sending it to the worker', () => {
    const bridge = booted(), seen: unknown[] = []
    bridge.onFrame(f => seen.push(f.drawnFrom))
    const answer = () => {
      const m = workers.at(-1)!.last()
      if (m.kind === 'frame') workers.at(-1)!.reply({ id: m.id, kind: 'frame', buf: vbf1(), workerMs: 1 })
      else workers.at(-1)!.status(m)
    }
    bridge.load('lua', { w: 460, h: 460 }, {}, { main: 'A', side: 'S' })
    answer()
    bridge.frame('main', 1, true)
    bridge.patch('main', 'scene', 'b', 'B')   // queued while the frame is in flight
    answer()                                   // that frame shows A
    answer()                                   // the patch, sent once the frame came back
    bridge.frame('main', 1, true)
    answer()                                   // B
    bridge.frame('side', 1, true)
    answer()                                   // S: each surface its own
    bridge.patch('main', 'scene', 'c')         // no note: main keeps B
    answer()
    bridge.frame('main', 1, true)
    answer()
    expect(seen).toEqual(['A', 'B', 'S', 'B'])
    expect(workers[0].posted.some(m => 'drawnFrom' in m)).toBe(false)
    // A new chip holds nothing until a load says what it shows.
    bridge.frame('main', 1, true)
    vi.advanceTimersByTime(2_000)
    workers[1].reply({ kind: 'ready' })
    bridge.frame('main', 1, true)
    answer()
    expect(seen.at(-1)).toBeUndefined()
  })

  it('does nothing after dispose, even when called from a halted handler', () => {
    const bridge = running()
    events.halted.mockImplementation(() => bridge.dispose())
    bridge.load('loops', { w: 460, h: 460 })
    const load = workers[0].last(), sent = workers[0].posted.length
    vi.advanceTimersByTime(10_000)
    expect(events.halted).toHaveBeenCalledWith('timeout')
    expect(workers).toHaveLength(1)
    workers[0].status(load)
    bridge.load('more', { w: 460, h: 460 })
    bridge.patch('main', 'a', 'x')
    bridge.frame('main', 1, true)
    vi.advanceTimersByTime(600_000)
    expect(events.status).toHaveBeenCalledOnce()  // the first load's, from running()
    expect(workers).toHaveLength(1)
    expect(workers[0].posted).toHaveLength(sent)
  })

  it('does not give the chip a load makes a tick that fell due for the old one', () => {
    const bridge = running()
    bridge.frame('main', 1, true)
    const frame = workers[0].last()
    vi.advanceTimersByTime(500)  // due during the frame
    bridge.load('new', { w: 460, h: 460 })
    workers[0].reply({ id: frame.id, kind: 'frame', buf: vbf1(), workerMs: 1 })
    const load = workers[0].last()
    expect(load).toMatchObject({ kind: 'load', lua: 'new' })
    vi.advanceTimersByTime(500)  // due during the load
    workers[0].status(load)
    expect(workers[0].last()).toBe(load)
    vi.advanceTimersByTime(500)
    expect(workers[0].last().kind).toBe('tick')
  })
})

describe('CoreBridge: host, pointer, visit and sim (M3)', () => {
  it('sends the host with a load', () => {
    booted().load('lua', { w: 460, h: 460 }, {}, {}, '{"beta":true}')
    expect(workers[0].last()).toEqual({ id: expect.any(Number), kind: 'load', lua: 'lua', w: 460, h: 460, sizes: '{}', host: '{"beta":true}' })
  })
  it('sends pointer, visit and sim messages after patches and a due tick, in order; moves coalesce', () => {
    const bridge = running()
    bridge.patch('main', 'scene', 'SCENE')
    bridge.pointer('main', 1, 2, 'move')
    bridge.pointer('main', 3, 4, 'move')
    bridge.pointer('main', 3, 4, 'down', 0, 7)
    bridge.visit('p2')
    bridge.sim('{}')
    vi.advanceTimersByTime(500)   // a tick falls due
    const sent = () => workers[0].posted.slice(1)
    for (let k = 0; k < 5; k++) workers[0].status(workers[0].last())
    expect(sent().map(m => m.kind)).toEqual(['patch', 'tick', 'pointer', 'pointer', 'visit', 'sim'])
    expect(sent()[2]).toMatchObject({ kind: 'pointer', surface: 'main', x: 3, y: 4, type: 'move', dy: 0, pointer: 0 })
    expect(sent()[3]).toMatchObject({ type: 'down', pointer: 7 })
    expect(sent()[4]).toMatchObject({ kind: 'visit', page: 'p2' })
    expect(sent()[5]).toMatchObject({ kind: 'sim', json: '{}' })
  })
  it('never coalesces a down, an up or a move of another pointer', () => {
    const bridge = running()
    bridge.patch('main', 'scene', 'x')
    for (const [type, pointer] of [['down', 1], ['move', 1], ['move', 2], ['up', 1], ['up', 1]] as const) bridge.pointer('main', 0, 0, type, 0, pointer)
    for (let k = 0; k < 6; k++) workers[0].status(workers[0].last())
    expect(workers[0].posted.filter(m => m.kind === 'pointer').map(m => `${m.type}${m.pointer}`)).toEqual(['down1', 'move1', 'move2', 'up1', 'up1'])
  })
  it('drops the queued messages when a load goes first', () => {
    const bridge = running()
    bridge.patch('main', 'scene', 'x')
    bridge.visit('p2')
    bridge.load('lua2', { w: 460, h: 460 })
    workers[0].status(workers[0].last())
    workers[0].status(workers[0].last())
    expect(workers[0].posted.map(m => m.kind)).toEqual(['load', 'patch', 'load'])
  })
  it('hands the status fields to the listeners', () => {
    const bridge = running()
    bridge.visit('p2')
    const status = { state: 'Running' as const, error: null, instructions: 5, output: ['saved'], active: 'page2',
      persist: { a: '1' }, memory: Array(512).fill(7), writes: [{ ref: 2, lt: 3, slot: -1, value: 1, stored: true }] }
    workers[0].reply({ id: workers[0].last().id, kind: 'status', status })
    expect(events.status).toHaveBeenLastCalledWith(status, 'visit')
  })
})

it('keeps the status tied to the map of the load actually sent, even when a new load is queued', () => {
  const b = booted(), oldMap = { owner: 'old' }, newMap = { owner: 'new' }
  try {
    b.load('old', { w: 460, h: 460 }, {}, {}, '', oldMap)
    const old = workers[0].last()
    b.load('new', { w: 460, h: 460 }, {}, {}, '', newMap)
    workers[0].status(old)
    expect(events.status).toHaveBeenLastCalledWith(expect.anything(), 'load', oldMap)
    workers[0].status(workers[0].last())
    expect(events.status).toHaveBeenLastCalledWith(expect.anything(), 'load', newMap)
  } finally { b.dispose() }
})
