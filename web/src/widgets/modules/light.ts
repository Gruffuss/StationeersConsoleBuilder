// Status light (Vanilla + StatusLight): an 18-unit circle in one of four states (Q4: 0 idle, 1 ok, 2 warn, 3 crit); ok,
// warn and crit glow. No blink ("do not blink it"). Crit never stands alone: a layout rule, not this widget's. v on C: 0.11.75.
import { box, KEYS, keyOf, lights, named } from '../paint'
import type { WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; keys: Record<string, string> }
const light: WidgetModule<P> = {
  type: 'light', label: 'Status light', group: 'values', prefix: 'lt', resize: 'none',
  slotName: named({ st: 'State' }),
  params: [...box(), KEYS],
  defaults: t => ({ x: 24, y: 24, w: t.geo.size.light, h: t.geo.size.light, keys: {} }),
  expand(p, t, uid) {
    const st = keyOf(p, uid, 'st')
    return { nodes: lights(t, p.x + p.w / 2, p.y + p.h / 2, p.w / 2, p.h / 2, '$' + st, ''),
      slots: [{ slot: 'st', key: st, kind: 'state', snap: true, sample: 1 }] }
  },
}
export default light
