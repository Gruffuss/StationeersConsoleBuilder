import type { Corners, Edge, Frame, Look, Ornament, PaintPart, Point } from '../types'
import { readBorder, readDeclaration, readLength, readRadii } from './css'
import { splitCss } from './types'

const add = (a: Edge, b: Edge): Edge => [a[0]+b[0],a[1]+b[1]]
const subtract = (a: Edge, b: Edge): Edge => [a[0]-b[0],a[1]-b[1]]
const end = (a: Edge): Edge => subtract([1,0],a)
function edge(text: string): Edge | undefined {
  const length = readLength(text)
  if (length) return [length.percent === undefined ? 0 : length.percent/100,length.px ?? 0]
  const calc = /^calc\(\s*([\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)$/.exec(text)
  if (calc) return [Number(calc[1])/100,Number(calc[3]) * (calc[2] === '-' ? -1 : 1)]
}
function frameOf(values: ReadonlyMap<string,string>): Frame | undefined {
  const inset = values.get('inset'), defaults = inset ? readDeclaration('inset',inset).value as (string | number)[] | undefined : undefined
  const axis = (start: string, finish: string, size: string, a: number, b: number): [Edge,Edge] | undefined => {
    const value = (key: string, i: number) => values.get(key) ?? (defaults?.[i] === undefined ? undefined : typeof defaults[i] === 'number' ? defaults[i] + 'px' : String(defaults[i]))
    const s = value(start,a), f = value(finish,b), z = values.get(size)
    const first = s === undefined ? undefined : edge(s), last = f === undefined ? undefined : edge(f), length = z === undefined ? undefined : edge(z)
    if (s !== undefined && !first || f !== undefined && !last || z !== undefined && !length) return
    if (first && length) return [first,add(first,length)]
    if (last && length) return [subtract(end(last),length),end(last)]
    if (first && last) return [first,end(last)]
  }
  const x = axis('left','right','width',3,1), y = axis('top','bottom','height',0,2)
  return x && y ? { l: x[0], t: y[0], r: x[1], b: y[1] } : undefined
}
function cutsOf(text: string): Corners | undefined {
  const polygon = /^polygon\((.*)\)$/.exec(text)
  if (!polygon) return
  const points: Point[] = []
  for (const item of splitCss(polygon[1])) {
    const coords = splitCss(item,' '), x = edge(coords[0] ?? ''), y = edge(coords[1] ?? '')
    if (coords.length !== 2 || !x || !y) return
    points.push([x,y])
  }
  const cuts = [0,0,0,0], seen = new Map<number,number>()
  const zero = (e: Edge, at: number) => e[0] === at && e[1] === 0
  const put = (i: number, n: number) => {
    if (n < 0 || seen.has(i) && seen.get(i) !== n) return false
    cuts[i] = n; seen.set(i,n); return true
  }
  for (const [x,y] of points) {
    if (zero(y,0) && (x[0] === 0 ? put(0,x[1]) : x[0] === 1 && put(1,-x[1]))) continue
    if (zero(x,1) && (y[0] === 0 ? put(1,y[1]) : y[0] === 1 && put(2,-y[1]))) continue
    if (zero(y,1) && (x[0] === 0 ? put(3,x[1]) : x[0] === 1 && put(2,-x[1]))) continue
    if (zero(x,0) && (y[0] === 0 ? put(0,y[1]) : y[0] === 1 && put(3,-y[1]))) continue
    return
  }
  const [tl,tr,br,bl] = cuts
  const expected: Point[] = [[[0,tl],[0,0]], [[1,-tr],[0,0]], [[1,0],[0,tr]], [[1,0],[1,-br]],
    [[1,-br],[1,0]], [[0,bl],[1,0]], [[0,0],[1,-bl]], [[0,0],[0,tl]]]
  const keys = (p: Point[]) => p.map(point => JSON.stringify(point.map(e => e.map(n => n+0)))).filter((key,i,all) => key !== all[(i+all.length-1)%all.length])
  const want = keys(expected), got = keys(points)
  if (got.length !== want.length || ![got,[...got].reverse()].some(p => p.some((_,i) => want.every((key,j) => key === p[(i+j)%p.length])))) return
  return cuts as unknown as Corners
}

export function decorate(hook: string, selector: string, values: ReadonlyMap<string,string>, colour: (value: string) => string,
  part: PaintPart, child = false): { look: Look; cannotDraw: string[] } {
  const look: Look = {}, cannotDraw: string[] = [], note = (prop: string, why: string) => cannotDraw.push(selector + ' ' + prop + ': ' + why)
  if (values.get('display') === 'none') return { look: child ? {} : { shape: 'none' }, cannotDraw }
  const radius = values.get('border-radius')
  let radii = radius ? readRadii(radius) : undefined, corners = false
  const cornerNames = ['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius']
  for (const [prop,value] of values) {
    if (prop === 'border-radius') { radii = readRadii(value); continue }
    const i = cornerNames.indexOf(prop)
    if (i < 0) continue
    corners = true
    const length = readLength(value), n = length?.px ?? (length?.percent === undefined ? undefined : length.percent + '%')
    if (n === undefined) { note(prop,'elliptical or unreadable corner radii are not represented'); continue }
    const all = [...radii?.radii ?? [0,0,0,0]] as [number|string,number|string,number|string,number|string]
    all[i] = n; radii = { radii: all, notes: [] }
  }
  if (radii?.radii) {
    if (radii.radii.every(n => typeof n === 'number')) {
      if (new Set(radii.radii).size > 1 || corners || child) look.shape = { op: 'rect', radius: radii.radii as Corners }
    } else if (new Set(radii.radii).size === 1 && radii.radii.every(n => typeof n === 'string' && Number.parseFloat(n) >= 50)) {
      if (child || !hook.startsWith('light.') && hook !== 'gauge.hub') look.shape = { op: 'ellipse' }
    } else note('border-radius','percentage radii are not represented')
  } else if (radius) note('border-radius',radii?.notes.join('; ') ?? 'unreadable radii')
  const clip = values.get('clip-path')
  if (clip && clip !== 'none') {
    const cut = cutsOf(clip)
    if (cut) look.shape = { op: 'cut', cut }
    else note('clip-path','only 45 degree corner cuts are represented')
  }
  const rotation = values.get('transform')
  if (!child) {
    if (rotation && rotation !== 'none') note('transform','a primary shape cannot be rotated')
    const sides = ['left','top','right','bottom'].filter(side => values.has('border-' + side))
    if (sides.length === 4) note('border','four independent side borders are not represented')
    else for (const side of sides) {
      const border = readBorder(values.get('border-' + side)!)
      if (!border || border.style !== 'solid' || !border.colour) { note('border-' + side,'only solid coloured borders are represented'); continue }
      if (!border.width) continue
      const frame: Frame = { l: [0,0], t: [0,0], r: [1,0], b: [1,0] }
      if (side === 'left') frame.r = [0,border.width]
      if (side === 'top') frame.b = [0,border.width]
      if (side === 'right') frame.l = [1,-border.width]
      if (side === 'bottom') frame.t = [1,-border.width]
      look.add = [...look.add ?? [], { name: 'border-' + side, op: 'rect', frame, fill: colour(border.colour) }]
    }
    return { look, cannotDraw }
  }
  const content = values.get('content')
  if (content !== undefined && !['""',"''",'none','normal'].includes(content)) { note('content','text decorations are not represented'); return { look: {}, cannotDraw } }
  if (content === 'none') return { look: {}, cannotDraw }
  const frame = frameOf(values)
  if (!frame) { note('position','requires literal edges and dimensions; data-sized or automatic placement is not represented'); return { look: {}, cannotDraw } }
  if (part.fill === undefined && part.stroke === undefined) { note('paint','no represented background or border'); return { look: {}, cannotDraw } }
  const name = selector.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'decoration'
  const paint = { ...part }; delete paint.radius; delete paint.ink
  let ornament: Ornament = { ...(look.shape && look.shape !== 'none' ? look.shape : { op: 'rect' as const }), frame, name, ...paint }
  if (rotation && rotation !== 'none') {
    const angle = readDeclaration('transform',rotation).value, w = frame.r[1]-frame.l[1], h = frame.b[1]-frame.t[1]
    if (angle !== 45 || frame.l[0] !== frame.r[0] || frame.t[0] !== frame.b[0] || w !== h || w <= 0 || clip || radius) {
      note('transform','only a fixed square rotated 45 degrees is represented'); return { look: {}, cannotDraw }
    }
    const x = add(frame.l,[0,w/2]), y = add(frame.t,[0,h/2]), d = w * Math.SQRT1_2
    if (paint.outline && paint.stroke && paint.outline !== 'centre') { note('border','a rotated polygon has a centred stroke'); delete paint.outline }
    ornament = { name, op: 'poly', p: [[x,add(y,[0,-d])], [add(x,[0,d]),y], [x,add(y,[0,d])], [add(x,[0,-d]),y]], ...paint }
    delete ornament.outline
  }
  return { look: { add: [ornament] }, cannotDraw }
}
