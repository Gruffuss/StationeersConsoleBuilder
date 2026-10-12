import { dataNames } from '../editor/fields'
import { viewbox } from '../editor/geometry'
import { newProject, type Page, type Project } from '../model/project'
import type { Scene, SrcNode } from '../model/scene'
import { sameData } from '../model/same'
import { SHAPES, unitsOf, type ShapeKind } from '../model/shapes'
import { initialState, reducer } from '../model/store'
import { nodeAt } from '../model/tree'
import { fromProps } from '../srctext/fromProps'
import { parseSrc } from '../srctext/parse'
import { first, foldKey, type Pairs, type Uv } from '../srctext/props'
import { DEFAULT_THEME, groundOf, THEMES } from '../theme'
import { cssColour } from '../theme/import/colour'
import { reassociate, takenUids, widgetsIn } from '../widgets/core'
import { literal } from '../widgets/paint'
import type { Json, WidgetRef } from '../widgets/types'

type Rect = [number, number, number, number]
type Via = [string, string][]
type Structure = { key: string; surface: string; element: string; order: number; rect: Rect; props: Pairs; problems: string[]; via: Via }
type Native = { surface: string; id: string; type: string; order: number; rect: Rect; style: Record<string, Json>; props: Record<string, Json>; click: boolean; via: Via }
export type Capture = { complete: boolean; error: string | null; notes: string[]; surfaces: { name: string; w: number; h: number }[];
  structures: Structure[]; data: { surface: string; element: string; scene: string; values: Pairs }[]; natives: Native[];
  clicks: { surface: string; element: string; id: string }[]; states: number; untried: number; vb: boolean }
export type AdoptReport = { pages: { id: string; from: string }[]; leftOut: string[]; notes: string[]; complete: boolean }

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const unsafe = (k: string) => ['__proto__', 'constructor', 'prototype'].includes(k)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(Math.fround(v))

/** Read known screen capture fields; nested values are cloned without a depth limit or recursion. */
export function readCapture(value: unknown): Capture {
  const notes = new Set<string>()
  const fail = (at: string): never => { throw new Error('Unreadable capture: ' + at) }
  const record = (v: unknown, keys: string[], at: string) => {
    if (!object(v)) return fail('expected an object')
    for (const k of Object.keys(v)) if (!keys.includes(k)) notes.add(`${at}.${k}: Ignored unknown capture field`)
    return v
  }
  const text = (v: unknown): string => typeof v === 'string' ? v : fail('expected text')
  const count = (v: unknown): number => finite(v) && Number.isSafeInteger(v) && v >= 0 ? v : fail('expected a count')
  const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : fail('expected a boolean')
  const list = <T>(v: unknown, read: (x: unknown, i: number) => T): T[] => Array.isArray(v) ? v.map(read) : fail('expected a list')
  const rect = (v: unknown): Rect => Array.isArray(v) && v.length === 4 && v.every(x => finite(x) && Number.isFinite(Math.fround(x))) ? v as Rect : fail('expected a rect')
  const via = (v: unknown): Via => list(v, x => Array.isArray(x) && x.length === 2 ? [text(x[0]), text(x[1])] : fail('expected a click path'))
  const clone = (v: unknown, tagged: boolean, at: string): Uv | Json | undefined => {
    let result: Uv | Json | undefined
    type Job = { v: unknown; put: (x: any) => void } | { exit: object }
    const todo: Job[] = [{ v, put: x => { result = x } }], active = new Set<object>()
    const dropped = (why = 'Ignored unknown or unsupported capture values') => notes.add(`${at}: ${why}`)
    while (todo.length) {
      const job = todo.pop()!
      if ('exit' in job) { active.delete(job.exit); continue }
      const { v, put } = job
      if (typeof v === 'string' || finite(v)) { put(v); continue }
      if (typeof v === 'number') { dropped('Ignored a number outside the finite float32 range'); continue }
      if (!tagged && (v === null || typeof v === 'boolean')) { put(v); continue }
      if (v === null || typeof v !== 'object') { dropped(); continue }
      if (active.has(v)) return fail('a value contains a cycle')
      active.add(v); todo.push({ exit: v })
      if (!tagged && Array.isArray(v)) {
        const a: Json[] = []; put(a)
        for (let i = v.length - 1; i >= 0; i--) todo.push({ v: v[i], put: x => a.push(x) })
      } else if (object(v)) {
        if (!tagged) {
          const m: Record<string, Json> = Object.create(null); put(m)
          for (const k of Object.keys(v).reverse()) {
            if (unsafe(k)) { dropped(`Ignored unsafe capture key ${k}`); continue }
            todo.push({ v: v[k], put: x => { m[k] = x } })
          }
        } else {
          const keys = Object.keys(v).filter(k => ['a', 'm', 'b'].includes(k))
          for (const k of Object.keys(v)) if (!keys.includes(k)) dropped(`Ignored unknown capture field ${k}`)
          if (keys.length !== 1) { dropped(); continue }
          const k = keys[0]
          if (k === 'b' && typeof v.b === 'boolean') put({ b: v.b })
          else if (k === 'a' && Array.isArray(v.a)) {
            const a: Uv[] = []; put({ a })
            for (let i = v.a.length - 1; i >= 0; i--) todo.push({ v: v.a[i], put: x => a.push(x) })
          } else if (k === 'm' && Array.isArray(v.m)) {
            const m: Pairs = []; put({ m })
            for (let i = v.m.length - 1; i >= 0; i--) {
              const pair = v.m[i]
              if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') { dropped(); continue }
              if (unsafe(pair[0])) { dropped(`Ignored unsafe capture key ${pair[0]}`); continue }
              todo.push({ v: pair[1], put: x => m.push([pair[0], x]) })
            }
          } else dropped()
        }
      } else dropped()
    }
    return result
  }
  const pairs = (v: unknown, at: string): Pairs => {
    const result: Pairs = []
    list(v, x => {
      if (!Array.isArray(x) || x.length !== 2 || typeof x[0] !== 'string') return fail('expected a property pair')
      if (unsafe(x[0])) { notes.add(`${at}.${x[0]}: Ignored unsafe capture key`); return }
      const value = clone(x[1], true, `${at}.${x[0]}`) as Uv | undefined
      if (value !== undefined) result.push([x[0], value])
    })
    return result
  }
  const raw = (v: unknown, at: string) => {
    if (!object(v)) return fail('expected native properties')
    return clone(v, false, at) as Record<string, Json>
  }
  const r = record(typeof value === 'string' ? JSON.parse(value) : value,
    ['complete', 'error', 'notes', 'surfaces', 'structures', 'data', 'natives', 'clicks', 'states', 'untried', 'vb'], 'capture')
  const c: Capture = {
    complete: bool(r.complete), error: r.error === null ? null : text(r.error), notes: list(r.notes, text),
    surfaces: list(r.surfaces, (v, i) => {
      const x = record(v, ['name', 'w', 'h'], `surfaces[${i}]`)
      if (!finite(x.w) || x.w <= 0 || !finite(x.h) || x.h <= 0) return fail('expected a surface size')
      return { name: text(x.name), w: x.w, h: x.h }
    }),
    structures: list(r.structures, (v, i) => {
      const at = `structures[${i}]`, x = record(v, ['key', 'surface', 'element', 'order', 'rect', 'props', 'problems', 'via'], at)
      return { key: text(x.key), surface: text(x.surface), element: text(x.element), order: count(x.order), rect: rect(x.rect), props: pairs(x.props, at + '.props'), problems: list(x.problems, text), via: via(x.via) }
    }),
    data: list(r.data, (v, i) => {
      const at = `data[${i}]`, x = record(v, ['surface', 'element', 'scene', 'values'], at)
      return { surface: text(x.surface), element: text(x.element), scene: text(x.scene), values: pairs(x.values, at + '.values') }
    }),
    natives: list(r.natives, (v, i) => {
      const at = `natives[${i}]`, x = record(v, ['surface', 'id', 'type', 'order', 'rect', 'style', 'props', 'click', 'via'], at)
      return { surface: text(x.surface), id: text(x.id), type: text(x.type), order: count(x.order), rect: rect(x.rect), style: raw(x.style, at + '.style'), props: raw(x.props, at + '.props'), click: bool(x.click), via: via(x.via) }
    }),
    clicks: list(r.clicks, (v, i) => {
      const x = record(v, ['surface', 'element', 'id'], `clicks[${i}]`)
      return { surface: text(x.surface), element: text(x.element), id: text(x.id) }
    }), states: count(r.states), untried: count(r.untried), vb: bool(r.vb),
  }
  c.notes.push(...notes)
  return c
}

const get = (p: Pairs, k: string) => p.find(([key]) => foldKey(key) === k)?.[1]
const inert = (lua: string) => {
  let eq = ''
  while (lua.includes(']' + eq + ']')) eq += '='
  return '--[' + eq + '[\n' + lua + '\n]' + eq + ']'
}
const sample = (value: Uv): Json => {
  let result: Json = null
  const todo: { value: Uv; put: (v: Json) => void }[] = [{ value, put: v => { result = v } }]
  while (todo.length) {
    const { value: v, put } = todo.pop()!
    if (typeof v !== 'object') put(v)
    else if ('b' in v) put(v.b)
    else if ('a' in v) {
      const a: Json[] = []; put(a)
      for (let i = v.a.length - 1; i >= 0; i--) todo.push({ value: v.a[i], put: x => a.push(x) })
    } else {
      const m: Record<string, Json> = Object.create(null); put(m)
      for (const [k, value] of [...v.m].reverse()) todo.push({ value, put: x => { if (!Object.hasOwn(m, k)) m[k] = x } })
    }
  }
  return result
}
const num = (v: unknown, fallback: number) => finite(v) ? v : fallback
const colour = (v: unknown, fallback: string) => typeof v === 'string' ? cssColour(v)?.rgba ?? fallback : fallback

export function adoptCapture(c: Capture, o: { lua: string; shape: ShapeKind }): { project: Project; report: AdoptReport } {
  c = readCapture(c)
  const report: AdoptReport = { pages: [], leftOut: ['Reads, logic, device writes and the script tick() were not recovered; port them by hand.'], notes: [...c.notes], complete: c.complete }
  if (c.error) report.notes.push(c.error)
  if (c.untried) report.leftOut.push(`${c.untried} click paths were not tried.`)
  for (const hit of c.clicks) report.notes.push(`Click ${hit.surface}/${hit.element}/${hit.id}: attach an action in the builder.`)
  const p = newProject(); p.name = 'Adopted script'; p.pages = []
  p.customLua = '-- The adopted script below does not run. Port its logic by hand.\n' + inert(o.lua)
  const used = new Set<string>(), kept = new Set<string>()
  const structures = [...c.structures], carried = new Set<Native>()
  if (c.vb && c.surfaces.length > 1) report.notes.push('The capture does not identify the opening page; pages keep captured surface order.')
  // Native-only screens still have editable artwork, including distinct click states.
  for (const s of c.surfaces) if (!structures.some(x => x.surface === s.name)) {
    const contexts = c.natives.filter(n => n.surface === s.name).map(n => n.via)
    const units = unitsOf(o.shape, s)
    for (const via of contexts.filter((v, i) => contexts.findIndex(x => sameData(x, v)) === i))
      structures.push({ key: '', surface: s.name, element: 'natives', order: 0, rect: [0, 0, s.w, s.h],
        props: [['w', units.w], ['h', units.h], ['fit', 'contain']], problems: [], via })
  }
  structures.sort((a, b) => c.surfaces.findIndex(s => s.name === a.surface) - c.surfaces.findIndex(s => s.name === b.surface) || a.order - b.order)
  for (const s of structures) {
    const origin = `${s.surface}/${s.element}${s.via.length ? ' (after ' + s.via.map(x => x[1]).join(' → ') + ')' : ''}`
    const src = get(s.props, 'SRC')
    let scene: Scene
    if (typeof src === 'string') {
      const parsed = parseSrc(src)
      if (!parsed.scene || parsed.errors.length) {
        for (const e of parsed.errors) report.leftOut.push(`${origin}: ${e.line}:${e.col} ${e.message}`)
        if (!s.problems.length) report.leftOut.push(`${origin}: builder defect: the strict parser refused text the mod accepts.`)
        if (!o.lua.includes(src) && !kept.has(src)) { p.customLua += '\n-- Refused scene source, retained for repair.\n' + inert(src); kept.add(src) }
        continue
      }
      scene = parsed.scene
    } else {
      const read = fromProps(s.props); scene = read.scene
      report.leftOut.push(...read.warnings.map(w => `${origin}: ${w}`))
    }
    report.notes.push(...s.problems.map(w => `${origin}: ${w}`))
    const size = c.surfaces.find(x => x.name === s.surface) ?? (o.shape === 'custom' ? SHAPES.square.px : SHAPES[o.shape].px)
    const shape = (Object.keys(SHAPES) as Exclude<ShapeKind, 'custom'>[]).find(k => SHAPES[k].px.w === size.w && SHAPES[k].px.h === size.h) ?? 'custom'
    const matrix = viewbox(scene.header, size)
    const f = { sx: matrix[0], sy: matrix[3], ox: matrix[4], oy: matrix[5] }
    if (s.rect[2] > 0 && s.rect[3] > 0 && !sameData(s.rect, [0, 0, size.w, size.h])) {
      const e = viewbox(scene.header, { w: s.rect[2], h: s.rect[3] })
      scene.root = [{ op: 'G', attrs: { s: [Math.fround(e[0] / f.sx), Math.fround(e[3] / f.sy)],
        t: [Math.fround((s.rect[0] + e[4] - f.ox) / f.sx), Math.fround((s.rect[1] + e[5] - f.oy) / f.sy)] }, c: scene.root }]
      report.leftOut.push(`${origin}: element viewport clipping was not recovered.`)
    }
    let surface = s.surface, n = 2
    while (used.has(surface)) surface = s.surface + '-' + n++
    used.add(surface)
    const pg: Page = { id: 'p' + (p.pages.length + 1), name: (c.vb ? s.surface : s.element) + (s.via.length ? ' (after ' + s.via.map(x => x[1]).join(' → ') + ')' : ''), surface,
      shape, size: { w: size.w, h: size.h }, scene, background: groundOf(THEMES[DEFAULT_THEME]), preview: Object.create(null), natives: [] }
    const natives = new Map<string, Native>()
    for (const native of c.natives) if (native.surface === s.surface && native.via.length <= s.via.length && native.via.every((v, i) => sameData(v, s.via[i]))) {
      if (!natives.has(native.id) || natives.get(native.id)!.via.length <= native.via.length) natives.set(native.id, native)
    }
    const before: SrcNode[] = [], after: SrcNode[] = [], uids = takenUids({ ...p, pages: [...p.pages, pg] })
    const header = { op: 'SCENE', attrs: scene.header }, shadows = first(header, 'SH'), opacity = first(header, 'FO')
    const shadowReset: SrcNode['attrs'] = shadows === undefined || sameData(shadows, []) ? {} : { sh: [] }
    const fillReset: SrcNode['attrs'] = opacity === undefined || opacity === 1 ? {} : { fo: 1 }
    const reserved = new Set([...dataNames(scene), ...c.data.flatMap(d => d.values.map(([k]) => k))])
    for (const native of [...natives.values()].sort((a, b) => a.order - b.order)) {
      carried.add(native)
      const [px, py, pw, ph] = native.rect
      const box = { x: Math.fround((px - f.ox) / f.sx), y: Math.fround((py - f.oy) / f.sy), w: Math.fround(pw / f.sx), h: Math.fround(ph / f.sy) }
      const target = native.order < s.order ? before : after
      const at = `${origin}: native ${native.id}`
      const fields = native.type === 'panel' ? { props: [], style: ['bg', 'gradient', 'gradient_dir'] }
        : native.type === 'label' ? { props: ['text'], style: ['font_size', 'color', 'align'] }
        : native.type === 'icon' ? { props: ['icon_type', 'name', 'z_index'], style: [] }
        : { props: ['value', 'text', 'placeholder', 'z_index'], style: ['font_size'] }
      for (const field of ['props', 'style'] as const) {
        const dropped = Object.keys(native[field]).filter(k => !fields[field].includes(k))
        if (dropped.length) report.leftOut.push(`${at}: ${field} fields not carried: ${dropped.join(', ')}.`)
      }
      if (native.type === 'panel') {
        const background = native.order < s.order && sameData(native.rect, [0, 0, size.w, size.h])
        const paint = colour(native.style.bg, '#1A1A1ACC')
        target.push({ op: 'R', attrs: { ...box, f: background ? 'none' : paint, ...(!background ? fillReset : {}), s: 'none', ...shadowReset, fea: 0 } })
        if (background) pg.background = [paint]
        if (background && typeof native.style.gradient === 'string' && (!native.style.gradient_dir || native.style.gradient_dir === 'vertical'))
          pg.background!.push(colour(native.style.gradient, paint))
        else if (native.style.gradient) report.leftOut.push(`${at}: panel gradient was not carried.`)
      } else if (native.type === 'label') {
        const captured = typeof native.props.text === 'string' || typeof native.props.text === 'number' ? String(native.props.text) : ''
        let text = literal(THEMES[DEFAULT_THEME], 'message', captured)
        // A captured native string is literal; vector text would otherwise interpret its binding/template syntax.
        if (captured.startsWith('$') || captured.includes('{$') || captured.includes('{=')) {
          let i = 1; while (reserved.has('adopt_label_' + i)) i++
          const key = 'adopt_label_' + i; reserved.add(key)
          text = '$' + key; pg.preview![key] = captured
          report.notes.push(`${at}: literal text kept in preview sample ${key}.`)
        }
        const align = typeof native.style.align === 'string' ? native.style.align.toLowerCase() : 'left'
        const right = align.includes('right'), center = align.includes('center')
        const top = align.startsWith('top'), bottom = align.startsWith('bottom')
        target.push({ op: 'T', attrs: { ...box, wrap: 1, text, ...fillReset, font: '', weight: 'normal', cspace: 0, fit: 'none', ...shadowReset,
          size: Math.fround(num(native.style.font_size, 16) / Math.min(f.sx, f.sy)), f: colour(native.style.color, '#ffffff'),
          align: right ? 'right' : center ? 'center' : 'left', valign: top ? 'top' : bottom ? 'bottom' : 'middle' } })
        report.leftOut.push(`${at}: the native font drop shadow was not recovered.`)
      } else if (native.type === 'icon' || native.type === 'textinput') {
        const prefix = native.type === 'icon' ? 'ico' : 'ti'
        let i = 1; while (uids.has(prefix + i)) i++
        const uid = prefix + i; uids.add(uid)
        const params = native.type === 'icon' ? { ...box, kind: String(native.props.icon_type ?? 'gas'), name: String(native.props.name ?? '') }
          : { ...box, value: String(native.props.value ?? native.props.text ?? ''), placeholder: String(native.props.placeholder ?? ''), fontSize: Math.fround(num(native.style.font_size, 16) / f.sy) }
        pg.natives!.push({ uid, type: native.type, params } as WidgetRef)
        if (Object.keys(native.style).some(k => k !== 'font_size')) report.leftOut.push(`${at}: captured native styling will use the project theme.`)
        if (native.order < s.order) report.leftOut.push(`${at}: the builder draws native widgets after vector artwork.`)
      } else report.leftOut.push(`${at}: unsupported element type ${native.type}.`)
      if (native.click) target.push({ op: 'R', attrs: { ...box, id: native.id, click: 1, f: 'none', s: 'none', ...shadowReset } })
    }
    scene.root = [...before, ...scene.root, ...after]
    const names = new Set(dataNames(scene)), sceneId = get(s.props, 'SCENE') ?? s.element
    for (const d of c.data) if (d.surface === s.surface && d.scene === sceneId)
      for (const [k, v] of d.values) if (names.has(k)) pg.preview![k] = sample(v)
    p.pages.push(pg); report.pages.push({ id: pg.id, from: origin })
  }
  for (const native of c.natives) if (!carried.has(native)) report.leftOut.push(`Native ${native.surface}/${native.id}${native.via.length ? ' (after ' + native.via.map(x => x[1]).join(' → ') + ')' : ''}: no matching editable structure state.`)
  if (c.vb) {
    let best = 0
    for (const [key, theme] of Object.entries(THEMES)) {
      let score = 0
      for (const pg of p.pages) {
        const associated = reassociate({ header: {}, defs: [], root: [] }, pg.scene, theme, undefined, true).scene
        for (const w of widgetsIn(associated, theme)) if (sameData(nodeAt(pg.scene.root, w.path), nodeAt(associated.root, w.path))) score++
      }
      if (score > best) { best = score; p.theme = key }
    }
    report.notes.push('Builder widgets restored using ' + THEMES[p.theme].name + '.')
  }
  if (!p.pages.length) { p.pages = newProject().pages; report.notes.push('No editable pages were captured; the current project is kept.') }
  const loaded = reducer(initialState(), { type: 'loadProject', project: p })
  if (loaded.notice) report.notes.push(loaded.notice)
  return { project: loaded.project, report }
}
