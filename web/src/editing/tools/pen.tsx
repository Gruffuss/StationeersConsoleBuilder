import { round } from '../../editor/geometry'
import { flattenPath, printPath, type PathSeg } from '../../srctext/path'
import { canvasTargets } from '../select'
import { dressed, drawingFrame, newNode } from '../draw'
import { SLOP, snapOn, snapOpts } from '../gesture'
import { noteCrossing } from '../points'
import { snapPoint, targetsOf } from '../snap'
import type { Pt, Tool } from '../types'

type Anchor = { at: Pt; incoming?: Pt; outgoing?: Pt }
const xy = (p: Pt) => [round(p.x), round(p.y)]
function data(pts: Anchor[], close: boolean, local: (p: Pt) => Pt = p => p): string {
  const segs: PathSeg[] = [{ cmd: 'M', args: xy(local(pts[0].at)) }]
  const edge = (a: Anchor, b: Anchor) => segs.push(a.outgoing || b.incoming
    ? { cmd: 'C', args: [...xy(local(a.outgoing ?? a.at)), ...xy(local(b.incoming ?? b.at)), ...xy(local(b.at))] }
    : { cmd: 'L', args: xy(local(b.at)) })
  for (let i = 1; i < pts.length; i++) edge(pts[i-1], pts[i])
  if (close) { if (pts[pts.length-1].outgoing || pts[0].incoming) edge(pts[pts.length-1], pts[0]); segs.push({ cmd: 'Z', args: [] }) }
  return printPath(segs)
}

const pen: Tool = {
  kind: 'tool', id: 'pen', label: 'Pen', key: 'B', order: 15,
  down(p, ctx) {
    const frame = drawingFrame(ctx, p.at)
    if (!frame) return null
    const page = ctx.page(), theme = ctx.theme(), defaults = ctx.drawDefaults()
    const seen = targetsOf(canvasTargets(page, theme), ctx.view().size)
    const snap = (at: Pt, mods: typeof p.mods) => snapOn(ctx, mods) ? snapPoint(at, seen, snapOpts(ctx)).p : at
    const pts: Anchor[] = [{ at: snap(p.at, p.mods) }]
    let held = true, done = false, band: Pt | null = null
    const changed = () => ctx.page().id !== page.id || ctx.page().scene !== page.scene
    const abandoned = () => ctx.note('scene changed; pen gesture not applied')
    const finish = (close: boolean): 'done' => {
      if (done) return 'done'
      done = true
      if (changed()) abandoned()
      else if (pts.length >= 2) {
        const d = data(pts, close, frame.local)
        const n = dressed(newNode('P', { d }, {}), close ? 'Pclosed' : 'P', theme, defaults)
        const edit = frame.insert(page.scene, n)
        if (edit) void ctx.apply(edit, { check: true }).then(why => {
          const selected = edit.selection?.at(-1)
          if (!why && selected && ctx.page().id === page.id) noteCrossing(ctx, selected.path)
        })
      }
      ctx.setTool('select')
      return 'done'
    }
    return {
      move(q) {
        if (done) return
        if (held && q.css >= SLOP) {
          const a = pts[pts.length-1], to = snap(q.at, q.mods)
          a.outgoing = to; a.incoming = { x: 2*a.at.x-to.x, y: 2*a.at.y-to.y }
        } else if (!held) band = snap(q.at, q.mods)
        ctx.redraw()
      },
      up() { held = false; return !done },
      down(q) {
        if (done) return
        if (pts.length >= 2 && Math.hypot(q.at.x-pts[0].at.x, q.at.y-pts[0].at.y) <= ctx.view().threshold) { finish(true); return }
        pts.push({ at: snap(q.at, q.mods) }); held = true; band = null; ctx.redraw()
      },
      key(key) {
        if (key === 'Enter') return finish(false)
        if (key !== 'Backspace') return false
        pts.pop(); band = null
        if (!pts.length) return finish(false)
        ctx.redraw(); return true
      },
      cancel() { if (!done && changed()) abandoned(); done = true },
      overlay(o) {
        if (done) return null
        const preview = band ? [...pts, { at: band }] : pts
        const flat = flattenPath(data(preview, false)) ?? []
        const css = (v: Pt) => o.view.css(v)
        return <svg className="vb-band" aria-hidden="true">
          {flat.map((list, k) => <polyline key={k} points={list.flatMap((v, i) => i%2 ? [] : [css({ x: v, y: list[i+1] })]).map(v => `${v.x},${v.y}`).join(' ')} />)}
          {pts.map((a, k) => { const at = css(a.at); return <g key={k}>
            <circle cx={at.x} cy={at.y} r={4} />
            {[a.incoming, a.outgoing].map((h, j) => { if (!h) return null; const to = css(h); return <g key={j}><line stroke="#ffd166" x1={at.x} y1={at.y} x2={to.x} y2={to.y} /><circle cx={to.x} cy={to.y} r={3} /></g> })}
          </g> })}
        </svg>
      },
    }
  },
}
export default pen
