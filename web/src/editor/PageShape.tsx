// The active page's shape: a console face (its preview size and design units, spec 5.4) or a custom size in px.
import { useState, type Dispatch, type KeyboardEvent } from 'react'
import type { Page } from '../model/project'
import { SHAPES, type ShapeKind } from '../model/shapes'
import type { Action } from '../model/store'

export function PageShape({ page, dispatch }: { page: Page; dispatch: Dispatch<Action> }) {
  // Choosing Custom only shows the inputs: the page keeps its shape, units and history until a size is committed.
  const [picked, setPicked] = useState<string | null>(null)   // the page Custom was chosen on
  // What is typed, until the blur commits it; otherwise the inputs show the page's size as the store has it.
  const [draft, setDraft] = useState<{ w: string; h: string } | null>(null)
  const custom = page.shape === 'custom' || picked === page.id
  const shown = draft ?? { w: String(page.size.w), h: String(page.size.h) }
  const set = (shape: ShapeKind, size = page.size) => dispatch({ type: 'setPageShape', pageId: page.id, shape, size })
  const choose = (shape: ShapeKind) => {
    setPicked(shape === 'custom' ? page.id : null)
    if (shape !== 'custom') set(shape)
  }
  const read = (typed: string, old: number) => typed.trim() ? Number(typed) : old   // an emptied field keeps its value
  const commit = () => {
    if (!draft) return
    setDraft(null)
    setPicked(null)
    set('custom', { w: read(draft.w, page.size.w), h: read(draft.h, page.size.h) })
  }
  const enter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur() }   // the blur commits
  const input = (k: 'w' | 'h', label: string) => <input type="number" min={1} max={8192} aria-label={label} value={shown[k]}
    onChange={e => setDraft({ ...shown, [k]: e.target.value })} onBlur={commit} onKeyDown={enter} />
  return <span className="vb-shape">
    <select aria-label="Page shape" value={custom ? 'custom' : page.shape} onChange={e => choose(e.target.value as ShapeKind)}>
      {Object.entries(SHAPES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
      <option value="custom">Custom</option>
    </select>
    {custom && <>{input('w', 'Width (px)')}×{input('h', 'Height (px)')}</>}
  </span>
}
