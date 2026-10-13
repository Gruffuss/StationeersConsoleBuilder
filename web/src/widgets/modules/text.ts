// Text (Vanilla + type styles): one label in a theme style, a literal or a template the mod reads data from; an optional
// state inks it warn or crit. Placeholders: {$…} 0.11.34, {=…} 0.11.36 (literal writes one for plain digits); with state
// ink (a colour expression): 0.11.79.
import type { SrcNode } from '../../model/scene'
import { STYLES } from '../../theme'
import type { StyleName } from '../../theme/types'
import { box, ink, inkOf, KEYS, keyOf, label, literal, plainTextProblem, textReads } from '../paint'
import type { Slot, SlotKind, WidgetModule } from '../types'

const LABEL = 'Label'
// How the template reads a name decides its kind: inside an expression (an index, a {=…} placeholder) a number; as a
// list item (`$rows[i]`, `{$rows[i]}`) a list of numbers or strings; else, whole or in a {$…} placeholder, a number or a
// string (the mod prints a string as it is, a number through the format).
const RANK: Record<string, number> = { text: 0, item: 1, expr: 2 }
const KIND: SlotKind[] = ['text', 'texts', 'number']
const SAMPLE = (kind: SlotKind, whole: boolean) => kind === 'number' ? 12.5 : kind === 'texts' ? ['Text 1', 'Text 2', 'Text 3', 'Text 4'] : whole ? 'Text' : 12.5

type P = { x: number; y: number; w: number; h: number; style: string; text: string; align: string; state: boolean; keys: Record<string, string> }
const text: WidgetModule<P> = {
  type: 'text', label: 'Text', group: 'values', prefix: 'txt', resize: 'both',
  slotName: slot => slot.startsWith('$') ? slot.slice(1) : slot === 'st' ? 'State' : undefined,
  params: [...box(), { key: 'style', name: 'Text style', type: 'enum', enum: STYLES }, { key: 'text', name: 'Text', type: 'template' },
    { key: 'align', name: 'Align', type: 'enum', enum: ['left', 'center', 'right'] }, { key: 'state', name: 'Colour by state', type: 'flag' }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 300, h: 1.4 * t.type.value.size, style: 'value', text: LABEL, align: 'left', state: false, keys: {} }),
  // One line tall, or ellipsis draws nothing. Any template stands: every name the mod reads from it is declared.
  fix: (p, t) => ({ ...p, h: Math.max(p.h, Math.fround(1.4 * t.type[p.style as StyleName].size)) }),
  expand(p, t, uid) {
    // A text the mod would not print as written (a leading $, a closed placeholder: plainTextProblem) is a template, never
    // recased; any other text is a literal like any other.
    const style = p.style as StyleName, st = keyOf(p, uid, 'st'), reads = textReads(p.text)
    // Every non-empty name the template reads is a slot, its kind by the strictest way it is read. A name that is the
    // state's key is the state slot alone: one key, one slot. Template slots are `$<name>`, apart from the module's `st`.
    const how = new Map<string, number>()
    for (const r of reads) if (r.name && !(p.state && r.name === st)) how.set(r.name, Math.max(how.get(r.name) ?? 0, RANK[r.via]))
    const items = [...how.values()].includes(RANK.item)
    const node: SrcNode = label(t, style, p, plainTextProblem(p.text) ? p.text : literal(t, style, p.text), { tag: 'text', fit: true, missing: items,
      align: p.align === 'left' ? undefined : p.align as 'center' | 'right', f: p.state ? ink(t, '$' + st, inkOf(t, style)) : undefined })
    const whole = p.text[0] === '$'
    const slots: Slot[] = [...how].map(([n, r]) => ({ slot: '$' + n, key: n, kind: KIND[r], snap: true, sample: SAMPLE(KIND[r], whole) }))
    if (p.state) slots.push({ slot: 'st', key: st, kind: 'state', snap: true, sample: 1 })
    return { nodes: [node], slots }
  },
}
export default text
