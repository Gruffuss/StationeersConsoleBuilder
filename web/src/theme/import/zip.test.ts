import { crc32, deflateRawSync } from 'node:zlib'
import { expect, it, vi } from 'vitest'
import { readZip } from './zip'
import { systemRoot } from './files'

type Entry = { name: string | Uint8Array; text: string; method?: number; flags?: number; descriptor?: boolean; zip64?: boolean }
function archive(entries: Entry[]): Uint8Array {
  const locals: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = typeof e.name === 'string' ? Buffer.from(e.name) : Buffer.from(e.name), data = Buffer.from(e.text)
    const crc = crc32(data)   // zlib's, independent of the reader's table
    const compressed = e.method === 8 ? deflateRawSync(data) : data
    const flags = (e.flags ?? (typeof e.name === 'string' ? 0x800 : 0)) | (e.descriptor ? 8 : 0)
    const extra = Buffer.alloc(e.zip64 ? 28 : 0)
    if (e.zip64) { extra.writeUInt16LE(1); extra.writeUInt16LE(24, 2); extra.writeBigUInt64LE(BigInt(data.length), 4); extra.writeBigUInt64LE(BigInt(compressed.length), 12); extra.writeBigUInt64LE(BigInt(offset), 20) }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(e.zip64 ? 45 : 20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(e.method ?? 0, 8)
    local.writeUInt32LE(e.descriptor ? 0 : crc, 14); local.writeUInt32LE(e.zip64 ? 0xffffffff : e.descriptor ? 0 : compressed.length, 18); local.writeUInt32LE(e.zip64 ? 0xffffffff : e.descriptor ? 0 : data.length, 22)
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28)
    const descriptor = Buffer.alloc(e.descriptor ? e.zip64 ? 24 : 16 : 0)
    if (e.descriptor) { descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, 4); if (e.zip64) { descriptor.writeBigUInt64LE(BigInt(compressed.length), 8); descriptor.writeBigUInt64LE(BigInt(data.length), 16) } else { descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(data.length, 12) } }
    locals.push(local, name, extra, compressed, descriptor)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(45, 4); c.writeUInt16LE(e.zip64 ? 45 : 20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(e.method ?? 0, 10); c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(e.zip64 ? 0xffffffff : compressed.length, 20); c.writeUInt32LE(e.zip64 ? 0xffffffff : data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt16LE(extra.length, 30); c.writeUInt32LE(e.zip64 ? 0xffffffff : offset, 42)
    central.push(c, name, extra)
    offset += local.length + name.length + extra.length + compressed.length + descriptor.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  if (!entries.some(e => e.zip64)) return Buffer.concat([...locals, directory, end])
  const z = Buffer.alloc(56), locator = Buffer.alloc(20)
  z.writeUInt32LE(0x06064b50); z.writeBigUInt64LE(44n, 4); z.writeUInt16LE(45, 12); z.writeUInt16LE(45, 14); z.writeBigUInt64LE(BigInt(entries.length), 24); z.writeBigUInt64LE(BigInt(entries.length), 32); z.writeBigUInt64LE(BigInt(directory.length), 40); z.writeBigUInt64LE(BigInt(offset), 48)
  locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(offset + directory.length), 8); locator.writeUInt32LE(1, 16)
  end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10); end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16)
  return Buffer.concat([...locals, directory, z, locator, end])
}

it('zips', async () => {
  const zip = await readZip(archive([
    { name: 'design-system/project/tokens.json', text: '{}', zip64: true },
    { name: 'deflated', text: 'compress me', method: 8, descriptor: true },
    { name: 'stored', text: 'first' }, { name: 'stored', text: 'last' },
    { name: new Uint8Array([0x82, 0x2e, 0x74, 0x78, 0x74]), text: 'cp437' },
    { name: 'encrypted', text: 'secret', flags: 1 }, { name: '../x', text: 'bad' }, { name: 'C:/x', text: 'bad' },
    { name: 'unsupported', text: 'bad', method: 12 },
  ]))
  expect(new TextDecoder().decode(zip.files.get('deflated')), zip.notes.join('\n')).toBe('compress me')
  expect(new TextDecoder().decode(zip.files.get('stored'))).toBe('last')
  expect(zip.files.has('é.txt')).toBe(true)
  for (const name of ['encrypted', '../x', 'C:/x', 'unsupported']) { expect(zip.files.has(name)).toBe(false); expect(zip.notes.join('\n')).toContain(name) }
  expect(zip.notes.join('\n')).toMatch(/stored.*repeated/)
  expect(systemRoot(zip.files).files.has('tokens.json')).toBe(true)
})

it('skips inflation of unused entries after validating their headers', async () => {
  const inflate = vi.spyOn(globalThis, 'DecompressionStream')
  try {
    const result = await readZip(archive([
      { name: 'assets/readme-image.png', text: 'image', method: 8 }, { name: 'tokens.json', text: '{}' },
    ]), path => path.endsWith('.json'))
    expect(inflate).not.toHaveBeenCalled()
    expect([...result.files.keys()]).toEqual(['tokens.json'])
    expect(result.notes).toContain('assets/readme-image.png: not used by the design-system importer; not read')
    const invalid = archive([{ name: 'assets/readme-image.png', text: 'image', method: 8 }]); invalid[0] = 0
    expect((await readZip(invalid, () => false)).notes).toContain('assets/readme-image.png: local header differs from central directory')
    expect((await readZip(archive([{ name: '../image.png', text: 'image' }]), () => false)).notes).toContain('../image.png: refused path')
  } finally { inflate.mockRestore() }
})

it('zip directory entries advance to the following files', async () => {
  const zip = await readZip(archive([
    { name: 'dir/', text: '' },
    { name: 'dir/tokens.json', text: '{}' },
    { name: 'dir/README.md', text: 'book' },
  ]))
  expect([...zip.files.keys()]).toEqual(['dir/tokens.json', 'dir/README.md'])
  expect(new TextDecoder().decode(zip.files.get('dir/README.md'))).toBe('book')
  expect(zip.notes).toEqual([])
})

it('zip inflation stops as soon as output exceeds its declared size', async () => {
  const zip = archive([{ name: 'entry', text: 'x'.repeat(1024 * 1024), method: 8 }, { name: 'after', text: 'ok' }])
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const directory = view.getUint32(zip.length - 6, true)
  view.setUint32(22, 1, true)
  view.setUint32(directory + 24, 1, true)
  const Inflate = DecompressionStream
  let consumed = 0, cancelled = false
  vi.stubGlobal('DecompressionStream', class {
    readonly writable: WritableStream<BufferSource>
    readonly readable: ReadableStream<Uint8Array>
    constructor(format: CompressionFormat) {
      const stream = new Inflate(format), reader = stream.readable.getReader()
      this.writable = stream.writable
      this.readable = new ReadableStream({
        async pull(controller) {
          const chunk = await reader.read()
          if (chunk.done) controller.close()
          else { consumed += chunk.value.length; controller.enqueue(chunk.value) }
        },
        async cancel() { cancelled = true; await reader.cancel() },
      }, { highWaterMark: 0 })
    }
  })
  try {
    const result = await readZip(zip)
    expect(result.files.has('entry')).toBe(false)
    expect(new TextDecoder().decode(result.files.get('after'))).toBe('ok')
    expect(result.notes).toEqual(['entry: uncompressed size differs from central directory'])
    expect(consumed).toBeLessThan(1024 * 1024)
    expect(cancelled).toBe(true)
  } finally { vi.unstubAllGlobals() }
})

it('zip local headers, checksums and descriptors are checked', async () => {
  const mismatched = archive([{ name: 'entry', text: 'content' }])
  mismatched[30] = 120
  expect((await readZip(mismatched)).notes.join('\n')).toMatch(/local.*central/)
  const corrupt = archive([{ name: 'entry', text: 'content' }]); corrupt[35] ^= 1
  expect((await readZip(corrupt)).notes.join('\n')).toMatch(/checksum/)
  const descriptor = archive([{ name: 'entry', text: 'content', descriptor: true }]); descriptor[46] ^= 1
  expect((await readZip(descriptor)).notes.join('\n')).toMatch(/descriptor/)
  expect((await readZip(new Uint8Array([1, 2]))).notes.join('\n')).toMatch(/could not read this zip here/)
  const wide = await readZip(archive([{ name: 'wide', text: 'content', method: 8, descriptor: true, zip64: true }]))
  expect(wide.notes).toEqual([])
  expect(new TextDecoder().decode(wide.files.get('wide'))).toBe('content')
  const signed = archive([{ name: 'plain', text: 'content', descriptor: true }])
  const offset = 30 + 5 + 7
  const unsigned = Buffer.concat([signed.subarray(0,offset),signed.subarray(offset+4)])
  unsigned.writeUInt32LE(offset + 12, unsigned.length - 6)
  const read = await readZip(unsigned)
  expect(read.notes).toEqual([])
  expect(new TextDecoder().decode(read.files.get('plain'))).toBe('content')
  const large = archive([{ name: 'large', text: 'x', zip64: true }])
  const view = new DataView(large.buffer, large.byteOffset, large.byteLength)
  view.setBigUint64(39, 0xffffffffn, true)
  view.setBigUint64(119, 0xffffffffn, true)
  const tooShort = await readZip(large)
  expect(tooShort.notes.join('\n')).toMatch(/uncompressed size/)
  expect(tooShort.notes.join('\n')).not.toMatch(/missing zip64/)
})
