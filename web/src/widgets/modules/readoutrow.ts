// Readout row (Vanilla + ReadoutRow): a raised row, a status light, the name, and one or two right-aligned readings the
// state inks warn or crit (ok stays white). Units go in the panel heading, never after a value. Colour expressions: 0.11.79.
import { box, ink, inkOf, KEYS, keyOf, label, lights, literal, oneLine, placeholder, raised, named } from '../paint'
import type { Slot, WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; name: string; fmt1: string; fmt2: string; w1: number; w2: number; keys: Record<string, string> }
const readoutrow: WidgetModule<P> = {
  type: 'readoutrow', label: 'Readout row', group: 'values', prefix: 'row', resize: 'width',
  slotName: named({ st: 'State', r1: 'First value', r2: 'Second value' }),
  params: [...box(), { key: 'name', name: 'Name', type: 'text' }, { key: 'fmt1', name: 'First value format', type: 'fmt' }, { key: 'fmt2', name: 'Second value format', type: 'fmt' },
    { key: 'w1', name: 'First value width', type: 'num', min: 0 }, { key: 'w2', name: 'Second value width', type: 'num', min: 0 }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 440, h: t.geo.size.row, name: 'Label', fmt1: '%.1f', fmt2: '', w1: t.metrics['row.valueW1'], w2: t.metrics['row.valueW2'], keys: {} }),
  // At least one line of each fit=ellipsis label: the name, the reading, the second reading when shown.
  fix: (p, t) => ({ ...p, h: Math.max(p.h, oneLine(t, 'value', 'value-lg', ...(p.fmt2 ? ['reading' as const] : []))) }),
  expand(p, t, uid) {
    const g = t.geo, pad = g.space[4], gap = g.space[3], L = g.size.light, two = p.fmt2 !== ''
    const st = keyOf(p, uid, 'st'), f1 = p.fmt1 || '%.1f', r1 = keyOf(p, uid, 'r1', placeholder(f1)), r2 = keyOf(p, uid, 'r2', placeholder(p.fmt2))
    const right = p.x + p.w - pad, x2 = right - p.w2, x1 = (two ? x2 - pad : right) - p.w1, nameX = p.x + pad + L + gap
    const row = (x: number, w: number) => ({ x, y: p.y, w, h: p.h })
    const slots: Slot[] = [{ slot: 'st', key: st, kind: 'state', snap: true, sample: 1 }, { slot: 'r1', key: r1, kind: 'text', snap: true, sample: 21.4, labels: true }]
    if (two) slots.push({ slot: 'r2', key: r2, kind: 'text', snap: true, sample: 101.3, labels: true })
    return { slots, nodes: [raised(t, p.x, p.y, p.w, p.h, {}, 'row'), ...lights(t, p.x + pad + L / 2, p.y + p.h / 2, L / 2, L / 2, '$' + st, 'light'),
      label(t, 'value', row(nameX, Math.max(0, x1 - gap - nameX)), literal(t, 'value', p.name), { fit: true, tag: 'name' }),
      label(t, 'value-lg', row(x1, p.w1), `{$${r1}:${f1}}`, { tag: 'reading1', align: 'right', fit: true, f: ink(t, '$' + st, inkOf(t, 'value-lg')) }),
      ...(two ? [label(t, 'reading', row(x2, p.w2), `{$${r2}:${p.fmt2}}`, { tag: 'reading2', align: 'right', fit: true, f: ink(t, '$' + st, inkOf(t, 'reading')) })] : [])] }
  },
}
export default readoutrow
