// The sole outside-input reader. Drawing never imports this registry-dependent module.
import type { Anatomy, Look, Ornament, Shape, Theme } from '../theme/types'
import { WIDGETS } from './registry'

export const HOOKS: ReadonlyMap<string, 'box' | 'line' | 'text' | 'glyph'> = new Map([
  ...['panel','row','track','fill','meter','mark','target','button.primary','button.secondary','button.danger','focus','header','chip',
    'light.idle','light.ok','light.warn','light.crit','knob','duct.track','switch','gauge.hub'].map(k => [k,'box'] as const),
  ...['gauge.track','gauge.tick','gauge.needle'].map(k => [k,'line'] as const),
  ['duct.flow','line'], ...['hero','screen-title','clock','panel-title','button-label','chip-label','value-lg','value','reading','message','unit'].map(k => ['text:'+k,'text'] as const),
  ['glyph','glyph'],
])
export const LIVE_SIZE: ReadonlySet<string> = new Set(['fill','meter','text:value'])
export const VALUE_SHAPES: ReadonlySet<string> = new Set(['fill','meter','target','knob','gauge.needle','text:value'])
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const own = (v: Record<string, unknown>, k: string) => Object.hasOwn(v,k) ? v[k] : undefined
const record = (): Record<string, unknown> => Object.create(null)

export function sanitizeAnatomy(v: unknown, t: Theme): { anatomy?: Anatomy; notes: string[] } {
  const notes: string[] = [], drop = (path: string, why: string) => { notes.push(`${path}: ${why}`) }
  if (!object(v) || own(v,'v') !== 1) return { notes: ['v: anatomy version must be 1'] }
  const keys = (raw: Record<string, unknown>, allowed: readonly string[], path: string) => {
    for (const k of Object.keys(raw)) if (!allowed.includes(k)) drop(path ? `${path}.${k}` : k, 'unknown key dropped')
  }
  keys(v,['v','looks'],'')
  if (!object(own(v,'looks'))) { drop('looks','expected a record'); return { notes } }
  const number = (n: unknown, min = -Infinity, max = Infinity): number | undefined =>
    typeof n === 'number' && Number.isFinite(Math.fround(n)) && n >= min && n <= max ? Math.fround(n)+0 : undefined
  const edge = (e: unknown): number[] | undefined => {
    if (!Array.isArray(e) || e.length !== 2) return
    const a = number(e[0],0,1), b = number(e[1]); return a === undefined || b === undefined ? undefined : [a,b]
  }
  const corners = (c: unknown): number[] | undefined => {
    if (!Array.isArray(c) || c.length !== 4) return
    const out = c.map(n => number(n,0)); return out.some(n => n === undefined) ? undefined : out as number[]
  }
  const paint = (p: unknown, path: string): unknown => {
    if (typeof p === 'string' && (p === 'state' || p === 'none' || Object.hasOwn(t.colors,p))) return p
    if (object(p)) {
      keys(p,['gradient'],path)
      const g = own(p,'gradient')
      if (typeof g === 'string' && Object.hasOwn(t.gradients,g)) return Object.assign(record(), { gradient: g })
    }
  }
  const convex = (p: number[][]): boolean => {
    let sign = 0
    const dx: number[] = [], dy: number[] = []
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i+1)%p.length], c = p[(i+2)%p.length]
      const x = b[0]-a[0], y = b[1]-a[1], cross = Math.sign(x*(c[1]-b[1])-y*(c[0]-b[0]))
      if (cross && sign && cross !== sign) return false
      if (cross) sign = cross
      if (x) dx.push(Math.sign(x)); if (y) dy.push(Math.sign(y))
    }
    const changes = (a: number[]) => a.filter((s,i) => s !== a[(i+1)%a.length]).length
    return changes(dx) <= 2 && changes(dy) <= 2
  }
  function readShape(raw: unknown, hook: string, path: string, ornament: boolean): Shape | Ornament | undefined {
    if (!object(raw)) { drop(path,'expected a shape'); return }
    keys(raw, ornament ? ['op','frame','radius','cut','p','name','fill','stroke','width','outline','shadow','dash','cap','under']
      : ['op','frame','radius','cut','p'], path)
    const out = record(), op = own(raw,'op')
    const invalid = (why: string): undefined => { drop(path,why); return }
    if (typeof op !== 'string' || !['rect','ellipse','cut','poly','line'].includes(op)) return invalid('unknown shape op')
    if (!ornament && (op === 'poly' || op === 'line')) return invalid('primary must be a box shape')
    // A part showing a value by its size keeps a shape that follows that size (E1). Ornaments never replace the part;
    // one a live-size box cannot place is named when it is drawn.
    if (!ornament && LIVE_SIZE.has(hook) && op !== 'rect' && op !== 'ellipse') return invalid('live size requires rect or ellipse')
    out.op = op
    if (Object.hasOwn(raw,'frame')) {
      if (op === 'poly' || op === 'line' || !object(raw.frame)) return invalid('invalid frame')
      keys(raw.frame,['l','t','r','b'],path+'.frame')
      const f = record()
      for (const k of ['l','t','r','b']) { const e = edge(own(raw.frame,k)); if (!e) return invalid('invalid frame edge'); f[k] = e }
      out.frame = f
    }
    if (Object.hasOwn(raw,'radius')) {
      if (op !== 'rect') return invalid('radius requires rect')
      const r = Array.isArray(raw.radius) ? corners(raw.radius) : number(raw.radius,0)
      if (r === undefined) return invalid('invalid radius'); out.radius = r
    }
    if (op === 'cut') { const c = corners(own(raw,'cut')); if (!c) return invalid('invalid cuts'); out.cut = c }
    else if (Object.hasOwn(raw,'cut')) return invalid('cut requires cut shape')
    if (op === 'poly' || op === 'line') {
      const points = own(raw,'p')
      if (!Array.isArray(points) || points.length < 2) return invalid('at least two points required')
      const p: number[][][] = []
      for (const point of points) {
        if (!Array.isArray(point) || point.length !== 2) return invalid('invalid point')
        const x = edge(point[0]), y = edge(point[1]); if (!x || !y) return invalid('invalid point edge'); p.push([x,y])
      }
      out.p = p
    } else if (Object.hasOwn(raw,'p')) return invalid('points require poly or line')
    if (!ornament) return out as Shape
    const name = own(raw,'name')
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) return invalid('invalid ornament name')
    out.name = name
    for (const k of ['fill','stroke']) if (Object.hasOwn(raw,k)) {
      const p = paint(raw[k],path+'.'+k); if (p === undefined) return invalid('unknown '+k+' paint'); out[k] = p
    }
    if (!Object.hasOwn(out,'fill') && !Object.hasOwn(out,'stroke')) return invalid('fill or stroke required')
    if (Object.hasOwn(raw,'width')) {
      const w = number(raw.width,0); if (w === undefined) return invalid('invalid width')
      if (out.stroke === undefined || out.stroke === 'none') drop(path+'.width','width requires stroke')
      else out.width = w
    }
    if (Object.hasOwn(raw,'shadow')) {
      if (typeof raw.shadow !== 'string' || !Object.hasOwn(t.shadows,raw.shadow)) return invalid('unknown shadow'); out.shadow = raw.shadow
    }
    if (Object.hasOwn(raw,'outline')) {
      if (!['rect','ellipse','cut'].includes(op) || typeof raw.outline !== 'string' || !['inside','centre','outside'].includes(raw.outline)) return invalid('invalid outline')
      out.outline = raw.outline
    }
    if (Object.hasOwn(raw,'cap')) {
      if (op !== 'line' || typeof raw.cap !== 'string' || !['butt','round','square'].includes(raw.cap)) return invalid('invalid cap'); out.cap = raw.cap
    }
    if (Object.hasOwn(raw,'under')) { if (raw.under !== true) return invalid('under must be true'); out.under = true }
    if (Object.hasOwn(raw,'dash')) {
      if (!Object.hasOwn(out,'stroke') || !Array.isArray(raw.dash) || raw.dash.length < 2) return invalid('invalid dash')
      const dash = raw.dash.map(n => number(n,0))
      if (dash.some(n => n === undefined) || dash.reduce<number>((sum,n) => sum+(n??0),0) <= 0) return invalid('invalid dash')
      out.dash = dash
    }
    if (op === 'line' && (Object.hasOwn(out,'fill') || Object.hasOwn(out,'shadow') || Object.hasOwn(out,'outline'))) return invalid('line is stroke only')
    if (op === 'poly' && (Object.hasOwn(out,'fill') || Object.hasOwn(out,'shadow'))) {
      const p = out.p as number[][][]
      if (p.length < 3) return invalid('filled polygon needs three points')
      if (p.length > 3) {
        const fixed = p.every(([x,y]) => x[0] === p[0][0][0] && y[0] === p[0][1][0])
        const scaled = p.every(([x,y]) => x[1] === 0 && y[1] === 0)
        if (!(fixed || scaled) || !convex(p.map(([x,y]) => fixed ? [x[1],y[1]] : [x[0],y[0]]))) return invalid('polygon cannot stay convex')
      }
    }
    return out as Ornament
  }
  const looks: Record<string, Look> = Object.create(null)
  for (const [key, raw] of Object.entries(v.looks as Record<string, unknown>)) {
    const slash = key.indexOf('/'), type = key.slice(0,slash), hook = slash < 0 ? key : key.slice(slash+1), path = 'looks.'+key
    if (!HOOKS.has(hook) || slash >= 0 && (!Object.hasOwn(WIDGETS,type) || WIDGETS[type].native)) { drop(path,'unknown hook'); continue }
    if (!object(raw)) { drop(path,'expected a look'); continue }
    keys(raw,['shape','add'],path)
    const look: Record<string, unknown> = record(); looks[key] = look as Look
    if (Object.hasOwn(raw,'shape')) {
      const kind = HOOKS.get(hook)
      if (kind === 'text' || kind === 'glyph' || kind === 'line' && raw.shape !== 'none' || VALUE_SHAPES.has(hook) && raw.shape === 'none') drop(path+'.shape','shape not allowed on this hook')
      else if (raw.shape === 'none') look.shape = 'none'
      else { const shape = readShape(raw.shape,hook,path+'.shape',false); if (shape) look.shape = shape }
    }
    if (Object.hasOwn(raw,'add')) {
      if (!Array.isArray(raw.add)) { drop(path+'.add','expected an ornament list'); continue }
      const add: Ornament[] = [], names = new Set<string>()
      for (let i = 0; i < raw.add.length; i++) {
        const p = `${path}.add.${i}`, o = readShape(raw.add[i],hook,p,true) as Ornament | undefined
        if (!o) continue
        if (names.has(o.name)) { drop(p,'repeated ornament name'); continue }
        names.add(o.name); add.push(o)
      }
      look.add = add
    }
  }
  return { anatomy: Object.assign(Object.create(null), { v: 1 as const, looks }), notes }
}
