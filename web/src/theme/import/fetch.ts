import { linkFiles } from './files'

export async function fetchDesignSystem(input: string, signal?: AbortSignal): Promise<{ files: Map<string, Uint8Array>; notes: string[] }> {
  const link = linkFiles(input)
  if ('refused' in link) throw Error(link.refused)
  const files = new Map<string, Uint8Array>(), notes: string[] = [], supplied = new URL(input)
  const requests = 'single' in link ? [['tokens.json', link.single]] : link.paths.map(path => [path, path === 'tokens.json' && supplied.pathname.endsWith('/tokens.json') ? supplied.href : link.base + path])
  for (const [path, url] of requests) {
    try {
      let response: Response
      try { response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', redirect: 'manual', signal }) }
      catch (e) { if (signal?.aborted) throw e; throw Error('network or CORS failure') }
      if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) throw Error('redirect refused; only the supplied URL can be read')
      if (!response.ok) throw Error('HTTP ' + response.status)
      const bytes = new Uint8Array(await response.arrayBuffer())
      let start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
      while ([9, 10, 12, 13, 32].includes(bytes[start])) start++
      if (/text\/html/i.test(response.headers.get('content-type') ?? '') || /^<(?:!doctype|html)/i.test(new TextDecoder().decode(bytes.subarray(start, start + 32))))
        throw Error('HTML instead of design-system data; the page may need sign-in')
      files.set(path, bytes)
    } catch (e) {
      if (signal?.aborted) throw e
      const message = path + ': ' + (e instanceof Error ? e.message : String(e))
      if (path === 'tokens.json') throw Error(message + '. Use files or paste, or Copy prompt.')
      notes.push(message + '; not read')
    }
  }
  return { files, notes }
}
