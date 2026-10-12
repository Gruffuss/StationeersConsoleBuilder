import { readdirSync, readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
const fileReads = vi.hoisted(() => ({ count: 0 }))
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, readFileSync: (...args: Parameters<typeof fs.readFileSync>) => { fileReads.count++; return fs.readFileSync(...args) } }
})
import { floorVer } from '../codegen/generate'
import { VECTOR_FLOOR } from '../model/project'
import type { Extracted } from './extract'
import extracted from './extracted.json'
import { trapsOf } from './traps'
import { catalogue, COLOUR_KEYS, DEF_OPS, EXPRESSIONS, FIELD_TYPES, fieldOf, fieldsFor, FUNCTIONS, GROUP_PAINT_DEFAULTS, GROUPS,
  HEADER, KNOWN_KEYS, NODE_OPS, PAINTS, PASSED_DOWN, ROWS, TEXTS, VARIABLES, COLOUR_FUNCTIONS } from '.'

const x = extracted as unknown as Extracted
const vector = new URL('../../../core/vendor/vector/', import.meta.url)
const read = (f: string) => readFileSync(new URL(f, vector), 'utf8')
const OPS = [...NODE_OPS, ...DEF_OPS, 'SCENE', 'DATA']
const ALL = OPS.flatMap(fieldsFor)
const sorted = (s: Iterable<string>) => [...s].sort()

// Keys the mod knows that no Reader(map, "key") call names: the colour filters (G's loop over ColourFilter.Keys; sat is
// also the stroke's gradient sample, which is read by name), s_ (ParseStyle's loop over GroupPaintDefaults) and grad
// (read inside a paint map). The dead keys sd and sdo are gone since 0.11.96: the mod reports them as unknown.
const DYNAMIC = ['bri', 'con', 'hue', 'gray', 'sep', 'inv', 's_', 'grad']
const read_ = new Set(Object.values(x.reads).flatMap(r => Object.keys(r)))

it('(a0) every key the mod knows is read by name or dynamic', () => {
  expect(x.knownKeys.filter(k => !read_.has(k) && !DYNAMIC.includes(k))).toEqual([])
  expect(x.knownKeys.filter(k => k === 'sd' || k === 'sdo')).toEqual([])
})

it('(a1) the overlay has a row for exactly the keys the parser reads', () => {
  const plus = (keys: Iterable<string>) => [...new Set([...keys, ...DYNAMIC])].sort()
  expect(plus(ROWS.map(r => r.key))).toEqual(plus(read_))
})

it("(a2) every key an op's own case reads has a row on that op", () => {
  // NODE and DEF are the methods every node or def op shares; the overlay's ops say which ops use those keys.
  const missing = Object.entries(x.reads).filter(([scope]) => scope !== 'NODE' && scope !== 'DEF')
    .flatMap(([op, keys]) => Object.keys(keys).filter(k => !ROWS.some(r => r.key === k && r.ops.includes(op))).map(k => `${op} ${k}`))
  expect(missing).toEqual([])
})

it('(a3) every gradient op offers only the keys it reads', () => {
  // GL and GR share a case in ParseDefs, but x1 y1 x2 y2 are read on the linear branch only and cx cy r fx fy on the radial.
  for (const op of ['GL', 'GR', 'GC'])
    expect(sorted(fieldsFor(op).map(f => f.key).filter(k => !(k in x.reads.DEF))), op).toEqual(sorted(Object.keys(x.reads[op])))
  expect(fieldOf('GL', 'x1')).toBeDefined()
  expect(fieldOf('GL', 'cx')).toBeUndefined()
  expect(fieldOf('GR', 'x1')).toBeUndefined()
  expect(fieldOf('GR', 'fx')).toMatchObject({ defaultFrom: 'cx' })
  expect(fieldOf('GC', 'a')).toBeDefined()
})

it('(d) every enum word but the default is one the mod reads; every alias names an enum word', () => {
  const quoted = new Set([...(read('SceneModel.cs') + read('TextNode.cs')).matchAll(/"([A-Za-z][A-Za-z-]*)"/g)].map(m => m[1].toLowerCase()))
  const fields = ALL.filter(f => f.enum)
  expect(fields.length).toBeGreaterThan(10)
  expect(fields.flatMap(f => [...f.enum!, ...Object.keys(f.alias ?? {})].filter(w => w !== f.default && !quoted.has(w)).map(w => `${f.op} ${f.key} ${w}`))).toEqual([])
  expect(fields.flatMap(f => Object.values(f.alias ?? {}).filter(w => !f.enum!.includes(w)))).toEqual([])
})

it('the overlay keeps to its own vocabulary', () => {
  const bad = (test: (r: (typeof ROWS)[number]) => unknown) => ROWS.filter(r => !test(r)).map(r => `${r.ops} ${r.key}`)
  expect(bad(r => (GROUPS as readonly string[]).includes(r.group))).toEqual([])
  expect(bad(r => (FIELD_TYPES as readonly string[]).includes(r.type))).toEqual([])
  expect(bad(r => r.ops.every(op => OPS.includes(op)))).toEqual([])
  expect(bad(r => [r.default, r.defaultFrom, r.defaultNote].filter(d => d !== undefined).length <= 1)).toEqual([])
  expect(bad(r => (r.type === 'enum') === !!r.enum)).toEqual([])
  // Within a group an order is one key's: rows of one key on different ops may share it, two keys may not.
  const orders = new Map<string, string>()
  for (const r of ROWS) {
    const at = `${r.group} ${r.order}`
    expect(orders.get(at) ?? r.key, at).toBe(r.key)
    orders.set(at, r.key)
  }
  // An enum's default is one of its words; a requirement and a defaultFrom name a key the op has.
  expect(ALL.filter(f => f.enum && f.default !== undefined && !f.enum.includes(f.default as string)).map(f => `${f.op} ${f.key}`)).toEqual([])
  expect(ALL.filter(f => f.requires && !fieldOf(f.op, f.requires)).map(f => `${f.op} ${f.key} requires ${f.requires}`)).toEqual([])
  expect(ALL.filter(f => f.defaultFrom && !fieldOf(f.op, f.defaultFrom)).map(f => `${f.op} ${f.key} from ${f.defaultFrom}`)).toEqual([])
  expect([...PASSED_DOWN.values()].filter(k => !GROUP_PAINT_DEFAULTS.includes(k))).toEqual([])
})

it('refuses two rows that give one op the same key, compared as the mod compares keys', () => {
  expect(() => catalogue([...ROWS, { ...ROWS.find(r => r.key === 'cx')!, key: 'CX' }])).toThrow('two rows give C the key CX')
})

it('each op has one field per key, by group then order', () => {
  for (const op of OPS) {
    const fs = fieldsFor(op)
    expect(new Set(fs.map(f => f.key)).size, op).toBe(fs.length)
  }
  expect(fieldsFor('T').map(f => f.key).slice(0, 6)).toEqual(['x', 'y', 'w', 'h', 'f', 'fo'])
})

const web = new URL('../', import.meta.url), core = new URL('../../../core/Core/', import.meta.url)
const files = [...readdirSync(web, { recursive: true, encoding: 'utf8' }).filter(f => /\.tsx?$/.test(f)).map(f => new URL(f.replaceAll('\\', '/'), web)),
  ...readdirSync(core).filter(f => f.endsWith('.cs')).map(f => new URL(f, core))]
const codePinClaims = files.flatMap(f => [...readFileSync(f, 'utf8').matchAll(
  /the pin\s*(?:\/\/\s*)?\(v(\d+\.\d+\.\d+)\)|Line numbers are [^\n]*? at v(\d+\.\d+\.\d+)|Ported from scripted-screens-vector v(\d+\.\d+\.\d+)|(?:\b\w+\.cs:[^\n]*?|:[\d-]+) at v(\d+\.\d+\.\d+)|ScriptedScreensVector v(\d+\.\d+\.\d+)|Line anchors below are at v(\d+\.\d+\.\d+)/g)]
  .map(m => `${f.pathname.split('/').slice(-2).join('/')} ${m.slice(1).find(v => v !== undefined)}`))

it('names the pin wherever the code says what the pin does, the warnings included', () => {
  const before = fileReads.count
  // A re-pin moves these with VECTOR_FLOOR: "the mod at the pin (vX)", a file's "Line numbers are … at vX" and the ports'
  // "Ported from scripted-screens-vector vX". Mentions of what a version was measured at stay.
  expect(codePinClaims.length).toBeGreaterThanOrEqual(10)
  expect(codePinClaims.filter(s => !s.endsWith(' ' + VECTOR_FLOOR))).toEqual([])
  expect(fileReads.count).toBe(before) // source IO belongs to fixture setup, not the timed assertion
  // No warning names a version since 0.11.96: the mod checks a clip's shape and the header like any node.
  const clip = trapsOf({ header: { w: 10, h: 10 }, root: [], defs: [{ op: 'CP', attrs: { id: 'c' }, c: [{ op: 'R', attrs: { zzz: 1 } }] }] })
  expect(clip.map(t => t.message)).toEqual([expect.stringContaining('the mod reports it')])
})

it('names the pin wherever the docs state the current one', () => {
  // History stays: dated milestone report rows and the spec decision log (§12). Each
  // phrase below states the current pin; its `ver` uses the export's encoding (since 0.11.103).
  const docs = new URL('../../../docs/', import.meta.url), doc = (f: string) => readFileSync(new URL(f, docs), 'utf8')
  const report = doc('m2a.md'), m3 = doc('m3.md')
  const texts: Record<string, string> = { decisions: doc('decisions.md'),
    m2a: report.slice(0, report.indexOf('## ')) + report.slice(report.indexOf('## Keeping in step with the pin')),
    'M3 re-pin': m3.slice(m3.lastIndexOf('## Re-pin to vector')),
    spec: doc('spec.md').split(/\n## 12/)[0] }
  const V = String.raw`v?(\d+\.\d+\.\d+)`, phrases = new RegExp([`the pin is ${V}`, `current pin is \`${V}\``, `current pin is ${V}`, String.raw`currently\s*\`${V}\``, `current pin: \`${V}\``, `M2a pins \`${V}\``, `M2a: \`${V}\``,
    String.raw`pinned at the tag \*\*${V}`, String.raw`\*\*${V}\*\* \(\`[0-9a-f]+\`\) today`, String.raw`\(${V}, \`[0-9a-f]+\`, today\)`,
    `vector \`[0-9a-f]{7}\` ${V}`, `(?:ports|both) at ${V}`, String.raw`scripted-screens-vector \*\*${V}`, `the vector mod at ${V} and`,
    `submodule at ${V}`, `header ${V}`, String.raw`VECTOR_FLOOR[^'\n]{0,40}'${V}'`,
    String.raw`ver == (\d+)`, String.raw`\`ver\` = (\d+)`, String.raw`\((\d+) (?:at|for) \`?${V}`, String.raw`FLOOR = the pin's \`ver\`, (\d+)`].join('|'), 'g')
  const said = Object.entries(texts).flatMap(([name, text]) => [...text.matchAll(phrases)]
    .flatMap(m => m.slice(1).filter(g => g !== undefined).map(g => `${name}: ${m[0]} -> ${g.includes('.') ? g : `ver ${g}`}`)))
  for (const [name, text] of Object.entries(texts))
    expect([...text.matchAll(phrases)].length, `${name} has a current-pin claim`).toBeGreaterThan(0)
  expect(said.length).toBeGreaterThanOrEqual(13)   // the claims these docs make today; a lost match drops below it
  expect(said.filter(s => !s.endsWith(` ${VECTOR_FLOOR}`) && !s.endsWith(` ver ${floorVer(VECTOR_FLOOR)}`))).toEqual([])
})

it('is extracted from the pin the builder exports for', () => {
  expect(x.pin).toBe(VECTOR_FLOOR)
  expect(x.sceneKeys).toContain('z_index')
  expect(x.sceneKeys.filter(k => x.knownKeys.includes(k))).toEqual([])
  expect(KNOWN_KEYS.size).toBe(96)
  for (const k of ['x1', 'y1', 'x2', 'y2']) {
    expect(x.knownKeys).not.toContain(k)
    expect(x.reads.GL).toHaveProperty(k)
  }
  expect(x.reads.YS).toHaveProperty('y2')
  expect(GROUP_PAINT_DEFAULTS.length).toBe(23)
  expect(Object.keys(FUNCTIONS).length).toBe(35)
  expect(FUNCTIONS.since).toBe(1)
  expect(VARIABLES).toEqual(['true', 'false', 'ver', 't', 'sy', 'vh', 'n', 'hover', 'down', 'i', 'i1'])
  expect([...COLOUR_FUNCTIONS]).toEqual(['mix'])   // in Arity, but Invoke has no case for it
  expect(sorted(NODE_OPS)).toEqual(['C', 'G', 'IMG', 'L', 'LS', 'P', 'R', 'RP', 'SC', 'SP', 'T', 'USE', 'Y', 'YS'])
  expect(sorted(DEF_OPS)).toEqual(['CP', 'FONT', 'GC', 'GL', 'GR', 'SYM'])
})

it('joins the two: kinds and defaults from the parser, the rest from the overlay', () => {
  expect(fieldOf('SP', 'close')).toMatchObject({ kind: 'N', type: 'flag', default: 0 })
  expect(fieldOf('G', 's')).toMatchObject({ kind: 'P', type: 'pair', group: 'transform', default: [1, 1] })
  expect(fieldOf('R', 's')).toMatchObject({ kind: 'S', type: 'paint', group: 'stroke' })
  expect(fieldOf('IMG', 'smp')!.default).toBe('smooth')
  expect(fieldOf('T', 'size')).toMatchObject({ kind: 'E', default: 12 })
  expect(fieldOf('G', 'size')).toMatchObject({ kind: 'E', default: 12 })   // a paint default, read where it lands
  expect(fieldOf('RP', 'lod')!.kind).toBe('N')
  expect(fieldOf('img', 'REP')).toMatchObject({ kind: 'S', requires: 'tile' })
  for (const [op, k] of [['SCENE', 'ztext'], ['T', 'kern'], ['IMG', 'mid'], ['R', 'v'], ['G', 'v']]) expect(fieldOf(op, k)!.default, k).toBe(1)
})

it('stroke keys on G and SCENE are met by s_, never by s; on a shape by its s or an enclosing s_', () => {
  for (const op of ['G', 'SCENE']) for (const k of ['sw', 'so', 'cap', 'join', 'ml', 'dash', 'dofs'])
    expect(fieldOf(op, k), `${op} ${k}`).toMatchObject({ requires: 's_', requiresAbove: 's_' })
  expect(fieldOf('R', 'sw')).toMatchObject({ requires: 's', requiresAbove: 's_' })
  expect(fieldOf('L', 'sat')).toMatchObject({ requires: 's', requiresAbove: 's_' })
  expect(fieldOf('G', 'fo')).toMatchObject({ requires: 'f', requiresAbove: 'f' })
  expect(fieldOf('C', 'fo')).toMatchObject({ requires: 'f', requiresAbove: 'f' })
  // fea is read before any fill branch since 0.11.91: the edge of whatever the node draws, a stroke-only L included.
  for (const [op, k] of [['R', 'fea'], ['L', 'fea'], ['LS', 'fea'], ['G', 'fea'], ['SCENE', 'fea'], ['YS', 'fea_edge'], ['G', 'fea_edge']]) {
    expect(fieldOf(op, k)!.requires, `${op} ${k}`).toBeUndefined()
    expect(fieldOf(op, k)!.requiresAbove, `${op} ${k}`).toBeUndefined()
  }
  expect(fieldOf('SC', 'so')).toMatchObject({ requires: 'sov' })
  expect(fieldOf('SC', 'so')!.requiresAbove).toBeUndefined()
  // An SC's sov is met by its own so only: since 0.11.98 the mod reads the scroll offset from the SC's own map, so a so
  // passed down to it, from a G or the SCENE header, is not its offset (until 0.11.97 an SC with sov took it).
  expect(fieldOf('SC', 'sov')).toMatchObject({ requires: 'so' })
  expect(fieldOf('SC', 'sov')!.requiresAbove).toBeUndefined()
  expect(fieldOf('SC', 'sov')!.note).toMatch(/^with its own so only: a so passed down to the SC is not its scroll offset \(0\.11\.98;/)
  expect(fieldOf('IMG', 'bw')!.requiresAbove).toBeUndefined()
  // A label has no fill, stroke or band edge to soften; a text outline needs its width.
  expect(fieldOf('T', 'fea')).toBeUndefined()
  expect(fieldOf('T', 'oc')).toMatchObject({ requires: 'ow', default: '#000000' })
  expect(fieldOf('T', 'oc')!.requiresAbove).toBeUndefined()
  // Every requirement on G or SCENE names the spelling that op reads: s there is the scale pair or not read at all.
  expect(ALL.filter(f => (f.op === 'G' || f.op === 'SCENE') && f.requires === 's')).toEqual([])
})

it('a key the parser tests with HasKey says what its absence means, never the reader fallback', () => {
  // The read a field resolves to: its op's own case, else the methods its op shares.
  const guarded = (f: { op: string; key: string }) =>
    (x.reads[f.op]?.[f.key] ?? x.reads[DEF_OPS.includes(f.op) ? 'DEF' : 'NODE']?.[f.key])?.guarded
  const unsaid = ALL.filter(f => guarded(f) && f.default === undefined && !f.defaultFrom && !f.defaultNote && !f.hidden && f.type !== 'map')
  expect(unsaid.map(f => `${f.op} ${f.key}`)).toEqual([])
  // A default on a guarded key is the overlay's own statement, never the reader's fallback.
  const restated = ALL.filter(f => guarded(f) && f.default !== undefined)
    .filter(f => ROWS.find(r => r.key === f.key && r.ops.includes(f.op))!.default === undefined).map(f => `${f.op} ${f.key}`)
  expect(restated).toEqual([])
  expect(fieldOf('R', 'ry')).toMatchObject({ defaultFrom: 'rx' })
  expect(fieldOf('R', 'ry')!.default).toBeUndefined()
  expect(fieldOf('YS', 'fo2')!.default).toBeUndefined()
  expect(fieldOf('YS', 'fo2')!.defaultNote).toBeDefined()
  expect(fieldOf('IMG', 'tile')!.default).toBeUndefined()
  expect(fieldOf('GL', 'units')).toMatchObject({ defaultNote: 'scene units' })
  expect(fieldOf('GL', 'units')!.default).toBeUndefined()
})

it('the colour filters are G effects, expressions, at their identity', () => {
  const filters = fieldsFor('G').filter(f => x.filterKeys.includes(f.key) && f.group === 'effects')
  expect(sorted(filters.map(f => f.key))).toEqual(sorted(x.filterKeys))
  expect(filters.map(f => [f.key, f.kind, f.default])).toEqual(
    [['bri', 'E', 1], ['con', 'E', 1], ['sat', 'E', 1], ['hue', 'E', 0], ['gray', 'E', 0], ['sep', 'E', 0], ['inv', 'E', 0]])
  // ColourFilter.Apply clamps gray, sep and inv to 0..1 and floors sat at 0; bri, con and hue are open.
  expect(['gray', 'sep', 'inv', 'sat'].map(k => fieldOf('G', k)!.range)).toEqual([[0, 1], [0, 1], [0, 1], [0, 1e9]])
})

it('says what the mod requires of a value where a row cannot hold it', () => {
  // A G's fit is a default for its T and IMG children alike, so it takes either's words and has no default of its own.
  expect(fieldOf('G', 'fit')!.enum).toEqual(expect.arrayContaining([...fieldOf('T', 'fit')!.enum!, ...fieldOf('IMG', 'fit')!.enum!]))
  expect(fieldOf('G', 'fit')!.default).toBeUndefined()
  expect(['w', 'h'].map(k => fieldOf('SCENE', k)!.range)).toEqual([[1, 1e9], [1, 1e9]])   // Mathf.Max(1, w)
  expect(fieldOf('G', 'mask')!.note).toMatch('@')
  expect(fieldOf('G', 'm')!.note).toMatch('six')
  expect(fieldOf('SC', 'id')!.note).toMatch('required')
  expect(fieldOf('R', 'sh')!.note).toMatch('literal')
  for (const [op, k] of [['R', 'fat'], ['L', 'fat'], ['R', 'sat']]) expect(fieldOf(op, k)!.note, `${op} ${k}`).toMatch('@gradient')
  // rep accepts stretch but tiles it as repeat (Tessellator.TileAxis has no case for it).
  expect(fieldOf('IMG', 'rep')).toMatchObject({ alias: { stretch: 'repeat' } })
  expect(fieldOf('IMG', 'rep')!.enum).not.toContain('stretch')
  expect(fieldOf('IMG', 'uv')!.note).toMatch('u1 > u0')
  expect(fieldOf('IMG', 'slice')!.note).toMatch('none negative')
  // Since 0.11.100 the mod reports a fmt that prints the missing text (a brace string.Format cannot read, a format no
  // number takes) and one that prints itself, and only where a number goes through it; one that prints other text with no
  // number it leaves unreported (printf.json, fmt-brace).
  expect(fieldOf('T', 'fmt')!.note).toContain('empty fmt uses the default')
  // A format only a whole number takes prints the number through a long, in a placeholder too since 0.11.101; fl's weight
  // takes bold off the first line since 0.11.98.
  expect(fieldOf('T', 'fmt')!.note).toContain('empty fmt uses the default')
  expect(fieldOf('T', 'fl')!.note).toMatch(/weight=bold or 600 and up bolds the first line, normal or a lighter number takes bold off it since 0\.11\.98, another word is reported/)
  // weight is a word or a number since 0.11.94: read both ways, so neither form is a trap.
  expect(fieldOf('T', 'weight')).toMatchObject({ type: 'string', kind: 'SN', defaultNote: 'regular' })
  expect(fieldOf('G', 'weight')!.kind).toBe('SN')
  expect(fieldOf('T', 'weight')!.note).toMatch('600')
  // Disagreements upstream settled on the code's side at 0.11.94, the reference to follow: an open line or SP fills as if
  // closed; ry only squares a single rx's corners; unit is added to bound or templated text only; nofill hides labels
  // too and noeval stops only the R, SC and IMG boxes. A P casts its shadow without a fill since 0.11.94, so it shares
  // the sh row.
  for (const [op, k] of [['L', 'f'], ['LS', 'f'], ['SP', 'f'], ['SP', 'close']]) expect(fieldOf(op, k)!.note, `${op} ${k}`).toMatch('fills as if closed')
  for (const op of ['R', 'SC', 'IMG']) expect(fieldOf(op, 'ry')!.note, op).toMatch(/single rx, 0 squares the corners.*per-corner rx list.*does nothing/)
  // A per-corner rx list on R, SC and, since 0.11.98, IMG (which drew square corners for one); a C reads one rx.
  for (const op of ['R', 'SC', 'IMG']) expect(fieldOf(op, 'rx')!.note, op).toBe('or [tl, tr, br, bl]')
  expect(fieldOf('C', 'rx')!.note).toBeUndefined()
  for (const op of ['R', 'SC', 'IMG']) expect(fieldOf(op, 'ry')!.note, op).toMatch('per-corner rx list (R, SC, IMG), ry does nothing')
  expect(fieldOf('T', 'unit')!.note).toMatch('bound or templated text only')
  expect(fieldOf('SCENE', 'nofill')!.note).toMatch('every label')
  expect(fieldOf('SCENE', 'noeval')!.note).toMatch('only the boxes of R, SC and IMG')
  expect(fieldOf('P', 'sh')!.note).toBe(fieldOf('R', 'sh')!.note)
  expect(fieldOf('G', 'mask')!.note).toMatch('clip')
  // without its @ the mod reports it (0.11.96, SceneModel.cs:1392-1408); an empty one is silent and means no mask
  expect(fieldOf('G', 'mask')!.note).toMatch(/without it the mod reports it and draws unmasked\); an empty mask is no mask/)
  // and clip, the other way round: the bare id
  for (const op of ['G', 'USE']) expect(fieldOf(op, 'clip')!.note, op).toMatch(/bare id.*mask/)
  // v hides a node at 0.5 or less, not only at 0 (measured at 0.11.94); a C's ry is its rx when absent
  expect(fieldOf('R', 'v')!.note).toMatch('0.5 or less')
  expect(fieldOf('C', 'ry')).toMatchObject({ defaultFrom: 'rx' })
  // No provisional row: the last, an SC's sov, was settled by 0.11.98 (above).
  expect(ALL.filter(f => f.note?.includes('provisional')).map(f => `${f.op} ${f.key}`)).toEqual([])
  expect([fieldOf('C', 'ry')!.note, fieldOf('R', 'f')!.note, fieldOf('R', 'click')!.note]).toEqual([undefined, undefined, undefined])
  // The structural keys, hidden: scene a string, defs, root and c arrays; the data element pairs by scene too.
  expect(['scene', 'defs', 'root'].map(k => fieldOf('SCENE', k)!.type)).toEqual(['string', 'array', 'array'])
  expect(fieldOf('G', 'c')!.type).toBe('array')
  expect(fieldOf('DATA', 'scene')).toMatchObject({ type: 'string', kind: 'TEXT', hidden: true })
})

it('font is free text: any name the Fonts mod knows (spec 5.3)', () => {
  const f = fieldOf('t', 'FONT')!
  expect(f.type).toBe('font')
  expect(f.enum).toBeUndefined()
})

it('pointer keys apply to every shape but YS, and to IMG and T since 0.11.93; a hit region needs an id', () => {
  const POINTER = ['click', 'press', 'xy', 'hoverev', 'drag', 'drop']
  for (const op of ['R', 'C', 'L', 'LS', 'Y', 'SP', 'P', 'IMG', 'T']) for (const k of POINTER)
    expect(fieldOf(op, k), `${op} ${k}`).toMatchObject({ type: 'flag', group: 'pointer', requires: 'id' })
  for (const k of POINTER) {
    expect(fieldOf('YS', k), `YS ${k}`).toBeUndefined()   // a band records no hit area
    expect(fieldOf('T', k)).toMatchObject({ since: '0.11.93' })
    expect(fieldOf('IMG', k)).toMatchObject({ since: '0.11.93', note: expect.stringContaining('not yet seen in game') })
    // a label records its hit only with text and without SCENE nofill; a picture whether or not it has loaded, since
    // 0.11.96, but not without a src (Tessellator.cs:1423, :1435-1436, :1604-1622; the C# suite draws both)
    expect(fieldOf('T', k)!.note).toMatch(/text, as resolved, is not empty and SCENE nofill is off/)
    expect(fieldOf('IMG', k)!.note).toMatch('loaded or not (0.11.96), but only with a src')
  }
})

it('cannot be changed through what it hands out', () => {
  const s = fieldOf('G', 's')!
  expect(Object.isFrozen(s) && Object.isFrozen(s.default) && Object.isFrozen(fieldOf('T', 'align')!.alias)).toBe(true)
  expect(fieldsFor('G')).not.toBe(fieldsFor('G'))
  expect(FUNCTIONS.toString).toBeUndefined()
  expect('constructor' in FUNCTIONS).toBe(false)
})

// Migration checks: the copies the catalogue replaces, as they stood (validate.ts at M1, fromProps.ts).
it('derives the sets the validator and fromProps kept by hand', () => {
  const M1_EXPRESSIONS = ['AT', 'BLUR', 'CH', 'CX', 'CY', 'DOFS', 'FAT', 'FEA', 'FEA_EDGE', 'FO', 'FO2', 'H', 'MIN_SIZE',
    'O', 'OW', 'R', 'RX', 'RY', 'SAT', 'SIZE', 'SO', 'SOV', 'SW', 'V', 'W', 'X', 'Y', 'Y2', 'A', 'OFF', 'T', 'TILE', 'FX', 'FY',
    'X1', 'Y1', 'X2', 'BRI', 'CON', 'HUE', 'GRAY', 'SEP', 'INV']
  expect(sorted(EXPRESSIONS)).toEqual(sorted(M1_EXPRESSIONS))
  expect(sorted(PAINTS)).toEqual(sorted(['F', 'S', 'S_', 'OC']))
  expect(sorted(COLOUR_KEYS)).toEqual(sorted(['F', 'S', 'S_', 'OC', 'STOPS', 'SH']))
  expect(sorted(TEXTS)).toEqual(sorted(['TEXT', 'FMT', 'UNIT', 'MISSING']))
  expect(GROUP_PAINT_DEFAULTS.filter(k => k !== 's_')).toEqual(['f', 'fo', 'fea', 'fea_edge', 'fr', 'sh', 'so', 'sw', 'cap', 'join',
    'ml', 'dash', 'dofs', 'size', 'font', 'weight', 'cspace', 'kern', 'align', 'valign', 'fit', 'min_size'])
  expect(sorted(HEADER)).toEqual(sorted(['W', 'H', 'FIT', 'ZTEXT', 'NOFILL', 'NOFEATHER', 'NOPIXELEDGES', 'NOEVAL']))
})
