// Every data name a page sends (spec §6.3): its widgets' slots (a name read by a snapped slot and an eased one rides the
// snapped element: snap persists on an element), the raw $names its nodes read, and each native's bindable prop, keyed
// `@<uid>.<prop>` (an icon's item name, a text input's value).
import { dataNames } from '../editor/fields'
import type { Page } from '../model/project'
import type { Theme } from '../theme/types'
import { nativesOf, slotsOf, widgetOf, widgetsIn } from '../widgets/core'
import { nodeAt } from '../model/store'
import { worldOf } from '../editing/bounds'
import { mapTree } from '../editing/tree'
import type { Json, SlotKind } from '../widgets/types'

export type NameInfo = { name: string; kind: SlotKind | 'raw' | 'native'; snap: boolean; sample?: Json; slot?: string; widget?: string
  travel?: number; geometry?: boolean; runtime?: true
  native?: { uid: string; prop: string } }

const GEOMETRY = new Set(['X', 'Y', 'W', 'H', 'CX', 'CY', 'RX', 'RY', 'R', 'S', 'A', 'T', 'X1', 'Y1', 'X2', 'Y2',
  'AT', 'CH', 'DOFS', 'FAT', 'FEA', 'FEA_EDGE', 'FX', 'FY', 'MIN_SIZE', 'OW', 'SIZE', 'SW', 'OFF', 'TILE'])

export function namesOf(page: Page, t: Theme): NameInfo[] {
  const out = new Map<string, NameInfo>()
  for (const { path, ref: widget } of widgetsIn(page.scene, t)) {
    const n = nodeAt(page.scene.root, path)!
    const slots = slotsOf(n, t)
    if (!slots.length) continue
    const uid = widget.uid
    const p = Object.keys(n.attrs).every(k => k.toUpperCase() === 'ID') ? widget?.params : undefined
    for (const s of slots) {
      const was = out.get(s.key)
      // Normalized Bar levels move at most this many design units per unit of data (cells multiply travel).
      const local = p && widget?.type === 'bar' && p.stateMode !== 'auto' ? Math.max(Number(p.w), Number(p.h)) * Math.max(1, Number(p.cells))
        : p && widget?.type === 'repeater' && p.item === 'bar' ? Number(p.w)
        : p && widget?.type === 'toggle' ? t.metrics['switch.w'] : undefined
      const W = local && worldOf(page.scene, path)
      const travel = W && local ? local * Math.max(Math.hypot(W[0], W[1]), Math.hypot(W[2], W[3])) : undefined
      out.set(s.key, was ? { ...was, snap: was.snap || s.snap, ...(s.runtime && { runtime: s.runtime }), travel: was.travel && travel ? Math.max(was.travel, travel) : undefined }
        : { name: s.key, kind: s.kind, snap: s.snap, sample: s.sample, slot: s.slot, ...(s.runtime && { runtime: s.runtime }), ...(uid && { widget: uid }), ...(travel && { travel }) })
    }
  }
  const nodes = [...page.scene.root, ...page.scene.defs], geometryNodes = [], textNodes = []
  for (let n = nodes.pop(); n; n = nodes.pop()) {
    geometryNodes.push({ op: n.op, attrs: Object.fromEntries(Object.entries(n.attrs).filter(([k]) => GEOMETRY.has(k.toUpperCase()))) })
    textNodes.push({ op: n.op, attrs: Object.fromEntries(Object.entries(n.attrs).filter(([k]) => k.toUpperCase() === 'TEXT')) })
    for (const child of n.c ?? []) nodes.push(child)
  }
  const geometry = new Set(dataNames({ ...page.scene, header: {}, defs: [], root: geometryNodes }))
  const texts = new Set(dataNames({ ...page.scene, header: {}, defs: [], root: textNodes }))
  for (const name of texts) {
    const n = out.get(name)
    if (n) n.snap = true
  }
  // An additional raw reader can amplify the widget's input beyond its known travel.
  for (const name of dataNames({ ...page.scene, root: mapTree(page.scene.root, n => widgetOf(n, t) ? { ...n, c: undefined } : n, n => !!widgetOf(n, t)) })) {
    const n = out.get(name)
    if (n) delete n.travel
  }
  for (const name of dataNames(page.scene)) if (!out.has(name)) out.set(name, { name, kind: 'raw', snap: true, ...(geometry.has(name) && !texts.has(name) && { geometry: true }) })
  for (const { uid, el } of nativesOf(page, t)) {
    const prop = el.type === 'icon' ? 'name' : 'value', name = `@${uid}.${prop}`
    out.set(name, { name, kind: 'native', snap: true, native: { uid, prop } })
  }
  return [...out.values()]
}
