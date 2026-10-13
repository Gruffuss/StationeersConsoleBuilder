// Readout tile: hero (Vanilla + HeroReadout, one per screen: a 156-unit figure, its unit at 64 (Q7), a bar, the status
// word and a supporting value), kpi (builder-defined, Q8: a caption, the value, a unit, an underline gauge) and compact
// (a light, a name, the state word). Colour expressions: 0.11.79.
import type { SrcNode } from '../../model/scene'
import type { Theme } from '../../theme/types'
import { box, KEYS, keyOf, label, lights, literal, num, oneLine, partRect, placeholder, pos, st4, well, WHOLE, type LabelText, named } from '../paint'
import type { Json, Slot, SlotKind, WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; variant: string; caption: string; unit: string; fmt: string; bar: boolean
  subFmt: string; keys: Record<string, string> }
// The tile ends at its last row: hero, the status line (one `value` line at STATUS); kpi, the 3-unit gauge under the
// caption's and the value's lines. Lines are the theme's (oneLine). The hero's figure box, its bar and STATUS are its
// figure's layout (Barlow Condensed at 156), as Vanilla + draws it.
const lines = (t: Theme) => ({ line: oneLine(t, 'value'), cap: oneLine(t, 'unit'), val: oneLine(t, 'value-lg') })
const gauge = (t: Theme) => { const l = lines(t); return l.cap + l.val + t.metrics['kpi.meterGap'] }
const heightOf = (variant: string, t: Theme) => variant === 'hero' ? t.metrics['hero.statusY'] + lines(t).line : variant === 'kpi' ? gauge(t) + t.metrics['kpi.meterH'] : lines(t).line
const readout: WidgetModule<P> = {
  type: 'readout', label: 'Readout tile', group: 'values', prefix: 'ro', resize: 'width',
  slotName: named({ v: 'Value', lvl: 'Bar level', st: 'State', status: 'Status word', sub: 'Second value' }),
  params: [...box(), { key: 'variant', name: 'Style', type: 'enum', enum: ['hero', 'kpi', 'compact'] }, { key: 'caption', name: 'Caption', type: 'text' },
    { key: 'unit', name: 'Unit', type: 'text' }, { key: 'fmt', name: 'Number format', type: 'fmt' }, { key: 'bar', name: 'Show bar', type: 'flag' }, { key: 'subFmt', name: 'Second value format', type: 'fmt' }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 345, h: heightOf('hero', t), variant: 'hero', caption: 'Label', unit: '', fmt: '%.0f', bar: true, subFmt: '%.1f', keys: {} }),
  fix: (p, t) => ({ ...p, h: heightOf(p.variant, t) }),
  expand(p, t, uid) {
    // The labels alone read v, sub and status: their names are any a label reads back (keyOf's text).
    const fmt = p.fmt || '%.0f', text: Record<string, LabelText> = { v: placeholder(fmt), sub: placeholder(p.subFmt), status: WHOLE }
    const k = (s: string) => keyOf(p, uid, s, text[s]), st = '$' + k('st'), { x, y, w } = p
    const nodes: SrcNode[] = [], slots: Slot[] = [], { line: LINE, cap, val } = lines(t), GAUGE = gauge(t)
    const add = (slot: string, kind: SlotKind, snap: boolean, sample: Json) =>
      slots.push({ slot, key: k(slot), kind, snap, sample, ...(Object.hasOwn(text, slot) && { labels: true as const }) })
    if (p.variant === 'compact') {
      const L = t.geo.size.light, gap = t.geo.space[3], word = t.metrics['compact.statusW']
      nodes.push(...lights(t, x + L / 2, y + LINE / 2, L / 2, L / 2, st, 'light'),
        label(t, 'value', { x: x + L + gap, y, w: Math.max(0, w - L - 2 * gap - word), h: LINE }, literal(t, 'value', p.caption), { fit: true, tag: 'caption' }),
        label(t, 'value', { x: x + w - word, y, w: word, h: LINE }, '$' + k('status'), { tag: 'status', align: 'right', fit: true, f: st4(t, st) }))
      add('st', 'state', true, 1)
      add('status', 'text', true, 'Status')
      return { nodes, slots }
    }
    add('v', 'text', true, 78)
    if (p.variant === 'kpi') {
      const U = t.metrics['kpi.unitW']
      if (p.bar) {
        nodes.push(partRect(t, 'meter', x, y + GAUGE, w, t.metrics['kpi.meterH'], { tag: 'meter', state: st, extra: { w: `=clamp($${k('lvl')},0,1)*${num(w)}` } }))
        add('lvl', 'number', false, 0.78)
        if (t.parts.meter.fill === 'state' || t.parts.meter.stroke === 'state') add('st', 'state', true, 1)
      }
      nodes.push(label(t, 'unit', { x, y, w, h: cap }, literal(t, 'unit', p.caption), { fit: true, tag: 'caption' }),
        label(t, 'value-lg', { x, y: y + cap, w: pos(w - (p.unit ? U : 0)), h: val }, `{$${k('v')}:${fmt}}`, { tag: 'value' }))
      if (p.unit) nodes.push(label(t, 'unit', { x: x + w - U, y: y + cap + t.metrics['kpi.unitY'], w: U, h: cap }, literal(t, 'unit', p.unit), { align: 'right', tag: 'unit' }))
      return { nodes, slots }
    }
    // Every inner width goes through pos: a tile narrower than its unit slot or its bar's inset draws empty, never negative.
    const U = t.geo.heroUnit, inset = t.metrics['bar.inset'], barY = t.metrics['hero.barY'], statusY = t.metrics['hero.statusY']
    if (p.bar) {
      nodes.push(well(t, x, y + barY, w, t.geo.size.bar, 'track'),
        partRect(t, 'fill', x + inset, y + barY + inset, pos(w - 2 * inset), t.metrics['hero.fillH'], { tag: 'fill', state: st, extra: { w: `=clamp($${k('lvl')},0,1)*${num(pos(w - 2 * inset))}` } }))
      add('lvl', 'number', false, 0.78)
    }
    nodes.push(label(t, 'hero', { x, y, w: pos(w - U - t.metrics['hero.unitGap']), h: t.metrics['hero.figureH'] }, `{$${k('v')}:${fmt}}`, { align: 'right', tag: 'figure' }))
    // Vanilla + keeps its own unverified 85.5; other themes use heroUnitY in theme/baseline.ts to align the baselines.
    if (p.unit) nodes.push(label(t, 'unit', { x: x + w - U, y: y + t.metrics['hero.unitY'], w: U, h: 1.4 * U }, literal(t, 'unit', p.unit), { size: U, tag: 'unit' }))
    nodes.push(label(t, 'value', { x, y: y + statusY, w, h: LINE }, '$' + k('status'), { tag: 'status', fit: true, f: st4(t, st) }))
    add('st', 'state', true, 1)
    add('status', 'text', true, 'Status')
    if (p.subFmt) {
      nodes.push(label(t, 'reading', { x, y: y + statusY, w, h: LINE }, `{$${k('sub')}:${p.subFmt}}`, { align: 'right', tag: 'sub' }))
      add('sub', 'text', true, 101.3)
    }
    return { nodes, slots }
  },
}
export default readout
