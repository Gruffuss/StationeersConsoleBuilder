import { useState } from 'react'
import { fresh, idsFrom, idsOf } from '../editing/tree'
import type { Scene, SrcNode, Value } from '../model/scene'
import { fieldOf } from '../schema'
import { first, foldKey } from '../srctext/props'
import type { Theme } from '../theme'
import { unlinked } from '../theme/links'
import { ColourFields } from './PaintFields'
import { TextField } from './PropertyPanel'
import { read, shown, withAttr } from './fields'
import { Segmented } from '../ui/Segmented'

export const GRADIENT_KEYS = { GL: ['x1', 'y1', 'x2', 'y2'], GR: ['cx', 'cy', 'r', 'fx', 'fy'], GC: ['cx', 'cy', 'a'] } as const
export const isGradient = (n: SrcNode) => Object.hasOwn(GRADIENT_KEYS, foldKey(n.op))
export function gradientOf(scene: Scene, node: SrcNode, key: string): SrcNode | undefined {
  const value = node.attrs[key]
  return typeof value === 'string' && value.startsWith('@') ? scene.defs.find(d => isGradient(d) && first(d, 'ID') === value.slice(1)) : undefined
}
export type GradientEdit = { node: SrcNode; defs: SrcNode[] }
/** Owned defs are cloned once; a shared authored def is edited for all its users unless made independent. */
export function gradientEdit(scene: Scene, node: SrcNode, key: string, change: (def: SrcNode) => SrcNode, independent = false): GradientEdit | null {
  const def = gradientOf(scene, node, key)
  if (!def) return null
  const id = String(first(def, 'ID')), clone = independent || id.startsWith('theme_')
  let made = change(def)
  if (clone) {
    const nextId = fresh(id.replace(/^theme_/, ''), idsFrom(idsOf([scene])))
    made = withAttr(made, 'id', nextId)
    return { node: withAttr(unlinked(node, [key]), key, '@' + nextId, node.op === 'G' || node.op === 'SCENE'), defs: [...scene.defs, made] }
  }
  return { node, defs: scene.defs.map(d => d === def ? made : d) }
}
function usersOf(scene: Scene, id: string) {
  let count = 0
  const stack: SrcNode[] = [{ op: 'SCENE', attrs: scene.header }, ...scene.root, ...scene.defs]
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (Object.entries(n.attrs).some(([k, v]) => fieldOf(n.op, k)?.type === 'paint' && v === '@' + id)) count++
    for (const c of n.c ?? []) stack.push(c)
  }
  return count
}

// React reserves `key`; the referenced paint attribute travels as paintKey.
export function GradientFields({ scene, node, paintKey, commit, theme }:
  { scene: Scene; node: SrcNode; paintKey: string; commit: (edit: GradientEdit) => void; theme: Theme }) {
  const [kind, setKind] = useState('GL'), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const def = gradientOf(scene, node, paintKey), label = paintKey
  const apply = (change: (d: SrcNode) => SrcNode, independent = false) => {
    const edit = gradientEdit(scene, node, paintKey, change, independent)
    if (edit) { setError(''); commit(edit) }
  }
  const current = node.attrs[paintKey], bound = typeof current === 'string' && /^[=$]/.test(current)
  const create = () => {
    if (bound) return
    const id = fresh('gradient', idsFrom(idsOf([scene])))
    const colour = typeof current === 'string' && !current.startsWith('@') && current !== 'none' ? current : theme.colors['surface-panel']
    const attrs: Record<string, Value> = { id, units: 'bbox', stops: [[0, colour], [1, theme.colors.text]] }
    if (kind === 'GL') Object.assign(attrs, { x1: 0, y1: 0, x2: 1, y2: 0 })
    else if (kind === 'GR') Object.assign(attrs, { cx: 0.5, cy: 0.5, r: 0.5 })
    else Object.assign(attrs, { cx: 0.5, cy: 0.5, a: 0 })
    commit({ node: withAttr(unlinked(node, [paintKey]), paintKey, '@' + id, node.op === 'G' || node.op === 'SCENE'), defs: [...scene.defs, { op: kind, attrs }] })
  }
  const geometry = def ? GRADIENT_KEYS[foldKey(def.op) as keyof typeof GRADIENT_KEYS] : []
  const stopsValue = def && first(def, 'STOPS'), stops = Array.isArray(stopsValue) ? stopsValue as Value[] : []
  const changeStops = (rows: Value[]) => apply(d => withAttr(d, 'stops', rows))
  const changeStop = (i: number, k: number, v: Value) => changeStops(stops.map((row, j) => j === i && Array.isArray(row) ? row.map((x, at) => at === k ? v : x) : row))
  const move = (i: number, to: number) => { const next = stops.slice(); [next[i], next[to]] = [next[to], next[i]]; changeStops(next) }
  return <div className="vb-paint-fields">
    <label>Kind</label><Segmented label={`${label} gradient kind`} value={def?.op ?? kind} onChange={to => {
      setKind(to)
      if (def && to !== def.op) apply(d => {
        const keys: readonly string[] = GRADIENT_KEYS[to as keyof typeof GRADIENT_KEYS]
        const dropped = Object.keys(d.attrs).filter(k => Object.values(GRADIENT_KEYS).flat().some(v => v === k.toLowerCase()) && !keys.includes(k.toLowerCase()))
        const next = Object.fromEntries(Object.entries(d.attrs).filter(([k]) => !dropped.includes(k)))
        const defaults = to === 'GL' ? { x1: 0, y1: 0, x2: 1, y2: 0 } : to === 'GR' ? { cx: 0.5, cy: 0.5, r: 0.5 } : { cx: 0.5, cy: 0.5, a: 0 }
        for (const [k, v] of Object.entries(defaults)) if (first(d, foldKey(k)) === undefined) next[k] = v
        setNotice(dropped.length ? `Dropped geometry: ${dropped.join(', ')}; shared keys kept` : 'Shared geometry keys kept')
        return { ...d, op: to, attrs: next }
      })
    }} options={Object.keys(GRADIENT_KEYS).map(value => ({ value, label: value }))} />
    <button aria-label={`${label} New gradient`} disabled={bound} onClick={create}>New gradient</button>
    {def && <>
      <p role="status">{usersOf(scene, String(first(def, 'ID')))} nodes use this gradient; edits change all of them.</p>
      {String(first(def, 'ID')).startsWith('theme_') && <p className="vb-prop-info">The first edit makes an independent copy of this theme gradient.</p>}
      <button aria-label={`${label} Make independent`} onClick={() => apply(d => d, true)}>Make independent</button>
      {geometry.map(k => <label key={k}>{k} <TextField label={`${label} gradient ${k}`} now={shown(first(def, foldKey(k)))} placeholder="default" multiline={false} commit={text => {
        const result = read(text, 'literal', fieldOf(def.op, k)!)
        if ('error' in result) return setError(result.error)
        apply(d => withAttr(d, k, result.value))
      }} /></label>)}
      <label>Units</label><Segmented label={`${label} gradient units`} value={String(first(def, 'UNITS') ?? 'scene').toLowerCase()} onChange={units => {
        apply(d => withAttr(d, 'units', units === 'bbox' ? 'bbox' : undefined))
        setNotice(`Geometry values kept; their units are now ${units}`)
      }} options={['bbox', 'scene'].map(value => ({ value, label: value }))} />
      {def.op !== 'GC' && <><label>Spread</label><Segmented label={`${label} gradient spread`} value={String(first(def, 'SPREAD') ?? 'pad').toLowerCase()} onChange={value =>
        apply(d => withAttr(d, 'spread', value))} options={['pad', 'repeat', 'reflect', 'none'].map(value => ({ value, label: value }))} /></>}
      {stops.map((row, i) => Array.isArray(row) && <fieldset key={i}><legend>Stop {i + 1}</legend>
        <label>Position <TextField label={`${label} Stop ${i + 1} position`} now={shown(row[0])} placeholder="0–1" multiline={false} commit={text => {
          const value = Math.fround(Number(text))
          if (!text.trim() || !Number.isFinite(value) || value < 0 || value > 1) return setError('Stop position must be between 0 and 1')
          changeStop(i, 0, value)
        }} /></label>
        <ColourFields inline label={`${label} Stop ${i + 1}`} value={row[1]} commit={s => changeStop(i, 1, s)} />
        <button aria-label={`${label} Stop ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>Up</button>
        <button aria-label={`${label} Stop ${i + 1} down`} disabled={i === stops.length - 1} onClick={() => move(i, i + 1)}>Down</button>
        <button aria-label={`${label} Stop ${i + 1} remove`} disabled={stops.length <= 1} onClick={() => changeStops(stops.filter((_, j) => j !== i))}>Remove</button>
      </fieldset>)}
      <button aria-label={`${label} Add stop`} onClick={() => changeStops([...stops, [0.5, Array.isArray(stops[0]) && typeof stops[0][1] === 'string' && !stops[0][1].startsWith('$') ? stops[0][1] : theme.colors.text]])}>Add stop</button>
    </>}
    {error && <div role="alert">{error}</div>}
    {notice && <p role="status">{notice}</p>}
  </div>
}
