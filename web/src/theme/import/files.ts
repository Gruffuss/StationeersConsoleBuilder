import { safePath, type DsFiles } from './types'

function alias(path: string): string {
  if (path.toLowerCase() === 'readme.md') return 'README.md'
  if (/^(?:_ds_bundle|bundle)\.js$/.test(path)) return 'components/bundle.js'
  if (/^(?:_ds_bundle\.css|styles\.css)$/.test(path)) return 'components/bundle.css'
  const prompt = /^components\/([^/]+)\.prompt\.md$/.exec(path)
  if (prompt) return 'components/' + prompt[1] + '/README.md'
  const usage = /^((?:components\/)?[^/]+)\/usage\.md$/.exec(path)
  return usage ? usage[1] + '/README.md' : path
}

export function systemRoot(input: DsFiles): { files: DsFiles; notes: string[] } {
  const notes: string[] = [], paths = new Map<string, Uint8Array>()
  for (const [name, bytes] of input) {
    const path = safePath(name)
    if (!path) { notes.push(name + ': refused path'); continue }
    if (paths.has(path)) notes.push(name + ': repeated path; keeping last')
    paths.set(path, bytes)
  }
  const ordered = [...paths.keys()].sort()
  const roots = ordered.filter(p => p === 'tokens.json' || p.endsWith('/tokens.json')).map(p => p.slice(0, -'tokens.json'.length)).sort((a,b) => a.length-b.length)
  let root = roots[0]
  if (roots.length > 1) for (const other of roots.slice(1)) notes.push(other + 'tokens.json: another design-system root; using ' + root + 'tokens.json')
  if (root === undefined) {
    const css = ordered.find(p => /(?:^|\/)tokens\/[^/]+\.css$/.test(p))
    root = css ? css.slice(0, css.lastIndexOf('tokens/')) : ''
    if (!css) notes.push('tokens.json: not found; no tokens/*.css bundle found')
  }
  const files = new Map<string, Uint8Array>()
  for (const path of ordered) {
    if (!path.startsWith(root)) continue
    let relative = alias(path.slice(root.length))
    if (/^components\/[^/]+\/readme\.md$/i.test(relative)) relative = relative.replace(/readme\.md$/i, 'README.md')
    if (files.has(relative)) { notes.push(path + ': alias collides with ' + relative + '; keeping first by path order'); continue }
    files.set(relative, paths.get(path)!)
  }
  return { files, notes }
}

export function linkFiles(input: string): { base: string; paths: string[] } | { single: string } | { refused: string } {
  let url: URL
  try { url = new URL(input) } catch { return { refused: 'Enter an HTTPS URL' } }
  if (url.protocol !== 'https:' || url.username || url.password) return { refused: 'Only HTTPS URLs without credentials can be fetched' }
  let path: string
  try { path = decodeURIComponent(url.pathname) } catch { return { refused: 'Unreadable URL path' } }
  if (url.hostname === 'claude.ai' || url.hostname.endsWith('.claude.ai')) {
    if (/^\/api(?:\/|$)/i.test(path)) return { refused: 'The design-system importer never calls the share API' }
    return { single: url.href }
  }
  const match = /^(.*\/project)(?:\/.*)?$/.exec(url.pathname) ?? /^(.*)\/tokens\.json$/.exec(url.pathname)
  if (!match) return { single: url.href }
  url.pathname = match[1] + '/'; url.search = ''; url.hash = ''
  return { base: url.href, paths: ['tokens.json', 'design-system.json', 'README.md', 'components/bundle.css', 'components/bundle.js'] }
}
