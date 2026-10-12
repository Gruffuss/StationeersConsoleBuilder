import type { Project } from '../model/project'
import type { Scene } from '../model/scene'
import { initialState, reducer } from '../model/store'
import { NATIVE_KEYS, NODE_KEYS, NOTES_KEYS, PAGE_KEYS, PROJECT_KEYS, SCENE_KEYS, requireToken } from './codec'
import { SHARE_URL_LIMIT } from './share'

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
function fail(where: string): never { throw new Error('Unreadable project ' + where) }
const record = (v: unknown, where: string): Record<string, unknown> => object(v) ? v : fail(where + ': expected an object')
const strings = (v: unknown, where: string) => {
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) fail(where + ': expected text comments')
}
const values = (v: unknown, where: string) => {
  const todo = [v]
  while (todo.length) {
    const x = todo.pop()
    if (Array.isArray(x)) { for (const child of x) todo.push(child) }
    else if (typeof x !== 'string' && !(typeof x === 'number' && Number.isFinite(x))) fail(where + ': expected a finite number, text or array')
  }
}
const attrs = (v: unknown, where: string) => {
  const r = record(v, where), proto = Object.getPrototypeOf(r)
  if (proto !== null && proto !== Object.prototype) fail(where + ': expected plain attributes')
  for (const [k, x] of Object.entries(r)) values(x, where + '.' + k)
}

/** Structural safety only: semantic scene errors remain the scene worker's responsibility. */
export function guardScene(v: unknown, where: string): asserts v is Scene {
  const scene = record(v, where)
  attrs(scene.header, where + '.header')
  if (!Array.isArray(scene.defs) || !Array.isArray(scene.root)) fail(where + ': expected defs/root node arrays')
  const todo = [{ nodes: scene.defs, field: 'defs' }, { nodes: scene.root, field: 'root' }]
  while (todo.length) {
    const { nodes, field } = todo.pop()!
    for (let k = 0; k < nodes.length; k++) {
      const at = where + '.' + field + '[' + k + ']', n = record(nodes[k], at)
      if (typeof n.op !== 'string') fail(at + '.op: expected text')
      attrs(n.attrs, at + '.attrs')
      if (n.comments !== undefined) strings(n.comments, at + '.comments')
      if (n.tail !== undefined) strings(n.tail, at + '.tail')
      if (n.eol !== undefined && typeof n.eol !== 'string') fail(at + '.eol: expected text')
      if (n.c !== undefined) {
        if (!Array.isArray(n.c)) fail(at + '.c: expected child nodes')
        todo.push({ nodes: n.c, field: 'children' })
      }
    }
  }
  if (scene.notes !== undefined) {
    const notes = record(scene.notes, where + '.notes')
    for (const k of ['header', 'defs', 'defsTail', 'tail']) if (notes[k] !== undefined) strings(notes[k], where + '.notes.' + k)
  }
}

export function readProject(text: string): { project: Project; notice: string } {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch (e) {
    if (e instanceof RangeError) throw new Error('Project is larger than this browser can hold as text; use the original JSON file')
    throw new Error('Project JSON could not be read')
  }
  const root = record(parsed, 'root')
  if (Object.hasOwn(root, 'version') && root.version !== 1) {
    if (typeof root.version === 'number' && Number.isFinite(root.version) && root.version > 1)
      throw new Error('This project was made by a newer builder')
    fail('version')
  }
  if (!Array.isArray(root.pages) || !root.pages.length) fail('pages: expected at least one page')
  if (Object.hasOwn(root, 'name') && typeof root.name !== 'string') fail('name: expected text')
  const ids = new Set<string>(), surfaces = new Set<string>(), foreign = new Set<string>()
  const strip = (v: unknown, fields: readonly string[]) => {
    if (!object(v)) return
    for (const k of Object.keys(v)) if (!fields.includes(k)) { foreign.add(k); delete v[k] }
  }
  const pages = root.pages.map((v, k) => {
    const p = record(v, 'page ' + (k + 1))
    for (const [field, seen] of [['id', ids], ['surface', surfaces]] as const) {
      const x = p[field]
      if (typeof x !== 'string' || !x.length || seen.has(x)) fail('page ' + (k + 1) + '.' + field + ': expected a unique nonempty name')
      seen.add(x)
    }
    if (Object.hasOwn(p, 'name') && typeof p.name !== 'string') fail('page ' + p.id + '.name: expected text')
    guardScene(p.scene, 'page ' + p.id + ' scene')
    strip(p, PAGE_KEYS)
    strip(p.size, ['w', 'h'])
    if (Array.isArray(p.natives)) for (const native of p.natives) strip(native, NATIVE_KEYS)
    strip(p.scene, SCENE_KEYS)
    strip(p.scene.notes, NOTES_KEYS)
    const nodes = [...p.scene.defs, ...p.scene.root]
    while (nodes.length) {
      const node = nodes.pop()!
      strip(node, NODE_KEYS)
      for (const child of node.c ?? []) nodes.push(child)
    }
    return { ...p, name: Object.hasOwn(p, 'name') ? p.name : p.id }
  })
  const guarded = { ...Object.fromEntries(PROJECT_KEYS.filter(k => Object.hasOwn(root, k)).map(k => [k, root[k]])),
    version: 1, name: Object.hasOwn(root, 'name') ? root.name : 'Untitled', pages } as Project
  const loaded = reducer(initialState(), { type: 'loadProject', project: guarded })
  for (const k of Object.keys(root)) if (!PROJECT_KEYS.includes(k as typeof PROJECT_KEYS[number])) foreign.add(k)
  return { project: loaded.project, notice: [foreign.size ? 'Ignored non-project fields: ' + [...foreign].join(', ') : '', loaded.notice].filter(Boolean).join('; ') }
}

export function fragmentToken(hash: string): string | null {
  if (!hash.startsWith('#')) return null
  const params = new URLSearchParams(hash.slice(1)), tokens = params.getAll('p')
  if (!tokens.length) return null
  if (/%(?![0-9a-f]{2})/i.test(hash) || tokens.length !== 1 || !tokens[0]) throw new Error('Malformed project fragment')
  if (tokens[0].length > SHARE_URL_LIMIT - 3)
    throw new Error('This project token is ' + tokens[0].length + ' characters; links VectorBuilder makes are at most ' + SHARE_URL_LIMIT + '. Open the project JSON file instead')
  requireToken(tokens[0])
  return tokens[0]
}

/** Lua lexical spans only; a genuine project-prefixed final candidate owns the result, including corruption. */
export function embeddedToken(lua: string): string | null {
  let last: { token?: string; error?: Error } | null = null
  const longOpen = (at: number) => {
    if (lua[at] !== '[') return null
    let end = at + 1
    while (lua[end] === '=') end++
    return lua[end] === '[' ? { level: end - at - 1, start: end + 1 } : null
  }
  for (let i = 0; i < lua.length;) {
    const ch = lua[i]
    if (ch === '"' || ch === "'") {
      i++
      while (i < lua.length) {
        if (lua[i] === '\\') { i += 2; continue }
        if (lua[i++] === ch) break
      }
      continue
    }
    const comment = lua[i] === '-' && lua[i + 1] === '-'
    const open = longOpen(i + (comment ? 2 : 0))
    if (open) {
      const close = ']' + '='.repeat(open.level) + ']', end = lua.indexOf(close, open.start)
      if (comment) {
        const body = lua.slice(open.start, end < 0 ? lua.length : end)
        if (body.trimStart().startsWith('vectorbuilder:project')) {
          const match = /^ vectorbuilder:project (\S+) $/.exec(body)
          try {
            if (end < 0 || open.level !== 2 || !match) throw new Error('Corrupt embedded VectorBuilder project comment')
            requireToken(match[1])
            last = { token: match[1] }
          } catch (e) { last = { error: e instanceof Error ? e : new Error(String(e)) } }
        }
      }
      i = end < 0 ? lua.length : end + close.length
    } else if (comment) {
      i += 2
      while (i < lua.length && lua[i] !== '\n' && lua[i] !== '\r') i++
    } else i++
  }
  if (last?.error) throw last.error
  return last?.token ?? null
}
