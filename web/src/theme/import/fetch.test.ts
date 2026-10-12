import { expect, it, vi, afterEach } from 'vitest'
import { linkFiles } from './files'

afterEach(() => vi.unstubAllGlobals())
it('fetches only the explicit link files without credentials or referrer', async () => {
  const { fetchDesignSystem } = await import('./fetch')
  const fetcher = vi.fn(async (url: string) => url.endsWith('tokens.json') ? new Response('{"name":"Test"}') : new Response('missing', { status: 404 }))
  vi.stubGlobal('fetch', fetcher)
  const link = linkFiles('https://files.example/project/')
  if (!('base' in link)) throw Error('expected project base')
  const read = await fetchDesignSystem(link.base)
  expect(fetcher.mock.calls.map(c => c[0])).toEqual(link.paths.map(p => link.base + p))
  for (const call of vi.mocked(fetch).mock.calls) expect(call[1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', redirect: 'manual' })
  expect(new TextDecoder().decode(read.files.get('tokens.json'))).toBe('{"name":"Test"}')
  expect(read.notes).toHaveLength(4)
})
it('explains network, HTML and refused links without trying a share API', async () => {
  const { fetchDesignSystem } = await import('./fetch')
  const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetcher)
  await expect(fetchDesignSystem('https://claude.ai/artifacts/test')).rejects.toThrow('network or CORS failure')
  fetcher.mockResolvedValue(new Response('<!doctype html><html>sign in</html>'))
  await expect(fetchDesignSystem('https://claude.ai/artifacts/test')).rejects.toThrow('HTML instead of design-system data')
  await expect(fetchDesignSystem('https://claude.ai/api/test')).rejects.toThrow(/never calls/)
  expect(fetcher.mock.calls.map(c => c[0])).toEqual(['https://claude.ai/artifacts/test', 'https://claude.ai/artifacts/test'])
})

it('keeps tokens when optional files are HTML fallback pages', async () => {
  const { fetchDesignSystem } = await import('./fetch')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('tokens.json') ? '{}' : '<html>fallback</html>')))
  const read = await fetchDesignSystem('https://files.example/project/')
  expect([...read.files.keys()]).toEqual(['tokens.json'])
  expect(read.notes).toEqual(['design-system.json', 'README.md', 'components/bundle.css', 'components/bundle.js'].map(p => p + ': HTML instead of design-system data; the page may need sign-in; not read'))
})
it('refuses an opaque redirect without following it', async () => {
  const { fetchDesignSystem } = await import('./fetch')
  const fetcher = vi.fn().mockResolvedValue({ type: 'opaqueredirect', ok: false, status: 0 })
  vi.stubGlobal('fetch', fetcher)
  await expect(fetchDesignSystem('https://claude.ai/artifacts/test')).rejects.toThrow('redirect refused')
  expect(fetcher).toHaveBeenCalledOnce()
})
it('sniffs only a prefix of a body that the reader still receives intact', async () => {
  const { fetchDesignSystem } = await import('./fetch')
  const payload = JSON.stringify({ name: 'x'.repeat(10000) })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(payload)))
  const decode = vi.spyOn(TextDecoder.prototype, 'decode')
  const read = await fetchDesignSystem('https://claude.ai/artifacts/test')
  expect(Math.max(...decode.mock.calls.map(c => (c[0] as Uint8Array)?.byteLength ?? 0))).toBeLessThan(1000)
  expect(read.files.get('tokens.json')!.byteLength).toBe(payload.length)
  decode.mockRestore()
})

it('keeps a pasted tokens URL query while discovering its same-folder siblings', async () => {
  const { fetchDesignSystem } = await import('./fetch')
  const fetcher = vi.fn(async (url: string) => url.includes('tokens.json') ? new Response('{}') : new Response('', { status: 404 }))
  vi.stubGlobal('fetch', fetcher)
  const supplied = 'https://files.example/design/tokens.json?token=signed'
  await fetchDesignSystem(supplied)
  expect(fetcher.mock.calls.map(c => c[0])).toEqual([supplied, 'design-system.json', 'README.md', 'components/bundle.css', 'components/bundle.js'].map((p, i) => i === 0 ? p : 'https://files.example/design/' + p))
})
