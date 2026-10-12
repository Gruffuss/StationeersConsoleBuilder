import { crc32Bytes } from '../../catalog/crc32'

// Stored zip fixture shared by file-route tests.
export function storedZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const locals: Uint8Array[] = [], directory: Uint8Array[] = []; let offset = 0
  for (const [path, data] of files) {
    const name = new TextEncoder().encode(path), local = new Uint8Array(30), central = new Uint8Array(46)
    const l = new DataView(local.buffer), c = new DataView(central.buffer)
    const crc = crc32Bytes(data)
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true)
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true)
    c.setUint32(0, 0x02014b50, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true)
    locals.push(local, name, data); directory.push(central, name); offset += 30 + name.length + data.length
  }
  const size = directory.reduce((n, b) => n + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.size, true); e.setUint16(10, files.size, true); e.setUint32(12, size, true); e.setUint32(16, offset, true)
  const out = new Uint8Array(offset + size + 22); let at = 0
  for (const bytes of [...locals, ...directory, end]) { out.set(bytes, at); at += bytes.length }
  return out
}
