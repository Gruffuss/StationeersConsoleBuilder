import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { crc32 } from './crc32'
import { catalogOf, loadCatalog, pulseTypes, readableTypes, slotTypesAt, titleOf, writableTypes } from './index'
import { buildCatalog, devicesText, enumsText, sameText, TABLES, type DevicesJson, type EnumsJson } from './parse'
import { defaultSource } from './defaults'

// Read as text, as index.ts does (?raw): a typed import of a JSON file this size makes tsc infer its whole literal type.
const json = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'))
const d = json('./devices.json') as DevicesJson, e = json('./enums.json') as EnumsJson, cat = catalogOf(d, e)
const vanilla = d.devices.filter(x => x.origin === 'vanilla')

describe('the committed catalogue', () => {
  it('holds the md\'s 407 vanilla devices with at least its 7,189 pairs (6,105 R, 1,025 RW, 59 W, identity types forced R), and the export\'s devices', () => {
    expect(vanilla).toHaveLength(407)
    const pairs = vanilla.flatMap(x => Object.values(x.logic))
    const counts = [pairs.length, pairs.filter(a => a === 'R').length, pairs.filter(a => a === 'RW').length, pairs.filter(a => a === 'W').length]
    // The build keeps every md pair at its access or stops (ruling P27), so these never fall; build 0.2.6428.27798 gives 7,208
    // (6,123 R, 1,026 RW, 59 W), and a later export may add. The regeneration test below pins the exact file.
    counts.forEach((n, k) => expect(n).toBeGreaterThanOrEqual([7189, 6105, 1025, 59][k]))
    expect(d.devices.length).toBeGreaterThanOrEqual(576)   // every page with logic rows at 0.2.6428.27798; a later export may add
    expect(d.sources.map(s => s.name)).toEqual(['Stationpedia.json', 'ic10-devices.md'])
    expect(e.game).toBe(d.sources[0].game)
  })
  it('states hashes that are the CRC-32 of the names, logic keys from the enum, contiguous slots, ordinal order, one whole number per enum member', () => {
    expect(d.devices.filter(x => x.hash !== crc32(x.name)).map(x => x.name)).toEqual([])
    const lt = new Set(e.LogicType.map(m => m.name))
    expect(d.devices.flatMap(x => Object.keys(x.logic).filter(k => !lt.has(k)).map(k => `${x.name}.${k}`))).toEqual([])
    for (const x of d.devices) {
      const real = (x.slots ?? []).filter(s => s.i !== 255)
      expect(real.map(s => s.i)).toEqual(real.map((_, k) => k))
    }
    const names = d.devices.map(x => x.name)
    expect(names).toEqual([...names].sort((a, b) => a < b ? -1 : a > b ? 1 : 0))
    // 358 and 33 at 0.2.6428.27798 (the same names ic10-instructions.md lists); a later game may add.
    expect(e.LogicType.length).toBeGreaterThanOrEqual(358)
    expect(e.LogicSlotType.length).toBeGreaterThanOrEqual(33)
    for (const t of TABLES) {
      expect(e[t].filter(m => !Number.isInteger(m.value)).map(m => m.name)).toEqual([])
      expect(new Set(e[t].map(m => m.value)).size).toBe(e[t].length)
    }
  })
  it('answers what a prefab set reads, writes and pulses, and names prefabs it does not know', () => {
    expect(readableTypes(cat, ['StructureGasSensor']).types).toContain('Pressure')
    expect(writableTypes(cat, ['StructureGasSensor']).types).not.toContain('Pressure')
    const both = readableTypes(cat, ['StructureGasSensor', 'StructureVolumePump'])
    expect(both.types).toContain('PrefabHash')
    expect(both.types).not.toContain('Pressure')
    expect(readableTypes(cat, ['NoSuchThing']).missing).toEqual(['NoSuchThing'])
    expect(readableTypes(cat, []).types).toHaveLength(e.LogicType.length)
    expect(pulseTypes(cat, ['ItemInjectorEpi']).types).toEqual(['Activate'])
    // A read-write type is no pulse: the Arc Furnace's Activate is RW (the injector's W), its ClearMemory W.
    expect(pulseTypes(cat, ['StructureArcFurnace']).types).toEqual(['ClearMemory'])
    expect(pulseTypes(cat, ['ItemInjectorEpi', 'StructureArcFurnace']).types).toEqual([])
    expect(titleOf({ name: 'StructureGasSensor', hash: 0, origin: 'vanilla', logic: {} })).toBe('Gas Sensor')
    expect(titleOf(cat.byName.get('StructureVolumePump')!)).toBe('Volume Pump')
  })
  it('knows no type write-only with no known prefab (any device), so no rule becomes a pulse rule by default (ruling P6)', () => {
    expect(pulseTypes(cat, [])).toEqual({ types: [], missing: [] })
    expect(pulseTypes(cat, ['NoSuchThing'])).toEqual({ types: [], missing: ['NoSuchThing'] })
    expect(writableTypes(cat, []).types).toHaveLength(e.LogicType.length)
    expect(writableTypes(cat, ['NoSuchThing']).types).toHaveLength(e.LogicType.length)
  })
  it('numbers the batch methods as Enums.json does (the game\'s, as IC10 numbers them), not as the StationeersLua doc does', () =>
    // If the enum probe's numbers ever stand here and differ (ruling P28), this line changes with them.
    expect(Object.fromEntries(e.LogicBatchMethod.map(m => [m.name, m.value]))).toEqual({ Average: 0, Sum: 1, Minimum: 2, Maximum: 3, Count: 4 }))
  it('starts a simulated value by its family', () => {
    expect(defaultSource('PressureInternal')).toEqual({ kind: 'slider', v: 101.3, min: 0, max: 200 })
    expect(defaultSource('On')).toEqual({ kind: 'const', v: 0 })
  })
})

describe('loadCatalog', () => {
  it('loads devices.json and enums.json into their fields, once', async () => {
    const c = await loadCatalog()
    expect(c.devices).toEqual(d.devices)
    expect(c.enums).toEqual(e)
    expect([c.lt, c.lst]).toEqual([e.LogicType.map(m => m.name), e.LogicSlotType.map(m => m.name)])
    expect(c.byName.get('StructureGasSensor')).toEqual(d.devices.find(x => x.name === 'StructureGasSensor'))
    expect(await loadCatalog()).toBe(c)
  })
  it('tries again after a failed load: a chunk that did not arrive is not cached', async () => {
    vi.resetModules()
    vi.doMock('./devices.json?raw', () => ({ default: '\n' + JSON.stringify(d) }))
    const fresh = (await import('./index')).loadCatalog
    const spy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => { throw new SyntaxError('a chunk cut short') })
    try {
      await expect(fresh()).rejects.toThrow('a chunk cut short')
      expect((await fresh()).devices).toHaveLength(d.devices.length)
    } finally { spy.mockRestore(); vi.doUnmock('./devices.json?raw') }
  })
})

describe('queries over a hand-made catalogue', () => {
  const m = (names: string[]) => names.map((name, value) => ({ name, value }))
  const hand = catalogOf({ sources: [], devices: [
    { name: 'A', hash: 1, origin: 'mod', logic: { Activate: 'W', On: 'RW', Pressure: 'R' }, ext: { Gain: [1301, 'RW'], Boost: [1300, 'W'], Solar: [1224, 'R'] },
      slots: [{ i: 0, logic: ['Charge', 'Class', 'Occupied'] }, { i: 1, logic: ['Class', 'Occupied'] }] },
    { name: 'B', hash: 2, origin: 'mod', logic: { On: 'RW' }, slots: [{ i: 0, logic: ['Quantity', 'Occupied', 'Class'] }] },
  ] }, { game: '0', observed: null, LogicType: m(['Activate', 'On', 'Pressure']), LogicSlotType: m(['Charge', 'Class', 'Occupied', 'Quantity']), LogicBatchMethod: [] })
  it('gives an extension type (a mod\'s LogicType the enum probe numbered) as #<id>, by its own access', () => {
    expect(readableTypes(hand, ['A']).types).toEqual(['#1224', '#1301', 'On', 'Pressure'])
    expect(writableTypes(hand, ['A']).types).toEqual(['#1300', '#1301', 'Activate', 'On'])
    expect(pulseTypes(hand, ['A']).types).toEqual(['#1300', 'Activate'])
    expect(writableTypes(hand, ['A', 'B']).types).toEqual(['On'])
  })
  it('answers the slot types every known prefab exposes at a slot, sorted; an unknown prefab narrows nothing; none known: every slot type', () => {
    expect(slotTypesAt(hand, ['A'], 0)).toEqual(['Charge', 'Class', 'Occupied'])
    expect(slotTypesAt(hand, ['B'], 0)).toEqual(['Class', 'Occupied', 'Quantity'])
    expect(slotTypesAt(hand, ['B', 'A'], 0)).toEqual(['Class', 'Occupied'])
    expect(slotTypesAt(hand, ['A', 'B'], 1)).toEqual([])
    expect(slotTypesAt(hand, ['A', 'Nope'], 1)).toEqual(['Class', 'Occupied'])
    expect(slotTypesAt(hand, [], 0)).toEqual(['Charge', 'Class', 'Occupied', 'Quantity'])
    expect(slotTypesAt(hand, ['Nope'], 0)).toEqual(['Charge', 'Class', 'Occupied', 'Quantity'])
  })
})

describe('tools/catalog/build.ts', () => {
  it('names each input that is not there and exits 2, with no stack trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vb-catalog-')), mdPath = join(dir, 'ic10-devices.md')
    try {
      const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../../tools/catalog/build.ts', import.meta.url)), '--export', dir, '--md', mdPath],
        { encoding: 'utf8' })
      expect(r.status).toBe(2)
      for (const f of [join(dir, 'Stationpedia.json'), join(dir, 'Enums.json'), mdPath]) expect(r.stderr).toContain(`no such file: ${f}`)
      expect(r.stderr).not.toMatch(/^\s+at /m)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 60_000)   // a Node start: about 0.6 s alone, longer beside the other files running in parallel
})

// The inputs are not in the repo (ruling P2). VB_CATALOG_SRC: the extractor's output folder (Stationpedia.json, Enums.json);
// VB_CATALOG_MD: ic10-devices.md; VB_CATALOG_VALUES: the enum probe's enum-values.json, needed once enums.json used one.
const src = process.env.VB_CATALOG_SRC, md = process.env.VB_CATALOG_MD, values = process.env.VB_CATALOG_VALUES
describe('regeneration', () => {
  it.skipIf(!src || !md)('regenerates the committed JSON (skipped: set VB_CATALOG_SRC to the extractor\'s output folder and VB_CATALOG_MD to ic10-devices.md)', () => {
    if (e.observed) expect(values, 'enums.json used the enum probe: set VB_CATALOG_VALUES to its enum-values.json').toBeTruthy()
    const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'))
    const vanillaList = readFileSync(new URL('../../../tools/catalog/vanilla.txt', import.meta.url), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    const out = buildCatalog(read(join(src!, 'Stationpedia.json')), read(join(src!, 'Enums.json')), readFileSync(md!, 'utf8'),
      { values: values ? read(values) : undefined, vanilla: vanillaList })
    expect(sameText(devicesText(out.devices), readFileSync(new URL('./devices.json', import.meta.url), 'utf8'))).toBe(true)
    expect(sameText(enumsText(out.enums), readFileSync(new URL('./enums.json', import.meta.url), 'utf8'))).toBe(true)
  })
})
