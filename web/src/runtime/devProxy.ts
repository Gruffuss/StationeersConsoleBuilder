// The dev server's proxy to the game's MCP endpoint (`npm run dev` only). The game refuses a browser Origin it does not
// list, so the proxy removes Origin; without a check of its own, any web page could then post through the dev server to
// the game, which is what the game's origin list exists to stop. So it forwards only a request that sends no Origin (a
// native client) or whose Origin is a loopback address naming the very host the request came to (this dev page), and
// answers anything else 403 itself.
import type { ProxyOptions } from 'vite'

// The vite config imports this module, so it imports nothing but types and touches no browser global.
/** The path the dev server proxies to the game: the page's own origin, so no CORS and no Origin reach the game. */
export const GAME_MCP_DEV_PATH = '/__vb-game-mcp'
/** StationeersLua's default listener (its `Port` 3030 and `BindAddress` 127.0.0.1). */
export const GAME_MCP_URL = 'http://127.0.0.1:3030'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function proxyVerdict(h: { origin?: string; host?: string }): 'forward' | 'refuse' {
  if (h.origin === undefined) return 'forward'
  let u: URL
  try { u = new URL(h.origin) } catch { return 'refuse' }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'refuse'
  return LOOPBACK.has(u.hostname) && !!h.host && u.host === h.host.toLowerCase() ? 'forward' : 'refuse'
}

/** `server.proxy[GAME_MCP_DEV_PATH]`: to the game's root path, with the game's own Host (`changeOrigin`), no Origin. */
export function gameMcpProxy(): ProxyOptions {
  return {
    target: GAME_MCP_URL,
    changeOrigin: true,
    rewrite: path => '/' + path.slice(GAME_MCP_DEV_PATH.length).replace(/^\//, ''),
    bypass(req, res) {
      const origin = req.headers.origin
      if (proxyVerdict({ origin, host: req.headers.host }) === 'refuse') {
        if (res) { res.statusCode = 403; res.setHeader('content-type', 'text/plain'); res.end('The dev proxy forwards only requests from this dev page\'s own origin.') }
        // A string marks the request handled: with the response ended, Vite neither proxies nor serves it.
        return req.url ?? GAME_MCP_DEV_PATH
      }
      delete req.headers.origin
    },
  }
}
