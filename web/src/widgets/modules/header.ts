// Header bar (Vanilla + Header): the brand banner, its 3-unit accent outline inside the box (Q7), the screen title at the
// left; at the right, right to left in fixed slots, the clock (a string, M3 sends game time), then the crit and warn counts
// (a glowing lamp and a three-digit number, hidden at 0; a hidden crit count leaves a gap). No buttons, tabs or cog (Q9).
// Placeholders: 0.11.34.
import type { SrcNode } from '../../model/scene'
import { box, el, KEYS, keyOf, label, literal, oneLine, partCircle, partRect, WHOLE, named } from '../paint'
import type { Slot, WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; title: string; clock: boolean; counts: boolean; keys: Record<string, string> }
const header: WidgetModule<P> = {
  type: 'header', label: 'Header bar', group: 'chrome', prefix: 'hdr', resize: 'both',
  slotName: named({ crit: 'Critical count', warn: 'Warning count', clock: 'Clock' }),
  params: [...box(), { key: 'title', name: 'Title', type: 'text' }, { key: 'clock', name: 'Show clock', type: 'flag' }, { key: 'counts', name: 'Show alarm counts', type: 'flag' }, KEYS],
  defaults: (t, ctx) => ({ x: 24, y: 24, w: ctx.size.w - 48, h: t.geo.size.header, title: 'Title', clock: false, counts: true, keys: {} }),
  // The title's and the clock's boxes (h - 12, centred) each hold one line with fit=ellipsis; with neither, any height.
  fix: (p, t) => ({ ...p, h: Math.max(p.h, p.title ? oneLine(t, 'screen-title') + 2 * t.metrics['header.inset'] : 0, p.clock ? oneLine(t, 'clock') + 2 * t.metrics['header.inset'] : 0) }),
  expand(p, t, uid) {
    const { x, y, w, h } = p, pad = t.geo.space[6], gap = t.geo.space[3], r = t.geo.size.light / 2
    const mid = y + h / 2, right = x + w - pad, clockW = t.metrics['header.clockW'], numW = t.metrics['header.countW'], k = (s: string) => keyOf(p, uid, s)
    const countH = t.metrics['header.countH'], inset = t.metrics['header.inset']
    const nodes: SrcNode[] = [partRect(t, 'header', x, y, w, h, { tag: 'banner' })]
    const slots: Slot[] = []
    let edge = p.clock ? right - clockW - gap : right   // the right end of the next slot, filled right to left
    if (p.counts) for (const [slot, sample] of [['crit', 1], ['warn', 2]] as const) {
      const numX = edge - numW, cx = numX - gap - r
      nodes.push(el('G', { v: `=gt($${k(slot)},0)` }, [partCircle(t, `light.${slot}`, cx, mid, r, r, undefined, `${slot}.lamp`),
        label(t, 'value', { x: numX, y: mid - countH / 2, w: numW, h: countH }, `{$${k(slot)}:%.0f}`, { align: 'right', tag: `${slot}.count` })]))
      slots.push({ slot, key: k(slot), kind: 'count', snap: true, sample })
      edge = cx - r - t.geo.space[5]
    }
    if (p.title) nodes.push(label(t, 'screen-title', { x: x + pad, y: y + inset, w: Math.max(0, edge - gap - x - pad), h: h - 2 * inset }, literal(t, 'screen-title', p.title), { fit: true, tag: 'title' }))
    if (p.clock) {
      const clock = keyOf(p, uid, 'clock', WHOLE)
      nodes.push(label(t, 'clock', { x: right - clockW, y: y + inset, w: clockW, h: h - 2 * inset }, '$' + clock, { align: 'right', fit: true, tag: 'clock' }))
      slots.push({ slot: 'clock', key: clock, kind: 'text', snap: true, sample: '14:06', labels: true })
    }
    return { nodes, slots }
  },
}
export default header
