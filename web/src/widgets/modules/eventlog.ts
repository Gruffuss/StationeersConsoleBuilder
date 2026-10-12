// Event log: an Alert row per entry (the Vanilla + Alert: a raised row, the state chip, the message), newest first, in one
// RP; a row is hidden where its class state reads 0 (an out-of-range read is 0), and an unpainted R holds the box
// (holder). k[] class states, m[] messages, t[] times when `time` is on (off by default, Q13). The ring itself (keep N,
// de-duplicate) is M3's generated Lua. Colour expressions: 0.11.79.
import { box, chip, el, holder, ITEM, KEYS, keyOf, label, num, oneLine, plus, pos, raised } from '../paint'
import type { Slot, WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; rows: number; time: boolean; pitch: number; keys: Record<string, string> }
const eventlog: WidgetModule<P> = {
  type: 'eventlog', label: 'Event log', group: 'values', prefix: 'log', resize: 'width',
  params: [...box(), { key: 'rows', type: 'num', min: 1, int: true }, { key: 'time', type: 'flag' }, { key: 'pitch', type: 'num', min: 0 }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 440, h: 0, rows: 4, time: false, pitch: t.metrics['list.pitch'], keys: {} }),
  fix: (p, t) => ({ ...p, h: (p.rows - 1) * p.pitch + Math.max(t.geo.size.row, oneLine(t, 'message', ...(p.time ? ['unit' as const] : []))) }),
  expand(p, t, uid) {
    const k = keyOf(p, uid, 'k'), m = keyOf(p, uid, 'm', ITEM), tm = keyOf(p, uid, 't', ITEM)
    const rh = Math.max(t.geo.size.row, oneLine(t, 'message', ...(p.time ? ['unit' as const] : []))), pad = t.geo.space[4], { w: cw, h: ch } = t.geo.chip, timeW = t.metrics['eventlog.timeW']
    const y = (d: number) => plus(`=${num(p.y)}+i*${num(p.pitch)}`, d)
    const cx = p.x + pad, tx = cx + cw + pad, mx = p.time ? tx + timeW + t.geo.space[3] : tx
    const slots: Slot[] = [{ slot: 'k', key: k, kind: 'states', snap: true, sample: [3, 2, 1] },
      { slot: 'm', key: m, kind: 'texts', snap: true, sample: ['Message 1', 'Message 2', 'Message 3'], labels: true }]
    if (p.time) slots.push({ slot: 't', key: tm, kind: 'texts', snap: true, sample: ['14:02', '13:57', '13:40'], labels: true })
    return { slots, nodes: [holder(p), el('RP', { n: p.rows }, [el('G', { v: `=gt($${k}[i],0)` }, [
      raised(t, p.x, y(0), p.w, rh, {}, 'row'), ...chip(t, cx, y((rh - ch) / 2), `$${k}[i]`, 'chip'),
      ...(p.time ? [label(t, 'unit', { x: tx, y: y(0), w: timeW, h: rh }, `$${tm}[i]`, { fit: true, missing: true, tag: 'time' })] : []),
      label(t, 'message', { x: mx, y: y(0), w: pos(p.x + p.w - pad - mx), h: rh }, `$${m}[i]`, { fit: true, missing: true, tag: 'message' })])])] }
  },
}
export default eventlog
