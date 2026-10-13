// The page's native elements (Q10) as placeholders over the canvas: the game draws the real icon and text input. A press on
// one reaches the active canvas tool. Keyboard activation selects it. Project text renders as text only.
import type { Page } from '../model/project'
import type { Theme } from '../theme/types'
import { drawOrder, shownNatives } from '../editing/natives'
import { apply, viewbox } from './geometry'

// The placeholder's 12 px sans-serif text width, measured where a canvas can (else 7.2 px a character).
const pen = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
if (pen) pen.font = '12px sans-serif'
const textWidth = (s: string) => pen?.measureText(s).width || 7.2 * s.length

export function NativeLayer({ page, theme, zoom, selected, onSelect }: { page: Page; theme: Theme; zoom: number; selected?: ReadonlySet<string>; onSelect: (uid: string) => void }) {
  const m = viewbox(page.scene.header, page.size)   // design units to surface px, by the header's fit, as the shell places them
  const shown = new Map(shownNatives(page, theme).map(n => [n.uid, n.el]))
  return <>{drawOrder(page.natives ?? [], theme).flatMap(({ uid }) => {
    const el = shown.get(uid)
    if (!el) return []
    const [x0, y0] = apply(m, el.box.x, el.box.y), [x1, y1] = apply(m, el.box.x + el.box.w, el.box.y + el.box.h)
    const text = el.type === 'icon' ? String(el.props.name) : String(el.props.value || el.props.placeholder), w = (x1 - x0) * zoom
    // An icon's name stays whole on one line: at most 12 px, smaller when the box is narrower (less its 1 px borders,
    // 6 px padding a side and 1 px to spare; measured in the browser 2026-10-13, 15 px less still overflowed by the borders).
    const fit = el.type === 'icon' ? { fontSize: Math.max(1, Math.min(12, 12 * (w - 15) / Math.max(1, textWidth(text)))) } : undefined
    return <div key={uid} role="button" aria-label={`${el.type} ${uid}`} className={selected?.has(uid) ? 'vb-native vb-native-sel' : 'vb-native'}
      style={{ pointerEvents: 'none', left: x0 * zoom, top: y0 * zoom, width: w, height: (y1 - y0) * zoom, background: el.style.bg,
        color: el.props.value ? el.style.text : el.style.placeholder_color, fontSize: el.fontSize && el.fontSize * m[3] * zoom, ...fit }}
      tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(uid) } }}>{text}</div>
  })}</>
}
