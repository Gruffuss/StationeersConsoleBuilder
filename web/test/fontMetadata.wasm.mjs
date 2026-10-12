// Run after publishing/copying the core: node test/fontMetadata.wasm.mjs
// Exercises the published browser-WASM runtime under Node; it does not replace browser acceptance.
import assert from 'node:assert/strict'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { brotliCompressSync } from 'node:zlib'

async function boot() {
  const { dotnet } = await import('../public/_framework/dotnet.js')
  const runtime = await dotnet.withModuleConfig({ onAbort: why => parentPort?.postMessage({ fatal: String(why) }),
    onExit: code => parentPort?.postMessage({ fatal: `runtime exited (${code})` }) }).create()
  const api = (await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)).VectorBuilder.Wasm.Exports
  return { runtime, api }
}

if (!isMainThread) {
  const { runtime, api } = await boot()
  parentPort.on('message', ({ data, action }) => {
    if (action === 'exit') return runtime.exit(17)
    if (action === 'wait') return Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
    const start = performance.now(), before = runtime.Module.HEAPU8.buffer.byteLength
    const result = JSON.parse(api.ReadFontMetadata(new Uint8Array(data)))
    // WASM linear memory grows but never shrinks: after is this runtime's allocated high-water mark.
    parentPort.postMessage({ result, ms: performance.now() - start, before, peakWasmBytes: runtime.Module.HEAPU8.buffer.byteLength })
  })
  parentPort.postMessage({ ready: true })
} else {
  const { api } = await boot()
  const loaded = JSON.parse(await api.Load(String.raw`
    ic.mem_write(0, 42)
    local ui = ss.ui.surface('main'); ss.ui.activate('main')
    ui:element({id='s',type='vector',rect={unit='px',x=0,y=0,w=480,h=480},props={src='SCENE w=100 h=100\nR w=10 h=10 f=#fff'}})
    function tick(dt) ic.mem_write(0, ic.mem_read(0) + 1) end
  `, 480, 480, '{}', '{}'))
  assert.equal(loaded.state, 'Running', loaded.error); assert.equal(loaded.memory[0], 42)
  let ticks = 0, chipQueue = Promise.resolve()
  function checkChip() { return chipQueue = chipQueue.then(async () => {
    const status = JSON.parse(await api.Tick()); assert.equal(status.state, 'Running'); assert.equal(status.memory[0], 42 + ++ticks)
    assert.equal(new TextDecoder().decode(api.Frame('main', 1, false).subarray(0, 4)), 'VBF1')
  }) }
  const workers = new Set()
  async function worker() {
    const w = new Worker(new URL(import.meta.url)); workers.add(w)
    await new Promise((resolve, reject) => { w.once('error', reject); w.once('message', m => m.ready ? resolve() : reject(new Error('worker did not boot'))) })
    return w
  }
  async function read(w, message) {
    return new Promise(resolve => {
      const done = m => { clearTimeout(timer); w.off('message', done); w.off('error', error); w.off('exit', exit); resolve(m) }
      const error = e => done({ fatal: e.message }), exit = code => done({ fatal: `worker exited (${code})` })
      const timer = setTimeout(() => { w.terminate(); done({ timeout: true }) }, 5000)
      w.once('message', done); w.once('error', error); w.once('exit', exit)
      w.postMessage(message)
    })
  }
  function names(texts = ['Test Family', 'Regular']) {
    const bytes = texts.map(t => Buffer.from(t, 'utf16le').swap16()), start = 6 + 12 * texts.length
    const b = Buffer.alloc(start + bytes.reduce((n, v) => n + v.length, 0)); b.writeUInt16BE(texts.length, 2); b.writeUInt16BE(start, 4)
    let at = 0
    bytes.forEach((v, i) => { const r = 6 + 12 * i; b.writeUInt16BE(3, r); b.writeUInt16BE(1, r + 2); b.writeUInt16BE(0x409, r + 4)
      b.writeUInt16BE(i < 2 ? i + 1 : 254 + i, r + 6); b.writeUInt16BE(v.length, r + 8); b.writeUInt16BE(at, r + 10); v.copy(b, start + at); at += v.length })
    return b
  }
  function base128(n) { const bytes = [n & 127]; while ((n = Math.floor(n / 128))) bytes.unshift(128 | (n & 127)); return Buffer.from(bytes) }
  function woff(table, extra = 0, fvar = Buffer.alloc(0)) {
    const compressed = brotliCompressSync(Buffer.concat([table, fvar]))
    const dir = Buffer.concat([Buffer.from([5]), base128(table.length + extra), ...(fvar.length ? [Buffer.from([47]), base128(fvar.length)] : [])])
    const b = Buffer.alloc(48 + dir.length + compressed.length); b.write('wOF2'); b.writeUInt32BE(0x10000, 4)
    b.writeUInt32BE(b.length, 8); b.writeUInt16BE(fvar.length ? 2 : 1, 12); b.writeUInt32BE(compressed.length, 20); dir.copy(b, 48); compressed.copy(b, 48 + dir.length)
    return b
  }
  const pulse = setInterval(() => { checkChip().catch(() => {}) }, 200)
  try {
    const w = await worker(), metadata = names()
    const sfnt = Buffer.alloc(28 + metadata.length); sfnt.writeUInt32BE(0x10000); sfnt.writeUInt16BE(1, 4); sfnt.write('name', 12)
    sfnt.writeUInt32BE(28, 20); sfnt.writeUInt32BE(metadata.length, 24); metadata.copy(sfnt, 28)
    for (const data of [sfnt, woff(metadata)]) {
      const observed = await read(w, { data }); assert.equal(observed.result?.status, 'ok', JSON.stringify(observed)); assert.equal(observed.result.family, 'Test Family')
      console.log(JSON.stringify({ case: data === sfnt ? 'SFNT' : 'WOFF2 native Brotli', status: observed.result.status, ms: observed.ms, peakWasmBytes: observed.peakWasmBytes })); await checkChip()
    }
    for (const id of [10, 1]) for (const length of [2, 1]) {
      const extra = Buffer.alloc(metadata.length + 14); extra.writeUInt16BE(3, 2); extra.writeUInt16BE(42, 4)
      metadata.subarray(6, 30).copy(extra, 18); metadata.subarray(30).copy(extra, 42)
      extra.writeUInt16BE(3, 6); extra.writeUInt16BE(1, 8); extra.writeUInt16BE(0x409, 10)
      extra.writeUInt16BE(id, 12); extra.writeUInt16BE(length, 14); extra.writeUInt16BE(metadata.length - 30, 16)
      extra.writeUInt16BE(0xd800, extra.length - 2)
      const observed = await read(w, { data: woff(extra) })
      assert.equal(observed.result?.status, 'ok', JSON.stringify(observed))
      assert.equal(observed.result.family, 'Test Family')
      if (id === 1) assert.match(observed.result.notes[0], /skipped name record 0 \(ID 1\)/)
      else assert.ok(!observed.result.names[10])
    }
    console.log('PASS published WASM skips unused/bad alternate Unicode records and reports notes')
    const fvar = Buffer.alloc(36 + 8 * 3000); fvar.writeUInt16BE(1); fvar.writeUInt16BE(16, 4); fvar.writeUInt16BE(2, 6)
    fvar.writeUInt16BE(1, 8); fvar.writeUInt16BE(20, 10); fvar.writeUInt16BE(3000, 12); fvar.writeUInt16BE(8, 14)
    fvar.write('wght', 16); fvar.writeUInt32BE(100 << 16, 20); fvar.writeUInt32BE(400 << 16, 24); fvar.writeUInt32BE(900 << 16, 28); fvar.writeUInt16BE(256, 34)
    for (let i = 0; i < 3000; i++) { fvar.writeUInt16BE(257, 36 + 8 * i); fvar.writeUInt32BE(700 << 16, 40 + 8 * i) }
    const instances = await read(w, { data: woff(names(['x'.repeat(32740), 'Regular', 'Weight', 'Bold']), 0, fvar) })
    assert.equal(instances.result?.status, 'read-budget', JSON.stringify(instances))
    assert.match(instances.result.cause, /available runtime memory/)
    assert.equal((await read(w, { data: woff(metadata) })).result.status, 'ok')
    console.log(JSON.stringify({ case: '3000 instances repeat a long family', ...instances }))
    const malformed = await read(w, { data: woff(metadata, 1) }); assert.equal(malformed.result.status, 'invalid'); await checkChip()
    const corrupt = woff(metadata); corrupt[corrupt.length - 1] ^= 255
    assert.equal((await read(w, { data: corrupt })).result.status, 'invalid'); await checkChip()
    const hugeHeader = woff(metadata); hugeHeader.writeUInt32BE(0xffffffff, 16)
    assert.equal((await read(w, { data: hugeHeader })).result.status, 'ok'); await checkChip()
    const large = Buffer.alloc(160 * 1024 * 1024); metadata.copy(large)
    const budget = await read(w, { data: woff(large) }); assert.equal(budget.result?.status, 'read-budget', JSON.stringify(budget)); await checkChip()
    console.log(JSON.stringify({ case: '160 MiB valid name table', status: budget.result.status, ms: budget.ms, peakWasmBytes: budget.peakWasmBytes }))
    // Fatal exit and an unresponsive job exercise worker isolation without adding fault-injection exports to the app.
    const fatal = await read(w, { action: 'exit' }); assert.ok(fatal.fatal); await checkChip(); console.log(JSON.stringify({ case: 'runtime exit', ...fatal }))
    const hung = await worker(), timeout = await read(hung, { action: 'wait' }); assert.ok(timeout.timeout); await checkChip()
    console.log(JSON.stringify({ case: 'blocked job watchdog', ...timeout }))
    const replacement = await worker(); assert.equal((await read(replacement, { data: woff(metadata) })).result.status, 'ok'); await checkChip()
    console.log(`PASS published WASM metadata; real chip retained memory through ${ticks} ticks/frames`)
  } finally { clearInterval(pulse); await chipQueue; await Promise.all([...workers].map(w => w.terminate())) }
}
