import type { Project } from '../model/project'
import { printChecked } from '../srctext/print'
import { pack, unpack, type Wire } from '../srctext/wire'
import { compressProject, decompressProject, projectText } from './codec'
import { embeddedToken, guardScene, readProject } from './input'

export type Sources = { page: string; src: string }[]
export type ReadWire = { project: Wire; notice: string }
export type ForeignLua = { kind: 'foreign'; lua: string }
export type Body = { kind: 'text' | 'compress' | 'sources'; project: Wire }
  | { kind: 'read'; format: 'json' | 'token' | 'lua'; text: string | Blob }
export type Request = Body & { id: number }
export type Reply = { id: number; ok: true; value: string | Sources | ReadWire | ForeignLua } | { id: number; ok: false; message: string }

export async function answer(request: Request): Promise<Reply> {
  const { id } = request
  try {
    if (request.kind === 'read') {
      let text: string
      try { text = typeof request.text === 'string' ? request.text : await request.text.text() }
      catch (e) {
        if (e instanceof RangeError) throw new Error('Project file is larger than this browser can hold as text; use the original file')
        throw new Error('Project file could not be read here; use the original file: ' + (e instanceof Error ? e.message : String(e)))
      }
      if (request.format === 'lua') {
        const token = embeddedToken(text)
        if (token === null) return { id, ok: true, value: { kind: 'foreign', lua: text } }
        text = await decompressProject(token)
      } else if (request.format === 'token') text = await decompressProject(text)
      const read = readProject(text)
      return { id, ok: true, value: { project: pack(read.project), notice: read.notice } }
    }
    const p = unpack(request.project) as Project
    if (request.kind === 'text') return { id, ok: true, value: projectText(p) }
    if (request.kind === 'compress') return { id, ok: true, value: await compressProject(p) }
    if (!Array.isArray(p?.pages) || !p.pages.length) throw new Error('Unreadable project pages')
    const sources = p.pages.map(page => {
      if (!page || typeof page.id !== 'string') throw new Error('Unreadable project page id')
      guardScene(page.scene, 'page ' + page.id + ' scene')
      return { page: page.id, src: printChecked(page.scene) }
    })
    return { id, ok: true, value: sources }
  } catch (e) { return { id, ok: false, message: e instanceof Error ? e.message : String(e) } }
}

// Importing the pure handler in Node tests never installs worker listeners.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  let pending = Promise.resolve()
  self.onmessage = (event: MessageEvent<Request>) => {
    pending = pending.then(async () => { self.postMessage(await answer(event.data)) })
  }
}
