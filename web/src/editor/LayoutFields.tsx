import { useEffect, useState } from 'react'
import { hidden } from '../editing/bounds'
import { union } from '../editing/layout'
import { fillsBox, layoutBox, layoutOf, marginOf, reflowEdits, withFill, withLayout, withMargin, type LayoutRecord, type Sides } from '../editing/layoutRecords'
import type { Page } from '../model/project'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt, replaceAt, sameData, type Action } from '../model/store'
import type { SceneChecker } from '../srctext/checker'
import { shortestFloat } from '../srctext/print'
import { foldKey } from '../srctext/props'
import type { Theme } from '../theme'
import { widgetOf, widgetRootOf } from '../widgets/core'
import { NOT_APPLIED, TextField } from './PropertyPanel'
import { Segmented } from '../ui/Segmented'

const SIDES = ['top', 'right', 'bottom', 'left'] as const
type Props = { page: Page; path: number[]; theme: Theme; checker: SceneChecker; dispatch: (a: Action) => void;
  sceneOf: (pageId: string) => Scene | undefined }
export function LayoutFields({ page, path, theme, checker, dispatch, sceneOf }: Props) {
  const scene = page.scene, node = nodeAt(scene.root, path), layout = node && layoutOf(node)
  const [samePad, setSamePad] = useState(false), [error, setError] = useState('')
  const selected = `${page.id}/${path.join('.')}`
  useEffect(() => { setSamePad(false) }, [selected])
  if (!node) return null
  const root = widgetRootOf(scene, path, theme)
  if (root && root.length < path.length) return null
  const group = foldKey(node.op) === 'G' && !widgetOf(node, theme)
  const parent = path.length > 1 ? nodeAt(scene.root, path.slice(0, -1)) : null
  const child = parent && layoutOf(parent) && !widgetOf(parent, theme)
  if (!group && !child) return null
  const commit = async (made: SrcNode) => {
    if (sameData(made, node)) return setError('')
    const root = replaceAt(scene.root, path, made)!
    const laid = reflowEdits(scene, { ...scene, root }, theme), next = laid.scene, c = await checker.check(next)
    if (sceneOf(page.id) !== scene) return setError(NOT_APPLIED)
    if (c.errors.length && !c.tooLarge) return setError(c.errors[0].message)
    setError(c.tooLarge ? c.errors[0].message : '')
    dispatch({ type: 'editScene', pageId: page.id, scene: next })
  }
  const put = (patch: Partial<LayoutRecord>) => void commit(withLayout(node, { ...layout!, ...patch }))
  const number = (label: string, value: number, change: (value: number) => void, nonnegative = false, disabled = false) =>
    <label key={label}>{label} <TextField label={label} now={shortestFloat(value)} placeholder="0" multiline={false} disabled={disabled} commit={text => {
      const value = Math.fround(Number(text))
      if (!text.trim() || !Number.isFinite(value) || nonnegative && value < 0) return setError(`${label} must be a ${nonnegative ? 'nonnegative ' : ''}finite number`)
      setError(''); change(value)
    }} /></label>
  const choice = <K extends 'dir' | 'align' | 'justify' | 'size'>(key: K, label: string, options: LayoutRecord[K][]) =>
    <label>{label} <select aria-label={label} value={layout![key]} onChange={e => put({ [key]: e.target.value })}>
      {options.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
  return <details className="disc vb-layout-fields" open aria-label="Layout properties">
    <summary><span className="ptitle">Layout</span><span className="unit">{(group ? layout ? 14 : 0 : 0) + (child ? 5 : 0)}</span></summary>
    <div className="vb-paint-fields">
      {group && !layout && <button className="btn" aria-label="Add layout" onClick={() => {
        const boxes = (node.c ?? []).filter(n => !hidden(n)).flatMap(n => { const box = layoutBox(n, theme); return box ? [box] : [] })
        const box = boxes.length ? union(boxes) : { x: 0, y: 0, w: 0, h: 0 }
        void commit(withLayout(node, { dir: 'row', pad: [0, 0, 0, 0], gap: 0, align: 'start', justify: 'start', size: 'fixed', box: [box.x, box.y, box.w, box.h] }))
      }}>Add layout</button>}
      {group && layout && <>
        <button className="btn" aria-label="Remove layout" onClick={() => void commit(withLayout(node, null))}>Remove layout</button>
        <Segmented label="Layout direction" value={layout.dir} options={[{ value: 'row', label: 'row' }, { value: 'column', label: 'column' }]}
          onChange={dir => put({ dir })} />
        <label><input type="checkbox" aria-label="Same padding on all sides" checked={samePad} onChange={e => {
          setSamePad(e.target.checked)
          if (e.target.checked) put({ pad: layout.pad.map(() => layout.pad[0]) as Sides })
        }} /> Same on all sides</label>
        <div className="vb-four-up">{SIDES.map((side, i) => number('Padding ' + side, layout.pad[i], value => {
          const pad = layout.pad.map((was, k) => samePad || k === i ? value : was) as Sides
          put({ pad })
        }, true))}</div>
        {number('Layout gap', layout.gap, gap => put({ gap }), true)}
        {choice('align', 'Layout align', ['start', 'center', 'end', 'stretch'])}
        {choice('justify', 'Layout justify', ['start', 'center', 'end', 'between'])}
        {choice('size', 'Layout sizing', ['fixed', 'hug'])}
        {['x', 'y', 'width', 'height'].map((name, i) => number('Layout box ' + name, layout.box[i], value => {
          const box = layout.box.map((was, k) => k === i ? value : was) as Sides
          put({ box })
        }, i >= 2, i >= 2 && layout.size === 'hug'))}
      </>}
      {child && <>
        <div className="vb-four-up">{SIDES.map((side, i) => number('Margin ' + side, marginOf(node)[i], value => {
          const margin = marginOf(node).map((was, k) => k === i ? value : was) as Sides
          void commit(withMargin(node, margin))
        }))}</div>
        <label><input type="checkbox" aria-label="Fill the box" checked={fillsBox(node)} onChange={e => void commit(withFill(node, e.target.checked))} /> fill the box</label>
      </>}
    </div>
    {error && <div role="alert">{error}</div>}
  </details>
}
