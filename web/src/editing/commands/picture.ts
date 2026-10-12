import type { SrcNode } from '../../model/scene'
import { fieldsFor } from '../../schema'
import { foldKey } from '../../srctext/props'
import { withAttr } from '../../editor/fields'
import { IMAGE } from '../tree'

export default [] // The property panel supplies the source; there is no menu or key entry.

export const picturePlaceholder = (n: SrcNode) => foldKey(n.op) === 'R' && !!n.comments?.some(c => c.trim().toLowerCase() === IMAGE)

/** Source edits are paint edits: locks and expression geometry stay as written. */
export function pictureSource(n: SrcNode, src: string): SrcNode {
  if (foldKey(n.op) === 'IMG') return withAttr(n, 'src', src)
  if (!picturePlaceholder(n)) return n
  const keys = new Set(fieldsFor('IMG').map(f => foldKey(f.key)))
  return withAttr({ ...n, op: 'IMG', attrs: Object.fromEntries(Object.entries(n.attrs).filter(([k]) => keys.has(foldKey(k)))),
    comments: n.comments?.filter(c => c.trim().toLowerCase() !== IMAGE && !/^style(?:\s|$)/i.test(c.trim())) }, 'src', src)
}

export async function pictureFile(file: File): Promise<{ src: string; bytes: number }> {
  const b = new Uint8Array(await file.arrayBuffer())
  const type = b.length >= 8 && b[0] === 0x89 && b[1] === 80 && b[2] === 78 && b[3] === 71 ? 'png'
    : b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'jpeg'
    : b.length >= 2 && b[0] === 66 && b[1] === 77 ? 'bmp'
    : b.length >= 6 && b[0] === 71 && b[1] === 73 && b[2] === 70 ? 'gif' : undefined
  if (!type) throw new Error('the game reads PNG, JPEG, BMP and GIF')
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(`data:image/${type};base64,${String(reader.result).split(',')[1]}`)
    reader.onerror = () => reject(reader.error ?? new Error('the picture file could not be read'))
    reader.onabort = () => reject(new Error('the picture file read was cancelled'))
    reader.readAsDataURL(file)
  })
  // What the page grows by: the data URL is written into the scene text whole (ASCII, one byte a character).
  return { src, bytes: src.length }
}
