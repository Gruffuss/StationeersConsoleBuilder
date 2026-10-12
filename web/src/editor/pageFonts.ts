import type { Scene } from '../model/scene'
import { first } from '../srctext/props'

export const PAGE_FONT_NOTICE = 'Add or Load sends this page’s font links to Google. The preview accepts only HTTPS CSS on fonts.googleapis.com and HTTPS files on fonts.gstatic.com, without redirects. The game refuses HTTP links and HTTP font URLs inside stylesheets too; redirects give download-failed. Direct TTF/OTF links on the allowed hosts load in game but are not supported here; direct WOFF2 links fail in game as download-failed (WOFF1 is untested).'
// A download deadline keeps stalled CSS/assets retryable; it does not limit font size.
export const PAGE_FONT_FETCH_TIMEOUT_MS = 30_000

/** Checked direct declarations only; inspecting a scene never grants download consent. */
export function pageFontLinks(scene: Scene): string[] {
  const links = new Set<string>()
  for (const def of scene.defs) {
    if (def.op.toUpperCase() !== 'FONT') continue
    const src = first(def, 'SRC')
    if (typeof src === 'string' && src.length) links.add(src)
  }
  return [...links]
}

export interface PageFontSource { url: string; unicodeRange: string; display: 'swap' }
export interface PageFontGroup<M> {
  family: string
  style: string
  weight: string
  minWeight: number
  maxWeight: number
  sources: PageFontSource[]
  representative: string
  metadata: M
}
export interface PageFontRecord {
  link: string
  state: 'pending' | 'loaded' | 'refused' | 'failed'
  names: readonly string[]
  cause?: string
  notice: string
  settledAt?: number
  subsetFailures: readonly { url: string; cause: string }[]
}
export interface PageFontCallbacks<M> {
  readFontMetadata(data: ArrayBuffer, signal: AbortSignal): Promise<M>
  /** Reject metadata failures/no matching instances; add URL faces lazily, and report each later failed subset. */
  registerPageFonts(link: string, groups: readonly PageFontGroup<M>[], failure: (url: string, cause: string) => void, signal: AbortSignal): readonly string[] | Promise<readonly string[]>
  fetch?: typeof globalThis.fetch
}

class Refused extends Error {}
const causeOf = (e: unknown) => e instanceof Error ? e.message : String(e)
function allowedUrl(src: string, host: string, base?: string): URL {
  if (!src || src !== src.trim() || /[\\\u0000-\u001f\u007f]/.test(src) || src.startsWith('//') || (!base && !/^https:\/\//i.test(src)))
    throw new Refused('The preview requires a complete HTTPS URL without outer whitespace, control characters, backslashes or scheme-relative spelling.')
  let url: URL
  try { url = new URL(src, base) } catch { throw new Refused('The preview cannot read this URL.') }
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.port)
    throw new Refused(`The preview permits only HTTPS on the exact host ${host}, without credentials or non-default ports.`)
  return url
}
function cssUrl(link: string) {
  const url = allowedUrl(link, 'fonts.googleapis.com')
  if (/\.(?:ttf|otf|woff2?)$/i.test(url.pathname)) throw new Refused('Direct font files are unsupported in the preview.')
  return url
}

// Split only outside strings/functions; downloaded CSS is never attached to a document.
function cssParts(text: string, delimiters: string): string[] {
  const parts: string[] = []
  let value = '', quote = '', depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') { value += c + (text[++i] ?? ''); continue }
    if (quote) { value += c; if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") { quote = c; value += c; continue }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) throw new Error('Unterminated CSS comment.')
      i = end + 1; value += ' '; continue
    }
    if (c === '(' || c === '[') depth++
    if (c === ')' || c === ']') depth--
    if (depth < 0) throw new Error('Unbalanced CSS function.')
    if (!depth && delimiters.includes(c)) { parts.push(value, c); value = '' } else value += c
  }
  if (quote || depth) throw new Error('Unterminated CSS string or function.')
  parts.push(value)
  return parts
}
function decodeCss(text: string): string {
  return text.replace(/\\(?:([\da-f]{1,6})\s?|([^\r\n\f])|\r\n|[\r\n\f])/gi, (_all, hex: string | undefined, char: string | undefined) => {
    if (!hex) return char ?? ''
    const n = parseInt(hex, 16)
    return !n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? '\ufffd' : String.fromCodePoint(n)
  })
}
const cssString = (s: string) => decodeCss(s.startsWith('"') || s.startsWith("'") ? s.slice(1, -1) : s)
const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
function weightOf(raw = 'normal') {
  const text = decodeCss(raw).toLowerCase().replace(/\s*!\s*important\s*$/, ''), words = text.trim().split(/\s+/)
  const values = words.map(w => w === 'normal' ? 400 : w === 'bold' ? 700 : number.test(w) ? Number(w) : NaN)
  if (values.length > 2 || values.some(n => !Number.isFinite(n) || n < 1 || n > 1000) || (values.length === 2 && values[0] > values[1]))
    throw new Error(`Invalid CSS font-weight descriptor: ${raw}`)
  return { weight: values.join(' '), minWeight: values[0], maxWeight: values.at(-1)! }
}
function styleOf(raw = 'normal') {
  const text = decodeCss(raw).trim().toLowerCase()
  if (text === 'normal' || text === 'italic' || text === 'oblique') return text
  const words = text.split(/\s+/)
  if (words[0] !== 'oblique' || words.length < 2 || words.length > 3) throw new Error(`Invalid CSS font-style descriptor: ${raw}`)
  const angles = words.slice(1).map(w => {
    const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)$/.exec(w)
    return m ? Number(m[1]) * ({ deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[m[2]]!) : NaN
  })
  if (angles.some(n => !Number.isFinite(n) || n < -90 || n > 90) || (angles.length === 2 && angles[0] > angles[1]))
    throw new Error(`Invalid CSS font-style descriptor: ${raw}`)
  return 'oblique ' + angles.map(n => n + 'deg').join(' ')
}
function unicodeOf(raw = 'U+0-10FFFF') {
  const text = decodeCss(raw).trim()
  for (const item of text.split(',')) {
    const m = /^U\+([\da-f]{1,6}|[\da-f]*\?+)(?:-([\da-f]{1,6}))?$/i.exec(item.trim())
    if (!m || m[1].length > 6 || (m[1].includes('?') && m[2])) throw new Error(`Invalid CSS unicode-range descriptor: ${raw}`)
    const start = parseInt(m[1].replace(/\?/g, '0'), 16), end = parseInt(m[2] ?? m[1].replace(/\?/g, 'f'), 16)
    if (start > end || end > 0x10ffff) throw new Error(`Invalid CSS unicode-range descriptor: ${raw}`)
  }
  return text
}
function sourceOf(raw: string, base: string) {
  let refused: Refused | undefined
  for (const candidate of cssParts(raw, ',').filter((_, i) => i % 2 === 0)) {
    const m = /^url\(\s*("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(?:\\[\s\S]|[^\\\s"'()])*)\s*\)\s*(?:format\(\s*("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[-\w]+)\s*\))?\s*(?:tech\(\s*variations\s*\))?$/i.exec(candidate.trim())
    if (!m) continue // local(), unsupported technology, or malformed candidate
    if (m[2] && !['woff2', 'woff2-variations', 'truetype', 'truetype-variations', 'opentype'].includes(cssString(m[2]).toLowerCase())) continue
    try {
      const src = cssString(m[1]), resolved = allowedUrl(src, 'fonts.gstatic.com', base)
      return /^https:\/\//i.test(src) ? src : resolved.href
    } catch (e) {
      if (e instanceof Refused) refused = e; else throw e
    }
  }
  throw refused ?? new Error('CSS src has no supported URL source; local() is not used in this preview.')
}
type Descriptors = Omit<PageFontGroup<never>, 'metadata'>
function groupsOf(css: string, base: string): Descriptors[] {
  const groups = new Map<string, Descriptors>(), sources = new Set<string>(), parts = cssParts(css, '{}'), sheet = new CSSStyleSheet()
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] !== '{' || decodeCss(parts[i - 1]).trim().toLowerCase() !== '@font-face') continue
    const body = parts[i + 1]
    if (parts[i + 2] !== '}') throw new Error('Malformed CSS @font-face rule.')
    sheet.replaceSync(`@font-face {${body}}`)
    const rule = sheet.cssRules[0] as CSSFontFaceRule | undefined
    if (!rule || rule.type !== CSSRule.FONT_FACE_RULE) throw new Error('Malformed CSS @font-face rule.')
    // Keep raw descriptors too: browsers can silently drop an invalid descriptor from CSSOM.
    const attrs = new Map<string, string>()
    for (const declaration of cssParts(body, ';').filter((_, j) => j % 2 === 0)) {
      const pair = cssParts(declaration, ':')
      if (pair.length >= 3) attrs.set(decodeCss(pair[0]).trim().toLowerCase(), pair.slice(2).join('').trim())
    }
    const rawFamily = rule.style.getPropertyValue('font-family').trim()
    if (!rawFamily || cssParts(rawFamily, ',').length !== 1) throw new Error('Invalid CSS font-family descriptor.')
    const family = cssString(rawFamily), style = styleOf(attrs.get('font-style')), weight = weightOf(attrs.get('font-weight'))
    if (!family) throw new Error('Empty CSS font-family descriptor.')
    const unicodeRange = unicodeOf(attrs.get('unicode-range')), url = sourceOf(attrs.get('src') ?? '', base)
    const key = JSON.stringify([family, style, weight.weight]), source: PageFontSource = { url, unicodeRange, display: 'swap' }
    const existing = groups.get(key)
    const sourceKey = JSON.stringify([key, url, unicodeRange])
    if (existing) {
      if (!sources.has(sourceKey)) existing.sources.push(source)
    } else groups.set(key, { family, style, ...weight, representative: url, sources: [source] })
    sources.add(sourceKey)
  }
  if (!groups.size) throw new Error('The CSS response contains no usable @font-face rules.')
  return [...groups.values()]
}

/** One browser-session store. Only call loadPageFonts from an explicit Add/Load/Retry for the active page. */
export function createPageFontLoader<M>(callbacks: PageFontCallbacks<M>) {
  const records = new Map<string, PageFontRecord>(), pending = new Map<string, Promise<void>>()
  const generations = new Map<string, AbortController>()
  const metadata = new Map<string, { job: Promise<M>; controller: AbortController; users: Set<AbortSignal>; settled: boolean }>()
  const listeners = new Set<() => void>()
  let version = 0
  const changed = () => { version++; for (const listener of listeners) listener() }
  const update = (link: string, patch: Partial<PageFontRecord>) => {
    records.set(link, { ...records.get(link)!, ...patch }); changed()
  }
  async function response<T>(url: string, signal: AbortSignal, body: (r: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController(), cancel = () => controller.abort(signal.reason)
    let rejectAbort!: (reason: unknown) => void
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
    const onAbort = () => rejectAbort(controller.signal.reason)
    controller.signal.addEventListener('abort', onAbort, { once: true })
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    const timer = setTimeout(() => controller.abort(new Error(`Preview fetch timed out after 30 seconds: ${url}. Retry this page's fonts.`)), PAGE_FONT_FETCH_TIMEOUT_MS)
    try {
      return await Promise.race([aborted, (async () => {
        controller.signal.throwIfAborted()
        const r = await (callbacks.fetch ?? globalThis.fetch)(url, { credentials: 'omit', referrer: '', referrerPolicy: 'no-referrer', mode: 'cors', redirect: 'error', signal: controller.signal })
        controller.signal.throwIfAborted()
        if (r.redirected) throw new Error(`Redirect refused for ${url}; the game refuses redirects too, as download-failed.`)
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url} in the preview; the game has its own download result.`)
        const result = await body(r)
        controller.signal.throwIfAborted()
        return result
      })()])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }
  function read(url: string, signal: AbortSignal) {
    let entry = metadata.get(url)
    if (!entry) {
      const controller = new AbortController()
      const job = response(url, controller.signal, r => r.arrayBuffer()).then(data => {
        controller.signal.throwIfAborted()
        return callbacks.readFontMetadata(data, controller.signal)
      })
      entry = { job, controller, users: new Set(), settled: false }
      metadata.set(url, entry)
      const current = entry
      job.then(() => { current.settled = true }, () => { if (metadata.get(url) === current) metadata.delete(url) })
    }
    const current = entry
    current.users.add(signal)
    // A removed link must not abort a representative still needed by another active link.
    const release = () => {
      current.users.delete(signal); signal.removeEventListener('abort', release)
      if (signal.aborted && !current.users.size && !current.settled) {
        current.controller.abort()
        if (metadata.get(url) === current) metadata.delete(url)
      }
    }
    signal.addEventListener('abort', release)
    return current.job.finally(release)
  }
  async function attempt(link: string, controller: AbortController) {
    let representatives: string[] = []
    try {
      cssUrl(link)
      const css = await response(link, controller.signal, r => r.text()), descriptors = groupsOf(css, link)
      representatives = descriptors.map(group => group.representative)
      const groups: PageFontGroup<M>[] = []
      for (const group of descriptors) {
        if (controller.signal.aborted) return
        groups.push({ ...group, metadata: await read(group.representative, controller.signal) })
      }
      if (controller.signal.aborted) return
      const names = await callbacks.registerPageFonts(link, groups, (url, cause) => {
        if (generations.get(link) !== controller) return
        const old = records.get(link)!.subsetFailures
        if (!old.some(f => f.url === url && f.cause === cause)) update(link, { subsetFailures: [...old, { url, cause }] })
      }, controller.signal)
      if (controller.signal.aborted) return
      if (!names.length || names.some(n => typeof n !== 'string' || !n.length)) throw new Error('Cannot determine game face names from this served file, or no matching named instance.')
      update(link, { state: 'loaded', names: [...new Set(names)], settledAt: Date.now() })
    } catch (e) {
      if (controller.signal.aborted) return
      for (const url of representatives) metadata.delete(url)
      update(link, { state: e instanceof Refused ? 'refused' : 'failed', cause: `${causeOf(e)}${e instanceof Refused ? ' ' + PAGE_FONT_NOTICE : ''}`, settledAt: Date.now() })
    }
  }
  async function loadPageFonts(links: readonly string[]): Promise<void> {
    const jobs: Promise<void>[] = []
    for (const link of new Set(links)) {
      const running = pending.get(link)
      if (running) { jobs.push(running); continue }
      const old = records.get(link)
      if (old?.state === 'loaded') continue
      if (old?.settledAt !== undefined && Date.now() - old.settledAt < 60_000) {
        const at = old.settledAt + 60_000, seconds = Math.ceil((at - Date.now()) / 1000)
        update(link, { notice: `Retry not yet available; try again at ${new Date(at).toLocaleTimeString()} (in ${seconds} second${seconds === 1 ? '' : 's'}).` })
        continue
      }
      const controller = new AbortController()
      generations.set(link, controller)
      records.set(link, { link, state: 'pending', names: [], subsetFailures: [], notice: PAGE_FONT_NOTICE }); changed()
      const job = attempt(link, controller)
      pending.set(link, job)
      jobs.push(job.finally(() => { if (pending.get(link) === job) pending.delete(link) }))
    }
    await Promise.all(jobs)
  }
  function cancelPageFontRequests(links: readonly string[]) {
    for (const link of links) {
      if (!pending.has(link)) continue
      generations.get(link)?.abort(); generations.delete(link)
      pending.delete(link); records.delete(link); changed()
    }
  }
  return {
    loadPageFonts, cancelPageFontRequests,
    getPageFontRecord: (link: string): PageFontRecord | undefined => records.get(link),
    pageFontsVersion: () => version,
    subscribePageFonts: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

let session: ReturnType<typeof createPageFontLoader> | undefined
/** Wire the metadata worker and page registry before mounting the UI; never take callbacks or consent from a project. */
export function configurePageFonts<M>(callbacks: PageFontCallbacks<M>) {
  if (session) throw new Error('Page font callbacks are already configured for this session.')
  session = createPageFontLoader(callbacks)
}
export const loadPageFonts = (links: readonly string[]): Promise<void> => {
  if (!session) return Promise.reject(new Error('Page font callbacks have not been configured.'))
  return session.loadPageFonts(links)
}
export const getPageFontRecord = (link: string) => session?.getPageFontRecord(link)
export const pageFontsVersion = () => session?.pageFontsVersion() ?? 0
export const subscribePageFonts = (listener: () => void) => session?.subscribePageFonts(listener) ?? (() => {})
export const cancelPageFontRequests = (links: readonly string[]) => session?.cancelPageFontRequests(links)
