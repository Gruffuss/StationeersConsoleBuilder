// Flow duct: a track and a dashed stroke whose opacity follows run above an idle floor.
import { box, el, KEYS, keyOf, num, paintOf, partRect, tag, named } from '../paint'
import type { WidgetModule } from '../types'
import { dress } from '../dress'

type P = { x: number; y: number; w: number; h: number; dir: string; period: number; dash: number; speed: number; idle: number; keys: Record<string, string> }
const duct: WidgetModule<P> = {
  type: 'duct', label: 'Flow duct', group: 'chrome', prefix: 'duct', resize: 'both',
  slotName: named({ run: 'Running' }),
  params: [...box(), { key: 'dir', name: 'Direction', type: 'enum', enum: ['h', 'v'] }, { key: 'period', name: 'Dash repeat length', type: 'num', min: 0 }, { key: 'dash', name: 'Dash length', type: 'num', min: 0 },
    { key: 'speed', name: 'Flow speed', type: 'num' }, { key: 'idle', name: 'Idle opacity', type: 'num', min: 0, max: 1 }, KEYS],
  defaults: () => ({ x: 24, y: 24, w: 300, h: 4, dir: 'h', period: 22, dash: 11, speed: 20, idle: 0, keys: {} }),
  expand(p, t, uid) {
    const run = keyOf(p, uid, 'run'), along = p.dir === 'h'
    const so = p.idle > 0 ? `=${num(p.idle)}+${num(1 - p.idle)}*clamp($${run},0,1)` : `=clamp($${run},0,1)`
    const nodes = [partRect(t, 'duct.track', p.x, p.y, p.w, p.h, { tag: 'track' })]
    // The core consumes dofs before drawing: a negative offset moves positive speed forward (24 -> 29 at t=0.25).
    if (p.period > 0) nodes.push(tag('flow', dress(t, 'duct.flow', p, el('L', {
      p: along ? [p.x, p.y + p.h / 2, p.x + p.w, p.y + p.h / 2] : [p.x + p.w / 2, p.y, p.x + p.w / 2, p.y + p.h],
      sw: along ? p.h : p.w, s: paintOf(t, t.parts['duct.flow'].stroke), cap: 'butt',
      dash: [Math.min(p.dash, p.period), Math.max(0, p.period - p.dash)], dofs: `=-mod(t*${num(p.speed)},${num(p.period)})`, so,
    }))))
    return { nodes, slots: p.period > 0 ? [{ slot: 'run', key: run, kind: 'flag', snap: true, sample: 1 }] : [] }
  },
}
export default duct
