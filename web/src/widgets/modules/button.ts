// Button (Vanilla + Button): at least size-control tall; secondary (raised row), primary (brand, accent outline inside, Q7)
// or danger (no border); the focus ring outside when selected. Builder-defined (Q8): pressed fo=1-0.25*down; disabled = the
// group at o=0.5 and the plate gone (a v=0 subtree has no hit region); multi-state = one body and one label per state, all
// labels after all bodies. v on R/T: 0.11.75 (on G earlier); down: 0.11.36.
import { body, box, el, keyOf, keyed, KEYS, label, literal, oneLine, paintOf, ring, named } from '../paint'
import type { PartName } from '../../theme/types'
import type { Slot, WidgetModule } from '../types'

type State = { label: string; variant: string; key: number }
type P = { x: number; y: number; w: number; h: number; states: State[]; canDisable: boolean; canSelect: boolean; keys: Record<string, string> }
const button: WidgetModule<P> = {
  type: 'button', label: 'Button', group: 'controls', prefix: 'btn', resize: 'both',
  slotName: named({ state: 'Current state', dis: 'Disabled', sel: 'Selected' }),
  params: [...box(), { key: 'states', name: 'States', type: 'list', min: 1, item: [{ key: 'label', name: 'Label', type: 'text' },
    { key: 'variant', name: 'Style', type: 'enum', enum: ['secondary', 'primary', 'danger'] }, { key: 'key', name: 'State id', type: 'num', min: 0, int: true }] }, { key: 'canDisable', name: 'Can be disabled', type: 'flag' }, { key: 'canSelect', name: 'Can be selected', type: 'flag' }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 200, h: t.geo.size.control, states: [{ label: 'Button', variant: 'secondary', key: 0 }], canDisable: false, canSelect: false, keys: {} }),
  // At least one line of its button-label labels, which have fit=ellipsis.
  fix: (p, t) => ({ ...p, states: keyed(p.states), h: Math.max(p.h, oneLine(t, 'button-label')) }),
  expand(p, t, uid) {
    const { x, y, w, h } = p, k = (s: string) => keyOf(p, uid, s), pad = t.geo.space[6], multi = p.states.length > 1, slots: Slot[] = []
    const labels = p.states.map((s, n) => label(t, 'button-label', { x: x + pad, y, w: Math.max(0, w - 2 * pad), h }, literal(t, 'button-label', s.label),
      { tag: `state.${s.key}.label`, align: 'center', fit: true, f: paintOf(t, t.parts[`button.${s.variant}` as PartName].ink), v: multi ? `=eq($${k('state')},${n})` : undefined }))
    const face = multi ? [...p.states.map((s, n) => el('G', { v: `=eq($${k('state')},${n})` }, [body(t, s.variant, x, y, w, h, `state.${s.key}.body`)])), ...labels]
      : [body(t, p.states[0].variant, x, y, w, h, `state.${p.states[0].key}.body`), labels[0]]
    if (multi) slots.push({ slot: 'state', key: k('state'), kind: 'count', snap: true, sample: 0 })
    if (p.canDisable) slots.push({ slot: 'dis', key: k('dis'), kind: 'flag', snap: true, sample: 0 })
    if (p.canSelect) slots.push({ slot: 'sel', key: k('sel'), kind: 'flag', snap: true, sample: 0 })
    return {
      nodes: [el('R', { id: `${uid}_hit`, click: 1, v: p.canDisable ? `=1-$${k('dis')}` : undefined, x, y, w, h }),
        ...(p.canSelect ? [ring(t, x, y, w, h, `=$${k('sel')}`, 'ring')] : []),
        ...(p.canDisable ? [el('G', { o: `=1-0.5*$${k('dis')}` }, face)] : face)],
      slots, clicks: [{ id: `${uid}_hit`, step: multi ? 'cycle' : '' }],
    }
  },
}
export default button
