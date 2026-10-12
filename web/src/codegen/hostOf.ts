// What the preview's chip holds besides its Lua (spec §7): the enum numbers, the simulated devices and the housing,
// the chip's persist and memory, the day clock, the beta toggle and the budgets, in the shapes core/Core/HostConfig.cs reads.
// The core holds no catalogue: everything it knows about a device comes from here.
import { icons, titleOf, type Access, type Catalog } from '../catalog'
import { crc32 } from '../catalog/crc32'
import { IDENTITY } from '../catalog/parse'
import type { SimDevice, SimSource } from '../model/logic'
import type { Project } from '../model/project'

export type SourceJson = { kind: string; v?: number; min?: number; max?: number; mid?: number; amp?: number; period?: number; from?: number
  to?: number; loop?: boolean; step?: number; seed?: number; keys?: number[][] }
export type DeviceJson = { ref: number; prefab: number; prefabName: string; name: string; pin?: number; logic: Record<string, Access>; slots: number
  slotLogic?: Record<string, number[]>; values?: Record<string, SourceJson>; slotValues?: Record<string, SourceJson>; prefabDisplayName?: string }
// Memory words may be the named literals "NaN", "Infinity", "-Infinity" (ruling P20: HostContext reads them).
export type HostJson = { enums: Record<string, Record<string, number>>; icons?: Record<string, Record<string, string>>; devices: DeviceJson[]; housing: DeviceJson; persist?: Record<string, string>
  memory?: (number | string)[]; clock: { length: number; start: number }; beta: boolean; budgets: { load: number; tick: number } }
export type SimJson = { values?: Record<string, Record<string, SourceJson>>; wipePersist?: boolean; clearWrites?: boolean }
export const HOUSING = 'StructureConsole'

/** The enum tables by name, as the catalogue numbers them (the game's Enums.json, or ic.enums where the enum probe ran). */
export function enumsOf(cat: Catalog | null): Record<string, Record<string, number>> {
  if (!cat) return {}
  const table = (ms: { name: string; value: number }[]) => Object.fromEntries(ms.map(m => [m.name, m.value]))
  return { LogicType: table(cat.enums.LogicType), LogicSlotType: table(cat.enums.LogicSlotType), LogicBatchMethod: table(cat.enums.LogicBatchMethod) }
}

export function sourceJson(s: SimSource): SourceJson {
  switch (s.kind) {
    case 'const': return { kind: 'const', v: s.v }
    case 'slider': return { kind: 'slider', v: s.v, min: s.min, max: s.max }
    case 'sine': return { kind: 'sine', mid: s.mid, amp: s.amp, period: s.period }
    case 'ramp': return { kind: 'ramp', from: s.from, to: s.to, period: s.period, loop: s.loop }
    case 'walk': return { kind: 'walk', v: s.v, step: s.step, min: s.min, max: s.max, seed: s.seed }
    case 'keys': return { kind: 'keys', keys: s.keys.map(([t, v]) => [t, v]), loop: s.loop }
  }
}

const typeNumber = (lt: Record<string, number>, key: string) => key.startsWith('#') ? Number(key.slice(1)) : lt[key]

/** A simulated device's values by number: LogicTypes as "<lt>", slot types as "<slot>:<lst>". */
function valuesOf(d: SimDevice, enums: Record<string, Record<string, number>>) {
  const lt = enums.LogicType ?? {}, lst = enums.LogicSlotType ?? {}
  const values: Record<string, SourceJson> = {}, slotValues: Record<string, SourceJson> = {}
  for (const [k, s] of Object.entries(d.values)) { const n = typeNumber(lt, k); if (Number.isInteger(n)) values[n] = sourceJson(s) }
  for (const [slot, types] of Object.entries(d.slots ?? {}))
    for (const [k, s] of Object.entries(types)) if (Object.hasOwn(lst, k)) slotValues[`${slot}:${lst[k]}`] = sourceJson(s)
  return { values, slotValues }
}

function deviceJson(d: SimDevice, cat: Catalog | null, enums: Record<string, Record<string, number>>, notes: string[], values: boolean): DeviceJson {
  const lt = enums.LogicType ?? {}, lst = enums.LogicSlotType ?? {}, c = cat?.byName.get(d.prefab)
  const logic: Record<string, Access> = {}, slotLogic: Record<string, number[]> = {}
  let slots = 0
  if (c) {
    for (const [k, a] of Object.entries(c.logic)) if (lt[k] !== undefined) logic[lt[k]] = a
    for (const [id, a] of Object.values(c.ext ?? {})) logic[id] = a
    for (const s of c.slots ?? []) {
      if (s.i !== 255) slots = Math.max(slots, s.i + 1)
      for (const t of s.logic) if (lst[t] !== undefined) (slotLogic[lst[t]] ??= []).push(s.i)
    }
  } else {
    if (cat) notes.push(`${d.label || d.prefab || 'Device'}: prefab ${d.prefab} is not in the catalogue, so every LogicType reads and writes`)
    for (const [k, n] of Object.entries(lt)) logic[n] = IDENTITY.includes(k) ? 'R' : 'RW'
  }
  const out: DeviceJson = { ref: d.ref, prefab: crc32(d.prefab), prefabName: d.prefab, name: d.label, ...(d.pin !== undefined && { pin: d.pin }), logic, slots,
    ...(c && { prefabDisplayName: titleOf(c) }),
    ...(Object.keys(slotLogic).length && { slotLogic }) }
  if (!values) return out
  const v = valuesOf(d, enums)
  return { ...out, ...(Object.keys(v.values).length && { values: v.values }), ...(Object.keys(v.slotValues).length && { slotValues: v.slotValues }) }
}

export function hostOf(p: Project, cat: Catalog | null, chip: { persist: Record<string, string>; memory: (number | string)[] } | null, o: { values?: boolean } = {}):
  { host: HostJson; notes: string[] } {
  const enums = enumsOf(cat), notes: string[] = [], lt = enums.LogicType ?? {}, values = o.values !== false
  const housing: DeviceJson = { ref: 1, prefab: crc32(HOUSING), prefabName: HOUSING, name: 'Console',
    logic: Object.fromEntries(IDENTITY.filter(k => lt[k] !== undefined).map(k => [lt[k], 'R' as const])), slots: 0 }
  const host: HostJson = { enums, ...(p.pages.some(pg => pg.natives?.some(n => n.type === 'icon')) && { icons }), devices: p.simDevices.map(d => deviceJson(d, cat, enums, notes, values)), housing,
    ...(values && chip && { persist: chip.persist, memory: chip.memory }), clock: p.settings.day, beta: p.settings.beta, budgets: p.settings.budgets }
  return { host, notes }
}

/** Every simulated value, keyed as the host keys them, for a live change with no reload. */
export function simOf(p: Project, cat: Catalog | null): SimJson {
  const enums = enumsOf(cat)
  return { values: Object.fromEntries(p.simDevices.map(d => { const v = valuesOf(d, enums); return [String(d.ref), { ...v.values, ...v.slotValues }] })) }
}
