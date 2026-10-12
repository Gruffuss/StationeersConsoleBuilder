// The catalogue at run time: loaded lazily (devices.json 420 KB, 29.5 KB gzipped; enums.json 15.7 KB, 3.0 KB gzipped; measured
// on the build of 0.2.6428.27798) when a Data, Logic or Sim panel first needs it.
import type { Access, CatalogDevice, DevicesJson, EnumsJson } from './parse'
import iconsText from './icons.json?raw'
import gasesText from './gases.json?raw'
export type { Access, CatalogDevice } from './parse'

export const icons: Record<string, Record<string, string>> = JSON.parse(iconsText)
export const iconKeys = Object.fromEntries(Object.entries(icons).map(([kind, table]) => [kind, Object.keys(table).sort()]))
export const iconName = (kind: string, name: string): string | undefined =>
  Object.hasOwn(icons, kind) && Object.hasOwn(icons[kind], name) ? icons[kind][name] : undefined

export type Gas = { fill: string | [string, string]; ink: string; source: string }
export const gases: Record<string, Gas> = JSON.parse(gasesText)
/** Icon aliases resolve first; canonical liquid identities stay, other liquids share their gas's colours. */
export function gasOf(name: string): Gas | undefined {
  const id = iconName('gas', name)?.slice(4) ?? name
  const key = id === 'Steam' ? 'Water' : Object.hasOwn(gases, id) ? id : id.replace(/^Liquid/, '')
  return Object.hasOwn(gases, key) ? gases[key] : undefined
}

export type Catalog = { devices: CatalogDevice[]; byName: Map<string, CatalogDevice>; enums: EnumsJson; lt: string[]; lst: string[] }
export const catalogOf = (d: DevicesJson, e: EnumsJson): Catalog =>
  ({ devices: d.devices, byName: new Map(d.devices.map(x => [x.name, x])), enums: e, lt: e.LogicType.map(m => m.name), lst: e.LogicSlotType.map(m => m.name) })

let loading: Promise<Catalog> | undefined
// As text (?raw), parsed here: a typed JSON import makes tsc infer the whole file's literal type. A failed load is not kept,
// so the next call tries again (a chunk that did not arrive).
export const loadCatalog = (): Promise<Catalog> => loading ??=
  Promise.all([import('./devices.json?raw'), import('./enums.json?raw')]).then(([d, e]) => catalogOf(JSON.parse(d.default), JSON.parse(e.default)))
    .catch((err: unknown) => { loading = undefined; throw err })

export const deviceOf = (c: Catalog, prefab: string) => c.byName.get(prefab)

/** The LogicTypes every known prefab of the set has with an access `want` takes (an extension type as `#<id>`), sorted;
 *  `missing`: prefabs the catalogue does not know, which narrow nothing. No known prefab (any device): `none`. */
function typesOf(c: Catalog, prefabs: string[], want: (a: Access) => boolean, none: string[]): { types: string[]; missing: string[] } {
  const missing = prefabs.filter(p => !c.byName.has(p)), known = prefabs.filter(p => c.byName.has(p))
  if (!known.length) return { types: none, missing }
  const sets = known.map(p => {
    const d = c.byName.get(p)!
    return new Set([...Object.entries(d.logic).filter(([, a]) => want(a)).map(([k]) => k),
      ...Object.values(d.ext ?? {}).filter(([, a]) => want(a)).map(([id]) => `#${id}`)])
  })
  return { types: [...sets[0]].filter(t => sets.every(s => s.has(t))).sort(), missing }
}
/** No known prefab (any device): every enum type may be read or written. */
export const readableTypes = (c: Catalog, prefabs: string[]) => typesOf(c, prefabs, a => a !== 'W', [...c.lt])
export const writableTypes = (c: Catalog, prefabs: string[]) => typesOf(c, prefabs, a => a !== 'R', [...c.lt])
/** Write-only on every prefab of the set: a rule on one writes on its value's edge (ruling P6). No known prefab (any device):
 *  none, since no type is known to be write-only (every type would make every rule on such a role a pulse rule). */
export const pulseTypes = (c: Catalog, prefabs: string[]) => typesOf(c, prefabs, a => a === 'W', [])
/** The LogicSlotTypes every known prefab exposes at slot `slot`. */
export function slotTypesAt(c: Catalog, prefabs: string[], slot: number): string[] {
  const sets = prefabs.flatMap(p => c.byName.get(p) ? [new Set(c.byName.get(p)!.slots?.find(s => s.i === slot)?.logic ?? [])] : [])
  return sets.length ? [...sets[0]].filter(t => sets.every(s => s.has(t))).sort() : [...c.lst]
}
/** The export's title, else the prefab name in words: StructureGasSensor → Gas Sensor. */
export const titleOf = (d: CatalogDevice) =>
  d.title ?? d.name.replace(/^(Structure|Item|Dynamic)/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim()
