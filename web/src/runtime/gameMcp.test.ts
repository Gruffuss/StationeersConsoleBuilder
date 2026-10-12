import { expect, it } from 'vitest'
import { GAME_MCP_DEV_PATH, GAME_MCP_URL, GameMcp, gameEndpoint, loadSendEnabled, readChips, saveSendEnabled } from './gameMcp'
import { CHIPS, fakeGame, hang, rpcStream, toolText } from './gameMcpTesting'

const signal = () => new AbortController().signal
const client = (game: ReturnType<typeof fakeGame>, origin = 'https://example.test') => new GameMcp({ endpoint: GAME_MCP_URL, fetch: game.fetch, origin })

it('the endpoint is the fixed game address in a build and the proxy path under the dev server', () => {
  expect(GAME_MCP_URL).toBe('http://127.0.0.1:3030')
  expect(gameEndpoint(false)).toBe('http://127.0.0.1:3030')
  expect(gameEndpoint(true)).toBe(GAME_MCP_DEV_PATH)
  expect(GAME_MCP_DEV_PATH).toBe('/__vb-game-mcp')
})

it('constructing a client makes no request', () => {
  const game = fakeGame()
  client(game)
  expect(game.calls).toEqual([])
})

it('initializes once, before the first tool call', async () => {
  const game = fakeGame(undefined, {}), c = client(game)
  await c.listChips(signal())
  await c.vectorStats(signal())
  expect(game.calls.map(x => x.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call'])
  const [init, note] = game.calls
  expect(init.url).toBe(GAME_MCP_URL)
  expect(init.method).toBe('POST')
  expect(init.body.params).toMatchObject({ protocolVersion: '2024-11-05' })
  expect(note.body.id).toBeUndefined()
})

it('sends only Content-Type and Accept, the headers the game\'s preflight allows, even when an answer carries a session id', async () => {
  // The recorded preflight allows Content-Type only; Accept is a header browsers always allow. The game never issued an
  // Mcp-Session-Id, and a browser could not read one (no Access-Control-Expose-Headers), so the client sends none.
  const game = fakeGame(undefined, { session: 'session-1' }), c = client(game)
  await c.listChips(signal())
  await c.vectorStats(signal())
  for (const call of game.calls) expect(call.headers).toEqual({ 'content-type': 'application/json', accept: 'application/json, text/event-stream' })
})

it('reads JSON and event-stream answers alike', async () => {
  const json = await client(fakeGame()).vectorStats(signal())
  const stream = await client(fakeGame((_n, _a, call) => rpcStream(call.body.id, toolText('scene "main": no problems')))).vectorStats(signal())
  expect(json).toEqual({ ok: true, texts: ['scene "main": no problems'], images: [] })
  expect(stream).toEqual(json)
})

it('takes the answer with the request id from a stream of several events', async () => {
  const game = fakeGame((_n, _a, call) => new Response(
    `data: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: call.body.id, result: toolText('mine') })}\n\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } }))
  expect(await client(game).vectorStats(signal())).toEqual({ ok: true, texts: ['mine'], images: [] })
})

it('a text beginning "Error:" is a failure carrying that text', async () => {
  const game = fakeGame(() => toolText('Error: chip 9 not accessible'))
  expect(await client(game).setChipCode(9, 'x', signal())).toEqual({ ok: false, why: 'Error: chip 9 not accessible', texts: ['Error: chip 9 not accessible'] })
})

it('an answer flagged isError is a failure', async () => {
  const game = fakeGame(() => ({ ...toolText('the tool failed'), isError: true }))
  expect(await client(game).vectorStats(signal())).toEqual({ ok: false, why: 'the tool failed', texts: ['the tool failed'] })
})

it('a push answered with success false is a failure', async () => {
  const game = fakeGame(() => toolText('{"success":false,"error":"compile refused"}'))
  expect(await client(game).setChipCode(9, 'x', signal())).toEqual({ ok: false, why: 'compile refused', texts: ['{"success":false,"error":"compile refused"}'] })
})

it('a JSON-RPC error is a failure carrying its code and message', async () => {
  const game = fakeGame((_n, _a, call) => new Response(JSON.stringify({ jsonrpc: '2.0', id: call.body.id, error: { code: -32602, message: 'Unknown tool' } }),
    { status: 200, headers: { 'content-type': 'application/json' } }))
  expect(await client(game).vectorStats(signal())).toEqual({ ok: false, why: 'JSON-RPC error -32602: Unknown tool' })
})

it('an HTTP 403 is a failure carrying its status and body', async () => {
  const refused: typeof fetch = async () => new Response('Origin not allowed', { status: 403, statusText: 'Forbidden' })
  const answer = await new GameMcp({ endpoint: GAME_MCP_URL, fetch: refused }).listChips(signal())
  expect(answer).toEqual({ ok: false, why: 'HTTP 403 Forbidden', status: 403, texts: ['Origin not allowed'] })
})

it('a request that fails before any answer lists the possible causes, naming the origin to allow', async () => {
  const failing: typeof fetch = async () => { throw new TypeError('Failed to fetch') }
  const answer = await new GameMcp({ endpoint: GAME_MCP_URL, fetch: failing, origin: 'https://example.test' }).listChips(signal())
  expect(answer.ok).toBe(false)
  const why = (answer as { why: string }).why
  expect(why).toContain('http://127.0.0.1:3030')
  expect(why).toContain('the game is not running or no world is loaded')
  expect(why).toContain('[MCP Server] Enabled')
  expect(why).toContain('this page\'s origin (https://example.test) is not in AllowedBrowserOrigins')
  expect(why).toContain('local-network permission')
})

it('an abort is "Stopped", and the next call initializes again', async () => {
  const stop = new AbortController()
  let first = true
  const game = fakeGame((_n, _a, call) => { if (first) { first = false; return hang(call) } return toolText('ok') })
  const c = client(game)
  const pending = c.vectorStats(stop.signal)
  await Promise.resolve(); await new Promise(r => setTimeout(r))
  stop.abort()
  expect(await pending).toEqual({ ok: false, why: 'Stopped' })
  const aborted = new AbortController(); aborted.abort()
  expect(await c.vectorStats(aborted.signal)).toEqual({ ok: false, why: 'Stopped' })
  expect(await c.vectorStats(signal())).toEqual({ ok: true, texts: ['ok'], images: [] })
})

it('a failed initialize is the answer, and the next call initializes again', async () => {
  let refuse = true
  const game = fakeGame()
  const gate: typeof fetch = async (input, init) => refuse ? new Response('', { status: 403, statusText: 'Forbidden' }) : game.fetch(input, init)
  const c = new GameMcp({ endpoint: GAME_MCP_URL, fetch: gate })
  expect(await c.listChips(signal())).toEqual({ ok: false, why: 'HTTP 403 Forbidden', status: 403 })
  refuse = false
  expect((await c.listChips(signal())).ok).toBe(true)
  expect(game.calls.map(x => x.body.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
})

it('a failed tool call makes the next call initialize again', async () => {
  let fail = true
  const game = fakeGame(undefined, {})
  const gate: typeof fetch = async (input, init) => fail && JSON.parse(String(init!.body)).method === 'tools/call'
    ? new Response('', { status: 500, statusText: 'Internal Server Error' }) : game.fetch(input, init)
  const c = new GameMcp({ endpoint: GAME_MCP_URL, fetch: gate })
  expect(await c.vectorStats(signal())).toEqual({ ok: false, why: 'HTTP 500 Internal Server Error', status: 500 })
  fail = false
  expect((await c.vectorStats(signal())).ok).toBe(true)
  // The refused tools/call never reached the stand-in; the second call started again from initialize.
  expect(game.calls.map(x => x.body.method)).toEqual(['initialize', 'notifications/initialized', 'initialize', 'notifications/initialized', 'tools/call'])
})

it('sends each tool its arguments, the code unchanged', async () => {
  const game = fakeGame(), c = client(game)
  const code = '-- héllo\r\nlocal x = "\\0"\n\u{1F600}\n'
  await c.listChips(signal())
  await c.setChipCode(101, code, signal())
  await c.vectorStats(signal())
  await c.vectorStats(signal(), 'main')
  await c.capture(101, signal())
  expect(game.tools()).toEqual([
    { name: 'list_chips', arguments: {} },
    { name: 'set_chip_code', arguments: { ref_id: 101, source: code } },
    { name: 'vector_stats', arguments: {} },
    { name: 'vector_stats', arguments: { scene: 'main' } },
    { name: 'capture_scripted_screen', arguments: { ref_id: 101 } },
  ])
})

it('returns images as their type and data, other blocks as text', async () => {
  const game = fakeGame(() => ({ content: [{ type: 'text', text: 'captured' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }, { type: 'resource', resource: { uri: 'x' } }] }))
  expect(await client(game).capture(1, signal())).toEqual({ ok: true, texts: ['captured', '{"type":"resource","resource":{"uri":"x"}}'], images: [{ mime: 'image/png', data: 'AAAA' }] })
})

it('reads the chips list_chips returns, keeping every field', () => {
  expect(readChips({ ok: true, texts: [JSON.stringify(CHIPS)], images: [] })).toEqual([
    { ref: 101, fields: [['ref_id', '101'], ['name', 'Test chip'], ['source_length', '12']], entry: CHIPS[0] },
    { ref: 202, fields: [['ref_id', '202'], ['name', 'Other chip'], ['source_length', '0']], entry: CHIPS[1] },
  ])
  expect(readChips({ ok: true, texts: ['no chips here'], images: [] })).toBeNull()
  expect(readChips({ ok: true, texts: ['[{"name":"no ref"}]'], images: [] })).toBeNull()
  expect(readChips({ ok: false, why: 'x' })).toBeNull()
})

it('a not-JSON answer is a failure carrying the text', async () => {
  const game = fakeGame((_n, _a) => new Response('<html>busy</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  expect(await client(game).vectorStats(signal())).toEqual({ ok: false, why: 'The answer is not JSON-RPC.', status: 200, texts: ['<html>busy</html>'] })
})

it('the enabled flag defaults off, round-trips, and survives a store that throws', () => {
  const data = new Map<string, string>()
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
  expect(loadSendEnabled(store)).toBe(false)
  saveSendEnabled(true, store)
  expect(loadSendEnabled(store)).toBe(true)
  saveSendEnabled(false, store)
  expect(loadSendEnabled(store)).toBe(false)
  expect([...data.keys()]).toEqual(['vb.sendToChip'])
  data.set('vb.sendToChip', 'garbage')
  expect(loadSendEnabled(store)).toBe(false)
  const throwing = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } }
  expect(loadSendEnabled(throwing)).toBe(false)
  expect(() => saveSendEnabled(true, throwing)).not.toThrow()
  expect(loadSendEnabled(null)).toBe(false)
  expect(() => saveSendEnabled(true, null)).not.toThrow()
})

it('under the dev server, the proxy\'s empty 502 (it could not reach the game) gives the no-game causes', async () => {
  const proxy: typeof fetch = async () => new Response(null, { status: 502, statusText: 'Bad Gateway' })
  const answer = await new GameMcp({ endpoint: GAME_MCP_DEV_PATH, fetch: proxy, origin: 'http://localhost:5173' }).listChips(signal())
  expect(answer).toMatchObject({ ok: false, status: 502 })
  const why = (answer as { why: string }).why
  expect(why).toContain(`No answer from the game at ${GAME_MCP_URL}, through the dev server's proxy`)
  expect(why).toContain('the game is not running or no world is loaded')
  expect(why).toContain('[MCP Server] Enabled')
  expect(why).not.toContain('AllowedBrowserOrigins')
  // Straight to the game (a build), a 502 is the game's own answer and stays as it is.
  const direct = await new GameMcp({ endpoint: GAME_MCP_URL, fetch: proxy }).listChips(signal())
  expect(direct).toEqual({ ok: false, why: 'HTTP 502 Bad Gateway', status: 502 })
})

it('any tool answered with success false is a failure, a capture included', async () => {
  const game = fakeGame(() => toolText('{"success":false,"error":"no surface"}'))
  expect(await client(game).capture(9, signal())).toEqual({ ok: false, why: 'no surface', texts: ['{"success":false,"error":"no surface"}'] })
})

it('under the dev server, a failed fetch names the dev server, never the origin list (the proxy sends no Origin)', async () => {
  const failing: typeof fetch = async () => { throw new TypeError('Failed to fetch') }
  const why = (await new GameMcp({ endpoint: GAME_MCP_DEV_PATH, fetch: failing, origin: 'http://localhost:5173' }).listChips(signal()) as { why: string }).why
  expect(why).toContain('the dev server is not running')
  expect(why).not.toContain('AllowedBrowserOrigins')
})
