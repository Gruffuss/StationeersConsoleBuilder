// Bar (Vanilla + Bar): a sunk track and a fill 5 inside it (a 1-unit border and 4-unit inset), horizontal or
// vertical, coloured by state, by its own level (auto) or ok; literal marks, a data target; cells (builder-defined, Q8).
// Colour expressions: 0.11.79.
import type { SrcNode, Value } from '../../model/scene'
import { shortestFloat } from '../../srctext/print'
import { box, el, KEYS, keyOf, levelPaint, num, paintOf, partRect, pos, well, named } from '../paint'
import type { Slot, WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; orient: string; stateMode: string; marks: number[]; target: boolean
  floor: number; critBelow: number; warnBelow: number; cells: number; keys: Record<string, string> }
const bar: WidgetModule<P> = {
  type: 'bar', label: 'Bar', group: 'values', prefix: 'bar', resize: 'both',
  slotName: named({ lvl: 'Level', st: 'State', tgt: 'Target' }),
  params: [...box(), { key: 'orient', name: 'Direction', type: 'enum', enum: ['h', 'v'] }, { key: 'stateMode', name: 'Colour from', type: 'enum', enum: ['bound', 'auto', 'ok'] },
    { key: 'marks', name: 'Marks', type: 'numbers', min: 0, max: 1 }, { key: 'target', name: 'Show target', type: 'flag' }, { key: 'floor', name: 'Lowest level shown', type: 'num', min: 0, max: 1 },
    { key: 'critBelow', name: 'Critical below', type: 'num', min: 0, max: 1 }, { key: 'warnBelow', name: 'Warning below', type: 'num', min: 0, max: 1 },
    { key: 'cells', name: 'Cells', type: 'num', min: 0, int: true }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 400, h: t.geo.size.bar, orient: 'h', stateMode: 'bound', marks: [], target: false, floor: 0, critBelow: 0.1, warnBelow: 0.25, cells: 0, keys: {} }),
  fix: p => ({ ...p, warnBelow: Math.max(p.critBelow, p.warnBelow) }),
  expand(p, t, uid) {
    const lvl = keyOf(p, uid, 'lvl'), st = keyOf(p, uid, 'st'), tgt = keyOf(p, uid, 'tgt'), { x, y, w, h } = p
    // i: the 1-unit border and the 4-unit inset (Vanilla + Bar). Every inner size goes through pos:
    // a bar thinner than its inset draws an empty fill, never a negative size.
    const level = `clamp($${lvl},${num(p.floor)},1)`, i = t.metrics['bar.inset'], markInset = t.metrics['bar.markInset']
    const derivedState = p.stateMode === 'ok' ? '1'
      : `if(lt($${lvl},${num(p.critBelow)}),3,if(lt($${lvl},${num(p.warnBelow)}),2,1))`
    const state = p.stateMode === 'bound' ? '$' + st : t.parts.fill.stroke === 'state' ? derivedState : undefined
    const paint = p.stateMode === 'auto' ? levelPaint(t, '$' + lvl, p.critBelow, p.warnBelow)
      : p.stateMode === 'ok' ? paintOf(t, t.parts['light.ok'].fill, derivedState) : undefined
    const extra: Record<string, Value> = p.stateMode === 'bound' ? {} : { f: paint ?? 'none' }, nodes: SrcNode[] = []
    const duplicates = new Map<string, number>()
    const markName = (m: number) => {
      const value = shortestFloat(m === 0 ? 0 : m), count = (duplicates.get(value) ?? 0) + 1
      duplicates.set(value, count)
      return `mark@${value}${count === 1 ? '' : '#' + count}`
    }
    if (p.cells > 0 && p.orient === 'h') {
      const gap = t.geo.space[1], cw = pos((w - (p.cells - 1) * gap) / p.cells), step = num(cw + gap), part = `clamp(${level}*${p.cells}-i,0,1)`
      nodes.push(el('RP', { n: p.cells }, [well(t, `=${num(x)}+i*${step}`, y, cw, h, 'track'),
        partRect(t, 'fill', `=${num(x + i)}+i*${step}`, `=${num(y + h - i)}-${num(pos(h - 2 * i))}*${part}`, pos(cw - 2 * i), pos(h - 2 * i),
          { tag: 'fill', state, extra: { h: `=${num(pos(h - 2 * i))}*${part}`, ...extra } })]))
    } else if (p.orient === 'v') {
      const span = pos(h - 2 * i)
      nodes.push(well(t, x, y, w, h, 'track'),
        partRect(t, 'fill', x + i, `=${num(y + h - i)}-${level}*${num(span)}`, pos(w - 2 * i), span,
          { tag: 'fill', state, extra: { h: `=${level}*${num(span)}`, ...extra } }),
        ...p.marks.map(m => partRect(t, 'mark', x + markInset, y + h - i - m * span - 0.5, pos(w - 2 * markInset), 1, { tag: markName(m) })))
      if (p.target) nodes.push(partRect(t, 'target', x + 1, `=${num(y + h - i - 1)}-clamp($${tgt},0,1)*${num(span)}`, pos(w - 2), 2, { tag: 'target' }))
    } else {
      const span = pos(w - 2 * i)
      nodes.push(well(t, x, y, w, h, 'track'),
        partRect(t, 'fill', x + i, y + i, span, pos(h - 2 * i),
          { tag: 'fill', state, extra: { w: `=${level}*${num(span)}`, ...extra } }),
        ...p.marks.map(m => partRect(t, 'mark', x + i + m * span - 0.5, y + markInset, 1, pos(h - 2 * markInset), { tag: markName(m) })))
      if (p.target) nodes.push(partRect(t, 'target', `=${num(x + i - 1)}+clamp($${tgt},0,1)*${num(span)}`, y + 1, 2, pos(h - 2), { tag: 'target' }))
    }
    const slots: Slot[] = [{ slot: 'lvl', key: lvl, kind: 'number', snap: false, sample: 0.62 }]
    if (p.stateMode === 'bound' && (t.parts.fill.fill === 'state' || t.parts.fill.stroke === 'state'))
      slots.push({ slot: 'st', key: st, kind: 'state', snap: true, sample: 1 })
    if (p.target && !(p.cells > 0 && p.orient === 'h')) slots.push({ slot: 'tgt', key: tgt, kind: 'number', snap: false, sample: 0.8 })
    return { nodes, slots }
  },
}
export default bar
