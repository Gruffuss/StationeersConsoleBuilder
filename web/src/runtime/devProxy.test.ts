import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it } from 'vitest'
import config from '../../vite.config'
import { GAME_MCP_DEV_PATH, GAME_MCP_URL } from './gameMcp'
import { gameMcpProxy, proxyVerdict } from './devProxy'

it('forwards a request with no origin (a native client)', () => {
  expect(proxyVerdict({})).toBe('forward')
  expect(proxyVerdict({ host: 'localhost:5173' })).toBe('forward')
})

it('forwards a loopback origin that names the host the request came to', () => {
  expect(proxyVerdict({ origin: 'http://localhost:5173', host: 'localhost:5173' })).toBe('forward')
  expect(proxyVerdict({ origin: 'http://127.0.0.1:5173', host: '127.0.0.1:5173' })).toBe('forward')
  expect(proxyVerdict({ origin: 'http://[::1]:5173', host: '[::1]:5173' })).toBe('forward')
  expect(proxyVerdict({ origin: 'http://LOCALHOST:5173', host: 'localhost:5173' })).toBe('forward')
  expect(proxyVerdict({ origin: 'https://localhost:5173', host: 'localhost:5173' })).toBe('forward')
})

it('refuses any other origin', () => {
  expect(proxyVerdict({ origin: 'https://example.org', host: 'localhost:5173' })).toBe('refuse')
  expect(proxyVerdict({ origin: 'https://example.org', host: 'example.org' })).toBe('refuse')
  expect(proxyVerdict({ origin: 'http://localhost:5173', host: 'localhost:4173' })).toBe('refuse')
  expect(proxyVerdict({ origin: 'http://127.0.0.1:5173', host: 'localhost:5173' })).toBe('refuse')
  expect(proxyVerdict({ origin: 'http://localhost:5173' })).toBe('refuse')
  expect(proxyVerdict({ origin: 'null', host: 'localhost:5173' })).toBe('refuse')
  expect(proxyVerdict({ origin: 'file://', host: 'localhost:5173' })).toBe('refuse')
  expect(proxyVerdict({ origin: 'http://localhost.example.org:5173', host: 'localhost.example.org:5173' })).toBe('refuse')
})

const request = (headers: Record<string, string>, url = GAME_MCP_DEV_PATH) => ({ url, headers: { ...headers } }) as unknown as IncomingMessage
const response = () => {
  const r = { statusCode: 200, writableEnded: false, body: '', headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { r.headers[k.toLowerCase()] = v },
    end(b = '') { r.body = String(b); r.writableEnded = true } }
  return r
}

it('the proxy goes to the game at its root path, with the game\'s own host', () => {
  const p = gameMcpProxy()
  expect(p.target).toBe(GAME_MCP_URL)
  expect(p.changeOrigin).toBe(true)
  expect(p.rewrite!(GAME_MCP_DEV_PATH)).toBe('/')
  expect(p.rewrite!(`${GAME_MCP_DEV_PATH}/`)).toBe('/')
  expect(p.rewrite!(`${GAME_MCP_DEV_PATH}?a=1`)).toBe('/?a=1')
})

it('the proxy forwards a same-origin loopback request without its Origin header', async () => {
  const p = gameMcpProxy(), req = request({ origin: 'http://localhost:5173', host: 'localhost:5173' }), res = response()
  const out = await p.bypass!(req, res as unknown as ServerResponse, p)
  expect(out).toBeUndefined()
  expect(res.writableEnded).toBe(false)
  expect(req.headers.origin).toBeUndefined()
  expect(req.headers.host).toBe('localhost:5173')
})

it('the proxy answers any other origin 403 itself and forwards nothing', async () => {
  const p = gameMcpProxy(), req = request({ origin: 'https://example.org', host: 'localhost:5173' }), res = response()
  const out = await p.bypass!(req, res as unknown as ServerResponse, p)
  expect(res.statusCode).toBe(403)
  expect(res.writableEnded).toBe(true)
  expect(res.body).toContain('origin')
  // A string tells Vite the request is handled: with the response ended, it neither proxies nor serves it.
  expect(typeof out).toBe('string')
})

it('the dev server proxies the path; the preview server does not', () => {
  const proxy = config.server?.proxy as Record<string, ReturnType<typeof gameMcpProxy>>
  expect(Object.keys(proxy)).toEqual([GAME_MCP_DEV_PATH])
  expect(proxy[GAME_MCP_DEV_PATH].target).toBe(GAME_MCP_URL)
  expect(proxy[GAME_MCP_DEV_PATH].bypass).toBeTypeOf('function')
  expect(config.preview?.proxy).toEqual({})
})
