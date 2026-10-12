// The frame's labels as DOM boxes over the canvas. Text goes in as a text node (textContent), never as HTML.
import { memo, useId, useSyncExternalStore } from 'react'
import type { FrameText } from '../runtime/frame'
import { fontStyle, fontsVersion, isKnownFont, subscribeFonts, textOutline } from './fonts'
import type { Scene } from '../model/scene'
import { previewFontWarning } from './fontWarnings'
import { pageFontsVersion, subscribePageFonts } from './pageFonts'
import type { Box } from './gl'
import { clipStyle, innerStyle, labelStyle, offSurface, sameLabel, stripRichText, textRuns, fontNames, labelFontKey } from './text'

// An inset text shadow (CSS has none): the shadow of the glyphs' inverse, offset and blurred, kept inside the glyphs.
// Its region is in the box's own px, with room for text past the box (nothing stops it under fit 0) and the shadow's
// offset and blur tails. ponytail: the text's reach is bounded by characters x size, not measured.
function Inset({ id, t, zoom }: { id: string; t: FrameText; zoom: number }) {
  const s = t.insetShadow!
  const reach = (stripRichText(t.text).length * t.size * Math.max(1, 1 + t.charSpacing * 0.01, t.lineHeight)
    + Math.abs(s[0]) + Math.abs(s[1]) + 3 * s[2]) * zoom
  return <filter id={id} filterUnits="userSpaceOnUse" x={-reach} y={-reach} width={t.w * zoom + 2 * reach} height={t.h * zoom + 2 * reach}>
    <feComponentTransfer in="SourceAlpha" result="hole"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
    <feGaussianBlur in="hole" stdDeviation={s[2] * zoom / 2} />
    <feOffset dx={s[0] * zoom} dy={s[1] * zoom} result="shade" />
    <feFlood floodColor={`rgb(${s.slice(3, 6).map(v => Math.round(v * 255)).join(',')})`} floodOpacity={s[6]} />
    <feComposite operator="in" in2="shade" />
    <feComposite operator="in" in2="SourceAlpha" result="inner" />
    <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="inner" /></feMerge>
  </filter>
}

// One label, rendered again only when it draws otherwise (a frame's labels are new objects every frame, most unchanged):
// its own values, the zoom, its filter or the faces the preview can draw (`fonts`, fontsVersion: labelStyle reads them).
// Each label is marked with its number: its outermost boxes `data-label` (where Canvas sets its place among the covers,
// zIndex), its label boxes `data-box` (what measure reads).
const Label = memo(function Label({ t, i, zoom, filter }: { t: FrameText; i: number; zoom: number; filter: string | null; fonts: string }) {
  const c = t.clip
  const style: Record<string, string | number> = { ...labelStyle(t, zoom), ...(c && { left: (t.x - c[0]) * zoom, top: (t.y - c[1]) * zoom }) }
  // The inner block carries the ellipsis (text-overflow does not reach text sitting directly in a flex box), or the
  // overflow of a centred or right-aligned line (innerStyle).
  const runs = textRuns(t), outlines = runs.map(r => textOutline(r.font, t.outlineWidth, t.size))
  const styles = runs.map(r => fontStyle(r.font, r.weight, r.italic, r.italicStyle, r.spacing, Math.max(1, t.size) / r.size, t.outlineWidth, t.size))
  const dilated = styles.some(s => parseFloat(s.WebkitTextStrokeWidth) > 0)
  const simple = runs.every(r => r.font === t.font && r.weight === (t.bold ? 700 : 400) && !r.italic && !r.trailing && r.size === Math.max(1, t.size) && r.spacing === t.charSpacing * 0.01)
  const outlined = (dilated || !simple) && t.outlineWidth > 0 && !!t.outlineColour
  const content = (outline = false) => simple && !outlined ? runs.map(r => r.text).join('') : runs.map((r, k) => <span key={k} style={{ ...styles[k], fontSize: r.size * zoom, ...(r.trailing && { display: 'inline-block', marginRight: r.trailing * zoom }),
    ...(outline && { WebkitTextStrokeWidth: `calc(${styles[k].WebkitTextStrokeWidth} + ${outlines[k].width * zoom}px)`, WebkitTextStrokeColor: `rgba(${t.outlineColour!.slice(0, 3).map(v => Math.round(v * 255)).join(',')},${t.outlineColour![3]})` }) }}>{r.text}</span>)
  const box = (s: Record<string, string | number>, hidden?: boolean, outline = false) =>
    <div style={s} aria-hidden={hidden} data-box={i} data-label={c ? undefined : i}><div style={innerStyle(t)}>{content(outline)}</div></div>
  let boxes = outlined ? <>{box({ ...style, color: 'transparent' }, true, true)}{box({ ...style, WebkitTextStroke: '0px' })}</> : box(style)
  if (filter) {
    // The game makes an inset from the glyphs alone (a stencil copy with no shadow or outline), so the filtered box
    // paints only the fill; the outset shadows and the outline go on a clear copy beneath it.
    const { textShadow, WebkitTextStroke, WebkitTextStrokeWidth, WebkitTextStrokeColor, paintOrder, ...plain } = style
    boxes = <>
      {(textShadow || WebkitTextStroke) && box({ ...style, color: 'transparent' }, true, outlined)}
      {box({ ...plain, ...(dilated && { WebkitTextStrokeWidth, WebkitTextStrokeColor, paintOrder }), filter: `url(#${filter})` })}
    </>
  }
  return c ? <div style={clipStyle(t, zoom)} data-label={i}>{boxes}</div> : boxes
}, (a, b) => a.i === b.i && a.zoom === b.zoom && a.filter === b.filter && a.fonts === b.fonts && sameLabel(a.t, b.t))

// Each text node is split by its DOM line rectangles before measuring ink: Canvas measures shaped runs, including
// kerning and combining marks. Removing the box transform for these reads keeps line breaks in its own axes.
function inkBoxes(e: HTMLElement, range: Range, g: CanvasRenderingContext2D, visit: (x: number, y: number) => void) {
  const transform = e.style.transform, m = new DOMMatrix(getComputedStyle(e).transform || undefined)
  e.style.transform = 'none'
  const runs = new Map(Array.from(e.querySelectorAll<HTMLElement>('span')).filter(s => !!s.style.transform).map(s => [s, { s, transform: s.style.transform, matrix: new DOMMatrix(s.style.transform) }]))
  for (const { s } of runs.values()) s.style.transform = 'none'
  try {
    const box = e.getBoundingClientRect(), cx = box.left + box.width / 2, cy = box.top + box.height / 2
    const point = (x: number, y: number) => { const p = m.transformPoint({ x: x - cx, y: y - cy }); visit(cx + p.x, cy + p.y) }
    const nodes = document.createTreeWalker(e, NodeFilter.SHOW_TEXT)
    for (let n = nodes.nextNode(); n; n = nodes.nextNode()) {
      const text = n as Text, s = getComputedStyle(text.parentElement!)
      const run = runs.get(text.parentElement!), r = run?.s.getBoundingClientRect()
      const inkPoint = (x: number, y: number) => {
        if (run && r) {
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2
          const p = run.matrix.transformPoint({ x: x - cx, y: y - cy })
          point(cx + p.x, cy + p.y)
        } else point(x, y)
      }
      g.font = `${s.fontStyle || 'normal'} ${s.fontWeight || 'normal'} ${s.fontSize} ${s.fontFamily}`
      g.fontKerning = s.fontKerning === 'none' ? 'none' : 'normal'
      g.letterSpacing = s.letterSpacing === 'normal' ? '0px' : s.letterSpacing
      g.direction = s.direction === 'rtl' ? 'rtl' : 'ltr'
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'
      let line = '', rect: DOMRect | null = null, offset = 0
      const finish = () => {
        if (!rect || !line) return
        const t = g.measureText(line), baseline = rect.top + t.fontBoundingBoxAscent
        const stroke = Math.max(0, parseFloat(s.getPropertyValue('-webkit-text-stroke-width')) || 0) / 2
        const x0 = rect.left - Math.max(0, t.actualBoundingBoxLeft) - stroke, x1 = rect.right + Math.max(0, t.actualBoundingBoxRight - t.width) + stroke
        const y0 = baseline - t.actualBoundingBoxAscent - stroke, y1 = baseline + t.actualBoundingBoxDescent + stroke
        if ([x0, x1, y0, y1].every(Number.isFinite)) for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) inkPoint(x, y)
      }
      range.selectNodeContents(text)
      const rects = range.getClientRects()
      if (rects.length === 1 && !/[\r\n]/.test(text.data)) { line = text.data; rect = rects[0]; finish(); continue }
      for (const char of text.data) {
        range.setStart(text, offset); offset += char.length; range.setEnd(text, offset)
        const r = range.getBoundingClientRect()
        const newline = char === '\n' || char === '\r'
        if (newline || rect && (r.top !== rect.top || r.bottom !== rect.bottom)) { finish(); line = ''; rect = null }
        if (newline) continue
        line += char
        rect = rect ? DOMRect.fromRect({ x: Math.min(rect.left, r.left), y: r.top, width: Math.max(rect.right, r.right) - Math.min(rect.left, r.left), height: r.height }) : r
      }
      finish()
    }
  } finally { e.style.transform = transform; for (const r of runs.values()) r.s.style.transform = r.transform }
}

/**
 * Each label's box and text as laid out in `root` (a text layer), in surface px at `zoom` CSS px per surface px, by the
 * label's number: the box turned as drawn, and its text wherever it runs (past the box under fit 0). Not its shadows or
 * outline except a CSS stroke's ink. None for a label not laid out. Unchanged labels reuse `previous` when `changed` is supplied.
 */
export function measure(root: HTMLElement, zoom: number, previous: readonly (Box | null)[] = [], changed?: ReadonlySet<number>): (Box | null)[] {
  const out: (Box | null)[] = [], range = document.createRange()
  let origin: DOMRect | undefined
  if (!(zoom > 0)) return out
  const g = document.createElement('canvas').getContext('2d')
  root.querySelectorAll<HTMLElement>('[data-box]').forEach(e => {
    const k = +e.dataset.box!
    if (changed && !changed.has(k) && previous[k]) { out[k] = previous[k]; return }
    const o = origin ??= root.getBoundingClientRect()
    range.selectNode(e)   // the box itself, and every text node in it
    const r = range.getBoundingClientRect(), b = out[k]
    if (!(r.width > 0 || r.height > 0)) return
    let x0 = (r.left - o.left) / zoom, y0 = (r.top - o.top) / zoom, x1 = (r.right - o.left) / zoom, y1 = (r.bottom - o.top) / zoom
    if (g && e.style.overflow !== 'hidden') inkBoxes(e, range, g, (x, y) => {
      x0 = Math.min(x0, (x - o.left) / zoom); y0 = Math.min(y0, (y - o.top) / zoom)
      x1 = Math.max(x1, (x - o.left) / zoom); y1 = Math.max(y1, (y - o.top) / zoom)
    })
    out[k] = b ? { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) } : { x0, y0, x1, y1 }
  })
  return out
}

/**
 * `labels` already finite (drawable). Renders again when the list, the zoom, the surface size or the imported fonts
 * change, and then each label only if it draws otherwise (Label's memo); a label that surely draws nothing on the
 * `size` surface (offSurface) is not laid out at all. Every label is kept: none is refused (M2b ruling 16). It names the
 * faces it cannot draw (they fall back to the default face; the scene and the export keep the names).
 */
export const TextLayer = memo(function TextLayer({ labels, zoom, size, scene }: { labels: FrameText[]; zoom: number; size?: { w: number; h: number }; scene?: Scene }) {
  const id = useId()
  useSyncExternalStore(subscribeFonts, fontsVersion, fontsVersion)   // an import redraws a label in its face and drops its note
  useSyncExternalStore(subscribePageFonts, pageFontsVersion, pageFontsVersion)
  const filter = (t: FrameText, i: number) => t.insetShadow ? `${id}${i}` : null
  const unknown = (f: string | null): f is string => !!f && !isKnownFont(f)
  const missing = [...new Set(labels.map(t => t.font).filter(unknown))]
  const tags = [...new Set(labels.flatMap(t => fontNames(t.text)).filter(unknown))]
  const outlineWarnings = labels.flatMap((t, i) => t.outlineWidth > 0 && t.outlineColour
    ? [...new Set(textRuns(t).map(r => textOutline(r.font, t.outlineWidth, t.size).warning).filter(Boolean))].map(w => `Label ${i + 1}: ${w}.`) : [])
  const warning = [previewFontWarning(scene, missing, tags), ...outlineWarnings].filter(Boolean).join(' ')
  const shown = (t: FrameText) => !size || !offSurface(t, size)
  return <>
    {labels.some(t => t.insetShadow && shown(t)) && <svg width="0" height="0" style={{ position: 'absolute' }}>
      {labels.map((t, i) => t.insetShadow && shown(t) && <Inset key={i} id={filter(t, i)!} t={t} zoom={zoom} />)}
    </svg>}
    {labels.map((t, i) => shown(t) && <Label key={i} t={t} i={i} zoom={zoom} filter={filter(t, i)} fonts={labelFontKey(t)} />)}
    {warning && <div role="status" className="vb-font-missing">{warning}</div>}
  </>
})
