import { describe, expect, it } from 'vitest'
import { catalogOf } from '../catalog'
import { instance } from '../widgets/testing'
import { crc32 } from '../catalog/crc32'
import type { DevicesJson, EnumsJson } from '../catalog/parse'
import { newLogic } from '../model/logic'
import { newProject, type Project } from '../model/project'
import { enumsOf, hostOf, simOf, sourceJson } from './hostOf'

const devices: DevicesJson = { sources: [], devices: [
  { name: 'StructureGasSensor', hash: crc32('StructureGasSensor'), origin: 'vanilla', logic: { NameHash: 'R', On: 'RW', PrefabHash: 'R', Pressure: 'R', ReferenceId: 'R' },
    ext: { SolarEfficiency: [1224, 'R'] }, slots: [{ i: 0, logic: ['Occupied', 'Quantity'] }, { i: 255, name: 'Target', type: 'Proxy', logic: [] }] }] }
// The game's numbers (Enums.json at 0.2.6428.27798).
const enums: EnumsJson = { game: '0.2.6428.27798', observed: null,
  LogicType: ([['NameHash', 268], ['On', 28], ['PrefabHash', 84], ['Pressure', 5], ['ReferenceId', 217]] as [string, number][]).map(([name, value]) => ({ name, value })),
  LogicSlotType: [{ name: 'Occupied', value: 1 }, { name: 'Quantity', value: 3 }], LogicBatchMethod: [{ name: 'Average', value: 0 }, { name: 'Sum', value: 1 }] }
const cat = catalogOf(devices, enums)
const project = (): Project => ({ ...newProject(), ...newLogic(), simDevices: [
  { id: 's1', prefab: 'StructureGasSensor', label: 'O2 tank', ref: 2, pin: 0, values: { Pressure: { kind: 'slider', v: 101, min: 0, max: 200 }, '#1224': { kind: 'const', v: 0.5 } },
    slots: { 0: { Quantity: { kind: 'const', v: 3 } } } },
  { id: 's2', prefab: 'ModThing', label: 'Mystery', ref: 3, values: {} }] })

describe('hostOf', () => {
  it('names an unlabelled unknown prefab in notes without its generated device id', () => {
    const p = project(); p.simDevices[1].label = ''; p.simDevices[1].id = 'sim987654'
    expect(hostOf(p, cat, null).notes.join(' ')).toContain('ModThing: prefab ModThing')
    expect(hostOf(p, cat, null).notes.join(' ')).not.toContain('sim987654')
  })
  it('omits icon tables unless some page has an icon native', () => {
    const p = project()
    expect(hostOf(p, null, null).host).not.toHaveProperty('icons')
    p.pages[0].natives = [instance('textinput')]
    expect(hostOf(p, null, null).host).not.toHaveProperty('icons')
    p.pages.push({ ...p.pages[0], id: 'p2', natives: [instance('icon')] })
    expect(hostOf(p, null, null).host.icons?.gas.Oxygen).toBe('gas:Oxygen')
  })
  it('sends the measured icon tables to the preview even without a device catalogue', () => {
    const p = project(); p.pages[0].natives = [instance('icon')]
    const { host } = hostOf(p, null, null)
    expect(host.icons).toMatchObject({ gas: { Oxygen: 'gas:Oxygen', CO2: 'gas:CarbonDioxide' },
      slot: { Chip: 'slot:ProgrammableChip' }, prefab: { ActiveVent: 'prefab:StructureActiveVent' } })
  })
  it('sends the catalogue display name for an unlabelled device (P4, measured 2026-10-11)', () => {
    const p = project()
    p.simDevices[0].label = ''
    expect(hostOf(p, cat, null).host.devices[0].prefabDisplayName).toBe('Gas Sensor')
  })
  it('numbers the enums as the catalogue does', () => {
    expect(enumsOf(cat)).toEqual({ LogicType: { NameHash: 268, On: 28, PrefabHash: 84, Pressure: 5, ReferenceId: 217 },
      LogicSlotType: { Occupied: 1, Quantity: 3 }, LogicBatchMethod: { Average: 0, Sum: 1 } })
    expect(enumsOf(null)).toEqual({})
  })
  it('maps each simulated device: access by number, extension types, slots, sources by number; the housing is ref 1', () => {
    const { host, notes } = hostOf(project(), cat, { persist: { a: '1' }, memory: new Array(512).fill(0) })
    expect(host.devices[0]).toEqual({ ref: 2, prefab: crc32('StructureGasSensor'), prefabName: 'StructureGasSensor', prefabDisplayName: 'Gas Sensor', name: 'O2 tank', pin: 0,
      logic: { 268: 'R', 28: 'RW', 84: 'R', 5: 'R', 217: 'R', 1224: 'R' }, slots: 1, slotLogic: { 1: [0], 3: [0] },
      values: { 5: { kind: 'slider', v: 101, min: 0, max: 200 }, 1224: { kind: 'const', v: 0.5 } }, slotValues: { '0:3': { kind: 'const', v: 3 } } })
    expect(host.housing).toEqual({ ref: 1, prefab: crc32('StructureConsole'), prefabName: 'StructureConsole', name: 'Console',
      logic: { 268: 'R', 84: 'R', 217: 'R' }, slots: 0 })
    expect(host.devices[1].logic).toEqual({ 5: 'RW', 28: 'RW', 84: 'R', 217: 'R', 268: 'R' })
    expect(notes).toEqual(['Mystery: prefab ModThing is not in the catalogue, so every LogicType reads and writes'])
    expect([host.persist, host.memory?.length, host.clock, host.beta, host.budgets]).toEqual([{ a: '1' }, 512, { length: 1200, start: 0.25 }, false, { load: 500000, tick: 50000 }])
  })
  it('leaves the values out for the reload key, and gives them alone for a live change', () => {
    const { host } = hostOf(project(), cat, null, { values: false })
    expect(host.devices[0].values).toBeUndefined()
    expect(host.persist).toBeUndefined()
    expect(simOf(project(), cat)).toEqual({ values: { 2: { 5: { kind: 'slider', v: 101, min: 0, max: 200 }, 1224: { kind: 'const', v: 0.5 }, '0:3': { kind: 'const', v: 3 } }, 3: {} } })
  })
  it('writes every source kind in the shape the core reads', () => {
    expect(sourceJson({ kind: 'keys', keys: [[0, 1], [2, 3]], loop: true })).toEqual({ kind: 'keys', keys: [[0, 1], [2, 3]], loop: true })
    expect(sourceJson({ kind: 'walk', v: 5, step: 1, min: 0, max: 10, seed: 7 })).toEqual({ kind: 'walk', v: 5, step: 1, min: 0, max: 10, seed: 7 })
    expect(sourceJson({ kind: 'ramp', from: 0, to: 1, period: 4, loop: false })).toEqual({ kind: 'ramp', from: 0, to: 1, period: 4, loop: false })
  })
})

describe('host JSON edge cases', () => {
  it('keeps named memory literals across a JSON round trip and omits stores from the reload key', () => {
    const memory: (number | string)[] = new Array(512).fill(0)
    memory.splice(0, 3, 'NaN', 'Infinity', '-Infinity')
    const chip = { persist: { pick: '2' }, memory }
    const { host } = hostOf(project(), cat, chip)
    expect(JSON.parse(JSON.stringify(host)).memory.slice(0, 3)).toEqual(['NaN', 'Infinity', '-Infinity'])
    const reload = hostOf(project(), cat, chip, { values: false }).host
    expect(reload.memory).toBeUndefined()
    expect(reload.persist).toBeUndefined()
    expect(reload.devices[0].slotValues).toBeUndefined()
  })
  it('omits unknown enum names and noninteger extension keys, while numeric extension values work without a catalogue', () => {
    const p = project()
    p.simDevices[0].values.Unknown = { kind: 'const', v: 1 }
    p.simDevices[0].values['#bad'] = { kind: 'const', v: 2 }
    p.simDevices[0].values['#1.5'] = { kind: 'const', v: 3 }
    p.simDevices[0].slots![0].Unknown = { kind: 'const', v: 4 }
    p.simDevices[0].slots![0] = { ...p.simDevices[0].slots![0], toString: { kind: 'const' as const, v: 5 } }
    const { host, notes } = hostOf(p, null, null)
    expect(host.enums).toEqual({})
    expect(host.housing.logic).toEqual({})
    expect(host.devices[0]).toMatchObject({ logic: {}, slots: 0, values: { 1224: { kind: 'const', v: 0.5 } } })
    expect(host.devices[0].slotValues).toBeUndefined()
    expect(host.devices[1].pin).toBeUndefined()
    expect(notes).toEqual([])
    expect(simOf(p, null)).toEqual({ values: { 2: { 1224: { kind: 'const', v: 0.5 } }, 3: {} } })
    expect(simOf(p, cat).values![2]).toEqual({ 5: { kind: 'slider', v: 101, min: 0, max: 200 },
      1224: { kind: 'const', v: 0.5 }, '0:3': { kind: 'const', v: 3 } })
  })
  it('writes const, slider and sine sources in the shape the core reads', () => {
    expect(sourceJson({ kind: 'const', v: 2 })).toEqual({ kind: 'const', v: 2 })
    expect(sourceJson({ kind: 'slider', v: 2, min: 0, max: 4 })).toEqual({ kind: 'slider', v: 2, min: 0, max: 4 })
    expect(sourceJson({ kind: 'sine', mid: 5, amp: 2, period: 4 })).toEqual({ kind: 'sine', mid: 5, amp: 2, period: 4 })
  })
})

it('does not report missing prefabs before the catalogue is available', () => {
  const p = newProject()
  p.simDevices = [{ id: 's', ref: 2, prefab: 'Mystery', label: '', values: {} }]
  expect(hostOf(p, null, null).notes).toEqual([])
})
