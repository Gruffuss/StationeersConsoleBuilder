// Decodes pictures at the mod's size limit (4096×4096 = 16,777,216 pixels) in the published core, twice each, the way
// the preview's worker calls it, beside a running chip:
//   node test/pictureMemory.mjs [side] [bytes|dataurl ...] [bmp8|bmp24|bmp32|gif ...] [notes] [chip=<n>]
// bytes reads fetched files, dataurl reads data: URLs; notes accepts a "too large to preview here" note in place of
// pixels; chip=<n> makes the chip hold n strings of a million characters. Prints one JSON line per read (milliseconds,
// the wasm memory's size afterwards) and exits 0 only when every read returned the right pixels (or an accepted note)
// and the core and the chip still answer afterwards. Run after publishing and copying the core (web/copy-core.mjs).
import assert from 'node:assert/strict'

const args = process.argv.slice(2)
const side = Number(args.find(a => /^\d+$/.test(a)) ?? 4096)
const paths = args.filter(a => a === 'bytes' || a === 'dataurl')
const formats = args.filter(a => /^(bmp8|bmp24|bmp32|gif)$/.test(a))

const index = (x, y) => (x * 7 + y * 13) & 255
const palette = i => [(i * 5) & 255, 255 - i, i]  // r, g, b
const expected = {
  bmp8: (x, y) => [...palette(index(x, y)), 255],
  bmp24: (x, y) => [x & 255, y & 255, (x + y) & 255, 255],
  bmp32: (x, y) => [x & 255, y & 255, (x + y) & 255, (x ^ y) & 255 || 255],
  gif: (x, y) => [...palette(index(x, y)), 255],
}

function bmp(w, h, bits) {
  const paletteBytes = bits === 8 ? 1024 : 0, stride = Math.floor((w * bits + 31) / 32) * 4, offset = 54 + paletteBytes
  const b = Buffer.alloc(offset + stride * h)
  b.write('BM'); b.writeInt32LE(b.length, 2); b.writeInt32LE(offset, 10); b.writeInt32LE(40, 14)
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(bits, 28)
  if (bits === 8) {
    b.writeInt32LE(256, 46)
    for (let i = 0; i < 256; i++) { const [r, g, bl] = palette(i); b[54 + i * 4] = bl; b[55 + i * 4] = g; b[56 + i * 4] = r }
  }
  const want = expected[`bmp${bits}`]
  for (let y = 0; y < h; y++) {
    const row = offset + (h - 1 - y) * stride  // bottom-up
    for (let x = 0; x < w; x++) {
      if (bits === 8) { b[row + x] = index(x, y); continue }
      const [r, g, bl] = want(x, y), at = row + x * (bits / 8)
      b[at] = bl; b[at + 1] = g; b[at + 2] = r
      if (bits === 32) b[at + 3] = (x ^ y) & 255
    }
  }
  return b
}

// Every pixel a 9-bit literal code, with a clear code before the table would widen the codes to 10 bits.
function gif(w, h) {
  const head = Buffer.alloc(13 + 768 + 10 + 1)
  head.write('GIF89a'); head.writeUInt16LE(w, 6); head.writeUInt16LE(h, 8); head[10] = 0xf7
  for (let i = 0; i < 256; i++) head.set(palette(i), 13 + i * 3)
  let at = 13 + 768
  head[at] = 0x2c; head.writeUInt16LE(w, at + 5); head.writeUInt16LE(h, at + 7); head[at + 10] = 8
  const count = w * h, codes = count + Math.ceil(count / 254) + 1
  const data = Buffer.alloc(Math.ceil(codes * 9 / 8) + 2)
  let bit = 0
  const put = code => {
    for (let k = 0; k < 9; k++, bit++) if (code & (1 << k)) data[bit >> 3] |= 1 << (bit & 7)
  }
  for (let i = 0; i < count; i++) {
    if (i % 254 === 0) put(256)
    put(index(i % w, Math.floor(i / w)))
  }
  put(257)
  const used = Math.ceil(bit / 8), blocks = Math.ceil(used / 255)
  const body = Buffer.alloc(used + blocks + 2)
  let out = 0
  for (let from = 0; from < used; from += 255) {
    const size = Math.min(255, used - from)
    body[out++] = size; data.copy(body, out, from, from + size); out += size
  }
  body[out++] = 0; body[out++] = 0x3b
  return Buffer.concat([head, body])
}

const make = { bmp8: () => bmp(side, side, 8), bmp24: () => bmp(side, side, 24), bmp32: () => bmp(side, side, 32), gif: () => gif(side, side) }

const { dotnet } = await import('../public/_framework/dotnet.js')
const fatal = why => { console.log(JSON.stringify({ fatal: String(why) })); process.exit(1) }
let finished = false
const runtime = await dotnet.withModuleConfig({ onAbort: fatal,
  onExit: code => finished ? process.exit(code) : fatal(`the runtime exited (code ${code})`) }).create()
const api = (await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)).VectorBuilder.Wasm.Exports
const heap = () => runtime.localHeapViewU8().buffer.byteLength

// One read as core.worker.ts makes it: the metadata, and the pixels top row first (the reply is bottom row first).
function decode(path, file) {
  const input = path === 'bytes' ? new Uint8Array(file.buffer, file.byteOffset, file.length)
    : new TextEncoder().encode(`data:application/octet-stream;base64,${file.toString('base64')}`)
  const room = api.PictureInput(input.length)
  if (room.length) room.set(input)
  room.dispose()
  const view = path === 'bytes' ? api.ReadPictureBytes() : api.ReadPicture()
  const reply = view.slice()
  view.dispose()
  assert.equal(new TextDecoder().decode(reply.subarray(0, 4)), 'VBP1')
  const at = 8 + new DataView(reply.buffer, reply.byteOffset).getInt32(4, true)
  const meta = JSON.parse(new TextDecoder().decode(reply.subarray(8, at))), rows = reply.subarray(at), row = meta.width * 4
  if (meta.error !== undefined || meta.note !== undefined) return meta
  const pixels = Buffer.alloc(rows.length)
  for (let y = 0; y < meta.height; y++) pixels.set(rows.subarray((meta.height - 1 - y) * row, (meta.height - y) * row), y * row)
  return { ...meta, pixels }
}

// chip=<n>: a running chip that holds n strings of a million characters (two bytes each) while the pictures are read.
const chip = Number(args.find(a => a.startsWith('chip='))?.slice(5) ?? 0)
// notes: a note that the picture does not fit is an accepted outcome; the core must still answer after it.
const notes = args.includes('notes')
const lua = `held = {} for i = 1, ${chip} do held[i] = string.rep('x', 1000000) .. i end
local ui = ss.ui.surface('main') ui:element({ id = 's', type = 'vector', rect = { unit = 'px', x = 0, y = 0, w = 10, h = 10 },
  props = { src = 'SCENE w=10 h=10\\nR w=10 h=10 f=#123456' } })
function tick() ic.mem_write(0, ic.mem_read(0) + #held) end`
const loaded = JSON.parse(await api.Load(lua, 10, 10, '{}', '{}'))
assert.equal(loaded.state, 'Running', loaded.error)

console.log(JSON.stringify({ side, chip, start: heap() }))
for (const format of formats.length ? formats : Object.keys(make)) {
  const file = make[format]()
  for (const path of paths.length ? paths : ['bytes']) for (let round = 1; round <= 2; round++) {
    const started = performance.now()
    const r = decode(path, file)
    const ms = Math.round(performance.now() - started)
    if (notes && r.note !== undefined) {
      assert.match(r.note, /^too large to preview here: /)
      console.log(JSON.stringify({ format, path, round, bytes: file.length, ms, heap: heap(), note: r.note }))
      continue
    }
    assert.equal(r.error ?? r.note, undefined, `${format} ${path} ${round}: ${r.error ?? r.note}`)
    assert.deepEqual([r.format, r.width, r.height], [format.slice(0, 3), side, side])
    assert.equal(r.pixels.length, side * side * 4)
    for (const [x, y] of [[0, 0], [side - 1, 0], [0, side - 1], [side - 1, side - 1], [side >> 1, side >> 2], [1234 % side, 3333 % side]]) {
      const at = (y * side + x) * 4
      assert.deepEqual([...r.pixels.subarray(at, at + 4)], expected[format](x, y), `${format} ${path} pixel ${x},${y}`)
    }
    console.log(JSON.stringify({ format, path, round, bytes: file.length, ms, heap: heap() }))
  }
}
// The core still answers after the large reads, and the chip still runs and draws.
assert.equal(decode('dataurl', Buffer.from('iVBORw0KGgo=', 'base64')).format, 'png')
const ticked = JSON.parse(await api.Tick())
assert.equal(ticked.state, 'Running', ticked.error)
const frame = api.Frame('main', 1, false).slice()
assert.equal(new TextDecoder().decode(frame.subarray(0, 4)), 'VBF3')
console.log('pictures at the limit clean')
finished = true
runtime.exit(0)
