// Text input (spec P0, Q11): a ScriptedScreens `textinput` element in Page.natives (Q10), entirely native (ruling 6): an
// opaque surface-well background, no vector frame (a builder-defined look). The native props still need verification in game.
// fontSize is in design units: the shell scales it with the box.
import { box, paintOf } from '../paint'
import type { WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; placeholder: string; value: string; fontSize: number }
const textinput: WidgetModule<P> = {
  type: 'textinput', label: 'Text input', group: 'icons', prefix: 'ti', resize: 'both', native: true,
  params: [...box(), { key: 'placeholder', name: 'Placeholder', type: 'template' }, { key: 'value', name: 'Starting text', type: 'template' }, { key: 'fontSize', name: 'Font size', type: 'num', min: 1 }],
  defaults: t => ({ x: 24, y: 24, w: 300, h: t.geo.size.control, placeholder: 'Text', value: '', fontSize: t.type.message.size }),
  expand: (p, t) => ({ nodes: [], slots: [], natives: [{ type: 'textinput', box: { x: p.x, y: p.y, w: p.w, h: p.h },
    props: { value: p.value, placeholder: p.placeholder, z_index: 22 },
    style: { bg: paintOf(t, t.parts.field.fill) ?? 'none', text: paintOf(t, t.parts['field.text'].fill) ?? 'none',
      placeholder_color: paintOf(t, t.parts['field.placeholder'].fill) ?? 'none' }, fontSize: p.fontSize }] }),
}
export default textinput
