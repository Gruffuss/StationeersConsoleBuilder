// A client for the game's MCP endpoint (StationeersLua's JSON-RPC listener), used by Send to chip. It sends nothing of
// its own accord: each method is one tool call made because the player clicked. No timer: the caller's signal stops it.
import { GAME_MCP_DEV_PATH, GAME_MCP_URL } from './devProxy'

export { GAME_MCP_DEV_PATH, GAME_MCP_URL }
export function gameEndpoint(dev = import.meta.env.DEV): string { return dev ? GAME_MCP_DEV_PATH : GAME_MCP_URL }

/** A chip's ref id as `list_chips` gives it and `set_chip_code` takes it. It changes when the world reloads. */
export type ChipRef = number
export type PushMode = 'editor_only' | 'chip' | 'editor_then_chip'
export type ToolAnswer =
  | { ok: true; texts: string[]; images: { mime: string; data: string }[] }
  | { ok: false; why: string; status?: number; texts?: string[] }

const PROTOCOL = '2024-11-05'
type Rpc = { jsonrpc?: string; id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } }
type Block = { type?: unknown; text?: unknown; mimeType?: unknown; data?: unknown }
/** Thrown inside the client to end a call with this answer. */
class Failed { constructor(readonly answer: ToolAnswer & { ok: false }) {} }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export class GameMcp {
  readonly endpoint: string
  readonly #fetch: typeof fetch
  readonly #origin: string
  #ready = false
  #id = 0

  constructor(o: { endpoint: string; fetch?: typeof fetch; origin?: string }) {
    this.endpoint = o.endpoint
    this.#fetch = o.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.#origin = o.origin ?? globalThis.location?.origin ?? 'this page\'s origin'
  }

  listChips(signal: AbortSignal) { return this.#tool('list_chips', {}, signal) }
  /** `mode` as the game's schema names it; without one, the game's default (recorded: `editor_then_chip` with the
   *  extension API on, `chip` with it off). */
  setChipCode(ref: ChipRef, code: string, signal: AbortSignal, mode?: PushMode): Promise<ToolAnswer> {
    return this.#tool('set_chip_code', { ref_id: ref, source: code, ...(mode && { mode }) }, signal)
  }
  vectorStats(signal: AbortSignal, scene?: string) { return this.#tool('vector_stats', scene === undefined ? {} : { scene }, signal) }
  capture(ref: ChipRef, signal: AbortSignal) { return this.#tool('capture_scripted_screen', { ref_id: ref }, signal) }
  editorState(signal: AbortSignal) { return this.#tool('get_editor_state', {}, signal) }
  allNetworkDevices(signal: AbortSignal) { return this.#tool('get_all_network_devices', {}, signal) }
  networkDevices(network: number, signal: AbortSignal) { return this.#tool('get_network_devices', { network_id: network }, signal) }

  async #tool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolAnswer> {
    try {
      if (!this.#ready) await this.#start(signal)
      return toolAnswer(this.#answer(await this.#post('tools/call', { name, arguments: args }, signal)))
    } catch (e) {
      // Whatever broke the exchange (the game may have restarted), the next call initializes again.
      this.#ready = false
      if (e instanceof Failed) return e.answer
      throw e
    }
  }

  async #start(signal: AbortSignal) {
    this.#answer(await this.#post('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'VectorBuilder', version: '1' } }, signal))
    const note = await this.#post('notifications/initialized', undefined, signal, true)
    if (note.status < 200 || note.status > 299) this.#answer(note)
    this.#ready = true
  }

  /** The JSON-RPC answer of `r`, or a Failed for an HTTP error status, a body that is not JSON-RPC, or an `error`. */
  #answer(r: { status: number; statusText: string; text: string; id?: number; stream: boolean }): unknown {
    const texts = r.text ? [r.text] : undefined
    // The dev server's proxy answers an empty 502 when it cannot reach the game (vite's proxy error handler).
    if (this.endpoint === GAME_MCP_DEV_PATH && r.status === 502 && !r.text)
      throw new Failed({ ok: false, status: 502, why: `No answer from the game at ${GAME_MCP_URL}, through the dev server's proxy. Possible causes: `
        + 'the game is not running or no world is loaded; StationeersLua\'s [MCP Server] Enabled is off.' })
    if (r.status < 200 || r.status > 299)
      throw new Failed({ ok: false, why: `HTTP ${r.status}${r.statusText ? ` ${r.statusText}` : ''}`, status: r.status, ...(texts && { texts }) })
    const m = message(r.text, r.stream, r.id)
    if (!m) throw new Failed({ ok: false, why: 'The answer is not JSON-RPC.', status: r.status, ...(texts && { texts }) })
    if (m.error !== undefined) {
      const e = object(m.error) ? m.error : {}, code = e.code === undefined ? '' : ` ${String(e.code)}`
      throw new Failed({ ok: false, why: `JSON-RPC error${code}: ${typeof e.message === 'string' ? e.message : JSON.stringify(m.error)}` })
    }
    return m.result
  }

  async #post(method: string, params: unknown, signal: AbortSignal, notify = false) {
    if (signal.aborted) throw new Failed({ ok: false, why: 'Stopped' })
    const id = notify ? undefined : ++this.#id
    // Only these two: the game's preflight allows Content-Type alone (Accept needs no permission). It never issues an
    // Mcp-Session-Id, and exposes no header a browser could read one from, so none is sent.
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    try {
      const res = await this.#fetch(this.endpoint, { method: 'POST', headers, signal,
        body: JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined && { id }), method, ...(params !== undefined && { params }) }) })
      const text = await res.text()
      return { status: res.status, statusText: res.statusText, text, id,
        stream: (res.headers.get('content-type') ?? '').includes('text/event-stream') }
    } catch (e) {
      if (signal.aborted || (e as { name?: unknown })?.name === 'AbortError') throw new Failed({ ok: false, why: 'Stopped' })
      // The browser names a refused connection, a CORS refusal and a refused permission alike: list them, guess none. The
      // game refuses an origin it does not list with a 403 that carries no CORS header, so a page sees only this failure.
      // Under the dev server the request goes to the page's own origin and its proxy sends no Origin: no origin list applies.
      if (e instanceof TypeError && this.endpoint === GAME_MCP_DEV_PATH) throw new Failed({ ok: false, why: 'No answer from the dev server\'s '
        + 'proxy to the game. Possible causes: the dev server is not running; the game is not running or no world is loaded; '
        + 'StationeersLua\'s [MCP Server] Enabled is off.' })
      if (e instanceof TypeError) throw new Failed({ ok: false, why: `No answer from the game at ${this.endpoint}. Possible causes: the game is not running or no world is loaded; `
        + `StationeersLua's [MCP Server] Enabled is off; this page's origin (${this.#origin}) is not in AllowedBrowserOrigins, `
        + 'or the game has not been restarted since it was added; '
        + 'the browser\'s local-network permission was refused.' })
      throw new Failed({ ok: false, why: e instanceof Error ? e.message : String(e) })
    }
  }
}

/** The JSON-RPC message in a body: the JSON itself, or among a `text/event-stream`'s events the answer to `id`. */
function message(text: string, stream: boolean, id?: number): Rpc | null {
  const parse = (s: string): Rpc | null => { try { const v: unknown = JSON.parse(s); return object(v) ? v as Rpc : null } catch { return null } }
  if (!stream && !/^\s*(data|event|id|retry)?:/.test(text)) return parse(text)
  const events = text.replace(/\r\n?/g, '\n').split(/\n\n+/).map(e => e.split('\n').filter(l => l.startsWith('data:'))
    .map(l => l.slice(5).replace(/^ /, '')).join('\n')).filter(Boolean).map(parse).filter((m): m is Rpc => !!m)
  return events.find(m => m.id === id) ?? events.find(m => 'result' in m || 'error' in m) ?? null
}

/** A tools/call result as an answer: text blocks as texts, images as images, any other block as its JSON text; a failure
 *  when the result is flagged `isError` or a text begins `Error:` (how the game reports a refused call). */
function toolAnswer(result: unknown): ToolAnswer {
  const content: Block[] = object(result) && Array.isArray(result.content) ? result.content as Block[] : []
  const texts: string[] = [], images: { mime: string; data: string }[] = []
  for (const b of content) {
    if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b?.type === 'image' && typeof b.data === 'string') images.push({ mime: typeof b.mimeType === 'string' ? b.mimeType : 'image/png', data: b.data })
    else texts.push(JSON.stringify(b))
  }
  if (!object(result) || !Array.isArray(result.content)) texts.push(JSON.stringify(result ?? null))
  const error = texts.find(t => t.trimStart().startsWith('Error:'))
  if (error !== undefined || (object(result) && result.isError === true))
    return { ok: false, why: error ?? texts[0] ?? 'The game reported an error.', texts }
  // An answer whose JSON says `"success": false` (a push that did not land, a capture that did not happen) is a failure,
  // whatever its text begins with.
  for (const t of texts) {
    let v: unknown
    try { v = JSON.parse(t) } catch { continue }
    if (object(v) && v.success === false)
      return { ok: false, why: typeof v.error === 'string' ? v.error : typeof v.message === 'string' ? v.message : t, texts }
  }
  return { ok: true, texts, images }
}

export type Chip = { ref: ChipRef; fields: [string, string][]; entry: Record<string, unknown> }
/** The chips in a `list_chips` answer (a JSON array of objects, each with its `ref_id`), every field kept as returned;
 *  null when the answer is not such a list. */
export function readChips(a: ToolAnswer): Chip[] | null {
  if (!a.ok || a.texts.length !== 1) return null
  let v: unknown
  try { v = JSON.parse(a.texts[0]) } catch { return null }
  if (!Array.isArray(v) || !v.every(c => object(c) && typeof c.ref_id === 'number' && Number.isSafeInteger(c.ref_id))) return null
  return (v as Record<string, unknown>[]).map(c => ({ ref: c.ref_id as number,
    fields: Object.entries(c).map(([k, x]) => [k, typeof x === 'string' ? x : JSON.stringify(x)] as [string, string]), entry: c }))
}

const json = (a: ToolAnswer): unknown => {
  if (!a.ok || a.texts.length !== 1) return undefined
  try { return JSON.parse(a.texts[0]) } catch { return undefined }
}
const ref = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

/** From `get_editor_state`: the chip selected in an IC editor (null when none) and the scope's network. `editor_open` is
 *  not read: the game answered true with nobody at an editor (recorded, the scope from a wireless board). */
export function readEditorState(a: ToolAnswer): { selectedChip: ChipRef | null; networkId: number | null } | null {
  const v = json(a)
  if (!object(v)) return null
  return { selectedChip: ref(v.selected_chip_ref_id) ? v.selected_chip_ref_id : null, networkId: ref(v.network_id) ? v.network_id : null }
}

/** A device as the game lists it: its ref (kept for requests, never shown), its display name (the Labeller name, or the
 *  prefab's default name that its unlabelled siblings share) and its prefab name. The hash is not kept. */
export type Device = { ref: number; name: string; prefab: string }
// A name or prefab the game gives as anything but a string reads as '' (the picker leaves such a device out and says so);
// a list whose entries are not devices with a ref is no device list.
const devicesOf = (v: unknown): Device[] | null => Array.isArray(v) && v.every(d => object(d) && ref(d.ref_id))
  ? (v as Record<string, unknown>[]).map(d => ({ ref: d.ref_id as number, name: typeof d.display_name === 'string' ? d.display_name : '',
    prefab: typeof d.prefab_name === 'string' ? d.prefab_name : '' })) : null
/** `get_network_devices`: one network's devices, a bare array. */
export const readDevices = (a: ToolAnswer) => devicesOf(json(a))
/** `get_all_network_devices`: each network's id and devices. */
export function readNetworks(a: ToolAnswer): { networkId: number; devices: Device[] }[] | null {
  const v = json(a)
  if (!Array.isArray(v)) return null
  const out: { networkId: number; devices: Device[] }[] = []
  for (const n of v) {
    const devices = object(n) && ref(n.network_id) ? devicesOf(n.devices) : null
    if (!devices) return null
    out.push({ networkId: (n as { network_id: number }).network_id, devices })
  }
  return out
}

// The enabled flag, kept per browser like the editing settings: storage may be missing or refuse, and then the default
// (off) holds and a change lasts for the session. Nothing else about the game connection is kept anywhere.
type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined
const KEY = 'vb.sendToChip'
const local = (): Store => { try { return globalThis.localStorage } catch { return null } }
export function loadSendEnabled(store: Store = local()): boolean {
  try { return store?.getItem(KEY) === 'true' } catch { return false }
}
export function saveSendEnabled(on: boolean, store: Store = local()): void {
  try { store?.setItem(KEY, String(on)) } catch { /* refused: kept for this session only */ }
}

/** A `vector_stats` report cut to the scenes asked for: its first line (the mod and its version) and each asked scene's
 *  block, from its `scene "<id>"` line to the next. The report covers every vector scene in the world (recorded); other
 *  consoles' scenes are left out. Two scenes of one id on different consoles are not told apart: the report names a
 *  scene's root prefab, not its chip. */
export function statsFor(text: string, scenes: readonly string[]): { version: string; scenes: { scene: string; text: string }[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), wanted = new Set(scenes), out: { scene: string; text: string }[] = []
  let version = '', current: { scene: string; lines: string[] } | null = null
  const close = () => { if (current && wanted.has(current.scene)) out.push({ scene: current.scene, text: current.lines.join('\n').trimEnd() }) }
  for (const line of lines) {
    const head = /^scene "((?:[^"\\]|\\.)*)"/.exec(line)
    if (head) { close(); current = { scene: head[1], lines: [line] } }
    else if (current) current.lines.push(line)
    else if (!version && line.trim()) version = line.trim()
  }
  close()
  return { version, scenes: out }
}
