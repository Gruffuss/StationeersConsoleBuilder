// The selected node's source path, as ops with their #id (G › RP › R#box). A crumb selects that ancestor. The bar stays
// when nothing is selected, so the canvas above it keeps its size. A root node whose move is locked says why, as text.
import { Fragment } from 'react'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt, type Action, type Selection, type State } from '../model/store'
import { first } from '../srctext/props'
import { stays } from '../editing/transform'
import { Icon } from '../ui/icons'
import './sidebar.css'

/** `selection` on the page shown, or null (an empty bar). */
export function Breadcrumb({ scene, selection, entered = null, dispatch }: { scene: Scene; selection: Selection | null; entered?: State['entered']; dispatch: (a: Action) => void }) {
  const current = selection ?? entered
  const crumbs: SrcNode[] = []
  let list: SrcNode[] | undefined = selection?.inDefs ? scene.defs : scene.root
  for (const k of current?.path ?? []) {
    const n: SrcNode | undefined = list?.[k]
    if (!n) break
    crumbs.push(n)
    list = n.c
  }
  const name = (n: SrcNode) => {
    const id = first(n, 'ID')
    return typeof id === 'string' && id || typeof id === 'number' ? `${n.op}#${id}` : n.op
  }
  const last = crumbs[crumbs.length - 1], lock = last && !selection?.inDefs ? stays(last) : null
  const group = entered && nodeAt(scene.root, entered.path)
  return <nav className="vb-crumbs raised" aria-label="Selected node">
    {crumbs.map((n, k) => <Fragment key={k}>
      {k > 0 && <Icon name="chevron-right" />}
      <button type="button" aria-current={k === crumbs.length - 1 || undefined}
        onClick={() => dispatch({ type: 'select', selection: current && { ...current, path: current.path.slice(0, k + 1) } })}>{name(n)}</button>
    </Fragment>)}
    {group && <span className="unit"> · entered {name(group)}</span>}
    {lock && <span className="vb-lock-reason unit"> · locked: {lock}</span>}
  </nav>
}
