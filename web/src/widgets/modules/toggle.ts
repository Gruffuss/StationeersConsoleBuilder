// Toggle (Q8, builder-defined): the button look is a secondary button whose focus ring shows when on, the label left and
// ON/OFF right (text-muted when off), `on` sent snapped; the switch look is a 64 x 38 track mix(surface-well, status-ok, on)
// and a white knob that slides 26 units, `on` eased so the knob glides. v on R/T: 0.11.75 (button look); mix: 0.11.79.
import { body, box, el, inkOf, keyOf, KEYS, label, literal, num, oneLine, paintOf, partRect, ring, named } from '../paint'
import type { Slot, WidgetModule } from '../types'

type P = { x: number; y: number; w: number; h: number; label: string; onText: string; offText: string; look: string; keys: Record<string, string> }
const toggle: WidgetModule<P> = {
  type: 'toggle', label: 'Toggle', group: 'controls', prefix: 'tg', resize: 'both',
  slotName: named({ on: 'On', st: 'State' }),
  params: [...box(), { key: 'label', name: 'Label', type: 'text' }, { key: 'onText', name: 'On text', type: 'text' }, { key: 'offText', name: 'Off text', type: 'text' },
    { key: 'look', name: 'Style', type: 'enum', enum: ['button', 'switch'] }, KEYS],
  defaults: t => ({ x: 24, y: 24, w: 300, h: t.geo.size.control, label: 'Label', onText: 'On', offText: 'Off', look: 'button', keys: {} }),
  // At least one line of its button-label labels, which have fit=ellipsis.
  fix: (p, t) => ({ ...p, h: Math.max(p.h, oneLine(t, 'button-label')) }),
  expand(p, t, uid) {
    const { x, y, w, h } = p, on = keyOf(p, uid, 'on'), pad = t.geo.space[6], gap = t.geo.space[3]
    const hit = el('R', { id: `${uid}_hit`, click: 1, x, y, w, h }), clicks = [{ id: `${uid}_hit`, step: 'toggle' }]
    if (p.look === 'switch') {
      const tw = t.metrics['switch.w'], th = Math.min(t.metrics['switch.h'], h), inset = t.metrics['switch.inset']
      const tx = x + w - pad - tw, ty = y + (h - th) / 2, level = `clamp($${on},0,1)`
      const state = '$' + keyOf(p, uid, 'st')
      const off = paintOf(t, t.parts['switch.off'].fill, state), active = paintOf(t, t.parts['switch.on'].fill, state)
      const argument = (p: string | undefined) => !p || p === 'none' ? '#00000000' : p.replace(/^=/, '')
      const paint = (p: string | undefined) => !p || p === 'none' ? '#00000000' : p
      const gradient = [t.parts['switch.off'].fill, t.parts['switch.on'].fill].some(p => typeof p === 'object')
      const tracks = gradient ? [
        partRect(t, 'switch.off', tx, ty, tw, th, { tag: 'track', state, extra: { rx: t.parts['switch.off'].radius ?? th / 2 } }),
        partRect(t, 'switch.on', tx, ty, tw, th, { tag: 'track.on', state,
          extra: { rx: t.parts['switch.on'].radius ?? th / 2, f: paint(active),
            s: paint(paintOf(t, t.parts['switch.on'].stroke, state)), fo: '=' + level, so: '=' + level } }),
      ] : [partRect(t, 'switch.off', tx, ty, tw, th, { tag: 'track', state,
        extra: { rx: t.parts['switch.off'].radius ?? th / 2, f: `=mix(${argument(off)},${argument(active)},${level})` } })]
      const slots: Slot[] = [{ slot: 'on', key: on, kind: 'flag', snap: false, sample: 1 }]
      if ([t.parts['switch.off'].fill, t.parts['switch.off'].stroke, t.parts['switch.on'].fill, ...(gradient ? [t.parts['switch.on'].stroke] : []),
        t.parts.knob.fill, t.parts.knob.stroke].includes('state')) slots.push({ slot: 'st', key: state.slice(1), kind: 'state', snap: true, sample: 1 })
      return { clicks, slots, nodes: [hit, ...tracks,
        partRect(t, 'knob', `=${num(tx + inset)}+${num(tw - th)}*${level}`, ty + inset, th - 2 * inset, th - 2 * inset,
          { tag: 'knob', state, extra: { rx: t.parts.knob.radius ?? (th - 2 * inset) / 2 } }),
        label(t, 'button-label', { x: x + pad, y, w: Math.max(0, tx - gap - x - pad), h }, literal(t, 'button-label', p.label), { fit: true, tag: 'label' })] }
    }
    const sw = t.metrics['toggle.stateW'], wx = x + w - pad - sw
    return { clicks, slots: [{ slot: 'on', key: on, kind: 'flag', snap: true, sample: 1 }], nodes: [hit, ring(t, x, y, w, h, `=$${on}`, 'ring'), body(t, 'secondary', x, y, w, h, 'body'),
      label(t, 'button-label', { x: x + pad, y, w: Math.max(0, w - 2 * pad - sw), h }, literal(t, 'button-label', p.label), { fit: true, tag: 'label' }),
      label(t, 'button-label', { x: wx, y, w: sw, h }, literal(t, 'button-label', p.offText), { tag: 'off', align: 'right', f: inkOf(t, 'unit'), v: `=eq($${on},0)` }),
      label(t, 'button-label', { x: wx, y, w: sw, h }, literal(t, 'button-label', p.onText), { tag: 'on', align: 'right', v: `=eq($${on},1)` })] }
  },
}
export default toggle
