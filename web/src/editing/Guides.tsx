// Snap guides: a thin line through each matched coordinate, spanning both boxes it joins (snap.ts Guide), in CSS px.
// Styled in app.css (.vb-guides), like the selection overlay; it never takes the pointer.
import type { Guide } from './snap'

export function Guides({ guides, css }: { guides: readonly Guide[]; css: (u: { x: number; y: number }) => { x: number; y: number } }) {
  if (!guides.length) return null
  return <svg className="vb-guides" aria-hidden="true">
    {guides.map(g => {
      const a = css(g.axis === 'x' ? { x: g.at, y: g.from } : { x: g.from, y: g.at })
      const b = css(g.axis === 'x' ? { x: g.at, y: g.to } : { x: g.to, y: g.at })
      return <line key={`${g.axis}${g.at}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
    })}
  </svg>
}
