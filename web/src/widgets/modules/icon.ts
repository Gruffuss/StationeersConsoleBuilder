// Native game icon; the builder shows only its box and name. Measured 2026-10-12: gas 39, slot 44, prefab 100 keys;
// Oxygen resolves to gas:Oxygen, CO2 to gas:CarbonDioxide; O2 is absent and draws a white square.
// The runtime resolves ss.ui.icons entries when present, otherwise keeps the chosen name with explicit icon_type.
import { iconKeys, iconName, icons } from '../../catalog'
import { box } from '../paint'
import type { WidgetModule } from '../types'

const legacy: Record<string, string> = { O2: 'Oxygen', N2: 'Nitrogen', CH4: 'Methane', X: 'Pollutant' }
export const legacyGasName = (name: string): string | undefined => Object.hasOwn(legacy, name) ? legacy[name] : undefined
export function iconWarning(kind: string, name: string): string | undefined {
  if (name === '' || kind !== 'gas' && kind !== 'slot' || iconName(kind, name) !== undefined || Object.values(icons[kind]).includes(name)) return
  const closest = (kind === 'gas' ? legacyGasName(name) : undefined) ?? iconKeys[kind].find(key => key.toLowerCase() === name.toLowerCase())
  return `"${name}" is not in the ${kind} icon catalogue${closest ? `; did you mean ${closest}?` : '; the game may not draw it'}`
}

type P = { x: number; y: number; w: number; h: number; kind: string; name: string }
const icon: WidgetModule<P> = {
  type: 'icon', label: 'Item / gas icon', group: 'icons', prefix: 'ico', resize: 'both', native: true,
  params: [...box(), { key: 'kind', name: 'Icon type', type: 'enum', enum: ['gas', 'slot', 'prefab'] }, { key: 'name', name: 'Icon name', type: 'template' }],
  defaults: t => ({ x: 24, y: 24, w: t.metrics['icon.size'], h: t.metrics['icon.size'], kind: 'gas', name: 'Oxygen' }),
  expand: p => ({ nodes: [], slots: [], natives: [{ type: 'icon', box: { x: p.x, y: p.y, w: p.w, h: p.h },
    props: { icon_type: p.kind, name: p.name, z_index: 6 }, style: {} }] }),
}
export default icon
