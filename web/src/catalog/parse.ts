// The device catalogue's pure half: the game's Stationpedia export (Stationpedia.json and Enums.json, written by
// StationeersStationpediaExtractor; ruling P26) and the owner's ic10-devices.md, its cross-check and the vanilla set (ruling
// P27), in; devices.json and enums.json out. No imports: tools/catalog/build.ts runs it under Node's type stripping, Vitest
// tests it. Every reader asserts its input's shape and throws naming the place: nothing is skipped in silence.
export type Access = 'R' | 'W' | 'RW'
export type CatalogSlot = { i: number; name?: string; type?: string; logic: string[] }
export type CatalogDevice = { name: string; hash: number; title?: string; origin: 'vanilla' | 'newer' | 'mod'; logic: Record<string, Access>
  ext?: Record<string, [number, Access]>; slots?: CatalogSlot[]; modes?: [number, string][] }
export type DevicesJson = { sources: { name: string; game: string }[]; devices: CatalogDevice[] }
export type EnumMember = { name: string; value: number }
/** game: the export's build. observed: when the enum probe read ic.enums on a chip (its numbers then stand), else null. */
export type EnumsJson = { game: string; observed: { game: string; date: string } | null
  LogicType: EnumMember[]; LogicSlotType: EnumMember[]; LogicBatchMethod: EnumMember[] }
export type EnumTable = 'LogicType' | 'LogicSlotType' | 'LogicBatchMethod'
export const TABLES: EnumTable[] = ['LogicType', 'LogicSlotType', 'LogicBatchMethod']
/** A page of the export with logic rows, normalised. */
export type ExportDevice = { name: string; hash: number; title: string; logic: Record<string, Access>; slotTypes: Record<string, number[]>
  slots: { index: number; name: string; type: string }[]; modes: { value: number; name: string }[] }
/** The enum probe's output (tools/catalog/enums-collect.ts): every ic.enums table, name to number. */
export type EnumValues = { game: string; date: string; tables: Record<string, Record<string, number>> }

/** Identity types: read-only on every device (PassiveSpeaker's ReadWrite, in the md and the export alike, is an artefact). */
export const IDENTITY = ['NameHash', 'PrefabHash', 'ReferenceId']
const ACCESS = new Set(['R', 'W', 'RW'])
const READ_ACCESS: Record<string, Access> = { Read: 'R', Write: 'W', 'Read Write': 'RW' }
const ordinal = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const fail = (line: number, why: string): never => { throw new Error(`line ${line}: ${why}`) }
const bad = (why: string): never => { throw new Error(why) }
const sorted = <T>(r: Record<string, T>): Record<string, T> => Object.fromEntries(Object.keys(r).sort(ordinal).map(k => [k, r[k]]))
const obj = (v: unknown): Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {}
const rows = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(obj) : []

/** The markup in the fields read here is a LogicType's or LogicSlotType's link and colour, nothing else (measured); a slot's
 *  untranslated name (`<N:EN:Slot4>`) is no markup and stays as written. */
export const stripTags = (s: string) => s.replace(/<\/?(?:link|color)(?:=[^>]*)?>/g, '')
const plain = (v: unknown) => stripTags(String(v ?? ''))

/** ic10-devices.md: the game version its header names, and every block after `## Devices`. */
export function parseDevicesMd(text: string): { game: string; devices: CatalogDevice[] } {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''))
  const game = /game v(\d+\.\d+\.\d+\.\d+)/.exec(text)?.[1] ?? fail(1, 'no "game v<version>" in the header')
  const start = lines.indexOf('## Devices')
  if (start < 0) fail(1, 'no "## Devices" section')
  const devices: CatalogDevice[] = [], seen = new Set<string>()
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '') continue
    const name = (/^### (\S+)$/.exec(lines[i]) ?? fail(i + 1, `expected "### <PrefabName>", got "${lines[i]}"`))[1]
    if (seen.has(name)) fail(i + 1, `${name} appears twice`)
    seen.add(name)
    const hash = Number((/^`(-?\d+)`$/.exec(lines[++i] ?? '') ?? fail(i + 1, `expected the hash of ${name} in backticks`))[1])
    const pairs = (/^Logic: (.+)$/.exec(lines[++i] ?? '') ?? fail(i + 1, `expected "Logic: ..." for ${name}`))[1]
    const logic: Record<string, Access> = {}
    for (const pair of pairs.split(', ')) {
      const [k, a] = pair.split('=')
      if (!/^\w+$/.test(k) || !ACCESS.has(a)) fail(i + 1, `bad pair "${pair}"`)
      if (Object.hasOwn(logic, k)) fail(i + 1, `${k} twice`)
      logic[k] = a as Access
    }
    const d: CatalogDevice = { name, hash, origin: 'vanilla', logic }
    if (lines[i + 1]?.startsWith('Slots: ')) {
      i++
      const at: string[][] = []
      for (const e of lines[i].slice(7).split('], ')) {
        const s = /^(\w+)\[(\d+(?:, \d+)*)\]?$/.exec(e) ?? fail(i + 1, `bad slot entry "${e}"`)
        for (const n of s[2].split(', ').map(Number)) (at[n] ??= []).push(s[1])
      }
      for (let k = 0; k < at.length; k++) if (!at[k]) fail(i + 1, `${name}: slot ${k} exposes nothing`)
      d.slots = at.map((l, k) => ({ i: k, logic: [...l].sort(ordinal) }))
    }
    devices.push(d)
  }
  return { game, devices }
}

/** Stationpedia.json: its build (`version`) and every page with logic rows, normalised. The rows read are the game's own
 *  Stationpedia rows (LogicInsert, LogicSlotInsert, SlotInserts, ModeInsert), never the extractor's LogicInfo (ruling P26).
 *  A page with no logic row is no device here; two pages with logic rows and one PrefabName stop the build. */
export function readExport(json: unknown): { game: string; devices: ExportDevice[] } {
  const o = obj(json)
  const game = typeof o.version === 'string' && /^\d+(?:\.\d+){3}$/.test(o.version) ? o.version : bad('Stationpedia.json: no "version" of the form a.b.c.d')
  if (!Array.isArray(o.pages)) bad('Stationpedia.json: no "pages" list')
  const devices: ExportDevice[] = [], keyOf = new Map<string, string>()
  for (const p of rows(o.pages)) {
    const logicRows = rows(p.LogicInsert)
    if (!logicRows.length) continue
    const name = typeof p.PrefabName === 'string' && p.PrefabName !== '' ? p.PrefabName : bad(`a page with logic rows has no PrefabName (${String(p.Key)})`)
    if (keyOf.has(name)) bad(`${name}: two pages with logic rows (${keyOf.get(name)}, ${String(p.Key)})`)
    keyOf.set(name, String(p.Key))
    const hash = Number.isInteger(p.PrefabHash) ? p.PrefabHash as number : bad(`${name}: PrefabHash ${String(p.PrefabHash)} is not an integer`)
    const nameOf = (r: Record<string, unknown>) => { const k = plain(r.LogicName); return /^\w+$/.test(k) ? k : bad(`${name}: bad logic name "${k}"`) }
    const indices = (v: unknown) => /^\d+(?:, \d+)*$/.test(String(v)) ? String(v).split(', ').map(Number) : bad(`${name}: bad slot list "${String(v)}"`)
    const int = (v: unknown, what: string) => /^-?\d+$/.test(String(v)) ? Number(v) : bad(`${name}: bad ${what} "${String(v)}"`)
    const logic: Record<string, Access> = {}, slotTypes: Record<string, number[]> = {}
    for (const r of logicRows) {
      const k = nameOf(r), a = READ_ACCESS[String(r.LogicAccessTypes)] ?? bad(`${name}.${k}: unknown access "${String(r.LogicAccessTypes)}"`)
      if (Object.hasOwn(logic, k)) bad(`${name}.${k} twice`)
      logic[k] = a
    }
    for (const r of rows(p.LogicSlotInsert)) {
      const k = nameOf(r)
      if (Object.hasOwn(slotTypes, k)) bad(`${name}: slot type ${k} twice`)
      slotTypes[k] = indices(r.LogicAccessTypes)
    }
    devices.push({ name, hash, title: plain(p.Title), logic, slotTypes,
      slots: rows(p.SlotInserts).map(s => ({ index: int(s.SlotIndex, 'slot index'), name: plain(s.SlotName), type: plain(s.SlotType) })),
      modes: rows(p.ModeInsert).map(m => ({ value: int(m.LogicAccessTypes, 'mode value'), name: plain(m.LogicName) })) })
  }
  return { game, devices }
}

/** Enums.json: the scriptEnums tables the catalogue carries, name to the game's number. */
export function readEnums(json: unknown): Record<EnumTable, Record<string, number>> {
  const s = obj(obj(json).scriptEnums)
  const table = (t: EnumTable) => {
    const out: Record<string, number> = {}, seen = new Map<number, string>()
    for (const [k, v] of Object.entries(obj(obj(s[t]).values))) {
      const n = obj(v).value
      if (!Number.isInteger(n)) bad(`Enums.json: ${t}.${k} has no whole-number value`)
      if (seen.has(n as number)) bad(`Enums.json: ${t}.${k} and ${seen.get(n as number)} are both ${n}`)
      seen.set(n as number, k)
      out[k] = n as number
    }
    return Object.keys(out).length ? out : bad(`Enums.json: no scriptEnums.${t}`)
  }
  return { LogicType: table('LogicType'), LogicSlotType: table('LogicSlotType'), LogicBatchMethod: table('LogicBatchMethod') }
}

const invert = (types: Record<string, number[]>): CatalogSlot[] => {
  const at = new Map<number, string[]>()
  for (const [t, ks] of Object.entries(types)) for (const k of ks) at.set(k, [...at.get(k) ?? [], t])
  return [...at].sort((a, b) => a[0] - b[0]).map(([i, l]) => ({ i, logic: l.sort(ordinal) }))
}

/** One export device as the catalogue holds it: the LogicTypes of the game's enum; one outside it (a mod's) only with the enum
 *  probe's number (`ext`), else counted in `dropped`; the slot types per slot, the named slots (255 too), the modes. */
function catalogDevice(l: ExportDevice, lt: Set<string>, ext: Record<string, number>, origin: CatalogDevice['origin'], dropped: Map<string, number>): CatalogDevice {
  const logic: Record<string, Access> = {}, extra: Record<string, [number, Access]> = {}
  for (const [k, a] of Object.entries(l.logic)) {
    if (lt.has(k)) logic[k] = a
    else if (Object.hasOwn(ext, k)) extra[k] = [ext[k], a]
    else dropped.set(k, (dropped.get(k) ?? 0) + 1)
  }
  const slots = new Map(invert(l.slotTypes).map(s => [s.i, s] as const))
  for (const s of l.slots) slots.set(s.index, { i: s.index, name: s.name, type: s.type, logic: slots.get(s.index)?.logic ?? [] })
  const out: CatalogDevice = { name: l.name, hash: l.hash, ...(l.title ? { title: l.title } : {}), origin, logic: sorted(logic) }
  if (Object.keys(extra).length) out.ext = sorted(extra)
  if (slots.size) out.slots = [...slots.values()].sort((a, b) => a.i - b.i)
  if (l.modes.length) out.modes = l.modes.map(m => [m.value, m.name])
  return out
}

/** The md must be a subset of the export (ruling P27): each md device there with the same hash, each md pair with the same
 *  access, each md slot type at its slot. The export may add; anything else is drift and stops the build, naming both sides. */
function crossCheck(md: CatalogDevice[], byName: Map<string, CatalogDevice>): void {
  for (const d of md) {
    const x = byName.get(d.name) ?? bad(`${d.name}: in the md, not in the export`)
    if (x.hash !== d.hash) bad(`${d.name}: hash ${d.hash} in the md, ${x.hash} in the export`)
    for (const [k, a] of Object.entries(d.logic)) if (x.logic[k] !== a) bad(`${d.name}.${k}: ${a} in the md, ${x.logic[k] ?? 'absent'} in the export`)
    for (const s of d.slots ?? []) for (const t of s.logic)
      if (!x.slots?.find(y => y.i === s.i)?.logic.includes(t)) bad(`${d.name} slot ${s.i}: ${t} in the md, not in the export`)
  }
}

/** The enum probe's numbers (ic.enums on a chip: what a script sees) stand over Enums.json's; each difference, each member
 *  ic.enums lacks, and each name it has beyond Enums.json (outside LogicType, whose extra names buildCatalog numbers), is noted. */
export function applyEnumValues(e: EnumsJson, v: EnumValues): { enums: EnumsJson; notes: string[] } {
  const notes: string[] = [], out: EnumsJson = { ...e, observed: { game: v.game, date: v.date } }
  for (const t of TABLES) {
    const seen = v.tables[t] ?? {}
    out[t] = e[t].map(m => {
      if (!Object.hasOwn(seen, m.name)) { notes.push(`ic.enums.${t} has no ${m.name}; Enums.json's ${m.value} kept`); return m }
      if (seen[m.name] !== m.value) notes.push(`ic.enums.${t}.${m.name} is ${seen[m.name]}, Enums.json ${m.value}: ${seen[m.name]} kept`)
      return { name: m.name, value: seen[m.name] }
    })
    if (t !== 'LogicType') for (const k of Object.keys(seen)) if (!e[t].some(m => m.name === k)) notes.push(`ic.enums.${t}.${k} is not in Enums.json (not carried)`)
  }
  return { enums: out, notes }
}

/** The whole build: the export's devices and enums, the md's cross-check and vanilla set, identity types forced R, the enum
 *  probe's numbers when given, and a summary. `vanilla`: export-only prefabs the owner rules vanilla (tools/catalog/vanilla.txt). */
export function buildCatalog(stationpedia: unknown, enumsJson: unknown, md: string, o: { values?: EnumValues; vanilla?: string[] } = {}):
  { devices: DevicesJson; enums: EnumsJson; summary: string[] } {
  const exp = readExport(stationpedia), tables = readEnums(enumsJson), base = parseDevicesMd(md)
  const lt = new Set(Object.keys(tables.LogicType)), inMd = new Set(base.devices.map(d => d.name)), vanilla = new Set(o.vanilla ?? [])
  for (const d of base.devices) for (const k of Object.keys(d.logic)) if (!lt.has(k)) bad(`${d.name}.${k} (the md) is not in Enums.json's LogicType`)
  // A LogicType outside the game's enum is a mod's: only the enum probe numbers it (question 17); without a number it is dropped.
  const ext = Object.fromEntries(Object.entries(o.values?.tables.LogicType ?? {}).filter(([k]) => !lt.has(k)))
  const dropped = new Map<string, number>()
  let devices = exp.devices.map(l => catalogDevice(l, lt, ext, inMd.has(l.name) ? 'vanilla' : vanilla.has(l.name) ? 'newer' : 'mod', dropped))
    .sort((a, b) => ordinal(a.name, b.name))
  crossCheck(base.devices, new Map(devices.map(d => [d.name, d])))
  const summary = [`export: ${devices.length} devices with logic rows at game ${exp.game}`, `md: ${base.devices.length} devices at game ${base.game}, all in the export`,
    ...[...dropped].sort((a, b) => ordinal(a[0], b[0])).map(([k, n]) => `${k}: not in the LogicType enum and no number for it, dropped from ${n} device${n === 1 ? '' : 's'}`),
    `export only: ${devices.filter(d => d.origin !== 'vanilla').map(d => `${d.name} (${d.origin})`).join(', ') || 'none'}`]
  devices = devices.map(d => {
    let logic = d.logic
    for (const k of IDENTITY) if (logic[k] && logic[k] !== 'R') { summary.push(`override: ${d.name}.${k} ${logic[k]} -> R`); logic = { ...logic, [k]: 'R' } }
    return logic === d.logic ? d : { ...d, logic }
  })
  const pairs = devices.filter(d => d.origin === 'vanilla').flatMap(d => Object.values(d.logic))
  summary.push(`vanilla pairs: ${pairs.length} (${['R', 'RW', 'W'].map(a => `${pairs.filter(x => x === a).length} ${a}`).join(', ')})`)
  const members = (t: Record<string, number>) => Object.keys(t).sort(ordinal).map(name => ({ name, value: t[name] }))
  let enums: EnumsJson = { game: exp.game, observed: null, LogicType: members(tables.LogicType), LogicSlotType: members(tables.LogicSlotType),
    LogicBatchMethod: members(tables.LogicBatchMethod) }
  if (o.values) { const a = applyEnumValues(enums, o.values); enums = a.enums; summary.push(...a.notes) }
  return { devices: { sources: [{ name: 'Stationpedia.json', game: exp.game }, { name: 'ic10-devices.md', game: base.game }], devices }, enums, summary }
}

/** The committed text: one device or member per line, keys in a fixed order, so a refresh diffs by device. */
export const devicesText = (d: DevicesJson) => `{"sources":${JSON.stringify(d.sources)},"devices":[\n`
  + d.devices.map(x => JSON.stringify({ name: x.name, hash: x.hash, title: x.title, origin: x.origin, logic: x.logic, ext: x.ext, slots: x.slots, modes: x.modes })).join(',\n') + '\n]}\n'
export const enumsText = (e: EnumsJson) => `{"game":${JSON.stringify(e.game)},"observed":${JSON.stringify(e.observed)},\n`
  + TABLES.map(t => `"${t}":[\n${e[t].map(m => JSON.stringify(m)).join(',\n')}\n]`).join(',\n') + '}\n'
/** A checkout with core.autocrlf=true holds the committed JSON with CRLF line ends: compare the text, not the line ends. */
export const sameText = (a: string, b: string) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')
