import { crc32Bytes as checksum } from '../../catalog/crc32'
import { safePath } from './types'

const cp437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

export async function readZip(bytes: Uint8Array, used?: (path: string) => boolean): Promise<{ files: Map<string, Uint8Array>; notes: string[] }> {
  const files = new Map<string, Uint8Array>(), notes: string[] = []
  try {
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
    const range = (offset: number, length: number) => {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > bytes.length - length) throw new Error('truncated zip data')
    }
    const u16 = (p: number) => { range(p,2); return view.getUint16(p,true) }
    const u32 = (p: number) => { range(p,4); return view.getUint32(p,true) }
    const u64 = (p: number) => { range(p,8); const n = view.getBigUint64(p,true); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('zip offset or size cannot be addressed here'); return Number(n) }
    let eocd = -1
    // The ZIP comment length is a 16-bit field in the format.
    for (let p = bytes.length-22; p >= Math.max(0,bytes.length-22-65535); p--) if (u32(p) === 0x06054b50 && p+22+u16(p+20) === bytes.length) { eocd = p; break }
    if (eocd < 0) throw new Error('end of central directory not found')
    if (u16(eocd+4) !== 0 || u16(eocd+6) !== 0) throw new Error('multi-disk zip is not supported')
    let count = u16(eocd+10), directorySize = u32(eocd+12), directory = u32(eocd+16)
    if (count === 0xffff || directorySize === 0xffffffff || directory === 0xffffffff) {
      const locator = eocd-20
      if (u32(locator) !== 0x07064b50 || u32(locator+4) !== 0 || u32(locator+16) !== 1) throw new Error('unreadable zip64 locator')
      const z = u64(locator+8)
      if (u32(z) !== 0x06064b50 || u64(z+4) < 44 || u32(z+16) !== 0 || u32(z+20) !== 0 || u64(z+24) !== u64(z+32)) throw new Error('unreadable zip64 directory')
      range(z,12+u64(z+4))
      count = u64(z+32); directorySize = u64(z+40); directory = u64(z+48)
    } else if (u16(eocd+8) !== count) throw new Error('multi-disk entry count')
    range(directory,directorySize)
    if (directory+directorySize > eocd) throw new Error('central directory overlaps its trailer')
    const zip64 = (extra: number, length: number, fields: number[]): number[] => {
      range(extra,length); const result = [...fields], missing = new Set(fields.flatMap((n,i) => n === 0xffffffff ? [i] : []))
      for (let p = extra; p < extra+length;) {
        range(p,4); const id = u16(p), size = u16(p+2); p += 4
        if (p+size > extra+length) throw new Error('truncated extra field')
        if (id === 1) {
          let at = p
          for (let i = 0; i < fields.length; i++) if (fields[i] === 0xffffffff) { if (at+8 > p+size) throw new Error('missing zip64 size or offset'); result[i] = u64(at); missing.delete(i); at += 8 }
        }
        p += size
      }
      if (missing.size) throw new Error('missing zip64 extra field')
      return result
    }
    const namesEqual = (a: Uint8Array,b: Uint8Array) => a.length === b.length && a.every((x,i) => x === b[i])
    let p = directory
    for (let i = 0; i < count; i++) {
      if (p+46 > directory+directorySize || u32(p) !== 0x02014b50) throw new Error('unreadable central entry')
      const flags = u16(p+8), method = u16(p+10), crc = u32(p+16), nameSize = u16(p+28), extraSize = u16(p+30), commentSize = u16(p+32)
      const next = p+46+nameSize+extraSize+commentSize
      if (next > directory+directorySize) throw new Error('truncated central entry')
      const rawName = bytes.subarray(p+46,p+46+nameSize)
      let name: string
      try { name = flags & 0x800 ? new TextDecoder('utf-8',{ fatal: true }).decode(rawName) : Array.from(rawName,b => b < 128 ? String.fromCharCode(b) : cp437[b-128]).join('') }
      catch { notes.push('zip entry ' + (i+1) + ': invalid UTF-8 name'); p = next; continue }
      try {
        const path = safePath(name)
        if (!path) throw new Error('refused path')
        if (flags & 0x41) throw new Error('encrypted entry skipped')
        if (method !== 0 && method !== 8) throw new Error('compression method ' + method + ' skipped')
        if (u16(p+34) !== 0) throw new Error('entry on another disk')
        const wide = u32(p+20) === 0xffffffff || u32(p+24) === 0xffffffff
        const [size, compressedSize, local] = zip64(p+46+nameSize,extraSize,[u32(p+24),u32(p+20),u32(p+42)])
        range(local,30)
        if (u32(local) !== 0x04034b50 || u16(local+6) !== flags || u16(local+8) !== method) throw new Error('local header differs from central directory')
        const localNameSize = u16(local+26), localExtraSize = u16(local+28)
        range(local+30,localNameSize+localExtraSize)
        if (!namesEqual(rawName,bytes.subarray(local+30,local+30+localNameSize))) throw new Error('local name differs from central directory')
        const dataStart = local+30+localNameSize+localExtraSize, dataEnd = dataStart+compressedSize
        range(dataStart,compressedSize)
        if (dataEnd > directory) throw new Error('entry overlaps central directory')
        const [localSize, localCompressed] = zip64(local+30+localNameSize,localExtraSize,[u32(local+22),u32(local+18)])
        if (flags & 8) {
          if (u32(local+14) !== 0 && u32(local+14) !== crc || localSize !== 0 && localSize !== size || localCompressed !== 0 && localCompressed !== compressedSize) throw new Error('local descriptor header differs from central directory')
          const desc = u32(dataEnd) === 0x08074b50 ? dataEnd+4 : dataEnd
          const descriptorSize = wide ? 20 : 12
          if (desc+descriptorSize > directory || u32(desc) !== crc || (wide ? u64(desc+4) : u32(desc+4)) !== compressedSize || (wide ? u64(desc+12) : u32(desc+8)) !== size) throw new Error('data descriptor differs from central directory')
        } else if (u32(local+14) !== crc || localSize !== size || localCompressed !== compressedSize) throw new Error('local sizes or checksum differ from central directory')
        if (name.endsWith('/') || name.endsWith('\\')) continue
        if (used && !used(path)) { notes.push(name + ': not used by the design-system importer; not read'); continue }
        let data: Uint8Array
        if (method === 0) data = Uint8Array.from(bytes.subarray(dataStart,dataEnd))
        else {
          const stream = new Blob([Uint8Array.from(bytes.subarray(dataStart,dataEnd)).buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
          const reader = stream.getReader(), chunks: Uint8Array[] = []
          let length = 0
          try {
            while (true) {
              const chunk = await reader.read()
              if (chunk.done) break
              length += chunk.value.length
              if (length > size) {
                await reader.cancel().catch(() => {})
                throw new Error('uncompressed size differs from central directory')
              }
              chunks.push(chunk.value)
            }
          } finally { reader.releaseLock() }
          data = new Uint8Array(length)
          let offset = 0
          for (const chunk of chunks) { data.set(chunk,offset); offset += chunk.length }
        }
        if (data.length !== size) throw new Error('uncompressed size differs from central directory')
        if (checksum(data) !== crc) throw new Error('checksum differs from central directory')
        if (files.has(path)) notes.push(name + ': repeated path; keeping last')
        files.set(path,data)
      } catch (e) {
        notes.push(name + ': ' + (e instanceof RangeError || e instanceof TypeError ? 'could not read this zip here: ' : '') + (e instanceof Error ? e.message : String(e)))
      } finally {
        p = next
      }
    }
    if (p !== directory+directorySize) notes.push('central directory: trailing data not read')
  } catch (e) { notes.push('could not read this zip here: ' + (e instanceof Error ? e.message : String(e))) }
  return { files, notes }
}
