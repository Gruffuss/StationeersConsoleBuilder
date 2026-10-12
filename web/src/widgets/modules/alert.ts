// Alert (Vanilla + Alert): hidden at state 0 (an unpainted R holds its box: paint.ts holder); the raised row behind it
// (Q8, builder-defined, on by default), the status chip (OK/WARN/CRIT) at the left padding and the message on one line.
// At most two on an overview: a layout rule, not this widget's. Colour expressions: 0.11.79.
import { box, chip, el, holder, KEYS, keyOf, label, oneLine, raised, WHOLE } from '../paint'
import type { WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; row: boolean; keys: Record<string, string> }
const alert: WidgetModule<P> = {
  type: 'alert', label: 'Alert', group: 'values', prefix: 'al', resize: 'width',
  params: [...box(), { key: 'row', type: 'flag' }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 440, h: t.geo.size.row, row: true, keys: {} }),
  // At least one message line: its box (42, or the row when lower) holds the message with fit=ellipsis.
  fix: (p, t) => ({ ...p, h: Math.max(p.h, oneLine(t, 'message')) }),
  expand(p, t, uid) {
    const st = keyOf(p, uid, 'st'), msg = keyOf(p, uid, 'msg', WHOLE), pad = t.geo.space[4], { w: cw, h: ch } = t.geo.chip
    const cx = p.x + pad, mx = cx + cw + pad, mh = Math.min(t.metrics['alert.messageH'], p.h)
    return {
      nodes: [holder(p), el('G', { v: `=gt($${st},0)` }, [...(p.row ? [raised(t, p.x, p.y, p.w, p.h, {}, 'row')] : []), ...chip(t, cx, p.y + (p.h - ch) / 2, '$' + st, 'chip'),
        label(t, 'message', { x: mx, y: p.y + (p.h - mh) / 2, w: Math.max(0, p.x + p.w - pad - mx), h: mh }, '$' + msg, { fit: true, tag: 'message' })])],
      slots: [{ slot: 'st', key: st, kind: 'state', snap: true, sample: 2 }, { slot: 'msg', key: msg, kind: 'text', snap: true, sample: 'Message', labels: true }],
    }
  },
}
export default alert
