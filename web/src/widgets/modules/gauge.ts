import type { SrcNode } from '../../model/scene'
import { shortestFloat } from '../../srctext/print'
import { dress } from '../dress'
import { box, el, KEYS, keyOf, label, literal, num, oneLine, paintOf, partCircle, pos, st4, tag, named } from '../paint'
import type { Slot, WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; label: string; unit: string; min: number; max: number
  start: number; end: number; ticks: number; fmt: string; value: boolean; state: boolean; keys: Record<string, string> }
const gauge: WidgetModule<P> = {
  type: 'gauge', label: 'Gauge', group: 'values', prefix: 'gauge', resize: 'both',
  slotName: named({ v: 'Value', st: 'State' }),
  params: [...box(), { key: 'label', name: 'Label', type: 'text' }, { key: 'unit', name: 'Unit', type: 'text' }, { key: 'min', name: 'Minimum', type: 'num' },
    { key: 'max', name: 'Maximum', type: 'num' }, { key: 'start', name: 'Start angle', type: 'num' }, { key: 'end', name: 'End angle', type: 'num' },
    { key: 'ticks', name: 'Tick count', type: 'num', min: 0, int: true }, { key: 'fmt', name: 'Number format', type: 'fmt' }, { key: 'value', name: 'Show value', type: 'flag' }, { key: 'state', name: 'Colour by state', type: 'flag' }, KEYS],
  defaults: () => ({ x: 24, y: 24, w: 300, h: 300, label: 'Label', unit: '', min: 0, max: 100, start: -135, end: 135,
    ticks: 5, fmt: '%.0f', value: true, state: true, keys: {} }),
  fix: (p, t) => ({ ...p, h: Math.max(p.h, oneLine(t, 'unit')) }),
  expand(p, t, uid) {
    const { x, y, w, h } = p, tw = t.parts['gauge.track'].width ?? 0, nw = t.parts['gauge.needle'].width ?? 0
    const line = oneLine(t, 'unit'), r = pos(Math.min(w, h - line) / 2 - tw), cx = x + w/2, cy = y + r + tw
    const v = keyOf(p, uid, 'v'), st = keyOf(p, uid, 'st'), sweep = p.end-p.start
    const point = (angle: number, radius: number) => {
      const a = angle * Math.PI / 180
      return [cx + Math.sin(a)*radius, cy - Math.cos(a)*radius]
    }
    const full = Math.abs(sweep) >= 360, start = full ? p.start % 360 : p.start
    const a = point(start, r), mid = point((p.start+p.end)/2, r), z = point(p.end, r), clockwise = sweep >= 0 ? 1 : 0
    const arc = (end: number[]) => `A${num(r)} ${num(r)} 0 ${!full && Math.abs(sweep)/2 > 180 ? 1 : 0} ${clockwise} ${end.map(num).join(' ')}`
    const path = full ? [1,2,3,4].map(i => arc(i === 4 ? a : point(start+i*(clockwise ? 90 : -90), r))).join(' ') + ' Z'
      : `${arc(mid)} ${arc(z)}`
    const trackPaint = paintOf(t, t.parts['gauge.track'].stroke)
    const nodes: SrcNode[] = [tag('track', dress(t, 'gauge.track', { x: cx-r, y: cy-r, w: 2*r, h: 2*r },
      el('P', { d: `M${a.map(num).join(' ')} ${path}`, s: trackPaint, sw: trackPaint === undefined ? undefined : tw })))]
    for (let i = 0; r > 0 && i < p.ticks; i++) {
      const fraction = p.ticks === 1 ? 0 : i/(p.ticks-1), angle = p.start + fraction*sweep, a = point(angle, 0.85*r), b = point(angle, r)
      nodes.push(tag(`tick@${shortestFloat(fraction)}`, dress(t, 'gauge.tick', { x: Math.min(a[0],b[0]), y: Math.min(a[1],b[1]), w: Math.abs(a[0]-b[0]), h: Math.abs(a[1]-b[1]) },
        el('L', { p: [...a,...b], s: paintOf(t, t.parts['gauge.tick'].stroke), sw: t.parts['gauge.tick'].width }))))
    }
    const state = p.state ? '$'+st : undefined
    const rotation = p.min === p.max ? `=${num(p.start)}+gt($${v},${num(p.min)})*${num(sweep)}`
      : `=${num(p.start)}+clamp(($${v}-${num(p.min)})/${num(p.max-p.min)},0,1)*${num(sweep)}`
    const needlePaint = state ? st4(t, state) : paintOf(t, t.parts['gauge.needle'].stroke)
    // Keep an invisible, valid reader when the dial has no radius.
    const needleH = r > 0 ? 0.9*r : 1
    const needle = tag('needle', dress(t, 'gauge.needle', { x: cx-nw/2, y: cy-needleH, w: nw, h: needleH },
      el('L', { v: r > 0 ? undefined : 0, p: [cx,cy,cx,cy-needleH], s: needlePaint, sw: needlePaint === undefined ? undefined : nw }), { state }))
    nodes.push(el('G', { a: [cx,cy], r: rotation }, [needle]), partCircle(t, 'gauge.hub', cx, cy, nw*1.5, nw*1.5, undefined, 'hub'))
    const valueY = Math.min(cy+nw*1.5, y+h-line)
    if (p.value) nodes.push(label(t, 'value-lg', { x, y: valueY, w, h: Math.min(oneLine(t, 'value-lg'), pos(y+h-line-valueY)) }, `{$${v}:${p.fmt || '%.0f'}}`,
      { tag: 'value', align: 'center', unit: p.unit ? literal(t, 'unit', p.unit) : undefined }))
    nodes.push(label(t, 'unit', { x, y: y+h-line, w, h: line }, literal(t, 'unit', p.label), { tag: 'label', align: 'center', fit: true }))
    const slots: Slot[] = [{ slot: 'v', key: v, kind: 'number', snap: false, sample: 50 }]
    if (p.state) slots.push({ slot: 'st', key: st, kind: 'state', snap: true, sample: 1 })
    return { nodes, slots }
  },
}
export default gauge
