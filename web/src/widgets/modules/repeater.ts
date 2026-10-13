// Repeater: one item template drawn `max` times in one RP, each copy shown while
// i < $n (the count snaps; an unpainted R holds the box at n 0: holder); a list, or a grid of `cols` columns. Items are
// Vanilla + rows: text, a Readout row, a Bar, a Status light; an optional unpainted plate per row reports `<uid>_r:i`.
// `fmt` is the row item's value format (the other items show no number); empty reads as %.1f, as in the Readout row.
// `valueW` is the row's value column, 0 for the theme's width (repeater.valueW), so it follows a theme switch until set;
// the name takes the rest. `fade` gives each item an opacity from data (fade[i], 0 opaque to 1 gone).
// v on C: 0.11.75; the bar item 0.11.79.
import type { SrcNode } from '../../model/scene'
import type { Theme } from '../../theme/types'
import { box, el, holder, ITEM, itemPlaceholder, KEYS, keyOf, label, lights, num, oneLine, partRect, plus, pos, raised, well, type At, type LabelText } from '../paint'
import type { Slot, WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; max: number; layout: string; cols: number; pitch: number; item: string; fmt: string
  valueW: number; click: boolean; fade: boolean; keys: Record<string, string> }
const itemH = (t: Theme, item: string) =>
  item === 'row' ? Math.max(t.geo.size.row, oneLine(t, 'value', 'value-lg')) : item === 'bar' ? t.geo.size.bar : item === 'light' ? t.geo.size.light : 1.4 * t.type.value.size
const repeater: WidgetModule<P> = {
  type: 'repeater', label: 'Repeater', group: 'chrome', prefix: 'rep', resize: 'width',
  params: [...box(), { key: 'max', type: 'num', min: 1, int: true }, { key: 'layout', type: 'enum', enum: ['list', 'grid'] },
    { key: 'cols', type: 'num', min: 1, int: true }, { key: 'pitch', type: 'num', min: 0 }, { key: 'item', type: 'enum', enum: ['row', 'text', 'bar', 'light'] },
    { key: 'fmt', type: 'fmt' }, { key: 'valueW', type: 'num', min: 0 }, { key: 'click', type: 'flag' }, { key: 'fade', type: 'flag' }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 440, h: 0, max: 6, layout: 'list', cols: 2, pitch: t.metrics['list.pitch'], item: 'row', fmt: '%.1f', valueW: 0, click: false, fade: false, keys: {} }),
  fix: (p, t) => ({ ...p, keys: Object.fromEntries(Object.entries(p.keys).filter(([s]) => s !== 'hasv' && s !== 'ready')), h: ((p.layout === 'grid' ? Math.ceil(p.max / p.cols) : p.max) - 1) * p.pitch + itemH(t, p.item) }),
  expand(p, t, uid) {
    // A cell narrower than the gap is empty (0 wide), never negative: a T with a negative w is laid out over its neighbour.
    const gap = t.geo.space[3], grid = p.layout === 'grid', dx = (p.w + gap) / p.cols, iw = grid ? pos(dx - gap) : p.w, ih = itemH(t, p.item)
    const ix: At = grid ? `=${num(p.x)}+mod(i,${num(p.cols)})*${num(dx)}` : p.x
    const iy: At = grid ? `=${num(p.y)}+floor(i/${num(p.cols)})*${num(p.pitch)}` : `=${num(p.y)}+i*${num(p.pitch)}`
    // The labels alone read t, name and v: their names are any a label reads back (keyOf's text).
    const fmt = p.fmt || '%.1f', text: Record<string, LabelText> = p.item === 'text' ? { t: ITEM } : p.item === 'row' ? { name: ITEM, v: itemPlaceholder(fmt) } : {}
    const k = (s: string) => s === 'hasv' || s === 'ready' ? `${uid}_${s}` : keyOf(p, uid, s, text[s]), n = k('n')
    const body: SrcNode[] = p.click ? [el('R', { id: `${uid}_r`, click: 1, x: ix, y: iy, w: iw, h: ih })] : []
    const slots: Slot[] = [{ slot: 'n', key: n, kind: 'count', snap: true, sample: 4 }]
    const add = (slot: string, kind: Slot['kind'], snap: boolean, sample: Slot['sample'], runtime?: true) =>
      slots.push({ slot, key: k(slot), kind, snap, sample, ...(runtime && { runtime }), ...(Object.hasOwn(text, slot) && { labels: true as const }) })
    if (p.item === 'text') {
      body.push(label(t, 'value', { x: ix, y: iy, w: iw, h: ih }, `$${k('t')}[i]`, { fit: true, missing: true, tag: 'text' }))
      add('t', 'texts', true, ['Item 1', 'Item 2', 'Item 3', 'Item 4'])
    } else if (p.item === 'row') {
      const L = t.geo.size.light, pad = t.geo.space[4], vw = Math.min(p.valueW || t.metrics['repeater.valueW'], pos(iw - 2 * pad))   // the value column stays inside its row
      const narrow = pos(iw - 2 * pad - L - 2 * gap - vw), full = pos(iw - 2 * pad - L - gap)
      // A missing flag reads 0 too; readiness keeps unsent data in the original layout.
      const empty = `and($${k('ready')},eq($${k('hasv')}[i],0))`
      body.push(raised(t, ix, iy, iw, ih, {}, 'row'), ...lights(t, plus(ix, pad + L / 2), plus(iy, ih / 2), L / 2, L / 2, `$${k('st')}[i]`, 'light'),
        label(t, 'value', { x: plus(ix, pad + L + gap), y: iy, w: `=lerp(${num(narrow)},${num(full)},clamp(${empty},0,1))`, h: ih }, `$${k('name')}[i]`, { fit: true, missing: true, tag: 'name' }),
        label(t, 'value-lg', { x: plus(ix, iw - pad - vw), y: iy, w: vw, h: ih }, `{$${k('v')}[i]:${fmt}}`, { align: 'right', v: `=not(${empty})`, tag: 'value' }))
      add('name', 'texts', true, ['Item 1', 'Item 2', 'Item 3', 'Item 4'])
      add('v', 'texts', true, [21.4, 19.8, 0, 101.3])
      add('hasv', 'numbers', true, [1, 1, 0, 1], true)
      add('ready', 'flag', true, 1, true)
      add('st', 'states', true, [1, 2, 0, 3])
    } else if (p.item === 'bar') {
      const inset = t.metrics['bar.inset']
      body.push(well(t, ix, iy, iw, ih, 'track'),
        partRect(t, 'fill', plus(ix, inset), plus(iy, inset), pos(iw - 2 * inset), pos(ih - 2 * inset),
          { tag: 'fill', state: `$${k('st')}[i]`, extra: { w: `=clamp($${k('lvl')}[i],0,1)*${num(pos(iw - 2 * inset))}` } }))
      add('lvl', 'numbers', false, [0.62, 0.3, 0.05, 0.9])
      if (t.parts.fill.fill === 'state' || t.parts.fill.stroke === 'state') add('st', 'states', true, [1, 2, 3, 1])
    } else {
      body.push(...lights(t, plus(ix, ih / 2), plus(iy, ih / 2), ih / 2, ih / 2, `$${k('st')}[i]`, 'light'))
      add('st', 'states', true, [1, 2, 0, 3])
    }
    // fade: each item's opacity 1 - fade[i] (0..1), so a missing entry, read as 0, leaves the item opaque.
    if (p.fade) add('fade', 'numbers', true, [0, 0, 0.65, 0])
    const shown = p.fade ? { v: `=lt(i,$${n})`, o: `=1-clamp($${k('fade')}[i],0,1)` } : { v: `=lt(i,$${n})` }
    return { nodes: [holder(p), el('RP', { n: p.max }, [el('G', shown, body)])], slots, clicks: p.click ? [{ id: `${uid}_r`, step: 'id:i' }] : [] }
  },
}
export default repeater
