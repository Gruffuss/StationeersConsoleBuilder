// Vector glyph: a square cog with a transparent hole, arrow, check or cross. No click: put a Button under it.
import type { SrcNode } from '../../model/scene'
import { colour, ROLES } from '../../theme'
import type { Theme } from '../../theme/types'
import { box, el, num, tag } from '../paint'
import type { WidgetModule } from '../types'
import { ornaments } from '../dress'

type P = { x: number; y: number; w: number; h: number; glyph: string; dir: string; ink: string; hole?: string }
function draw(p: P, t: Theme): SrcNode[] {
  const s = p.w, { x, y } = p, cx = x + s / 2, cy = y + s / 2, e = x + s, b = y + s, f = colour(t, p.ink)
  if (p.glyph === 'cog') {
    const r = s / 2 / 1.34   // cog teeth reach 1.34 r
    return [el('G', { t: [cx, cy] }, [
      el('RP', { n: 8 }, [el('G', { r: '=i*45' }, [tag('tooth', el('R', { x: -0.17 * r, y: -1.34 * r, w: 0.34 * r, h: 0.52 * r, rx: 0.08 * r, f }))])]),
      ...(p.hole ? [tag('disc', el('C', { cx: 0, cy: 0, rx: r, ry: r, f })),
        tag('hole', el('C', { cx: 0, cy: 0, rx: 0.4*r, ry: 0.4*r, f: colour(t, p.hole) }))]
        : [tag('disc', el('P', { d: [r, 0.4 * r].map(v => `M${num(v)} 0 A${num(v)} ${num(v)} 0 1 0 ${num(-v)} 0 A${num(v)} ${num(v)} 0 1 0 ${num(v)} 0 Z`).join(' '), fr: 'evenodd', f }))])])]
  }
  if (p.glyph === 'arrow') {
    const pts: Record<string, number[]> = { right: [x, y, e, cy, x, b], left: [e, y, x, cy, e, b], up: [cx, y, e, b, x, b], down: [x, y, e, y, cx, b] }
    return [tag('arrow', el('Y', { p: pts[p.dir], f }))]
  }
  const sw = s / 8
  if (p.glyph === 'check') return [tag('line', el('L', { p: [x + 0.15 * s, y + 0.55 * s, x + 0.4 * s, y + 0.8 * s, x + 0.85 * s, y + 0.2 * s], s: f, sw, cap: 'round', join: 'round' }))]
  const a = 0.2 * s, z = 0.8 * s
  return [tag('line.1', el('L', { p: [x + a, y + a, x + z, y + z], s: f, sw, cap: 'round' })), tag('line.2', el('L', { p: [x + z, y + a, x + a, y + z], s: f, sw, cap: 'round' }))]
}
const glyph: WidgetModule<P> = {
  type: 'glyph', label: 'Vector glyph', group: 'icons', prefix: 'gl', resize: 'none',
  params: [...box(), { key: 'glyph', type: 'enum', enum: ['cog', 'arrow', 'check', 'cross'] }, { key: 'dir', type: 'enum', enum: ['right', 'left', 'up', 'down'] },
    { key: 'ink', type: 'enum', enum: ROLES, tokens: true }],
  defaults: () => ({ x: 24, y: 24, w: 18.2, h: 18.2, glyph: 'cog', dir: 'right', ink: 'text-secondary' }),   // 18.2: button-label's cap height
  fix: p => ({ ...p, h: p.w }),
  migrate: (raw, p, t) => Object.hasOwn(raw, 'hole') && typeof raw.hole === 'string' && Object.hasOwn(t.colors, raw.hole) ? { ...p, hole: raw.hole } : p,
  expand(p, t) {
    const { under, over, notes } = ornaments(t, 'glyph', { x: p.x, y: p.y, w: p.w, h: p.w })
    for (const n of [...under,...over]) tag('glyph', n)
    return { slots: [], nodes: [...under,...draw(p, t),...over], ...(notes.length ? { notes } : {}) }
  },
}
export default glyph
