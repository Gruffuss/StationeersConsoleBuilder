// The game's hash of a name: signed CRC-32/IEEE over the UTF-8 bytes (checked on all 1,786 pages of the game's Stationpedia
// export, build 0.2.6428.27798). No imports: Node runs this under tools/ too.
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
/** CRC-32/IEEE of bytes, unsigned, as a zip entry records it. */
export function crc32Bytes(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
export function crc32(s: string): number {
  return crc32Bytes(new TextEncoder().encode(s)) | 0
}
