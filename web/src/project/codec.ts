import type { Project } from '../model/project'
import { THEME_FILE, themeFileOf } from '../theme/file'

export const PROJECT_KEYS = ['version', 'name', 'target', 'theme', 'pages', 'roles', 'reads', 'state', 'actions', 'rules',
  'bindings', 'customLua', 'simDevices', 'settings', 'themes'] as const
export const PAGE_KEYS = ['id', 'name', 'surface', 'shape', 'size', 'background', 'scene', 'preview', 'natives']
export const SCENE_KEYS = ['header', 'defs', 'root', 'notes']
export const NODE_KEYS = ['op', 'attrs', 'c', 'comments', 'eol', 'tail']
export const NOTES_KEYS = ['header', 'defs', 'defsTail', 'tail']
export const NATIVE_KEYS = ['type', 'uid', 'params']
const SIZE_KEYS = ['w', 'h'], TARGET_KEYS = ['vectorMod'], SETTINGS_KEYS = ['budgets', 'beta', 'day', 'wipeOnReexport']
const BUDGET_KEYS = ['load', 'tick'], DAY_KEYS = ['length', 'start']

const childKeys = (fields: readonly string[] | undefined, key: string): readonly string[] | undefined => {
  if (fields === PROJECT_KEYS) return key === 'pages' ? PAGE_KEYS : key === 'target' ? TARGET_KEYS : key === 'settings' ? SETTINGS_KEYS : undefined
  if (fields === PAGE_KEYS) return key === 'scene' ? SCENE_KEYS : key === 'size' ? SIZE_KEYS : key === 'natives' ? NATIVE_KEYS : undefined
  if (fields === SCENE_KEYS) return key === 'defs' || key === 'root' ? NODE_KEYS : key === 'notes' ? NOTES_KEYS : undefined
  if (fields === NODE_KEYS) return key === 'c' ? NODE_KEYS : undefined
  if (fields === SETTINGS_KEYS) return key === 'budgets' ? BUDGET_KEYS : key === 'day' ? DAY_KEYS : undefined
}

/** Only model root fields travel; explicit enter/exit frames keep nested JSON and cycle checks stack-safe. */
export function projectText(p: Project): string {
  const root: Record<string, unknown> = Object.fromEntries(PROJECT_KEYS.filter(k => Object.hasOwn(p, k)).map(k => [k, p[k]]))
  if (Object.hasOwn(p, 'themes') && p.themes) root.themes = Object.fromEntries(Object.entries(p.themes).map(([id, theme]) =>
    [id, Object.hasOwn(theme, 'format') && (theme as unknown as { format: string }).format === THEME_FILE ? theme : themeFileOf(theme)]))
  type Frame = { value: unknown; fields?: readonly string[] } | { raw: string } | { exit: object }
  const todo: Frame[] = [{ value: root, fields: PROJECT_KEYS }], active = new Set<object>(), out: string[] = []
  while (todo.length) {
    const frame = todo.pop()!
    if ('raw' in frame) { out.push(frame.raw); continue }
    if ('exit' in frame) { active.delete(frame.exit); continue }
    const v = frame.value
    if (v === null || v === undefined) { out.push('null'); continue }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { out.push(JSON.stringify(v)); continue }
    if (typeof v !== 'object') throw new Error('Project contains non-data values such as a function')
    if (active.has(v)) throw new Error('Project contains a cycle')
    active.add(v)
    todo.push({ exit: v })
    if (Array.isArray(v)) {
      out.push('[')
      todo.push({ raw: ']' })
      for (let k = v.length - 1; k >= 0; k--) {
        todo.push({ value: v[k], fields: frame.fields })
        if (k) todo.push({ raw: ',' })
      }
    } else {
      out.push('{')
      todo.push({ raw: '}' })
      const record = v as Record<string, unknown>, keys = Object.keys(v).filter(k => record[k] !== undefined && (!frame.fields || frame.fields.includes(k)))
      for (let k = keys.length - 1; k >= 0; k--) {
        todo.push({ value: record[keys[k]], fields: childKeys(frame.fields, keys[k]) }, { raw: JSON.stringify(keys[k]) + ':' })
        if (k) todo.push({ raw: ',' })
      }
    }
  }
  return out.join('')
}

export function requireToken(token: string): void {
  const prefix = /^([0-9]+)\./.exec(token)
  if (prefix && prefix[1] !== '1') throw new Error('Unsupported project codec; use the original JSON file')
  if (!/^1\.[A-Za-z0-9_-]+$/.test(token) || (token.length - 2) % 4 === 1)
    throw new Error('Malformed project token')
}

export async function compressProject(p: Project): Promise<string> {
  if (typeof CompressionStream === 'undefined') throw new Error('Project compression is unavailable; download JSON instead')
  const text = projectText(p)
  try {
    const bytes = new Uint8Array(await new Response(new Blob([new TextEncoder().encode(text)])
      .stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return '1.' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch (e) {
    throw new Error('Project compression could not complete here; download JSON instead: ' + reason(e))
  }
}

let measuredStringLimit: number | undefined
function engineStringLimit(): number {
  if (measuredStringLimit !== undefined) return measuredStringLimit
  // Probe string lengths only: repeat uses ropes in V8, so no expanded backing buffer is allocated.
  let low = 0, high = Number.MAX_SAFE_INTEGER
  while (low < high) {
    const length = low + Math.ceil((high - low) / 2)
    try { 'x'.repeat(length); low = length }
    catch (e) {
      if (!(e instanceof RangeError)) throw e
      high = length - 1
    }
  }
  return measuredStringLimit = low
}

/** The optional ceiling lets tests exercise the engine boundary without allocating large strings. */
export async function decompressProject(token: string, maxLength?: number): Promise<string> {
  requireToken(token)
  if (typeof DecompressionStream === 'undefined') throw new Error('Project decompression is unavailable; use the original JSON file')
  try {
    const limit = maxLength ?? engineStringLimit()
    const base64 = token.slice(2).replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let k = 0; k < binary.length; k++) bytes[k] = binary.charCodeAt(k)
    if (bytes.length < 18) throw new Error('Corrupt gzip project: missing header or trailer')
    const declared = new DataView(bytes.buffer).getUint32(bytes.length - 4, true)
    if (declared > 3 * limit)
      throw new Error('Embedded project declares ' + declared + ' UTF-8 bytes, more than any builder could write in one piece (this browser allows at most ' + 3 * limit + '); it was not opened')
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true }), pieces: string[] = []
    let length = 0, expandedBytes = 0
    const append = (piece: string) => {
      length += piece.length
      if (length > limit) throw new Error('Expanded project exceeds this engine string limit of ' + limit + ' UTF-16 code units; use the original JSON file')
      if (piece) pieces.push(piece)
    }
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        expandedBytes += chunk.value.byteLength
        if (expandedBytes > declared) throw new Error('Corrupt embedded project: expands past its declared size of ' + declared + ' UTF-8 bytes')
        append(decoder.decode(chunk.value, { stream: true }))
      }
      append(decoder.decode())
      return pieces.join('')
    } catch (e) {
      pieces.length = 0
      await reader.cancel(e).catch(() => {}) // preserve the decoding reason if cancellation also fails
      throw e
    } finally { pieces.length = 0; reader.releaseLock() }
  } catch (e) {
    throw new Error('Compressed project could not be decoded here; use the original JSON file: ' + reason(e))
  }
}

const reason = (e: unknown) => e instanceof Error ? e.message : String(e)
