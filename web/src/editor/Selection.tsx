// The selected node's dashed outline over the canvas, and its handles when the select tool shows them (one node). A node
// with a handle box (a literal box; a G: its children's in its own frame) is outlined by it through its chain: current
// while a drag runs, and drawn even while a structural edit waits for its check (no parse index needed). A T under a shear
// keeps the label boxes TextLayer draws; a node without a literal box keeps the bounds of its spans. A node a move
// moves nothing of (every axis an expression, no position of its own) shows a padlock with the reason; one under # lock shows no handles (a press on them
// only says 'locked'). Spans, parse indices and handles are root-only.
import { SCENE_ELEMENT } from '../codegen/lua'
import { similar } from '../editing/bounds'
import { handleFrame, nativeHandleFrame } from '../editing/select'
import { stays } from '../editing/transform'
import { lockedAt } from '../editing/tree'
import type { Scene } from '../model/scene'
import { nodeAt, type Selection as Selected } from '../model/store'
import type { Frame } from '../runtime/frame'
import { foldKey } from '../srctext/props'
import { apply, chainTo, type Box, type Handle } from './geometry'
import { Handles } from './Handles'
import { spanBounds } from './hitTest'
import { drawable, shearMatrix } from './text'
import type { Theme } from '../theme'
import type { NativeRef } from '../widgets/types'

/** `selection` on the page shown, or null; `node` its parse index (from the scene check), or null while a structural
 *  edit waits for its check. `rect`: the page's surface size. `handles`: draw them. `widget`: the selected widget root's
 *  box and handles (widgetBox). */
export function Selection({ frame, zoom, scene, selection, node, rect, handles, widget, natives = [], theme = null }: {
  frame: Frame | null; zoom: number; scene: Scene; selection: Selected | null; node: number | null; rect: { w: number; h: number }; handles: boolean
  widget?: { box: Box; handles: Handle[] } | null
  natives?: NativeRef[]; theme?: Theme | null
}) {
  if (!frame || !selection || selection.inDefs) return null
  const element = frame.elements.findIndex(e => e.id === SCENE_ELEMENT && e.scene === selection.pageId)
  if (selection.native !== undefined) {
    const f = element < 0 ? null : nativeHandleFrame(scene, natives, selection.native, rect, theme)
    if (!f) return null
    const points = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => apply(f.chain, f.box.x + f.box.w * u, f.box.y + f.box.h * v))
      .map(([x, y]) => `${x * zoom},${y * zoom}`).join(' ')
    return <svg className="vb-selection" aria-hidden="true"><g><polygon points={points} className="vb-sel-under" /><polygon points={points} className="vb-sel-over" /></g>
      {handles && !f.locked && <Handles box={f.box} chain={f.chain} zoom={zoom} within={rect} />}</svg>
  }
  if (widget) {   // The params box through the widget's root rotation, with its module's resize handles and a knob.
    const chain = element < 0 ? null : chainTo(scene, [...selection.path, 0], rect)
    if (!chain) return null
    const points = [[0, 0], [1, 0], [1, 1], [0, 1]]
      .map(([u, v]) => apply(chain, widget.box.x + widget.box.w * u, widget.box.y + widget.box.h * v))
      .map(([x, y]) => `${x * zoom},${y * zoom}`).join(' ')
    return <svg className="vb-selection" aria-hidden="true">
      <g><polygon points={points} className="vb-sel-under" /><polygon points={points} className="vb-sel-over" /></g>
      {handles && !lockedAt(scene.root, selection.path)
        && <Handles box={widget.box} chain={chain} zoom={zoom} only={widget.handles} rotate within={rect} />}
    </svg>
  }
  const n = nodeAt(scene.root, selection.path)
  if (element < 0 || !n) return null
  const box = (key: number, x: number, y: number, w: number, h: number, turn = 0, shear: number[] | null = null) => {
    const cx = (x + w / 2) * zoom, cy = (y + h / 2) * zoom
    const transform = [turn ? `rotate(${-turn} ${cx} ${cy})` : '',
      shear ? `translate(${cx} ${cy}) matrix(${shear.join(' ')} 0 0) translate(${-cx} ${-cy})` : ''].filter(Boolean).join(' ')
    const at = { x: x * zoom, y: y * zoom, width: w * zoom, height: h * zoom, transform: transform || undefined }
    return <g key={key}><rect {...at} className="vb-sel-under" /><rect {...at} className="vb-sel-over" /></g>
  }
  const hf = handleFrame(scene, selection.path, rect, natives.length ? theme : null, natives), lock = stays(n)
  // A T under a similarity chain: its attribute box is exact (and current during a drag); under a shear, the label as
  // TextLayer draws it (ruling P8).
  const plain = foldKey(n.op) === 'T' && hf !== null && similar(hf.chain)
  const labels = node === null || plain ? [] : frame.text.filter(drawable).filter(t => t.element === element && t.node === node)
  const corners = hf && !labels.length ? [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => apply(hf.chain, hf.box.x + hf.box.w * u, hf.box.y + hf.box.h * v)) : null
  const points = corners && corners.map(([x, y]) => `${x * zoom},${y * zoom}`).join(' ')
  const b = corners || labels.length || node === null ? null : spanBounds(frame, element, node)
  if (!corners && !labels.length && !b) return null
  const at = corners ? corners[0] : labels.length ? [labels[0].x, labels[0].y] : b && [b.x0, b.y0]
  return <svg className="vb-selection" aria-hidden="true">
    {points && <g><polygon points={points} className="vb-sel-under" /><polygon points={points} className="vb-sel-over" /></g>}
    {labels.map((t, k) => box(k, t.x, t.y, t.w, t.h, t.rotation, shearMatrix(t)))}
    {b && box(0, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)}
    {handles && hf && !lockedAt(scene.root, selection.path)
      && <Handles box={hf.box} chain={hf.chain} zoom={zoom} only={hf.resize ? undefined : []} rotate={hf.rotate} within={rect} />}
    {lock && at && <g className="vb-lock" transform={`translate(${at[0] * zoom - 6} ${at[1] * zoom - 10})`}>
      <title>{lock}</title><path d="M-3 0v-3a3 3 0 0 1 6 0v3" /><rect x={-5} y={0} width={10} height={8} rx={1} />
    </g>}
  </svg>
}
