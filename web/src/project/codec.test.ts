import { afterEach, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'
import { constants } from 'node:buffer'
import { fixtureProjects } from '../codegen/testing'
import { newProject } from '../model/project'
import type { SrcNode, Value } from '../model/scene'
import { initialState, reducer } from '../model/store'
import { pack, unpack } from '../srctext/wire'
import { compressProject, decompressProject, projectText } from './codec'
import { fragmentToken, readProject } from './input'
import { answer } from './transfer.worker'
import { ProjectTransfer } from './transfer'
import { FakeWorker } from '../runtime/testing'
import { imported } from '../theme/testing'
import { themeOf } from '../theme'
import { printChecked } from '../srctext/print'
import { assembleExport } from '../codegen/export'
import { generate } from '../codegen/generate'
import { embeddedToken } from './input'
import { exportProblems } from '../codegen/exportProblems'

it('native membership and flags travel through JSON, share tokens and the embedded block', async () => {
  const p = reducer(initialState(), { type: 'insertWidget', pageId: 'p1', widget: 'icon' }).project
  p.pages[0].scene.root = [{ op: 'G', attrs: { id: 'potato' }, c: [] }]
  Object.assign(p.pages[0].natives![0], { group: 'potato', hidden: true, lock: true, foo: 1 })
  const expected = { ...p.pages[0].natives![0] }; delete (expected as unknown as Record<string, unknown>).foo
  const token = await compressProject(p), generated = generate(p, pg => printChecked(pg.scene))
  const lua = assembleExport(generated, token, new Date('2026-10-13T00:00:00Z')).lua
  for (const text of [projectText(p), await decompressProject(token), await decompressProject(embeddedToken(lua)!)]) {
    expect(JSON.parse(text).pages[0].natives).toEqual([expected])
    const read = readProject(text)
    expect(read.project.pages[0].natives).toEqual([expected])
    expect(read.notice).toBe('')
  }
})

it('the theme travels through JSON, compressed links and an exported block', async () => {
  let s = initialState()
  for (const widget of ['panel', 'button']) s = reducer(s, { type: 'insertWidget', pageId: 'p1', widget })
  const project = reducer(s, { type: 'addTheme', theme: imported }).project
  const token = await compressProject(project)
  const generated = generate(project, pg => printChecked(pg.scene))
  const lua = assembleExport(generated, token, new Date('2026-10-12T00:00:00Z')).lua
  for (const text of [projectText(project), await decompressProject(token), await decompressProject(embeddedToken(lua)!)]) {
    const loaded = readProject(text)
    expect(themeOf(loaded.project)).toEqual(imported)
    expect(loaded.notice).toBe('')
    expect(loaded.project.pages.map(p => printChecked(p.scene))).toEqual(project.pages.map(p => printChecked(p.scene)))
  }
  expect(generated.lua).toContain('#123456')
  expect(exportProblems(project).filter(p => p.message.includes('missing colour'))).toEqual([])
  expect(projectText(JSON.parse(projectText(project)))).toBe(projectText(project))
})

afterEach(() => vi.unstubAllGlobals())

const declaredToken = (size: number) => {
  const bytes = gzipSync('x')
  bytes.writeUInt32LE(size, bytes.length - 4)
  return '1.' + bytes.toString('base64url')
}

it('round-trips every live-data field and Unicode through gzip', async () => {
  const p = fixtureProjects().custom
  p.name = 'Zażółć ț€ 🚀'
  const token = await compressProject(p)
  expect(token).toMatch(/^1\.[A-Za-z0-9_-]+$/)
  expect(JSON.parse(await decompressProject(token))).toEqual(p)
  expect(readProject(await decompressProject(token)).project)
    .toEqual(reducer(initialState(), { type: 'loadProject', project: p }).project)
})

it('has no serialization or whole-load depth cap', async () => {
  const p = newProject()
  let n: SrcNode = { op: 'R', attrs: { x: 0, y: 0, w: 1, h: 1 } }
  let v: Value = 7
  for (let i = 0; i < 100_000; i++) { n = { op: 'G', attrs: {}, c: [n] }; v = [v] }
  p.pages[0].scene.root = [n]
  p.pages[0].scene.header.deep = v
  p.pages[0].preview = { deep: v }
  p.bindings.deep = { from: 'const', value: v as number[] }
  p.pages[0].natives = [{ type: 'textinput', uid: 'ti1', params: { value: v } }]
  const text = projectText(p)
  expect(text.startsWith('{"version":1,')).toBe(true)
  expect(projectText(JSON.parse(text))).toBe(text)
  const once = readProject(text)
  const fromWire = unpack(structuredClone(pack(once.project))) as typeof p
  const twice = reducer(initialState(), { type: 'loadProject', project: fromWire })
  expect(projectText(twice.project)).toBe(projectText(once.project))
  expect(projectText(once.project)).toBe(projectText(reducer(initialState(), { type: 'loadProject', project: p }).project))
  expect(once.project.pages[0].preview).toEqual({})
  expect(once.project.bindings.deep).toBeUndefined()
  let groups = 0, node = once.project.pages[0].scene.root[0]
  while (node.c?.length) { groups++; node = node.c[0] }
  expect(groups).toBe(100_000)
  let arrays = 0, value = once.project.pages[0].scene.header.deep
  while (Array.isArray(value)) { arrays++; value = value[0] }
  expect([arrays, value]).toEqual([100_000, 7])
}, 30_000)

it('matches JSON semantics for keys, controls, surrogates and sparse fields', () => {
  const p = newProject()
  p.name = '\u0000\n\t\r\ud800 🚀'
  p.pages[0].scene.root = [{ op: 'R', attrs: JSON.parse('{"__proto__":[1],"constructor":"x"}'),
    comments: ['note'], eol: '', tail: ['tail'] }]
  p.pages[0].scene.notes = { header: ['a'], defs: ['b'], defsTail: ['c'], tail: ['d'] }
  p.pages[0].preview = { x: [undefined, , 3] as unknown as number[] }
  p.pages[0].natives = undefined
  expect(projectText(p)).toBe(JSON.stringify(p))
  const parsed = JSON.parse(projectText(p))
  expect(Object.hasOwn(parsed.pages[0].scene.root[0].attrs, '__proto__')).toBe(true)
  expect(parsed.pages[0].preview.x).toEqual([null, null, 3])
  expect({}.hasOwnProperty.call({}, 'polluted')).toBe(false)
})

it('projects only declared root fields and rejects cycles and executable values', () => {
  const p = newProject()
  Object.assign(p, { consent: true, fontBytes: [1, 2], registry: { face: 'secret' } })
  expect(JSON.parse(projectText(p))).not.toHaveProperty('consent')
  expect(projectText(p)).not.toContain('secret')
  p.pages[0].scene.header.cycle = []
  ;(p.pages[0].scene.header.cycle as Value[]).push(p.pages[0].scene.header.cycle)
  expect(() => projectText(p)).toThrow(/cycl/i)
  p.pages[0].scene.header = { bad: (() => 'x') as unknown as Value }
  expect(() => projectText(p)).toThrow(/data|function/i)
})

it.each(['2.AA', '0.AA', '1.', '1.A', '1.AA=', '1.not-gzip', '1.A A'])('rejects invalid codec %s', async token => {
  await expect(decompressProject(token)).rejects.toThrow(token.startsWith('2.') || token.startsWith('0.') ? /codec/i : /project|token|gzip/i)
})

it('rejects CRC corruption and invalid UTF-8', async () => {
  const bytes = gzipSync(projectText(newProject()))
  bytes[bytes.length - 8] ^= 1
  await expect(decompressProject('1.' + bytes.toString('base64url'))).rejects.toThrow()
  await expect(decompressProject('1.' + gzipSync(Buffer.from([0xff])).toString('base64url'))).rejects.toThrow(/UTF|decode|compressed/i)
})

it('gives unsupported compression APIs a reason while JSON remains usable', async () => {
  vi.stubGlobal('CompressionStream', undefined)
  await expect(compressProject(newProject())).rejects.toThrow('download JSON')
  const token = '1.' + gzipSync(projectText(newProject())).toString('base64url')
  vi.stubGlobal('DecompressionStream', undefined)
  await expect(decompressProject(token)).rejects.toThrow(/unavailable/i)
  expect(readProject(projectText(newProject())).project.pages).toHaveLength(1)
})

it('loads a short token with a large expansion without truncation', async () => {
  const p = newProject()
  p.customLua = '-- ' + 'x'.repeat(4_000_000)
  const text = projectText(p), token = await compressProject(p)
  expect(token.length).toBeLessThan(8_000)
  const decoded = await decompressProject(token)
  expect(new TextEncoder().encode(decoded).length).toBe(new TextEncoder().encode(text).length)
  expect(readProject(decoded).project.customLua).toBe(p.customLua)
}, 30_000)

it('runs text/compress/token/Lua read operations through packed worker messages', async () => {
  const p = fixtureProjects()['page-fonts']
  const compressed = await answer({ id: 1, kind: 'compress', project: pack(p) })
  expect(compressed.ok).toBe(true)
  if (!compressed.ok || typeof compressed.value !== 'string') throw new Error('missing token')
  for (const [kind, text] of [['token', compressed.value], ['lua', 'error("never execute")\n--[==[ vectorbuilder:project ' + compressed.value + ' ]==]']] as const) {
    const result = await answer({ id: 2, kind: 'read', format: kind, text })
    expect(result.ok).toBe(true)
    if (!result.ok || typeof result.value !== 'object' || !('project' in result.value)) throw new Error('missing project')
    expect(projectText(unpack(result.value.project) as typeof p)).toBe(projectText(readProject(projectText(p)).project))
  }
  const foreign = await answer({ id: 3, kind: 'read', format: 'lua', text: 'error("never execute")' })
  expect(foreign).toEqual({ id: 3, ok: true, value: { kind: 'foreign', lua: 'error("never execute")' } })
})

it('times out large expansion honestly without changing current state or losing its token', async () => {
  const p = newProject(); p.customLua = 'x'.repeat(4_000_000)
  const token = await compressProject(p), current = initialState(), original = projectText(current.project)
  const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker, 1)
  const reading = transfer.read(token, 'token')
  await expect(reading).rejects.toThrow('Project transfer could not complete here; use the original JSON file')
  expect(w.terminated).toBe(true)
  expect(w.last().text).toBe(token)
  expect(projectText(current.project)).toBe(original)
  // The retained token still restores the full project with a sufficient worker budget.
  expect(readProject(await decompressProject(token)).project.customLua.length).toBe(4_000_000)
  transfer.dispose()
}, 30_000)

it('never serializes browser records attached to model containers', () => {
  const p = newProject()
  Object.assign(p.pages[0], { consent: true, fontBytes: [1, 2], loaderRecords: ['private'] })
  Object.assign(p.pages[0].scene, { cachedFaces: ['private'] })
  p.pages[0].scene.root = [{ op: 'R', attrs: { constructor: 'kept' } }]
  Object.assign(p.pages[0].scene.root[0], { registry: ['private'] })
  expect(projectText(p)).not.toMatch(/consent|fontBytes|loaderRecords|cachedFaces|registry|private/)
  expect(readProject(JSON.stringify(p)).project.pages[0]).not.toHaveProperty('consent')
  expect(readProject(JSON.stringify(p)).project.pages[0].scene).not.toHaveProperty('cachedFaces')
  expect(readProject(JSON.stringify(p)).project.pages[0].scene.root[0].attrs.constructor).toBe('kept')
})

it('round-trips the entire rich corpus through packed read results', async () => {
  for (const p of Object.values(fixtureProjects())) {
    const token = await compressProject(p)
    expect(await decompressProject(token)).toBe(projectText(p))
    const w = new FakeWorker(), transfer = new ProjectTransfer(() => w as unknown as Worker)
    try {
      const reading = transfer.read(token, 'token')
      w.reply(await answer(w.last() as Parameters<typeof answer>[0]))
      const once = await reading
      expect(projectText(once.project)).toBe(projectText(reducer(initialState(), { type: 'loadProject', project: p }).project))
      expect(projectText(reducer(initialState(), { type: 'loadProject', project: once.project }).project)).toBe(projectText(once.project))
    } finally { transfer.dispose() }
  }
})

it('cancels expansion immediately at the engine string ceiling with a readable reason', async () => {
  let pulls = 0
  const cancelled = vi.fn()
  const expanded = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ < 3) controller.enqueue(new TextEncoder().encode('abc'))
      else controller.close()
    }, cancel: cancelled,
  }, { highWaterMark: 0 })
  vi.stubGlobal('DecompressionStream', class {
    readable = expanded
    writable = new WritableStream()
  })
  await expect(decompressProject(declaredToken(9), 5)).rejects.toThrow(/engine.*string.*limit.*5.*original JSON/i)
  expect(pulls).toBe(2)
  expect(cancelled).toHaveBeenCalledOnce()
  expect(expanded.locked).toBe(false)
})

it('accepts the exact ceiling counted as UTF-16 units across split UTF-8 chunks', async () => {
  let pulls = 0
  const cancelled = vi.fn(), bytes = new TextEncoder().encode('a€🚀')
  const expanded = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls < bytes.length) controller.enqueue(bytes.slice(pulls, ++pulls))
      else controller.close()
    }, cancel: cancelled,
  }, { highWaterMark: 0 })
  vi.stubGlobal('DecompressionStream', class {
    readable = expanded
    writable = new WritableStream()
  })
  expect(await decompressProject(declaredToken(bytes.length), 4)).toBe('a€🚀')
  expect(cancelled).not.toHaveBeenCalled()
  expect(expanded.locked).toBe(false)
})

it('measures the running engine ceiling instead of a guessed project cap', async () => {
  let pulls = 0, decodes = 0
  const cancelled = vi.fn()
  const expanded = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ < 3) controller.enqueue(new Uint8Array([97]))
      else controller.close()
    }, cancel: cancelled,
  }, { highWaterMark: 0 })
  vi.stubGlobal('DecompressionStream', class {
    readable = expanded
    writable = new WritableStream()
  })
  // V8 repeat creates ropes: these length reports never allocate a flat half-gigabyte string.
  vi.stubGlobal('TextDecoder', class {
    decode(bytes?: Uint8Array) { return bytes ? decodes++ === 0 ? 'x'.repeat(constants.MAX_STRING_LENGTH) : 'x' : '' }
  })
  await expect(decompressProject(declaredToken(3))).rejects.toThrow('engine string limit of ' + constants.MAX_STRING_LENGTH)
  expect(pulls).toBe(2)
  expect(cancelled).toHaveBeenCalledOnce()
  expect(expanded.locked).toBe(false)
})

it('cancels and unlocks the stream when fatal UTF-8 decoding fails', async () => {
  const cancelled = vi.fn()
  const expanded = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array([0xff])) }, cancel: cancelled,
  }, { highWaterMark: 0 })
  vi.stubGlobal('DecompressionStream', class {
    readable = expanded
    writable = new WritableStream()
  })
  await expect(decompressProject(declaredToken(1))).rejects.toThrow(/UTF-8|decoded/i)
  expect(cancelled).toHaveBeenCalledOnce()
  expect(expanded.locked).toBe(false)
})

it('accepts a 7,996-character token expanding to 6,138,404 characters and rejects an oversized link', async () => {
  const text = 'x'.repeat(6_138_404)
  const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  const token = '1.' + Buffer.from(bytes).toString('base64url')
  expect(bytes.length).toBe(5995)
  expect(token.length).toBe(7996)
  expect(() => fragmentToken('#p=' + token + 'AA')).toThrow(/7998.*8000/)
  expect(await decompressProject(fragmentToken('#p=' + token)!)).toBe(text)
})

it('accepts the 5,996-byte repeated-byte fixture at its actual 7,997-character token length', async () => {
  const text = 'a'.repeat(6_138_404)
  const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  const token = '1.' + Buffer.from(bytes).toString('base64url')
  expect(bytes.length).toBe(5996)
  expect(token.length).toBe(7997)
  expect(() => fragmentToken('#p=' + token + 'A')).toThrow(/7998.*8000/)
  expect(await decompressProject(fragmentToken('#p=' + token)!)).toBe(text)
})

it('cancels corrupt expansion at the first chunk exceeding ISIZE without reading the rest', async () => {
  let pulls = 0
  const cancelled = vi.fn()
  const expanded = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ < 4) controller.enqueue(new TextEncoder().encode('abc'))
      else controller.close()
    }, cancel: cancelled,
  }, { highWaterMark: 0 })
  vi.stubGlobal('DecompressionStream', class { readable = expanded; writable = new WritableStream() })
  await expect(decompressProject(declaredToken(5))).rejects.toThrow(/corrupt.*declared.*5/i)
  expect(pulls).toBe(2)
  expect(cancelled).toHaveBeenCalledOnce()
  expect(expanded.locked).toBe(false)
})

it('refuses a declaration above three times the engine ceiling before decoding', async () => {
  const made = vi.fn()
  vi.stubGlobal('DecompressionStream', class { constructor() { made() } })
  await expect(decompressProject(declaredToken(31), 10)).rejects.toThrow(/declares.*31.*30/i)
  expect(made).not.toHaveBeenCalled()
})

it('decodes an honest gzip declaration from a Blob in the worker', async () => {
  const p = newProject(), text = projectText(p), token = await compressProject(p)
  const gzip = Buffer.from(token.slice(2), 'base64url')
  expect(gzip.readUInt32LE(gzip.length - 4)).toBe(new TextEncoder().encode(text).length)
  expect(await decompressProject(token)).toBe(text)
  const result = await answer({ id: 7, kind: 'read', format: 'token', text: new Blob([token]) })
  expect(result).toEqual({ id: 7, ok: true, value: { project: pack(readProject(text).project), notice: readProject(text).notice } })
})
