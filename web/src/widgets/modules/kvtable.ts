// Key–value table (Vanilla + ReadoutRow composition, without lights): one raised row per entry, the caption at the left and
// the value right-aligned in a fixed slot, a number ({$v:fmt}) or, with fmt empty, a string; with state, the value turns
// warn or crit. Rows are unrolled (captions and formats differ per row); the height follows them. No row limit.
// Each row's slots are named by the row's own `key`, a number no other row holds (`v<key>`, `s<key>`): a row removed or
// moved leaves the other rows' data names, renames and preview values where they were. Colour expressions: 0.11.79.
import type { SrcNode } from '../../model/scene'
import { box, ink, inkOf, KEYS, keyOf, keyed, label, literal, oneLine, placeholder, raised, WHOLE } from '../paint'
import type { Slot, WidgetModule } from '../types'

type Row = { caption: string; fmt: string; state: boolean; key: number }
type P = { x: number; y: number; w: number; h: number; rows: Row[]; rowH: number; gap: number; valueW: number; keys: Record<string, string> }
const kvtable: WidgetModule<P> = {
  type: 'kvtable', label: 'Key–value table', group: 'chrome', prefix: 'kv', resize: 'width',
  params: [...box(), { key: 'rows', type: 'list', min: 1, item: [{ key: 'caption', type: 'text' }, { key: 'fmt', type: 'fmt' }, { key: 'state', type: 'flag' },
    { key: 'key', type: 'num', min: 0, int: true }] },
    { key: 'rowH', type: 'num', min: 0 }, { key: 'gap', type: 'num', min: 0 }, { key: 'valueW', type: 'num', min: 0 }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 440, h: 0, rows: [{ caption: 'Label 1', fmt: '%.1f', state: true, key: 0 }, { caption: 'Label 2', fmt: '%.1f', state: false, key: 1 },
    { caption: 'Label 3', fmt: '', state: false, key: 2 }], rowH: t.geo.size.row, gap: t.geo.space[2], valueW: t.metrics['table.valueW'], keys: {} }),
  // A row is at least one line of its fit=ellipsis labels (the caption, the value); the height follows the rows.
  fix: (p, t) => {
    const rowH = Math.max(p.rowH, oneLine(t, 'value', 'value-lg'))
    return { ...p, rowH, rows: keyed(p.rows), h: p.rows.length * rowH + (p.rows.length - 1) * p.gap }
  },
  itemSlots: (_, row) => [`v${row.key}`, `s${row.key}`],
  expand(p, t, uid) {
    const pad = t.geo.space[4], gap = t.geo.space[3], nodes: SrcNode[] = [], slots: Slot[] = []
    // ponytail: the value slot is valueW wide; an over-wide value is cut by the ellipsis ('12345…'). Widen valueW for it.
    p.rows.forEach((r, k) => {
      const y = p.y + k * (p.rowH + p.gap), text = r.fmt ? placeholder(r.fmt) : WHOLE
      const v = keyOf(p, uid, 'v' + r.key, text), s = keyOf(p, uid, 's' + r.key)
      nodes.push(raised(t, p.x, y, p.w, p.rowH, {}, `row.${r.key}`),
        ...(r.caption ? [label(t, 'value', { x: p.x + pad, y, w: Math.max(0, p.w - 2 * pad - p.valueW - gap), h: p.rowH }, literal(t, 'value', r.caption), { fit: true, tag: `row.${r.key}.caption` })] : []),
        label(t, 'value-lg', { x: p.x + p.w - pad - p.valueW, y, w: p.valueW, h: p.rowH }, text(v),
          { tag: `row.${r.key}.value`, align: 'right', fit: true, f: r.state ? ink(t, '$' + s, inkOf(t, 'value-lg')) : undefined }))
      slots.push({ slot: 'v' + r.key, key: v, kind: 'text', snap: true, sample: r.fmt ? 21.4 : 'Auto', labels: true })
      if (r.state) slots.push({ slot: 's' + r.key, key: s, kind: 'state', snap: true, sample: 1 })
    })
    return { nodes, slots }
  },
}
export default kvtable
