import { describe, expect, it } from 'vitest'
import { crc32, crc32Bytes } from './crc32'
import { applyEnumValues, buildCatalog, parseDevicesMd, readEnums, readExport, stripTags } from './parse'

const MD = ['# Stationeers Device Database (IC10)', '', 'Extracted from the in-game Stationpedia, game v0.2.6403.27689.', '', '## Devices', '',
  '### DynamicGPR', '`-2085885850`', 'Logic: Activate=RW, On=RW, PrefabHash=R, ReferenceId=R', 'Slots: Charge[0], Class[0, 1], Occupied[0, 1]', '',
  '### PassiveSpeaker', '`-1234`', 'Logic: NameHash=RW, PrefabHash=RW, ReferenceId=RW, Volume=RW', '',
  '### StructureTransformerMedium(Reversed)', '`-771036757`', 'Logic: On=RW, PrefabHash=R, ReferenceId=R', ''].join('\n')
// Hand-written in the extractor's shapes (not game output): Stationpedia.json's pages, Enums.json's scriptEnums.
type Row = { LogicName: string; LogicAccessTypes: string }
const lt = (r: [string, string][], colour = 'orange'): Row[] => r.map(([n, a]) => ({ LogicName: `<link=LogicType${n}><color=${colour}>${n}</color></link>`, LogicAccessTypes: a }))
const lst = (r: [string, string][]): Row[] => r.map(([n, at]) => ({ LogicName: `<link=LogicSlotType${n}><color=orange>${n}</color></link>`, LogicAccessTypes: at }))
const page = (PrefabName: string, PrefabHash: number, Title: string, LogicInsert: Row[], more: object = {}) =>
  ({ Key: `Thing${PrefabName}`, Title, PrefabName, PrefabHash, LogicInsert, LogicSlotInsert: [] as Row[], SlotInserts: [] as object[], ModeInsert: [] as object[], ...more })
const EXPORT = () => ({ version: '0.2.6428.27798', pages: [
  page('DynamicGPR', -2085885850, 'Dynamic GPR', [...lt([['Activate', 'Read Write'], ['On', 'Read Write'], ['PrefabHash', 'Read'], ['ReferenceId', 'Read'], ['Volume', 'Read']]),
    ...lt([['SolarEfficiency', 'Read']], '#88ff88')], {
    LogicSlotInsert: lst([['Charge', '0'], ['Class', '0, 1'], ['Occupied', '0, 1']]),
    SlotInserts: [{ SlotName: 'Battery', SlotType: 'Battery', SlotIndex: '0' }, { SlotName: '<N:EN:Slot4>', SlotType: '<N:EN:Slot4>', SlotIndex: '1' },
      { SlotName: 'Target Slot', SlotType: 'Proxy', SlotIndex: '255' }],
    ModeInsert: [{ LogicName: 'Off', LogicAccessTypes: '0' }], LogicInfo: { LogicTypes: { Activate: 'Write' }, LogicSlotTypes: {} } }),
  page('PassiveSpeaker', -1234, 'Passive Speaker', lt([['NameHash', 'Read Write'], ['PrefabHash', 'Read Write'], ['ReferenceId', 'Read Write'], ['Volume', 'Read Write']])),
  page('StructureConsole3x3', 1, 'Console', lt([['On', 'Read Write']]), { LogicSlotInsert: lst([['Occupied', '0']]) }),
  page('StructureTransformerMedium(Reversed)', -771036757, 'Transformer Medium (Reversed)', lt([['On', 'Read Write'], ['PrefabHash', 'Read'], ['ReferenceId', 'Read']])),
  page('ItemIronOre', 2, 'Iron Ore', []),
] })
const table = (names: string[]) => ({ enumName: '', values: Object.fromEntries(names.map((n, i) => [n, { value: i, deprecated: false, description: '' }])) })
const ENUMS = () => ({ scriptEnums: { LogicType: table(['None', 'Activate', 'NameHash', 'On', 'PrefabHash', 'ReferenceId', 'Volume']),
  LogicSlotType: table(['None', 'Charge', 'Class', 'Occupied']), LogicReagentMode: table(['Contents']),
  LogicBatchMethod: table(['Average', 'Sum', 'Minimum', 'Maximum', 'Count']) } })
type Bend = (pages: ReturnType<typeof EXPORT>['pages']) => void
const bent = (f: Bend) => { const e = EXPORT(); f(e.pages); return e }
const set = (o: object, k: string, v: unknown) => { (o as Record<string, unknown>)[k] = v }

describe('crc32', () => {
  it('is the signed CRC-32/IEEE of the UTF-8 bytes, as the game hashes prefab names', () => {
    expect(crc32('StructureGasSensor')).toBe(-1252983604)
    expect(crc32('StructureTransformerMedium(Reversed)')).toBe(-771036757)
    expect(crc32('Température')).toBe(-477763842)
    expect(crc32('')).toBe(0)
  })
  it('reads bytes as the unsigned CRC-32/IEEE a zip entry records (the standard check values)', () => {
    const text = (s: string) => new TextEncoder().encode(s)
    expect(crc32Bytes(text('123456789'))).toBe(0xcbf43926)
    expect(crc32Bytes(text('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
    expect(crc32Bytes(Uint8Array.from({ length: 256 }, (_, i) => i))).toBe(0x29058c73)
    expect(crc32Bytes(new Uint8Array())).toBe(0)
    expect(crc32Bytes(text('StructureGasSensor')) | 0).toBe(crc32('StructureGasSensor'))
  })
})

describe('parseDevicesMd (the cross-check, ruling P27)', () => {
  it('reads the game version and every block; slot lists are inverted into per-slot types, sorted', () => {
    const { game, devices } = parseDevicesMd(MD)
    expect(game).toBe('0.2.6403.27689')
    expect(devices.map(d => d.name)).toEqual(['DynamicGPR', 'PassiveSpeaker', 'StructureTransformerMedium(Reversed)'])
    expect(devices[0]).toEqual({ name: 'DynamicGPR', hash: -2085885850, origin: 'vanilla',
      logic: { Activate: 'RW', On: 'RW', PrefabHash: 'R', ReferenceId: 'R' },
      slots: [{ i: 0, logic: ['Charge', 'Class', 'Occupied'] }, { i: 1, logic: ['Class', 'Occupied'] }] })
    expect(devices[2].slots).toBeUndefined()
  })
  it('throws with the line number on anything outside the grammar', () => {
    expect(() => parseDevicesMd(MD.replace('Logic: On=RW, PrefabHash', 'Logic: On=X, PrefabHash'))).toThrow('line 18: bad pair "On=X"')
    expect(() => parseDevicesMd(MD.replace('`-771036757`', '-771036757'))).toThrow('line 17: expected the hash')
    expect(() => parseDevicesMd(MD.replace('Class[0, 1], Occupied[0, 1]', 'Class[0, 2], Occupied[0, 2]'))).toThrow('DynamicGPR: slot 1 exposes nothing')
    expect(() => parseDevicesMd(MD.replace('On=RW, PrefabHash=R, ReferenceId', 'On=RW, On=R, ReferenceId'))).toThrow('On twice')
    expect(() => parseDevicesMd(MD + 'stray text\n')).toThrow('expected "### <PrefabName>"')
  })
})

describe('readExport (ruling P26)', () => {
  it('reads the build and each page with logic rows: the game\'s rows, never LogicInfo; slot types; named slots; modes', () => {
    const { game, devices } = readExport(EXPORT())
    expect(game).toBe('0.2.6428.27798')
    expect(devices.map(d => d.name)).toEqual(['DynamicGPR', 'PassiveSpeaker', 'StructureConsole3x3', 'StructureTransformerMedium(Reversed)'])
    expect(devices[0]).toEqual({ name: 'DynamicGPR', hash: -2085885850, title: 'Dynamic GPR',
      logic: { Activate: 'RW', On: 'RW', PrefabHash: 'R', ReferenceId: 'R', Volume: 'R', SolarEfficiency: 'R' },
      slotTypes: { Charge: [0], Class: [0, 1], Occupied: [0, 1] },
      slots: [{ index: 0, name: 'Battery', type: 'Battery' }, { index: 1, name: '<N:EN:Slot4>', type: '<N:EN:Slot4>' }, { index: 255, name: 'Target Slot', type: 'Proxy' }],
      modes: [{ value: 0, name: 'Off' }] })
  })
  it('throws naming the page on anything outside the shape', () => {
    expect(() => readExport({ pages: [] })).toThrow('Stationpedia.json: no "version" of the form a.b.c.d')
    expect(() => readExport(bent(p => { p[0].LogicInsert[0].LogicAccessTypes = 'Sometimes' }))).toThrow('DynamicGPR.Activate: unknown access "Sometimes"')
    expect(() => readExport(bent(p => { p[0].LogicSlotInsert[1].LogicAccessTypes = '0,1' }))).toThrow('DynamicGPR: bad slot list "0,1"')
    expect(() => readExport(bent(p => { p[0].LogicInsert.push(p[0].LogicInsert[0]) }))).toThrow('DynamicGPR.Activate twice')
    expect(() => readExport(bent(p => { set(p[0], 'PrefabHash', '5') }))).toThrow('DynamicGPR: PrefabHash 5 is not an integer')
    expect(() => readExport(bent(p => { p.push({ ...p[0], Key: 'ThingDynamicGPR2' }) }))).toThrow('DynamicGPR: two pages with logic rows (ThingDynamicGPR, ThingDynamicGPR2)')
  })
  it('strips a link\'s and a colour\'s markup, nothing else', () =>
    expect(stripTags('<link=LogicTypeOn><color=#88ff88>On</color></link> <N:EN:Slot4>')).toBe('On <N:EN:Slot4>'))
})

describe('readEnums', () => {
  it('reads the three tables the catalogue carries, name to number; a missing table, a value that is no whole number or a number twice throws', () => {
    expect(readEnums(ENUMS()).LogicBatchMethod).toEqual({ Average: 0, Sum: 1, Minimum: 2, Maximum: 3, Count: 4 })
    const gone = ENUMS()
    set(gone.scriptEnums, 'LogicSlotType', undefined)
    expect(() => readEnums(gone)).toThrow('Enums.json: no scriptEnums.LogicSlotType')
    const odd = ENUMS()
    set(odd.scriptEnums.LogicType.values, 'On', { value: 'x' })
    expect(() => readEnums(odd)).toThrow('Enums.json: LogicType.On has no whole-number value')
    const twice = ENUMS()
    set(twice.scriptEnums.LogicType.values, 'Volume', { value: 3 })
    expect(() => readEnums(twice)).toThrow('Enums.json: LogicType.Volume and On are both 3')
  })
})

describe('buildCatalog', () => {
  const build = (o: Parameters<typeof buildCatalog>[3] = {}, md = MD, exp: object = EXPORT()) => buildCatalog(exp, ENUMS(), md, o)
  it('builds from the export: the md\'s devices vanilla, vanilla.txt\'s newer, the rest mod; a mod\'s LogicType only with a probe number', () => {
    const { devices, summary } = build()
    expect(devices.devices.find(d => d.name === 'DynamicGPR')).toEqual({ name: 'DynamicGPR', hash: -2085885850, title: 'Dynamic GPR', origin: 'vanilla',
      logic: { Activate: 'RW', On: 'RW', PrefabHash: 'R', ReferenceId: 'R', Volume: 'R' },
      slots: [{ i: 0, name: 'Battery', type: 'Battery', logic: ['Charge', 'Class', 'Occupied'] }, { i: 1, name: '<N:EN:Slot4>', type: '<N:EN:Slot4>', logic: ['Class', 'Occupied'] },
        { i: 255, name: 'Target Slot', type: 'Proxy', logic: [] }], modes: [[0, 'Off']] })
    expect(devices.devices.map(d => [d.name, d.origin])).toEqual([['DynamicGPR', 'vanilla'], ['PassiveSpeaker', 'vanilla'], ['StructureConsole3x3', 'mod'],
      ['StructureTransformerMedium(Reversed)', 'vanilla']])
    expect(build({ vanilla: ['StructureConsole3x3'] }).devices.devices.find(d => d.name === 'StructureConsole3x3')).toMatchObject({ origin: 'newer', slots: [{ i: 0, logic: ['Occupied'] }] })
    expect(summary).toContain('SolarEfficiency: not in the LogicType enum and no number for it, dropped from 1 device')
    expect(build({ values: { game: '0.2.6428.27798', date: '2026-10-07', tables: { LogicType: { SolarEfficiency: 1224 } } } }).devices.devices[0].ext)
      .toEqual({ SolarEfficiency: [1224, 'R'] })
    expect(devices.sources).toEqual([{ name: 'Stationpedia.json', game: '0.2.6428.27798' }, { name: 'ic10-devices.md', game: '0.2.6403.27689' }])
  })
  it('stops on drift: an md device, hash, pair, access or slot type the export does not hold as the md does (ruling P27)', () => {
    expect(() => build({}, MD, bent(p => { p.splice(1, 1) }))).toThrow('PassiveSpeaker: in the md, not in the export')
    expect(() => build({}, MD, bent(p => { p[0].PrefabHash = 5 }))).toThrow('DynamicGPR: hash -2085885850 in the md, 5 in the export')
    expect(() => build({}, MD, bent(p => { p[0].LogicInsert[1].LogicAccessTypes = 'Read' }))).toThrow('DynamicGPR.On: RW in the md, R in the export')
    expect(() => build({}, MD, bent(p => { p[0].LogicInsert.splice(0, 1) }))).toThrow('DynamicGPR.Activate: RW in the md, absent in the export')
    expect(() => build({}, MD, bent(p => { p[0].LogicSlotInsert[1].LogicAccessTypes = '0' }))).toThrow('DynamicGPR slot 1: Class in the md, not in the export')
  })
  it('forces identity types read-only and says so; refuses an md type outside the enum', () => {
    const { devices, summary } = build()
    expect(devices.devices.find(d => d.name === 'PassiveSpeaker')!.logic).toEqual({ NameHash: 'R', PrefabHash: 'R', ReferenceId: 'R', Volume: 'RW' })
    expect(summary).toContain('override: PassiveSpeaker.NameHash RW -> R')
    expect(() => build({}, MD.replace('Volume=RW', 'Loudness=RW'))).toThrow('PassiveSpeaker.Loudness (the md) is not in Enums.json\'s LogicType')
  })
  it('numbers the enums from Enums.json, by name; the enum probe\'s numbers stand, each difference noted', () => {
    const { enums } = build()
    expect([enums.game, enums.observed]).toEqual(['0.2.6428.27798', null])
    expect(enums.LogicType.slice(0, 2)).toEqual([{ name: 'Activate', value: 1 }, { name: 'NameHash', value: 2 }])
    expect(enums.LogicBatchMethod).toEqual([{ name: 'Average', value: 0 }, { name: 'Count', value: 4 }, { name: 'Maximum', value: 3 }, { name: 'Minimum', value: 2 },
      { name: 'Sum', value: 1 }])
    const all = (t: 'LogicType' | 'LogicSlotType') => Object.fromEntries(enums[t].map(m => [m.name, m.value]))
    const probed = applyEnumValues(enums, { game: '0.2.6428.27798', date: '2026-10-07',
      tables: { LogicType: all('LogicType'), LogicSlotType: all('LogicSlotType'), LogicBatchMethod: { Sum: 0, Average: 1, Minimum: 2, Maximum: 3, Count: 4, Median: 5 } } })
    expect(probed.enums.observed).toEqual({ game: '0.2.6428.27798', date: '2026-10-07' })
    expect(probed.enums.LogicBatchMethod.find(m => m.name === 'Sum')!.value).toBe(0)
    expect(probed.notes).toEqual(['ic.enums.LogicBatchMethod.Average is 1, Enums.json 0: 1 kept', 'ic.enums.LogicBatchMethod.Sum is 0, Enums.json 1: 0 kept',
      'ic.enums.LogicBatchMethod.Median is not in Enums.json (not carried)'])
  })
})
