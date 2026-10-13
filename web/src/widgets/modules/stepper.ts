// Stepper (builder-defined, Q8): the name, then − (U+2212, which the game faces carry) and + buttons around a centred
// value. Each button is its own G id=<uid>_g… so its pressed look answers to it alone. The labels come after both
// groups: a stepper narrower than its parts (or with tall, square buttons) lays a body over the value or the name, and
// the game draws in order (E5). No hint line (ruling 10). press and down: 0.11.36 (every down: arrives from 0.11.37;
// before, two within 0.25 s arrived as one).
import { body, box, el, KEYS, keyOf, label, literal, num, oneLine, named } from '../paint'
import type { WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; name: string; fmt: string; by: number; min: number; max: number; keys: Record<string, string> }
const stepper: WidgetModule<P> = {
  type: 'stepper', label: 'Stepper', group: 'controls', prefix: 'stp', resize: 'both',
  // Any height, or one value line with a name: the name has fit=ellipsis, no other label has. The buttons stay square.
  slotName: named({ v: 'Value' }),
  params: [...box(), { key: 'name', name: 'Name', type: 'text' }, { key: 'fmt', name: 'Number format', type: 'fmt' }, { key: 'by', name: 'Step', type: 'num' }, { key: 'min', name: 'Minimum', type: 'num' }, { key: 'max', name: 'Maximum', type: 'num' }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 440, h: t.geo.size.control, name: 'Value', fmt: '%.0f', by: 1, min: 0, max: 100, keys: {} }),
  fix: (p, t) => p.name ? { ...p, h: Math.max(p.h, oneLine(t, 'value')) } : p,
  expand(p, t, uid) {
    const { x, y, h } = p, b = h, gap = t.geo.space[3], vw = t.metrics['stepper.valueW'], vh = 1.4 * t.type['value-lg'].size, v = keyOf(p, uid, 'v')
    const incX = x + p.w - b, valX = incX - gap - vw, decX = valX - gap - b
    // press=1: a plain click is debounced per pointer (0.25 s); press events all arrive, as down:<id>.
    const part = (g: string, plate: string, bx: number) => el('G', { id: `${uid}_${g}` }, [
      el('R', { id: `${uid}_${plate}`, press: 1, x: bx, y, w: b, h }), body(t, 'secondary', bx, y, b, h, plate + '.body')])
    const sign = (bx: number, text: string, tag: string) => label(t, 'button-label', { x: bx, y, w: b, h }, text, { align: 'center', tag })
    const steps = (d: number) => `step(${num(d)},${num(p.min)},${num(p.max)})`
    return {
      nodes: [part('gd', 'dec', decX), part('gi', 'inc', incX),
        ...(p.name ? [label(t, 'value', { x, y, w: Math.max(0, decX - gap - x), h }, literal(t, 'value', p.name), { fit: true, tag: 'name' })] : []),
        sign(decX, '−', 'dec.sign'),
        label(t, 'value-lg', { x: valX, y: y + (h - vh) / 2, w: vw, h: vh }, `{$${v}:${p.fmt || '%.0f'}}`, { align: 'center', tag: 'value' }),
        sign(incX, '+', 'inc.sign')],
      slots: [{ slot: 'v', key: v, kind: 'number', snap: true, sample: 12 }],
      clicks: [{ id: `${uid}_dec`, step: steps(0 - p.by) }, { id: `${uid}_inc`, step: steps(p.by) }],
    }
  },
}
export default stepper
