// Option group (builder-defined, Q8): options side by side with space-3 gaps, the selected one ringed (eq($sel, value)).
// Each option is a plate and its body in a G id=<uid>_g<k>, so its pressed look answers to it alone; the labels come after
// all the groups, since option k+1's ring reaches past its body over option k's label (E5). v on R/T: 0.11.75.
import { body, box, el, keyOf, keyed, KEYS, label, literal, num, oneLine, pos, ring, named } from '../paint'
import type { WidgetModule } from '../types'

type Option = { label: string; value: number; key: number }
type P = { x: number; y: number; w: number; h: number; options: Option[]; gap: number; keys: Record<string, string> }
const options: WidgetModule<P> = {
  type: 'options', label: 'Option group', group: 'controls', prefix: 'og', resize: 'both',
  slotName: named({ sel: 'Selected value' }),
  params: [...box(), { key: 'options', name: 'Options', type: 'list', min: 1, item: [{ key: 'label', name: 'Label', type: 'text' }, { key: 'value', name: 'Value', type: 'num' }, { key: 'key', name: 'Option id', type: 'num', min: 0, int: true }] },
    { key: 'gap', name: 'Gap', type: 'num', min: 0 }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 440, h: t.geo.size.control, options: [{ label: 'Auto', value: 0, key: 0 }, { label: 'On', value: 1, key: 1 }, { label: 'Off', value: 2, key: 2 }],
    gap: t.geo.space[3], keys: {} }),
  // At least one line of its button-label labels, which have fit=ellipsis.
  fix: (p, t) => ({ ...p, options: keyed(p.options), h: Math.max(p.h, oneLine(t, 'button-label')) }),
  expand(p, t, uid) {
    const n = p.options.length, bw = pos((p.w - (n - 1) * p.gap) / n), sel = keyOf(p, uid, 'sel'), at = (k: number) => p.x + k * (bw + p.gap)
    return {
      nodes: [...p.options.map((o, k) => el('G', { id: `${uid}_g${k}` }, [el('R', { id: `${uid}_o${k}`, click: 1, x: at(k), y: p.y, w: bw, h: p.h }),
          ring(t, at(k), p.y, bw, p.h, `=eq($${sel},${num(o.value)})`, `option.${o.key}.ring`), body(t, 'secondary', at(k), p.y, bw, p.h, `option.${o.key}.body`)])),
        ...p.options.map((o, k) => label(t, 'button-label', { x: at(k), y: p.y, w: bw, h: p.h }, literal(t, 'button-label', o.label), { align: 'center', fit: true, tag: `option.${o.key}.label` }))],
      slots: [{ slot: 'sel', key: sel, kind: 'count', snap: true, sample: p.options[0].value }],
      clicks: p.options.map((o, k) => ({ id: `${uid}_o${k}`, step: `set(${num(o.value)})` })),
    }
  },
}
export default options
