// Test helpers, imported by tests only: a stand-in for the game's MCP endpoint, answering as the documented and observed
// exchanges do (JSON-RPC 2.0 by POST; `initialize`, then `notifications/initialized`, then `tools/call`; an answer as JSON
// or as a `text/event-stream` `data:` line; an optional `Mcp-Session-Id`). Every ref, name and text here is made up.
// `recorded` reads the exchanges recorded from the game (web/test/fixtures/game-mcp, scrubbed as its README says).
export type Recorded = { request: { method: string; path: string; headers: Record<string, string>; body: Message | null };
  status: number; reason: string; headers: [string, string][]; body: string }
// Through the bundler, so it reads alike under the node and the happy-dom environments.
const RECORDED = import.meta.glob<Recorded>('../../test/fixtures/game-mcp/*.json', { eager: true, import: 'default' })
export const recorded = (name: string): Recorded => {
  const r = RECORDED[`../../test/fixtures/game-mcp/${name}.json`]
  if (!r) throw Error(`no recorded exchange ${name}`)
  return r
}
/** The recorded answer as the browser's fetch would hand it over. */
export const recordedResponse = (r: Recorded) => new Response(r.status === 204 || r.body === '' ? null : r.body, { status: r.status, statusText: r.reason, headers: r.headers })
/** The text of the recorded tools/call answer's first content block. */
export const recordedText = (name: string): string => JSON.parse(recorded(name).body).result.content[0].text

export type Message = { jsonrpc: string; id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown>; [k: string]: unknown } }
export type Call = { url: string; method: string; headers: Record<string, string>; body: Message; signal: AbortSignal | null }
type Answer = unknown | Response
type Tool = (name: string, args: Record<string, unknown>, call: Call) => Answer | Promise<Answer>

export const toolText = (...texts: string[]) => ({ content: texts.map(text => ({ type: 'text', text })) })
export const rpcJson = (id: number | undefined, result: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers: { 'content-type': 'application/json', ...headers } })
export const rpcStream = (id: number | undefined, result: unknown) =>
  new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })

/** A promise that never settles on its own: it rejects as `fetch` does when the call's signal aborts. */
export const hang = (call: Call) => new Promise<never>((_, reject) => {
  const stop = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
  if (call.signal?.aborted) stop()
  call.signal?.addEventListener('abort', stop)
})

export const CHIPS = [{ ref_id: 101, name: 'Test chip', source_length: 12 }, { ref_id: 202, name: 'Other chip', source_length: 0 }]

/** The default tools: chips as a JSON text, a push accepted, stats as text, a capture as one image. */
export const defaultTool: Tool = name => name === 'list_chips' ? toolText(JSON.stringify(CHIPS))
  : name === 'set_chip_code' ? toolText('{"success":true,"source_version":2}')
  : name === 'vector_stats' ? toolText('scene "main": no problems')
  : name === 'capture_scripted_screen' ? { content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }] }
  : toolText(`Error: unknown tool ${name}`)

export function fakeGame(tool: Tool = defaultTool, o: { session?: string } = { session: 'session-1' }) {
  const calls: Call[] = []
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => { headers[k] = v })
    const call: Call = { url: String(input), method: init.method ?? 'GET', headers, body: JSON.parse(String(init.body)), signal: init.signal ?? null }
    calls.push(call)
    if (call.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    const m = call.body
    if (m.method === 'initialize')
      return rpcJson(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'game', version: '1' } }, o.session ? { 'mcp-session-id': o.session } : {})
    if (m.id === undefined) return new Response(null, { status: 202 })
    if (m.method === 'tools/call') {
      const r = await tool(m.params!.name!, m.params!.arguments ?? {}, call)
      return r instanceof Response ? r : rpcJson(m.id, r)
    }
    return new Response('unexpected method', { status: 500 })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls, tools: () => calls.filter(c => c.body.method === 'tools/call').map(c => c.body.params!) }
}
