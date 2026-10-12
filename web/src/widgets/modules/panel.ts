// Panel: a themed background with an optional title and unit caption. Content widgets are later siblings.
import type { SrcNode } from '../../model/scene'
import { box, label, literal, oneLine, partRect } from '../paint'
import type { WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; title: string; unit: string }
const panel: WidgetModule<P> = {
  type: 'panel', label: 'Panel', group: 'chrome', prefix: 'pnl', resize: 'both',
  params: [...box(), { key: 'title', type: 'text' }, { key: 'unit', type: 'text' }],
  defaults: () => ({ x: 24, y: 24, w: 440, h: 300, title: 'Title', unit: '' }),
  expand(p, t) {
    const { x, y, w, h } = p, pad = t.geo.space[4], unitW = t.metrics['panel.unitW']
    const titleH = oneLine(t, 'panel-title'), unitH = 1.4 * t.type.unit.size   // the unit centred on the title's line
    const nodes: SrcNode[] = [partRect(t, 'panel', x, y, w, h, { tag: 'body' })]
    // The title box holds one panel-title line with fit=ellipsis (oneLine).
    if (p.title) nodes.push(label(t, 'panel-title', { x: x + pad, y: y + t.metrics['panel.titleY'], w: Math.max(0, w - 2 * pad - (p.unit ? unitW + t.geo.space[3] : 0)), h: titleH },
      literal(t, 'panel-title', p.title), { fit: true, tag: 'title' }))
    // The unit slot uses the theme metric panel.unitW; a longer unit can overflow left over the title.
    if (p.unit) nodes.push(label(t, 'unit', { x: x + w - pad - unitW, y: y + t.metrics['panel.titleY'] + (titleH - unitH) / 2, w: unitW, h: unitH }, literal(t, 'unit', p.unit), { align: 'right', tag: 'unit' }))
    return { nodes, slots: [] }
  },
}
export default panel
