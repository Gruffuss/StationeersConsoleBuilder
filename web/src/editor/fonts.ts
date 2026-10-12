// The faces the preview draws labels in (spec §5.3: the Fonts mod takes any font, so there is no fixed list).
// The bundled defaults are self-hosted OFL files, listed in catalog/fonts.json and named as ScriptedScreensFonts
// names faces: the regular weight is the bare family, every other weight is family plus style ("Barlow", "Barlow
// Medium"). Any other font the player imports from a local file under the name the Fonts mod uses for it: it is
// registered with FontFace and kept in this browser's IndexedDB, never uploaded. A project stores only names.
import fonts from '../catalog/fonts.json'
import { faceName } from '../theme/faces'

export type Face = { name: string; file: string; weight: number; fontsMod: boolean }
export const FACES: Face[] = fonts.faces
export const DEFAULT_FACE: string = fonts.default
/** The bundled face names, in catalogue order. */
export const BUNDLED: string[] = [...new Set(FACES.map(f => f.name))]
const FALLBACK = '"Liberation Sans", Arial, Helvetica, sans-serif'   // Arial has Liberation Sans's metrics

// FontFaceSet's add and delete are missing from TypeScript 5.9's lib.dom; every browser has them.
type Faces = FontFaceSet & { add(f: FontFace): void; delete(f: FontFace): boolean }
// TypeScript 5.9 omits variationSettings from the CSS Font Loading descriptors dictionary.
type FontDescriptors = FontFaceDescriptors & { variationSettings: string }
const faceSet = () => document.fonts as Faces

// The imported fonts of this session, by name; the bundled files that failed to load (a 404, a wrong base URL); and who
// to tell when either changes.
type Entry = { family: string; style: string; slot: number; italic: boolean; fontsMod: boolean; cssFamily: string; weight?: number; axes?: Record<string, number>; faces: FontFace[] }
const imported = new Map<string, Entry>()
const pages = new Map<string, Entry>()
type SubsetObserver = (url: string, cause: string, name: string) => void
const pageSources = new Map<string, Map<string, { url: string; range: string; face: FontFace; failed: boolean; observers: Map<string, SubsetObserver>; cause?: string }>>()
const pageLinks = new Map<string, { observer: SubsetObserver; notices: Map<string, string> }>()
const notices = new Map<string, string>()
const localJobs = new Map<string, number | null>()
let serial = 0
let noticeEpoch = 0
export const fontNotices = () => [...notices.values(), ...[...pageLinks.values()].flatMap(link => [...link.notices.values()])]
export const FONT_PRECEDENCE = 'Local font files > bundled faces > earlier page downloads > fresh page requests. A cached page face cannot override a bundled name. New name clashes still spend a page face; cached faces cost nothing.'

/** Normalized metadata boundary. The isolated reader alone chooses ID16/17, per-field ID1/2 fallback and locale. */
export type FontAxis = { tag: string; min: number; default: number; max: number; name: string }
export type FontMetadata = { family: string; style: string; names: Record<number, string>; axes: FontAxis[]; instances: { family: string; style: string; axes: Record<string, number> }[] }
export type MetadataResult = (({ status: 'ok'; faces: FontMetadata[] } & FontMetadata) | { status: 'invalid' | 'failed' | 'read-budget' | 'cancelled'; cause: string }) & { notes?: string[] | null }
let readMetadata: (data: ArrayBuffer, signal?: AbortSignal) => Promise<MetadataResult> = async () => ({ status: 'failed', cause: 'font metadata reader is unavailable' })
/** Connect the independent metadata worker at bootstrap; no job goes through the chip worker. */
export const setFontMetadataReader = (read: typeof readMetadata) => { readMetadata = read }
const readNames = async (data: ArrayBuffer, signal?: AbortSignal): Promise<MetadataResult> => {
  try { return await readMetadata(data, signal) } catch (e) { return { status: 'failed', cause: causeOf(e) } }
}
const causeOf = (e: unknown) => e instanceof Error ? e.message : String(e)
export const registeredName = (family: string, style: string) => !style || /^regular$/i.test(style) ? family : family + ' ' + style
export function styleSlot(style: string) {
  const upper = style.toUpperCase(), word = upper.replace(/ITALIC/g, '').replace(/[^A-Z]/g, '')
  const slots: Record<string, number> = { THIN: 1, HAIRLINE: 1, EXTRALIGHT: 2, ULTRALIGHT: 2, LIGHT: 3, '': 4, REGULAR: 4, MEDIUM: 5, SEMIBOLD: 6, DEMIBOLD: 6, BOLD: 7, EXTRABOLD: 8, ULTRABOLD: 8, BLACK: 9, HEAVY: 9 }
  return { slot: Object.hasOwn(slots, word) ? slots[word] : 0, italic: upper.includes('ITALIC') }
}
const cssString = (s: string) => '"' + s.replace(/["\\\u0000-\u001f\u007f]/g, c => c === '"' || c === '\\' ? '\\' + c : '\\' + c.charCodeAt(0).toString(16) + ' ') + '"'
const variationsOf = (axes?: Record<string, number>) => axes ? Object.entries(axes).map(([axis, value]) => `${cssString(axis)} ${value}`).join(', ') : 'normal'
const bundled = new Map<string, Entry>(FACES.map(f => {
  const style = f.name.match(/ (Thin|ExtraLight|Light|Medium|SemiBold|Bold|ExtraBold|Black)(?: Italic)?$| (Italic)$/)?.[0].slice(1) ?? ''
  return [f.name, { family: style ? f.name.slice(0, -style.length - 1) : f.name, style, ...styleSlot(style), fontsMod: f.fontsMod, cssFamily: f.name, faces: [] }]
}))
const entryOf = (name: string) => imported.get(name) ?? (FACES.some(f => f.name === name && !failed.has(f.file)) ? bundled.get(name) : undefined) ?? (pageSources.get(name) && [...pageSources.get(name)!.values()].some(s => !s.failed) ? pages.get(name) : undefined)
const allEntries = () => [...new Set([...imported.keys(), ...BUNDLED, ...pages.keys()])].flatMap(name => { const entry = entryOf(name); return entry ? [[name, entry] as const] : [] })
const changedFamily = (name: string, family?: string) => {
  revisions.set(name, ++version)
  if (isKnownFont(name)) FONT_METRICS.set(name, metricsOf(name))
  else FONT_METRICS.delete(name)
  if (family) for (const [n, e] of allEntries()) if (e.family === family) revisions.set(n, version)
  for (const f of listeners) f()
}
const failed = new Set<string>()   // by file: one family may have several weights
const listeners = new Set<() => void>()
let version = 0
const revisions = new Map<string, number>()
const changed = (name: string) => { revisions.set(name, ++version); for (const f of listeners) f() }
/** The last availability change of one face, for labels that use it. */
export const fontVersion = (name: string) => revisions.get(name) ?? 0
/** For useSyncExternalStore: a number that changes whenever the fonts the preview can draw do. */
export const fontsVersion = () => version
export const subscribeFonts = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }
/** The names imported in this browser, sorted. */
export const importedFonts = () => [...imported.keys()].sort()
/** The names to offer: the bundled faces, then the imported ones. */
export const knownFonts = () => [...new Set([...BUNDLED, ...importedFonts(), ...pages.keys()])].filter(isKnownFont)
/** True for a face the preview draws: a bundled one with a file that loaded (or is loading), or an imported one. Exact,
 *  case and all. */
export const isKnownFont = (name: string) => !!entryOf(name)

/**
 * Registers bundled faces without fetching them. The browser loads a face only when text uses it; its loaded promise
 * reports a failed request, which is warned about and counts as unavailable in the preview.
 */
export function registerFaces(base = import.meta.env.BASE_URL) {
  for (const f of FACES) {
    const face = new FontFace(f.name, `url(${base}fonts/${f.file}) format('woff2')`, { weight: String(f.weight), display: 'block' })
    faceSet().add(face)
    face.loaded.then(() => changedFamily(f.name, bundled.get(f.name)?.family)).catch(e => {
      console.warn(`the bundled font ${f.file} did not load: ${e instanceof Error ? e.message : e}`)
      if (!failed.has(f.file)) { failed.add(f.file); changedFamily(f.name, bundled.get(f.name)?.family) }
    })
  }
}

/**
 * The CSS family for a label's face. A face the preview cannot draw gets the fallback alone, as TMP does, so a font the
 * system happens to have (or one differing only in case) never stands in for it; null and the default face are the game's.
 */
export const familyOf = (font: string | null) =>
  font && (font !== DEFAULT_FACE || imported.has(font) || entryOf(font)?.fontsMod) && isKnownFont(font) ? `${cssString(entryOf(font)!.cssFamily)}, ${FALLBACK}` : FALLBACK

const STYLES = ['Thin', 'ExtraLight', 'Light', '', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']
// Live vector T assets and Fonts-mod loader constants, in em; native ScriptedScreens labels use other defaults.
const GAME = { italic: 0.35, boldSpacing: 0.07, boldDilation: (0.75 / 4) * (10 - 1) / 86, gs: 10, pointSize: 86, other: 0.1875 }
const MOD = { italic: 0.35, boldSpacing: 0.07, boldDilation: (0.75 / 4) * (6 - 1) / 48, gs: 6, pointSize: 48, other: 0.1875 }
export const FONT_METRICS = new Map(BUNDLED.map(n => [n, n === DEFAULT_FACE ? GAME : MOD]))
const metricsOf = (font: string | null) => font && entryOf(font)?.fontsMod ? MOD : GAME
export const italicStyleOf = (font: string | null) => 100 * metricsOf(font).italic

/** vector 0.11.113 TextOutline.cs: TMP material padding, using the label's base size. */
export function textOutline(font: string | null, ow: number, size: number) {
  const { gs, pointSize, other } = metricsOf(font), padding = gs - 1
  const target = Math.max(0, ow) * pointSize / (2 * Math.max(1, size))
  const requested = target <= padding * (1 - other) ? target / padding
    : target < padding ? target * other / (padding - target) : 1
  const W = Math.min(1, requested), divisor = Math.max(1, other + W)
  const scaleRatioA = padding / (gs * divisor), boldRatio = scaleRatioA / (padding / gs)
  const reduced = requested > 1 || target >= padding
  const outward = W * padding / divisor
  return { width: reduced ? 2 * outward * Math.max(1, size) / pointSize : Math.max(0, ow), boldRatio,
    warning: reduced ? `the outline is reduced to ${(100 * outward / target).toFixed(1)}%` : '' }
}

/** The registered face in this metadata family's TMP slot; an unavailable slot stays synthetic. */
export function styleName(font: string | null, weight = 400, italic = false) {
  const original = font || DEFAULT_FACE, entry = entryOf(original), slot = Math.floor(weight / 100), style = STYLES[slot - 1]
  if (weight === 400 && !italic) return original // a face name chooses glyphs, not a weight slot
  if (!font) return ''
  if (!entry?.fontsMod || style === undefined) return ''
  const slanted = italic || entry.italic
  return allEntries().find(([, e]) => e.fontsMod && e.family === entry.family && e.slot === slot && e.italic === slanted)?.[0] ?? ''
}

/** Use a real face from TMP's slot table; a missing slot draws faux bold on the face in use. */
export function fontStyle(font: string | null, weight = 400, italic = false, italicStyle = italicStyleOf(font), spacing = 0, baseRatio = 1, ow = 0, size = 1): Record<string, string> {
  const vector = !font || !isKnownFont(font), original = vector ? DEFAULT_FACE : font
  const name = styleName(vector ? null : original, weight, italic)
  const real = !!name && (vector || isKnownFont(name))
  const selected = vector ? bundled.get(DEFAULT_FACE) : entryOf(real ? name : original)
  const faux = !real && weight !== 400, shear = italic && !real && !selected?.italic, metrics = vector ? GAME : metricsOf(original)
  const dilation = faux ? metrics.boldDilation * textOutline(font, ow, size).boldRatio : 0
  return { fontFamily: familyOf(vector ? null : real ? name : original), fontWeight: selected?.weight === undefined ? 'normal' : String(selected.weight),
    fontVariationSettings: variationsOf(selected?.axes),
    letterSpacing: (spacing + (faux ? metrics.boldSpacing * baseRatio : 0)) + 'em', WebkitTextStrokeWidth: 2 * dilation + 'em',
    WebkitTextStrokeColor: 'currentColor', paintOrder: 'stroke fill',
    fontStyle: 'normal', fontSynthesis: 'none',
    // shortcut: shear each shaped run about its centre; glyph-specific pivots need a glyph renderer.
    ...(shear && { display: 'inline-block', transform: 'matrix(1, 0, ' + (-Math.max(-180, Math.min(180, italicStyle)) * 0.01) + ', 1, 0, 0)', transformOrigin: 'center' }) }
}

/** Page-loader callback interface; its transport has already validated the CSS and asset policy. */
export type PageFontGroup = { family: string; style: string; weight: string; minWeight: number; maxWeight: number; representative: string; sources: { url: string; unicodeRange: string; display: 'swap' }[]; metadata: MetadataResult }
type NamedFace = { family: string; style: string; axes?: Record<string, number>; instances: FontMetadata['instances'] }
function metadataEntry(m: NamedFace, cssFamily: string): Entry {
  if (typeof m.family !== 'string' || !m.family || typeof m.style !== 'string' || !Array.isArray(m.instances)) throw new Error('cannot determine game face names from this served file')
  if (m.axes && Object.entries(m.axes).some(([axis, value]) => !/^[\x20-\x7e]{4}$/.test(axis) || !Number.isFinite(value))) throw new Error('invalid font axis metadata')
  return { family: m.family, style: m.style, ...styleSlot(m.style), fontsMod: true, cssFamily, axes: m.axes && Object.fromEntries(Object.entries(m.axes).sort(([a], [b]) => a.localeCompare(b))), faces: [] }
}
const normalized = (m: FontMetadata): NamedFace => ({ family: m.family, style: m.style, instances: m.instances, axes: m.axes.length ? Object.fromEntries(m.axes.map(a => [a.tag, a.default])) : undefined })
function variableFamily(m: FontMetadata) {
  if (m.names[16]) return m.family
  const instance = m.instances.find(i => m.axes.every(a => i.axes[a.tag] === a.default))
  const style = m.names[17] ?? instance?.style ?? m.names[2]
  const nonRegular = !!style && !/^regular$/i.test(style)
  if (!nonRegular && !m.axes.some(a => a.tag === 'wght' && a.default !== 400)) return m.family
  // Served-file comparisons verify a legacy family carrying its non-Regular default style.
  if (style && nonRegular && m.names[1]?.endsWith(' ' + style)) {
    const family = m.names[1].slice(0, -style.length - 1)
    if (family) return family
  }
  throw new Error('cannot determine game face names from this served file: cannot establish the typographic family from non-Regular default metadata')
}
function matchesStyle(m: Pick<NamedFace, 'style' | 'axes'>, style: string) {
  const italic = m.axes?.ital === undefined ? styleSlot(m.style).italic : m.axes.ital !== 0
  if (style === 'italic') return italic
  if (style === 'normal') return !italic && !(m.axes?.slnt)
  if (italic) return false
  const angles = style.slice('oblique'.length).trim().split(/\s+/).filter(Boolean).map(a => Number(a.replace(/deg$/, '')))
  if (!angles.length) return m.axes?.slnt !== undefined ? m.axes.slnt !== 0 : /oblique/i.test(m.style)
  return m.axes?.slnt !== undefined && -m.axes.slnt >= angles[0] && -m.axes.slnt <= angles.at(-1)!
}
function ranges(range: string): [number, number][] {
  return range.split(',').map(part => {
    const raw = part.trim().slice(2)
    const [lo, hi] = raw.includes('?') ? [raw.replace(/\?/g, '0'), raw.replace(/\?/g, 'F')] : raw.split('-')
    return [parseInt(lo, 16), parseInt(hi ?? lo, 16)]
  })
}
const overlaps = (a: string, b: string) => ranges(a).some(([lo, hi]) => ranges(b).some(([l, h]) => lo <= h && l <= hi))

/** Register atomically, without calling load(): Unicode subsets remain browser-demanded and session-cached. */
export function registerPageFonts(link: string, groups: readonly PageFontGroup[], failure: (url: string, cause: string) => void = () => {}, signal?: AbortSignal): readonly string[] {
  const planned = new Map<string, { entry: Entry; sources: NonNullable<ReturnType<typeof pageSources.get>> }>()
  const conflicts: string[] = []
  const linkNotices = new Map<string, string>()
  const observer: SubsetObserver = (url, cause, name) => {
    if (!signal?.aborted) { linkNotices.set('subset:' + name + ':' + url, `${name}: ${url}: ${cause}`); failure(url, cause) }
  }
  signal?.throwIfAborted()
  for (const group of groups) {
    const metadata = group.metadata
    if (metadata.status !== 'ok') throw new Error(metadata.cause)
    const faceMetadata = normalized(metadata)
    metadataEntry(faceMetadata, '')
    const variable = metadata.axes.length > 0 || metadata.instances.length > 0
    const family = variable ? variableFamily(metadata) : metadata.family
    const selected = variable ? metadata.instances.filter(instance => Number.isFinite(instance.axes.wght) && instance.axes.wght >= group.minWeight && instance.axes.wght <= group.maxWeight && matchesStyle(instance, group.style)
      && metadata.axes.every(axis => ['wght', 'ital', 'slnt'].includes(axis.tag) || instance.axes[axis.tag] === axis.default))
      : group.minWeight === group.maxWeight && matchesStyle(faceMetadata, group.style) ? [{ family: metadata.family, style: metadata.style, axes: undefined }] : []
    if (!selected.length) throw new Error(`no matching named instance for ${group.family} ${group.weight} ${group.style}`)
    for (const instance of selected) {
      const entry = metadataEntry({ ...instance, family, instances: [] }, 'vb-page-' + (++serial)), name = registeredName(entry.family, entry.style)
      entry.weight = instance.axes?.wght ?? group.minWeight
      const usable = pageSources.get(name) && [...pageSources.get(name)!.values()].some(s => !s.failed)
      const old = usable ? pages.get(name) : undefined, pending = planned.get(name)
      const claim = pending?.entry ?? old ?? entry
      const sources = pending?.sources ?? new Map(old ? pageSources.get(name) : undefined)
      if (claim.family !== entry.family || claim.style !== entry.style || claim.weight !== entry.weight || JSON.stringify(claim.axes) !== JSON.stringify(entry.axes)) {
        conflicts.push(`Page font ${name}: a different face claimed first; keeping its glyphs.`)
      } else for (const source of group.sources) {
        const key = source.url + '\n' + source.unicodeRange
        const same = sources.get(key)
        if (same && !same.failed) continue
        if ([...sources.values()].some(s => !s.failed && s.url !== source.url && overlaps(s.range, source.unicodeRange))) {
          conflicts.push(`Page font ${name}: different content overlaps a face that claimed first; keeping its glyphs.`)
          continue
        }
        const descriptors: FontDescriptors = { weight: String(entry.weight), style: group.style, unicodeRange: source.unicodeRange, display: 'swap', variationSettings: variationsOf(entry.axes) }
        const face = new FontFace(cssString(claim.cssFamily), `url(${cssString(source.url)})`, descriptors)
        face.loaded.catch(() => {}) // a later group/abort may reject this atomic batch before observers are installed
        sources.set(key, { url: source.url, range: source.unicodeRange, face, failed: false, observers: new Map() })
      }
      planned.set(name, { entry: claim, sources })
    }
  }
  const added: FontFace[] = []
  try {
    signal?.throwIfAborted()
    for (const [name, batch] of planned) for (const [key, source] of batch.sources) if (pageSources.get(name)?.get(key) !== source) {
      faceSet().add(source.face); added.push(source.face); signal?.throwIfAborted()
    }
  } catch (e) { for (const face of added) faceSet().delete(face); throw e }
  releasePageFonts(link)
  pageLinks.set(link, { observer, notices: linkNotices })
  for (const [name, batch] of planned) {
    const previous = pageSources.get(name)
    if (previous) for (const [key, source] of previous) if (batch.sources.get(key) !== source) faceSet().delete(source.face)
    pages.set(name, batch.entry); pageSources.set(name, batch.sources)
    batch.entry.faces = [...batch.sources.values()].map(s => s.face)
    for (const [key, source] of batch.sources) {
      source.observers.set(link, observer)
      if (source.failed) observer(source.url, source.cause!, name)
      if (previous?.get(key) === source) continue
      source.face.loaded.then(() => { if (pageSources.get(name)?.get(key) === source) changedFamily(name, batch.entry.family) }, e => {
        if (pageSources.get(name)?.get(key) !== source) return
        source.failed = true; source.cause = causeOf(e)
        for (const observer of source.observers.values()) observer(source.url, source.cause, name)
        changedFamily(name, batch.entry.family)
      })
    }
  }
  signal?.addEventListener('abort', () => {
    if (pageLinks.get(link)?.observer === observer) releasePageFonts(link)
  }, { once: true })
  for (const [name, batch] of planned) changedFamily(name, batch.entry.family)
  for (const conflict of conflicts) linkNotices.set('conflict:' + conflict, conflict)
  if (conflicts.length) changed('')
  return [...planned.keys()]
}
/** Removal drops the link's observers, preserving other pages and all successfully registered session faces. */
export function releasePageFonts(link: string) {
  for (const sources of pageSources.values()) for (const source of sources.values()) source.observers.delete(link)
  const previous = pageLinks.get(link)
  pageLinks.delete(link)
  if (previous?.notices.size) changed('')
}
/** Project replacement clears diagnostics and late observers, retaining session-cached faces. */
export function clearFontNotices() {
  noticeEpoch++
  for (const link of pageLinks.keys()) releasePageFonts(link)
  if (notices.size) { notices.clear(); changed('') }
}

// IndexedDB, one store of { name, data } records. A transaction resolves { result } once it has committed; any failure
// (no IndexedDB, private mode, blocked storage, a full disk) resolves null.
const DB = 'vectorbuilder-fonts', STORE = 'fonts'
function stored<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<{ result: T } | null> {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' })
      req.onerror = () => resolve(null)
      req.onsuccess = () => {
        const db = req.result
        try {
          const tx = db.transaction(STORE, mode), r = f(tx.objectStore(STORE))
          tx.oncomplete = () => { db.close(); resolve({ result: r.result }) }
          tx.onabort = () => { db.close(); resolve(null) }
        } catch { db.close(); resolve(null) }
      }
    } catch { resolve(null) }
  })
}

/**
 * Registers a font from its bytes under `name` (trimmed), replacing an imported one of that name, and keeps it in this
 * browser. Throws, keeping nothing, when the name/bytes are invalid, unreadable, removed or superseded while loading.
 * Resolves whether this browser's storage holds it: false leaves it for this session only. (`keep` false is for a font
 * loaded back from that storage, which holds it already.) A design-system import may explicitly request a variable
 * weight; a manual alias keeps the metadata defaults. The requested weight is kept with the bytes.
 */
export async function importFont(name: string, data: ArrayBuffer, keep = true, metadata?: MetadataResult, weight?: number): Promise<boolean> {
  if (typeof name !== 'string' || !(data instanceof ArrayBuffer)) throw new Error('corrupted local font name/data record')
  const n = name.trim()
  if (!n) throw new Error('a font needs the name the Fonts mod uses for it')
  if (weight !== undefined && (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 1000)) throw Error('invalid CSS font weight')
  const job = ++serial
  const epoch = noticeEpoch
  localJobs.set(n, job)
  const result = metadata ?? await readNames(data)
  let entry: Entry
  try { entry = result.status === 'ok' ? metadataEntry(normalized(result), n) : { family: '', style: '', slot: 0, italic: false, fontsMod: true, cssFamily: n, faces: [] } }
  catch (e) { entry = { family: '', style: '', slot: 0, italic: false, fontsMod: true, cssFamily: n, faces: [] }; metadata = { status: 'failed', cause: causeOf(e) } }
  if (weight !== undefined && result.status === 'ok') {
    const axis = result.axes.find(a => a.tag === 'wght')
    if (axis) {
      if (weight < axis.min || weight > axis.max) throw Error('the declared weight is outside the weight axis of this font file')
      entry.axes = { ...entry.axes, wght: weight }
      entry.italic = entry.italic || !!entry.axes.ital || !!entry.axes.slnt
      entry.style = faceName('', weight, entry.italic).trim() || 'Regular'; entry.slot = styleSlot(entry.style).slot
    }
  }
  entry.cssFamily = 'vb-local-' + job + ' ' + n
  entry.weight = entry.axes?.wght
  const descriptors: FontDescriptors = { weight: entry.weight === undefined ? 'normal' : String(entry.weight), variationSettings: variationsOf(entry.axes) }
  const face = new FontFace(cssString(entry.cssFamily), data, descriptors)
  await face.load()   // a file the browser cannot read throws here
  if (localJobs.get(n) !== job) throw new Error(`${n}: import was ${localJobs.get(n) === null ? 'removed before it finished loading' : 'superseded by a newer import'}`)
  const old = imported.get(n)
  faceSet().add(face)
  if (old) for (const f of old.faces) faceSet().delete(f)
  entry.faces = [face]; imported.set(n, entry)
  notices.delete('stored:local:' + n)
  const unavailable = metadata && metadata.status !== 'ok' ? metadata : result.status !== 'ok' ? result : null
  if (epoch === noticeEpoch) {
    if (unavailable) notices.set('local:' + n, `${n}: ${unavailable.cause}; manual preview uses slot 0 without linked weights.`)
    else notices.delete('local:' + n)
  }
  if (old && old.family !== entry.family) changedFamily(n, old.family)
  changedFamily(n, entry.family)
  return !keep || await stored('readwrite', s => s.put({ name: n, data, ...(weight === undefined ? {} : { weight }) })) !== null
}

/**
 * Forgets an imported font, here and in this browser's storage (also one that is only stored). Resolves whether the
 * storage was updated: false when it could not be reached.
 */
export async function removeFont(name: string): Promise<boolean> {
  localJobs.set(name, null)
  const removedNotice = notices.delete('local:' + name)
  const removedStored = notices.delete('stored:local:' + name)
  const face = imported.get(name)
  if (face) {
    for (const f of face.faces) faceSet().delete(f)
    imported.delete(name)
    changedFamily(name, face.family)
  } else if (removedNotice || removedStored) changed('')
  return await stored('readwrite', s => s.delete(name)) !== null
}

/** Registers the fonts this browser imported before; one it can no longer read is skipped, with a warning. */
export async function loadImportedFonts() {
  const epoch = noticeEpoch
  const all = await stored<unknown[]>('readonly', s => s.getAll())
  if (!all) return console.warn('the imported fonts could not be read from this browser\'s storage')
  for (const [index, value] of all.result.entries()) {
    const localName = value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' ? value.name : undefined
    let localJob: number | null | undefined
    try {
      if (!value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string' || !('data' in value) || !(value.data instanceof ArrayBuffer)) throw new Error('corrupted local font name/data record')
      if (!localJobs.has(value.name)) {
        const weight = 'weight' in value ? value.weight : undefined
        if (weight !== undefined && typeof weight !== 'number') throw Error('corrupted local font weight record')
        const pending = importFont(value.name, value.data, false, undefined, weight)
        localJob = localJobs.get(value.name)
        await pending
      }
    } catch (e) {
      if (epoch !== noticeEpoch || (localName !== undefined && localJobs.get(localName) !== localJob)) continue
      const name = value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' ? ` ${JSON.stringify(value.name)}` : ''
      const notice = `Stored font record ${index + 1}${name} was skipped: ${causeOf(e)}`
      const key = localName !== undefined ? 'local:' + localName : 'record:' + index
      notices.set('stored:' + key, notice); console.warn(notice); changed('')
    }
  }
}

/** Suggest the same metadata family/style alias for every file format, without an ID4-only reader. */
export async function fontName(data: ArrayBuffer, signal?: AbortSignal): Promise<string | null> {
  const result = await readNames(data, signal)
  if (result.status !== 'ok') return null
  try { metadataEntry(normalized(result), ''); return registeredName(result.family, result.style) } catch { return null }
}

/** A file name without its extension, for a font whose own name cannot be read. */
export const nameOfFile = (file: string) => file.replace(/\.[^.]*$/, '')
