// How one TextMeshPro label of a frame reads as a DOM box (spec §7). Pure, for TextLayer.
import type { FrameText } from '../runtime/frame'
import { BUNDLED, DEFAULT_FACE, fontStyle, fontVersion, isKnownFont, styleName, textOutline } from './fonts'

// TMP's rich-text tags, and its <#RRGGBB> colour shorthand. A '<' that opens none of them is text.
const TAG = /<\/?(?:#[0-9a-f]{3,8}|(?:align|allcaps|alpha|b|br|color|cspace|font|font-weight|gradient|i|indent|line-height|line-indent|link|lowercase|margin|margin-left|margin-right|mark|mspace|nobr|noparse|page|pos|rotate|s|size|smallcaps|space|sprite|strikethrough|style|sub|sup|u|uppercase|voffset|width)(?:[= ][^<>]*)?)>/gi

/** Face names in TMP font tags, including an optional material attribute after the name. */
export const fontNames = (text: string) => [...text.matchAll(/<font\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+))[^<>]*>/gi)].map(m => m[1] ?? m[2] ?? m[3])

/** The drawn text: resolved TMP tags removed, unknown font tags literal, br as a newline. */
export const stripRichText = (s: string) => textRuns({ text: s, font: null, bold: false }).map(r => r.text).join('')

/** Font-related TMP tags as plain-text runs. Other tags keep the preview's existing stripping behaviour. */
export function textRuns(t: Pick<FrameText, 'text' | 'font' | 'bold'> & Partial<Pick<FrameText, 'size' | 'charSpacing'>>): { text: string; font: string | null; weight: number; italic: boolean; italicStyle?: number; size: number; spacing: number; trailing?: number }[] {
  const fonts = [t.font], weights: (number | null)[] = [t.bold ? 700 : null], italics = [false], angles: (number | undefined)[] = [undefined], resolved: boolean[] = []
  const sizes = [Math.max(1, t.size ?? 12)], spaces = [0], resolvedSpaces: boolean[] = []
  const out: { text: string; font: string | null; weight: number; italic: boolean; italicStyle?: number; size: number; spacing: number; trailing?: number }[] = []
  const add = (text: string) => { if (text) out.push({ text, font: fonts.at(-1)!, weight: weights.at(-1) ?? 400, italic: italics.at(-1)!, italicStyle: angles.at(-1)!, size: sizes.at(-1)!, spacing: ((t.charSpacing ?? 0) * 0.01 * sizes[0] + spaces.at(-1)!) / sizes.at(-1)! }) }
  const text = t.text.replace(/<br\s*\/?>/gi, '\n')
  let at = 0
  for (const m of text.matchAll(TAG)) {
    add(text.slice(at, m.index)); at = m.index + m[0].length
    const tag = /^<(\/?)(b|i|font|font-weight|size|cspace)(?:\s*=\s*(.*?))?>$/i.exec(m[0])
    if (!tag) continue
    const close = !!tag[1], key = tag[2].toLowerCase(), value = tag[3]?.match(/^(['"])(.*?)\1/)?.[2] ?? tag[3]
    if (key === 'font') {
      if (close) { if (resolved.pop()) fonts.pop(); else add(m[0]) }
      else {
        const known = !!value && (BUNDLED.includes(value) || isKnownFont(value))
        resolved.push(known)
        if (known) fonts.push(value!); else add(m[0])
      }
    }
    else if (key === 'size' || key === 'cspace') {
      const stack = key === 'size' ? sizes : spaces
      if (close) {
        if (key === 'cspace' && !resolvedSpaces.pop()) { add(m[0]); continue }
        if (stack.length > 1) {
          if (key === 'cspace' && out.length) out.at(-1)!.trailing = -spaces.at(-1)!
          stack.pop()
        }
      } else {
        const number = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([e%p ]|$)/.exec(value ?? '')
        const n = Number(number?.[1]), unit = number?.[2], base = key === 'size' ? sizes[0] : sizes.at(-1)!
        const valid = !!number && Number.isFinite(n) && !(key === 'cspace' && unit === '%')
        if (key === 'cspace') resolvedSpaces.push(valid)
        if (!valid) { add(m[0]); if (key === 'size') stack.push(stack.at(-1)!); continue }
        const v = unit === '%' ? n * base / 100 : unit === 'e' ? n * base : key === 'size' && /^[+-]/.test(value!) ? base + n : n
        stack.push(key === 'size' ? Math.max(1, v) : v)
      }
    }
    else if (key === 'i') {
      if (close) { if (italics.length > 1) { italics.pop(); angles.pop() } }
      else {
        const angle = value?.trim() ? Number(value) : NaN, valid = value === undefined || Number.isFinite(angle)
        italics.push(valid ? true : italics.at(-1)!); angles.push(valid ? Number.isFinite(angle) ? Math.max(-180, Math.min(180, angle)) : undefined : angles.at(-1))
      }
    }
    else { if (close) { if (weights.length > 1) weights.pop() } else weights.push(key === 'b' ? 700 : value?.trim() && Number.isFinite(Number(value)) ? Number(value) : weights.at(-1)!) }
  }
  add(text.slice(at))
  return out
}

/** Faces that can change a label's layout: its fallback, attribute, tags and requested weight/italic slots. */
export const labelFonts = (t: FrameText) => [...new Set([DEFAULT_FACE, t.font || DEFAULT_FACE, ...fontNames(t.text),
  ...textRuns(t).flatMap(r => [r.font || DEFAULT_FACE, styleName(r.font, r.weight, r.italic)])].filter(Boolean))]
export const labelFontKey = (t: FrameText, loaded: ReadonlyMap<string, number> = new Map()) =>
  labelFonts(t).map(f => fontVersion(f) + ':' + (loaded.get(f) ?? 0)).join(',')

/** False for a label a script made non-finite (the frame carries NaN/Infinity): it is skipped, not drawn. Every other label
 *  is drawn, however many (no cap of our own, M2b ruling 16). */
export const drawable = (t: FrameText) => [t.x, t.y, t.w, t.h, t.size, ...(t.clip ?? []), ...(t.clipPolygon ?? []), ...(t.shear ?? []),
  ...(t.shadow ?? []), ...(t.extraShadows ?? []), ...(t.insetShadow ?? [])].every(Number.isFinite)

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => Object.is(v, b[i])) : Object.is(a, b)

/** True when two labels would draw the same. */
export const sameLabel = (a: FrameText, b: FrameText) => (Object.keys(a) as (keyof FrameText)[]).every(k => same(a[k], b[k]))
/** True when a label's DOM layout and glyph ink stay the same; colour, cover order and shadows need no new measure. */
export const sameLayout = (a: FrameText, b: FrameText) => (['text', 'x', 'y', 'w', 'h', 'size', 'align', 'valign', 'font', 'bold',
  'charSpacing', 'fit', 'minSize', 'rotation', 'wrap', 'lineHeight', 'clip', 'kern', 'shear', 'outlineWidth'] as const).every(k => same(a[k], b[k]))
/** True when two frames' labels would draw the same, so the text layer need not render again. */
export const sameLabels = (a: FrameText[], b: FrameText[]) => a.length === b.length && a.every((t, i) => sameLabel(t, b[i]))
/**
 * Whether a label surely draws nothing on a `size` surface (surface px): every point it may ink lies off it, and the
 * surface clips its text (.vb-text). The reach is generous rather than measured: the box's half diagonal (any rotation
 * about its centre), plus twice its characters at its size (text past the box under fit 0, wrapped lines), plus its
 * shadows' offsets and blurs and its outline. A sheared label is never left out (its slant has no bound here).
 */
export function offSurface(t: FrameText, size: { w: number; h: number }): boolean {
  if (t.shear) return false
  const chars = stripRichText(t.text).length + 1
  const shadows = [...(t.shadow ? [t.shadow] : []), ...chunks(t.extraShadows ?? [], 7), ...(t.insetShadow ? [t.insetShadow] : [])]
  const reach = Math.hypot(t.w, t.h) / 2 + 2 * chars * Math.max(1, t.size) * Math.max(1, 1 + t.charSpacing * 0.01, t.lineHeight)
    + shadows.reduce((r, s) => r + Math.abs(s[0]) + Math.abs(s[1]) + 3 * Math.abs(s[2]), 0) + Math.max(0, t.outlineWidth)
  const cx = t.x + t.w / 2, cy = t.y + t.h / 2
  return cx + reach < 0 || cx - reach > size.w || cy + reach < 0 || cy - reach > size.h
}

const ALIGN = ['left', 'center', 'right', 'justify']
const VALIGN = ['flex-start', 'center', 'flex-end']
const rgba = (c: number[]) => `rgba(${c.slice(0, 3).map(v => Math.round(v * 255)).join(',')},${c[3]})`
/** A flat array as n-tuples. */
export const chunks = (a: number[], n: number) => Array.from({ length: Math.floor(a.length / n) }, (_, k) => a.slice(k * n, k * n + n))
/** One shadow (dx, dy, blur, r, g, b, a) as a CSS text-shadow entry. */
const css = (s: number[], zoom: number) => `${s[0] * zoom}px ${s[1] * zoom}px ${s[2] * zoom}px ${rgba(s.slice(3))}`

/** The label's shear as CSS's matrix(a, b, c, d): it acts in the label's own space (+y up), so y is flipped. */
export const shearMatrix = (t: FrameText) => t.shear && [t.shear[0], -t.shear[2], -t.shear[1], t.shear[3]]

/** A surface px vector (y down) in the label box's own axes: back through its rotation (about the centre), then its shear. */
export function toLabel(t: FrameText, x: number, y: number): [number, number] {
  const r = t.rotation * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), u = x * c - y * s, v = x * s + y * c
  const m = shearMatrix(t)
  if (!m) return [u, v]
  const [a, b, cc, d] = m, det = a * d - b * cc
  return [(d * u - cc * v) / det, (a * v - b * u) / det]
}

/**
 * The inner block's style. With fit 1 it carries the ellipsis (on one line: nothing wraps unless `wrap` is set). A centred
 * or right-aligned label under fit 0 whose text outgrows its box overflows both ways or to the left, as TMP lays it out;
 * CSS would push it out to the right, so the inner block becomes a flex row aligned that way (each line keeps its own
 * alignment inside it). Wrapped text and fit 2 stay as they were (M2a ruling 9; no widget uses either).
 */
export const innerStyle = (t: FrameText): Record<string, string> =>
  t.fit === 0 && !t.wrap && (t.align === 1 || t.align === 2)
    ? { display: 'flex', justifyContent: t.align === 1 ? 'center' : 'flex-end' }
    : { overflow: 'inherit', textOverflow: 'inherit' }

/** CSS for one label box, in CSS px at `zoom` CSS px per surface px. Rotation is about the box centre. */
export function labelStyle(t: FrameText, zoom: number): Record<string, string | number> {
  const m = shearMatrix(t)
  const s: Record<string, string | number> = {
    position: 'absolute', left: t.x * zoom, top: t.y * zoom, width: t.w * zoom, height: t.h * zoom,
    display: 'flex', flexDirection: 'column', justifyContent: VALIGN[t.valign] ?? 'flex-start',
    // The game's degrees are counter-clockwise, y up. The shear goes on the letters under the rotation.
    transform: `rotate(${-t.rotation}deg)` + (m ? ` matrix(${m.join(', ')}, 0, 0)` : ''),
    ...fontStyle(t.font, t.bold ? 700 : undefined, false, undefined, t.charSpacing * 0.01, 1, t.outlineWidth, t.size),
    fontSize: Math.max(1, t.size) * zoom,  // fit 2 (shrink to MinSize) is approximated with Size
    color: rgba(t.colour),
    textAlign: ALIGN[t.align] ?? 'left',
    whiteSpace: t.wrap ? 'pre-wrap' : 'pre',  // without wrap, one line; explicit newlines still break
    fontKerning: t.kern ? 'normal' : 'none',
    overflow: t.fit === 1 ? 'hidden' : 'visible',
  }
  if (t.fit === 1) s.textOverflow = 'ellipsis'
  if (t.lineHeight > 0.01) s.lineHeight = t.lineHeight
  // The game moves each later shadow's copy along the surface axes, so its offset is turned back into the box's; the
  // first is the label's own underlay and turns with it. (A first shadow too large for the font's SDF padding is cast on
  // a moved copy too; which ones are depends on the font's metrics, which the preview does not have.)
  const extras = chunks(t.extraShadows ?? [], 7).map(x => [...toLabel(t, x[0], x[1]), ...x.slice(2)])
  const shadows = [...(t.shadow ? [t.shadow] : []), ...extras]
  if (shadows.length) s.textShadow = shadows.map(x => css(x, zoom)).join(', ')  // the first listed is drawn on top, as the game stacks them
  if (t.outlineWidth > 0 && t.outlineColour) {
    s.WebkitTextStroke = `${textOutline(t.font, t.outlineWidth, t.size).width * zoom}px ${rgba(t.outlineColour)}`
    s.paintOrder = 'stroke fill'
  }
  return s
}

/** The clip box's style: the label's clip rect, cut to its polygon when the clip is not a box. */
export function clipStyle(t: FrameText, zoom: number): Record<string, string | number> {
  const c = t.clip!
  const s: Record<string, string | number> = { position: 'absolute', left: c[0] * zoom, top: c[1] * zoom, width: c[2] * zoom, height: c[3] * zoom, overflow: 'hidden' }
  if (t.clipPolygon) s.clipPath = `polygon(${chunks(t.clipPolygon, 2).map(([x, y]) => `${(x - c[0]) * zoom}px ${(y - c[1]) * zoom}px`).join(', ')})`
  return s
}
